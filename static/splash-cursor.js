// ── SplashCursor ── WebGL fluid simulation ──────────────────
// Vanilla JS port, theme-aware color. Falls back to Canvas 2D.

class SplashCursor {
  constructor(container, options = {}) {
    this.container = container;
    this.canvas = null;
    this.animId = null;
    this.isActive = true;
    this.lastTime = Date.now();
    this.colorTimer = 0;
    this.firstMove = false;

    this.config = {
      SIM_RESOLUTION: 128,
      DYE_RESOLUTION: 1440,
      DENSITY_DISSIPATION: 8,
      VELOCITY_DISSIPATION: 3,
      PRESSURE: 0.1,
      PRESSURE_ITERATIONS: 20,
      CURL: 3,
      SPLAT_RADIUS: 0.25,
      SPLAT_FORCE: 4000,
      SHADING: true,
      COLOR_UPDATE_SPEED: 10,
      TRANSPARENT: true,
      RAINBOW_MODE: false,
      COLOR: "#22d3ee",
      ...options,
    };

    this.pointers = [new PointerProto()];
    this._bound = {
      md: this._onMouseDown.bind(this),
      mm: this._onMouseMove.bind(this),
      rs: this._onResize.bind(this),
    };
  }

  // ── public ─────────────────────────────────────────────────
  start() {
    if (this.canvas) return;
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
    this.container.appendChild(this.canvas);

    // try WebGL first, fallback to Canvas2D
    const webglOk = this._initWebGL();
    if (!webglOk) {
      this._initCanvas2D();
    }

    window.addEventListener("mousedown", this._bound.md);
    window.addEventListener("mousemove", this._bound.mm);
    window.addEventListener("resize", this._bound.rs);
    this.animId = requestAnimationFrame((t) => this._frame(t));
  }

  updateColor(hex) {
    this.config.COLOR = hex;
  }

  destroy() {
    this.isActive = false;
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
    window.removeEventListener("mousedown", this._bound.md);
    window.removeEventListener("mousemove", this._bound.mm);
    window.removeEventListener("resize", this._bound.rs);
    if (this.gl) {
      const lose = this.gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
      this.gl = null;
    }
    if (this.canvas && this.canvas.parentNode)
      this.canvas.parentNode.removeChild(this.canvas);
    this.canvas = null;
    this.ctx2d = null;
  }

  // ==================== WEBGL =================================
  _initWebGL() {
    const p = {
      alpha: true,
      depth: false,
      stencil: false,
      antialias: false,
      preserveDrawingBuffer: false,
    };
    let gl = this.canvas.getContext("webgl2", p);
    this._isWebGL2 = !!gl;
    if (!this._isWebGL2)
      gl =
        this.canvas.getContext("webgl", p) ||
        this.canvas.getContext("experimental-webgl", p);
    if (!gl) {
      console.warn("SplashCursor: no WebGL context");
      return false;
    }
    this.gl = gl;
    gl.clearColor(0, 0, 0, 1);

    // extensions
    let hf, slf;
    if (this._isWebGL2) {
      gl.getExtension("EXT_color_buffer_float");
      slf = gl.getExtension("OES_texture_float_linear");
    } else {
      hf = gl.getExtension("OES_texture_half_float");
      slf = gl.getExtension("OES_texture_half_float_linear");
    }
    this._hftt = this._isWebGL2 ? gl.HALF_FLOAT : hf && hf.HALF_FLOAT_OES;
    this._slf = !!slf;
    if (!this._hftt) {
      console.warn("SplashCursor: no half-float support");
      return false;
    } // can't do half-float

    if (!this._slf) {
      this.config.DYE_RESOLUTION = 256;
      this.config.SHADING = false;
    }

    // format detection
    const gsf = (inf, fmt, typ) => this._getSupportedFormat(gl, inf, fmt, typ);
    if (this._isWebGL2) {
      this._fmtRGBA = gsf(gl.RGBA16F, gl.RGBA, this._hftt);
      this._fmtRG = gsf(gl.RG16F, gl.RG, this._hftt);
      this._fmtR = gsf(gl.R16F, gl.RED, this._hftt);
    } else {
      this._fmtRGBA = gsf(gl.RGBA, gl.RGBA, this._hftt);
      this._fmtRG = gsf(gl.RGBA, gl.RGBA, this._hftt);
      this._fmtR = gsf(gl.RGBA, gl.RGBA, this._hftt);
    }
    if (!this._fmtRGBA || !this._fmtRG || !this._fmtR) return false;

    this._compileShaders();
    this._initFBOs();

    // blit setup
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]),
      gl.STATIC_DRAW,
    );
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array([0, 1, 2, 0, 2, 3]),
      gl.STATIC_DRAW,
    );
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    this._blit = (target, clear) => {
      if (!target) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } else {
        gl.viewport(0, 0, target.width, target.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      }
      if (clear) {
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    };

    return true;
  }

  _getSupportedFormat(gl, inf, fmt, typ) {
    if (!this._supportRTF(gl, inf, fmt, typ)) {
      switch (inf) {
        case gl.R16F:
          return this._getSupportedFormat(gl, gl.RG16F, gl.RG, typ);
        case gl.RG16F:
          return this._getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, typ);
        default:
          return null;
      }
    }
    return { internalFormat: inf, format: fmt };
  }

  _supportRTF(gl, inf, fmt, typ) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, inf, 4, 4, 0, fmt, typ, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0,
    );
    return (
      gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    );
  }

  _compileShader(type, src, keywords) {
    const gl = this.gl;
    if (keywords && keywords.length)
      src = keywords.map((k) => "#define " + k + "\n").join("") + src;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn(
        "SplashCursor: shader compile error",
        type === gl.FRAGMENT_SHADER ? "fragment" : "vertex",
        gl.getShaderInfoLog(s),
      );
    }
    return s;
  }

  _createProgram(vs, fs) {
    const gl = this.gl;
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.warn("SplashCursor: program link error", gl.getProgramInfoLog(p));
    }
    return p;
  }

  _getUniforms(prog) {
    const gl = this.gl;
    const u = {};
    for (let i = 0; i < gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i++) {
      u[gl.getActiveUniform(prog, i).name] = gl.getUniformLocation(
        prog,
        gl.getActiveUniform(prog, i).name,
      );
    }
    return u;
  }

  _compileShaders() {
    const gl = this.gl;

    this._baseVS = this._compileShader(
      gl.VERTEX_SHADER,
      `
      precision highp float;
      attribute vec2 aPosition;
      varying vec2 vUv, vL, vR, vT, vB;
      uniform vec2 texelSize;
      void main() {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }`,
    );

    const mkProg = (fs, kw) => {
      const s = this._compileShader(gl.FRAGMENT_SHADER, fs, kw);
      const p = this._createProgram(this._baseVS, s);
      return {
        prog: p,
        uniforms: this._getUniforms(p),
        bind() {
          gl.useProgram(p);
        },
      };
    };

    this._copyP = mkProg(
      `precision mediump float; precision mediump sampler2D; varying highp vec2 vUv; uniform sampler2D uTexture; void main() { gl_FragColor = texture2D(uTexture, vUv); }`,
    );
    this._clearP = mkProg(
      `precision mediump float; precision mediump sampler2D; varying highp vec2 vUv; uniform sampler2D uTexture; uniform float value; void main() { gl_FragColor = value * texture2D(uTexture, vUv); }`,
    );
    this._splatP = mkProg(
      `precision highp float; precision highp sampler2D; varying vec2 vUv; uniform sampler2D uTarget; uniform float aspectRatio; uniform vec3 color; uniform vec2 point; uniform float radius; void main() { vec2 p = vUv - point.xy; p.x *= aspectRatio; vec3 splat = exp(-dot(p,p)/radius) * color; gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + splat, 1.0); }`,
    );
    this._divP = mkProg(
      `precision mediump float; precision mediump sampler2D; varying highp vec2 vUv, vL, vR, vT, vB; uniform sampler2D uVelocity; void main() { float L=texture2D(uVelocity,vL).x,R=texture2D(uVelocity,vR).x,T=texture2D(uVelocity,vT).y,B=texture2D(uVelocity,vB).y; vec2 C=texture2D(uVelocity,vUv).xy; if(vL.x<0.0)L=-C.x; if(vR.x>1.0)R=-C.x; if(vT.y>1.0)T=-C.y; if(vB.y<0.0)B=-C.y; gl_FragColor = vec4(0.5*(R-L+T-B),0,0,1); }`,
    );
    this._curlP = mkProg(
      `precision mediump float; precision mediump sampler2D; varying highp vec2 vUv, vL, vR, vT, vB; uniform sampler2D uVelocity; void main() { float L=texture2D(uVelocity,vL).y,R=texture2D(uVelocity,vR).y,T=texture2D(uVelocity,vT).x,B=texture2D(uVelocity,vB).x; gl_FragColor = vec4(0.5*(R-L-T+B),0,0,1); }`,
    );
    this._vortP = mkProg(
      `precision highp float; precision highp sampler2D; varying vec2 vUv, vL, vR, vT, vB; uniform sampler2D uVelocity, uCurl; uniform float curl, dt; void main() { float L=texture2D(uCurl,vL).x,R=texture2D(uCurl,vR).x,T=texture2D(uCurl,vT).x,B=texture2D(uCurl,vB).x,C=texture2D(uCurl,vUv).x; vec2 force=0.5*vec2(abs(T)-abs(B),abs(R)-abs(L)); force/=length(force)+0.0001; force*=curl*C; force.y*=-1.0; gl_FragColor=vec4(min(max(texture2D(uVelocity,vUv).xy+force*dt,-1000.0),1000.0),0,1); }`,
    );
    this._presP = mkProg(
      `precision mediump float; precision mediump sampler2D; varying highp vec2 vUv, vL, vR, vT, vB; uniform sampler2D uPressure, uDivergence; void main() { float L=texture2D(uPressure,vL).x,R=texture2D(uPressure,vR).x,T=texture2D(uPressure,vT).x,B=texture2D(uPressure,vB).x; gl_FragColor=vec4((L+R+B+T-texture2D(uDivergence,vUv).x)*0.25,0,0,1); }`,
    );
    this._gradP = mkProg(
      `precision mediump float; precision mediump sampler2D; varying highp vec2 vUv, vL, vR, vT, vB; uniform sampler2D uPressure, uVelocity; void main() { float L=texture2D(uPressure,vL).x,R=texture2D(uPressure,vR).x,T=texture2D(uPressure,vT).x,B=texture2D(uPressure,vB).x; gl_FragColor=vec4(texture2D(uVelocity,vUv).xy-vec2(R-L,T-B),0,1); }`,
    );

    const advSrc = `precision highp float; precision highp sampler2D; varying vec2 vUv; uniform sampler2D uVelocity, uSource; uniform vec2 texelSize, dyeTexelSize; uniform float dt, dissipation; void main(){ vec2 coord=vUv-dt*texture2D(uVelocity,vUv).xy*texelSize; vec4 result=texture2D(uSource,coord); gl_FragColor=result/(1.0+dissipation*dt);}`;
    this._advP = mkProg(advSrc);

    // display: simple program (SHADING baked in, no preprocessor)
    const displaySrc = `precision highp float; precision highp sampler2D; varying vec2 vUv, vL, vR, vT, vB; uniform sampler2D uTexture; uniform vec2 texelSize; vec3 linearToGamma(vec3 c){c=max(c,vec3(0.0));return max(1.055*pow(c,vec3(0.416666667))-0.055,vec3(0.0));} void main(){vec3 c=texture2D(uTexture,vUv).rgb; vec3 lc=texture2D(uTexture,vL).rgb,rc=texture2D(uTexture,vR).rgb,tc=texture2D(uTexture,vT).rgb,bc=texture2D(uTexture,vB).rgb; float dx=length(rc)-length(lc),dy=length(tc)-length(bc); vec3 n=normalize(vec3(dx,dy,length(texelSize))); c*=clamp(dot(n,vec3(0.0,0.0,1.0))+0.7,0.7,1.0); gl_FragColor=vec4(c,max(c.r,max(c.g,c.b)));}`;
    const displayFS = this._compileShader(gl.FRAGMENT_SHADER, displaySrc);
    const displayProg = this._createProgram(this._baseVS, displayFS);
    this._displayProg = displayProg;
    this._displayUniforms = this._getUniforms(displayProg);
  }

  // ── FBOs ──────────────────────────────────────────────────
  _mkFBO(w, h, inf, fmt, typ, param) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, inf, w, h, 0, fmt, typ, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0,
    );
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      texture: tex,
      fbo,
      width: w,
      height: h,
      texelSizeX: 1 / w,
      texelSizeY: 1 / h,
      attach(id) {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        return id;
      },
    };
  }

  _mkDFBO(w, h, inf, fmt, typ, param) {
    const f1 = this._mkFBO(w, h, inf, fmt, typ, param);
    const f2 = this._mkFBO(w, h, inf, fmt, typ, param);
    return {
      width: w,
      height: h,
      texelSizeX: f1.texelSizeX,
      texelSizeY: f1.texelSizeY,
      _r: f1,
      _w: f2,
      get read() {
        return this._r;
      },
      set read(v) {
        this._r = v;
      },
      get write() {
        return this._w;
      },
      set write(v) {
        this._w = v;
      },
      swap() {
        [this._r, this._w] = [this._w, this._r];
      },
    };
  }

  _resizeFBO(tgt, w, h, inf, fmt, typ, param) {
    const n = this._mkFBO(w, h, inf, fmt, typ, param);
    this._copyP.bind();
    this.gl.uniform1i(this._copyP.uniforms.uTexture, tgt.attach(0));
    this._blit(n);
    return n;
  }

  _resizeDFBO(tgt, w, h, inf, fmt, typ, param) {
    if (tgt.width === w && tgt.height === h) return tgt;
    tgt.read = this._resizeFBO(tgt.read, w, h, inf, fmt, typ, param);
    tgt.write = this._mkFBO(w, h, inf, fmt, typ, param);
    tgt.width = w;
    tgt.height = h;
    tgt.texelSizeX = 1 / w;
    tgt.texelSizeY = 1 / h;
    return tgt;
  }

  _getRes(res) {
    const gl = this.gl;
    let ar = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (ar < 1) ar = 1 / ar;
    const mn = Math.round(res),
      mx = Math.round(res * ar);
    return gl.drawingBufferWidth > gl.drawingBufferHeight
      ? { width: mx, height: mn }
      : { width: mn, height: mx };
  }

  _initFBOs() {
    const gl = this.gl;
    const cfg = this.config;
    const sim = this._getRes(cfg.SIM_RESOLUTION);
    const dyeRes = this._getRes(cfg.DYE_RESOLUTION);
    const tt = this._hftt;
    const rgba = this._fmtRGBA,
      rg = this._fmtRG,
      r = this._fmtR;
    const filt = this._slf ? gl.LINEAR : gl.NEAREST;
    gl.disable(gl.BLEND);

    if (!this._dye)
      this._dye = this._mkDFBO(
        dyeRes.width,
        dyeRes.height,
        rgba.internalFormat,
        rgba.format,
        tt,
        filt,
      );
    else
      this._dye = this._resizeDFBO(
        this._dye,
        dyeRes.width,
        dyeRes.height,
        rgba.internalFormat,
        rgba.format,
        tt,
        filt,
      );
    if (!this._vel)
      this._vel = this._mkDFBO(
        sim.width,
        sim.height,
        rg.internalFormat,
        rg.format,
        tt,
        filt,
      );
    else
      this._vel = this._resizeDFBO(
        this._vel,
        sim.width,
        sim.height,
        rg.internalFormat,
        rg.format,
        tt,
        filt,
      );
    this._div = this._mkFBO(
      sim.width,
      sim.height,
      r.internalFormat,
      r.format,
      tt,
      gl.NEAREST,
    );
    this._curl = this._mkFBO(
      sim.width,
      sim.height,
      r.internalFormat,
      r.format,
      tt,
      gl.NEAREST,
    );
    this._pres = this._mkDFBO(
      sim.width,
      sim.height,
      r.internalFormat,
      r.format,
      tt,
      gl.NEAREST,
    );
  }

  // ── color ─────────────────────────────────────────────────
  _hexToRGB(h) {
    let v = h.replace("#", "");
    if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
    return {
      r: (parseInt(v.slice(0, 2), 16) / 255) * 0.35,
      g: (parseInt(v.slice(2, 4), 16) / 255) * 0.35,
      b: (parseInt(v.slice(4, 6), 16) / 255) * 0.35,
    };
  }

  _genColor() {
    if (this.config.RAINBOW_MODE) {
      const c = this._HSVtoRGB(Math.random(), 1, 1);
      return { r: c.r * 0.15, g: c.g * 0.15, b: c.b * 0.15 };
    }
    return this._hexToRGB(this.config.COLOR);
  }

  _HSVtoRGB(h, s, v) {
    let r, g, b;
    const i = Math.floor(h * 6),
      f = h * 6 - i,
      p = v * (1 - s),
      q = v * (1 - f * s),
      t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0:
        r = v;
        g = t;
        b = p;
        break;
      case 1:
        r = q;
        g = v;
        b = p;
        break;
      case 2:
        r = p;
        g = v;
        b = t;
        break;
      case 3:
        r = p;
        g = q;
        b = v;
        break;
      case 4:
        r = t;
        g = p;
        b = v;
        break;
      case 5:
        r = v;
        g = p;
        b = q;
        break;
    }
    return { r, g, b };
  }

  // ── simulation ────────────────────────────────────────────
  _resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      return true;
    }
    return false;
  }

  _splat(x, y, dx, dy, color) {
    const gl = this.gl;
    this._splatP.bind();
    gl.uniform1i(this._splatP.uniforms.uTarget, this._vel.read.attach(0));
    gl.uniform1f(
      this._splatP.uniforms.aspectRatio,
      this.canvas.width / this.canvas.height,
    );
    gl.uniform2f(this._splatP.uniforms.point, x, y);
    gl.uniform3f(this._splatP.uniforms.color, dx, dy, 0);
    const r = this.config.SPLAT_RADIUS / 100;
    const ar = this.canvas.width / this.canvas.height;
    gl.uniform1f(this._splatP.uniforms.radius, ar > 1 ? r * ar : r);
    this._blit(this._vel.write);
    this._vel.swap();

    gl.uniform1i(this._splatP.uniforms.uTarget, this._dye.read.attach(0));
    gl.uniform3f(this._splatP.uniforms.color, color.r, color.g, color.b);
    this._blit(this._dye.write);
    this._dye.swap();
  }

  _splatPointer(p) {
    this._splat(
      p.texcoordX,
      p.texcoordY,
      p.deltaX * this.config.SPLAT_FORCE,
      p.deltaY * this.config.SPLAT_FORCE,
      p.color,
    );
  }

  _clickSplat(p) {
    const c = this._genColor();
    this._splat(
      p.texcoordX,
      p.texcoordY,
      10 * (Math.random() - 0.5),
      30 * (Math.random() - 0.5),
      { r: c.r * 10, g: c.g * 10, b: c.b * 10 },
    );
  }

  _step(dt) {
    const gl = this.gl;
    gl.disable(gl.BLEND);

    // curl
    this._curlP.bind();
    gl.uniform2f(
      this._curlP.uniforms.texelSize,
      this._vel.texelSizeX,
      this._vel.texelSizeY,
    );
    gl.uniform1i(this._curlP.uniforms.uVelocity, this._vel.read.attach(0));
    this._blit(this._curl);

    // vorticity
    this._vortP.bind();
    gl.uniform2f(
      this._vortP.uniforms.texelSize,
      this._vel.texelSizeX,
      this._vel.texelSizeY,
    );
    gl.uniform1i(this._vortP.uniforms.uVelocity, this._vel.read.attach(0));
    gl.uniform1i(this._vortP.uniforms.uCurl, this._curl.attach(1));
    gl.uniform1f(this._vortP.uniforms.curl, this.config.CURL);
    gl.uniform1f(this._vortP.uniforms.dt, dt);
    this._blit(this._vel.write);
    this._vel.swap();

    // divergence
    this._divP.bind();
    gl.uniform2f(
      this._divP.uniforms.texelSize,
      this._vel.texelSizeX,
      this._vel.texelSizeY,
    );
    gl.uniform1i(this._divP.uniforms.uVelocity, this._vel.read.attach(0));
    this._blit(this._div);

    // pressure clear
    this._clearP.bind();
    gl.uniform1i(this._clearP.uniforms.uTexture, this._pres.read.attach(0));
    gl.uniform1f(this._clearP.uniforms.value, this.config.PRESSURE);
    this._blit(this._pres.write);
    this._pres.swap();

    // pressure solve
    this._presP.bind();
    gl.uniform2f(
      this._presP.uniforms.texelSize,
      this._vel.texelSizeX,
      this._vel.texelSizeY,
    );
    gl.uniform1i(this._presP.uniforms.uDivergence, this._div.attach(0));
    for (let i = 0; i < this.config.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(this._presP.uniforms.uPressure, this._pres.read.attach(1));
      this._blit(this._pres.write);
      this._pres.swap();
    }

    // gradient subtract
    this._gradP.bind();
    gl.uniform2f(
      this._gradP.uniforms.texelSize,
      this._vel.texelSizeX,
      this._vel.texelSizeY,
    );
    gl.uniform1i(this._gradP.uniforms.uPressure, this._pres.read.attach(0));
    gl.uniform1i(this._gradP.uniforms.uVelocity, this._vel.read.attach(1));
    this._blit(this._vel.write);
    this._vel.swap();

    // velocity advection
    this._advP.bind();
    gl.uniform2f(
      this._advP.uniforms.texelSize,
      this._vel.texelSizeX,
      this._vel.texelSizeY,
    );
    if (!this._slf)
      gl.uniform2f(
        this._advP.uniforms.dyeTexelSize,
        this._vel.texelSizeX,
        this._vel.texelSizeY,
      );
    const vid = this._vel.read.attach(0);
    gl.uniform1i(this._advP.uniforms.uVelocity, vid);
    gl.uniform1i(this._advP.uniforms.uSource, vid);
    gl.uniform1f(this._advP.uniforms.dt, dt);
    gl.uniform1f(
      this._advP.uniforms.dissipation,
      this.config.VELOCITY_DISSIPATION,
    );
    this._blit(this._vel.write);
    this._vel.swap();

    // dye advection
    if (!this._slf)
      gl.uniform2f(
        this._advP.uniforms.dyeTexelSize,
        this._dye.texelSizeX,
        this._dye.texelSizeY,
      );
    gl.uniform1i(this._advP.uniforms.uVelocity, this._vel.read.attach(0));
    gl.uniform1i(this._advP.uniforms.uSource, this._dye.read.attach(1));
    gl.uniform1f(
      this._advP.uniforms.dissipation,
      this.config.DENSITY_DISSIPATION,
    );
    this._blit(this._dye.write);
    this._dye.swap();
  }

  _render() {
    const gl = this.gl;
    if (!this._displayProg) return;
    // unbind any FBO first to prevent feedback loop
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);
    gl.useProgram(this._displayProg);
    if (this.config.SHADING && this._displayUniforms)
      gl.uniform2f(
        this._displayUniforms.texelSize,
        1 / gl.drawingBufferWidth,
        1 / gl.drawingBufferHeight,
      );
    if (this._displayUniforms)
      gl.uniform1i(this._displayUniforms.uTexture, this._dye.read.attach(0));
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  _frame(t) {
    if (!this.isActive) return;
    // try WebGL path
    if (this.gl) {
      const dt = Math.min((t - (this._lastFrameTime || t)) / 1000, 0.016666);
      this._lastFrameTime = t;
      if (this._resizeCanvas()) this._initFBOs();
      this.colorTimer += dt * this.config.COLOR_UPDATE_SPEED;
      if (this.colorTimer >= 1) {
        this.colorTimer = ((this.colorTimer % 1) + 1) % 1;
        this.pointers.forEach((p) => {
          p.color = this._genColor();
        });
      }
      this.pointers.forEach((p) => {
        if (p.moved) {
          p.moved = false;
          this._splatPointer(p);
        }
      });
      if (this._vel && this._dye) this._step(dt);
      if (this._dye) this._render();
      this.animId = requestAnimationFrame((tt) => this._frame(tt));
      return;
    }
    // fallback: Canvas 2D
    this._frame2D(t);
  }

  // ── events ────────────────────────────────────────────────
  _scale(v) {
    return Math.floor(v * (window.devicePixelRatio || 1));
  }

  _onMouseDown(e) {
    const p = this.pointers[0];
    const x = this._scale(e.clientX),
      y = this._scale(e.clientY);
    p.id = -1;
    p.down = true;
    p.moved = false;
    p.prevTexcoordX = p.texcoordX = this.canvas.width
      ? x / this.canvas.width
      : 0;
    p.prevTexcoordY = p.texcoordY = this.canvas.width
      ? 1 - y / this.canvas.height
      : 0;
    p.deltaX = 0;
    p.deltaY = 0;
    p.color = this._genColor();
    if (this.gl && this.canvas.width > 0) this._clickSplat(p);
    if (this._fallback2D) this._fallbackSplat(x, y, 1.5);
  }

  _onMouseMove(e) {
    const p = this.pointers[0];
    const x = this._scale(e.clientX),
      y = this._scale(e.clientY);
    p.prevTexcoordX = p.texcoordX;
    p.prevTexcoordY = p.texcoordY;
    p.texcoordX = this.canvas.width ? x / this.canvas.width : 0;
    p.texcoordY = this.canvas.width ? 1 - y / this.canvas.height : 0;
    const dx = p.texcoordX - p.prevTexcoordX,
      dy = p.texcoordY - p.prevTexcoordY;
    const ar = this.canvas.width / this.canvas.height || 1;
    p.deltaX = ar < 1 ? dx * ar : dx;
    p.deltaY = ar > 1 ? dy / ar : dy;
    p.moved = Math.abs(p.deltaX) > 0 || Math.abs(p.deltaY) > 0;
    if (!this.firstMove) {
      p.color = this._genColor();
      this.firstMove = true;
    }
    // fallback 2D mouse tracking
    this._fbMX = Math.floor(e.clientX);
    this._fbMY = Math.floor(e.clientY);
  }

  _onResize() {
    if (this.gl && this._resizeCanvas()) this._initFBOs();
    if (this._fallback2D) this._fbResize();
  }

  // ==================== CANVAS 2D FALLBACK ===================
  _initCanvas2D() {
    this.ctx2d = this.canvas.getContext("2d");
    this._fallback2D = true;
    this._fbParticles = [];
    this._fbMX = -100;
    this._fbMY = -100;
    this._fbPMX = -100;
    this._fbPMY = -100;
    this._fbDown = false;
    this._fbResize();
    this.canvas.addEventListener("mousedown", (e) => {
      this._fbDown = true;
      this._fbMX = e.clientX;
      this._fbMY = e.clientY;
      this._fbPMX = e.clientX;
      this._fbPMY = e.clientY;
      this._fallbackSplat(e.clientX, e.clientY, 1.5);
    });
    this.canvas.addEventListener("mousemove", (e) => {
      this._fbMX = e.clientX;
      this._fbMY = e.clientY;
    });
    this.canvas.addEventListener("mouseup", () => {
      this._fbDown = false;
    });
  }

  _fbResize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
    if (this.ctx2d) this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _fallbackSplat(x, y, force) {
    const c = this.config.COLOR;
    const v = c.replace("#", "");
    const r = parseInt(v.slice(0, 2), 16),
      g = parseInt(v.slice(2, 4), 16),
      b = parseInt(v.slice(4, 6), 16);
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2,
        s = (0.3 + Math.random() * 1.7) * force;
      this._fbParticles.push({
        x,
        y,
        vx: Math.cos(a) * s * 3,
        vy: Math.sin(a) * s * 3,
        life: 0.6 + Math.random() * 1.2,
        maxLife: 1.8,
        size: 1.5 + Math.random() * 4,
        r,
        g,
        b,
      });
    }
    if (this._fbParticles.length > 300) this._fbParticles.splice(0, 30);
  }

  _frame2D() {
    if (!this.isActive || !this.ctx2d) return;
    const ctx = this.ctx2d;
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);

    // trail
    if (this._fbMX >= 0 && this._fbPMX >= 0) {
      const dx = this._fbMX - this._fbPMX,
        dy = this._fbMY - this._fbPMY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= 2) {
        const c = this.config.COLOR,
          v = c.replace("#", "");
        const r = parseInt(v.slice(0, 2), 16),
          g = parseInt(v.slice(2, 4), 16),
          b = parseInt(v.slice(4, 6), 16);
        const steps = Math.ceil(dist / 8);
        for (let i = 0; i < steps; i++) {
          const t = i / steps;
          this._fbParticles.push({
            x: this._fbPMX + dx * t,
            y: this._fbPMY + dy * t,
            vx: dx * 0.1,
            vy: dy * 0.1,
            life: 0.3 + Math.random() * 0.5,
            maxLife: 0.8,
            size: 1 + Math.random() * 3,
            r,
            g,
            b,
          });
        }
      }
    }
    this._fbPMX = this._fbMX;
    this._fbPMY = this._fbMY;
    if (this._fbDown) this._fallbackSplat(this._fbMX, this._fbMY, 0.5);

    // draw particles
    const dt = 1 / 60;
    for (let i = this._fbParticles.length - 1; i >= 0; i--) {
      const p = this._fbParticles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this._fbParticles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      const alpha = Math.min(p.life / p.maxLife, 1) * 0.8;
      const sz = p.size * (0.3 + 0.7 * (p.life / p.maxLife));
      ctx.beginPath();
      ctx.arc(p.x, p.y, sz, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${alpha})`;
      ctx.fill();
    }
    if (this._fbParticles.length > 300) this._fbParticles.splice(0, 100);
    this.animId = requestAnimationFrame(() => this._frame2D());
  }
}

function PointerProto() {
  this.id = -1;
  this.texcoordX = 0;
  this.texcoordY = 0;
  this.prevTexcoordX = 0;
  this.prevTexcoordY = 0;
  this.deltaX = 0;
  this.deltaY = 0;
  this.down = false;
  this.moved = false;
  this.color = [0, 0, 0];
}
