// ═══════════════════════════════════════════════════════════════
// Notes App — editor: note CRUD, autosave, preview, wiki-link nav
// ═══════════════════════════════════════════════════════════════

import { state } from "./state.js";
import { apiSafe } from "./api.js";
import { setLoading, formatDate, showToast, showConfirm, findNoteByTitle } from "./utils.js";
import { renderMarkdown } from "./markdown.js";
import { renderNoteList, saveFolderState } from "./sidebar.js";
import { closeSuggest } from "./autocomplete.js";

const editorActive = document.getElementById("editorActive");
const editorPlaceholder = document.getElementById("editorPlaceholder");
const noteTitle = document.getElementById("noteTitle");
const noteContent = document.getElementById("noteContent");
const notePreview = document.getElementById("notePreview");
const editorMeta = document.getElementById("editorMeta");
const noteList = document.getElementById("noteList");

// ── notes crud ───────────────────────────────────────────────
export async function loadNotes() {
  setLoading(true);
  var result = await apiSafe("/api/notes", {}, "加载笔记失败");
  setLoading(false);
  if (result) {
    state.notes = result;
    renderNoteList();
  }
}

export async function createNote() {
  var note = await apiSafe(
    "/api/notes",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "", content: "" }),
    },
    "创建笔记失败"
  );
  if (!note) return;
  state.notes.push(note);
  state.lastSavedTitle = "";
  state.lastSavedContent = "";
  selectNote(note.id, false); // new empty note → stay in edit mode
  showToast("笔记已创建", "success");
}

export async function selectNote(id, openPreview) {
  state.currentNoteId = id;
  var note = state.notes.find(function (n) { return n.id === id; });
  if (!note) return;

  noteTitle.value = note.title;
  noteContent.value = note.content;
  noteTitle.classList.toggle("has-content", note.title.length > 0);
  closeSuggest(); // dropdown must not linger when switching notes

  // track for change detection
  state.lastSavedTitle = note.title;
  state.lastSavedContent = note.content;

  // preview mode by default (reading-first); openPreview=false → edit
  var btn = document.getElementById("btnPreview");
  if (openPreview !== false) {
    state.isPreview = true;
    btn.textContent = "编辑";
    btn.classList.add("active");
    editorActive.classList.add("preview-mode");
    notePreview.innerHTML = renderMarkdown(note.content || "*暂无内容*");
  } else {
    state.isPreview = false;
    btn.textContent = "预览";
    btn.classList.remove("active");
    editorActive.classList.remove("preview-mode");
  }

  editorMeta.textContent = "更新于 " + formatDate(note.updated_at);
  editorPlaceholder.hidden = true;
  editorActive.hidden = false;

  // scroll-reveal animation
  editorActive.classList.remove("revealing");
  void editorActive.offsetWidth; // force reflow
  editorActive.classList.add("revealing");
  setTimeout(function () { editorActive.classList.remove("revealing"); }, 900);

  renderNoteList();
}

function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveCurrentNote, 600);
}

export async function saveCurrentNote() {
  if (!state.currentNoteId) return;
  if (state.saving) {
    // re-schedule: try again after current save finishes
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveCurrentNote, 800);
    return;
  }

  var title = noteTitle.value;
  var content = noteContent.value;

  // skip if nothing changed
  if (title === state.lastSavedTitle && content === state.lastSavedContent) return;

  state.saving = true;
  var updated = await apiSafe(
    "/api/notes/" + state.currentNoteId,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title, content: content }),
    },
    "保存失败"
  );
  state.saving = false;

  if (!updated) return;

  state.lastSavedTitle = updated.title;
  state.lastSavedContent = updated.content;
  var idx = state.notes.findIndex(function (n) { return n.id === state.currentNoteId; });
  if (idx !== -1) state.notes[idx] = updated;
  editorMeta.textContent = "更新于 " + formatDate(updated.updated_at);

  // Server-side link maintenance: a title rename rewrites [[old title]]
  // links across every note (this one included). Sync the textarea when
  // the user has not typed since this save, then refresh all notes so
  // other notes' rewritten links show up immediately.
  if (updated.title !== title) {
    if (noteTitle.value === title && noteContent.value === content) {
      noteTitle.value = updated.title;
      noteContent.value = updated.content;
      noteTitle.classList.toggle("has-content", updated.title.length > 0);
    }
    await loadNotes();
  }

  renderNoteList();
}

export async function deleteNote() {
  if (!state.currentNoteId) return;
  var confirmed = await showConfirm("确定要删除这条笔记吗？此操作无法撤销。");
  if (!confirmed) return;

  var result = await apiSafe(
    "/api/notes/" + state.currentNoteId,
    { method: "DELETE" },
    "删除失败"
  );
  if (!result) return;

  var deletedId = state.currentNoteId;
  state.notes = state.notes.filter(function (n) { return n.id !== deletedId; });
  delete state.noteFolder[deletedId];
  saveFolderState();
  state.currentNoteId = null;
  state.lastSavedTitle = "";
  state.lastSavedContent = "";
  noteTitle.value = "";
  noteContent.value = "";
  noteTitle.classList.remove("has-content");
  editorPlaceholder.hidden = false;
  editorActive.hidden = true;
  renderNoteList();
  showToast("笔记已删除", "info");
}

// ── init ──────────────────────────────────────────────────────
export function initEditor() {
  document.getElementById("btnNewNote").addEventListener("click", createNote);
  document.getElementById("btnSave").addEventListener("click", saveCurrentNote);
  document.getElementById("btnDelete").addEventListener("click", deleteNote);

  // preview toggle — .preview-mode class handles display switching
  document.getElementById("btnPreview").addEventListener("click", function () {
    state.isPreview = !state.isPreview;
    var btn = document.getElementById("btnPreview");
    if (state.isPreview) {
      editorActive.classList.add("preview-mode");
      notePreview.innerHTML = renderMarkdown(noteContent.value || "*暂无内容*");
      btn.textContent = "编辑";
      btn.classList.add("active");
    } else {
      editorActive.classList.remove("preview-mode");
      btn.textContent = "预览";
      btn.classList.remove("active");
    }
  });

  // wiki-link navigation (delegated — preview is re-rendered)
  notePreview.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a.note-link") : null;
    if (!a) return;
    e.preventDefault();
    var noteId = a.getAttribute("data-note");
    if (noteId) { selectNote(noteId, true); return; }
    var title = a.getAttribute("data-title");
    if (title) {
      var n = findNoteByTitle(title);
      if (n) selectNote(n.id, true);
      else showToast("未找到笔记「" + title + "」", "error");
    }
  });

  // sidebar note items dispatch "note-select" (see sidebar.js) so that
  // selecting a note stays editor-side without a sidebar → editor cycle
  noteList.addEventListener("note-select", function (e) {
    if (e.detail && e.detail.id) selectNote(e.detail.id);
  });

  noteTitle.addEventListener("input", function () {
    scheduleSave();
    noteTitle.classList.toggle("has-content", noteTitle.value.length > 0);
  });
  noteContent.addEventListener("input", scheduleSave);
}
