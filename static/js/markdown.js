import { findNoteByTitle, findNoteById, escapeHtml, parseWikiLink } from "./utils.js";
// marked / katex 是 vendor 里的 classic-script 全局变量。
export const renderMarkdown = (text) => {
    const blocks = [];
    // 保护代码：代码块里的 [[...]] / $...$ 不参与渲染
    text = text.replace(/(```[\s\S]*?```|`[^`]*`)/g, (m) => {
        blocks.push(m);
        return `\x00CODE${blocks.length - 1}\x00`;
    });
    // 双链：新格式 [[@id#小节|别名]]（ID 锚定），旧格式 [[标题...]] 兼容
    text = text.replace(/\[\[([^\]]+)\]\]/g, (_, raw) => {
        const link = parseWikiLink(raw);
        const note = link.type === "id" ? findNoteById(link.id) : findNoteByTitle(link.title);
        const fallback = link.type === "id" ? link.id : link.title;
        if (!fallback)
            return _;
        const label = link.alias || note?.title || fallback;
        const cls = note ? "note-link" : "note-link note-link--unresolved";
        const attrs = note
            ? ` data-note="${note.id}"`
            : ` data-title="${escapeHtml(fallback)}"`;
        return `<a class="${cls}" href="#"${attrs}>${escapeHtml(label)}</a>`;
    });
    // KaTeX 数学块/行内公式
    if (typeof katex !== "undefined") {
        const stashMath = (math, display) => {
            blocks.push({ math: math.trim(), display });
            return `\x00MATH${blocks.length - 1}\x00`;
        };
        text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => stashMath(math, true));
        text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => stashMath(math, true));
        text = text.replace(/\$([^$\n]+?)\$/g, (_, math) => stashMath(math, false));
        text = text.replace(/\\\(([^\n]*?)\\\)/g, (_, math) => stashMath(math, false));
    }
    let html = marked.parse(text);
    html = html.replace(/\x00(CODE|MATH)(\d+)\x00/g, (_, type, i) => {
        const item = blocks[parseInt(i)];
        if (type === "CODE")
            return item;
        try {
            return katex.renderToString(item.math, {
                displayMode: item.display, throwOnError: false,
            });
        }
        catch {
            return `<code>${item.math}</code>`;
        }
    });
    return html;
};
