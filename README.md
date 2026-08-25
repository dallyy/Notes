# 随笔笔记（Notes）

本地优先（local-first）的单机 Markdown 笔记应用：双链（Wiki-Link）、3D 知识图谱、KaTeX 公式渲染、可换主题与背景。零数据库、零框架、零构建步骤（前端无打包），在 Linux 终端运行 `./run.sh` 即可使用。

## 快速开始

```bash
./run.sh          # 启动浏览器并运行 server（http://127.0.0.1:8000）
./build.sh        # 重新编译后端（需要 g++，见下文「构建」）
```

## 目录结构

```
├── server.cpp           # 后端源码（单文件，cpp-httplib + nlohmann/json）
├── server               # 编译产物（被 .gitignore 忽略）
├── build.sh             # 构建脚本（调用 g++）
├── run.sh               # 启动脚本（自动打开浏览器）
├── httplib.h / json.hpp # header-only 依赖（cpp-httplib 0.51.0 / nlohmann::json）
├── templates/index.html # 唯一 HTML 壳（单页）
├── static/
│   ├── js/              # 前端 ES 模块（见下方模块图）
│   ├── style.css        # 主题变量 + 玻璃拟态样式
│   ├── side-rays.js     # WebGL 侧光特效（ES 模块）
│   ├── splash-cursor.js # WebGL 流体光标特效（ES 模块）
│   └── vendor/          # 本地化第三方依赖（marked 18.0.9、KaTeX 0.16.9 含字体）
├── data/
│   ├── notes.json       # 笔记数据（运行时生成，被 .gitignore 忽略）
│   ├── settings.json    # 服务器侧外观设置（同上）
│   └── folders.json     # 服务器侧文件夹状态（同上）
└── uploads/             # 背景图片（同上）
```

## 架构

```
浏览器 (SPA, 原生 ES Modules)
  static/js/main.js ── 入口
    ├── state.js      共享可变状态（notes/settings/folders/...）
    ├── utils.js      toast/confirm/标题归一化/笔记查找
    ├── api.js        fetch 封装（api/apiSafe）
    ├── markdown.js   Markdown + 数学 + 双链渲染管线
    ├── editor.js     笔记 CRUD、防抖自动保存、预览切换
    ├── sidebar.js    列表渲染、文件夹（服务器 JSON + localStorage 镜像）、搜索
    ├── autocomplete.js  [[双链自动补全
    ├── graph.js      3D 力导向知识图谱（Canvas 2D 透视投影）
    ├── settings.js   外观设置抽屉
    └── effects.js    WebGL 特效 + 边框辉光 + 侧栏调宽
      └── 导入 side-rays.js / splash-cursor.js（ES 模块）
        │ fetch (JSON REST)
        ▼
server (cpp-httplib, 127.0.0.1:8000)
  单进程多工作线程，data_mutex 串行化全部数据访问
  原子落盘：写 .tmp → rename(2) 原子替换
        ▼
data/notes.json · data/settings.json · data/folders.json · uploads/*.jpg|png|gif|webp
```

### REST API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 页面壳 |
| GET | `/static/*`、`/uploads/*` | 静态挂载 |
| GET | `/api/notes` | 全部笔记 |
| POST | `/api/notes` | 新建（`{title, content}`） |
| PUT | `/api/notes/{id}` | 更新；标题变化时自动重写全库 `[[旧标题]]` 双链 |
| DELETE | `/api/notes/{id}` | 删除 |
| GET / PUT | `/api/settings` | 读 / 更新 `blur(0-20) transparency(0.1-1.0) theme(5 选 1 白名单)` |
| POST | `/api/upload-background` | 上传背景图（魔数校验，≤20MiB） |
| DELETE | `/api/background` | 移除背景图 |
| GET / PUT | `/api/folders` | 读 / 更新文件夹列表与笔记-文件夹归属 |

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

- httplib 每个请求跑在工作线程上，因此**所有**数据端点经 `data_mutex` 串行化（读端点也加锁，避免并发文件替换时出现读写交错）。
- **原子落盘**：先写 `notes.json.tmp`，成功后通过 `rename(2)` 一步替换。任何时刻读到的是完整的旧文件或新文件，进程崩溃也不会产生半写文件。
- 单用户本地场景下这是最简且足够强的模型；如需多机同步或海量笔记，可演进为 SQLite（WAL）或每笔记一文件。

## 双链维护（重命名安全）

- 写入 `[[标题]]` / `[[标题|别名]]` / `[[标题#小节]]` 建立关联；渲染时按归一化标题（去标点、小写、仅 `[0-9A-Za-z一-鿿]`）匹配笔记，精确匹配优先，无精确匹配时取归一化后最短的互含匹配。
- 重命名笔记（PUT title 变化）时，后端自动把**其他笔记（含自身）**中的 `[[旧标题]]` 链接改写为新标题；改写跳过 ```` ``` ```` 代码块与 `` ` `` 行内代码；当旧标题被多篇笔记共用（有歧义）或新标题为空时不做改写，避免误伤。
- 已知边界：`$...$` 数学块内的 `[[...]]` 不做保护（LaTeX 中极少出现）；模糊互含匹配在标题高度相似时可能错配——遇到时以精确重命名为准。

## 上传安全

- 全局 payload 上限 20MiB（`svr.set_payload_max_length`）。
- 扩展名**由文件魔数决定**（JPEG/PNG/GIF/WebP），客户端文件名从不被信任或复用；落盘名恒为 `bg_<uuid><ext>`，杜绝路径穿越与扩展名伪造。
- 服务仅绑定 `127.0.0.1`，无鉴权设计即以此为本机边界；如需局域网访问请自行加认证层。

## 构建

后端只依赖两个 header-only 库，无其他依赖：

```
g++ -O2 -std=c++17 -pthread -I. server.cpp -o server
```

- Debian/Ubuntu：`sudo apt install build-essential`
- Fedora/RHEL：`sudo dnf install gcc-c++`
- 也可以设置 `GXX` 环境变量指定其他兼容的 C++ 编译器（例如 `GXX=clang++ ./build.sh`）。

## 前端第三方依赖（已本地化）

- `static/vendor/marked.min.js` — marked 18.0.9 UMD 构建（`lib/marked.umd.js`）
- `static/vendor/katex/` — KaTeX 0.16.9（katex.min.js / katex.min.css / fonts 60 个字体文件）

升级方式：从 npm registry 拉对应版本 tarball，替换对应文件即可，无需改 HTML。

## 演进路线（未做的技术债）

- 双链改为 ID 锚定（当前为标题锚定 + 重命名重写，删除笔记仍会留下悬空链）。
- notes.json 单文件全量重写在笔记数 >10k 时需改 SQLite/分片存储。
- 无自动备份/历史版本；可加"每次写入前轮转 .bak"。
- 前端无测试；可引入 Node 侧单测覆盖 normTitle/findNoteByTitle/rewrite_wiki_links 等纯函数。
