import { state } from "./state.js";
import { $ } from "./dom.js";

const toastContainer = $("#toastContainer");
const editorPlaceholder = $("#editorPlaceholder");
const confirmOverlay = $("#confirmOverlay");

// ── toast 通知 ────────────────────────────────────────────────
export const showToast = (message, type = "info") => {
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add("removing");
    el.addEventListener("animationend", () => el.remove());
  }, 3000);
};

// ── 加载状态 ──────────────────────────────────────────────────
export const setLoading = (on) => {
  editorPlaceholder.innerHTML = on
    ? '<div class="loading-spinner"><div class="spinner"></div></div>'
    : '<p>选择一个笔记或按 <kbd>Ctrl+N</kbd> 创建新笔记</p>';
};

// ── 确认对话框 ────────────────────────────────────────────────
export const showConfirm = (message) => new Promise((resolve) => {
  $("#confirmTitle").textContent = message;
  confirmOverlay.hidden = false;
  const ok = $("#confirmOk"), cancel = $("#confirmCancel");
  const cleanup = () => {
    confirmOverlay.hidden = true;
    ok.removeEventListener("click", onOk);
    cancel.removeEventListener("click", onCancel);
  };
  const onOk = () => { cleanup(); resolve(true); };
  const onCancel = () => { cleanup(); resolve(false); };
  ok.addEventListener("click", onOk);
  cancel.addEventListener("click", onCancel);
});

export const escapeHtml = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const formatDate = (iso) => new Date(iso).toLocaleString();

// 标题归一化：去标点/空格，英文小写，仅保留一-鿿与字母数字
export const normTitle = (s) => String(s).toLowerCase().replace(/[^一-鿿A-Za-z0-9]/g, "");

export interface WikiLink {
  type: "id" | "title";
  id?: string;
  title?: string;
  section: string;
  alias: string;
}

// 解析 [[@id#小节|别名]]（ID 锚定，新）或 [[标题#小节|别名]]（旧式，兼容）。
export const parseWikiLink = (raw): WikiLink => {
  const pipe = raw.indexOf("|");
  const target = pipe >= 0 ? raw.slice(0, pipe) : raw;
  const alias = (pipe >= 0 ? raw.slice(pipe + 1) : "").trim();
  const hash = target.indexOf("#");
  const head = (hash >= 0 ? target.slice(0, hash) : target).trim();
  const section = hash >= 0 ? target.slice(hash + 1).trim() : "";
  if (head.startsWith("@") && head.length > 1) {
    return { type: "id", id: head.slice(1), section, alias };
  }
  return { type: "title", title: head, section, alias };
};

export const findNoteById = (id) => state.notes.find((n) => n.id === id) || null;

export const findNoteByTitle = (title) => {
  const t = normTitle(title);
  if (!t) return null;
  let best = null;
  for (const n of state.notes) {
    const nt = normTitle(n.title || "未命名");
    if (nt === t) return n;
    if (nt.includes(t) || t.includes(nt)) {
      if (!best || nt.length < normTitle(best.title || "未命名").length) best = n;
    }
  }
  return best;
};

export const genFolderId = () =>
  "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// localStorage 安全封装（隐私模式/禁用时静默降级）
export const storage = {
  get: (k, fallback = null) => {
    try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; }
  },
  set: (k, v) => {
    try { localStorage.setItem(k, v); } catch { /* ignore */ }
  },
};
