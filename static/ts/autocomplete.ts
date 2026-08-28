import { state } from "./state.js";
import { $, el } from "./dom.js";
import { normTitle } from "./utils.js";

const noteContent = $("#noteContent");

const suggestBox = el("div", { class: "link-suggest", hidden: true });
document.body.appendChild(suggestBox);

let suggestItems = [];
let suggestActive = -1;
let suggestMatch = null;

const insideFencedCode = () => {
  const before = noteContent.value.slice(0, noteContent.selectionStart);
  return before.split("```").length % 2 === 0;   // 奇数个围栏 → 在代码块内
};

// 光标前未闭合的 [[query
const currentLinkPrefix = () => {
  const val = noteContent.value;
  const pos = noteContent.selectionStart;
  if (typeof pos !== "number") return null;
  const m = /\[\[([^\[\]\n]*)$/.exec(val.slice(0, pos));
  return m && !insideFencedCode() ? { start: m.index, query: m[1] } : null;
};

const suggestCandidates = (query) => {
  const q = normTitle(query);
  const list = [...state.notes].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  if (!q) return list.slice(0, 8);
  const lower = query.toLowerCase();
  return list.filter((n) => {
    const t = n.title || "未命名";
    return normTitle(t).includes(q) || t.toLowerCase().includes(lower);
  }).slice(0, 8);
};

const openSuggest = () => {
  const m = currentLinkPrefix();
  const items = m ? suggestCandidates(m.query) : [];
  if (!m || items.length === 0) return closeSuggest();
  suggestMatch = m;
  suggestItems = items;
  suggestActive = 0;
  renderSuggestBox();
  positionSuggestBox();
  suggestBox.hidden = false;
};

export const closeSuggest = () => {
  suggestBox.hidden = true;
  suggestBox.innerHTML = "";
  suggestMatch = null;
  suggestItems = [];
  suggestActive = -1;
};

const renderSuggestBox = () => {
  suggestBox.innerHTML = "";
  suggestItems.forEach((n, i) => {
    const item = el("div", {
      class: `link-suggest-item${i === suggestActive ? " active" : ""}`,
      onMousedown: (e) => { e.preventDefault(); insertSuggestion(n); },
    }, n.title || "未命名");
    suggestBox.appendChild(item);
  });
  suggestBox.children[suggestActive]?.scrollIntoView({ block: "nearest" });
};

// 用隐藏 mirror 计算 textarea 中的光标像素坐标
const caretCoordinates = () => {
  const ta = noteContent;
  const cs = getComputedStyle(ta);
  const div = el("div", {
    style: {
      position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap",
      wordWrap: "break-word", width: `${ta.clientWidth}px`,
    },
  });
  ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing",
    "lineHeight", "paddingLeft", "paddingRight", "paddingTop", "paddingBottom",
    "borderLeftWidth", "borderRightWidth", "borderTopWidth", "borderBottomWidth",
    "textIndent"].forEach((p) => div.style[p] = cs[p]);
  div.textContent = ta.value.substring(0, ta.selectionStart);
  const span = el("span", {}, div.textContent.length ? "\u200b" : ".");
  div.appendChild(span);
  document.body.appendChild(div);
  const coords = {
    top: span.offsetTop - ta.scrollTop,
    left: span.offsetLeft - ta.scrollLeft,
  };
  div.remove();
  return coords;
};

const positionSuggestBox = () => {
  const coords = caretCoordinates();
  const rect = noteContent.getBoundingClientRect();
  const fontSize = parseFloat(getComputedStyle(noteContent).fontSize) || 14;
  const x = rect.left + coords.left;
  const y = rect.top + coords.top + fontSize * 1.4;
  suggestBox.style.left = `${Math.max(8, x + 200 > window.innerWidth ? window.innerWidth - 220 : x)}px`;
  suggestBox.style.top = `${Math.max(8, y)}px`;
};

const insertSuggestion = (n) => {
  const m = suggestMatch || currentLinkPrefix();
  if (!m) return;
  const val = noteContent.value;
  const pos = noteContent.selectionStart;
  const title = n.title || "未命名";
  noteContent.value = `${val.slice(0, m.start)}[[${title}]]${val.slice(pos)}`;
  const caret = m.start + title.length + 4;     // m.start + "[[" + title + "]]"
  noteContent.setSelectionRange(caret, caret);
  closeSuggest();
  noteContent.focus();
  noteContent.dispatchEvent(new Event("input")); // 触发自动保存
};

// ── 初始化 ────────────────────────────────────────────────────
export const initAutocomplete = () => {
  noteContent.addEventListener("input", openSuggest);
  noteContent.addEventListener("keydown", (e) => {
    if (suggestBox.hidden) return;
    const { key } = e;
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
  noteContent.addEventListener("blur", () => setTimeout(closeSuggest, 120));
  noteContent.addEventListener("scroll", closeSuggest);
};
