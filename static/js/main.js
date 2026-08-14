// ═══════════════════════════════════════════════════════════════
// Notes App — entry point: init sequence + global shortcuts
// ═══════════════════════════════════════════════════════════════

import { loadFolderState, initSidebar } from "./sidebar.js";
import { initEditor, loadNotes, createNote, saveCurrentNote } from "./editor.js";
import { initGraph, closeGraph } from "./graph.js";
import { initSettings, loadSettings, closeSettings } from "./settings.js";
import { initAutocomplete } from "./autocomplete.js";
import { initEffects } from "./effects.js";

// ── init ──────────────────────────────────────────────────────
loadFolderState();
initEffects();
initSidebar();
initAutocomplete();
initEditor();
initSettings();
initGraph();
loadNotes();
loadSettings();

// ── keyboard shortcuts ────────────────────────────────────────
document.addEventListener("keydown", function (e) {
  if ((e.ctrlKey || e.metaKey) && e.key === "n") {
    e.preventDefault();
    createNote();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    saveCurrentNote();
  }
  // Escape closes settings drawer / graph overlay
  if (e.key === "Escape") {
    if (document.getElementById("settingsPanel").classList.contains("open")) closeSettings();
    if (!document.getElementById("graphOverlay").hidden) closeGraph();
  }
});
