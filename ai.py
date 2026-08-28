"""AI 检索增强模块：标题嵌入 + K-D 树 + 知识图谱连通块 + DashScope 对话。

纯标准库实现（urllib + json + heapq）：
  1. 对 notes.json 中每篇笔记的标题调用 qwen3.7-text-embedding 计算向量
  2. 用这些向量构建 K-D 树；查询时对问题向量做最近邻检索
  3. 命中标题后，在知识图谱中取该标题所在连通块的全部标题
  4. 把问题 + 连通块内每篇笔记的「标题 + 正文」写成上下文文档
  5. 将文档交给 deepseek-v4-pro-0813（思考链）生成回答
"""

import heapq
import json
import os
import re
import threading
import urllib.error
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"
CONFIG_FILE = DATA / "ai_config.json"
CACHE_FILE = DATA / "embeddings.json"
CONTEXT_FILE = DATA / "chat_context.json"

DEFAULTS = {
    "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "api_key": "",
    "embedding_model": "qwen3.7-text-embedding",
    "chat_model": "deepseek-v4-pro-0813",
    "enable_thinking": True,
    "timeout": 120,
    "top_k": 1,
}

_ai_lock = threading.Lock()     # 串行化所有 AI 网络/索引操作，避免重复嵌入


class AIError(Exception):
    """AI 模块可预期错误，由 server 转成 502 JSON。"""


def norm_title(s):
    """标题归一化：仅保留 [0-9A-Za-z一-鿿]，ASCII 小写。"""
    return re.sub(r"[^一-鿿0-9A-Za-z]+", "", s.lower())


# ── 配置 ──────────────────────────────────────────────────────────

def load_config():
    """data/ai_config.json 优先，其次环境变量，最后默认值。"""
    cfg = dict(DEFAULTS)
    if CONFIG_FILE.exists():
        try:
            cfg.update(json.loads(CONFIG_FILE.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            pass
    # 环境变量优先级最高，便于临时覆盖（也避免把密钥写死在代码里）
    env = {
        "base_url": os.environ.get("DASHSCOPE_BASE_URL"),
        "api_key": os.environ.get("DASHSCOPE_API_KEY"),
        "embedding_model": os.environ.get("EMBEDDING_MODEL"),
        "chat_model": os.environ.get("CHAT_MODEL"),
    }
    cfg.update({k: v for k, v in env.items() if v})
    return cfg


# ── HTTP JSON 调用 ────────────────────────────────────────────────

def http_json(url, api_key, payload, timeout):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode(),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        raise AIError(f"AI 接口返回 {e.code}: {detail[:500]}") from None
    except urllib.error.URLError as e:
        raise AIError(f"无法连接 AI 接口: {e.reason}") from None


def embed_texts(cfg, texts):
    """对一批文本调用 embedding 模型，返回与输入等长的向量列表。"""
    if not cfg.get("api_key"):
        raise AIError("未配置 DASHSCOPE_API_KEY（或 data/ai_config.json）")
    if not texts:
        return []
    url = cfg["base_url"].rstrip("/") + "/embeddings"
    resp = http_json(url, cfg["api_key"],
                     {"model": cfg["embedding_model"], "input": texts},
                     cfg["timeout"])
    # OpenAI 兼容格式：{"data":[{"index":0,"embedding":[...]}]}
    data = resp.get("data")
    if data:
        data = sorted(data, key=lambda x: x.get("index", 0))
        return [x["embedding"] for x in data]
    # 部分 DashScope 原生格式：{"output":{"embeddings":[...]}}
    out = (resp.get("output") or {}).get("embeddings")
    if out:
        return [x.get("embedding", x) if isinstance(x, dict) else x for x in out]
    raise AIError(f"embedding 响应格式异常: {str(resp)[:300]}")


# ── K-D 树 ────────────────────────────────────────────────────────

def _dist2(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b))


class KDTree:
    """高维 KD-Tree：每个条目为 (向量, 负载)。"""

    def __init__(self, items):
        self.items = items
        self.k = len(items[0][0]) if items else 0
        self.root = self._build(list(range(len(items))), 0) if self.k else None

    def _build(self, idxs, depth):
        if not idxs:
            return None
        axis = depth % self.k
        idxs.sort(key=lambda i: self.items[i][0][axis])
        mid = len(idxs) // 2
        return {
            "idx": idxs[mid],
            "axis": axis,
            "left": self._build(idxs[:mid], depth + 1),
            "right": self._build(idxs[mid + 1:], depth + 1),
        }

    def nearest(self, query, k=1):
        if self.root is None or k <= 0:
            return []
        k = min(k, len(self.items))
        heap = []                                  # 最大堆（负平方距离, item 下标）

        def search(node):
            if node is None:
                return
            idx = node["idx"]
            vec = self.items[idx][0]
            d2 = _dist2(vec, query)
            if len(heap) < k:
                heapq.heappush(heap, (-d2, idx))
            elif d2 < -heap[0][0]:
                heapq.heapreplace(heap, (-d2, idx))

            diff = query[node["axis"]] - vec[node["axis"]]
            near, far = (node["left"], node["right"]) if diff < 0 else (node["right"], node["left"])
            search(near)
            if len(heap) < k or diff * diff < -heap[0][0]:
                search(far)

        search(self.root)
        return [(_dist2(self.items[idx][0], query) ** 0.5, self.items[idx][1])
                for _, idx in sorted(heap, reverse=True)]


# ── 标题嵌入索引（带缓存）─────────────────────────────────────────

def _load_cache():
    if not CACHE_FILE.exists():
        return {}
    try:
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _save_cache(cache):
    try:
        CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def sync_index(cfg, notes):
    """增量更新嵌入缓存（按 note id + title 判断失效），构建 KDTree。"""
    cache = _load_cache()
    valid_ids = {n["id"] for n in notes}
    cache = {i: v for i, v in cache.items() if i in valid_ids}

    need = [n for n in notes
            if n["id"] not in cache or cache[n["id"]].get("title") != n.get("title", "")]
    if need:
        vectors = embed_texts(cfg, [n.get("title", "") for n in need])
        for n, vec in zip(need, vectors):
            cache[n["id"]] = {"title": n.get("title", ""), "vector": vec}
        _save_cache(cache)

    items = [(c["vector"], n) for n in notes
             if (c := cache.get(n["id"])) and c.get("vector")]
    return KDTree(items)


# ── 知识图谱与连通块 ──────────────────────────────────────────────

def parse_wiki_links(text):
    """提取 [[标题]] 中的标题（与前端 renderMarkdown 的解析一致）。"""
    return [t.split("#", 1)[0].split("|", 1)[0].strip()
            for t in re.findall(r"\[\[([^\]]+)\]\]", text or "") if t.strip()]


def find_note_by_title(notes, title):
    """标题匹配：精确优先，其次互含（与前端 findNoteByTitle 一致）。"""
    t = norm_title(title)
    if not t:
        return None
    best = None
    for n in notes:
        nt = norm_title(n.get("title", ""))
        if nt == t:
            return n
        if t in nt or nt in t:
            if best is None or len(nt) < len(norm_title(best.get("title", ""))):
                best = n
    return best


def build_note_graph(notes):
    """按双链关系构建无向图邻接表：{note_id: {neighbor_id}}。"""
    adj = {n["id"]: set() for n in notes}
    for n in notes:
        for ref in parse_wiki_links(n.get("content", "")):
            target = find_note_by_title(notes, ref)
            if target and target["id"] != n["id"]:
                adj[n["id"]].add(target["id"])
                adj[target["id"]].add(n["id"])
    return adj


def component_note_ids(adj, seed_id):
    """BFS 求 seed 所在连通块的全部 note id。"""
    seen, stack = set(), [seed_id]
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        stack.extend(adj.get(cur, ()))
    return seen


# ── 上下文文档与对话 ──────────────────────────────────────────────

def build_context_doc(question, comp_notes):
    """把问题与连通块内笔记正文拼成一份 Markdown 文档。"""
    lines = ["# 用户问题", question, "", "# 相关笔记"]
    for i, n in enumerate(comp_notes, 1):
        lines += ["", f"## 笔记{i}：{n.get('title', '未命名')}", n.get("content", "").strip()]
    return "\n".join(lines)


def chat_completion(cfg, question, context, history):
    """调用 DeepSeek（DashScope OpenAI 兼容），开启思考链。"""
    url = cfg["base_url"].rstrip("/") + "/chat/completions"
    messages = [{
        "role": "system",
        "content": "你是笔记知识助手。优先依据提供的笔记内容回答；"
                   "若笔记无相关信息，可结合常识并说明。使用中文回答。",
    }]
    for m in (history or [])[-10:]:
        role = m.get("role")
        if role in ("user", "assistant") and m.get("content"):
            messages.append({"role": role, "content": m["content"]})

    # context 文档首行已包含问题；直接作为用户消息输入
    messages.append({"role": "user", "content": context})

    payload = {
        "model": cfg["chat_model"],
        "messages": messages,
        "enable_thinking": bool(cfg.get("enable_thinking", True)),
        "stream": False,
    }
    resp = http_json(url, cfg["api_key"], payload, cfg["timeout"])
    try:
        msg = resp["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        raise AIError(f"对话接口响应异常: {str(resp)[:300]}") from None
    content = msg.get("content") or ""
    reasoning = msg.get("reasoning_content") or ""
    if not content and reasoning:
        content = reasoning
    return content, reasoning


def ai_chat(cfg, notes, question, history=None):
    """功能一+二串联：嵌入 → KDTree → 连通块 → 上下文文档 → 对话。"""
    with _ai_lock:
        question = (question or "").strip()
        if not question:
            raise AIError("问题不能为空")
        if not notes:
            raise AIError("笔记为空，无法检索")

        tree = sync_index(cfg, notes)
        if tree is None or not tree.items:
            raise AIError("嵌入索引为空，请先确认 embedding 配置可用")

        q_vec = embed_texts(cfg, [question])[0]
        nearest = tree.nearest(q_vec, max(1, int(cfg.get("top_k", 1))))
        seed = nearest[0][1]

        adj = build_note_graph(notes)
        ids = component_note_ids(adj, seed["id"])
        by_id = {n["id"]: n for n in notes}
        comp_notes = [by_id[i] for i in ids if i in by_id]
        comp_notes.sort(key=lambda n: n.get("updated_at", ""), reverse=True)

        title_tuple = tuple(n.get("title", "未命名") for n in comp_notes)
        context = build_context_doc(question, comp_notes)
        CONTEXT_FILE.write_text(json.dumps({
            "question": question,
            "matched_title": seed.get("title", ""),
            "title_tuple": list(title_tuple),
            "titles": list(title_tuple),
            "context": context,
        }, ensure_ascii=False, indent=2), encoding="utf-8")

        answer, reasoning = chat_completion(cfg, question, context, history)
        return {
            "answer": answer,
            "reasoning": reasoning or "",
            "matched_title": seed.get("title", ""),
            "titles": list(title_tuple),
            "context": context,
        }
