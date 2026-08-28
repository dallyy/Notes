import { state } from "./state.js";
import { $ } from "./dom.js";
import { findNoteByTitle, parseWikiLink } from "./utils.js";
import { selectNote } from "./editor.js";

const graphOverlayEl = $("#graphOverlay");
const graphCanvasEl = $("#graphCanvas");
const graphCtx = graphCanvasEl.getContext("2d");

let graphRaf = null;
let graphData: any = null;       // { nodes:[...], links:[{s,t}] }
const graphForce = { rep: 8000, link: 0.005, linkLen: 300, center: 0.0025, damp: 0.76 };
const graphCam = { az: 0.5, el: 0.25, zoom: 1 };
let graphPointer = null;
let graphHover = null;
let graphDrag = null;
let graphThemeColor = "#22d3ee";

const parseWikiLinks = (text) =>
  [...text.matchAll(/\[\[([^\]]+)\]\]/g)]
    .map((m) => parseWikiLink(m[1]))
    .filter((link) => link.title);

const computeGraph = (): any => {
  const nodes = state.notes.map((n) => ({ id: n.id, title: n.title || "未命名", degree: 0 }));
  const nodeById = new Map(nodes.map((nd) => [nd.id, nd]));
  const seen = new Set();
  const links = [];

  state.notes.forEach((n) => {
    parseWikiLinks(n.content || "").forEach((ref) => {
      const target = findNoteByTitle(ref.title);
      if (!target || target.id === n.id) return;      // 跳过悬空链与自链
      const key = `${n.id}>${target.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      links.push({ source: n.id, target: target.id });
      nodeById.get(n.id).degree++;
      nodeById.get(target.id).degree++;
    });
  });
  return { nodes, links };
};

const graphNodeRadius = (n) => 5 + Math.min(9, Math.sqrt(n.degree) * 3);

const simulateStep = (jitter) => {
  const { nodes, links } = graphData;

  nodes.forEach((n) => { n.fx = 0; n.fy = 0; n.fz = 0; });

  // 斥力 O(n²)
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      const d2 = dx * dx + dy * dy + dz * dz + 0.01;
      const d = Math.sqrt(d2);
      const f = graphForce.rep / d2;
      const ux = dx / d, uy = dy / d, uz = dz / d;
      a.fx += ux * f; a.fy += uy * f; a.fz += uz * f;
      b.fx -= ux * f; b.fy -= uy * f; b.fz -= uz * f;
    }
  }

  // 边弹簧
  links.forEach(({ s: a, t: b }) => {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz + 0.01);
    const f = (d - graphForce.linkLen) * graphForce.link;
    const ux = dx / d, uy = dy / d, uz = dz / d;
    a.fx += ux * f; a.fy += uy * f; a.fz += uz * f;
    b.fx -= ux * f; b.fy -= uy * f; b.fz -= uz * f;
  });

  // 向心 + 轻量 Z 轴压扁，保持节点大致共面
  nodes.forEach((n) => {
    n.fx -= n.x * graphForce.center;
    n.fy -= n.y * graphForce.center;
    n.fz -= n.z * (graphForce.center + 0.02);
  });

  // 积分
  nodes.forEach((n) => {
    if (jitter) {
      n.vx += (Math.random() - 0.5) * 0.015;
      n.vy += (Math.random() - 0.5) * 0.015;
      n.vz += (Math.random() - 0.5) * 0.015;
    }
    n.vx = (n.vx + n.fx) * graphForce.damp;
    n.vy = (n.vy + n.fy) * graphForce.damp;
    n.vz = (n.vz + n.fz) * graphForce.damp;
    n.x += n.vx; n.y += n.vy; n.z += n.vz;
  });
};

// 3D → 2D 透视投影（相机绕 az/el 轨道）
const projectAll = (): any[] => {
  const W = graphCanvasEl.clientWidth, H = graphCanvasEl.clientHeight;
  const k = 0.5 * Math.min(W, H) || 1;
  const camDist = k * 1.7;
  const cosA = Math.cos(graphCam.az), sinA = Math.sin(graphCam.az);
  const cosE = Math.cos(graphCam.el), sinE = Math.sin(graphCam.el);
  const cx = W / 2, cy = H / 2;

  return graphData.nodes.map((n) => {
    const x1 = n.x * cosA - n.z * sinA;
    const z1 = n.x * sinA + n.z * cosA;
    const y1 = n.y * cosE - z1 * sinE;
    const z2 = n.y * sinE + z1 * cosE;
    const depth = camDist + z2;
    const s = graphCam.zoom * k / depth;
    return { n, x: cx + x1 * s, y: cy - y1 * s, s, depth };
  }).sort((a, b) => b.depth - a.depth);    // 远者先画
};

const hexToRgba = (hex, alpha) => {
  let h = String(hex).replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

const isGraphNeighbor = (idA, idB): any => {
  if (idA === idB) return true;
  return graphData.links.some((l) =>
    (l.s.id === idA && l.t.id === idB) || (l.s.id === idB && l.t.id === idA));
};

const pickGraphNode = (px, py): any => {
  let best = null, bestD = Infinity;
  for (const p of projectAll()) {
    const r = graphNodeRadius(p.n) * Math.max(p.s, 0.3);
    const d = Math.hypot(p.x - px, p.y - py);
    if (d < Math.max(16, r + 5) && d < bestD) { bestD = d; best = p.n; }
  }
  return best;
};

const drawGraph = (): any => {
  const ctx = graphCtx;
  const W = graphCanvasEl.clientWidth || graphOverlayEl.clientWidth;
  const H = graphCanvasEl.clientHeight || graphOverlayEl.clientHeight;
  if (!W || !H) return;
  ctx.clearRect(0, 0, W, H);

  const camDist = (0.5 * Math.min(W, H)) * 1.7;
  const proj = projectAll();
  const projById = new Map(proj.map((p) => [p.n.id, p]));

  // 悬停拾取
  let hover = null;
  if (graphPointer && !(graphDrag && graphDrag.on)) {
    let bestD = Infinity;
    for (const p of proj) {
      const rr = graphNodeRadius(p.n) * Math.max(p.s, 0.3);
      const dd = Math.hypot(p.x - graphPointer.x, p.y - graphPointer.y);
      if (dd < Math.max(16, rr + 5) && dd < bestD) { bestD = dd; hover = p.n; }
    }
  }
  graphHover = hover;
  const hoverId = hover ? hover.id : null;

  // 边
  ctx.lineWidth = 1.5;
  graphData.links.forEach((l) => {
    const ps = projById.get(l.s.id), pt = projById.get(l.t.id);
    if (!ps || !pt) return;
    let alpha = Math.max(0.12, Math.min(0.8, 1.1 - (ps.depth + pt.depth) / (2 * camDist)));
    if (hoverId && !isGraphNeighbor(hoverId, l.s.id)) alpha *= 0.08;
    ctx.strokeStyle = hexToRgba(graphThemeColor, alpha);
    ctx.beginPath();
    ctx.moveTo(ps.x, ps.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  });

  // 节点 + 标签（远者先画）
  proj.forEach((p) => {
    const { n } = p;
    const r = graphNodeRadius(n) * Math.max(p.s, 0.3);
    const alpha = Math.max(0.25, Math.min(1, 1.15 - p.depth / (camDist * 1.4)));
    const dim = (hoverId && !isGraphNeighbor(hoverId, n.id)) ? 0.12 : 1;

    ctx.globalAlpha = alpha * dim;
    ctx.fillStyle = n.degree > 0 ? hexToRgba(graphThemeColor, 1) : "rgba(161,161,170,1)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${0.7 * alpha * dim})`;
    ctx.lineWidth = 1;
    ctx.stroke();

    const fs = Math.max(10, Math.min(14, 13 * p.s));
    ctx.font = "700 " + fs + "px system-ui, 'Segoe UI', sans-serif";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 4;
    ctx.fillStyle = `rgba(255,255,255,${Math.max(0.78, 0.95 * alpha * dim)})`;
    ctx.fillText(n.title, p.x + r + 5, p.y + fs * 0.35);
    ctx.shadowBlur = 0;
  });
  ctx.globalAlpha = 1;
};

const resizeGraphCanvas = () => {
  const dpr = window.devicePixelRatio || 1;
  const overlayRect = graphOverlayEl.getBoundingClientRect();
  const toolbarEl = document.querySelector(".graph-toolbar");
  const hintEl = document.querySelector(".graph-hint");
  const toolbarH = toolbarEl ? toolbarEl.getBoundingClientRect().height : 0;
  const hintH = hintEl ? hintEl.getBoundingClientRect().height : 0;

  // Firefox 在 overlay 刚显示时可能报 0，用 overlay 尺寸兜底
  const cssW = Math.max(1, Math.round(graphCanvasEl.clientWidth || overlayRect.width));
  const cssH = Math.max(1, Math.round(graphCanvasEl.clientHeight ||
      (overlayRect.height - toolbarH - hintH)));
  graphCanvasEl.style.width = `${cssW}px`;
  graphCanvasEl.style.height = `${cssH}px`;

  graphCanvasEl.width = Math.round(cssW * dpr);
  graphCanvasEl.height = Math.round(cssH * dpr);
  graphCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
};

const graphRenderLoop = () => {
  if (graphOverlayEl.hidden) return;
  simulateStep(true);
  drawGraph();
  graphRaf = requestAnimationFrame(graphRenderLoop);
};

export const openGraph = () => {
  const g = computeGraph();
  const showIsolated = (document.getElementById("graphShowIsolated") as HTMLInputElement).checked;
  const nodes = showIsolated ? g.nodes : g.nodes.filter((n) => n.degree > 0);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const links = g.links.flatMap((l) => {
    const s = nodeMap.get(l.source), t = nodeMap.get(l.target);
    return s && t ? [{ s, t }] : [];
  });

  nodes.forEach((n) => {
    n.x = (Math.random() - 0.5) * 800;
    n.y = (Math.random() - 0.5) * 800;
    n.z = (Math.random() - 0.5) * 320;
    n.vx = 0; n.vy = 0; n.vz = 0; n.fx = 0; n.fy = 0; n.fz = 0;
  });
  graphData = { nodes, links };
  for (let i = 0; i < 500; i++) simulateStep(false);   // 预收敛

  graphThemeColor = getComputedStyle(document.body).getPropertyValue("--t-400").trim() || "#22d3ee";
  graphCam.az = 0.5; graphCam.el = 0.25; graphCam.zoom = 1;

  document.getElementById("graphStats").textContent =
    `${nodes.length} 篇笔记 · ${links.length} 条关联`;

  graphOverlayEl.hidden = false;
  requestAnimationFrame(() => {
    resizeGraphCanvas();
    if (graphRaf) cancelAnimationFrame(graphRaf);
    graphRaf = requestAnimationFrame(graphRenderLoop);
  });
};

export const closeGraph = () => {
  graphOverlayEl.hidden = true;
  if (graphRaf) { cancelAnimationFrame(graphRaf); graphRaf = null; }
  graphData = null;
  graphHover = null;
  graphPointer = null;
};

// ── 初始化 ────────────────────────────────────────────────────
export const initGraph = () => {
  graphCanvasEl.addEventListener("mousemove", (e) => {
    const rect = graphCanvasEl.getBoundingClientRect();
    graphPointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (graphDrag?.on) {
      const dx = e.clientX - graphDrag.sx, dy = e.clientY - graphDrag.sy;
      graphCam.az += dx * 0.008;
      graphCam.el = Math.max(-1.25, Math.min(1.25, graphCam.el + dy * 0.008));
      graphDrag.sx = e.clientX;
      graphDrag.sy = e.clientY;
      graphDrag.moved += Math.abs(dx) + Math.abs(dy);
    }
  });
  graphCanvasEl.addEventListener("mouseleave", () => { graphPointer = null; });
  graphCanvasEl.addEventListener("mousedown", (e) => {
    graphDrag = { on: true, sx: e.clientX, sy: e.clientY, moved: 0 };
  });
  document.addEventListener("mouseup", () => { graphDrag = null; });
  graphCanvasEl.addEventListener("mouseup", (e) => {
    const wasClick = graphDrag && graphDrag.moved < 5;
    graphDrag = null;
    if (wasClick) {
      const rect = graphCanvasEl.getBoundingClientRect();
      const picked = pickGraphNode(e.clientX - rect.left, e.clientY - rect.top);
      if (picked) { selectNote(picked.id, true); closeGraph(); }
    }
  });
  graphCanvasEl.addEventListener("wheel", (e) => {
    e.preventDefault();
    graphCam.zoom = Math.max(0.4, Math.min(3.5, graphCam.zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
  }, { passive: false });

  document.getElementById("btnToggleGraph").addEventListener("click", openGraph);
  graphOverlayEl.addEventListener("click", (e) => {
    if (e.target === graphOverlayEl) closeGraph();
  });
  document.getElementById("graphClose").addEventListener("click", closeGraph);
  document.getElementById("graphShowIsolated").addEventListener("change", () => {
    if (!graphOverlayEl.hidden) openGraph();
  });
  window.addEventListener("resize", () => {
    if (!graphOverlayEl.hidden) resizeGraphCanvas();
  });
};
