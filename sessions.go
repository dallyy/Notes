package main

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ChatSession 一次持久化 AI 会话。
type ChatSession struct {
	ID        string        `json:"id"`
	Title     string        `json:"title"`
	Messages  []ChatMessage `json:"messages"`
	CreatedAt string        `json:"created_at"`
	UpdatedAt string        `json:"updated_at"`
}

// ChatSessionStore 会话存储（鸭子类型接口）。
type ChatSessionStore interface {
	LoadSessions() ([]ChatSession, error)
	SaveSessions([]ChatSession) error
}

// JSONChatSessionStore 会话 JSON 文件存储。
type JSONChatSessionStore struct{ path string }

func NewJSONChatSessionStore(baseDir string) *JSONChatSessionStore {
	return &JSONChatSessionStore{path: filepath.Join(baseDir, "data", "chat_sessions.json")}
}

func (s *JSONChatSessionStore) LoadSessions() ([]ChatSession, error) {
	sessions := []ChatSession{}
	if err := readJSONFile(s.path, &sessions); err != nil {
		if os.IsNotExist(err) {
			return sessions, nil
		}
		return sessions, err
	}
	return sessions, nil
}

func (s *JSONChatSessionStore) SaveSessions(sessions []ChatSession) error {
	return writeJSONFile(s.path, sessions)
}

// sessionTitle 由首条用户消息生成标题（截断 40 字符）。
func sessionTitle(q string) string {
	t := strings.TrimSpace(q)
	if i := strings.IndexByte(t, '\n'); i >= 0 {
		t = strings.TrimSpace(t[:i])
	}
	if len([]rune(t)) > 40 {
		r := []rune(t)
		t = string(r[:40]) + "…"
	}
	if t == "" {
		t = "新对话"
	}
	return t
}

// sortSessions 按 updated_at 降序。
func sortSessions(sessions []ChatSession) {
	sort.Slice(sessions, func(i, j int) bool { return sessions[i].UpdatedAt > sessions[j].UpdatedAt })
}

// filterSessions 按关键字检索会话（标题或消息内容）。
func filterSessions(sessions []ChatSession, q string) []ChatSession {
	q = strings.TrimSpace(q)
	if q == "" {
		return sessions
	}
	lower := strings.ToLower(q)
	out := make([]ChatSession, 0)
	for _, s := range sessions {
		if strings.Contains(strings.ToLower(s.Title), lower) {
			out = append(out, s)
			continue
		}
		hit := false
		for _, m := range s.Messages {
			if strings.Contains(strings.ToLower(m.Content), lower) {
				hit = true
				break
			}
		}
		if hit {
			out = append(out, s)
		}
	}
	return out
}
