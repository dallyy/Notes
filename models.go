package main

// Note 笔记。标题 + 正文，ID 为 32 位 hex。
type Note struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// Settings 服务器侧外观设置（background_image 允许 null）。
type Settings struct {
	BackgroundImage *string `json:"background_image"`
	Blur            int     `json:"blur"`
	Transparency    float64 `json:"transparency"`
	Theme           string  `json:"theme"`
}

// Folder 文件夹。
type Folder struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
}

// FolderState 文件夹与笔记-文件夹归属。
type FolderState struct {
	Folders    []Folder          `json:"folders"`
	NoteFolder map[string]string `json:"note_folder"`
}

// ChatMessage 对话消息（鸭子类型：AI 客户端只关心 Role/Content）。
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatAnswer AI 对话结果。
type ChatAnswer struct {
	Answer       string   `json:"answer"`
	Reasoning    string   `json:"reasoning"`
	MatchedTitle string   `json:"matched_title"`
	Titles       []string `json:"titles"`
	Context      string   `json:"context"`
}
