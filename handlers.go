package main

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const (
	MaxUploadBytes = 20 << 20 // 20 MiB
	MaxNoteTitle   = 512
	MaxNoteContent = 2 << 20
)

var allowedThemes = map[string]bool{
	"cyan": true, "emerald": true, "violet": true, "rose": true, "amber": true,
}

// ── 笔记 ────────────────────────────────────────────────────────

func (s *Server) handleListNotes(w http.ResponseWriter, _ *http.Request) error {
	notes, err := s.notes.LoadNotes()
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, notes)
	return nil
}

type noteBody struct {
	Title   *string `json:"title"`
	Content *string `json:"content"`
}

func (s *Server) handleCreateNote(w http.ResponseWriter, r *http.Request) error {
	var body noteBody
	if err := readJSON(r, &body); err != nil {
		return httpError(http.StatusBadRequest, "Invalid JSON body")
	}
	title, content := deref(body.Title), deref(body.Content)
	if len(title) > MaxNoteTitle {
		return httpError(http.StatusBadRequest, "Title too long")
	}
	if len(content) > MaxNoteContent {
		return httpError(http.StatusRequestEntityTooLarge, "Content too large")
	}
	notes, _ := s.notes.LoadNotes()
	now := nowISO()
	note := Note{ID: uuidHex(), Title: title, Content: content, CreatedAt: now, UpdatedAt: now}
	notes = append(notes, note)
	if err := s.notes.SaveNotes(notes); err != nil {
		return httpError(http.StatusInternalServerError, "Failed to persist notes")
	}
	writeJSON(w, http.StatusOK, note)
	return nil
}

func (s *Server) handleUpdateNote(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("id")
	var body noteBody
	if err := readJSON(r, &body); err != nil {
		return httpError(http.StatusBadRequest, "Invalid JSON body")
	}
	if body.Title != nil && len(*body.Title) > MaxNoteTitle {
		return httpError(http.StatusBadRequest, "Title too long")
	}
	if body.Content != nil && len(*body.Content) > MaxNoteContent {
		return httpError(http.StatusRequestEntityTooLarge, "Content too large")
	}

	notes, _ := s.notes.LoadNotes()
	idx := -1
	for i, n := range notes {
		if n.ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		return httpError(http.StatusNotFound, "Note not found")
	}
	oldTitle := notes[idx].Title
	if body.Title != nil {
		notes[idx].Title = *body.Title
	}
	if body.Content != nil {
		notes[idx].Content = *body.Content
	}
	notes[idx].UpdatedAt = nowISO()

	applied := notes[idx].Title
	normOld, normNew := NormTitle(oldTitle), NormTitle(applied)
	if normOld != "" && applied != "" && normOld != normNew {
		holders := 0
		for _, n := range notes {
			if NormTitle(n.Title) == normOld {
				holders++
			}
		}
		if holders == 0 {
			now := nowISO()
			for i := range notes {
				newText, changed := RewriteWikiLinks(notes[i].Content, normOld, applied)
				if changed {
					notes[i].Content = newText
					notes[i].UpdatedAt = now
				}
			}
		}
	}

	if err := s.notes.SaveNotes(notes); err != nil {
		return httpError(http.StatusInternalServerError, "Failed to persist notes")
	}
	writeJSON(w, http.StatusOK, notes[idx])
	return nil
}

func (s *Server) handleDeleteNote(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("id")
	notes, _ := s.notes.LoadNotes()
	kept := notes[:0]
	for _, n := range notes {
		if n.ID != id {
			kept = append(kept, n)
		}
	}
	if len(kept) == len(notes) {
		return httpError(http.StatusNotFound, "Note not found")
	}
	if err := s.notes.SaveNotes(kept); err != nil {
		return httpError(http.StatusInternalServerError, "Failed to persist notes")
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	return nil
}

// ── 文件夹 ──────────────────────────────────────────────────────

func (s *Server) handleGetFolders(w http.ResponseWriter, _ *http.Request) error {
	fs, _ := s.folders.LoadFolders()
	writeJSON(w, http.StatusOK, fs)
	return nil
}

func (s *Server) handlePutFolders(w http.ResponseWriter, r *http.Request) error {
	var fs FolderState
	if err := readJSON(r, &fs); err != nil {
		return httpError(http.StatusBadRequest, "Invalid JSON body")
	}
	if fs.Folders == nil || fs.NoteFolder == nil {
		return httpError(http.StatusBadRequest, "folders must be an array and note_folder an object")
	}
	if err := s.folders.SaveFolders(fs); err != nil {
		return httpError(http.StatusInternalServerError, "Failed to persist folders")
	}
	writeJSON(w, http.StatusOK, fs)
	return nil
}

// ── 设置 ────────────────────────────────────────────────────────

func (s *Server) handleGetSettings(w http.ResponseWriter, _ *http.Request) error {
	cfg, _ := s.settings.LoadSettings()
	writeJSON(w, http.StatusOK, cfg)
	return nil
}

type settingsPatch struct {
	Blur         *int     `json:"blur"`
	Transparency *float64 `json:"transparency"`
	Theme        *string  `json:"theme"`
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) error {
	var p settingsPatch
	if err := readJSON(r, &p); err != nil {
		return httpError(http.StatusBadRequest, "Invalid JSON body")
	}
	cfg, _ := s.settings.LoadSettings()
	if p.Blur != nil {
		cfg.Blur = clamp(*p.Blur, 0, 20)
	}
	if p.Transparency != nil {
		cfg.Transparency = clampFloat(*p.Transparency, 0.1, 1.0)
	}
	if p.Theme != nil {
		if len(*p.Theme) > 32 || !allowedThemes[*p.Theme] {
			return httpError(http.StatusBadRequest, "Unknown theme")
		}
		cfg.Theme = *p.Theme
	}
	if err := s.settings.SaveSettings(cfg); err != nil {
		return httpError(http.StatusInternalServerError, "Failed to persist settings")
	}
	writeJSON(w, http.StatusOK, cfg)
	return nil
}

// ── 背景图上传 / 删除 ───────────────────────────────────────────

func (s *Server) handleUploadBackground(w http.ResponseWriter, r *http.Request) error {
	if err := r.ParseMultipartForm(MaxUploadBytes); err != nil {
		return httpError(http.StatusBadRequest, "No file provided")
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		return httpError(http.StatusBadRequest, "No file provided")
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, MaxUploadBytes))
	if err != nil {
		return httpError(http.StatusBadRequest, "No file provided")
	}
	ext, ok := SniffImageExt(data)
	if !ok {
		return httpError(http.StatusBadRequest, "Unsupported image format")
	}
	stored := "bg_" + uuidHex() + ext
	if err := atomicWriteFile(filepath.Join(s.baseDir, "uploads", stored), data); err != nil {
		return httpError(http.StatusInternalServerError, "Failed to store image")
	}
	cfg, _ := s.settings.LoadSettings()
	cfg.BackgroundImage = &stored
	if err := s.settings.SaveSettings(cfg); err != nil {
		return httpError(http.StatusInternalServerError, "Failed to persist settings")
	}
	writeJSON(w, http.StatusOK, map[string]string{"filename": stored})
	return nil
}

func (s *Server) handleDeleteBackground(w http.ResponseWriter, _ *http.Request) error {
	cfg, _ := s.settings.LoadSettings()
	if cfg.BackgroundImage != nil {
		_ = os.Remove(filepath.Join(s.baseDir, "uploads", filepath.Base(*cfg.BackgroundImage)))
	}
	cfg.BackgroundImage = nil
	if err := s.settings.SaveSettings(cfg); err != nil {
		return httpError(http.StatusInternalServerError, "Failed to persist settings")
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	return nil
}

// ── AI 对话 ─────────────────────────────────────────────────────

type chatBody struct {
	Question string        `json:"question"`
	History  []ChatMessage `json:"history"`
}

func (s *Server) handleChat(w http.ResponseWriter, r *http.Request) error {
	var body chatBody
	if err := readJSON(r, &body); err != nil {
		return httpError(http.StatusBadRequest, "Invalid JSON body")
	}
	if strings.TrimSpace(body.Question) == "" {
		return httpError(http.StatusBadRequest, "question must be a non-empty string")
	}
	notes, _ := s.notes.LoadNotes()
	ans, err := s.asker.Ask(r.Context(), notes, body.Question, body.History)
	if err != nil {
		return httpError(http.StatusBadGateway, err.Error())
	}
	writeJSON(w, http.StatusOK, ans)
	return nil
}

// ── 工具 ────────────────────────────────────────────────────────

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clampFloat(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
