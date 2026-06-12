// ── state ────────────────────────────────────────────────────
let notes = [];
let currentNoteId = null;
let settings = {
  background_image: null,
  blur: 0,
  transparency: 1.0,
  theme: "cyan",
};

// ── side-rays ────────────────────────────────────────────────
let sideRays = null;
let splashCursor = null;
let clickSpark = null;

const THEME_COLORS = {
  cyan: { c1: "#22d3ee", c2: "#06b6d4", cursor: "#dd2c11" },
  emerald: { c1: "#34d399", c2: "#10b981", cursor: "#cb2c66" },
  violet: { c1: "#a78bfa", c2: "#8b5cf6", cursor: "#587405" },
  rose: { c1: "#fb7185", c2: "#f43f5e", cursor: "#048e7a" },
  amber: { c1: "#fbbf24", c2: "#f59e0b", cursor: "#0440db" },
};

function initSideRays(theme) {
  const container = document.getElementById("raysLayer");
  if (!container) return;
  if (sideRays) {
    sideRays.destroy();
    sideRays = null;
  }
  const colors = THEME_COLORS[theme] || THEME_COLORS.cyan;
  sideRays = new SideRays(container, {
    speed: 2.5,
    rayColor1: colors.c1,
    rayColor2: colors.c2,
    intensity: 3,
    spread: 2,
    origin: "top-right",
    tilt: 0,
    saturation: 1.5,
    blend: 0.75,
    falloff: 1.2,
    opacity: 1,
  });
  try {
    sideRays.start();
  } catch (e) {
    /* WebGL unavailable */
  }
}

function updateSideRaysTheme(theme) {
  if (!sideRays) return;
  const colors = THEME_COLORS[theme] || THEME_COLORS.cyan;
  sideRays.update({ rayColor1: colors.c1, rayColor2: colors.c2 });
}

function initSplashCursor(theme) {
  const container = document.getElementById("cursorLayer");
  if (!container) return;
  if (splashCursor) {
    splashCursor.destroy();
    splashCursor = null;
  }
  const colors = THEME_COLORS[theme] || THEME_COLORS.cyan;
  splashCursor = new SplashCursor(container, {
    COLOR: colors.cursor,
    RAINBOW_MODE: false,
    SHADING: true,
    CURL: 3,
    SPLAT_FORCE: 6000,
  });
  try {
    splashCursor.start();
  } catch (e) {
    /* WebGL unavailable */
  }
}

function updateSplashCursorTheme(theme) {
  if (!splashCursor) return;
  const colors = THEME_COLORS[theme] || THEME_COLORS.cyan;
  splashCursor.updateColor(colors.cursor);
}

function initClickSpark() {
  const container = document.getElementById("sparkLayer");
  if (!container) return;
  if (clickSpark) {
    clickSpark.destroy();
    clickSpark = null;
  }
  clickSpark = new ClickSpark(container, {
    sparkColor: "#6d28d9",
    sparkSize: 14,
    sparkRadius: 30,
    sparkCount: 8,
    duration: 450,
  });
  clickSpark.start();
}

function updateClickSparkTheme() {
  if (!clickSpark) return;
  clickSpark.updateColor("#6d28d9");
}

// ── dom refs ─────────────────────────────────────────────────
const bgLayer = document.getElementById("bgLayer");
const noteList = document.getElementById("noteList");
const editorActive = document.getElementById("editorActive");
const noteTitle = document.getElementById("noteTitle");
const noteContent = document.getElementById("noteContent");
const editorMeta = document.getElementById("editorMeta");
const notePreview = document.getElementById("notePreview");
const settingsPanel = document.getElementById("settingsPanel");
let isPreview = false;
const blurSlider = document.getElementById("blurSlider");
const transSlider = document.getElementById("transSlider");
const blurVal = document.getElementById("blurVal");
const transVal = document.getElementById("transVal");
const themeSelect = document.getElementById("themeSelect");
const bgUpload = document.getElementById("bgUpload");

// ── api helpers ──────────────────────────────────────────────
async function api(path, options = {}) {
  const res = await fetch(path, options);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── notes ────────────────────────────────────────────────────
async function loadNotes() {
  notes = await api("/api/notes");
  renderNoteList();
}

function renderNoteList() {
  noteList.innerHTML = "";
  notes
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .forEach((n) => {
      const li = document.createElement("li");
      li.textContent = n.title || "未命名";
      li.dataset.id = n.id;
      li.classList.add("border-glow");
      if (n.id === currentNoteId) li.classList.add("active");
      li.addEventListener("click", () => selectNote(n.id));
      noteList.appendChild(li);
    });
}

async function selectNote(id) {
  currentNoteId = id;
  const note = notes.find((n) => n.id === id);
  if (!note) return;

  noteTitle.value = note.title;
  noteContent.value = note.content;
  noteTitle.classList.toggle("has-content", note.title.length > 0);

  // reset preview mode
  isPreview = false;
  noteContent.style.display = "";
  notePreview.style.display = "none";
  const btn = document.getElementById("btnPreview");
  btn.textContent = "预览";
  btn.classList.remove("active");

  editorMeta.textContent = `更新于 ${formatDate(note.updated_at)}`;
  document.querySelector(".editor-placeholder").style.display = "none";
  editorActive.style.display = "flex";

  // scroll-reveal trigger
  editorActive.classList.remove("revealing");
  void editorActive.offsetWidth; // force reflow
  editorActive.classList.add("revealing");
  setTimeout(() => editorActive.classList.remove("revealing"), 900);

  renderNoteList();
}

async function createNote() {
  const note = await api("/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "", content: "" }),
  });
  notes.push(note);
  selectNote(note.id);
  renderNoteList();
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString();
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCurrentNote, 600);
}

async function saveCurrentNote() {
  if (!currentNoteId) return;
  const title = noteTitle.value;
  const content = noteContent.value;
  const updated = await api(`/api/notes/${currentNoteId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, content }),
  });
  const idx = notes.findIndex((n) => n.id === currentNoteId);
  if (idx !== -1) notes[idx] = updated;
  editorMeta.textContent = `更新于 ${formatDate(updated.updated_at)}`;
  renderNoteList();
}

async function deleteNote() {
  if (!currentNoteId) return;
  await api(`/api/notes/${currentNoteId}`, { method: "DELETE" });
  notes = notes.filter((n) => n.id !== currentNoteId);
  currentNoteId = null;
  noteTitle.value = "";
  noteContent.value = "";
  noteTitle.classList.remove("has-content");
  document.querySelector(".editor-placeholder").style.display = "";
  editorActive.style.display = "none";
  renderNoteList();
}

// ── settings ─────────────────────────────────────────────────
async function loadSettings() {
  settings = await api("/api/settings");
  applySettings();
  blurSlider.value = settings.blur;
  transSlider.value = settings.transparency;
  blurVal.textContent = `${settings.blur}px`;
  transVal.textContent = settings.transparency.toFixed(2);
  initSideRays(settings.theme || "cyan");
  initSplashCursor(settings.theme || "cyan");
  initClickSpark();
}

function applySettings() {
  bgLayer.style.filter = `blur(${settings.blur}px)`;
  bgLayer.style.opacity = settings.transparency;
  if (settings.background_image) {
    bgLayer.style.backgroundImage = `url(/uploads/${settings.background_image})`;
  } else {
    bgLayer.style.backgroundImage = "";
  }
  document.body.dataset.theme = settings.theme || "cyan";
  themeSelect.value = settings.theme || "cyan";
  updateSideRaysTheme(settings.theme || "cyan");
  updateSplashCursorTheme(settings.theme || "cyan");
  updateClickSparkTheme();
}

async function updateSettings() {
  const blur = parseInt(blurSlider.value);
  const transparency = parseFloat(transSlider.value);
  settings = await api("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blur, transparency }),
  });
  applySettings();
  blurVal.textContent = `${settings.blur}px`;
  transVal.textContent = settings.transparency.toFixed(2);
}

async function saveTheme() {
  const theme = themeSelect.value;
  settings = await api("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme }),
  });
  document.body.dataset.theme = theme;
  updateSideRaysTheme(theme);
  updateSplashCursorTheme(theme);
  updateClickSparkTheme();
}

async function uploadBackground(file) {
  const form = new FormData();
  form.append("file", file);
  const result = await api("/api/upload-background", {
    method: "POST",
    body: form,
  });
  settings.background_image = result.filename;
  applySettings();
}

async function removeBackground() {
  await api("/api/background", { method: "DELETE" });
  settings.background_image = null;
  applySettings();
}

// ── events ───────────────────────────────────────────────────
document.getElementById("btnNewNote").addEventListener("click", createNote);
document.getElementById("btnSave").addEventListener("click", saveCurrentNote);
document.getElementById("btnDelete").addEventListener("click", deleteNote);

document.getElementById("btnPreview").addEventListener("click", () => {
  isPreview = !isPreview;
  const btn = document.getElementById("btnPreview");
  if (isPreview) {
    noteContent.style.display = "none";
    notePreview.style.display = "block";
    notePreview.innerHTML = marked.parse(noteContent.value || "*暂无内容*");
    btn.textContent = "编辑";
    btn.classList.add("active");
  } else {
    noteContent.style.display = "";
    notePreview.style.display = "none";
    btn.textContent = "预览";
    btn.classList.remove("active");
  }
});

noteTitle.addEventListener("input", () => {
  scheduleSave();
  noteTitle.classList.toggle("has-content", noteTitle.value.length > 0);
});
noteContent.addEventListener("input", scheduleSave);

document.getElementById("btnToggleSettings").addEventListener("click", () => {
  const visible = settingsPanel.style.display !== "none";
  settingsPanel.style.display = visible ? "none" : "block";
});

blurSlider.addEventListener("input", () => {
  blurVal.textContent = `${blurSlider.value}px`;
});
transSlider.addEventListener("input", () => {
  transVal.textContent = parseFloat(transSlider.value).toFixed(2);
});
blurSlider.addEventListener("change", updateSettings);
transSlider.addEventListener("change", updateSettings);

bgUpload.addEventListener("change", () => {
  const file = bgUpload.files[0];
  if (file) uploadBackground(file);
});

themeSelect.addEventListener("change", saveTheme);
document
  .getElementById("btnRemoveBg")
  .addEventListener("click", removeBackground);

// ── keyboard shortcuts ──────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "n") {
    e.preventDefault();
    createNote();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    saveCurrentNote();
  }
});

// ── border glow: per-element mouse tracking ─────────────────
const glowEls = document.querySelectorAll(".border-glow");
if (glowEls.length) {
  document.addEventListener("mousemove", (e) => {
    glowEls.forEach((el) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;

      // edge proximity: 100 when mouse is right at the element edge
      const nearX = Math.max(0, Math.abs(dx) - r.width / 2) / 60;
      const nearY = Math.max(0, Math.abs(dy) - r.height / 2) / 60;
      const proximity = Math.max(0, 100 - Math.max(nearX, nearY) * 100);

      // cursor angle
      const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;

      el.style.setProperty("--edge-proximity", proximity.toFixed(1));
      el.style.setProperty("--cursor-angle", `${angle.toFixed(1)}deg`);
    });
  });
}

// ── init ─────────────────────────────────────────────────────
loadNotes();
loadSettings();
