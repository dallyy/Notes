// 独立 /chat 页面逻辑：多轮对话。依赖全部通过构造函数注入。
import { $, el } from "./dom.js";
import { apiSafe } from "./api.js";
import { renderMarkdown } from "./markdown.js";
import { storage } from "./utils.js";
import { BRIGHTNESS_KEY } from "./state.js";
import { initEffects, initSideRays, initSplashCursor } from "./effects.js";
import { autobind } from "./decorators.js";

interface ChatPageDeps {
  bgLayer: HTMLElement | null;
  messages: HTMLElement;
  form: HTMLFormElement;
  input: HTMLInputElement;
  api: typeof apiSafe;
  render: typeof renderMarkdown;
  store: typeof storage;
  brightnessKey: string;
  effects: {
    initEffects: typeof initEffects;
    initSideRays: typeof initSideRays;
    initSplashCursor: typeof initSplashCursor;
  };
}

class ChatPage {
  private history: Array<{ role: "user" | "assistant"; content: string }> = [];

  constructor(private deps: ChatPageDeps) {}

  private addMessage(role: "user" | "assistant", content: string, meta = "") {
    const msg = el("div", { class: `chat-msg chat-msg--${role}` });
    if (role === "assistant") {
      msg.innerHTML = this.deps.render(content || "*（无内容）*");
    } else {
      msg.textContent = content;
    }
    if (meta) msg.appendChild(el("div", { class: "chat-meta" }, meta));
    this.deps.messages.appendChild(msg);
    this.deps.messages.scrollTop = this.deps.messages.scrollHeight;
    return msg;
  }

  @autobind
  private async send() {
    const question = this.deps.input.value.trim();
    if (!question) return;
    this.deps.input.value = "";
    this.addMessage("user", question);
    this.history.push({ role: "user", content: question });

    const thinking = this.addMessage("assistant", "思考中…");
    const result = await this.deps.api("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, history: this.history.slice(-20) }),
    }, "AI 对话失败");
    thinking.remove();

    if (!result) { this.history.pop(); return; }
    this.addMessage("assistant", result.answer || "（无回答）",
      result.titles?.length ? `命中：${result.titles.join(" · ")}` : "");
    this.history.push({ role: "assistant", content: result.answer || "" });
  }

  @autobind
  private onSubmit(e: Event) {
    e.preventDefault();
    void this.send();
  }

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
    this.deps.input.focus();
  }
}

const page = new ChatPage({
  bgLayer: $("#bgLayer"),
  messages: $("#chatMessages")!,
  form: $("#chatForm") as HTMLFormElement,
  input: $("#chatInput") as HTMLInputElement,
  api: apiSafe,
  render: renderMarkdown,
  store: storage,
  brightnessKey: BRIGHTNESS_KEY,
  effects: { initEffects, initSideRays, initSplashCursor },
});
void page.init();
