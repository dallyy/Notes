import { $, el } from "./dom.js";
import { apiSafe } from "./api.js";
import { renderMarkdown } from "./markdown.js";

const chatOverlay = $("#chatOverlay");
const chatPanel = $("#chatPanel");
const chatMessages = $("#chatMessages");
const chatForm = $("#chatForm");
const chatInput = $("#chatInput");

let history = [];        // {role: "user"|"assistant", content}

export const openChat = () => {
  // 右侧抽屉互斥：关闭设置抽屉
  $("#settingsPanel")?.classList.remove("open");
  $("#settingsOverlay")?.classList.remove("open");
  chatPanel.classList.add("open");
  chatOverlay.classList.add("open");
  setTimeout(() => chatInput.focus(), 150);
};

export const closeChat = () => {
  chatPanel.classList.remove("open");
  chatOverlay.classList.remove("open");
};

const addMessage = (role, content, meta) => {
  const msg = el("div", { class: `chat-msg chat-msg--${role}` });
  if (role === "assistant") {
    msg.innerHTML = renderMarkdown(content || "*（无内容）*");
  } else {
    msg.textContent = content;
  }
  if (meta) msg.appendChild(el("div", { class: "chat-meta" }, meta));
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return msg;
};

const send = async () => {
  const question = chatInput.value.trim();
  if (!question) return;
  chatInput.value = "";
  addMessage("user", question);
  history.push({ role: "user", content: question });

  const thinking = addMessage("assistant", "思考中…");
  const result = await apiSafe("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history: history.slice(-20) }),
  }, "AI 对话失败");
  thinking.remove();

  if (!result) { history.pop(); return; }
  addMessage("assistant", result.answer || "（无回答）",
    result.titles?.length ? `命中：${result.titles.join(" · ")}` : "");
  history.push({ role: "assistant", content: result.answer || "" });
};

export const initChat = () => {
  $("#btnToggleChat").addEventListener("click", openChat);
  $("#chatClose").addEventListener("click", closeChat);
  chatOverlay.addEventListener("click", closeChat);
  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    send();
  });
};
