// DOM 构建辅助：让列表/补全等模块摆脱重复的 createElement 样板。

export const $ = (sel, root = document) => root.querySelector(sel);

export const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v == null) return;
    if (k === "class") n.className = v;
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k === "style") Object.assign(n.style, v);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  });
  n.append(...[kids].flat().filter(c => c != null)
    .map(c => c.nodeType ? c : document.createTextNode(c)));
  return n;
};
