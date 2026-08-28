import { findNoteByTitle, escapeHtml, parseWikiLink } from "./utils.js";
// marked / katex 是 vendor 里的 classic-script 全局变量。
export const renderMarkdown = (text) => {
    const blocks = [];
    // 保护代码：代码块里的 [[...]] / $...$ 不参与渲染
    text = text.replace(/(```[\s\S]*?```|`[^`]*`)/g, (m) => {
        blocks.push(m);
        return `\x00CODE${blocks.length - 1}\x00`;
    });
    // 双链 [[标题]] / [[标题|别名]] / [[标题#小节]]
    text = text.replace(/\[\[([^\]]+)\]\]/g, (_, raw) => {
        const link = parseWikiLink(raw);
        if (!link.title)
            return _;
        const note = findNoteByTitle(link.title);
        const label = link.alias || link.title;
        const cls = note ? "note-link" : "note-link note-link--unresolved";
        const attrs = note
            ? ` data-note="${note.id}"`
            : ` data-title="${escapeHtml(link.title)}"`;
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
