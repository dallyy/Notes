// ═══════════════════════════════════════════════════════════════
// Notes App — shared utilities (toast, loading, confirm, formatting)
// ═══════════════════════════════════════════════════════════════

import { state } from "./state.js";

const toastContainer = document.getElementById("toastContainer");
const editorPlaceholder = document.getElementById("editorPlaceholder");
const confirmOverlay = document.getElementById("confirmOverlay");

// ── toast notifications ──────────────────────────────────────
export function showToast(message, type) {
  type = type || "info";
  const el = document.createElement("div");
  el.className = "toast toast--" + type;
  el.textContent = message;
  toastContainer.appendChild(el);

  setTimeout(function () {
    el.classList.add("removing");
    el.addEventListener("animationend", function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
  }, 3000);
}

// ── loading state ────────────────────────────────────────────
export function setLoading(on) {
  if (on) {
    editorPlaceholder.innerHTML =
      '<div class="loading-spinner"><div class="spinner"></div></div>';
  } else {
    editorPlaceholder.innerHTML =
      '<p>选择一个笔记或按 <kbd>Ctrl+N</kbd> 创建新笔记</p>';
  }
}

// ── confirm dialog ───────────────────────────────────────────
export function showConfirm(message) {
  return new Promise(function (resolve) {
    document.getElementById("confirmTitle").textContent = message;
    confirmOverlay.hidden = false;
    function cleanup() {
      confirmOverlay.hidden = true;
      document.getElementById("confirmOk").removeEventListener("click", onOk);
      document.getElementById("confirmCancel").removeEventListener("click", onCancel);
    }
    function onOk()    { cleanup(); resolve(true); }
    function onCancel(){ cleanup(); resolve(false); }
    document.getElementById("confirmOk").addEventListener("click", onOk);
    document.getElementById("confirmCancel").addEventListener("click", onCancel);
  });
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatDate(iso) {
  return new Date(iso).toLocaleString();
}

// normalize title for matching (strip punctuation/spaces so 图RAG ~ 图-RAG)
export function normTitle(s) {
  return String(s).toLowerCase().replace(/[^一-鿿A-Za-z0-9]/g, "");
}

export function parseWikiLink(raw) {
  var pipeIdx = raw.indexOf("|");
  var title = pipeIdx >= 0 ? raw.slice(0, pipeIdx) : raw;
  var alias = pipeIdx >= 0 ? raw.slice(pipeIdx + 1) : null;
  var hashIdx = title.indexOf("#");
  if (hashIdx >= 0) title = title.slice(0, hashIdx);
  return { title: title.trim(), alias: (alias || "").trim() };
}

export function findNoteByTitle(title) {
  var t = normTitle(title);
  if (!t) return null;
  var best = null;
  for (var i = 0; i < state.notes.length; i++) {
    var nt = normTitle(state.notes[i].title || "未命名");
    if (nt === t) return state.notes[i];
    if (nt.indexOf(t) !== -1 || t.indexOf(nt) !== -1) {
      if (!best || nt.length < normTitle(best.title || "未命名").length) best = state.notes[i];
    }
  }
  return best;
}

export function genFolderId() {
  return "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
