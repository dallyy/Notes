package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// AIConfig DashScope 兼容模式配置。依赖通过构造函数注入。
type AIConfig struct {
	BaseURL        string
	APIKey         string
	EmbeddingModel string
	ChatModel      string
	EnableThinking bool
	Timeout        time.Duration
	TopK           int
}

// LoadAIConfig 读取 data/ai_config.json，环境变量优先级最高。
func LoadAIConfig(baseDir string) AIConfig {
	cfg := AIConfig{
		BaseURL:        "https://dashscope.aliyuncs.com/compatible-mode/v1",
		EmbeddingModel: "qwen3.7-text-embedding",
		ChatModel:      "deepseek-v4-pro-0813",
		EnableThinking: true,
		Timeout:        120 * time.Second,
		TopK:           1,
	}
	if b, err := os.ReadFile(filepath.Join(baseDir, "data", "ai_config.json")); err == nil {
		var f struct {
			BaseURL        string `json:"base_url"`
			APIKey         string `json:"api_key"`
			EmbeddingModel string `json:"embedding_model"`
			ChatModel      string `json:"chat_model"`
			EnableThinking *bool  `json:"enable_thinking"`
			Timeout        int    `json:"timeout"`
			TopK           int    `json:"top_k"`
		}
		if json.Unmarshal(b, &f) == nil {
			if f.BaseURL != "" {
				cfg.BaseURL = f.BaseURL
			}
			cfg.APIKey = f.APIKey
			if f.EmbeddingModel != "" {
				cfg.EmbeddingModel = f.EmbeddingModel
			}
			if f.ChatModel != "" {
				cfg.ChatModel = f.ChatModel
			}
			if f.EnableThinking != nil {
				cfg.EnableThinking = *f.EnableThinking
			}
			if f.Timeout > 0 {
				cfg.Timeout = time.Duration(f.Timeout) * time.Second
			}
			if f.TopK > 0 {
				cfg.TopK = f.TopK
			}
		}
	}
	if v := os.Getenv("DASHSCOPE_BASE_URL"); v != "" {
		cfg.BaseURL = v
	}
	if v := os.Getenv("DASHSCOPE_API_KEY"); v != "" {
		cfg.APIKey = v
	}
	if v := os.Getenv("EMBEDDING_MODEL"); v != "" {
		cfg.EmbeddingModel = v
	}
	if v := os.Getenv("CHAT_MODEL"); v != "" {
		cfg.ChatModel = v
	}
	if v := os.Getenv("AI_TIMEOUT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cfg.Timeout = time.Duration(n) * time.Second
		}
	}
	return cfg
}
