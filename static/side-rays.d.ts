export function hexToRgb(hex: string): { r: number; g: number; b: number };
export class SideRays {
  constructor(container: HTMLElement, options: Record<string, unknown>);
  start(): void;
  destroy(): void;
  update(options: Record<string, unknown>): void;
}
