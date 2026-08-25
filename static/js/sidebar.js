import { state, FOLDERS_KEY, EXPANDED_KEY } from "./state.js";
import { $, el } from "./dom.js";
import { genFolderId, showToast, showConfirm, storage } from "./utils.js";
import { collectGlowElements } from "./effects.js";

const noteList = $("#noteList");
const searchInput = $("#searchNotes");
const sidebar = $("#sidebar");
const sidebarBackdrop = $("#sidebarBackdrop");
const folderDialogOverlay = $("#folderDialogOverlay");
const folderDialogInput = $("#folderDialogInput");
const folderDialogOk = $("#folderDialogOk");
const folderDialogCancel = $("#folderDialogCancel");

const DND_TYPE = "application/x-notes-folder";
let searchDebounce = null;

// ── folder 状态与持久化 ───────────────────────────────────────
const readLocalFolderState = () => {
  try {
    const saved = JSON.parse(storage.get(FOLDERS_KEY, "{}"));
    if (Array.isArray(saved)) {          // 旧版 localStorage：纯数组
      state.folders = saved;
      state.noteFolder = {};
    } else {
      state.folders = Array.isArray(saved.folders) ? saved.folders : [];
      state.noteFolder = saved.noteFolder || {};
    }
    return state.folders.length > 0 || Object.keys(state.noteFolder).length > 0;
  } catch {
    state.folders = [];
    state.noteFolder = {};
    return false;
  }
};

const persistLocalFolderState = () => {
  storage.set(FOLDERS_KEY,
    JSON.stringify({ folders: state.folders, noteFolder: state.noteFolder }));
};

const uploadFoldersToServer = () => {
  fetch("/api/folders", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folders: state.folders, note_folder: state.noteFolder }),
  }).catch(() => { /* 服务器不可用时仅本地生效 */ });
};

// 本地立即启动 + 服务器镜像（跨浏览器/清缓存后仍能恢复）
export const loadFolderState = () => {
  const localHasData = readLocalFolderState();
  const localFolders = [...state.folders];
  const localNoteFolder = { ...state.noteFolder };

  try {
    state.expandedFolders = JSON.parse(storage.get(EXPANDED_KEY, "{}")) || {};
  } catch { state.expandedFolders = {}; }

  fetch("/api/folders", { cache: "no-cache" })
    .then((res) => res.ok ? res.json().catch(() => null) : null)
    .then((serverData) => {
      if (!serverData) return;
      const serverHasData =
        (Array.isArray(serverData.folders) && serverData.folders.length > 0) ||
        (serverData.note_folder && Object.keys(serverData.note_folder).length > 0);
      if (serverHasData) {
        const mergedFolders = Array.isArray(serverData.folders) ? [...serverData.folders] : [];
        const ids = new Set(mergedFolders.map((f) => f.id));
        localFolders.forEach((f) => { if (!ids.has(f.id)) { mergedFolders.push(f); ids.add(f.id); } });
        state.folders = mergedFolders;
        state.noteFolder = { ...localNoteFolder, ...(serverData.note_folder || {}) };
        persistLocalFolderState();
        uploadFoldersToServer();
        renderNoteList();
      } else if (localHasData) {
        uploadFoldersToServer();
      }
    })
    .catch(() => { /* 保持 localStorage-only 模式 */ });
};

export const saveFolderState = () => {
  persistLocalFolderState();
  uploadFoldersToServer();
};

const saveExpanded = () => {
  storage.set(EXPANDED_KEY, JSON.stringify(state.expandedFolders));
};

const commitFolders = () => {
  saveFolderState();
  saveExpanded();
  renderNoteList();
};

const folderById = (id) => state.folders.find((f) => f.id === id) || null;

const folderNoteCount = (id) =>
  Object.values(state.noteFolder).filter((fid) => fid === id).length;

const readDragData = (e) => {
  const raw = e.dataTransfer.getData(DND_TYPE);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
};

// ── 列表渲染 ──────────────────────────────────────────────────
const makeNoteItem = (n, inFolder) => {
  const li = el("li", {
    class: "border-glow",
    dataset: { id: n.id },
    draggable: true,
    onClick: () => noteList.dispatchEvent(new CustomEvent("note-select", { detail: { id: n.id } })),
    onDragStart: (e) => {
      e.dataTransfer.setData(DND_TYPE, JSON.stringify({ type: "note", id: n.id }));
      e.dataTransfer.effectAllowed = "move";
      li.classList.add("dragging");
    },
    onDragEnd: () => li.classList.remove("dragging"),
  }, el("span", { class: "note-title" }, n.title || "未命名"));
  if (inFolder) li.classList.add("note-in-folder");
  if (n.id === state.currentNoteId) li.classList.add("active");
  return li;
};

export const renderNoteList = () => {
  noteList.innerHTML = "";
  const q = state.searchQuery.trim().toLowerCase();

  const matches = (n) => !q || (n.title || "未命名").toLowerCase().includes(q);
  const sortByUpdated = (a, b) => new Date(b.updated_at) - new Date(a.updated_at);

  const visible = state.notes.filter(matches);

  // 按文件夹分组（忽略已删除文件夹的残留引用）
  const byFolder = {};
  const rootNotes = [];
  visible.forEach((n) => {
    const fid = state.noteFolder[n.id];
    if (fid && folderById(fid)) (byFolder[fid] ??= []).push(n);
    else rootNotes.push(n);
  });
  rootNotes.sort(sortByUpdated);

  let visibleCount = rootNotes.length;
  const sortedFolders = [...state.folders].sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), "zh-CN"));

  sortedFolders.forEach((f) => {
    const fNotes = (byFolder[f.id] || []).slice().sort(sortByUpdated);
    visibleCount += fNotes.length;
    if (q && fNotes.length === 0) return;   // 搜索时隐藏空文件夹

    noteList.appendChild(makeFolderRow(f));
    if ((q ? true : state.expandedFolders[f.id]) && fNotes.length) {
      fNotes.forEach((n) => noteList.appendChild(makeNoteItem(n, true)));
    }
  });

  rootNotes.forEach((n) => noteList.appendChild(makeNoteItem(n, false)));

  if (visibleCount === 0) {
    noteList.appendChild(el("div", { class: "note-list-empty" },
      q ? "无匹配笔记" : "暂无笔记，点击上方按钮创建"));
  }

  collectGlowElements();    // 重新收集 border-glow 供光标跟踪
};

// ── 文件夹行 ──────────────────────────────────────────────────
const makeFolderRow = (f) => {
  const expanded = state.searchQuery.trim() ? true : !!state.expandedFolders[f.id];
  const count = folderNoteCount(f.id);

  const caret = el("span", { class: "folder-caret" }, expanded ? "▾" : "▸");
  const icon = el("span", { class: "folder-icon" }, "\u{1F4C1}");
  const name = el("span", { class: "folder-name", title: f.name || "" }, f.name || "未命名文件夹");
  const countEl = el("span", { class: "folder-count" }, String(count));
  const del = el("button", {
    class: "folder-delete", type: "button",
    title: "删除文件夹（笔记移到顶层）", "aria-label": "删除文件夹",
  }, "✕");

  const row = el("li", {
    class: "folder-row border-glow",
    dataset: { folderId: f.id },
    draggable: true,
    onClick: () => {
      if (state.searchQuery.trim()) return;   // 搜索时文件夹强制展开
      state.expandedFolders[f.id] = !state.expandedFolders[f.id];
      saveExpanded();
      renderNoteList();
    },
    onDragStart: (e) => {
      e.dataTransfer.setData(DND_TYPE, JSON.stringify({ type: "folder", id: f.id }));
      e.dataTransfer.effectAllowed = "move";
      row.classList.add("dragging");
    },
    onDragEnd: () => row.classList.remove("dragging"),
    onDragOver: (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      row.classList.add("drag-over");
    },
    onDragLeave: () => row.classList.remove("drag-over"),
    onDrop: (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove("drag-over");
      const data = readDragData(e);
      if (!data) return;
      if (data.type === "note") moveNoteToFolder(data.id, f.id);
      else if (data.type === "folder") mergeFolders(data.id, f.id);
    },
  }, caret, icon, name, countEl, del);

  name.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    startRenameFolder(f, name);
  });
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    deleteFolder(f.id);
  });

  return row;
};

// ── 文件夹操作 ────────────────────────────────────────────────
const createFolder = (name) => {
  const folder = { id: genFolderId(), name, createdAt: new Date().toISOString() };
  state.folders.push(folder);
  state.expandedFolders[folder.id] = true;
  commitFolders();
  showToast("文件夹已创建", "success");
};

const moveNoteToFolder = (noteId, folderId) => {
  if (state.noteFolder[noteId] === folderId) return;
  state.noteFolder[noteId] = folderId;
  state.expandedFolders[folderId] = true;
  commitFolders();
  showToast("已移动到文件夹", "info");
};

const mergeFolders = async (srcId, targetId) => {
  if (srcId === targetId) return;
  const src = folderById(srcId), tgt = folderById(targetId);
  if (!src || !tgt) return;
  const ok = await showConfirm(
    `确定要把文件夹「${src.name || ""}」合并到「${tgt.name || ""}」吗？\n` +
    `其中 ${folderNoteCount(srcId)} 条笔记会移入「${tgt.name || ""}」，源文件夹将被删除。`);
  if (!ok) return;
  for (const [noteId, fid] of Object.entries(state.noteFolder)) {
    if (fid === srcId) state.noteFolder[noteId] = targetId;
  }
  state.folders = state.folders.filter((x) => x.id !== srcId);
  delete state.expandedFolders[srcId];
  state.expandedFolders[targetId] = true;
  commitFolders();
  showToast(`已合并到「${tgt.name || ""}」`, "success");
};

const deleteFolder = async (id) => {
  const f = folderById(id);
  if (!f) return;
  const ok = await showConfirm(
    `确定要删除文件夹「${f.name || ""}」吗？\n其中的笔记会移到顶层，不会被删除。`);
  if (!ok) return;
  for (const [noteId, fid] of Object.entries(state.noteFolder)) {
    if (fid === id) delete state.noteFolder[noteId];
  }
  state.folders = state.folders.filter((x) => x.id !== id);
  delete state.expandedFolders[id];
  commitFolders();
  showToast("文件夹已删除", "info");
};

const startRenameFolder = (f, nameEl) => {
  nameEl.contentEditable = "true";
  nameEl.classList.add("editing");
  nameEl.focus();
  const range = document.createRange();
  range.selectNodeContents(nameEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    nameEl.contentEditable = "false";
    nameEl.classList.remove("editing");
    const newName = (nameEl.textContent || "").trim();
    if (newName && newName !== f.name) {
      f.name = newName;
      saveFolderState();
      renderNoteList();
      showToast("文件夹已重命名", "info");
    } else if (!newName) {
      nameEl.textContent = f.name;
    }
  };
  nameEl.addEventListener("blur", commit);
  nameEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); nameEl.blur(); }
    else if (e.key === "Escape") { nameEl.textContent = f.name; commit(); }
  });
};

// ── 文件夹对话框 ──────────────────────────────────────────────
const openFolderDialog = () => {
  folderDialogOverlay.hidden = false;
  folderDialogInput.value = "";
  setTimeout(() => folderDialogInput.focus(), 0);
};
const closeFolderDialog = () => { folderDialogOverlay.hidden = true; };
const confirmCreateFolder = () => {
  const name = folderDialogInput.value.trim();
  if (!name) { folderDialogInput.focus(); return; }
  closeFolderDialog();
  createFolder(name);
};

// ── 初始化 ────────────────────────────────────────────────────
export const initSidebar = () => {
  $("#sidebarToggle").addEventListener("click", () => {
    sidebar.classList.toggle("open");
    sidebarBackdrop.classList.toggle("open");
  });
  sidebarBackdrop.addEventListener("click", () => {
    sidebar.classList.remove("open");
    sidebarBackdrop.classList.remove("open");
  });

  $("#btnNewFolder").addEventListener("click", openFolderDialog);
  folderDialogOk.addEventListener("click", confirmCreateFolder);
  folderDialogCancel.addEventListener("click", closeFolderDialog);
  folderDialogInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmCreateFolder();
    else if (e.key === "Escape") closeFolderDialog();
  });
  folderDialogOverlay.addEventListener("click", (e) => {
    if (e.target === folderDialogOverlay) closeFolderDialog();
  });

  // 拖到侧栏空白区 → 移回顶层
  noteList.addEventListener("dragover", (e) => {
    if (e.target === noteList) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      noteList.classList.add("drag-over-root");
    }
  });
  noteList.addEventListener("dragleave", (e) => {
    if (e.target === noteList) noteList.classList.remove("drag-over-root");
  });
  noteList.addEventListener("drop", (e) => {
    if (e.target !== noteList) return;
    e.preventDefault();
    noteList.classList.remove("drag-over-root");
    const data = readDragData(e);
    if (data?.type === "note" && state.noteFolder[data.id]) {
      delete state.noteFolder[data.id];
      saveFolderState();
      renderNoteList();
      showToast("已移到顶层", "info");
    }
  });

  // 搜索（防抖 200ms）
  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.searchQuery = searchInput.value;
      renderNoteList();
    }, 200);
  });
};
