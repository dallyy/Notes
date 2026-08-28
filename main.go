package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

func resolveBaseDir() string {
	if v := os.Getenv("NOTES_BASE_DIR"); v != "" {
		return v
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		if _, err := os.Stat(filepath.Join(dir, "templates", "index.html")); err == nil {
			return dir
		}
	}
	wd, _ := os.Getwd()
	return wd
}

func main() {
	baseDir := resolveBaseDir()
	cfg := LoadAIConfig(baseDir)

	// 依赖全部通过构造函数注入；接口是鸭子类型，未来可替换实现。
	httpClient := &http.Client{}
	dashscope := NewDashScopeClient(cfg, httpClient)
	index := NewEmbeddingIndex(cfg, dashscope, filepath.Join(baseDir, "data", "embeddings.json"))
	asker := NewAIService(cfg, dashscope, dashscope, index, filepath.Join(baseDir, "data", "chat_context.json"))

	deps := Deps{
		BaseDir:  baseDir,
		Notes:    NewJSONNoteStore(baseDir),
		Settings: NewJSONSettingsStore(baseDir),
		Folders:  NewJSONFolderStore(baseDir),
		Sessions: NewJSONChatSessionStore(baseDir),
		Asker:    asker,
	}
	srv := NewServer(deps)

	addr := "127.0.0.1:8000"
	if v := os.Getenv("NOTES_ADDR"); v != "" {
		addr = v
	}
	log.Printf("base dir: %s", baseDir)
	if err := srv.Run(addr); err != nil {
		log.Fatal(err)
	}
	_ = context.Background
}
