import { loadFolderState, initSidebar } from "./sidebar.js";
import { initEditor, loadNotes, createNote, saveCurrentNote } from "./editor.js";
import { initGraph, closeGraph } from "./graph.js";
import { initSettings, loadSettings, closeSettings } from "./settings.js";
import { initAutocomplete } from "./autocomplete.js";
import { initEffects } from "./effects.js";

loadFolderState();
initEffects();
initSidebar();
initAutocomplete();
initEditor();
initSettings();
initGraph();
loadNotes();
loadSettings();

// 全局快捷键：Ctrl/Cmd+N 新建，Ctrl/Cmd+S 保存，Esc 关闭抽屉/图谱
document.addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === "n") { e.preventDefault(); createNote(); }
  if (ctrl && e.key === "s") { e.preventDefault(); saveCurrentNote(); }
  if (e.key === "Escape") {
    if (document.getElementById("settingsPanel").classList.contains("open")) closeSettings();
    if (!document.getElementById("graphOverlay").hidden) closeGraph();
  }
});
