// ── SideRays ── vanilla WebGL light-ray effect ──────────────
// Adapted from @react-bits/SideRays-JS-CSS

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m
    ? [
        parseInt(m[1], 16) / 255,
        parseInt(m[2], 16) / 255,
        parseInt(m[3], 16) / 255,
      ]
    : [1, 1, 1];
}

const VERTEX_SHADER = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform float iSpeed;
uniform vec3 iRayColor1;
uniform vec3 iRayColor2;
uniform float iIntensity;
uniform float iSpread;
uniform float iFlipX;
uniform float iFlipY;
uniform float iTilt;
uniform float iSaturation;
uniform float iBlend;
uniform float iFalloff;
uniform float iOpacity;

float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord, float seedA, float seedB, float speed) {
  vec2 sourceToCoord = coord - raySource;
  float cosAngle = dot(normalize(sourceToCoord), rayRefDirection);
  return clamp(
    (0.45 + 0.15 * sin(cosAngle * seedA + iTime * speed)) +
    (0.3 + 0.2 * cos(-cosAngle * seedB + iTime * speed)),
    0.0, 1.0) *
    clamp((iResolution.x - length(sourceToCoord)) / iResolution.x, 0.5, 1.0);
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  if (iFlipX > 0.5) fragCoord.x = iResolution.x - fragCoord.x;
  if (iFlipY > 0.5) fragCoord.y = iResolution.y - fragCoord.y;

  vec2 coord = vec2(fragCoord.x, iResolution.y - fragCoord.y);
  vec2 rayPos = vec2(iResolution.x * 1.1, -0.5 * iResolution.y);

  float tiltRad = iTilt * 3.14159265 / 180.0;
  float cs = cos(tiltRad);
  float sn = sin(tiltRad);
  vec2 rel = coord - rayPos;
  vec2 tiltedCoord = vec2(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs) + rayPos;

  float halfSpread = iSpread * 0.275;
  vec2 rayRefDir1 = normalize(vec2(cos(0.785398 + halfSpread), sin(0.785398 + halfSpread)));
  vec2 rayRefDir2 = normalize(vec2(cos(0.785398 - halfSpread), sin(0.785398 - halfSpread)));

  vec4 rays1 = vec4(iRayColor1, 1.0) * rayStrength(rayPos, rayRefDir1, tiltedCoord, 36.2214, 21.11349, iSpeed);
  vec4 rays2 = vec4(iRayColor2, 1.0) * rayStrength(rayPos, rayRefDir2, tiltedCoord, 22.3991, 18.0234, iSpeed * 0.2);

  vec4 color = rays1 * (1.0 - iBlend) * 0.9 + rays2 * iBlend * 0.9;

  float distanceToLight = length(fragCoord.xy - vec2(rayPos.x, iResolution.y - rayPos.y)) / iResolution.y;
  float brightness = iIntensity * 0.4 / pow(max(distanceToLight, 0.001), iFalloff);
  color.rgb *= brightness;

  float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color.rgb = mix(vec3(gray), color.rgb, iSaturation);

  color.a = max(color.r, max(color.g, color.b)) * iOpacity;
  gl_FragColor = color;
}`;

class SideRays {
  constructor(container, options = {}) {
    this.container = container;
    this.canvas = null;
    this.gl = null;
    this.program = null;
    this.animId = null;
    this.dpr = Math.min(window.devicePixelRatio, 2);

    this.opts = {
      speed: 2.5,
      rayColor1: "#EAB308",
      rayColor2: "#96c8ff",
      intensity: 2,
      spread: 2,
      origin: "top-right",
      tilt: 0,
      saturation: 1.5,
      blend: 0.75,
      falloff: 1.6,
      opacity: 1.0,
      ...options,
    };

    this._resizeHandler = this._onResize.bind(this);
    this._loopHandler = this._loop.bind(this);
  }

  _compileShader(type, source) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.warn("SideRays shader error:", this.gl.getShaderInfoLog(shader));
      this.gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  _createProgram() {
    const vs = this._compileShader(this.gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = this._compileShader(this.gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) return null;

    const prog = this.gl.createProgram();
    this.gl.attachShader(prog, vs);
    this.gl.attachShader(prog, fs);
    this.gl.linkProgram(prog);

    if (!this.gl.getProgramParameter(prog, this.gl.LINK_STATUS)) {
      console.warn("SideRays link error:", this.gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  }

  _getUniforms() {
    const gl = this.gl;
    const p = this.program;
    const [flipX, flipY] = this._originToFlip();
    return {
      iTime: gl.getUniformLocation(p, "iTime"),
      iResolution: gl.getUniformLocation(p, "iResolution"),
      iSpeed: gl.getUniformLocation(p, "iSpeed"),
      iRayColor1: gl.getUniformLocation(p, "iRayColor1"),
      iRayColor2: gl.getUniformLocation(p, "iRayColor2"),
      iIntensity: gl.getUniformLocation(p, "iIntensity"),
      iSpread: gl.getUniformLocation(p, "iSpread"),
      iFlipX: gl.getUniformLocation(p, "iFlipX"),
      iFlipY: gl.getUniformLocation(p, "iFlipY"),
      iTilt: gl.getUniformLocation(p, "iTilt"),
      iSaturation: gl.getUniformLocation(p, "iSaturation"),
      iBlend: gl.getUniformLocation(p, "iBlend"),
      iFalloff: gl.getUniformLocation(p, "iFalloff"),
      iOpacity: gl.getUniformLocation(p, "iOpacity"),
      _flipX: flipX,
      _flipY: flipY,
    };
  }

  _originToFlip() {
    switch (this.opts.origin) {
      case "top-left":
        return [1, 0];
      case "bottom-right":
        return [0, 1];
      case "bottom-left":
        return [1, 1];
      default:
        return [0, 0]; // top-right
    }
  }

  _setUniforms(locs) {
    const gl = this.gl;
    const o = this.opts;
    gl.uniform1f(locs.iSpeed, o.speed);
    gl.uniform3fv(locs.iRayColor1, hexToRgb(o.rayColor1));
    gl.uniform3fv(locs.iRayColor2, hexToRgb(o.rayColor2));
    gl.uniform1f(locs.iIntensity, o.intensity);
    gl.uniform1f(locs.iSpread, o.spread);
    gl.uniform1f(locs.iFlipX, locs._flipX);
    gl.uniform1f(locs.iFlipY, locs._flipY);
    gl.uniform1f(locs.iTilt, o.tilt);
    gl.uniform1f(locs.iSaturation, o.saturation);
    gl.uniform1f(locs.iBlend, o.blend);
    gl.uniform1f(locs.iFalloff, o.falloff);
    gl.uniform1f(locs.iOpacity, o.opacity);
  }

  _onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  _loop(t) {
    if (!this.gl) return;
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(this._locs.iTime, t * 0.001);
    gl.uniform2f(this._locs.iResolution, this.canvas.width, this.canvas.height);
    try {
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.animId = requestAnimationFrame(this._loopHandler);
    } catch (e) {
      /* ignore lost context */
    }
  }

  start() {
    if (this.gl) return; // already running

    this.canvas = document.createElement("canvas");
    this.canvas.style.position = "absolute";
    this.canvas.style.inset = "0";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.pointerEvents = "none";

    this.gl = this.canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
    });
    if (!this.gl) {
      console.warn("SideRays: WebGL not available");
      return;
    }

    this.program = this._createProgram();
    if (!this.program) {
      console.warn("SideRays: failed to create program");
      return;
    }

    this.gl.useProgram(this.program);

    // enable alpha blending
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

    // full-screen triangle (covers clip space)
    const buf = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buf);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      this.gl.STATIC_DRAW,
    );
    const posLoc = this.gl.getAttribLocation(this.program, "position");
    this.gl.enableVertexAttribArray(posLoc);
    this.gl.vertexAttribPointer(posLoc, 2, this.gl.FLOAT, false, 0, 0);

    this._locs = this._getUniforms();
    this._setUniforms(this._locs);

    this.container.appendChild(this.canvas);
    this._onResize();
    window.addEventListener("resize", this._resizeHandler);
    this.animId = requestAnimationFrame(this._loopHandler);
  }

  update(opts = {}) {
    Object.assign(this.opts, opts);
    if (this._locs) this._setUniforms(this._locs);
  }

  destroy() {
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
    window.removeEventListener("resize", this._resizeHandler);
    if (this.gl) {
      const loseCtx = this.gl.getExtension("WEBGL_lose_context");
      if (loseCtx) loseCtx.loseContext();
      this.gl = null;
    }
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.canvas = null;
    this.program = null;
    this._locs = null;
  }
}
