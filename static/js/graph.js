// ═══════════════════════════════════════════════════════════════
// Notes App — knowledge graph: 3D force-directed layout on canvas
// ═══════════════════════════════════════════════════════════════

import { state } from "./state.js";
import { findNoteByTitle, parseWikiLink } from "./utils.js";
import { selectNote } from "./editor.js";

const graphOverlayEl = document.getElementById("graphOverlay");
const graphCanvasEl = document.getElementById("graphCanvas");
const graphCtx = graphCanvasEl.getContext("2d");
let graphRaf = null;
let graphData = null;      // { nodes:[...], links:[...] }
const graphForce = { rep: 8000, link: 0.005, linkLen: 300, center: 0.0025, damp: 0.76 };
const graphCam = { az: 0.5, el: 0.25, zoom: 1 };
let graphPointer = null;
let graphHover = null;
let graphDrag = null;
let graphThemeColor = "#22d3ee";

function parseWikiLinks(text) {
  var refs = [];
  var re = /\[\[([^\]]+)\]\]/g;
  var m;
  while ((m = re.exec(text))) {
    var link = parseWikiLink(m[1]);
    if (link.title) refs.push(link);
  }
  return refs;
}

function computeGraph() {
  var nodes = state.notes.map(function (n) {
    return { id: n.id, title: n.title || "未命名", degree: 0 };
  });
  var nodeById = {};
  nodes.forEach(function (nd) { nodeById[nd.id] = nd; });
  var seen = {};
  var links = [];
  state.notes.forEach(function (n) {
    parseWikiLinks(n.content || "").forEach(function (ref) {
      var target = findNoteByTitle(ref.title);
      if (!target || target.id === n.id) return; // skip unresolved & self-links
      var key = n.id + ">" + target.id;
      if (seen[key]) return;
      seen[key] = true;
      links.push({ source: n.id, target: target.id });
      nodeById[n.id].degree++;
      nodeById[target.id].degree++;
    });
  });
  return { nodes: nodes, links: links };
}

function graphNodeRadius(n) {
  return 5 + Math.min(9, Math.sqrt(n.degree) * 3);
}

function simulateStep(jitter) {
  var nodes = graphData.nodes;
  var i, j;
  for (i = 0; i < nodes.length; i++) { nodes[i].fx = 0; nodes[i].fy = 0; nodes[i].fz = 0; }
  // repulsion (O(n²))
  for (i = 0; i < nodes.length; i++) {
    var a = nodes[i];
    for (j = i + 1; j < nodes.length; j++) {
      var b = nodes[j];
      var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      var d2 = dx * dx + dy * dy + dz * dz + 0.01;
      var d = Math.sqrt(d2);
      var f = graphForce.rep / d2;
      var ux = dx / d, uy = dy / d, uz = dz / d;
      a.fx += ux * f; a.fy += uy * f; a.fz += uz * f;
      b.fx -= ux * f; b.fy -= uy * f; b.fz -= uz * f;
    }
  }
  // link springs
  for (i = 0; i < graphData.links.length; i++) {
    var l = graphData.links[i];
    var a2 = l.s, b2 = l.t;
    var dx2 = b2.x - a2.x, dy2 = b2.y - a2.y, dz2 = b2.z - a2.z;
    var d3 = Math.sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2 + 0.01);
    var f2 = (d3 - graphForce.linkLen) * graphForce.link;
    var ux2 = dx2 / d3, uy2 = dy2 / d3, uz2 = dz2 / d3;
    a2.fx += ux2 * f2; a2.fy += uy2 * f2; a2.fz += uz2 * f2;
    b2.fx -= ux2 * f2; b2.fy -= uy2 * f2; b2.fz -= uz2 * f2;
  }
  // keep centered
  for (i = 0; i < nodes.length; i++) {
    var c = nodes[i];
    c.fx -= c.x * graphForce.center;
    c.fy -= c.y * graphForce.center;
    c.fz -= c.z * graphForce.center;
    // mild Z-flatten: keep nodes roughly coplanar so perspective depth
    // doesn't make distinct nodes visually overlap on screen
    c.fz -= c.z * 0.02;
  }
  // integrate
  for (i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (jitter) {
      n.vx += (Math.random() - 0.5) * 0.015;
      n.vy += (Math.random() - 0.5) * 0.015;
      n.vz += (Math.random() - 0.5) * 0.015;
    }
    n.vx = (n.vx + n.fx) * graphForce.damp;
    n.vy = (n.vy + n.fy) * graphForce.damp;
    n.vz = (n.vz + n.fz) * graphForce.damp;
    n.x += n.vx; n.y += n.vy; n.z += n.vz;
  }
}

// project 3D nodes → 2D with perspective (camera orbits via az/el)
function projectAll() {
  var W = graphCanvasEl.clientWidth, H = graphCanvasEl.clientHeight;
  var k = 0.5 * Math.min(W, H) || 1;
  var camDist = k * 1.7;
  var cosA = Math.cos(graphCam.az), sinA = Math.sin(graphCam.az);
  var cosE = Math.cos(graphCam.el), sinE = Math.sin(graphCam.el);
  var cx = W / 2, cy = H / 2;
  var out = [];
  for (var i = 0; i < graphData.nodes.length; i++) {
    var n = graphData.nodes[i];
    var x1 = n.x * cosA - n.z * sinA;
    var z1 = n.x * sinA + n.z * cosA;
    var y1 = n.y * cosE - z1 * sinE;
    var z2 = n.y * sinE + z1 * cosE;
    var depth = camDist + z2;
    var s = graphCam.zoom * k / depth;
    out.push({ n: n, x: cx + x1 * s, y: cy - y1 * s, s: s, depth: depth });
  }
  out.sort(function (a, b) { return b.depth - a.depth; }); // far first
  return out;
}

function hexToRgba(hex, alpha) {
  var h = String(hex).replace("#", "");
  if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
  var r = parseInt(h.slice(0, 2), 16);
  var g = parseInt(h.slice(2, 4), 16);
  var b = parseInt(h.slice(4, 6), 16);
  return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
}

function isGraphNeighbor(idA, idB) {
  if (idA === idB) return true;
  for (var i = 0; i < graphData.links.length; i++) {
    var l = graphData.links[i];
    if ((l.s.id === idA && l.t.id === idB) || (l.s.id === idB && l.t.id === idA)) return true;
  }
  return false;
}

function pickGraphNode(px, py) {
  var proj = projectAll();
  var best = null, bestD = 1e9;
  for (var i = 0; i < proj.length; i++) {
    var p = proj[i];
    var r = graphNodeRadius(p.n) * Math.max(p.s, 0.3);
    var th = Math.max(16, r + 5);
    var d = Math.hypot(p.x - px, p.y - py);
    if (d < th && d < bestD) { bestD = d; best = p.n; }
  }
  return best;
}

function drawGraph() {
  var ctx = graphCtx;
  var W = graphCanvasEl.clientWidth || graphOverlayEl.clientWidth;
  var H = graphCanvasEl.clientHeight || graphOverlayEl.clientHeight;
  if (!W || !H) return;
  ctx.clearRect(0, 0, W, H);
  var camDist = (0.5 * Math.min(W, H)) * 1.7;
  var proj = projectAll();
  var projById = {};
  for (var i = 0; i < proj.length; i++) projById[proj[i].n.id] = proj[i];

  // hover pick
  var hover = null;
  if (graphPointer && !(graphDrag && graphDrag.on)) {
    var best = null, bestD = 1e9;
    for (var i = 0; i < proj.length; i++) {
      var p = proj[i];
      var rr = graphNodeRadius(p.n) * Math.max(p.s, 0.3);
      var th = Math.max(16, rr + 5);
      var dd = Math.hypot(p.x - graphPointer.x, p.y - graphPointer.y);
      if (dd < th && dd < bestD) { bestD = dd; best = p.n; }
    }
    hover = best;
  }
  graphHover = hover;
  var hoverId = hover ? hover.id : null;

  // links
  ctx.lineWidth = 1.5;
  for (var i = 0; i < graphData.links.length; i++) {
    var l = graphData.links[i];
    var ps = projById[l.s.id], pt = projById[l.t.id];
    if (!ps || !pt) continue;
    var alpha = Math.max(0.12, Math.min(0.8, 1.1 - (ps.depth + pt.depth) / (2 * camDist)));
    if (hoverId && !isGraphNeighbor(hoverId, l.s.id)) alpha *= 0.08;
    ctx.strokeStyle = hexToRgba(graphThemeColor, alpha);
    ctx.beginPath();
    ctx.moveTo(ps.x, ps.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  }

  // nodes + always-visible labels (far first)
  for (var i = 0; i < proj.length; i++) {
    var p = proj[i];
    var n = p.n;
    var r = graphNodeRadius(n) * Math.max(p.s, 0.3);
    var alpha = Math.max(0.25, Math.min(1, 1.15 - p.depth / (camDist * 1.4)));
    var dim = (hoverId && !isGraphNeighbor(hoverId, n.id)) ? 0.12 : 1;

    ctx.globalAlpha = alpha * dim;
    ctx.fillStyle = n.degree > 0 ? hexToRgba(graphThemeColor, 1) : "rgba(161,161,170,1)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255," + (0.7 * alpha * dim) + ")";
    ctx.lineWidth = 1;
    ctx.stroke();

    // label — always shown, highlighted (bright bold white + glow)
    var fs = Math.max(10, Math.min(14, 13 * p.s));
    ctx.font = "700 " + fs + "px system-ui, 'Segoe UI', sans-serif";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 4;
    ctx.fillStyle = "rgba(255,255,255," + Math.max(0.78, 0.95 * alpha * dim) + ")";
    ctx.fillText(n.title, p.x + r + 5, p.y + fs * 0.35);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}

function resizeGraphCanvas() {
  var dpr = window.devicePixelRatio || 1;
  var overlayRect = graphOverlayEl.getBoundingClientRect();
  var toolbarEl = document.querySelector(".graph-toolbar");
  var hintEl = document.querySelector(".graph-hint");
  var toolbarH = toolbarEl ? toolbarEl.getBoundingClientRect().height : 0;
  var hintH = hintEl ? hintEl.getBoundingClientRect().height : 0;

  // Firefox sometimes reports 0 for a flexed canvas right after the
  // overlay is unhidden; derive the size from the overlay itself.
  var cssW = Math.max(1, Math.round(graphCanvasEl.clientWidth || overlayRect.width));
  var cssH = Math.max(1, Math.round(graphCanvasEl.clientHeight ||
      (overlayRect.height - toolbarH - hintH)));
  graphCanvasEl.style.width = cssW + "px";
  graphCanvasEl.style.height = cssH + "px";

  graphCanvasEl.width = Math.round(cssW * dpr);
  graphCanvasEl.height = Math.round(cssH * dpr);
  graphCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function graphRenderLoop() {
  if (graphOverlayEl.hidden) return;
  simulateStep(true);
  drawGraph();
  graphRaf = requestAnimationFrame(graphRenderLoop);
}

export function openGraph() {
  var g = computeGraph();
  var showIsolated = document.getElementById("graphShowIsolated").checked;
  var nodes = showIsolated ? g.nodes : g.nodes.filter(function (n) { return n.degree > 0; });
  var nodeMap = {};
  nodes.forEach(function (n) { nodeMap[n.id] = n; });
  var links = [];
  g.links.forEach(function (l) {
    var s = nodeMap[l.source], t = nodeMap[l.target];
    if (s && t) links.push({ s: s, t: t });
  });
  nodes.forEach(function (n) {
    n.x = (Math.random() - 0.5) * 800;
    n.y = (Math.random() - 0.5) * 800;
    n.z = (Math.random() - 0.5) * 320;
    n.vx = 0; n.vy = 0; n.vz = 0; n.fx = 0; n.fy = 0; n.fz = 0;
  });
  graphData = { nodes: nodes, links: links };
  for (var i = 0; i < 500; i++) simulateStep(false); // pre-settle

  graphThemeColor = getComputedStyle(document.body)
    .getPropertyValue("--t-400").trim() || "#22d3ee";
  graphCam.az = 0.5; graphCam.el = 0.25; graphCam.zoom = 1;

  document.getElementById("graphStats").textContent =
    nodes.length + " 篇笔记 · " + links.length + " 条关联";

  graphOverlayEl.hidden = false;
  // Wait one frame so Firefox has flushed the overlay layout before
  // measuring/sizing the canvas.
  requestAnimationFrame(function () {
    resizeGraphCanvas();
    if (graphRaf) cancelAnimationFrame(graphRaf);
    graphRaf = requestAnimationFrame(graphRenderLoop);
  });
}

export function closeGraph() {
  graphOverlayEl.hidden = true;
  if (graphRaf) { cancelAnimationFrame(graphRaf); graphRaf = null; }
  graphData = null;
  graphHover = null;
  graphPointer = null;
}

// ── init ──────────────────────────────────────────────────────
export function initGraph() {
  graphCanvasEl.addEventListener("mousemove", function (e) {
    var rect = graphCanvasEl.getBoundingClientRect();
    graphPointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (graphDrag && graphDrag.on) {
      var dx = e.clientX - graphDrag.sx, dy = e.clientY - graphDrag.sy;
      graphCam.az += dx * 0.008;
      graphCam.el = Math.max(-1.25, Math.min(1.25, graphCam.el + dy * 0.008));
      graphDrag.sx = e.clientX;
      graphDrag.sy = e.clientY;
      graphDrag.moved += Math.abs(dx) + Math.abs(dy);
    }
  });
  graphCanvasEl.addEventListener("mouseleave", function () { graphPointer = null; });
  graphCanvasEl.addEventListener("mousedown", function (e) {
    graphDrag = { on: true, sx: e.clientX, sy: e.clientY, moved: 0 };
  });
  document.addEventListener("mouseup", function () { graphDrag = null; });
  graphCanvasEl.addEventListener("mouseup", function (e) {
    var wasClick = graphDrag && graphDrag.moved < 5;
    graphDrag = null;
    if (wasClick) {
      var rect = graphCanvasEl.getBoundingClientRect();
      var picked = pickGraphNode(e.clientX - rect.left, e.clientY - rect.top);
      if (picked) { selectNote(picked.id, true); closeGraph(); }
    }
  });
  graphCanvasEl.addEventListener("wheel", function (e) {
    e.preventDefault();
    graphCam.zoom = Math.max(0.4, Math.min(3.5, graphCam.zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
  }, { passive: false });

  document.getElementById("btnToggleGraph").addEventListener("click", openGraph);
  graphOverlayEl.addEventListener("click", function (e) {
    if (e.target === graphOverlayEl) closeGraph();
  });
  document.getElementById("graphClose").addEventListener("click", closeGraph);
  document.getElementById("graphShowIsolated").addEventListener("change", function () {
    if (!graphOverlayEl.hidden) openGraph();
  });
  window.addEventListener("resize", function () {
    if (!graphOverlayEl.hidden) resizeGraphCanvas();
  });
}
