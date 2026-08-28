package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
)

// Embedder 计算文本向量（鸭子类型接口）。
type Embedder interface {
	Embed(ctx context.Context, texts []string) ([][]float64, error)
}

// Chatter 对话补全（鸭子类型接口）。
type Chatter interface {
	Chat(ctx context.Context, messages []ChatMessage, enableThinking bool) (string, string, error)
}

// Asker 高层问答接口，Server 只依赖它。
type Asker interface {
	Ask(ctx context.Context, notes []Note, question string, history []ChatMessage) (ChatAnswer, error)
}

// DashScopeClient OpenAI 兼容客户端。HTTP 客户端通过构造函数注入。
type DashScopeClient struct {
	cfg    AIConfig
	client *http.Client
}

func NewDashScopeClient(cfg AIConfig, client *http.Client) *DashScopeClient {
	if client == nil {
		client = &http.Client{Timeout: cfg.Timeout}
	}
	return &DashScopeClient{cfg: cfg, client: client}
}

func (c *DashScopeClient) postJSON(ctx context.Context, path string, payload any) (map[string]any, error) {
	b, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(c.cfg.BaseURL, "/")+path, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("无法连接 AI 接口: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("AI 接口返回 %d: %s", resp.StatusCode, truncate(string(body), 500))
	}
	var out map[string]any
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("AI 接口响应不是 JSON: %s", truncate(string(body), 300))
	}
	return out, nil
}

// Embed 实现 Embedder 接口。
func (c *DashScopeClient) Embed(ctx context.Context, texts []string) ([][]float64, error) {
	if c.cfg.APIKey == "" {
		return nil, errors.New("未配置 DASHSCOPE_API_KEY（或 data/ai_config.json）")
	}
	if len(texts) == 0 {
		return nil, nil
	}
	resp, err := c.postJSON(ctx, "/embeddings", map[string]any{
		"model": c.cfg.EmbeddingModel,
		"input": texts,
	})
	if err != nil {
		return nil, err
	}
	if data, ok := resp["data"].([]any); ok {
		sort.Slice(data, func(i, j int) bool {
			mi, _ := data[i].(map[string]any)["index"].(float64)
			mj, _ := data[j].(map[string]any)["index"].(float64)
			return mi < mj
		})
		out := make([][]float64, 0, len(data))
		for _, d := range data {
			if m, ok := d.(map[string]any); ok {
				if vec := toVec(m["embedding"]); vec != nil {
					out = append(out, vec)
				}
			}
		}
		if len(out) == len(texts) {
			return out, nil
		}
	}
	return nil, fmt.Errorf("embedding 响应格式异常: %s", truncate(fmt.Sprint(resp), 300))
}

// Chat 实现 Chatter 接口。
func (c *DashScopeClient) Chat(ctx context.Context, messages []ChatMessage, enableThinking bool) (string, string, error) {
	msgs := []map[string]any{{"role": "system", "content": "你是笔记知识助手。优先依据提供的笔记内容回答；若笔记无相关信息，可结合常识并说明。使用中文回答。"}}
	for _, m := range messages {
		if m.Role == "user" || m.Role == "assistant" {
			msgs = append(msgs, map[string]any{"role": m.Role, "content": m.Content})
		}
	}
	resp, err := c.postJSON(ctx, "/chat/completions", map[string]any{
		"model":           c.cfg.ChatModel,
		"messages":        msgs,
		"enable_thinking": enableThinking,
		"stream":          false,
	})
	if err != nil {
		return "", "", err
	}
	choices, _ := resp["choices"].([]any)
	if len(choices) == 0 {
		return "", "", fmt.Errorf("对话接口响应异常: %s", truncate(fmt.Sprint(resp), 300))
	}
	msg, _ := choices[0].(map[string]any)["message"].(map[string]any)
	content, _ := msg["content"].(string)
	reasoning, _ := msg["reasoning_content"].(string)
	if content == "" && reasoning != "" {
		content = reasoning
	}
	return content, reasoning, nil
}

func toVec(v any) []float64 {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]float64, len(arr))
	for i, x := range arr {
		f, ok := x.(float64)
		if !ok {
			return nil
		}
		out[i] = f
	}
	return out
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// EmbeddingIndex 标题向量缓存 + KD 树。依赖通过构造函数注入。
type EmbeddingIndex struct {
	cfg       AIConfig
	embedder  Embedder
	cachePath string
	mu        sync.Mutex
}

func NewEmbeddingIndex(cfg AIConfig, embedder Embedder, cachePath string) *EmbeddingIndex {
	return &EmbeddingIndex{cfg: cfg, embedder: embedder, cachePath: cachePath}
}

func (ix *EmbeddingIndex) loadCache() map[string]struct {
	Title  string    `json:"title"`
	Vector []float64 `json:"vector"`
} {
	out := map[string]struct {
		Title  string    `json:"title"`
		Vector []float64 `json:"vector"`
	}{}
	b, err := os.ReadFile(ix.cachePath)
	if err == nil {
		_ = json.Unmarshal(b, &out)
	}
	return out
}

func (ix *EmbeddingIndex) saveCache(cache map[string]struct {
	Title  string    `json:"title"`
	Vector []float64 `json:"vector"`
}) {
	b, _ := json.Marshal(cache)
	_ = atomicWriteFile(ix.cachePath, b)
}

// Sync 增量更新嵌入缓存并构建 KDTree。
func (ix *EmbeddingIndex) Sync(ctx context.Context, notes []Note) (*KDTree, error) {
	ix.mu.Lock()
	defer ix.mu.Unlock()

	cache := ix.loadCache()
	valid := map[string]bool{}
	for _, n := range notes {
		valid[n.ID] = true
	}
	for id := range cache {
		if !valid[id] {
			delete(cache, id)
		}
	}
	var need []Note
	for _, n := range notes {
		c, ok := cache[n.ID]
		if !ok || c.Title != n.Title {
			need = append(need, n)
		}
	}
	if len(need) > 0 {
		titles := make([]string, len(need))
		for i, n := range need {
			titles[i] = n.Title
		}
		vecs, err := ix.embedder.Embed(ctx, titles)
		if err != nil {
			return nil, err
		}
		for i, n := range need {
			cache[n.ID] = struct {
				Title  string    `json:"title"`
				Vector []float64 `json:"vector"`
			}{Title: n.Title, Vector: vecs[i]}
		}
		ix.saveCache(cache)
	}
	items := make([]KDItem, 0, len(notes))
	for _, n := range notes {
		if c, ok := cache[n.ID]; ok && len(c.Vector) > 0 {
			items = append(items, KDItem{Vec: c.Vector, Payload: n})
		}
	}
	return NewKDTree(items), nil
}

// AIService 检索增强问答：嵌入 → KDTree → 图谱连通块 → 上下文文档 → 对话。
type AIService struct {
	cfg         AIConfig
	embedder    Embedder
	chatter     Chatter
	index       *EmbeddingIndex
	contextPath string
	mu          sync.Mutex
}

func NewAIService(cfg AIConfig, embedder Embedder, chatter Chatter, index *EmbeddingIndex, contextPath string) *AIService {
	return &AIService{cfg: cfg, embedder: embedder, chatter: chatter, index: index, contextPath: contextPath}
}

// Ask 实现 Asker 接口。
func (s *AIService) Ask(ctx context.Context, notes []Note, question string, history []ChatMessage) (ChatAnswer, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	question = strings.TrimSpace(question)
	if question == "" {
		return ChatAnswer{}, errors.New("问题不能为空")
	}
	if len(notes) == 0 {
		return ChatAnswer{}, errors.New("笔记为空，无法检索")
	}
	tree, err := s.index.Sync(ctx, notes)
	if err != nil {
		return ChatAnswer{}, err
	}
	if tree == nil || len(tree.items) == 0 {
		return ChatAnswer{}, errors.New("嵌入索引为空，请先确认 embedding 配置可用")
	}
	qVec, err := s.embedder.Embed(ctx, []string{question})
	if err != nil {
		return ChatAnswer{}, err
	}
	k := s.cfg.TopK
	if k < 1 {
		k = 1
	}
	nearest := tree.Nearest(qVec[0], k)
	seed, _ := nearest[0].Payload.(Note)

	graph := BuildWikiGraph(notes)
	compNotes := graph.Component(seed.ID)
	titles := make([]string, len(compNotes))
	for i, n := range compNotes {
		titles[i] = n.Title
	}
	contextDoc := BuildContextDoc(question, compNotes)
	_ = atomicWriteFile(s.contextPath, mustJSON(map[string]any{
		"question":      question,
		"matched_title": seed.Title,
		"title_tuple":   titles,
		"context":       contextDoc,
	}))

	msg := ChatMessage{Role: "user", Content: contextDoc}
	messages := append(append([]ChatMessage{}, history...), msg)
	answer, reasoning, err := s.chatter.Chat(ctx, messages, s.cfg.EnableThinking)
	if err != nil {
		return ChatAnswer{}, err
	}
	return ChatAnswer{
		Answer:       answer,
		Reasoning:    reasoning,
		MatchedTitle: seed.Title,
		Titles:       titles,
		Context:      contextDoc,
	}, nil
}

// BuildContextDoc 把问题与连通块笔记拼成上下文文档（独立算法，便于复用/测试）。
func BuildContextDoc(question string, notes []Note) string {
	var b strings.Builder
	b.WriteString("# 用户问题\n")
	b.WriteString(question)
	b.WriteString("\n\n# 相关笔记")
	for i, n := range notes {
		fmt.Fprintf(&b, "\n\n## 笔记%d：%s\n", i+1, n.Title)
		b.WriteString(strings.TrimSpace(n.Content))
	}
	return b.String()
}

func mustJSON(v any) []byte {
	b, _ := json.MarshalIndent(v, "", "  ")
	return b
}
