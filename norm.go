package main

import "strings"

// NormTitle 标题归一化：仅保留 [0-9A-Za-z一-鿿]，ASCII 小写。
func NormTitle(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range strings.ToLower(s) {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 0x4E00 && r <= 0x9FFF) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// FindNoteByTitle 标题匹配：精确优先，其次互含最短。
func FindNoteByTitle(notes []Note, title string) (Note, bool) {
	t := NormTitle(title)
	if t == "" {
		return Note{}, false
	}
	var best Note
	bestNorm := ""
	for _, n := range notes {
		nt := NormTitle(n.Title)
		if nt == t {
			return n, true
		}
		if strings.Contains(nt, t) || strings.Contains(t, nt) {
			if bestNorm == "" || len(nt) < len(bestNorm) {
				best, bestNorm = n, nt
			}
		}
	}
	return best, bestNorm != ""
}
