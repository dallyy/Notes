package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// 存储接口（鸭子类型：任何实现 Load/Save 的类型都可注入）。
type NoteStore interface {
	LoadNotes() ([]Note, error)
	SaveNotes([]Note) error
}

type SettingsStore interface {
	LoadSettings() (Settings, error)
	SaveSettings(Settings) error
}

type FolderStore interface {
	LoadFolders() (FolderState, error)
	SaveFolders(FolderState) error
}

// ── 原子写 ──────────────────────────────────────────────────────

func atomicWriteFile(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func writeJSONFile(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return atomicWriteFile(path, b)
}

func readJSONFile(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

// ── JSON 文件实现 ──────────────────────────────────────────────

type JSONNoteStore struct{ path string }

func NewJSONNoteStore(baseDir string) *JSONNoteStore {
	return &JSONNoteStore{path: filepath.Join(baseDir, "data", "notes.json")}
}

func (s *JSONNoteStore) LoadNotes() ([]Note, error) {
	notes := []Note{}
	if err := readJSONFile(s.path, &notes); err != nil {
		if os.IsNotExist(err) {
			return notes, nil
		}
		return notes, err
	}
	return notes, nil
}

func (s *JSONNoteStore) SaveNotes(notes []Note) error {
	return writeJSONFile(s.path, notes)
}

type JSONSettingsStore struct{ path string }

func NewJSONSettingsStore(baseDir string) *JSONSettingsStore {
	return &JSONSettingsStore{path: filepath.Join(baseDir, "data", "settings.json")}
}

func (s *JSONSettingsStore) LoadSettings() (Settings, error) {
	cfg := Settings{BackgroundImage: nil, Blur: 0, Transparency: 1, Theme: "cyan"}
	if err := readJSONFile(s.path, &cfg); err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return cfg, err
	}
	return cfg, nil
}

func (s *JSONSettingsStore) SaveSettings(cfg Settings) error {
	return writeJSONFile(s.path, cfg)
}

type JSONFolderStore struct{ path string }

func NewJSONFolderStore(baseDir string) *JSONFolderStore {
	return &JSONFolderStore{path: filepath.Join(baseDir, "data", "folders.json")}
}

func (s *JSONFolderStore) LoadFolders() (FolderState, error) {
	fs := FolderState{Folders: []Folder{}, NoteFolder: map[string]string{}}
	if err := readJSONFile(s.path, &fs); err != nil {
		if os.IsNotExist(err) {
			return fs, nil
		}
		return fs, err
	}
	return fs, nil
}

func (s *JSONFolderStore) SaveFolders(fs FolderState) error {
	return writeJSONFile(s.path, fs)
}
