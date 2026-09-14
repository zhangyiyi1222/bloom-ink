/* =====================================================================
   BLOOM / INK 世界渲染器
   一个全屏 WebGL 画布承担三件事：
   1. BLOOM：把生成图当作“原料”吸收进画面，叠加有机噪声、域扭曲、柔光、
      粒子与视差，看起来像浏览器自己开了一朵花，而不是贴了一张图。
   2. INK：宣纸纸纹、薄雾、极慢的墨色呼吸。
   3. 转场：墨点落下 → 不规则毛边扩散（不是圆形 clip-path）；
      以及反向的“再生”：嫩绿 → 粉 → 蓝 → 阳光黄 从墨里长出来，再把墨溶解开。
   ===================================================================== */

const VERT = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform float uWorld;
uniform float uMode;
uniform float uProgress;
uniform vec2 uOrigin;
uniform vec2 uMouse;
uniform float uOct;
uniform float uMotion;
uniform sampler2D uBloom;
uniform sampler2D uInk;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p, float octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (float(i) >= octaves) break;
    sum += amp * vnoise(p);
    norm += amp;
    amp *= 0.5;
    p = p * 2.03 + vec2(7.1, 3.7);
  }
  return sum / max(norm, 0.0001);
}

vec3 bloomPalette(float t) {
  vec3 c0 = vec3(0.965, 0.980, 0.955);
  vec3 c1 = vec3(0.640, 0.835, 0.610);
  vec3 c2 = vec3(0.545, 0.820, 0.780);
  vec3 c3 = vec3(0.645, 0.805, 0.915);
  vec3 c4 = vec3(0.960, 0.715, 0.775);
  vec3 c5 = vec3(0.938, 0.530, 0.600);
  vec3 c6 = vec3(0.695, 0.615, 0.860);
  vec3 c7 = vec3(0.972, 0.880, 0.470);
  vec3 c8 = vec3(0.960, 0.690, 0.430);
  vec3 c9 = vec3(0.910, 0.770, 0.415);
  vec3 c10 = vec3(0.985, 0.975, 0.945);
  vec3 c = mix(c0, c1, smoothstep(0.00, 0.13, t));
  c = mix(c, c2, smoothstep(0.11, 0.25, t));
  c = mix(c, c3, smoothstep(0.23, 0.37, t));
  c = mix(c, c4, smoothstep(0.35, 0.49, t));
  c = mix(c, c5, smoothstep(0.47, 0.58, t));
  c = mix(c, c6, smoothstep(0.56, 0.68, t));
  c = mix(c, c7, smoothstep(0.66, 0.77, t));
  c = mix(c, c8, smoothstep(0.75, 0.86, t));
  c = mix(c, c9, smoothstep(0.84, 0.93, t));
  c = mix(c, c10, smoothstep(0.91, 1.00, t));
  return c;
}

float softParticles(vec2 uv, float t) {
  float acc = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 c = vec2(
      fract(0.13 + fi * 0.191 + 0.035 * sin(t * 0.045 + fi * 1.7)),
      fract(0.24 + fi * 0.163 + 0.028 * cos(t * 0.038 + fi * 2.3))
    );
    vec2 d = (uv - c) * vec2(uRes.x / uRes.y, 1.0);
    float r = length(d);
    float radius = 0.16 + 0.09 * hash(vec2(fi, 3.0));
    acc += smoothstep(radius, 0.0, r) * (0.32 + 0.22 * sin(t * 0.22 + fi * 2.1));
  }
  return acc;
}

vec3 bloomScene(vec2 uv, float t) {
  vec2 aspect = vec2(uRes.x / uRes.y, 1.0);
  vec2 par = (uMouse - 0.5) * 0.028;

  vec2 q = vec2(
    fbm(uv * 1.9 + par + vec2(0.0, t * 0.012), uOct),
    fbm(uv * 1.9 + par + vec2(5.2, 1.3) - t * 0.010, uOct)
  );
  vec2 r = uv + (q - 0.5) * 0.36;
  r += vec2(sin(t * 0.021 + uv.y * 3.1), cos(t * 0.017 + uv.x * 2.6)) * 0.012 * uMotion;

  vec3 photo = texture2D(uBloom, clamp(r, vec2(0.002), vec2(0.998))).rgb;

  float field = fbm(r * 2.35 + q * 0.85, min(6.0, uOct + 1.0));
  field = clamp(field * 1.28 - 0.10, 0.0, 1.0);
  vec3 life = bloomPalette(field);

  float glow = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 c = vec2(0.18 + fi * 0.32, 0.30 + 0.22 * sin(fi * 2.4 + t * 0.03));
    float d = length((uv - c) * aspect);
    glow += exp(-d * d * 7.0) * 0.36;
  }
  vec3 warm = vec3(1.0, 0.952, 0.855);

  vec3 col = mix(life, photo, 0.34);
  col += warm * glow * 0.30 * uMotion;
  col += vec3(0.62, 0.86, 0.70) * softParticles(uv, t) * 0.16 * uMotion;
  col += pow(max(col - vec3(0.72), vec3(0.0)), vec3(1.35)) * 0.85;

  float radial = length((uv - vec2(0.5, 0.46)) * vec2(1.32, 1.02));
  float veil = smoothstep(0.06, 0.72, radial);
  vec3 airy = mix(vec3(0.995, 0.995, 0.985), col, 0.42);
  vec3 vivid = mix(vec3(0.992, 0.992, 0.982), col, 0.94);
  col = mix(airy, vivid, veil);
  col = mix(vec3(0.995, 0.996, 0.990), col, smoothstep(0.0, 0.16, uv.y));
  return clamp(col, 0.0, 1.0);
}

vec3 inkScene(vec2 uv, float t) {
  vec3 paper = texture2D(uInk, clamp(uv, vec2(0.002), vec2(0.998))).rgb;

  float fiber = fbm(vec2(uv.x * 34.0, uv.y * 7.5) + 1.7, 3.0) - 0.5;
  float grain = fbm(uv * 26.0, 2.0) - 0.5;

  float mist = smoothstep(0.35, 0.92, fbm(vec2(uv.x * 1.15, uv.y * 2.5) + t * 0.006, 4.0));
  mist *= smoothstep(0.12, 0.5, uv.y) * 0.5;
  vec3 mistCol = vec3(0.995, 0.992, 0.980);

  float breath = 0.5 + 0.5 * sin(t * 0.045);
  float wash = fbm(uv * 1.35 + vec2(0.0, t * 0.004), 4.0) - 0.5;

  vec3 col = paper;
  col += fiber * 0.026;
  col += grain * 0.012;
  col -= vec3(0.030, 0.028, 0.024) * max(wash, 0.0) * (0.45 + 0.30 * breath) * uMotion;
  col = mix(col, mistCol, mist * 0.55 * uMotion);

  float radial = length((uv - 0.5) * vec2(1.1, 0.85));
  col -= vec3(0.028, 0.026, 0.022) * smoothstep(0.42, 1.0, radial);
  return clamp(col, 0.0, 1.0);
}

// 墨的覆盖度：多尺度噪声 + 纸纤维 ⇒ 毛边、停顿、分叉
float inkCoverage(vec2 uv, float prog) {
  float big = fbm(uv * 2.15 + 11.3, 4.0);
  float branch = fbm(uv * 5.4 - 3.1, 4.0);
  float fiber = fbm(vec2(uv.x * 27.0, uv.y * 8.0), 3.0);
  float m = mix(big, branch, 0.46) + (fiber - 0.5) * 0.17;

  float thr = prog * 1.52 - 0.26;
  float cov = smoothstep(m - 0.23, m + 0.23, thr);

  vec2 d2 = (uv - uOrigin) * vec2(uRes.x / uRes.y, 1.0);
  float dist = length(d2);
  float seed = 1.0 - smoothstep(0.015, 0.10 + 0.75 * prog, dist * (1.0 - 0.32 * fiber));
  cov = max(cov, seed * (1.0 - smoothstep(0.28, 0.85, prog)));
  return clamp(cov, 0.0, 1.0);
}

void main() {
  vec2 uv = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);
  float t = uTime;

  vec3 bloomCol = bloomScene(uv, t);
  vec3 inkCol = inkScene(uv, t);

  vec3 col;
  if (uMode < 0.5) {
    col = mix(bloomCol, inkCol, uWorld);
  } else if (uMode < 1.5) {
    // BLOOM → INK：湿墨落入宣纸，边缘毛糙，前沿有湿润的深色
    float cov = inkCoverage(uv, uProgress);
    float band = 1.0 - abs(cov * 2.0 - 1.0);
    vec3 wet = inkCol * (1.0 - 0.16 * band) - vec3(0.05, 0.048, 0.044) * band;
    col = mix(bloomCol, wet, cov);
    col += vec3(0.035, 0.030, 0.020) * band * (1.0 - uProgress) * 0.9;
  } else {
    // INK → BLOOM：从墨里重新生长
    float cov = inkCoverage(uv, 1.0 - uProgress);
    vec3 base = mix(bloomCol, inkCol, cov);

    float n1 = fbm(uv * 3.1 + 4.7, 4.0);
    float n2 = fbm(uv * 3.7 - 8.2, 4.0);
    float n3 = fbm(uv * 2.6 + 15.4, 4.0);
    float n4 = fbm(uv * 4.3 - 2.9, 4.0);

    float g = smoothstep(0.06, 0.40, uProgress) * smoothstep(0.42, 0.72, n1);
    float pk = smoothstep(0.26, 0.58, uProgress) * smoothstep(0.46, 0.74, n2);
    float bl = smoothstep(0.46, 0.78, uProgress) * smoothstep(0.44, 0.72, n3);
    float yl = smoothstep(0.68, 0.96, uProgress) * smoothstep(0.48, 0.76, n4);

    base = mix(base, vec3(0.545, 0.815, 0.520), g * 0.55);
    base = mix(base, vec3(0.965, 0.700, 0.775), pk * 0.55);
    base = mix(base, vec3(0.600, 0.780, 0.925), bl * 0.55);
    base = mix(base, vec3(0.985, 0.895, 0.470), yl * 0.55);

    float band = 1.0 - abs(cov * 2.0 - 1.0);
    base += vec3(0.10, 0.10, 0.075) * band * smoothstep(0.25, 0.9, uProgress) * 0.7;
    col = base;
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader 编译失败：${log}`);
  }
  return shader;
}

function createProgram(gl) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`shader 链接失败：${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

function createTexture(gl, image) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (image) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  } else {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 252, 255])
    );
  }
  return texture;
}

function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/* 转场进度曲线：带停顿和加速，像墨真的在吸进纸里 */
function easeInk(progress) {
  const x = Math.min(1, Math.max(0, progress));
  const eased = x * x * (3 - 2 * x);
  const stalls = Math.sin(Math.PI * x) * Math.sin(x * Math.PI * 2.6) * 0.03;
  return Math.min(1, Math.max(0, eased * 0.94 + x * 0.06 + stalls));
}

function easeRebirth(progress) {
  const x = Math.min(1, Math.max(0, progress));
  const eased = 1 - Math.pow(1 - x, 2.4);
  const stalls = Math.sin(Math.PI * x) * Math.sin(x * Math.PI * 3.1) * 0.03;
  return Math.min(1, Math.max(0, eased + stalls));
}

export function createWorld(canvas, options = {}) {
  const reduceMotion =
    options.reduceMotion ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const lowPower = coarse || (navigator.hardwareConcurrency || 4) <= 4;

  let gl = null;
  try {
    gl = canvas.getContext('webgl', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: lowPower ? 'low-power' : 'high-performance',
      preserveDrawingBuffer: false,
    });
  } catch {
    gl = null;
  }

  if (!gl) {
    return {
      ok: false,
      setWorld: () => Promise.resolve(),
      playTransition: () => Promise.resolve(),
      setVisible() {},
      destroy() {},
    };
  }

  const program = createProgram(gl);
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uniforms = {
    res: gl.getUniformLocation(program, 'uRes'),
    time: gl.getUniformLocation(program, 'uTime'),
    world: gl.getUniformLocation(program, 'uWorld'),
    mode: gl.getUniformLocation(program, 'uMode'),
    progress: gl.getUniformLocation(program, 'uProgress'),
    origin: gl.getUniformLocation(program, 'uOrigin'),
    mouse: gl.getUniformLocation(program, 'uMouse'),
    oct: gl.getUniformLocation(program, 'uOct'),
    motion: gl.getUniformLocation(program, 'uMotion'),
    bloom: gl.getUniformLocation(program, 'uBloom'),
    ink: gl.getUniformLocation(program, 'uInk'),
  };

  const state = {
    world: options.world === 'ink' ? 1 : 0,
    mode: 0,
    progress: 0,
    time: 0,
    origin: [0.5, 0.45],
    mouse: [0.5, 0.5],
    targetMouse: [0.5, 0.5],
    oct: reduceMotion ? 2 : lowPower ? 3 : 5,
    motion: reduceMotion ? 0.12 : 1,
    running: true,
    visible: true,
    last: performance.now(),
    transition: null,
  };

  gl.uniform1i(uniforms.bloom, 0);
  gl.uniform1i(uniforms.ink, 1);

  const bloomTexture = createTexture(gl, null);
  const inkTexture = createTexture(gl, null);

  Promise.all([loadImage(options.bloomUrl), loadImage(options.inkUrl)]).then(
    ([bloomImage, inkImage]) => {
      if (bloomImage) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, bloomTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bloomImage);
      }
      if (inkImage) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, inkTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, inkImage);
      }
    }
  );

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1.25 : 1.6);
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uniforms.res, canvas.width, canvas.height);
  }

  function frame(now) {
    if (!state.running) return;
    requestAnimationFrame(frame);
    if (!state.visible) {
      state.last = now;
      return;
    }

    const dt = Math.min(64, now - state.last);
    state.last = now;

    // 入墨稳定后基本停下，只留极慢的墨色呼吸；手机整体降帧
    state.time += dt / 1000;

    if (state.transition) {
      const tr = state.transition;
      tr.elapsed += dt / 1000;
      const raw = Math.min(1, tr.elapsed / tr.duration);
      if (tr.mode === 0) {
        state.mode = 0;
        state.progress = 0;
        state.world = tr.from + (tr.target - tr.from) * raw;
      } else {
        state.mode = tr.mode;
        state.progress = tr.mode === 1 ? easeInk(raw) : easeRebirth(raw);
        state.origin = tr.origin;
      }
      if (raw >= 1) {
        state.mode = 0;
        state.progress = 0;
        state.world = tr.target;
        state.transition = null;
        tr.resolve();
      }
    }

    state.mouse[0] += (state.targetMouse[0] - state.mouse[0]) * 0.06;
    state.mouse[1] += (state.targetMouse[1] - state.mouse[1]) * 0.06;

    resize();
    gl.uniform1f(uniforms.time, reduceMotion ? state.time * 0.25 : state.time);
    gl.uniform1f(uniforms.world, state.world);
    gl.uniform1f(uniforms.mode, state.mode);
    gl.uniform1f(uniforms.progress, state.progress);
    gl.uniform2f(uniforms.origin, state.origin[0], state.origin[1]);
    gl.uniform2f(uniforms.mouse, state.mouse[0], state.mouse[1]);
    gl.uniform1f(uniforms.oct, state.oct);
    gl.uniform1f(uniforms.motion, state.motion);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bloomTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, inkTexture);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  requestAnimationFrame((now) => {
    state.last = now;
    frame(now);
  });

  const onVisibility = () => {
    state.visible = !document.hidden;
    state.last = performance.now();
  };
  document.addEventListener('visibilitychange', onVisibility);

  const onPointerMove = (event) => {
    state.targetMouse[0] = event.clientX / window.innerWidth;
    state.targetMouse[1] = event.clientY / window.innerHeight;
  };
  if (!coarse) window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('resize', resize);

  function playTransition(target, config = {}) {
    if (state.transition) {
      const pending = state.transition;
      state.transition = null;
      state.world = pending.target;
      pending.resolve();
    }
    const origin = config.origin || [0.5, 0.42];
    state.origin = [origin[0], Math.max(0, Math.min(1, origin[1]))];
    const mode = reduceMotion ? 0 : config.mode ?? (target === 1 ? 1 : 2);
    const duration = config.duration ?? (reduceMotion ? 0.45 : target === 1 ? 2.6 : 3.2);
    const from = state.world;

    return new Promise((resolve) => {
      state.transition = { mode, from, target, elapsed: 0, duration, origin: state.origin, resolve };
    });
  }

  return {
    ok: true,
    setWorld(world, config) {
      const target = world === 'ink' ? 1 : 0;
      if (target === state.world && state.mode === 0) return Promise.resolve();
      return playTransition(target, config || {});
    },
    playTransition,
    setVisible(visible) {
      state.visible = visible;
      state.last = performance.now();
    },
    destroy() {
      state.running = false;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
    },
  };
}

export const worldUtils = { easeInk, easeRebirth };
