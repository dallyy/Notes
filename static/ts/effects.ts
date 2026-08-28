import { THEME_COLORS } from "./state.js";
import { $ } from "./dom.js";
import { storage } from "./utils.js";
import { SideRays } from "../side-rays.js";
import { SplashCursor } from "../splash-cursor.js";

let sideRays = null;
let splashCursor = null;

const themeColors = (theme) => THEME_COLORS[theme] || THEME_COLORS.cyan;

export const initSideRays = (theme) => {
  const container = $("#raysLayer");
  if (!container) return;
  sideRays?.destroy();
  const c = themeColors(theme);
  sideRays = new SideRays(container, {
    speed: 2.5, rayColor1: c.c1, rayColor2: c.c2,
    intensity: 3, spread: 2, origin: "top-right", tilt: 0,
    saturation: 1.5, blend: 0.75, falloff: 1.2, opacity: 1,
  });
  try { sideRays.start(); } catch { /* WebGL 不可用 */ }
};

export const updateEffectsTheme = (theme) => {
  const c = themeColors(theme);
  sideRays?.update({ rayColor1: c.c1, rayColor2: c.c2 });
  splashCursor?.updateColor(c.cursor);
};

export const initSplashCursor = (theme) => {
  const container = $("#cursorLayer");
  if (!container) return;
  splashCursor?.destroy();
  const c = themeColors(theme);
  splashCursor = new SplashCursor(container, {
    COLOR: c.cursor, RAINBOW_MODE: false, SHADING: true,
    CURL: 3, SPLAT_FORCE: 6000,
  });
  try { splashCursor.start(); } catch { /* WebGL 不可用 */ }
};

// ── border glow：节流光标跟踪 ─────────────────────────────────
let glowEls: HTMLElement[] = [];
let glowTicking = false;
let mouseX = 0, mouseY = 0;

export const collectGlowElements = () => {
  glowEls = Array.from(document.querySelectorAll<HTMLElement>(".border-glow"));
};

const updateGlow = () => {
  for (const el of glowEls) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = mouseX - cx;
    const dy = mouseY - cy;
    const nearX = Math.max(0, Math.abs(dx) - r.width / 2) / 60;
    const nearY = Math.max(0, Math.abs(dy) - r.height / 2) / 60;
    const proximity = Math.max(0, 100 - Math.max(nearX, nearY) * 100);
    const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
    el.style.setProperty("--edge-proximity", proximity.toFixed(1));
    el.style.setProperty("--cursor-angle", `${angle.toFixed(1)}deg`);
  }
  glowTicking = false;
};

// ── sidebar 拖拽调宽 ──────────────────────────────────────────
const initSidebarResize = () => {
  const sidebarEl = $("#sidebar");
  const resizerEl = $("#sidebarResizer");
  if (!sidebarEl || !resizerEl) return;

  const MIN_W = 180, MAX_W = 500, W_KEY = "sidebar-width";
  const savedW = parseInt(storage.get(W_KEY), 10);
  if (savedW >= MIN_W && savedW <= MAX_W) sidebarEl.style.width = `${savedW}px`;

  const drag = { on: false, sx: 0, sw: 0 };

  resizerEl.addEventListener("mousedown", (e) => {
    e.preventDefault();
    drag.on = true;
    drag.sx = e.clientX;
    drag.sw = parseInt(getComputedStyle(sidebarEl).width, 10);
    resizerEl.classList.add("active");
    document.body.classList.add("resizing");
  });

  document.addEventListener("mousemove", (e) => {
    if (!drag.on) return;
    sidebarEl.style.width =
      `${Math.max(MIN_W, Math.min(MAX_W, drag.sw + e.clientX - drag.sx))}px`;
  });

  document.addEventListener("mouseup", () => {
    if (!drag.on) return;
    drag.on = false;
    resizerEl.classList.remove("active");
    document.body.classList.remove("resizing");
    storage.set(W_KEY, parseInt(getComputedStyle(sidebarEl).width, 10));
  });
};

// ── 初始化 ────────────────────────────────────────────────────
export const initEffects = () => {
  collectGlowElements();

  document.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (!glowTicking) {
      glowTicking = true;
      requestAnimationFrame(updateGlow);
    }
  });

  initSidebarResize();
};
