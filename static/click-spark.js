// ── ClickSpark ── click spark particle effect ───────────────

class ClickSpark {
  constructor(container, options = {}) {
    this.container = container;
    this.canvas = null;
    this.ctx = null;
    this.sparks = [];
    this.animId = null;

    this.config = {
      sparkColor: "#22d3ee",
      sparkSize: 10,
      sparkRadius: 20,
      sparkCount: 8,
      duration: 400,
      ...options,
    };

    this._onClick = this._handleClick.bind(this);
    this._onResize = this._handleResize.bind(this);
    this._loop = this._draw.bind(this);
  }

  start() {
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;";
    this.ctx = this.canvas.getContext("2d");
    this.container.appendChild(this.canvas);
    this._resize();

    document.addEventListener("mousedown", this._onClick);
    window.addEventListener("resize", this._onResize);
    this.animId = requestAnimationFrame(this._loop);
  }

  updateColor(hex) {
    this.config.sparkColor = hex;
  }

  destroy() {
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
    document.removeEventListener("mousedown", this._onClick);
    window.removeEventListener("resize", this._onResize);
    if (this.canvas && this.canvas.parentNode)
      this.canvas.parentNode.removeChild(this.canvas);
    this.canvas = null;
    this.ctx = null;
    this.sparks = [];
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _handleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const now = performance.now();

    for (let i = 0; i < this.config.sparkCount; i++) {
      this.sparks.push({
        x,
        y,
        angle: (2 * Math.PI * i) / this.config.sparkCount,
        startTime: now,
      });
    }
  }

  _handleResize() {
    this._resize();
  }

  _draw(timestamp) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);

    const cfg = this.config;
    this.sparks = this.sparks.filter((s) => {
      const elapsed = timestamp - s.startTime;
      if (elapsed >= cfg.duration) return false;

      const progress = elapsed / cfg.duration;
      const eased = progress * (2 - progress); // ease-out
      const distance = eased * cfg.sparkRadius;
      const lineLen = cfg.sparkSize * (1 - eased);

      const x1 = s.x + distance * Math.cos(s.angle);
      const y1 = s.y + distance * Math.sin(s.angle);
      const x2 = s.x + (distance + lineLen) * Math.cos(s.angle);
      const y2 = s.y + (distance + lineLen) * Math.sin(s.angle);

      ctx.strokeStyle = cfg.sparkColor;
      ctx.lineWidth = 2 * (1 - eased);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      return true;
    });

    this.animId = requestAnimationFrame(this._loop);
  }
}
