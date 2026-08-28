// AI 对话入口：从主页侧栏重定向到独立 /chat 页面。
export const initChat = () => {
  document.getElementById("btnToggleChat").addEventListener("click", () => {
    window.location.href = "/chat";
  });
};
