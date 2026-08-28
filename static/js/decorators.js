// 常用装饰器：简化事件绑定、防抖、节流。
// @autobind 绑定 this，便于把原型方法直接作为事件回调传入。
export function autobind(_target, _key, descriptor) {
    const fn = descriptor.value;
    return {
        configurable: true,
        get() {
            const bound = fn.bind(this);
            Object.defineProperty(this, _key, { value: bound, configurable: true, writable: true });
            return bound;
        },
    };
}
// @debounce(200) 装饰方法：在静默 ms 毫秒后才真正执行（尾沿触发）。
export function debounce(ms) {
    return (_target, _key, descriptor) => {
        const fn = descriptor.value;
        let timer;
        const wrapped = function (...args) {
            if (timer)
                clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), ms);
        };
        return { ...descriptor, value: wrapped };
    };
}
// @throttle(ms) 装饰方法：每个 ms 毫秒最多执行一次（首沿触发）。
export function throttle(ms) {
    return (_target, _key, descriptor) => {
        const fn = descriptor.value;
        let last = 0;
        const wrapped = function (...args) {
            const now = Date.now();
            if (now - last >= ms) {
                last = now;
                return fn.apply(this, args);
            }
        };
        return { ...descriptor, value: wrapped };
    };
}
