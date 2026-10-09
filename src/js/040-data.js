/* ============================================================
   Parser — reads the data-only Lua table written by the mod.
   Never evaluates Lua code.
   ============================================================ */
class Scanner {
  constructor(text, onProgress) {
    this.t = text; this.i = 0; this.n = text.length; this.p = onProgress || null; this.last = performance.now();
  }
  fail(msg) { throw new Error(msg + " (offset " + this.i + ")"); }
  ws() {
    const t = this.t; let i = this.i;
    while (i < this.n) {
      const c = t.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 65279 || (c >= 11 && c <= 12)) { i++; continue; }
      if (c === 45 && t.charCodeAt(i + 1) === 45) {                       // comment
        if (t.charCodeAt(i + 2) === 91 && t.charCodeAt(i + 3) === 91) {
          const e = t.indexOf("]]", i + 4); i = e < 0 ? this.n : e + 2;
        } else { const e = t.indexOf("\n", i); i = e < 0 ? this.n : e + 1; }
        continue;
      }
      break;
    }
    this.i = i;
  }
  idStart(c) { return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95; }
  ident() {
    const t = this.t; let i = this.i;
    while (i < this.n) {
      const c = t.charCodeAt(i);
      if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 46) i++;
      else break;
    }
    const s = t.slice(this.i, i); this.i = i; return s;
  }
  str() {
    const t = this.t, q = t.charCodeAt(this.i); this.i++;
    let out = "", start = this.i;
    while (this.i < this.n) {
      const c = t.charCodeAt(this.i);
      if (c === 92) {
        out += t.slice(start, this.i); this.i++;
        const e = t[this.i];
        const map = { n: "\n", t: "\t", r: "\r", a: "\a", b: "\b", f: "\f", v: "\v" };
        out += (e in map) ? map[e] : e;
        this.i++; start = this.i; continue;
      }
      if (c === q) break;
      this.i++;
    }
    if (this.i >= this.n) this.fail("unterminated string");
    out += t.slice(start, this.i); this.i++;
    return out;
  }
  num() {
    const t = this.t; let i = this.i;
    let c = t.charCodeAt(i);
    let sign = 1;
    if (c === 45) { sign = -1; i++; c = t.charCodeAt(i); }
    else if (c === 43) { i++; c = t.charCodeAt(i); }
    let v = 0;
    while (c >= 48 && c <= 57) { v = v * 10 + (c - 48); i++; c = t.charCodeAt(i); }
    if (c === 46) { i++; c = t.charCodeAt(i); let d = 0.1; while (c >= 48 && c <= 57) { v += (c - 48) * d; d *= 0.1; i++; c = t.charCodeAt(i); } }
    if (c === 101 || c === 69) {
      const save = i; i++; c = t.charCodeAt(i);
      let es = 1;
      if (c === 45) { i++; es = -1; } else if (c === 43) i++;
      c = t.charCodeAt(i); let e = 0, any = false;
      while (c >= 48 && c <= 57) { e = e * 10 + (c - 48); i++; c = t.charCodeAt(i); any = true; }
      if (any) v *= Math.pow(10, es * e); else i = save;
    }
    this.i = i;
    return sign * v;
  }
  async yieldIfSlow() {
    const now = performance.now();
    if (now - this.last > 60) {
      this.last = now;
      if (this.p) this.p(this.n ? this.i / this.n : 0);
      await yieldUI();
    }
  }
  async value() {
    this.ws();
    const c = this.t.charCodeAt(this.i);
    if (c === 123) return this.table();
    if (c === 34 || c === 39) return this.str();
    if (c === 45 || (c >= 48 && c <= 57)) return this.num();
    if (this.idStart(c)) {
      const w = this.ident();
      if (w === "return") return this.value();
      if (w === "true") return true;
      if (w === "false") return false;
      if (w === "nil") return null;
      this.fail('unexpected identifier "' + w + '"');
    }
    this.fail('unexpected character "' + tchar(this.t, this.i) + '"');
  }
  async table() {
    this.i++;                                   // consume {
    const t = this.t;
    const arr = [];
    let obj = null;
    for (;;) {
      this.ws();
      if (this.i >= this.n) this.fail("unterminated table");
      const c = t.charCodeAt(this.i);
      if (c === 125) { this.i++; break; }        // }
      let key = null, keyed = false;
      if (c === 91) {                            // [key] = value
        this.i++; this.ws();
        key = (t.charCodeAt(this.i) === 34 || t.charCodeAt(this.i) === 39) ? this.str() : this.num();
        this.ws();
        if (t.charCodeAt(this.i) !== 93) this.fail("expected ]"); this.i++;
        this.ws();
        if (t.charCodeAt(this.i) !== 61) this.fail("expected ="); this.i++;
        keyed = true;
      } else if (this.idStart(c)) {
        const save = this.i;
        const id = this.ident();
        this.ws();
        if (t.charCodeAt(this.i) === 61) { this.i++; key = id; keyed = true; }
        else this.i = save;
      }
      let val;
      if (keyed) {
        val = (key === "heightmap") ? await this.heightmap() : await this.value();
        if (obj === null) { obj = {}; for (let k = 0; k < arr.length; k++) obj[k + 1] = arr[k]; arr.length = 0; }
        obj[key] = val;
      } else {
        val = await this.value();
        if (obj === null) arr.push(val);
        else { obj[arr.length + 1] = val; arr.push(val); }
      }
      this.ws();
      const d = t.charCodeAt(this.i);
      if (d === 44 || d === 59) this.i++;
      else if (d !== 125) this.fail("expected , or }");
      await this.yieldIfSlow();
    }
    return obj === null ? arr : obj;
  }
  async heightmap() {
    this.ws();
    if (this.t.charCodeAt(this.i) !== 123) this.fail("expected { after heightmap");
    this.i++;
    let cap = 1 << 20, buf = new Float32Array(cap), n = 0;
    for (;;) {
      this.ws();
      const c = this.t.charCodeAt(this.i);
      if (c === 125) { this.i++; break; }
      if (c === 44 || c === 59) { this.i++; continue; }
      if (c === 45 || (c >= 48 && c <= 57)) {
        const v = this.num();
        if (n === cap) { cap *= 2; const b = new Float32Array(cap); b.set(buf); buf = b; }
        buf[n++] = v;
        const now = performance.now();
        if (now - this.last > 60) {
          this.last = now;
          if (this.p) this.p(this.n ? this.i / this.n : 0);
          await yieldUI();
        }
        continue;
      }
      this.fail("unexpected token in heightmap");
    }
    return n === cap ? buf : buf.subarray(0, n);
  }
  async parseDocument() {
    this.ws();
    if (this.t.startsWith("function", this.i)) {
      this.i += 8; this.ws();
      if (this.idStart(this.t.charCodeAt(this.i))) this.ident();
      this.ws();
      if (this.t.charCodeAt(this.i) === 40) {     // skip parameter list
        let depth = 0;
        while (this.i < this.n) {
          const c = this.t.charCodeAt(this.i);
          if (c === 40) depth++;
          else if (c === 41) { depth--; this.i++; if (depth === 0) break; continue; }
          this.i++;
        }
      }
      this.ws();
    }
    if (this.t.startsWith("return", this.i)) this.i += 6;
    return this.value();
  }
}
function tchar(s, i) { return s[i] === undefined ? "EOF" : s[i]; }

/* The heightmap is scanned with a fast numeric reader (no per-token strings). */
async function parseExport(text, onProgress) {
  const sc = new Scanner(text, onProgress);
  const root = await sc.parseDocument();
  if (onProgress) onProgress(1);
  return root;
}

/* ============================================================
   Data model
   ============================================================ */
let data = null;
let roadPaths = null;          // Map template -> Path2D (world coords)
let railPaths = null;          // [{ p: Path2D, rec }] per-row rail geometry (world coords)
let terrainCanvas = null;      // rendered terrain raster (colours + hillshade)
let terrainLevels = [];        // downsampled copies for smooth zooming
let terrainMeta = null;
let contourPaths = null;
let entIndex = null;           // entity id -> { rec, ind } cache used by the flow layers
let loadInfo = null;

/* 3D terrain state (WebGL + draped overlay caches) */
let gl3d = null;               // WebGL context + resources, null = not available / not needed
let drape3d = null;            // per-camera draped overlay paths {sig, roads, rails, lines, contours, grid}
let cam3d = null;              // current camera parameters for projection / occlusion

function roadCat(tpl) {
  const m = /street\/([a-z_]+)\//.exec(tpl || "");
  return m && ROAD_CATS[m[1]] ? m[1] : "other";
}
function niceLabel(tpl) {
  const base = (tpl || "").split("/").pop() || "road";
  return base.replace(/\.[a-z_]+$/, "").replace(/_/g, " ");
}
function townValue(t) {
  const f = t.factors || [0, 0, 0];
  switch (settings.townMetric) {
    case "sum": return f[0] + f[1] + f[2];
    case "f1": return f[0] || 0;
    case "f2": return f[1] || 0;
    case "f3": return f[2] || 0;
    default: return Math.max(f[0] || 0, f[1] || 0, f[2] || 0);
  }
}
function indGroup(tag) { return IND_RAW.has(tag) ? "raw" : "factory"; }
const TOWN_METRIC_LABELS = { max: "Largest factor", sum: "Sum of factors", f1: "Factor 1", f2: "Factor 2", f3: "Factor 3" };
function humanize(s) { return prettyIndustry(String(s).toLowerCase()); }

/* Extended export: row-level extras are carried through the normalisation
   verbatim. A field the game omitted stays omitted — never a fabricated 0. */
const TOWN_EXTRA = ["entity", "population", "landUse", "lineUsage", "stock"];
const IND_EXTRA = ["entity", "level", "maxLevel", "producing", "boostFromRule",
  "boostFromPersonCapacity", "productionRating", "inputs", "outputs"];
function keepFields(dst, src, keys) {
  if (src && typeof src === "object") {
    for (const k of keys) if (src[k] !== undefined) dst[k] = src[k];
  }
  return dst;
}
/* The economy flow table is optional (omitted entirely when the game reports
   no flow). Absent numbers stay absent; only a present row becomes a row. */
function prepEcon(e) {
  if (!e || typeof e !== "object") return null;
  const out = { flows: [] };
  const year = numOrNull(e.year); if (year !== null) out.year = year;
  const cap = numOrNull(e.flowCap); if (cap !== null) out.flowCap = cap;
  const total = numOrNull(e.flowsTotal); if (total !== null) out.flowsTotal = total;
  for (const f of luaArray(e.flows)) {
    if (!f || typeof f !== "object") continue;
    const row = {};
    const from = numOrNull(f.from); if (from !== null) row.from = from;
    const to = numOrNull(f.to); if (to !== null) row.to = to;
    const cargo = numOrNull(f.cargoTypeId); if (cargo !== null) row.cargoTypeId = cargo;
    const vol = numOrNull(f.volume); if (vol !== null) row.volume = vol;
    if (typeof f.fromName === "string" && f.fromName) row.fromName = f.fromName;
    if (typeof f.toName === "string" && f.toName) row.toName = f.toName;
    if (typeof f.cargoName === "string" && f.cargoName) row.cargoName = f.cargoName;
    out.flows.push(row);
  }
  return out;
}

function ingest(parsed, name, bytes) {
  if (!parsed || typeof parsed !== "object") throw new Error("Not a map export");
  if (parsed.format !== "network-atlas-map-v1") throw new Error("Unrecognized export format: " + (parsed.format || "unknown"));
  const world = parsed.world || {};
  const terr = parsed.terrain || {};
  let grid = terr.heightmap;
  if (!grid || !grid.length) throw new Error("Export contains no heightmap");
  if (!(grid instanceof Float32Array)) grid = Float32Array.from(grid);

  const minX = +world.minX || 0, minY = +world.minY || 0;
  const maxX = +world.maxX || 1, maxY = +world.maxY || 1;
  const width = Math.abs(maxX - minX) || Math.abs(+world.width || 1);
  const height = Math.abs(maxY - minY) || Math.abs(+world.height || 1);

  let gw, gh;
  const root = Math.round(Math.sqrt(grid.length));
  if (root * root === grid.length) { gw = gh = root; }
  else {
    const rx = +terr.resolutionX || width / 100;
    gw = Math.max(2, Math.round(width / rx) + 1);
    gh = Math.max(2, Math.round(grid.length / gw));
    if (gw * gh !== grid.length) {
      gw = Math.max(2, Math.round(Math.sqrt(grid.length * (width / height))));
      gh = Math.max(2, Math.round(grid.length / gw));
    }
  }

  let eMin = Infinity, eMax = -Infinity;
  for (let i = 0; i < grid.length; i++) { const v = grid[i]; if (v < eMin) eMin = v; if (v > eMax) eMax = v; }

  const roads = [];
  const templates = new Map();
  for (const r of (parsed.roads || [])) {
    const x0 = +r.x0, y0 = +r.y0, x1 = +r.x1, y1 = +r.y1;
    if (!isFinite(x0) || !isFinite(x1)) continue;
    const tpl = r.roadTemplate || "";
    const rec = { x0, y0, x1, y1, tpl, cat: roadCat(tpl), len: Math.hypot(x1 - x0, y1 - y0) };
    roads.push(rec);
    let t = templates.get(tpl);
    if (!t) { t = { tpl, cat: rec.cat, count: 0, len: 0, label: niceLabel(tpl) }; templates.set(tpl, t); }
    t.count++; t.len += rec.len;
  }

  /* rails: same endpoint row shape as roads, plus optional metadata and an
     optional sampled centreline (`points`); anything absent stays absent */
  const rails = [];
  for (const r of luaArray(parsed.rails)) {
    if (!r || typeof r !== "object") continue;
    const x0 = +r.x0, y0 = +r.y0, x1 = +r.x1, y1 = +r.y1;
    if (!isFinite(x0) || !isFinite(y0) || !isFinite(x1) || !isFinite(y1)) continue;
    const rec = { x0, y0, x1, y1 };
    if (typeof r.roadType === "string" && r.roadType) rec.roadType = r.roadType;
    if (typeof r.roadTemplate === "string" && r.roadTemplate) rec.roadTemplate = r.roadTemplate;
    if (typeof r.edgeType === "string" && r.edgeType) rec.edgeType = r.edgeType;
    const dist = numOrNull(r.distance);
    if (dist !== null) rec.distance = dist;
    const pts = [];
    for (const p of luaArray(r.points)) {
      if (!p || typeof p !== "object") continue;
      const px = numOrNull(p.x), py = numOrNull(p.y);
      if (px !== null && py !== null) pts.push([px, py]);
    }
    if (pts.length >= 2) rec.points = pts;    // no valid shape → straight chord
    rails.push(rec);
  }

  const towns = (parsed.towns || []).map(t => keepFields({
    name: t.name || "Town", x: +t.x, y: +t.y,
    factors: Array.isArray(t.sizeFactors) ? t.sizeFactors.map(Number) : [0, 0, 0],
  }, t, TOWN_EXTRA));

  const industries = (parsed.industries || []).map((it, i) => keepFields({
    id: i, x: +it.x, y: +it.y, angle: +it.angle || 0, onWater: !!it.onWater,
    tag: it.tag || "industry", file: it.fileName || "", group: indGroup(it.tag || ""),
  }, it, IND_EXTRA));

  data = {
    name: name || "network_atlas_export.lua", bytes: bytes || 0,
    format: parsed.format,
    world: { minX, minY, maxX, maxY, width, height, tilesX: +world.tilesX || 0, tilesY: +world.tilesY || 0 },
    terrain: { grid, gw, gh, waterLevel: +terr.waterLevel || 0, resX: +terr.resolutionX || 0, min: eMin, max: eMax },
    roads, templates: Array.from(templates.values()).sort((a, b) => b.count - a.count),
    rails,
    towns, industries,
    lines: prepareLines(parsed.lines),
    econ: prepEcon(parsed.econ),       // null when the export has no flow block
    stats: { roadLen: roads.reduce((s, r) => s + r.len, 0) },
  };

  // derived caches
  buildRoadPaths();
  rebuildRailPaths();
  updateTownScale();
  resetLineState();

  terrainCanvas = null; terrainLevels = []; terrainMeta = null;
  contourPaths = null; entIndex = null;
  if (gl3d) { gl3d.mesh = null; gl3d.texVersion = -1; }
  cam3d = { active: false }; drape3d = null;
  selected = null; closeInfo();
  renderEcon();                    // a fresh export invalidates an open Economy panel
}

function buildRoadPaths() {
  roadPaths = new Map();
  for (const r of data.roads) {
    let p = roadPaths.get(r.tpl);
    if (!p) { p = new Path2D(); roadPaths.set(r.tpl, p); }
    p.moveTo(r.x0, r.y0); p.lineTo(r.x1, r.y1);
  }
}
/* One cached Path2D per rail row: the sampled centreline when the export
   carried one, otherwise the straight chord x0,y0 → x1,y1 (roads style). */
function rebuildRailPaths() {
  railPaths = [];
  for (const r of (data.rails || [])) {
    const p = new Path2D();
    const pts = (r.points && r.points.length > 1) ? r.points : [[r.x0, r.y0], [r.x1, r.y1]];
    p.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) p.lineTo(pts[k][0], pts[k][1]);
    railPaths.push({ p, rec: r });
  }
}

