/* ============================================================
   3D terrain view (WebGL mesh + canvas-2D draped overlays)
   ============================================================ */

const GL_CANVAS = $("#gl");

function is3DActive() { return !!(cam3d && cam3d.active); }

function seaLevel3d() {
  if (!data) return 0;
  return settings.seaAuto ? data.terrain.waterLevel : settings.seaLevel;
}

/* Elevation used for geometry: water surfaces are flattened to sea level so
   lakes read as flat water instead of deep pits. When the WebGL terrain mesh is
   present this samples the *same* triangulated surface the depth pass renders
   (reproducing its vertex heights and diagonal split) instead of the raw
   heightfield. That removes the mesh-vs-heightmap mismatch under every overlay,
   which was the source of the 3D occlusion flicker. */
function z3dAt(wx, wy) {
  if (!data) return 0;
  const m = gl3d && gl3d.mesh;
  if (m && m.heights && wx >= m.x0 && wx <= m.x1 && wy >= m.y0 && wy <= m.y1) {
    const fi = (wx - m.x0) / m.dx, fj = (wy - m.y0) / m.dy;
    const i = clamp(Math.floor(fi), 0, m.nx - 2);
    const j = clamp(Math.floor(fj), 0, m.ny - 2);
    const u = fi - i, v = fj - j;
    const H = m.heights, nx = m.nx;
    const za = H[j * nx + i], zb = H[j * nx + i + 1];
    const zc = H[(j + 1) * nx + i], zd = H[(j + 1) * nx + i + 1];
    // mesh triangulation splits each cell a(i,j)-b(i+1,j)-c(i,j+1)-d(i+1,j+1)
    // into a-c-b and b-c-d
    if (u + v <= 1) return za + (zb - za) * u + (zc - za) * v;
    return (1 - v) * zb + (1 - u) * zc + (u + v - 1) * zd;
  }
  return Math.max(seaLevel3d(), elevationAt(wx, wy));
}

/* Project a north-up screen point (sx,sy) into the tilted 3D view, given its
   world elevation z (metres). */
function tiltPt3D(sx, sy, z, s) {
  const [tx, ty] = tiltPt(sx, sy, stageW / 2, stageH / 2);
  if (!cam3d) return [tx, ty];
  // Match computeCamera3D's z term exactly, including the vertical exaggeration
  // (m[9] = f2 * -s * exag * sinP); omitting exag projected overlays well below
  // the terrain and made the CPU depth test sample the wrong pixel.
  return [tx, ty - z * s * cam3d.exag * cam3d.sinP];
}

/* Normalised depth [0..1] of a world point, matching the WebGL depth buffer. */
function depthOfPoint(wx, wy, wz) {
  if (!cam3d) return 1;
  const d = cam3d.d00 * wx + cam3d.d01 * wy + cam3d.d02 * wz;
  return clamp((d - cam3d.dMin) / (cam3d.dMax - cam3d.dMin), 0, 1);
}

/* ---------------- WebGL initialisation ---------------- */
function init3D() {
  if (gl3d) return gl3d.ok;
  if (!window.WebGL2RenderingContext) { gl3d = { ok: false }; return false; }
  const gl = GL_CANVAS.getContext("webgl2", {
    alpha: true, premultipliedAlpha: false, antialias: true,
    depth: true, stencil: false, preserveDrawingBuffer: true
  });
  if (!gl) { gl3d = { ok: false }; return false; }

  const vs = compileShader(gl, VERT3D, gl.VERTEX_SHADER);
  const fs = compileShader(gl, FRAG3D, gl.FRAGMENT_SHADER);
  if (!vs || !fs) { gl3d = { ok: false }; return false; }
  const prog = linkProgram(gl, vs, fs);
  if (!prog) { gl3d = { ok: false }; return false; }

  const attribs = {
    aPos: gl.getAttribLocation(prog, "aPos"),
    aUV: gl.getAttribLocation(prog, "aUV"),
    aShade: gl.getAttribLocation(prog, "aShade"),
    aSide: gl.getAttribLocation(prog, "aSide"),
  };
  const uniforms = {
    uMatrix: gl.getUniformLocation(prog, "uMatrix"),
    uTex: gl.getUniformLocation(prog, "uTex"),
    uUseTex: gl.getUniformLocation(prog, "uUseTex"),
    uSolid: gl.getUniformLocation(prog, "uSolid"),
    uSideColor: gl.getUniformLocation(prog, "uSideColor"),
    uDepthPass: gl.getUniformLocation(prog, "uDepthPass"),
    uDepthRange: gl.getUniformLocation(prog, "uDepthRange"),
    uDepthDir: gl.getUniformLocation(prog, "uDepthDir"),
  };

  const vbo = gl.createBuffer();
  const ibo = gl.createBuffer();

  gl3d = {
    ok: true, gl, prog, attribs, uniforms, vbo, ibo,
    mesh: null, texture: null, texVersion: -1,
    fb: null, depthRbo: null, colorTex: null,
    depthBuf: null, depthW: 0, depthH: 0,
  };
  createDepthFBO();

  GL_CANVAS.addEventListener("webglcontextlost", e => { e.preventDefault(); gl3d.ok = false; });
  GL_CANVAS.addEventListener("webglcontextrestored", () => { gl3d = null; requestRender(); });
  resize3D();
  return true;
}

function createDepthFBO() {
  if (!gl3d || !gl3d.ok) return;
  const gl = gl3d.gl;
  gl3d.fb = gl.createFramebuffer();
  gl3d.depthRbo = gl.createRenderbuffer();
  gl3d.colorTex = gl.createTexture();
}

function compileShader(gl, src, type) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); gl.deleteShader(s); return null; }
  return s;
}
function linkProgram(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, vs); gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(p)); gl.deleteProgram(p); return null; }
  return p;
}

const VERT3D = `#version 300 es
precision highp float;
in vec3 aPos;
in vec2 aUV;
in float aShade;
in float aSide;
uniform mat4 uMatrix;
uniform vec3 uDepthDir;
out vec2 vUV;
out float vShade;
out float vDepth;
out float vSide;
void main() {
  gl_Position = uMatrix * vec4(aPos, 1.0);
  vUV = aUV;
  vShade = aShade;
  vSide = aSide;
  vDepth = dot(aPos, uDepthDir);
}`;

const FRAG3D = `#version 300 es
precision highp float;
in vec2 vUV;
in float vShade;
in float vDepth;
in float vSide;
uniform sampler2D uTex;
uniform bool uUseTex;
uniform bool uDepthPass;
uniform vec2 uDepthRange;
uniform vec3 uSolid;
uniform vec3 uSideColor;
out vec4 outColor;
void main() {
  if (uDepthPass) {
    float d = clamp((vDepth - uDepthRange.x) / (uDepthRange.y - uDepthRange.x), 0.0, 1.0);
    uint u = uint(d * 4294967295.0);
    outColor = vec4(
      float( u        & 0xffu) / 255.0,
      float((u >>  8) & 0xffu) / 255.0,
      float((u >> 16) & 0xffu) / 255.0,
      float((u >> 24) & 0xffu) / 255.0
    );
    return;
  }
  if (vSide > 0.5) {
    outColor = vec4(uSideColor, 1.0);
    return;
  }
  vec3 c = uUseTex ? texture(uTex, vUV).rgb : uSolid;
  outColor = vec4(c * vShade, 1.0);
}`;

function resize3D() {
  if (!gl3d || !gl3d.ok) return;
  const gl = gl3d.gl;
  const w = Math.round(stageW * dpr), h = Math.round(stageH * dpr);
  GL_CANVAS.width = w; GL_CANVAS.height = h;
  gl.viewport(0, 0, w, h);
  resizeDepthFBO();
}

function resizeDepthFBO() {
  if (!gl3d || !gl3d.fb) return;
  const gl = gl3d.gl;
  const w = Math.max(1, Math.round(stageW * dpr));
  const h = Math.max(1, Math.round(stageH * dpr));
  if (gl3d.depthW === w && gl3d.depthH === h) return;

  gl.bindRenderbuffer(gl.RENDERBUFFER, gl3d.depthRbo);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);

  gl.bindTexture(gl.TEXTURE_2D, gl3d.colorTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  // mutable storage: the depth target is reallocated on every size change
  // (window resize and 3D export), and an immutable texStorage2D may only be
  // sized once, which would leave a mismatched, incomplete FBO behind.
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  gl.bindFramebuffer(gl.FRAMEBUFFER, gl3d.fb);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, gl3d.depthRbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gl3d.colorTex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) console.warn("3D depth FBO incomplete", status);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);   // never leave the FBO colour texture bound

  gl3d.depthBuf = new Uint8Array(w * h * 4);
  gl3d.depthW = w; gl3d.depthH = h;
}

function set3DMode(active) {
  GL_CANVAS.classList.toggle("hidden", !active);
  GL_CANVAS.style.opacity = String(settings.terrainOpacity);
  if (active) stage.style.background = curStyle().bg;
  else stage.style.background = "";
}

/* ---------------- camera / matrix ---------------- */
function computeCamera3D(vp) {
  const p = clamp(+settings.pitch || 0, 0, TILT_MAX);
  const b = normBearing(+settings.bearing || 0);
  const exag = +settings.exaggeration || 1;
  const s = vp.scale;
  const sinP = Math.sin(p * Math.PI / 180);
  const cosP = Math.cos(p * Math.PI / 180);
  const ct = Math.cos(b * Math.PI / 180), st = Math.sin(b * Math.PI / 180);

  const wcx = data.world.minX + (stageW / 2 - view.x) / s;
  const wcy = data.world.maxY - (stageH / 2 - view.y) / s;

  const m = new Float32Array(16);
  const e2 = 2 / stageW, f2 = -2 / stageH;
  m[0] = e2 * s * ct;
  m[1] = f2 * s * cosP * st;
  m[2] = 0; m[3] = 0;
  m[4] = e2 * s * st;
  m[5] = f2 * s * cosP * -ct;
  m[6] = 0; m[7] = 0;
  m[8] = 0;
  m[9] = f2 * -s * exag * sinP;
  m[10] = 0; m[11] = 0;
  const tx = stageW / 2 - (s * ct * wcx + s * st * wcy);
  const ty = stageH / 2 - (s * cosP * (st * wcx - ct * wcy));
  m[12] = e2 * tx - 1;
  m[13] = f2 * ty + 1;
  m[14] = 0; m[15] = 1;

  const d00 = -exag * sinP * st;
  const d01 = exag * sinP * ct;
  const d02 = -cosP;

  const t = data.terrain;
  const thickness = Math.max(30, 0.15 * (t.max - t.min));
  const zMin = Math.min(seaLevel3d(), t.min) - thickness;
  const zMax = t.max + thickness;
  const W = data.world;
  let dMin = Infinity, dMax = -Infinity;
  for (let ix = 0; ix < 2; ix++) for (let iy = 0; iy < 2; iy++) {
    const wx = ix ? W.maxX : W.minX;
    const wy = iy ? W.maxY : W.minY;
    for (const wz of [zMin, zMax]) {
      const d = d00 * wx + d01 * wy + d02 * wz;
      if (d < dMin) dMin = d;
      if (d > dMax) dMax = d;
    }
  }
  const dSpan = Math.max(1e-6, dMax - dMin);
  m[10] = 2 / dSpan;
  m[14] = -(dMax + dMin) / dSpan;

  cam3d = {
    active: sinP > 1e-4,
    pitch: p, bearing: b, exag, scale: s, sinP, cosP, ct, st,
    wcx, wcy, d00, d01, d02, dMin, dMax, matrix: m,
  };
}

/* ---------------- mesh builder ---------------- */
function meshKey3D(vp) {
  if (!cam3d || !cam3d.active) return null;
  const corners = [
    screenToWorld(0, 0), screenToWorld(stageW, 0),
    screenToWorld(stageW, stageH), screenToWorld(0, stageH),
  ];
  const W = data.world;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of corners) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const hSpan = data.terrain.max - Math.min(seaLevel3d(), data.terrain.min);
  const dh = Math.max(stageW * 0.9 / cam3d.scale, hSpan * cam3d.exag * cam3d.sinP / cam3d.scale * 1.5);
  x0 = Math.max(W.minX, x0 - dh);
  x1 = Math.min(W.maxX, x1 + dh);
  y0 = Math.max(W.minY, y0 - dh);
  y1 = Math.min(W.maxY, y1 + dh);

  const rectW = Math.max(1, x1 - x0);
  const rectH = Math.max(1, y1 - y0);
  const cap = { draft: 384, normal: 768, full: 1280 }[settings.detail] || 768;
  let nx = Math.min(cap, Math.max(48, Math.ceil(rectW * cam3d.scale / 2.5)));
  let ny = Math.min(cap, Math.max(48, Math.ceil(rectH * cam3d.scale / 2.5)));
  const qx = 16, qy = 16;
  const sx = Math.floor((x0 - W.minX) / (W.width / qx));
  const sy = Math.floor((y0 - W.minY) / (W.height / qy));
  return { key: `${nx.toFixed(0)}|${ny.toFixed(0)}|${sx}|${sy}|${cam3d.pitch.toFixed(0)}|${cam3d.bearing.toFixed(0)}`, x0, y0, x1, y1, nx, ny };
}

function ensureMesh3D(vp) {
  if (!gl3d || !gl3d.ok || !cam3d.active) return;
  const spec = meshKey3D(vp);
  if (!spec) return;
  if (gl3d.mesh && gl3d.mesh.key === spec.key) return;
  buildTerrainMesh3D(spec);
}

function buildTerrainMesh3D(spec) {
  const t0 = performance.now();
  const W = data.world, terr = data.terrain;
  const { x0, y0, x1, y1, nx, ny } = spec;
  const dx = (x1 - x0) / Math.max(1, nx - 1);
  const dy = (y1 - y0) / Math.max(1, ny - 1);
  const sea = seaLevel3d();
  const nVerts = nx * ny;
  const skirtVerts = 8 * (nx + ny - 2);
  const totalVerts = nVerts + skirtVerts;

  const vbuf = new Float32Array(totalVerts * 7);
  const heights = new Float32Array(nVerts);
  const idx = [];

  function setVert(i, wx, wy, wz, u, v, shade, side) {
    const o = i * 7;
    vbuf[o] = wx; vbuf[o + 1] = wy; vbuf[o + 2] = wz;
    vbuf[o + 3] = u; vbuf[o + 4] = v; vbuf[o + 5] = shade;
    vbuf[o + 6] = side;
  }

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const wx = x0 + i * dx;
      const wy = y0 + j * dy;
      const wz = Math.max(sea, elevationAt(wx, wy));
      heights[j * nx + i] = wz;
      const u = (wx - W.minX) / W.width;
      const v = (W.maxY - wy) / W.height;
      setVert(j * nx + i, wx, wy, wz, u, v, 1.0, 0.0);
    }
  }
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }

  const base = nVerts;
  const thickness = Math.max(800, 0.2 * (terr.max - terr.min));
  const baseZ = Math.min(sea, terr.min) - thickness;
  let vert = base;

  function addEdge(pts) {
    for (let k = 0; k < pts.length - 1; k++) {
      const [wx, wy, u, v, tz] = pts[k];
      const [wx2, wy2, u2, v2, tz2] = pts[k + 1];
      setVert(vert, wx, wy, tz, u, v, 0.88, 1.0);
      setVert(vert + 1, wx2, wy2, tz2, u2, v2, 0.88, 1.0);
      setVert(vert + 2, wx, wy, baseZ, u, v, 0.45, 1.0);
      setVert(vert + 3, wx2, wy2, baseZ, u2, v2, 0.45, 1.0);
      idx.push(vert, vert + 2, vert + 1, vert + 1, vert + 2, vert + 3);
      vert += 4;
    }
  }

  // Only build skirt walls for edges that face the camera. The horizontal view
  // direction into the scene is (-sin b, cos b); an edge with outward normal N
  // is visible when N · viewDir < 0.
  const viewDir = [-cam3d.st, cam3d.ct];
  const facesCam = (nx, ny) => nx * viewDir[0] + ny * viewDir[1] < 0;

  const north = [], south = [];
  for (let i = 0; i < nx; i++) {
    const wx = x0 + i * dx;
    const u = (wx - W.minX) / W.width;
    north.push([wx, y1, u, (W.maxY - y1) / W.height, Math.max(sea, elevationAt(wx, y1))]);
    south.push([wx, y0, u, (W.maxY - y0) / W.height, Math.max(sea, elevationAt(wx, y0))]);
  }
  if (facesCam(0, 1)) addEdge(north);
  if (facesCam(0, -1)) addEdge(south.reverse());
  const east = [], west = [];
  for (let j = 0; j < ny; j++) {
    const wy = y0 + j * dy;
    const v = (W.maxY - wy) / W.height;
    east.push([x1, wy, (x1 - W.minX) / W.width, v, Math.max(sea, elevationAt(x1, wy))]);
    west.push([x0, wy, (x0 - W.minX) / W.width, v, Math.max(sea, elevationAt(x0, wy))]);
  }
  if (facesCam(1, 0)) addEdge(east);
  if (facesCam(-1, 0)) addEdge(west.reverse());

  const gl = gl3d.gl;
  gl.bindBuffer(gl.ARRAY_BUFFER, gl3d.vbo);
  gl.bufferData(gl.ARRAY_BUFFER, vbuf, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl3d.ibo);
  const indices = new Uint32Array(idx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  gl3d.mesh = { key: spec.key, count: idx.length, baseZ, x0: spec.x0, y0: spec.y0, x1: spec.x1, y1: spec.y1, nx, ny, dx, dy, heights };
}

function uploadTerrainTexture3D() {
  if (!gl3d || !gl3d.ok) return;
  const gl = gl3d.gl;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, terrainCanvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  if (gl3d.texture) gl.deleteTexture(gl3d.texture);
  gl3d.texture = tex;
  gl3d.texVersion = (gl3d.texVersion || 0) + 1;
}

function updateCamDepthRange(wx0, wy0, wx1, wy1, zMin, zMax) {
  if (!cam3d) return;
  const d00 = cam3d.d00, d01 = cam3d.d01, d02 = cam3d.d02;
  let dMin = Infinity, dMax = -Infinity;
  for (let ix = 0; ix < 2; ix++) for (let iy = 0; iy < 2; iy++) {
    const wx = ix ? wx1 : wx0, wy = iy ? wy1 : wy0;
    for (const wz of [zMin, zMax]) {
      const d = d00 * wx + d01 * wy + d02 * wz;
      if (d < dMin) dMin = d;
      if (d > dMax) dMax = d;
    }
  }
  const dSpan = Math.max(1e-6, dMax - dMin);
  cam3d.dMin = dMin;
  cam3d.dMax = dMax;
  cam3d.matrix[10] = 2 / dSpan;
  cam3d.matrix[14] = -(dMax + dMin) / dSpan;
}

/* ---------------- render ---------------- */
function renderTerrain3D(vp) {
  if (!gl3d || !gl3d.ok) { cam3d = { active: false }; return; }
  computeCamera3D(vp);
  if (!cam3d.active) return;

  ensureMesh3D(vp);
  if (gl3d.mesh) updateCamDepthRange(gl3d.mesh.x0, gl3d.mesh.y0, gl3d.mesh.x1, gl3d.mesh.y1, gl3d.mesh.baseZ, data.terrain.max);
  const gl = gl3d.gl;
  if (terrainCanvas && (!gl3d.texture || gl3d.texVersion < 0)) uploadTerrainTexture3D();

  // depth-only pass to an FBO (reading the default framebuffer depth is not portable)
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl3d.fb);
  gl.viewport(0, 0, gl3d.depthW, gl3d.depthH);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  setupGLAttributes(true);
  drawTerrainMesh();
  readDepth3D(gl);

  // visible pass to the default framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, GL_CANVAS.width, GL_CANVAS.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  setupGLAttributes(false);
  drawTerrainMesh();
}

function setupGLAttributes(depthPass) {
  const gl = gl3d.gl;
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LESS);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.BLEND);
  gl.useProgram(gl3d.prog);

  gl.uniformMatrix4fv(gl3d.uniforms.uMatrix, false, cam3d.matrix);
  gl.uniform1i(gl3d.uniforms.uDepthPass, depthPass ? 1 : 0);
  if (depthPass) {
    gl.uniform3f(gl3d.uniforms.uDepthDir, cam3d.d00, cam3d.d01, cam3d.d02);
    gl.uniform2f(gl3d.uniforms.uDepthRange, cam3d.dMin, cam3d.dMax);
    // Unbind any texture from the sampled unit: the depth pass renders *into*
    // the FBO whose colour attachment (gl3d.colorTex) is left bound after a
    // resize, and a texture that is both attached and sampled is a feedback
    // loop — WebGL rejects the draw and the depth buffer stays at zero.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
  } else {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gl3d.texture || null);
    gl.uniform1i(gl3d.uniforms.uTex, 0);

    const useTex = !!(settings.layers.terrain && terrainCanvas && gl3d.texture);
    gl.uniform1i(gl3d.uniforms.uUseTex, useTex ? 1 : 0);
    const cs = curStyle();
    const solid = useTex ? [0, 0, 0] : hexRgb(cs.panel || cs.bg || "#1e222b");
    gl.uniform3f(gl3d.uniforms.uSolid, solid[0] / 255, solid[1] / 255, solid[2] / 255);
    const side = hexRgb(cs.bg || "#1e222b");
    const dark = 0.45;
    gl.uniform3f(gl3d.uniforms.uSideColor, side[0] * dark / 255, side[1] * dark / 255, side[2] * dark / 255);
  }

  const stride = 7 * 4;
  const a = gl3d.attribs;
  gl.bindBuffer(gl.ARRAY_BUFFER, gl3d.vbo);
  gl.enableVertexAttribArray(a.aPos);
  gl.vertexAttribPointer(a.aPos, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(a.aUV);
  gl.vertexAttribPointer(a.aUV, 2, gl.FLOAT, false, stride, 3 * 4);
  gl.enableVertexAttribArray(a.aShade);
  gl.vertexAttribPointer(a.aShade, 1, gl.FLOAT, false, stride, 5 * 4);
  gl.enableVertexAttribArray(a.aSide);
  gl.vertexAttribPointer(a.aSide, 1, gl.FLOAT, false, stride, 6 * 4);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl3d.ibo);
}

function drawTerrainMesh() {
  const gl = gl3d.gl;
  if (gl3d.mesh && gl3d.mesh.count) gl.drawElements(gl.TRIANGLES, gl3d.mesh.count, gl.UNSIGNED_INT, 0);
}

function readDepth3D(gl) {
  if (!gl3d.depthBuf || gl3d.depthBuf.length !== gl3d.depthW * gl3d.depthH * 4) return;
  try {
    gl.readPixels(0, 0, gl3d.depthW, gl3d.depthH, gl.RGBA, gl.UNSIGNED_BYTE, gl3d.depthBuf);
    gl3d.depthOk = true;
  } catch (e) {
    console.warn("3D depth readback failed", e);
    gl3d.depthOk = false;
  }
}

function depthAt(sx, sy) {
  if (!gl3d || !gl3d.depthOk || !gl3d.depthBuf) return 1;
  const x = Math.round(sx * dpr);
  const y = Math.round((stageH - sy) * dpr) - 1;
  if (x < 0 || y < 0 || x >= gl3d.depthW || y >= gl3d.depthH) return 1;
  const o = (y * gl3d.depthW + x) * 4;
  const u = gl3d.depthBuf[o] + gl3d.depthBuf[o + 1] * 256 + gl3d.depthBuf[o + 2] * 65536 + gl3d.depthBuf[o + 3] * 16777216;
  return u / 0xFFFFFFFF;
}

/* World-space lift for overlays: keep them a few screen pixels above the terrain
   so they read cleanly at every zoom (more lift when zoomed out, less when zoomed in). */
function overlayLift(px) {
  const base = px == null ? 2.5 : px;
  return Math.max(base, base / Math.max(0.02, view.scale));
}

/* World-space clearance (metres) for the CPU overlay depth test. Overlays now
   sample the same mesh the depth buffer was rendered from, so the remaining
   error is depth-buffer pixel snapping and sub-pixel slope: a fixed normalised
   margin cannot cover that at every zoom, because cam3d.dSpan changes with zoom
   and exaggeration. This converts a constant metre clearance into the depth
   buffer's normalised units at test time. */
const OCCLUSION_CLEARANCE = 2.0;

function depthMargin3D(clearanceW) {
  if (!cam3d) return 0.00005;
  const span = Math.max(1e-6, cam3d.dMax - cam3d.dMin);
  const grad = Math.hypot(cam3d.d00, cam3d.d01, cam3d.d02);
  return Math.max(0.00005, clearanceW * grad / span);
}

/* Clearance in metres for the overlay depth test. A fixed world clearance is
   fine at steep pitch, but at grazing pitch one screen pixel spans
   ~1/(scale·cosPitch) metres of depth, so the nearest-pixel sample can differ
   from the true surface by more than the minimum and features flicker. Keep the
   clearance at least a couple of pixels' worth at the current view. */
function occlusionClearance() {
  const s = Math.max(1e-6, view.scale);
  const cosP = cam3d ? Math.max(0.2, Math.abs(cam3d.cosP)) : 1;
  return Math.max(OCCLUSION_CLEARANCE, 2 / (s * cosP));
}

function isOccluded(wx, wy) {
  if (!cam3d || !cam3d.active || !gl3d || !gl3d.depthOk) return false;
  // Sample the terrain at the surface pixel (not the lifted draw pixel, which
  // can sit several pixels up-screen over unrelated terrain), but compare
  // against a depth that is biased toward the camera by the same world lift the
  // overlay is drawn with. The bias keeps a feature that lies on the surface
  // clearly in front of the buffer, so numerical/projection noise does not flip
  // it frame to frame.
  const z = z3dAt(wx, wy);
  const [sx, sy] = project(wx, wy, null, z);
  if (sx < -50 || sy < -50 || sx > stageW + 50 || sy > stageH + 50) return true;
  const d = depthOfPoint(wx, wy, z + overlayLift());
  return d > depthAt(sx, sy) + depthMargin3D(occlusionClearance());
}

