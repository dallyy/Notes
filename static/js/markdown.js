// ═══════════════════════════════════════════════════════════════
// Notes App — Markdown rendering (marked + KaTeX + wiki links)
// marked / katex are classic-script globals loaded from local vendor files.
// ═══════════════════════════════════════════════════════════════

import { findNoteByTitle, escapeHtml, parseWikiLink } from "./utils.js";

// ── markdown rendering ───────────────────────────────────────
export function renderMarkdown(text) {
  var blocks = [];

  // protect code so [[...]] / $..$ inside code blocks are left alone
  text = text.replace(/(```[\s\S]*?```|`[^`]*`)/g, function (m) {
    blocks.push(m);
    return "\x00CODE" + (blocks.length - 1) + "\x00";
  });

  // wiki links [[Title]] / [[Title|alias]] — link to matching note
  text = text.replace(/\[\[([^\]]+)\]\]/g, function (_, raw) {
    var link = parseWikiLink(raw);
    if (!link.title) return _;
    var note = findNoteByTitle(link.title);
    var label = link.alias || link.title;
    var cls = note ? "note-link" : "note-link note-link--unresolved";
    var attrs = note
      ? ' data-note="' + note.id + '"'
      : ' data-title="' + escapeHtml(link.title) + '"';
    return '<a class="' + cls + '" href="#"' + attrs + ">" +
      escapeHtml(label) + "</a>";
  });

  if (typeof katex !== "undefined") {
    var stashMath = function (math, display) {
      blocks.push({ math: math.trim(), display: display });
      return "\x00MATH" + (blocks.length - 1) + "\x00";
    };

    // display math $$...$$ and \[...\]
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, function (_, math) {
      return stashMath(math, true);
    });
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, function (_, math) {
      return stashMath(math, true);
    });

    // inline math $...$ and \(...\)
    text = text.replace(/\$([^\$\n]+?)\$/g, function (_, math) {
      return stashMath(math, false);
    });
    text = text.replace(/\\\(([^\n]*?)\\\)/g, function (_, math) {
      return stashMath(math, false);
    });
  }

  var html = marked.parse(text);

  html = html.replace(/\x00(CODE|MATH)(\d+)\x00/g, function (_, type, i) {
    var item = blocks[parseInt(i)];
    if (type === "CODE") return item;
    try {
      return katex.renderToString(item.math, {
        displayMode: item.display,
        throwOnError: false,
      });
    } catch (e) {
      return "<code>" + item.math + "</code>";
    }
  });

  return html;
}
