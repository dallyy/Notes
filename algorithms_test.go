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

func TestRewriteWikiLinks(t *testing.T) {
	out, changed := RewriteWikiLinks("见 [[旧标题#节|别名]] 与 [[旧标题]]", NormTitle("旧标题"), "新标题")
	if !changed || !strings.Contains(out, "[[新标题#节|别名]]") || !strings.Contains(out, "[[新标题]]") {
		t.Fatalf("RewriteWikiLinks = %q, %v", out, changed)
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
