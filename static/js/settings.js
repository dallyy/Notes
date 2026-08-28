import { state, BRIGHTNESS_KEY, MODE_KEY } from "./state.js";
import { apiSafe } from "./api.js";
import { $ } from "./dom.js";
import { showToast, storage } from "./utils.js";
import { initSideRays, initSplashCursor, updateEffectsTheme } from "./effects.js";
const settingsPanel = $("#settingsPanel");
const settingsOverlay = $("#settingsOverlay");
const bgLayer = $("#bgLayer");
const blurSlider = $("#blurSlider");
const transSlider = $("#transSlider");
const blurVal = $("#blurVal");
const transVal = $("#transVal");
const themeSelect = $("#themeSelect");
const bgUpload = $("#bgUpload");
const brightnessSlider = $("#brightnessSlider");
const brightnessVal = $("#brightnessVal");
const modeSelect = $("#modeSelect");
export const openSettings = () => {
    settingsPanel.classList.add("open");
    settingsOverlay.classList.add("open");
};
export const closeSettings = () => {
    settingsPanel.classList.remove("open");
    settingsOverlay.classList.remove("open");
};
export const loadSettings = async () => {
    const s = await apiSafe("/api/settings", {}, "加载设置失败");
    if (!s)
        return;
    state.settings = s;
    loadLocalUiSettings();
    applySettings();
    blurSlider.value = state.settings.blur;
    transSlider.value = state.settings.transparency;
    blurVal.textContent = `${state.settings.blur}px`;
    transVal.textContent = state.settings.transparency.toFixed(2);
    brightnessSlider.value = state.settings.brightness;
    brightnessVal.textContent = Number(state.settings.brightness).toFixed(2);
    modeSelect.value = state.settings.mode;
    initSideRays(state.settings.theme || "cyan");
    initSplashCursor(state.settings.theme || "cyan");
};
// brightness / mode 只存 localStorage（服务器响应会替换 settings 对象，需重新注入）
const loadLocalUiSettings = () => {
    state.settings.brightness = parseFloat(storage.get(BRIGHTNESS_KEY)) || 1;
    state.settings.mode = storage.get(MODE_KEY) || "light";
};
const applySettings = () => {
    bgLayer.style.filter = `blur(${state.settings.blur}px) brightness(${state.settings.brightness})`;
    bgLayer.style.opacity = state.settings.transparency;
    bgLayer.style.backgroundImage = state.settings.background_image
        ? `url(/uploads/${state.settings.background_image})` : "";
    document.body.dataset.theme = state.settings.theme || "cyan";
    document.body.dataset.mode = state.settings.mode || "light";
    themeSelect.value = state.settings.theme || "cyan";
    modeSelect.value = state.settings.mode || "light";
    updateEffectsTheme(state.settings.theme || "cyan");
};
const updateSettings = async () => {
    const s = await apiSafe("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blur: parseInt(blurSlider.value), transparency: parseFloat(transSlider.value) }),
    }, "更新设置失败");
    if (!s)
        return;
    state.settings = s;
    loadLocalUiSettings();
    applySettings();
    blurVal.textContent = `${state.settings.blur}px`;
    transVal.textContent = state.settings.transparency.toFixed(2);
};
const saveTheme = async () => {
    const theme = themeSelect.value;
    const s = await apiSafe("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme }),
    }, "切换主题失败");
    if (!s)
        return;
    state.settings = s;
    loadLocalUiSettings();
    document.body.dataset.theme = theme;
    updateEffectsTheme(theme);
};
const saveMode = () => {
    state.settings.mode = modeSelect.value === "dark" ? "dark" : "light";
    storage.set(MODE_KEY, state.settings.mode);
    applySettings();
};
const uploadBackground = async (file) => {
    const form = new FormData();
    form.append("file", file);
    const result = await apiSafe("/api/upload-background", { method: "POST", body: form }, "上传背景失败");
    if (!result)
        return;
    state.settings.background_image = result.filename;
    applySettings();
    showToast("背景已更新", "success");
};
const removeBackground = async () => {
    const result = await apiSafe("/api/background", { method: "DELETE" }, "移除背景失败");
    if (!result)
        return;
    state.settings.background_image = null;
    applySettings();
    showToast("背景已移除", "info");
};
// ── 初始化 ────────────────────────────────────────────────────
export const initSettings = () => {
    $("#btnToggleSettings").addEventListener("click", openSettings);
    $("#settingsClose").addEventListener("click", closeSettings);
    settingsOverlay.addEventListener("click", closeSettings);
    blurSlider.addEventListener("input", () => blurVal.textContent = `${blurSlider.value}px`);
    transSlider.addEventListener("input", () => transVal.textContent = parseFloat(transSlider.value).toFixed(2));
    blurSlider.addEventListener("change", updateSettings);
    transSlider.addEventListener("change", updateSettings);
    brightnessSlider.addEventListener("input", () => {
        const v = parseFloat(brightnessSlider.value) || 1;
        brightnessVal.textContent = v.toFixed(2);
        state.settings.brightness = v;
        applySettings(); // 拖动时实时预览
    });
    brightnessSlider.addEventListener("change", () => storage.set(BRIGHTNESS_KEY, String(state.settings.brightness)));
    modeSelect.addEventListener("change", saveMode);
    bgUpload.addEventListener("change", () => {
        const file = bgUpload.files[0];
        if (file)
            uploadBackground(file);
    });
    themeSelect.addEventListener("change", saveTheme);
    $("#btnRemoveBg").addEventListener("click", removeBackground);
};
