#!/usr/bin/env python3
"""随笔笔记 —— 本地 Markdown 笔记后端（纯 Python 标准库，零依赖）。

取代原 C++ 版本：以更高层级语言实现同等 REST 接口。
设计要点（与旧版行为兼容）：
  • 装饰器即高阶函数：@route 注册路由、@locked 串行化数据访问
  • dataclasses 反射：Settings 用 fields() 观察自身字段、patch() 运行时 setattr
  • 标准库复用：email 解析 multipart、mimetypes 推断静态类型
  • 原子落盘：临时文件 + os.replace，读者永远看不到半写文件
"""

import json
import mimetypes
import os
import re
import threading
import uuid
from dataclasses import asdict, dataclass, fields
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from functools import wraps
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

BASE = Path(__file__).resolve().parent
DATA, UPLOADS = BASE / "data", BASE / "uploads"
NOTES_FILE, SETTINGS_FILE, FOLDERS_FILE = (
    DATA / "notes.json", DATA / "settings.json", DATA / "folders.json")
INDEX_FILE = BASE / "templates" / "index.html"

MAX_BODY = 20 * 1024 * 1024          # 20 MiB（背景图上限）
MAX_TITLE, MAX_CONTENT, MAX_THEME = 512, 2 * 1024 * 1024, 32
THEMES = {"cyan", "emerald", "violet", "rose", "amber"}
IMAGE_MAGIC = (
    (b"\xff\xd8\xff", ".jpg"),
    (b"\x89PNG\r\n\x1a\n", ".png"),
    (b"GIF8", ".gif"),
    (b"RIFF", ".webp"),          # 额外校验 WEBP 子签名
)

ROUTES = []
data_lock = threading.RLock()       # httplib 每请求一线程，读写全部串行


class HttpError(Exception):
    """统一异常：路由只抛它，dispatcher 负责转成 JSON 错误响应。"""
    def __init__(self, status, detail):
        self.status, self.detail = status, detail


# ── 高阶函数：装饰器 ──────────────────────────────────────────────

def route(pattern, *methods):
    """把函数注册为 (method, path-regex) 路由。装饰器即高阶函数。"""
    rx = re.compile("^" + pattern + "$")
    methods = set(methods) or {"GET"}
    def register(fn):
        ROUTES.append((rx, methods, fn))
        return fn
    return register


def locked(fn):
    """串行化数据端点：读-改-写原子性（与旧版 data_mutex 等价）。"""
    @wraps(fn)
    def wrapper(self, match):
        with data_lock:
            return fn(self, match)
    return wrapper


# ── 基础 I/O ──────────────────────────────────────────────────────

def load_json(path, default):
    """读 JSON；损坏/不存在时退回默认值。os.replace 保证不会读到半写。"""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def atomic_write(path, content):
    """临时文件 + rename 原子落盘，失败返回 False（不抛出）。"""
    tmp = path.with_name(path.name + ".tmp")
    try:
        with open(tmp, "wb" if isinstance(content, bytes) else "w",
                  encoding=None if isinstance(content, bytes) else "utf-8") as f:
            f.write(content)
        os.replace(tmp, path)
        return True
    except OSError:
        tmp.unlink(missing_ok=True)
        return False


def save_json(path, obj):
    return atomic_write(path, json.dumps(obj, ensure_ascii=False, indent=2))


def now_iso():
    """与旧版 now_iso() 格式一致：2026-08-25T21:00:00.000+00:00"""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def norm_title(s):
    """标题归一化：仅保留 [0-9A-Za-z一-鿿]，ASCII 小写。"""
    return re.sub(r"[^一-鿿0-9A-Za-z]+", "", s.lower())


def rewrite_wiki_links(text, norm_old, new_title):
    """把 [[旧标题#节|别名]] 重写为新标题；跳过代码块/行内代码。"""
    out, pos, changed = [], 0, False
    in_fence = in_code = False
    n = len(text)
    while pos < n:
        ch = text[pos]
        if ch == '`':                                   # 代码围栏/行内代码
            end = pos
            while end < n and text[end] == '`':
                end += 1
            run = end - pos
            if run == 1:
                in_code = not in_code
            elif run >= 3:
                in_fence = not in_fence
            out.append(text[pos:end]); pos = end; continue
        if ch == '[' and not in_fence and not in_code and text.startswith("[[", pos):
            close = text.find("]]", pos + 2)
            if close > pos + 2:
                inner = text[pos + 2:close]
                title_part, alias = inner.split("|", 1) if "|" in inner else (inner, "")
                hash_idx = title_part.find("#")
                base = title_part[:hash_idx] if hash_idx >= 0 else title_part
                if base and norm_title(base) == norm_old:
                    suffix = title_part[hash_idx:] if hash_idx >= 0 else ""
                    out.append(f"[[{new_title}{suffix}{'|' + alias if '|' in inner else ''}]]")
                    pos = close + 2; changed = True; continue
        out.append(ch); pos += 1
    return "".join(out), changed


def sniff_image_ext(data):
    """按魔数判定扩展名；客户端文件名从不被信任。"""
    for sig, ext in IMAGE_MAGIC:
        if data.startswith(sig) and (sig != b"RIFF" or data[8:12] == b"WEBP"):
            return ext
    return None


# ── 数据模型：dataclass + 反射 ─────────────────────────────────────

@dataclass
class Settings:
    """服务器侧外观设置；patch() 用 setattr 按字段名运行时写入。"""
    background_image: str | None = None
    blur: int = 0
    transparency: float = 1.0
    theme: str = "cyan"

    # 声明式校验规则：字段 -> (类型转换, 合法化/校验)
    RULES = {
        "blur":         (int,   lambda v: max(0, min(20, v))),
        "transparency": (float, lambda v: max(0.1, min(1.0, v))),
        "theme":        (str,   lambda v: v if v in THEMES and len(v) <= MAX_THEME else None),
    }

    @classmethod
    def load(cls, data):
        """用 fields() 反射自身字段，从 JSON 字典安全恢复。"""
        s = cls()
        valid = {f.name for f in fields(s)}
        for k, v in data.items():
            if k in valid:
                setattr(s, k, v)          # 反射：按名字写属性
        return s

    def patch(self, data):
        """部分更新（PUT /api/settings 语义：只改请求里出现的字段）。"""
        for name, (cast, validate) in self.RULES.items():
            if name not in data:
                continue
            try:
                value = cast(data[name])
            except (TypeError, ValueError):
                raise HttpError(400, f"{name} 类型错误")
            value = validate(value)
            if value is None:
                raise HttpError(400, "Unknown theme")
            setattr(self, name, value)    # 反射：按名字写属性
        return self


# ── HTTP 基础 ─────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    server_version = "NotesPy/1.0"
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        self._serve()

    def do_POST(self):
        self._dispatch()

    def do_PUT(self):
        self._dispatch()

    def do_DELETE(self):
        self._dispatch()

    def log_message(self, fmt, *args):
        pass                            # 本地应用保持安静

    # ── 请求读取 ────────────────────────────────────────────────
    def read_body(self):
        try:
            size = int(self.headers.get("Content-Length", 0))
        except ValueError:
            size = 0
        if size <= 0:
            raise HttpError(400, "Empty body")
        if size > MAX_BODY:
            raise HttpError(413, "Payload too large")
        return self.rfile.read(size)

    def read_json(self):
        try:
            return json.loads(self.read_body())
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise HttpError(400, "Invalid JSON body")

    # ── 响应发送 ────────────────────────────────────────────────
    def send_json(self, obj, status=200):
        payload = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def send_file(self, fs_path, ctype):
        try:
            data = fs_path.read_bytes()
        except OSError:
            return self.send_json({"detail": "Not found"}, 404)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")   # 本地应用：避免陈旧前端
        self.end_headers()
        self.wfile.write(data)

    # ── 分派 ────────────────────────────────────────────────────
    def _serve(self):
        """GET：先处理页面与静态挂载，再走 API 路由。"""
        path = urlsplit(self.path).path
        if path == "/":
            return self.send_file(INDEX_FILE, "text/html; charset=utf-8")
        if path.startswith("/static/") or path.startswith("/uploads/"):
            return self._serve_mount(path)
        return self._dispatch()

    def _serve_mount(self, path):
        root = UPLOADS if path.startswith("/uploads/") else BASE / "static"
        fs_path = (root / path.split("/", 2)[2]).resolve()
        root_resolved = str(root.resolve()) + os.sep
        if not fs_path.is_file() or not str(fs_path).startswith(root_resolved):
            return self.send_json({"detail": "Not found"}, 404)
        ctype = mimetypes.guess_type(str(fs_path))[0] or "application/octet-stream"
        self.send_file(fs_path, ctype)

    def _dispatch(self):
        """反射式分派：self.command（GET/POST/...）与注册路由匹配。"""
        path = urlsplit(self.path).path
        for rx, methods, fn in ROUTES:
            m = rx.match(path)
            if m and self.command in methods:
                try:
                    fn(self, m)
                except HttpError as e:
                    self.send_json({"detail": e.detail}, e.status)
                except Exception as e:      # 兜底，避免线程静默挂掉
                    self.send_json({"detail": f"Internal error: {e}"}, 500)
                return
        self.send_json({"detail": "Not found"}, 404)


# ── API 路由 ─────────────────────────────────────────────────────

@route("/api/notes")
@locked
def get_notes(self, m):
    self.send_json(load_json(NOTES_FILE, []))


@route("/api/notes", "POST")
@locked
def create_note(self, m):
    body = self.read_json()
    title, content = body.get("title", ""), body.get("content", "")
    if not isinstance(title, str) or not isinstance(content, str):
        raise HttpError(400, "title/content must be strings")
    if len(title.encode()) > MAX_TITLE:
        raise HttpError(400, "Title too long")
    if len(content.encode()) > MAX_CONTENT:
        raise HttpError(413, "Content too large")

    notes = load_json(NOTES_FILE, [])
    now = now_iso()
    note = {"id": uuid.uuid4().hex, "title": title, "content": content,
            "created_at": now, "updated_at": now}
    notes.append(note)
    if not save_json(NOTES_FILE, notes):
        raise HttpError(500, "Failed to persist notes")
    self.send_json(note)


@route(r"/api/notes/(?P<id>[a-f0-9]+)", "PUT")
@locked
def update_note(self, m):
    note_id = m["id"]
    body = self.read_json()
    new_title = body.get("title")
    new_content = body.get("content")
    if new_title is not None:
        if not isinstance(new_title, str):
            raise HttpError(400, "title/content must be strings")
        if len(new_title.encode()) > MAX_TITLE:
            raise HttpError(400, "Title too long")
    if new_content is not None:
        if not isinstance(new_content, str):
            raise HttpError(400, "title/content must be strings")
        if len(new_content.encode()) > MAX_CONTENT:
            raise HttpError(413, "Content too large")

    notes = load_json(NOTES_FILE, [])
    note = next((n for n in notes if n.get("id") == note_id), None)
    if note is None:
        raise HttpError(404, "Note not found")

    old_title = note.get("title", "")
    if new_title is not None:
        note["title"] = new_title
    if new_content is not None:
        note["content"] = new_content
    note["updated_at"] = now_iso()

    # 重命名维护：把其他笔记（含自身）里的 [[旧标题]] 改写为新标题。
    applied = note.get("title", "")
    norm_old, norm_new = norm_title(old_title), norm_title(applied)
    if norm_old and applied and norm_old != norm_new:
        # 仅当旧标题无歧义（应用重命名后无其他笔记持有）才改写
        if sum(1 for n in notes if norm_title(n.get("title", "")) == norm_old) == 0:
            now = now_iso()
            for n in notes:
                new_text, changed = rewrite_wiki_links(n.get("content", ""), norm_old, applied)
                if changed:
                    n["content"] = new_text
                    n["updated_at"] = now

    if not save_json(NOTES_FILE, notes):
        raise HttpError(500, "Failed to persist notes")
    self.send_json(note)


@route(r"/api/notes/(?P<id>[a-f0-9]+)", "DELETE")
@locked
def delete_note(self, m):
    note_id = m["id"]
    notes = load_json(NOTES_FILE, [])
    kept = [n for n in notes if n.get("id") != note_id]
    if len(kept) == len(notes):
        raise HttpError(404, "Note not found")
    if not save_json(NOTES_FILE, kept):
        raise HttpError(500, "Failed to persist notes")
    self.send_json({"ok": True})


@route("/api/folders")
@locked
def get_folders(self, m):
    self.send_json(load_json(FOLDERS_FILE, {"folders": [], "note_folder": {}}))


@route("/api/folders", "PUT")
@locked
def put_folders(self, m):
    body = self.read_json()
    if not isinstance(body.get("folders"), list) or not isinstance(body.get("note_folder"), dict):
        raise HttpError(400, "folders must be an array and note_folder an object")
    if not save_json(FOLDERS_FILE, body):
        raise HttpError(500, "Failed to persist folders")
    self.send_json(body)


@route("/api/settings")
@locked
def get_settings(self, m):
    self.send_json(asdict(Settings.load(load_json(SETTINGS_FILE, {}))))


@route("/api/settings", "PUT")
@locked
def put_settings(self, m):
    settings = Settings.load(load_json(SETTINGS_FILE, {}))
    settings.patch(self.read_json())
    if not save_json(SETTINGS_FILE, asdict(settings)):
        raise HttpError(500, "Failed to persist settings")
    self.send_json(asdict(settings))


@route("/api/upload-background", "POST")
@locked
def upload_background(self, m):
    ctype = self.headers.get("Content-Type", "")
    if not ctype.startswith("multipart/form-data"):
        raise HttpError(400, "Expected multipart form")
    # 库复用：email 标准库解析 multipart/form-data
    msg = BytesParser(policy=policy.default).parsebytes(
        b"Content-Type: " + ctype.encode() + b"\r\n\r\n" + self.read_body())
    if not msg.is_multipart():
        raise HttpError(400, "Expected multipart form")
    for part in msg.iter_parts():
        if part.get_param("name", header="content-disposition") != "file":
            continue
        filename, content = part.get_filename(), part.get_payload(decode=True)
        if not filename or not content:
            continue
        ext = sniff_image_ext(content)
        if not ext:
            raise HttpError(400, "Unsupported image format")
        stored = f"bg_{uuid.uuid4().hex}{ext}"
        if not atomic_write(UPLOADS / stored, content):
            raise HttpError(500, "Failed to store image")
        settings = Settings.load(load_json(SETTINGS_FILE, {}))
        settings.background_image = stored
        if not save_json(SETTINGS_FILE, asdict(settings)):
            raise HttpError(500, "Failed to persist settings")
        return self.send_json({"filename": stored})
    raise HttpError(400, "No file provided")


@route("/api/background", "DELETE")
@locked
def delete_background(self, m):
    settings = Settings.load(load_json(SETTINGS_FILE, {}))
    if settings.background_image:
        (UPLOADS / os.path.basename(settings.background_image)).unlink(missing_ok=True)
    settings.background_image = None
    if not save_json(SETTINGS_FILE, asdict(settings)):
        raise HttpError(500, "Failed to persist settings")
    self.send_json({"ok": True})


# ── 入口 ─────────────────────────────────────────────────────────

def main():
    DATA.mkdir(exist_ok=True)
    UPLOADS.mkdir(exist_ok=True)
    httpd = ThreadingHTTPServer(("127.0.0.1", 8000), Handler)
    httpd.daemon_threads = True
    print("Server running at http://127.0.0.1:8000")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
