// ═══════════════════════════════════════════════════════════════
// Notes App — [[wiki-link autocomplete]] for the editor textarea
// ═══════════════════════════════════════════════════════════════

import { state } from "./state.js";
import { normTitle } from "./utils.js";

const noteContent = document.getElementById("noteContent");

// ── [[ wiki-link autocomplete ─────────────────────────────────
var suggestBox = document.createElement("div");
suggestBox.className = "link-suggest";
suggestBox.hidden = true;
document.body.appendChild(suggestBox);

var suggestItems = [];
var suggestActive = -1;
var suggestMatch = null;

function insideFencedCode() {
  var before = noteContent.value.slice(0, noteContent.selectionStart);
  var fences = before.split("```").length - 1;
  return fences % 2 === 1;
}

// unclosed [[query right before the caret
function currentLinkPrefix() {
  var val = noteContent.value;
  var pos = noteContent.selectionStart;
  if (typeof pos !== "number") return null;
  var m = /\[\[([^\[\]\n]*)$/.exec(val.slice(0, pos));
  if (!m || insideFencedCode()) return null;
  return { start: m.index, query: m[1] };
}

function suggestCandidates(query) {
  var q = normTitle(query);
  var list = state.notes.slice().sort(function (a, b) {
    return new Date(b.updated_at) - new Date(a.updated_at);
  });
  if (!q) return list.slice(0, 8);
  var lower = query.toLowerCase();
  return list.filter(function (n) {
    var t = n.title || "未命名";
    return normTitle(t).indexOf(q) !== -1 || t.toLowerCase().indexOf(lower) !== -1;
  }).slice(0, 8);
}

function openSuggest() {
  var m = currentLinkPrefix();
  if (!m) { closeSuggest(); return; }
  var items = suggestCandidates(m.query);
  if (items.length === 0) { closeSuggest(); return; }
  suggestMatch = m;
  suggestItems = items;
  suggestActive = 0;
  renderSuggestBox();
  positionSuggestBox();
  suggestBox.hidden = false;
}

export function closeSuggest() {
  suggestBox.hidden = true;
  suggestBox.innerHTML = "";
  suggestMatch = null;
  suggestItems = [];
  suggestActive = -1;
}

function renderSuggestBox() {
  suggestBox.innerHTML = "";
  suggestItems.forEach(function (n, i) {
    var item = document.createElement("div");
    item.className = "link-suggest-item" + (i === suggestActive ? " active" : "");
    item.textContent = n.title || "未命名";
    item.addEventListener("mousedown", function (e) {
      e.preventDefault(); // keep focus in the textarea
      insertSuggestion(n);
    });
    suggestBox.appendChild(item);
  });
  var activeEl = suggestBox.children[suggestActive];
  if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
}

// caret pixel position via a hidden "mirror" of the textarea
function caretCoordinates() {
  var ta = noteContent;
  var cs = getComputedStyle(ta);
  var div = document.createElement("div");
  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";
  [
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing",
    "lineHeight", "paddingLeft", "paddingRight", "paddingTop", "paddingBottom",
    "borderLeftWidth", "borderRightWidth", "borderTopWidth", "borderBottomWidth",
    "textIndent",
  ].forEach(function (p) { div.style[p] = cs[p]; });
  div.style.width = ta.clientWidth + "px";
  div.textContent = ta.value.substring(0, ta.selectionStart);
  var span = document.createElement("span");
  span.textContent = div.textContent.length ? "​" : ".";
  div.appendChild(span);
  document.body.appendChild(div);
  var coords = {
    top: span.offsetTop - ta.scrollTop,
    left: span.offsetLeft - ta.scrollLeft,
  };
  document.body.removeChild(div);
  return coords;
}

function positionSuggestBox() {
  var coords = caretCoordinates();
  var rect = noteContent.getBoundingClientRect();
  var fontSize = parseFloat(getComputedStyle(noteContent).fontSize) || 14;
  var x = rect.left + coords.left;
  var y = rect.top + coords.top + fontSize * 1.4;
  if (x + 200 > window.innerWidth) x = window.innerWidth - 220;
  suggestBox.style.left = Math.max(8, x) + "px";
  suggestBox.style.top = Math.max(8, y) + "px";
}

function insertSuggestion(n) {
  var m = suggestMatch || currentLinkPrefix();
  if (!m) return;
  var val = noteContent.value;
  var pos = noteContent.selectionStart;
  var title = n.title || "未命名";
  noteContent.value = val.slice(0, m.start) + "[[" + title + "]]" + val.slice(pos);
  var caret = m.start + 2 + title.length + 2;
  noteContent.setSelectionRange(caret, caret);
  closeSuggest();
  noteContent.focus();
  noteContent.dispatchEvent(new Event("input")); // triggers autosave
}

// ── init ──────────────────────────────────────────────────────
export function initAutocomplete() {
  noteContent.addEventListener("input", openSuggest);
  noteContent.addEventListener("keydown", function (e) {
    if (suggestBox.hidden) return;
    var key = e.key;
    if (key === "ArrowDown") {
      e.preventDefault();
      suggestActive = (suggestActive + 1) % suggestItems.length;
      renderSuggestBox();
    } else if (key === "ArrowUp") {
      e.preventDefault();
      suggestActive = (suggestActive - 1 + suggestItems.length) % suggestItems.length;
      renderSuggestBox();
    } else if (key === "Enter" || key === "Tab") {
      e.preventDefault();
      if (suggestItems[suggestActive]) insertSuggestion(suggestItems[suggestActive]);
    } else if (key === "Escape") {
      e.preventDefault();
      closeSuggest();
    }
  });
  noteContent.addEventListener("blur", function () {
    setTimeout(closeSuggest, 120); // let item mousedown fire first
  });
  noteContent.addEventListener("scroll", closeSuggest);
}
