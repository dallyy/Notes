# 随笔笔记（Notes）

本地优先（local-first）的单机 Markdown 笔记应用：双链（Wiki-Link）、3D 知识图谱、KaTeX 公式渲染、可换主题与背景。后端为 Go（标准库 net/http，无第三方依赖），前端为 TypeScript（编译为原生 ES Modules）。在 Linux 终端运行 `./run.sh` 即可使用。

## 快速开始

```bash
./run.sh          # 构建（如缺失）并启动 notes-server（http://127.0.0.1:8000）
./build.sh        # 只编译 Go 后端
npm run build:ts  # 只编译 TypeScript 前端（源：static/ts → 输出：static/js）
```

## 目录结构

```
├── *.go / go.mod        # 后端源码（Go 标准库，零第三方依赖）
├── notes-server         # Go 编译产物（被 .gitignore 忽略）
├── build.sh             # Go 构建脚本
├── run.sh               # 启动脚本（自动打开浏览器）
├── templates/index.html # 主页（笔记 SPA）
├── templates/chat.html  # AI 对话独立页（复用主页样式）
├── static/
│   ├── ts/              # 前端 TypeScript 源（ES 模块，见下方模块图）
│   ├── js/              # tsc 编译产物（由 npm run build:ts 生成）
│   ├── style.css        # 主题变量 + 玻璃拟态样式
│   ├── side-rays.js     # WebGL 侧光特效（ES 模块）
│   ├── splash-cursor.js # WebGL 流体光标特效（ES 模块）
│   └── vendor/          # 本地化第三方依赖（marked 18.0.9、KaTeX 0.16.9 含字体）
├── data/
│   ├── notes.json       # 笔记数据（运行时生成，被 .gitignore 忽略）
│   ├── settings.json    # 服务器侧外观设置（同上）
│   ├── folders.json     # 服务器侧文件夹状态（同上）
│   ├── ai_config.json   # AI 配置（api_key/model，被 .gitignore 忽略）
│   ├── embeddings.json  # 标题嵌入向量缓存（同上）
│   └── chat_context.json# 最近一次检索生成的上下文文档（同上）
└── uploads/             # 背景图片（同上）
```

## 架构

```
浏览器 (SPA, 原生 ES Modules)
  static/js/main.js ── 入口
    ├── state.ts      共享可变状态（notes/settings/folders/...）
    ├── dom.ts         DOM 构建辅助（$ / el）
    ├── decorators.ts @autobind / @debounce / @throttle 装饰器
    ├── utils.ts      toast/confirm/标题归一化/笔记查找/storage
    ├── api.ts        fetch 封装（api / apiSafe）
    ├── markdown.ts   Markdown + 数学 + 双链渲染管线
    ├── editor.ts     笔记 CRUD、防抖自动保存、预览切换
    ├── sidebar.ts    列表渲染、文件夹（服务器 JSON + localStorage 镜像）、搜索
    ├── autocomplete.ts  [[双链自动补全
    ├── chat.ts       主页「AI 对话」按钮 → 重定向 /chat
    ├── chat-page.ts  独立 /chat 页面逻辑（ChatPage 类，构造注入 + @autobind）
    ├── graph.ts      3D 力导向知识图谱（Canvas 2D 透视投影）
    ├── settings.ts   外观设置抽屉
    └── effects.ts    WebGL 特效 + 边框辉光 + 侧栏调宽
      └── 导入 side-rays.js / splash-cursor.js（ES 模块）
        │ fetch (JSON REST)
        ▼
Go 后端（net/http，全部依赖构造函数注入）
    ├── server.go     Server/Deps：路由注册 + 装饰器式中介（locked 等）
    ├── handlers.go   笔记/文件夹/设置/上传/AI 对话处理器
    ├── store.go      NoteStore/SettingsStore/FolderStore 接口 + JSON 实现
    ├── kdtree.go     K-D 树算法（高维最近邻）
    ├── graph.go      知识图谱连通块算法
    ├── norm.go       标题归一化 / 查找
    ├── wikilinks.go  [[双链]] 解析与重命名重写
    ├── ai.go         DashScope 客户端、嵌入缓存索引、检索增强问答
    └── main.go       装配依赖并启动
```

### REST API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/notes` | 笔记列表（数组，按 `updated_at` 降序渲染） |
| POST | `/api/notes` | 新建笔记 `{title, content}` |
| PUT | `/api/notes/{id}` | 更新标题/内容；标题变化时重写 `[[旧标题]]` 链接 |
| DELETE | `/api/notes/{id}` | 删除笔记 |
| GET / PUT | `/api/settings` | 读 / 部分更新 `blur`、`transparency`、`theme` |
| POST | `/api/upload-background` | 上传背景图（魔数校验，≤20MiB） |
| DELETE | `/api/background` | 移除背景图 |
| GET / PUT | `/api/folders` | 读 / 更新文件夹列表与笔记-文件夹归属 |
| POST | `/api/chat` | AI 对话（支持 SSE 流式、实时联网）：嵌入检索 + 图谱连通块 + 思考链回答 |
| GET / POST | `/api/chat/sessions` | 会话列表（支持 `?q=` 检索） / 新建会话 |
| GET / DELETE | `/api/chat/sessions/{id}` | 读取 / 删除会话 |

### 数据模型

```json
// data/notes.json —— 数组，按 updated_at 降序渲染
{ "id": "<32hex>", "title": "...", "content": "...",
  "created_at": "2026-07-14T06:59:19.959+00:00",
  "updated_at": "2026-08-05T11:00:47.585+00:00" }
```

### 状态归属（有意为之的拆分）

| 状态 | 位置 | 理由 |
|---|---|---|
| 笔记内容、theme/blur/transparency/背景图、文件夹 | 服务器 JSON | 需要跨设备/备份的"内容" |
| 亮度、深浅模式、文件夹展开态、侧栏宽度 | localStorage | 纯本机 UI 偏好，无需落服务器 |

## 并发与持久化模型

- `ThreadingHTTPServer` 每个请求跑在线程上，因此**所有**数据端点经 `@locked`（`threading.RLock`）串行化，读端点也加锁，等价于旧版 C++ 的 `data_mutex`。
- **原子落盘**：先写 `notes.json.tmp`，成功后通过 `os.replace(2)` 一步替换。任何时刻读到的是完整的旧文件或新文件，进程崩溃也不会产生半写文件。
- 单用户本地场景下这是最简且足够强的模型；如需多机同步或海量笔记，可演进为 SQLite（WAL）或每笔记一文件。

## 双链维护（重命名安全）

- 写入 `[[标题]]` / `[[标题|别名]]` / `[[标题#小节]]` 建立关联；渲染时按归一化标题（去标点、小写、仅 `[0-9A-Za-z一-鿿]`）匹配笔记，精确匹配优先，无精确匹配时取归一化后最短的互含匹配。
- 重命名笔记（PUT title 变化）时，后端自动把**其他笔记（含自身）**中的 `[[旧标题]]` 链接改写为新标题；改写跳过 ```` ``` ```` 代码块与 `` ` `` 行内代码；当旧标题被多篇笔记共用（有歧义）或新标题为空时不做改写，避免误伤。
- 已知边界：`$...$` 数学块内的 `[[...]]` 不做保护（LaTeX 中极少出现）；模糊互含匹配在标题高度相似时可能错配——遇到时以精确重命名为准。

## 上传安全

- 全局 payload 上限 20MiB（`MAX_BODY`）。
- 扩展名**由文件魔数决定**（JPEG/PNG/GIF/WebP），客户端文件名从不被信任或复用；落盘名恒为 `bg_<uuid><ext>`，杜绝路径穿越与扩展名伪造。
- 服务仅绑定 `127.0.0.1`，无鉴权设计即以此为本机边界；如需局域网访问请自行加认证层。

## AI 对话（嵌入检索 + 图谱连通块 + 思考链）

- **入口**：主页侧栏「AI 对话」按钮会重定向到独立页面 `/chat`（全屏布局），页面复用主页样式；左侧为持久化会话列表，支持新建、检索、删除，右侧为多轮对话。
- **流式输出**：`POST /api/chat` 支持 `"stream": true`，以 `text/event-stream` 返回 `delta` / `done` / `error` 事件，前端打字机式渲染。
- **实时联网**：默认开启（请求可传 `"web_search": false` 关闭）。后端用 DuckDuckGo HTML 检索（无需 API Key），把前 5 条结果写入上下文文档；系统提示中注入当前时间，便于回答“今天是几号”等时效性问题。
- **模型**：标题/查询嵌入 `qwen3.7-text-embedding`；对话 `deepseek-v4-pro-0813`（DashScope OpenAI 兼容模式，`enable_thinking: true` 开启思考链）。
- **检索链路**：把问题经 embedding 模型算成向量 → 在笔记标题向量的 **K-D 树**上查最近邻 → 找到命中标题所在知识图谱**连通块**的全部标题 → 按标题匹配 `notes.json` 中对应正文 → 将「问题 + 各标题与正文」写成 `data/chat_context.json` 上下文文档 → 交给对话模型回答。
- **配置**：创建 `data/ai_config.json`（已被 .gitignore 忽略，不会提交到 git）：

```json
{
  "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "api_key": "sk-...",
  "embedding_model": "qwen3.7-text-embedding",
  "chat_model": "deepseek-v4-pro-0813",
  "enable_thinking": true,
  "timeout": 120,
  "top_k": 1
}
```

  也支持环境变量 `DASHSCOPE_BASE_URL` / `DASHSCOPE_API_KEY` / `EMBEDDING_MODEL` / `CHAT_MODEL` 临时覆盖。
- 标题嵌入向量缓存在 `data/embeddings.json`：只有新增笔记或标题变化时才重新调用 embedding 接口。

## Windows 快速开始

```bat
:: 安装 Go（https://go.dev/dl/）与 Node.js（https://nodejs.org/）
:: 然后在项目目录打开 cmd / PowerShell：

npm install
npm run build:ts
build.bat
run.bat
```

说明：
- 后端为 `notes-server.exe`（`build.bat` 生成，已被 .gitignore 忽略）。
- 前端编译产物 `static/js/*.js` 已提交；如果只改 Go 后端，无需 `npm install`，直接 `build.bat` + `run.bat` 即可运行。
- `run.bat` 会在启动后自动打开 http://127.0.0.1:8000 。

## 环境配置（Arch Linux）

```bash
# 1. 安装 Go 与 Node.js/npm（TypeScript 经 npm 安装到项目内）
sudo pacman -S go npm

# 2. 安装 TypeScript（写入 package-lock.json，之后可 npm ci）
npm install

# 3. 编译前端 TS（static/ts → static/js）
npm run build:ts

# 4. 编译后端 Go
./build.sh
```

之后直接 `./run.sh` 启动。若只改前端，重复第 3 步；若只改后端，重复第 4 步。已提交的 `static/js/*.js` 是编译产物，没有 npm 环境也能先运行（`./run.sh` 仍需要 go）。

## 运行要求

- Go 1.22+（仅标准库，零第三方依赖）
- Node.js + TypeScript（仅前端源码编译时需要；编译产物已提交）

## 前端第三方依赖（已本地化）

- `static/vendor/marked.min.js` — marked 18.0.9 UMD 构建（`lib/marked.umd.js`）
- `static/vendor/katex/` — KaTeX 0.16.9（katex.min.js / katex.min.css / fonts 60 个字体文件）

升级方式：从 npm registry 拉对应版本 tarball，替换对应文件即可，无需改 HTML。

## 演进路线（未做的技术债）

- 双链改为 ID 锚定（当前为标题锚定 + 重命名重写，删除笔记仍会留下悬空链）。
- notes.json 单文件全量重写在笔记数 >10k 时需改 SQLite/分片存储。
- 无自动备份/历史版本；可加"每次写入前轮转 .bak"。
- 前端无测试；可引入 Node 侧单测覆盖 normTitle/findNoteByTitle/rewrite_wiki_links 等纯函数。
- 前端 TS 与后端 Go 的接口/算法测试可分别用 `go test` 与 vitest 补齐。
