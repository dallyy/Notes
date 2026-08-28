package main

import (
	"container/heap"
	"math"
	"sort"
)

// KDItem KD 树条目：向量 + 任意负载（鸭子类型：任何值都可作为负载）。
type KDItem struct {
	Vec     []float64
	Payload any
}

type kdNode struct {
	idx   int
	axis  int
	left  *kdNode
	right *kdNode
}

// KDTree 高维 K-D 树。
type KDTree struct {
	items []KDItem
	k     int
	root  *kdNode
}

// NewKDTree 构建 K-D 树（构造时注入条目）。
func NewKDTree(items []KDItem) *KDTree {
	t := &KDTree{items: items}
	if len(items) > 0 {
		t.k = len(items[0].Vec)
		idx := make([]int, len(items))
		for i := range idx {
			idx[i] = i
		}
		t.root = t.build(idx, 0)
	}
	return t
}

func (t *KDTree) build(idx []int, depth int) *kdNode {
	if len(idx) == 0 {
		return nil
	}
	axis := depth % t.k
	sort.Slice(idx, func(a, b int) bool {
		return t.items[idx[a]].Vec[axis] < t.items[idx[b]].Vec[axis]
	})
	mid := len(idx) / 2
	node := &kdNode{idx: idx[mid], axis: axis}
	node.left = t.build(idx[:mid], depth+1)
	node.right = t.build(idx[mid+1:], depth+1)
	return node
}

type kdHeap []kdDist

type kdDist struct {
	d2  float64
	idx int
}

func (h kdHeap) Len() int           { return len(h) }
func (h kdHeap) Less(i, j int) bool { return h[i].d2 > h[j].d2 } // 最大堆
func (h kdHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *kdHeap) Push(x any)        { *h = append(*h, x.(kdDist)) }
func (h *kdHeap) Pop() any          { old := *h; n := len(old); x := old[n-1]; *h = old[:n-1]; return x }

// Nearest 返回距离 query 最近的 k 个条目（按距离升序）。
func (t *KDTree) Nearest(query []float64, k int) []KDItem {
	if t.root == nil || k <= 0 {
		return nil
	}
	if k > len(t.items) {
		k = len(t.items)
	}
	h := &kdHeap{}
	heap.Init(h)
	t.nearest(t.root, query, k, h)
	out := make([]KDItem, 0, h.Len())
	for h.Len() > 0 {
		x := heap.Pop(h).(kdDist)
		out = append(out, t.items[x.idx])
	}
	// 逆序（最大堆 pop 出来是从远到近）
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}

func (t *KDTree) nearest(node *kdNode, query []float64, k int, h *kdHeap) {
	if node == nil {
		return
	}
	vec := t.items[node.idx].Vec
	d2 := dist2(vec, query)
	if h.Len() < k {
		heap.Push(h, kdDist{d2, node.idx})
	} else if d2 < (*h)[0].d2 {
		heap.Pop(h)
		heap.Push(h, kdDist{d2, node.idx})
	}

	diff := query[node.axis] - vec[node.axis]
	near, far := node.left, node.right
	if diff < 0 {
		near, far = node.left, node.right
	} else {
		near, far = node.right, node.left
	}
	t.nearest(near, query, k, h)
	if h.Len() < k || diff*diff < (*h)[0].d2 {
		t.nearest(far, query, k, h)
	}
}

func dist2(a, b []float64) float64 {
	sum := 0.0
	for i := range a {
		d := a[i] - b[i]
		sum += d * d
	}
	return sum
}

// Euclidean 辅助：平方距离开根号。
func Euclidean(d2 float64) float64 { return math.Sqrt(d2) }
