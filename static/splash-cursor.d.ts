export class SplashCursor {
  constructor(container: HTMLElement, options: Record<string, unknown>);
  start(): void;
  destroy(): void;
  updateColor(color: string): void;
}
