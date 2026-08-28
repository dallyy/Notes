package main

import (
	"strings"
	"testing"
)

func TestNormTitle(t *testing.T) {
	if got := NormTitle("图-RAG"); got != "图rag" {
		t.Fatalf("NormTitle = %q", got)
	}
}

func TestParseWikiLinksIDAnchor(t *testing.T) {
	links := ParseWikiLinks("见 [[@abc123#小节|别名]] 与 [[旧标题]]")
	if len(links) != 2 {
		t.Fatalf("links len = %d", len(links))
	}
	if links[0].ID != "abc123" || links[0].Section != "小节" || links[0].Alias != "别名" {
		t.Fatalf("id link = %+v", links[0])
	}
	if links[1].Title != "旧标题" {
		t.Fatalf("legacy link = %+v", links[1])
	}
}

func TestWikiGraphIDAnchor(t *testing.T) {
	notes := []Note{
		{ID: "1", Title: "A", Content: "[[@2]]", UpdatedAt: "2026-01-01T00:00:00.000+00:00"},
		{ID: "2", Title: "B", Content: "[[@1]]", UpdatedAt: "2026-01-02T00:00:00.000+00:00"},
		{ID: "3", Title: "C", Content: "", UpdatedAt: "2026-01-03T00:00:00.000+00:00"},
	}
	comp := BuildWikiGraph(notes).Component("1")
	if len(comp) != 2 {
		t.Fatalf("component size = %d", len(comp))
	}
}

func TestKDTreeNearest(t *testing.T) {
	items := []KDItem{{Vec: []float64{0}, Payload: "a"}, {Vec: []float64{2}, Payload: "b"}, {Vec: []float64{9}, Payload: "c"}}
	tree := NewKDTree(items)
	got := tree.Nearest([]float64{2.1}, 1)
	if got[0].Payload != "b" {
		t.Fatalf("nearest = %v", got[0].Payload)
	}
}

func TestWikiGraphComponent(t *testing.T) {
	notes := []Note{
		{ID: "1", Title: "A", Content: "[[B]]", UpdatedAt: "2026-01-01T00:00:00.000+00:00"},
		{ID: "2", Title: "B", Content: "[[A]]", UpdatedAt: "2026-01-02T00:00:00.000+00:00"},
		{ID: "3", Title: "C", Content: "", UpdatedAt: "2026-01-03T00:00:00.000+00:00"},
	}
	g := BuildWikiGraph(notes)
	comp := g.Component("1")
	if len(comp) != 2 {
		t.Fatalf("component size = %d", len(comp))
	}
}

func TestBuildContextDoc(t *testing.T) {
	doc := BuildContextDoc("问题", []Note{{Title: "标题1", Content: "正文"}})
	if !strings.Contains(doc, "问题") || !strings.Contains(doc, "标题1") || !strings.Contains(doc, "正文") {
		t.Fatalf("context doc missing parts: %s", doc)
	}
}
