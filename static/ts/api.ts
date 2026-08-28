import { showToast } from "./utils.js";

export const api = async (path, options) => {
  const res = await fetch(path, options);
  if (!res.ok) {
    const msg = await res.text().catch(() => "请求失败");
    throw new Error(msg);
  }
  return res.json();
};

export const apiSafe = async (path, options, errorMsg) => {
  try {
    return await api(path, options);
  } catch (e) {
    showToast(errorMsg || `操作失败: ${e.message}`, "error");
    return null;
  }
};
