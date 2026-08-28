// AI 对话入口：从主页侧栏重定向到独立 /chat 页面。
import { autobind } from "./decorators.js";

class ChatEntry {
  constructor(private btn: HTMLElement | null) {}

  @autobind
  private onClick() {
    window.location.href = "/chat";
  }

  init() {
    this.btn?.addEventListener("click", this.onClick);
  }
}

export const initChat = () => new ChatEntry(document.getElementById("btnToggleChat")).init();
