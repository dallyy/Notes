package main

import "strings"

// WikiLink 双链解析结果：@id 为 ID 锚定；Title 为旧式标题锚定（兼容）。
type WikiLink struct {
ID      string // [[@id...]]
Title   string // 旧式 [[Title...]]
Section string // #小节
Alias   string // |别名
}

// ParseWikiLinks 解析文本中的 [[...]] 双链。
// 新格式：[[@note-id#小节|别名]]；旧格式：[[标题#小节|别名]]（向后兼容）。
func ParseWikiLinks(text string) []WikiLink {
matches := wikiLinkRe.FindAllStringSubmatch(text, -1)
out := make([]WikiLink, 0, len(matches))
for _, m := range matches {
if link, ok := parseWikiLink(m[1]); ok {
out = append(out, link)
}
}
return out
}

func parseWikiLink(raw string) (WikiLink, bool) {
inner := strings.TrimSpace(raw)
if inner == "" {
return WikiLink{}, false
}
target, alias := inner, ""
if i := strings.IndexByte(inner, '|'); i >= 0 {
target, alias = strings.TrimSpace(inner[:i]), strings.TrimSpace(inner[i+1:])
}
head, section := target, ""
if i := strings.IndexByte(target, '#'); i >= 0 {
head, section = strings.TrimSpace(target[:i]), strings.TrimSpace(target[i+1:])
}
if strings.HasPrefix(head, "@") && len(head) > 1 {
return WikiLink{ID: head[1:], Section: section, Alias: alias}, true
}
if head != "" {
return WikiLink{Title: head, Section: section, Alias: alias}, true
}
return WikiLink{}, false
}
