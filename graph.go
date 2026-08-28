package main

import "sort"

// WikiGraph 由笔记双链构建的无向知识图谱。
type WikiGraph struct {
	adj  map[string][]string
	byID map[string]Note
}

// BuildWikiGraph 构造知识图谱（注入全部笔记）。
func BuildWikiGraph(notes []Note) *WikiGraph {
	g := &WikiGraph{adj: map[string][]string{}, byID: map[string]Note{}}
	for _, n := range notes {
		g.byID[n.ID] = n
		g.adj[n.ID] = []string{}
	}
	for _, n := range notes {
		for _, ref := range ParseWikiLinks(n.Content) {
			if target, ok := FindNoteByTitle(notes, ref); ok && target.ID != n.ID {
				g.adj[n.ID] = appendUnique(g.adj[n.ID], target.ID)
				g.adj[target.ID] = appendUnique(g.adj[target.ID], n.ID)
			}
		}
	}
	return g
}

// Component 返回 seed 所在连通块的全部笔记（按 updated_at 降序）。
func (g *WikiGraph) Component(seedID string) []Note {
	seen := map[string]bool{}
	stack := []string{seedID}
	for len(stack) > 0 {
		cur := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if seen[cur] {
			continue
		}
		seen[cur] = true
		stack = append(stack, g.adj[cur]...)
	}
	out := make([]Note, 0, len(seen))
	for id := range seen {
		if n, ok := g.byID[id]; ok {
			out = append(out, n)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt > out[j].UpdatedAt })
	return out
}

func appendUnique(xs []string, x string) []string {
	for _, v := range xs {
		if v == x {
			return xs
		}
	}
	return append(xs, x)
}
