package main

import "strings"

// ParseWikiLinks 提取 [[标题#节|别名]] 中的标题。
func ParseWikiLinks(text string) []string {
	var out []string
	for _, m := range wikiLinkRe.FindAllStringSubmatch(text, -1) {
		t := m[1]
		if i := strings.IndexByte(t, '#'); i >= 0 {
			t = t[:i]
		}
		if i := strings.IndexByte(t, '|'); i >= 0 {
			t = t[:i]
		}
		if t = strings.TrimSpace(t); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// RewriteWikiLinks 把 [[旧标题#节|别名]] 改写为新标题，跳过代码块/行内代码。
func RewriteWikiLinks(text, normOld, newTitle string) (string, bool) {
	var b strings.Builder
	b.Grow(len(text) + 32)
	changed := false
	inFence, inCode := false, false

	for pos := 0; pos < len(text); {
		ch := text[pos]
		if ch == '`' {
			end := pos
			for end < len(text) && text[end] == '`' {
				end++
			}
			run := end - pos
			if run == 1 {
				inCode = !inCode
			} else if run >= 3 {
				inFence = !inFence
			}
			b.WriteString(text[pos:end])
			pos = end
			continue
		}
		if ch == '[' && !inFence && !inCode && strings.HasPrefix(text[pos:], "[[") {
			closeIdx := strings.Index(text[pos+2:], "]]")
			if closeIdx >= 0 {
				closeAbs := pos + 2 + closeIdx
				inner := text[pos+2 : closeAbs]
				titlePart, alias := inner, ""
				if i := strings.IndexByte(inner, '|'); i >= 0 {
					titlePart, alias = inner[:i], inner[i+1:]
				}
				base := titlePart
				if i := strings.IndexByte(titlePart, '#'); i >= 0 {
					base = titlePart[:i]
				}
				if base != "" && NormTitle(base) == normOld {
					suffix := ""
					if i := strings.IndexByte(titlePart, '#'); i >= 0 {
						suffix = titlePart[i:]
					}
					b.WriteString("[[" + newTitle + suffix)
					if strings.Contains(inner, "|") {
						b.WriteString("|" + alias)
					}
					b.WriteString("]]")
					pos = closeAbs + 2
					changed = true
					continue
				}
			}
		}
		b.WriteByte(ch)
		pos++
	}
	return b.String(), changed
}
