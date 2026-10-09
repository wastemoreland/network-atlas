/* ============================================================
   Terrain raster generation
   ============================================================ */
function rampLut(stops) {
  const lut = new Uint8Array(256 * 3);
  const cols = stops.map(hexRgb);
  for (let i = 0; i < 256; i++) {
    const t = i / 255 * (cols.length - 1);
    const a = Math.floor(t), b = Math.min(cols.length - 1, a + 1), f = t - a;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(cols[a][c] + (cols[b][c] - cols[a][c]) * f);
  }
  return lut;
}
const STYLE_LUTS = {};
function styleLut(style) {
  if (!STYLE_LUTS[style]) STYLE_LUTS[style] = rampLut((STYLES[style] || STYLES.terrain).ramp);
  return STYLE_LUTS[style];
}
const WATER_RGB = {};
function waterRgb(style) {
  if (!WATER_RGB[style]) WATER_RGB[style] = (STYLES[style] || STYLES.terrain).water.map(hexRgb);
  return WATER_RGB[style];
}

async function buildTerrain(onProgress) {
  const t0 = performance.now();
  const W = data.world, terr = data.terrain;
  const style = curStyle();
  const lut = styleLut(settings.style);
  const [wShallow, wDeep] = waterRgb(settings.style);

  const maxSide = Math.min(DETAIL_PX[settings.detail] || DETAIL_PX.normal, Math.max(terr.gw, terr.gh));
  const k = maxSide / Math.max(terr.gw, terr.gh);
  const nw = Math.max(2, Math.round(terr.gw * k));
  const nh = Math.max(2, Math.round(terr.gh * k));
  const elev = new Float32Array(nw * nh);

  const gw = terr.gw, gh = terr.gh, grid = terr.grid;
  const dxs = (gw - 1) / Math.max(1, nw - 1);
  const dys = (gh - 1) / Math.max(1, nh - 1);

  // sample (bilinear) in row chunks so the UI stays responsive
  for (let y = 0, done = 0; y < nh; y++) {
    const sy = (nh - 1 - y) * dys;              // raster row 0 = world north (maxY) = grid row gh-1
    const j0 = Math.min(gh - 2, Math.floor(sy)), j1 = Math.min(gh - 1, j0 + 1), fy = sy - j0;
    const rowOff = y * nw;
    for (let x = 0; x < nw; x++) {
      const sx = x * dxs;
      const i0 = Math.min(gw - 2, Math.floor(sx)), i1 = Math.min(gw - 1, i0 + 1), fx = sx - i0;
      const a = grid[j0 * gw + i0], b = grid[j0 * gw + i1], c = grid[j1 * gw + i0], d = grid[j1 * gw + i1];
      elev[rowOff + x] = (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    }
    if (++done >= 96) { done = 0; if (onProgress) onProgress(y / nh * 0.5); await yieldUI(); }
  }

  // colour + hillshade
  const raster = document.createElement("canvas");
  raster.width = nw; raster.height = nh;
  const rc = raster.getContext("2d", { alpha: false });
  const img = rc.createImageData(nw, nh);
  const px = img.data;

  const eMin = settings.elevAuto ? terr.min : Math.min(settings.elevMin, settings.elevMax - 1);
  const eMax = settings.elevAuto ? terr.max : Math.max(settings.elevMax, eMin + 1);
  const sea = settings.seaAuto ? terr.waterLevel : settings.seaLevel;
  const seaFloor = Math.min(terr.min, sea - 1);
  const seaSpan = Math.max(1, sea - seaFloor);
  const span = Math.max(1e-6, eMax - Math.max(eMin, sea));

  const shade = settings.layers.hillshade ? settings.hillshadeStrength : 0;
  const exag = settings.exaggeration;
  const az = settings.sunAzimuth * Math.PI / 180, el = settings.sunElevation * Math.PI / 180;
  const Lx = Math.sin(az) * Math.cos(el), Ly = -Math.cos(az) * Math.cos(el), Lz = Math.sin(el);
  const ambient = 0.42;
  const mX = W.width / Math.max(1, nw - 1);      // metres per raster pixel
  const mY = W.height / Math.max(1, nh - 1);

  const at = (x, y) => elev[clamp(y, 0, nh - 1) * nw + clamp(x, 0, nw - 1)];
  for (let y = 0, done = 0; y < nh; y++) {
    const row = y * nw;
    for (let x = 0; x < nw; x++) {
      const e = elev[row + x];
      let r, g, b;
      const under = e <= sea;
      if (under) {
        const t = clamp((sea - e) / seaSpan, 0, 1);
        const q = Math.pow(t, 0.75);
        r = wShallow[0] + (wDeep[0] - wShallow[0]) * q;
        g = wShallow[1] + (wDeep[1] - wShallow[1]) * q;
        b = wShallow[2] + (wDeep[2] - wShallow[2]) * q;
      } else {
        const q = clamp((e - Math.max(eMin, sea)) / span, 0, 1);
        const li = (q * 255) | 0;
        r = lut[li * 3]; g = lut[li * 3 + 1]; b = lut[li * 3 + 2];
      }
      /* water stays flat: directional shading across a depth gradient makes
         lakes look like they have terrain, every real basemap paints them calm */
      if (shade > 0 && !under) {
        const gx = (at(x + 1, y) - at(x - 1, y)) / (2 * mX) * exag;
        const gy = (at(x, y + 1) - at(x, y - 1)) / (2 * mY) * exag;
        const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
        const nx = -gx * inv, ny = -gy * inv, nz = inv;
        const diff = nx * Lx + ny * Ly + nz * Lz;
        const lit = ambient + (1 - ambient) * Math.max(0, diff);
        const m = clamp(1 + shade * (lit - 1), 0, 2.2);
        r *= m; g *= m; b *= m;
      }
      const o = row * 4 + x * 4;
      px[o] = r < 0 ? 0 : r > 255 ? 255 : r;
      px[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      px[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      px[o + 3] = 255;
    }
    if (++done >= 64) { done = 0; if (onProgress) onProgress(0.5 + y / nh * 0.5); await yieldUI(); }
  }
  rc.putImageData(img, 0, 0);
  terrainCanvas = raster;
  terrainLevels = [];
  terrainMeta = { nw, nh, eMin, eMax, sea, ms: performance.now() - t0 };
  buildTerrainLevels();
  if (gl3d) gl3d.texVersion = -1;
  if (onProgress) onProgress(1);
}

function autoInterval(range) {
  const target = Math.max(2, Math.ceil(range / 16));
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  for (const s of steps) if (s >= target) return s;
  return steps[steps.length - 1];
}

function buildContours() {
  const t0 = performance.now();
  const terr = data.terrain, W = data.world, grid = terr.grid, gw = terr.gw, gh = terr.gh;
  let interval = settings.contourInterval === "auto" ? autoInterval(terr.max - terr.min) : Number(settings.contourInterval);
  if (!(interval > 0)) interval = 25;
  const first = Math.ceil(terr.min / interval) * interval;
  const levelCount = Math.max(0, Math.floor((terr.max - first) / interval + 1e-9) + 1);
  // march fewer cells when many levels are drawn, so the total work stays bounded
  const n = Math.max(48, Math.min(560, Math.floor(Math.sqrt(16e6 / Math.max(1, levelCount)))));
  const stride = Math.max(1, Math.round((gw - 1) / n));
  const nx = Math.max(1, Math.floor((gw - 1) / stride));
  const ny = Math.max(1, Math.floor((gh - 1) / stride));
  const resX = W.width / (gw - 1), resY = W.height / (gh - 1);
  const minor = new Path2D(), index = new Path2D();
  const levelList = [];
  const segments = [];
  // grid row 0 = south edge (world minY), row gh-1 = north edge (world maxY) — same
  // convention as the terrain raster; rows are stored south → north.
  const add = (path, ax, ay, bx, by, L, isIndex) => {
    const x0 = W.minX + ax * resX, y0 = W.minY + ay * resY;
    const x1 = W.minX + bx * resX, y1 = W.minY + by * resY;
    path.moveTo(x0, y0); path.lineTo(x1, y1);
    segments.push([x0, y0, x1, y1, L, !!isIndex]);
  };
  for (let lv = 0; lv < levelCount; lv++) {
    const L = first + lv * interval;
    const k = Math.round(L / interval);
    levelList.push(L);
    const isIndex = (((k % 5) + 5) % 5 === 0 && settings.contourIndex);
    const path = isIndex ? index : minor;
    for (let j = 0; j < ny; j++) {
      const r0 = j * stride, r1 = Math.min(gh - 1, (j + 1) * stride);
      for (let i = 0; i < nx; i++) {
        const c0 = i * stride, c1 = Math.min(gw - 1, (i + 1) * stride);
        const v00 = grid[r0 * gw + c0], v10 = grid[r0 * gw + c1];
        const v11 = grid[r1 * gw + c1], v01 = grid[r1 * gw + c0];
        const code = (v00 > L ? 1 : 0) | (v10 > L ? 2 : 0) | (v11 > L ? 4 : 0) | (v01 > L ? 8 : 0);
        if (code === 0 || code === 15) continue;
        const tx = (code & 3) ? c0 + (L - v00) / ((v10 - v00) || 1e-12) : 0;
        const ry = (code & 6) ? r0 + (L - v10) / ((v11 - v10) || 1e-12) : 0;
        const bx = (code & 12) ? c0 + (L - v01) / ((v11 - v01) || 1e-12) : 0;
        const ly = (code & 9) ? r0 + (L - v00) / ((v01 - v00) || 1e-12) : 0;
        switch (code) {
          case 1: add(path, c0, ly, tx, r0, L, isIndex); break;
          case 2: add(path, tx, r0, c1, ry, L, isIndex); break;
          case 3: add(path, c0, ly, c1, ry, L, isIndex); break;
          case 4: add(path, c1, ry, bx, r1, L, isIndex); break;
          case 5: add(path, c0, ly, tx, r0, L, isIndex); add(path, c1, ry, bx, r1, L, isIndex); break;
          case 6: add(path, tx, r0, bx, r1, L, isIndex); break;
          case 7: add(path, c0, ly, bx, r1, L, isIndex); break;
          case 8: add(path, bx, r1, c0, ly, L, isIndex); break;
          case 9: add(path, tx, r0, bx, r1, L, isIndex); break;
          case 10: add(path, tx, r0, c1, ry, L, isIndex); add(path, bx, r1, c0, ly, L, isIndex); break;
          case 11: add(path, c1, ry, bx, r1, L, isIndex); break;
          case 12: add(path, c0, ly, c1, ry, L, isIndex); break;
          case 13: add(path, tx, r0, c1, ry, L, isIndex); break;
          case 14: add(path, c0, ly, tx, r0, L, isIndex); break;
        }
      }
    }
  }
  contourPaths = { minor, index, interval, levels: levelList, segments, ms: performance.now() - t0 };
}

