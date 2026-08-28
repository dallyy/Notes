import { $, el } from "./dom.js";
import { apiSafe } from "./api.js";
import { renderMarkdown } from "./markdown.js";
import { storage } from "./utils.js";
import { BRIGHTNESS_KEY } from "./state.js";
import { initEffects, initSideRays, initSplashCursor } from "./effects.js";

const bgLayer = $("#bgLayer");
const chatMessages = $("#chatMessages");
const chatForm = $("#chatForm");
const chatInput = $("#chatInput");

let history = [];        // {role: "user"|"assistant", content}

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

const init = async () => {
  initEffects();

  const s = await apiSafe("/api/settings", {}, "加载设置失败");
  const theme = s?.theme || "cyan";
  document.body.dataset.theme = theme;

  if (bgLayer && s) {
    const brightness = parseFloat(storage.get(BRIGHTNESS_KEY)) || 1;
    bgLayer.style.filter = `blur(${s.blur || 0}px) brightness(${brightness})`;
    bgLayer.style.opacity = s.transparency ?? 1;
    bgLayer.style.backgroundImage = s.background_image
      ? `url(/uploads/${s.background_image})` : "";
  }

  initSideRays(theme);
  initSplashCursor(theme);

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    send();
  });
  chatInput.focus();
};

init();
