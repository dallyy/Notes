// ═══════════════════════════════════════════════════════════════
// Notes App — settings drawer: appearance controls & background
// ═══════════════════════════════════════════════════════════════

import { state, BRIGHTNESS_KEY, MODE_KEY } from "./state.js";
import { apiSafe } from "./api.js";
import { showToast } from "./utils.js";
import { initSideRays, initSplashCursor, updateEffectsTheme } from "./effects.js";

const settingsPanel = document.getElementById("settingsPanel");
const settingsOverlay = document.getElementById("settingsOverlay");
const bgLayer = document.getElementById("bgLayer");
const blurSlider = document.getElementById("blurSlider");
const transSlider = document.getElementById("transSlider");
const blurVal = document.getElementById("blurVal");
const transVal = document.getElementById("transVal");
const themeSelect = document.getElementById("themeSelect");
const bgUpload = document.getElementById("bgUpload");
const brightnessSlider = document.getElementById("brightnessSlider");
const brightnessVal = document.getElementById("brightnessVal");
const modeSelect = document.getElementById("modeSelect");

// ── settings drawer ──────────────────────────────────────────
export function openSettings() {
  settingsPanel.classList.add("open");
  settingsOverlay.classList.add("open");
}
export function closeSettings() {
  settingsPanel.classList.remove("open");
  settingsOverlay.classList.remove("open");
}

export async function loadSettings() {
  var s = await apiSafe("/api/settings", {}, "加载设置失败");
  if (!s) return;
  state.settings = s;
  loadLocalUiSettings();
  applySettings();
  blurSlider.value = state.settings.blur;
  transSlider.value = state.settings.transparency;
  blurVal.textContent = state.settings.blur + "px";
  transVal.textContent = state.settings.transparency.toFixed(2);
  brightnessSlider.value = state.settings.brightness;
  brightnessVal.textContent = Number(state.settings.brightness).toFixed(2);
  modeSelect.value = state.settings.mode;
  initSideRays(state.settings.theme || "cyan");
  initSplashCursor(state.settings.theme || "cyan");
}

// brightness + mode are stored in localStorage, not the server; re-inject
// them after any server response replaces the settings object
function loadLocalUiSettings() {
  state.settings.brightness = parseFloat(localStorage.getItem(BRIGHTNESS_KEY)) || 1;
  state.settings.mode = localStorage.getItem(MODE_KEY) || "light";
}

function applySettings() {
  bgLayer.style.filter = "blur(" + state.settings.blur + "px) brightness(" + state.settings.brightness + ")";
  bgLayer.style.opacity = state.settings.transparency;
  if (state.settings.background_image) {
    bgLayer.style.backgroundImage =
      "url(/uploads/" + state.settings.background_image + ")";
  } else {
    bgLayer.style.backgroundImage = "";
  }
  document.body.dataset.theme = state.settings.theme || "cyan";
  document.body.dataset.mode = state.settings.mode || "light";
  themeSelect.value = state.settings.theme || "cyan";
  modeSelect.value = state.settings.mode || "light";
  updateEffectsTheme(state.settings.theme || "cyan");
}

async function updateSettings() {
  var blur = parseInt(blurSlider.value);
  var transparency = parseFloat(transSlider.value);
  var s = await apiSafe(
    "/api/settings",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blur: blur, transparency: transparency }),
    },
    "更新设置失败"
  );
  if (!s) return;
  state.settings = s;
  loadLocalUiSettings();
  applySettings();
  blurVal.textContent = state.settings.blur + "px";
  transVal.textContent = state.settings.transparency.toFixed(2);
}

async function saveTheme() {
  var theme = themeSelect.value;
  var s = await apiSafe(
    "/api/settings",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: theme }),
    },
    "切换主题失败"
  );
  if (!s) return;
  state.settings = s;
  loadLocalUiSettings();
  document.body.dataset.theme = theme;
  updateEffectsTheme(theme);
}

function saveMode() {
  state.settings.mode = modeSelect.value === "dark" ? "dark" : "light";
  localStorage.setItem(MODE_KEY, state.settings.mode);
  applySettings();
}

async function uploadBackground(file) {
  var form = new FormData();
  form.append("file", file);
  var result = await apiSafe(
    "/api/upload-background",
    { method: "POST", body: form },
    "上传背景失败"
  );
  if (!result) return;
  state.settings.background_image = result.filename;
  applySettings();
  showToast("背景已更新", "success");
}

async function removeBackground() {
  var result = await apiSafe(
    "/api/background",
    { method: "DELETE" },
    "移除背景失败"
  );
  if (!result) return;
  state.settings.background_image = null;
  applySettings();
  showToast("背景已移除", "info");
}

// ── init ──────────────────────────────────────────────────────
export function initSettings() {
  document.getElementById("btnToggleSettings").addEventListener("click", openSettings);
  document.getElementById("settingsClose").addEventListener("click", closeSettings);
  settingsOverlay.addEventListener("click", closeSettings);

  blurSlider.addEventListener("input", function () {
    blurVal.textContent = blurSlider.value + "px";
  });
  transSlider.addEventListener("input", function () {
    transVal.textContent = parseFloat(transSlider.value).toFixed(2);
  });
  blurSlider.addEventListener("change", updateSettings);
  transSlider.addEventListener("change", updateSettings);

  brightnessSlider.addEventListener("input", function () {
    var v = parseFloat(brightnessSlider.value) || 1;
    brightnessVal.textContent = v.toFixed(2);
    state.settings.brightness = v;
    applySettings(); // live preview while dragging
  });
  brightnessSlider.addEventListener("change", function () {
    localStorage.setItem(BRIGHTNESS_KEY, String(state.settings.brightness));
  });

  modeSelect.addEventListener("change", saveMode);

  bgUpload.addEventListener("change", function () {
    var file = bgUpload.files[0];
    if (file) uploadBackground(file);
  });

  themeSelect.addEventListener("change", saveTheme);
  document.getElementById("btnRemoveBg").addEventListener("click", removeBackground);
}
