var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
// 独立 /chat 页面：全屏布局 + 持久化会话（创建/检索/删除/多轮对话）。
// 依赖全部通过构造函数注入；@autobind / @debounce 简化事件处理。
import { $, el } from "./dom.js";
import { apiSafe } from "./api.js";
import { renderMarkdown } from "./markdown.js";
import { storage } from "./utils.js";
import { BRIGHTNESS_KEY } from "./state.js";
import { initEffects, initSideRays, initSplashCursor } from "./effects.js";
import { autobind, debounce } from "./decorators.js";
class ChatPage {
    constructor(deps) {
        this.deps = deps;
        this.sessions = [];
        this.currentId = null;
        this.renderedSessions = new Set();
    }
    // ── 会话列表 ────────────────────────────────────────────────
    async loadSessions(query = "") {
        const url = `/api/chat/sessions${query ? `?q=${encodeURIComponent(query)}` : ""}`;
        const list = await this.deps.api(url, {}, "加载会话失败");
        if (!list)
            return;
        this.sessions = list;
        this.renderSessions();
    }
    renderSessions() {
        this.deps.sessionList.innerHTML = "";
        this.renderedSessions.clear();
        if (this.sessions.length === 0) {
            this.deps.sessionList.appendChild(el("div", { class: "chat-session-empty" }, "暂无会话"));
            return;
        }
        this.sessions.forEach((s) => {
            const item = el("div", {
                class: `chat-session-item${s.id === this.currentId ? " active" : ""}`,
                onClick: () => void this.selectSession(s.id),
            }, el("div", { class: "chat-session-title" }, s.title || "新对话"), el("div", { class: "chat-session-time" }, this.fmtTime(s.updated_at)), el("button", {
                class: "chat-session-del", type: "button", title: "删除会话",
                onClick: (e) => { e.stopPropagation(); void this.deleteSession(s.id); },
            }, "✕"));
            this.deps.sessionList.appendChild(item);
            this.renderedSessions.add(s.id);
        });
    }
    onSearch() {
        void this.loadSessions(this.deps.search.value.trim());
    }
    async newSession() {
        const s = await this.deps.api("/api/chat/sessions", { method: "POST" }, "创建会话失败");
        if (!s)
            return;
        this.sessions.unshift(s);
        this.currentId = s.id;
        this.deps.title.textContent = s.title;
        this.deps.messages.innerHTML = "";
        this.renderSessions();
        this.deps.input.focus();
    }
    async selectSession(id) {
        const s = await this.deps.api(`/api/chat/sessions/${id}`, {}, "读取会话失败");
        if (!s)
            return;
        this.currentId = s.id;
        this.deps.title.textContent = s.title || "新对话";
        this.renderMessages(s.messages || []);
        this.renderSessions();
    }
    async deleteSession(id) {
        const ok = await this.deps.api(`/api/chat/sessions/${id}`, { method: "DELETE" }, "删除会话失败");
        if (!ok)
            return;
        this.sessions = this.sessions.filter((s) => s.id !== id);
        if (this.currentId === id) {
            this.currentId = null;
            this.deps.title.textContent = "新对话";
            this.deps.messages.innerHTML = "";
        }
        this.renderSessions();
    }
    // ── 消息渲染 ────────────────────────────────────────────────
    renderMessages(list) {
        this.deps.messages.innerHTML = "";
        list.forEach((m) => this.addMessage(m.role, m.content, ""));
        this.deps.messages.scrollTop = this.deps.messages.scrollHeight;
    }
    addMessage(role, content, meta = "") {
        const msg = el("div", { class: `chat-msg chat-msg--${role === "user" ? "user" : "assistant"}` });
        if (role === "assistant") {
            msg.innerHTML = this.deps.render(content || "*（无内容）*");
        }
        else {
            msg.textContent = content;
        }
        if (meta)
            msg.appendChild(el("div", { class: "chat-meta" }, meta));
        this.deps.messages.appendChild(msg);
        this.deps.messages.scrollTop = this.deps.messages.scrollHeight;
        return msg;
    }
    // ── 发送 ────────────────────────────────────────────────────
    async send() {
        const question = this.deps.input.value.trim();
        if (!question)
            return;
        this.deps.input.value = "";
        this.addMessage("user", question);
        const thinking = this.addMessage("assistant", "思考中…");
        const result = await this.deps.api("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: this.currentId, question }),
        }, "AI 对话失败");
        thinking.remove();
        if (!result)
            return;
        this.currentId = result.session_id;
        this.deps.title.textContent = result.session_title || this.deps.title.textContent;
        this.addMessage("assistant", result.answer || "（无回答）", result.titles?.length ? `命中：${result.titles.join(" · ")}` : "");
        void this.loadSessions();
    }
    onSubmit(e) {
        e.preventDefault();
        void this.send();
    }
    fmtTime(iso) {
        try {
            return new Date(iso).toLocaleString();
        }
        catch {
            return "";
        }
    }
    // ── 初始化 ──────────────────────────────────────────────────
    async init() {
        this.deps.effects.initEffects();
        const s = await this.deps.api("/api/settings", {}, "加载设置失败");
        const theme = s?.theme || "cyan";
        document.body.dataset.theme = theme;
        if (this.deps.bgLayer && s) {
            const brightness = parseFloat(this.deps.store.get(this.deps.brightnessKey)) || 1;
            this.deps.bgLayer.style.filter = `blur(${s.blur || 0}px) brightness(${brightness})`;
            this.deps.bgLayer.style.opacity = s.transparency ?? 1;
            this.deps.bgLayer.style.backgroundImage = s.background_image
                ? `url(/uploads/${s.background_image})` : "";
        }
        this.deps.effects.initSideRays(theme);
        this.deps.effects.initSplashCursor(theme);
        this.deps.form.addEventListener("submit", this.onSubmit);
        this.deps.search.addEventListener("input", () => void this.onSearch());
        this.deps.newBtn.addEventListener("click", this.newSession);
        await this.loadSessions();
        if (this.sessions.length > 0) {
            await this.selectSession(this.sessions[0].id);
        }
        else {
            await this.newSession();
        }
    }
}
__decorate([
    debounce(200)
], ChatPage.prototype, "onSearch", null);
__decorate([
    autobind
], ChatPage.prototype, "newSession", null);
__decorate([
    autobind
], ChatPage.prototype, "selectSession", null);
__decorate([
    autobind
], ChatPage.prototype, "deleteSession", null);
__decorate([
    autobind
], ChatPage.prototype, "send", null);
__decorate([
    autobind
], ChatPage.prototype, "onSubmit", null);
const page = new ChatPage({
    bgLayer: $("#bgLayer"),
    messages: $("#chatMessages"),
    sessionList: $("#chatSessionList"),
    form: $("#chatForm"),
    input: $("#chatInput"),
    search: $("#chatSearch"),
    newBtn: $("#chatNew"),
    title: $("#chatTitle"),
    api: apiSafe,
    render: renderMarkdown,
    store: storage,
    brightnessKey: BRIGHTNESS_KEY,
    effects: { initEffects, initSideRays, initSplashCursor },
});
void page.init();
