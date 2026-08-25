// ═══════════════════════════════════════════════════════════════
// Notes App — sidebar: note list rendering, folders, search,
// folder dialog, drag & drop.
// ═══════════════════════════════════════════════════════════════

import { state, FOLDERS_KEY, EXPANDED_KEY } from "./state.js";
import { genFolderId, showToast, showConfirm } from "./utils.js";
import { collectGlowElements } from "./effects.js";

const noteList = document.getElementById("noteList");
const searchInput = document.getElementById("searchNotes");
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const folderDialogOverlay = document.getElementById("folderDialogOverlay");
const folderDialogInput = document.getElementById("folderDialogInput");
const folderDialogOk = document.getElementById("folderDialogOk");
const folderDialogCancel = document.getElementById("folderDialogCancel");

const DND_TYPE = "application/x-notes-folder";

let searchDebounce = null;

// ── folder state & persistence ───────────────────────────────
function readLocalFolderState() {
  try {
    var saved = JSON.parse(localStorage.getItem(FOLDERS_KEY) || "{}");
    if (Array.isArray(saved)) {
      // legacy localStorage format: a plain folder array
      state.folders = saved;
      state.noteFolder = {};
    } else {
      state.folders = Array.isArray(saved.folders) ? saved.folders : [];
      state.noteFolder = saved.noteFolder || {};
    }
    return state.folders.length > 0 || Object.keys(state.noteFolder).length > 0;
  } catch (e) {
    state.folders = [];
    state.noteFolder = {};
    return false;
  }
}

function persistLocalFolderState() {
  try {
    localStorage.setItem(
      FOLDERS_KEY,
      JSON.stringify({ folders: state.folders, noteFolder: state.noteFolder })
    );
  } catch (e) { /* localStorage unavailable — server copy still persists */ }
}

function uploadFoldersToServer() {
  fetch("/api/folders", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folders: state.folders, note_folder: state.noteFolder }),
  }).catch(function () { /* server may be unavailable */ });
}

// Folders are kept in localStorage for instant startup, and mirrored to
// the server so they survive browser switches and local-data clearing.
export function loadFolderState() {
  var localHasData = readLocalFolderState();
  var localFolders = state.folders.slice();
  var localNoteFolder = Object.assign({}, state.noteFolder);

  try {
    state.expandedFolders = JSON.parse(localStorage.getItem(EXPANDED_KEY) || "{}");
  } catch (e) {
    state.expandedFolders = {};
  }

  fetch("/api/folders", { cache: "no-cache" })
    .then(function (res) {
      if (!res.ok) return null;
      return res.json().catch(function () { return null; });
    })
    .then(function (serverData) {
      if (!serverData) return;
      var serverHasData =
        (Array.isArray(serverData.folders) && serverData.folders.length > 0) ||
        (serverData.note_folder && Object.keys(serverData.note_folder).length > 0);
      if (serverHasData) {
        // Merge server copy with any local-only folders (one-way migration).
        var mergedFolders = Array.isArray(serverData.folders) ? serverData.folders.slice() : [];
        var ids = {};
        mergedFolders.forEach(function (f) { ids[f.id] = true; });
        localFolders.forEach(function (f) {
          if (!ids[f.id]) { mergedFolders.push(f); ids[f.id] = true; }
        });
        state.folders = mergedFolders;
        state.noteFolder = Object.assign({}, localNoteFolder, serverData.note_folder || {});
        persistLocalFolderState();
        uploadFoldersToServer();
        renderNoteList();
      } else if (localHasData) {
        uploadFoldersToServer();
      }
    })
    .catch(function () { /* keep localStorage-only mode */ });
}

export function saveFolderState() {
  persistLocalFolderState();
  uploadFoldersToServer();
}

function saveExpanded() {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(state.expandedFolders));
  } catch (e) { /* localStorage unavailable — ignore */ }
}

function commitFolders() {
  saveFolderState();
  saveExpanded();
  renderNoteList();
}

function folderById(id) {
  for (var i = 0; i < state.folders.length; i++) {
    if (state.folders[i].id === id) return state.folders[i];
  }
  return null;
}

function folderNoteCount(id) {
  var count = 0;
  for (var key in state.noteFolder) {
    if (state.noteFolder[key] === id) count++;
  }
  return count;
}

function readDragData(e) {
  var raw = e.dataTransfer.getData(DND_TYPE);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }
}

function makeNoteItem(n, inFolder) {
  var li = document.createElement("li");
  var span = document.createElement("span");
  span.className = "note-title";
  span.textContent = n.title || "未命名";
  li.appendChild(span);
  li.dataset.id = n.id;
  li.classList.add("border-glow");
  if (inFolder) li.classList.add("note-in-folder");
  if (n.id === state.currentNoteId) li.classList.add("active");
  li.draggable = true;
  // selectNote lives in editor.js; notify it via a custom event on the list
  // (avoids a sidebar → editor import cycle).
  li.addEventListener("click", function () {
    noteList.dispatchEvent(new CustomEvent("note-select", { detail: { id: n.id } }));
  });
  li.addEventListener("dragstart", function (e) {
    e.dataTransfer.setData(DND_TYPE, JSON.stringify({ type: "note", id: n.id }));
    e.dataTransfer.effectAllowed = "move";
    li.classList.add("dragging");
  });
  li.addEventListener("dragend", function () { li.classList.remove("dragging"); });
  return li;
}

export function renderNoteList() {
  noteList.innerHTML = "";
  var q = state.searchQuery.trim().toLowerCase();

  var matches = function (n) {
    if (!q) return true;
    return (n.title || "未命名").toLowerCase().indexOf(q) !== -1;
  };
  var sortByUpdated = function (a, b) {
    return new Date(b.updated_at) - new Date(a.updated_at);
  };

  var visible = state.notes.filter(matches);

  // group notes by folder (ignore stale folder refs)
  var byFolder = {};
  var rootNotes = [];
  visible.forEach(function (n) {
    var fid = state.noteFolder[n.id];
    if (fid && folderById(fid)) {
      (byFolder[fid] = byFolder[fid] || []).push(n);
    } else {
      rootNotes.push(n);
    }
  });
  rootNotes.sort(sortByUpdated);

  var visibleCount = rootNotes.length;
  var sortedFolders = state.folders.slice().sort(function (a, b) {
    return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
  });

  sortedFolders.forEach(function (f) {
    var fNotes = (byFolder[f.id] || []).slice().sort(sortByUpdated);
    visibleCount += fNotes.length;
    if (q && fNotes.length === 0) return; // hide empty folders while searching

    noteList.appendChild(makeFolderRow(f));
    if ((q ? true : state.expandedFolders[f.id]) && fNotes.length) {
      fNotes.forEach(function (n) {
        noteList.appendChild(makeNoteItem(n, true));
      });
    }
  });

  // root (top-level) notes
  rootNotes.forEach(function (n) {
    noteList.appendChild(makeNoteItem(n, false));
  });

  if (visibleCount === 0) {
    var empty = document.createElement("div");
    empty.className = "note-list-empty";
    empty.textContent = q ? "无匹配笔记" : "暂无笔记，点击上方按钮创建";
    noteList.appendChild(empty);
  }

  // re-collect border-glow elements for cursor tracking
  collectGlowElements();
}

function makeFolderRow(f) {
  var expanded = state.searchQuery.trim() ? true : !!state.expandedFolders[f.id];
  var count = folderNoteCount(f.id);

  var row = document.createElement("li");
  row.className = "folder-row border-glow";
  row.draggable = true;
  row.dataset.folderId = f.id;

  var caret = document.createElement("span");
  caret.className = "folder-caret";
  caret.textContent = expanded ? "▾" : "▸";

  var icon = document.createElement("span");
  icon.className = "folder-icon";
  icon.textContent = "\u{1F4C1}";

  var name = document.createElement("span");
  name.className = "folder-name";
  name.textContent = f.name || "未命名文件夹";
  name.title = f.name || "";

  var countEl = document.createElement("span");
  countEl.className = "folder-count";
  countEl.textContent = count;

  var del = document.createElement("button");
  del.className = "folder-delete";
  del.type = "button";
  del.title = "删除文件夹（笔记移到顶层）";
  del.setAttribute("aria-label", "删除文件夹");
  del.textContent = "✕";

  row.appendChild(caret);
  row.appendChild(icon);
  row.appendChild(name);
  row.appendChild(countEl);
  row.appendChild(del);

  // toggle expand
  row.addEventListener("click", function () {
    if (state.searchQuery.trim()) return; // folders are forced open during search
    state.expandedFolders[f.id] = !state.expandedFolders[f.id];
    saveExpanded();
    renderNoteList();
  });

  // rename on double click
  name.addEventListener("dblclick", function (e) {
    e.stopPropagation();
    startRenameFolder(f, name);
  });

  // delete folder
  del.addEventListener("click", function (e) {
    e.stopPropagation();
    deleteFolder(f.id);
  });

  // drag & drop — folders are both draggable and drop targets
  row.addEventListener("dragstart", function (e) {
    e.dataTransfer.setData(DND_TYPE, JSON.stringify({ type: "folder", id: f.id }));
    e.dataTransfer.effectAllowed = "move";
    row.classList.add("dragging");
  });
  row.addEventListener("dragend", function () { row.classList.remove("dragging"); });
  row.addEventListener("dragover", function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    row.classList.add("drag-over");
  });
  row.addEventListener("dragleave", function () { row.classList.remove("drag-over"); });
  row.addEventListener("drop", function (e) {
    e.preventDefault();
    e.stopPropagation();
    row.classList.remove("drag-over");
    var data = readDragData(e);
    if (!data) return;
    if (data.type === "note") {
      moveNoteToFolder(data.id, f.id);
    } else if (data.type === "folder") {
      mergeFolders(data.id, f.id);
    }
  });

  return row;
}

// ── folder operations ────────────────────────────────────────
function createFolder(name) {
  var folder = { id: genFolderId(), name: name, createdAt: new Date().toISOString() };
  state.folders.push(folder);
  state.expandedFolders[folder.id] = true;
  commitFolders();
  showToast("文件夹已创建", "success");
}

function moveNoteToFolder(noteId, folderId) {
  if (state.noteFolder[noteId] === folderId) return;
  state.noteFolder[noteId] = folderId;
  state.expandedFolders[folderId] = true;
  commitFolders();
  showToast("已移动到文件夹", "info");
}

async function mergeFolders(srcId, targetId) {
  if (srcId === targetId) return;
  var src = folderById(srcId);
  var tgt = folderById(targetId);
  if (!src || !tgt) return;
  var confirmed = await showConfirm(
    "确定要把文件夹「" + (src.name || "") + "」合并到「" + (tgt.name || "") +
    "」吗？\n其中 " + folderNoteCount(srcId) +
    " 条笔记会移入「" + (tgt.name || "") + "」，源文件夹将被删除。"
  );
  if (!confirmed) return;
  for (var key in state.noteFolder) {
    if (state.noteFolder[key] === srcId) state.noteFolder[key] = targetId;
  }
  state.folders = state.folders.filter(function (x) { return x.id !== srcId; });
  delete state.expandedFolders[srcId];
  state.expandedFolders[targetId] = true;
  commitFolders();
  showToast("已合并到「" + (tgt.name || "") + "」", "success");
}

async function deleteFolder(id) {
  var f = folderById(id);
  if (!f) return;
  var confirmed = await showConfirm(
    "确定要删除文件夹「" + (f.name || "") + "」吗？\n其中的笔记会移到顶层，不会被删除。"
  );
  if (!confirmed) return;
  for (var key in state.noteFolder) {
    if (state.noteFolder[key] === id) delete state.noteFolder[key];
  }
  state.folders = state.folders.filter(function (x) { return x.id !== id; });
  delete state.expandedFolders[id];
  commitFolders();
  showToast("文件夹已删除", "info");
}

function startRenameFolder(f, nameEl) {
  nameEl.contentEditable = "true";
  nameEl.classList.add("editing");
  nameEl.focus();
  var range = document.createRange();
  range.selectNodeContents(nameEl);
  var sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  var done = false;
  function commit() {
    if (done) return;
    done = true;
    nameEl.contentEditable = "false";
    nameEl.classList.remove("editing");
    var newName = (nameEl.textContent || "").trim();
    if (newName && newName !== f.name) {
      f.name = newName;
      saveFolderState();
      renderNoteList();
      showToast("文件夹已重命名", "info");
    } else if (!newName) {
      nameEl.textContent = f.name;
    }
  }
  nameEl.addEventListener("blur", commit);
  nameEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      nameEl.blur();
    } else if (e.key === "Escape") {
      nameEl.textContent = f.name;
      commit();
    }
  });
}

// ── folder dialog ────────────────────────────────────────────
function openFolderDialog() {
  folderDialogOverlay.hidden = false;
  folderDialogInput.value = "";
  setTimeout(function () { folderDialogInput.focus(); }, 0);
}
function closeFolderDialog() {
  folderDialogOverlay.hidden = true;
}
function confirmCreateFolder() {
  var name = folderDialogInput.value.trim();
  if (!name) { folderDialogInput.focus(); return; }
  closeFolderDialog();
  createFolder(name);
}

// ── init ──────────────────────────────────────────────────────
export function initSidebar() {
  // ── sidebar toggle (mobile) ──────────────────────────────────
  document.getElementById("sidebarToggle").addEventListener("click", function () {
    sidebar.classList.toggle("open");
    sidebarBackdrop.classList.toggle("open");
  });
  sidebarBackdrop.addEventListener("click", function () {
    sidebar.classList.remove("open");
    sidebarBackdrop.classList.remove("open");
  });

  // ── folder dialog ────────────────────────────────────────────
  document.getElementById("btnNewFolder").addEventListener("click", openFolderDialog);
  folderDialogOk.addEventListener("click", confirmCreateFolder);
  folderDialogCancel.addEventListener("click", closeFolderDialog);
  folderDialogInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") confirmCreateFolder();
    else if (e.key === "Escape") closeFolderDialog();
  });
  folderDialogOverlay.addEventListener("click", function (e) {
    if (e.target === folderDialogOverlay) closeFolderDialog();
  });

  // drag a note onto empty sidebar area → move back to top level
  noteList.addEventListener("dragover", function (e) {
    if (e.target === noteList) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      noteList.classList.add("drag-over-root");
    }
  });
  noteList.addEventListener("dragleave", function (e) {
    if (e.target === noteList) noteList.classList.remove("drag-over-root");
  });
  noteList.addEventListener("drop", function (e) {
    if (e.target !== noteList) return;
    e.preventDefault();
    noteList.classList.remove("drag-over-root");
    var data = readDragData(e);
    if (data && data.type === "note" && state.noteFolder[data.id]) {
      delete state.noteFolder[data.id];
      saveFolderState();
      renderNoteList();
      showToast("已移到顶层", "info");
    }
  });

  // ── search ───────────────────────────────────────────────────
  searchInput.addEventListener("input", function () {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(function () {
      state.searchQuery = searchInput.value;
      renderNoteList();
    }, 200);
  });
}
