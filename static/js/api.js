// ═══════════════════════════════════════════════════════════════
// Notes App — REST API helpers
// ═══════════════════════════════════════════════════════════════

import { showToast } from "./utils.js";

export async function api(path, options) {
  var res = await fetch(path, options);
  if (!res.ok) {
    var msg = await res.text().catch(function () { return "请求失败"; });
    throw new Error(msg);
  }
  return res.json();
}

export async function apiSafe(path, options, errorMsg) {
  try {
    return await api(path, options);
  } catch (e) {
    showToast(errorMsg || "操作失败: " + e.message, "error");
    return null;
  }
}
