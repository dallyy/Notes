package main

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
)

// handler 是返回 error 的处理器；中间件（高阶函数）可像装饰器一样包装它。
type handler func(w http.ResponseWriter, r *http.Request) error

// middleware 即 handler 装饰器。
type middleware func(handler) handler

// Server 聚合全部依赖。依赖通过 Deps 构造函数注入。
type Server struct {
	baseDir  string
	notes    NoteStore
	settings SettingsStore
	folders  FolderStore
	sessions ChatSessionStore
	asker    Asker
	mu       sync.Mutex
	chatMu   sync.Mutex
	mux      *http.ServeMux
}

// Deps 依赖集合（鸭子类型接口，便于替换实现）。
type Deps struct {
	BaseDir  string
	Notes    NoteStore
	Settings SettingsStore
	Folders  FolderStore
	Sessions ChatSessionStore
	Asker    Asker
}

// NewServer 构造函数注入依赖并注册路由。
func NewServer(deps Deps) *Server {
	s := &Server{
		baseDir:  deps.BaseDir,
		notes:    deps.Notes,
		settings: deps.Settings,
		folders:  deps.Folders,
		sessions: deps.Sessions,
		asker:    deps.Asker,
		mux:      http.NewServeMux(),
	}
	s.routes()
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.mux.ServeHTTP(w, r) }

// handle 注册路由，并用装饰器（中间件）包装处理器。
func (s *Server) handle(pattern string, h handler, mw ...middleware) {
	for i := len(mw) - 1; i >= 0; i-- {
		h = mw[i](h)
	}
	s.mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		if err := h(w, r); err != nil {
			status, msg := errStatus(err)
			writeJSON(w, status, map[string]string{"detail": msg})
		}
	})
}

// locked 数据端点串行化装饰器（等价旧版 data_mutex）。
func (s *Server) locked(h handler) handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		s.mu.Lock()
		defer s.mu.Unlock()
		return h(w, r)
	}
}

func (s *Server) routes() {
	staticFS := http.StripPrefix("/static/", http.FileServer(http.Dir(filepath.Join(s.baseDir, "static"))))
	uploadsFS := http.StripPrefix("/uploads/", http.FileServer(http.Dir(filepath.Join(s.baseDir, "uploads"))))
	s.mux.Handle("GET /static/", noCache(staticFS))
	s.mux.Handle("GET /uploads/", noCache(uploadsFS))

	s.mux.HandleFunc("GET /{$}", s.wrapPage(filepath.Join(s.baseDir, "templates", "index.html")))
	s.mux.HandleFunc("GET /chat", s.wrapPage(filepath.Join(s.baseDir, "templates", "chat.html")))

	s.handle("GET /api/notes", s.handleListNotes, s.locked)
	s.handle("POST /api/notes", s.handleCreateNote, s.locked)
	s.handle("PUT /api/notes/{id}", s.handleUpdateNote, s.locked)
	s.handle("DELETE /api/notes/{id}", s.handleDeleteNote, s.locked)
	s.handle("GET /api/folders", s.handleGetFolders, s.locked)
	s.handle("PUT /api/folders", s.handlePutFolders, s.locked)
	s.handle("GET /api/settings", s.handleGetSettings, s.locked)
	s.handle("PUT /api/settings", s.handlePutSettings, s.locked)
	s.handle("POST /api/upload-background", s.handleUploadBackground, s.locked)
	s.handle("DELETE /api/background", s.handleDeleteBackground, s.locked)
	s.handle("GET /api/chat/sessions", s.handleListSessions, s.locked)
	s.handle("POST /api/chat/sessions", s.handleCreateSession, s.locked)
	s.handle("GET /api/chat/sessions/{id}", s.handleGetSession, s.locked)
	s.handle("DELETE /api/chat/sessions/{id}", s.handleDeleteSession, s.locked)
	s.handle("POST /api/chat", s.handleChat) // AI 网络调用不持数据锁

	// API 404 统一返回 JSON
	s.mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Not found"})
	})
}

func (s *Server) wrapPage(path string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		b, err := os.ReadFile(path)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Not found"})
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(b)
	}
}

func noCache(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		h.ServeHTTP(w, r)
	})
}

// Run 启动服务（仅绑定本机）。
func (s *Server) Run(addr string) error {
	_ = os.MkdirAll(filepath.Join(s.baseDir, "data"), 0o755)
	_ = os.MkdirAll(filepath.Join(s.baseDir, "uploads"), 0o755)
	fmt.Printf("Server running at http://%s\n", addr)
	return http.ListenAndServe(addr, s)
}
