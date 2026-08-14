// ═══════════════════════════════════════════════════════════════
// Notes App — visual effects (WebGL rays / splash cursor),
// border-glow cursor tracking, sidebar drag-to-resize.
// ═══════════════════════════════════════════════════════════════

import { THEME_COLORS } from "./state.js";
import { SideRays } from "/static/side-rays.js";
import { SplashCursor } from "/static/splash-cursor.js";

let sideRays = null;
let splashCursor = null;

// ── effect initializers ──────────────────────────────────────
export function initSideRays(theme) {
  var container = document.getElementById("raysLayer");
  if (!container) return;
  if (sideRays) { sideRays.destroy(); sideRays = null; }
  var c = THEME_COLORS[theme] || THEME_COLORS.cyan;
  sideRays = new SideRays(container, {
    speed: 2.5, rayColor1: c.c1, rayColor2: c.c2,
    intensity: 3, spread: 2, origin: "top-right", tilt: 0,
    saturation: 1.5, blend: 0.75, falloff: 1.2, opacity: 1,
  });
  try { sideRays.start(); } catch (e) { /* WebGL unavailable */ }
}

export function updateEffectsTheme(theme) {
  var c = THEME_COLORS[theme] || THEME_COLORS.cyan;
  if (sideRays) sideRays.update({ rayColor1: c.c1, rayColor2: c.c2 });
  if (splashCursor) splashCursor.updateColor(c.cursor);
}

export function initSplashCursor(theme) {
  var container = document.getElementById("cursorLayer");
  if (!container) return;
  if (splashCursor) { splashCursor.destroy(); splashCursor = null; }
  var c = THEME_COLORS[theme] || THEME_COLORS.cyan;
  splashCursor = new SplashCursor(container, {
    COLOR: c.cursor, RAINBOW_MODE: false, SHADING: true,
    CURL: 3, SPLAT_FORCE: 6000,
  });
  try { splashCursor.start(); } catch (e) { /* WebGL unavailable */ }
}

// ── border glow — throttled cursor tracking ──────────────────
var glowEls = [];
var glowTicking = false;
var mouseX = 0, mouseY = 0;

export function collectGlowElements() {
  glowEls = document.querySelectorAll(".border-glow");
}

function updateGlow() {
  for (var i = 0; i < glowEls.length; i++) {
    var el = glowEls[i];
    var r = el.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;
    var dx = mouseX - cx;
    var dy = mouseY - cy;
    var nearX = Math.max(0, Math.abs(dx) - r.width / 2) / 60;
    var nearY = Math.max(0, Math.abs(dy) - r.height / 2) / 60;
    var proximity = Math.max(0, 100 - Math.max(nearX, nearY) * 100);
    var angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
    el.style.setProperty("--edge-proximity", proximity.toFixed(1));
    el.style.setProperty("--cursor-angle", angle.toFixed(1) + "deg");
  }
  glowTicking = false;
}

// ── sidebar resize ────────────────────────────────────────────
function initSidebarResize() {
  var sidebarEl  = document.getElementById("sidebar");
  var resizerEl  = document.getElementById("sidebarResizer");
  if (!sidebarEl || !resizerEl) return;

  var MIN_W = 180, MAX_W = 500, W_KEY = "sidebar-width";

  var savedW = localStorage.getItem(W_KEY);
  if (savedW) {
    var w = parseInt(savedW, 10);
    if (w >= MIN_W && w <= MAX_W) sidebarEl.style.width = w + "px";
  }

  var drag = { on: false, sx: 0, sw: 0 };

  resizerEl.addEventListener("mousedown", function (e) {
    e.preventDefault();
    drag.on = true;
    drag.sx = e.clientX;
    drag.sw = parseInt(getComputedStyle(sidebarEl).width, 10);
    resizerEl.classList.add("active");
    document.body.classList.add("resizing");
  });

  document.addEventListener("mousemove", function (e) {
    if (!drag.on) return;
    var w = Math.max(MIN_W, Math.min(MAX_W, drag.sw + e.clientX - drag.sx));
    sidebarEl.style.width = w + "px";
  });

  document.addEventListener("mouseup", function () {
    if (!drag.on) return;
    drag.on = false;
    resizerEl.classList.remove("active");
    document.body.classList.remove("resizing");
    localStorage.setItem(
      W_KEY,
      parseInt(getComputedStyle(sidebarEl).width, 10)
    );
  });
}

// ── init ──────────────────────────────────────────────────────
export function initEffects() {
  collectGlowElements();

  document.addEventListener("mousemove", function (e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (!glowTicking) {
      glowTicking = true;
      requestAnimationFrame(updateGlow);
    }
  });

  initSidebarResize();
}
