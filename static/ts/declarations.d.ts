// 全局 classic-script 依赖声明
declare const marked: {
  parse(text: string): string;
};
declare const katex: {
  renderToString(math: string, options?: { displayMode?: boolean; throwOnError?: boolean }): string;
};

