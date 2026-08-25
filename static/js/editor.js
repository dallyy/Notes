import { state } from "./state.js";
import { apiSafe } from "./api.js";
import { $ } from "./dom.js";
import { setLoading, formatDate, showToast, showConfirm, findNoteByTitle } from "./utils.js";
import { renderMarkdown } from "./markdown.js";
import { renderNoteList, saveFolderState } from "./sidebar.js";
import { closeSuggest } from "./autocomplete.js";

const editorActive = $("#editorActive");
const editorPlaceholder = $("#editorPlaceholder");
const noteTitle = $("#noteTitle");
const noteContent = $("#noteContent");
const notePreview = $("#notePreview");
const editorMeta = $("#editorMeta");
const noteList = $("#noteList");
const btnPreview = $("#btnPreview");

const setPreviewMode = (preview) => {
  state.isPreview = preview;
  btnPreview.textContent = preview ? "编辑" : "预览";
  btnPreview.classList.toggle("active", preview);
  editorActive.classList.toggle("preview-mode", preview);
  if (preview) notePreview.innerHTML = renderMarkdown(noteContent.value || "*暂无内容*");
};

// ── 笔记 CRUD ─────────────────────────────────────────────────
export const loadNotes = async () => {
  setLoading(true);
  const result = await apiSafe("/api/notes", {}, "加载笔记失败");
  setLoading(false);
  if (result) {
    state.notes = result;
    renderNoteList();
  }
};

export const createNote = async () => {
  const note = await apiSafe("/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "", content: "" }),
  }, "创建笔记失败");
  if (!note) return;
  state.notes.push(note);
  state.lastSavedTitle = "";
  state.lastSavedContent = "";
  selectNote(note.id, false);       // 新空笔记 → 留在编辑态
  showToast("笔记已创建", "success");
};

export const selectNote = (id, openPreview) => {
  state.currentNoteId = id;
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;

  noteTitle.value = note.title;
  noteContent.value = note.content;
  noteTitle.classList.toggle("has-content", note.title.length > 0);
  closeSuggest();

  state.lastSavedTitle = note.title;
  state.lastSavedContent = note.content;

  // 默认阅读优先（预览态）；openPreview === false 时进入编辑态
  setPreviewMode(openPreview !== false);

  editorMeta.textContent = `更新于 ${formatDate(note.updated_at)}`;
  editorPlaceholder.hidden = true;
  editorActive.hidden = false;

  // 滚动显现动画（先移除类再强制 reflow）
  editorActive.classList.remove("revealing");
  void editorActive.offsetWidth;
  editorActive.classList.add("revealing");
  setTimeout(() => editorActive.classList.remove("revealing"), 900);

  renderNoteList();
};

const scheduleSave = () => {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveCurrentNote, 600);
};

export const saveCurrentNote = async () => {
  if (!state.currentNoteId) return;
  if (state.saving) {              // 保存中：延后重试
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveCurrentNote, 800);
    return;
  }
  const title = noteTitle.value;
  const content = noteContent.value;
  if (title === state.lastSavedTitle && content === state.lastSavedContent) return;

  state.saving = true;
  const updated = await apiSafe(`/api/notes/${state.currentNoteId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, content }),
  }, "保存失败");
  state.saving = false;
  if (!updated) return;

  state.lastSavedTitle = updated.title;
  state.lastSavedContent = updated.content;
  const idx = state.notes.findIndex((n) => n.id === state.currentNoteId);
  if (idx !== -1) state.notes[idx] = updated;
  editorMeta.textContent = `更新于 ${formatDate(updated.updated_at)}`;

  // 服务端重命名维护：标题变化时同步 textarea 并重载所有笔记，
  // 让其他笔记里被重写的 [[旧标题]] 链接立即生效。
  if (updated.title !== title) {
    if (noteTitle.value === title && noteContent.value === content) {
      noteTitle.value = updated.title;
      noteContent.value = updated.content;
      noteTitle.classList.toggle("has-content", updated.title.length > 0);
    }
    await loadNotes();
  }

  renderNoteList();
};

export const deleteNote = async () => {
  if (!state.currentNoteId) return;
  if (!await showConfirm("确定要删除这条笔记吗？此操作无法撤销。")) return;

  const result = await apiSafe(`/api/notes/${state.currentNoteId}`,
    { method: "DELETE" }, "删除失败");
  if (!result) return;

  const deletedId = state.currentNoteId;
  state.notes = state.notes.filter((n) => n.id !== deletedId);
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
};

// ── 初始化 ────────────────────────────────────────────────────
export const initEditor = () => {
  $("#btnNewNote").addEventListener("click", createNote);
  $("#btnSave").addEventListener("click", saveCurrentNote);
  $("#btnDelete").addEventListener("click", deleteNote);
  btnPreview.addEventListener("click", () => setPreviewMode(!state.isPreview));

  // 双链导航（事件委托：preview 重新渲染后无需重新绑定）
  notePreview.addEventListener("click", (e) => {
    const a = e.target.closest?.("a.note-link");
    if (!a) return;
    e.preventDefault();
    const noteId = a.getAttribute("data-note");
    if (noteId) return selectNote(noteId, true);
    const title = a.getAttribute("data-title");
    const n = findNoteByTitle(title);
    if (n) selectNote(n.id, true);
    else showToast(`未找到笔记「${title}」`, "error");
  });

  // sidebar 通过自定义事件通知选笔记（避免 sidebar ↔ editor 循环导入）
  noteList.addEventListener("note-select", (e) => {
    if (e.detail?.id) selectNote(e.detail.id);
  });

  noteTitle.addEventListener("input", () => {
    scheduleSave();
    noteTitle.classList.toggle("has-content", noteTitle.value.length > 0);
  });
  noteContent.addEventListener("input", scheduleSave);
};
