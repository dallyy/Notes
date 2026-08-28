// 常用装饰器：简化事件绑定、防抖、节流。

// @autobind 绑定 this，便于把原型方法直接作为事件回调传入。
export function autobind(
  _target: unknown,
  _key: string,
  descriptor: PropertyDescriptor,
): PropertyDescriptor {
  const fn = descriptor.value;
  return {
    configurable: true,
    get(this: unknown) {
      const bound = fn.bind(this);
      Object.defineProperty(this, _key, { value: bound, configurable: true, writable: true });
      return bound;
    },
  };
}

// @debounce(200) 装饰方法：在静默 ms 毫秒后才真正执行（尾沿触发）。
export function debounce(ms: number) {
  return (_target: unknown, _key: string, descriptor: PropertyDescriptor): PropertyDescriptor => {
    const fn = descriptor.value;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wrapped = function (this: unknown, ...args: unknown[]) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
    return { ...descriptor, value: wrapped };
  };
}

// @throttle(ms) 装饰方法：每个 ms 毫秒最多执行一次（首沿触发）。
export function throttle(ms: number) {
  return (_target: unknown, _key: string, descriptor: PropertyDescriptor): PropertyDescriptor => {
    const fn = descriptor.value;
    let last = 0;
    const wrapped = function (this: unknown, ...args: unknown[]) {
      const now = Date.now();
      if (now - last >= ms) {
        last = now;
        return fn.apply(this, args);
      }
    };
    return { ...descriptor, value: wrapped };
  };
}
