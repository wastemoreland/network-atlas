/* ---------------- rendering ---------------- */
let renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; draw(); });
}
function resize() {
  const r = stage.getBoundingClientRect();
  stageW = Math.max(1, Math.round(r.width));
  stageH = Math.max(1, Math.round(r.height));
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(stageW * dpr);
  canvas.height = Math.round(stageH * dpr);
  resize3D();
  if (data) clampView();
  if (econOpen) renderEcon();
  requestRender();
}
new ResizeObserver(resize).observe(stage);

function setWorldTransform(g, vp) {
  const a = vp.dpr * vp.scale, d = -vp.dpr * vp.scale;
  const e = vp.dpr * (vp.ox - data.world.minX * vp.scale);
  const f = vp.dpr * (vp.oy + data.world.maxY * vp.scale);
  const m = tiltMat(vp.w / 2, vp.h / 2);
  /* compose M with the world transform exactly once, in device pixels:
     world -> north-up screen -> tilted screen (identity while flat) */
  if (m) g.setTransform(m[0] * a, m[1] * a, m[2] * d, m[3] * d,
    m[0] * e + m[2] * f + vp.dpr * m[4],
    m[1] * e + m[3] * f + vp.dpr * m[5]);
  else g.setTransform(a, 0, 0, d, e, f);
}
function pickTerrainLevel(targetPx) {
  if (!terrainCanvas) return null;
  if (!terrainLevels.length) buildTerrainLevels();
  let best = terrainLevels[0];
  for (const c of terrainLevels) if (c.width >= targetPx * 0.85) best = c;
  return best;
}
function buildTerrainLevels() {
  terrainLevels = [terrainCanvas];
  let src = terrainCanvas;
  while (src.width > 380 && src.height > 380) {
    const w = Math.max(1, Math.round(src.width / 2)), h = Math.max(1, Math.round(src.height / 2));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const cx = c.getContext("2d");
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = "high";
    cx.drawImage(src, 0, 0, w, h);
    terrainLevels.push(c); src = c;
  }
}

function draw() {
  const vp = { scale: view.scale, ox: view.x, oy: view.y, w: stageW, h: stageH, dpr, live: true };
  const use3d = vp.live && tiltActive() && settings.lineView !== "lines" && data && init3D();
  set3DMode(use3d);
  if (use3d) renderTerrain3D(vp);
  else cam3d = { active: false };
  drawScene(ctx, vp);
  drawMinimap();
  updateScaleBar();
  updateInfoCard();
}

function drawScene(g, vp) {
  if (vp && vp.live && cam3d && cam3d.active) { drawScene3D(g, vp); return; }
  const W = data ? data.world : null;
  g.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
  g.fillStyle = data ? curStyle().bg : "#0d1216";
  g.fillRect(0, 0, vp.w, vp.h);
  if (!data) return;

  const wx = vp.ox, wy = vp.oy, ww = W.width * vp.scale, wh = W.height * vp.scale;
  const ov = settings.overlayOpacity;
  const linesOnly = settings.lineView === "lines";   // "Lines only" hides every map layer
  const zw = overlayZoomK();

  /* terrain — the raster rides the same tilt matrix as the world pass, so
     roads, rails and routes always stay glued to the ground */
  if (!linesOnly && settings.layers.terrain && terrainCanvas && settings.terrainOpacity > 0) {
    const lvl = pickTerrainLevel(Math.max(ww, wh) * vp.dpr);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.globalAlpha = settings.terrainOpacity;
    const tm = tiltMat(vp.w / 2, vp.h / 2);
    if (tm) g.setTransform(tm[0] * vp.dpr, tm[1] * vp.dpr, tm[2] * vp.dpr, tm[3] * vp.dpr, vp.dpr * tm[4], vp.dpr * tm[5]);
    g.drawImage(lvl, wx, wy, ww, wh);
    if (tm) g.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
    g.globalAlpha = 1;
  }

  g.save();
  setWorldTransform(g, vp);

  /* contours */
  if (!linesOnly && settings.layers.contours && contourPaths) {
    const px = Math.max(0.35, settings.contourWidth);
    g.lineCap = "round"; g.lineJoin = "round";
    g.globalAlpha = ov * 0.55;
    g.strokeStyle = settings.contourColor;
    g.lineWidth = px * zw / vp.scale;
    g.stroke(contourPaths.minor);
    if (settings.contourIndex) {
      g.globalAlpha = ov * 0.95;
      g.lineWidth = px * 1.8 * zw / vp.scale;
      g.stroke(contourPaths.index);
    }
    g.globalAlpha = 1;
  }
  /* tile grid */
  if (!linesOnly && settings.layers.grid) {
    const step = pickGridStep(vp.scale);
    const dark = isDarkStyle(settings.style);
    const gz = clamp(zw, 0.5, 3);
    g.lineWidth = gz / vp.scale;
    g.strokeStyle = dark ? "rgba(255,255,255,.15)" : "rgba(45,35,15,.2)";
    g.beginPath();
    for (let x = Math.ceil(W.minX / step) * step; x <= W.maxX; x += step) { g.moveTo(x, W.minY); g.lineTo(x, W.maxY); }
    for (let y = Math.ceil(W.minY / step) * step; y <= W.maxY; y += step) { g.moveTo(W.minX, y); g.lineTo(W.maxX, y); }
    g.stroke();
    g.strokeStyle = dark ? "rgba(255,255,255,.32)" : "rgba(45,35,15,.45)";
    g.lineWidth = 1.4 * gz / vp.scale;
    g.strokeRect(W.minX, W.minY, W.width, W.height);
  }
  /* roads — casing under everything, then fills widest → narrowest so the
     hierarchy (motorway > avenue > alley) always reads */
  if (!linesOnly && settings.layers.roads && roadPaths && ov > 0) {
    const visible = visibleTemplates();
    g.lineCap = "round"; g.lineJoin = "round";
    const list = [];
    for (const tpl of visible) {
      const p = roadPaths.get(tpl);
      if (!p) continue;
      const meta = data.templates.find(t => t.tpl === tpl);
      const cat = meta ? meta.cat : "other";
      list.push({ tpl, p, cat, w: settings.roadWidth * roadWeight(tpl, cat) });
    }
    list.sort((a, b) => b.w - a.w);
    if (settings.roadCasing) {
      g.strokeStyle = paint("casing", isDarkStyle(settings.style) ? "rgba(6,10,13,.8)" : "rgba(74,84,96,.4)");
      g.globalAlpha = ov;
      for (const r of list) { g.lineWidth = (r.w * zw + CASING_OUTLINE) / vp.scale; g.stroke(r.p); }
    }
    const single = settings.roadColorMode === "single";
    for (const r of list) {
      g.lineWidth = r.w * zw / vp.scale;
      g.strokeStyle = single ? settings.roadColor : roadColorFor(r.cat);
      g.globalAlpha = ov;
      g.stroke(r.p);
    }
    g.globalAlpha = 1;
  }
  /* rails — the same casing-then-fill passes as roads, in steel greys so the
     track layer reads separately; tunnels at reduced alpha, bridges on a
     lighter fill. Hidden together with the roads layer (and in Lines only). */
  if (!linesOnly && settings.layers.roads && railPaths && railPaths.length && ov > 0) {
    const pal = isDarkStyle(settings.style) ? RAIL_DARK : RAIL_LIGHT;
    const list = railPaths.map(r => ({ p: r.p, rec: r.rec, w: settings.roadWidth * railWeight(r.rec) }));
    list.sort((a, b) => b.w - a.w);
    g.lineCap = "round"; g.lineJoin = "round";
    for (const r of list) {
      g.globalAlpha = ov * railEdgeAlpha(r.rec.edgeType);
      g.lineWidth = (r.w * zw + CASING_OUTLINE) / vp.scale;
      g.strokeStyle = pal.casing;
      g.stroke(r.p);
    }
    for (const r of list) {
      g.globalAlpha = ov * railEdgeAlpha(r.rec.edgeType);
      g.lineWidth = r.w * zw / vp.scale;
      g.strokeStyle = r.rec.edgeType === "BRIDGE" ? pal.bridge : pal.fill;
      g.stroke(r.p);
    }
    g.globalAlpha = 1;
  }
  /* transport lines (world space) */
  if (settings.layers.lines && data.lines.length) drawLineRoutes(g, vp);
  g.restore();

  /* markers & labels (screen space) */
  g.save();
  g.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
  g.globalAlpha = ov;
  if (!linesOnly && settings.layers.industries) drawIndustries(g, vp);
  if (!linesOnly && settings.layers.towns) drawTowns(g, vp);
  if (!linesOnly && dataLayerMapOn()) drawDataLayers(g, vp);
  if (settings.layers.lines && data.lines.length) drawLineStops(g, vp);
  if (pin) drawPin(g, vp);
  if (selected) drawSelection(g, vp);
  g.globalAlpha = 1;
  g.restore();
}

function pickGridStep(scale) {
  const tile = (data.world.width / (data.world.tilesX || 44)) || 256;
  const steps = [tile, tile * 2, tile * 4, tile * 8, tile * 16, tile * 32, tile * 64, tile * 128];
  for (const s of steps) if (s * scale >= 90) return s;
  return steps[steps.length - 1];
}

function drawTowns(g, vp) {
  const max = data.townMax || 1;
  /* biggest town first: importance wins the label spot when two collide */
  const list = data.towns
    .map(t => ({ t, v: townValue(t) }))
    .filter(o => o.v >= settings.townMin)
    .sort((a, b) => b.v - a.v);
  const placed = [];
  for (const { t, v } of list) {
    const [sx, sy] = project(t.x, t.y, vp);
    if (sx < -60 || sy < -60 || sx > vp.w + 60 || sy > vp.h + 60) continue;
    const rank = Math.sqrt(v / max);                    // 0..1 importance
    const r = (4.5 + 13 * rank) * settings.townSize;
    /* dots stay off by default (they covered line stops) — NETWORK draws town nodes */
    if (paint("townNodes", false)) {
      const rr = Math.max(3, r * 0.42);
      const node = paint("townNode", "#f6c558");
      const halo = paint("halo", "rgba(6,10,13,.8)");
      if (tiltActive()) {
        /* tilted: extruded prism — 12-gon footprint, no arc() up here */
        const dy = -extrudeHeight(rr);
        extrudeSides(g, circlePts(sx, sy, rr, 12), 0, dy, shadeColor(node, 0.55));
        g.beginPath();
        polyPath(g, circlePts(sx, sy + dy, rr, 12));
        g.fillStyle = node; g.fill();
        g.lineWidth = 1.5; g.strokeStyle = halo; g.stroke();
      } else {
        g.beginPath(); g.arc(sx, sy, rr, 0, Math.PI * 2);
        g.fillStyle = node; g.fill();
        g.lineWidth = 1.5; g.strokeStyle = halo; g.stroke();
      }
    }
    if (!settings.townLabels) continue;
    /* label grows with the town; the biggest ones also get the heavier weight */
    const base = paint("townFont", "600 12.5px system-ui");
    const m = /(\d+(?:\.\d+)?)px/.exec(base);
    const size = (m ? parseFloat(m[1]) : 12.5) * (0.94 + 0.45 * rank);
    let font = base.replace(/(\d+(?:\.\d+)?)px/, size.toFixed(1) + "px");
    if (rank > 0.55) font = font.replace(/^(\d{3})/, w => String(Math.max(+w, 700)));
    const x = sx + r + 5, y = sy - r - 3;
    g.font = font;
    const w = (g.measureText ? g.measureText(t.name).width : t.name.length * 6.4);
    const box = { x: x - 3, y: y - size, w: w + 6, h: size * 1.35 };
    const hit = placed.some(p => !(box.x > p.x + p.w || box.x + box.w < p.x ||
                                   box.y > p.y + p.h || box.y + box.h < p.y));
    if (hit) continue;                                   // smaller label loses
    placed.push(box);
    label(g, t.name, x, y, font, paint("townLabel", "#ffe6a8"));
  }
}
/* Build a Path2D from the inline icon markup. ICONS stores SVG *markup*
   (`<path>`, `<circle>`, `<ellipse>` …), which `new Path2D(string)` cannot
   parse — it only accepts naked path data — so the glyphs have to be turned
   into paths element by element. */
function svgIconPath(markup) {
  const out = new Path2D();
  try {
    const doc = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, "image/svg+xml");
    for (const el of Array.from(doc.documentElement.children)) {
      const tag = el.tagName.toLowerCase();
      const num = (a, d) => { const v = parseFloat(el.getAttribute(a)); return isFinite(v) ? v : d; };
      if (tag === "path") {
        const d = el.getAttribute("d");
        if (d) out.addPath(new Path2D(d));
      } else if (tag === "circle") {
        const p = new Path2D();
        p.arc(num("cx", 0), num("cy", 0), num("r", 0), 0, Math.PI * 2);
        out.addPath(p);
      } else if (tag === "ellipse") {
        const p = new Path2D();
        p.ellipse(num("cx", 0), num("cy", 0), num("rx", 0), num("ry", 0), 0, 0, Math.PI * 2);
        out.addPath(p);
      } else if (tag === "rect") {
        const p = new Path2D();
        p.rect(num("x", 0), num("y", 0), num("width", 0), num("height", 0));
        out.addPath(p);
      }
    }
  } catch (e) { console.warn("icon path parse failed", e); }
  return out;
}
function industryGlyphs() {
  return industryGlyphs._g || (industryGlyphs._g = {
    raw: svgIconPath(ICONS.mountain),
    factory: svgIconPath(ICONS.factory),
    other: svgIconPath(ICONS.database),
  });
}
/* Industry markers are icons, not squares: the group glyph is stroked with a
   dark ring for contrast and the group colour on top, so raw materials and
   factories stay distinguishable on any basemap and at any zoom. */
function drawIndustryIcon(g, group, x, y, s, color) {
  const set = industryGlyphs();
  const p = set[group] || set.other;
  const sc = (s * 2.05) / 24;                 // fit the 24px glyph to the marker
  g.save();
  g.translate(x, y);
  g.scale(sc, sc);
  g.translate(-12, -12);
  g.lineJoin = "round"; g.lineCap = "round";
  g.lineWidth = 5.0 / sc; g.strokeStyle = "rgba(4,8,11,.85)"; g.stroke(p);
  g.lineWidth = 2.5 / sc; g.strokeStyle = color; g.stroke(p);
  g.restore();
}
function drawIndustries(g, vp) {
  const showLabels = settings.indLabels || (settings.indAutoLabels && vp.scale >= 1);
  const tilt = tiltActive();
  for (const it of data.industries) {
    if (settings.indOff.includes(it.tag)) continue;
    const [sx, sy] = project(it.x, it.y, vp);
    if (sx < -40 || sy < -40 || sx > vp.w + 40 || sy > vp.h + 40) continue;
    const color = IND_GROUPS[it.group] || IND_GROUPS.other;
    const k = paint("indScale", 1);
    const s = 6.5 * k;
    /* tilted: stand the icon a little above its own terrain footprint */
    const dy = tilt ? -extrudeHeight(s * 0.55) : 0;
    drawIndustryIcon(g, it.group, sx, sy + dy, s, color);
    if (it.onWater) {
      g.beginPath();
      if (tilt) polyPath(g, circlePts(sx, sy, s + 3, 12)); else g.arc(sx, sy, s + 3, 0, Math.PI * 2);
      g.strokeStyle = "rgba(120,220,255,.85)"; g.lineWidth = 1.2; g.stroke();
    }
    if (showLabels) label(g, prettyIndustry(it.tag), sx + s + 4, sy + 4, "600 11.5px system-ui", color);
  }
}
function prettyIndustry(tag) { return String(tag).replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }

/* ---- tilted-only marker extrusions (kepler's building look) ----
   Prism height follows the pitch: the out-of-plane axis of the orthographic
   tilt projects to the screen "up" vector with length sin(pitch). The bearing
   only spins the map plane about the vertical, so that vector never rotates
   with it — the columns always stand straight up the screen. */
const EXTRUDE_K = 2;
function extrudeHeight(r) { return r * Math.sin(((+settings.pitch || 0) * Math.PI) / 180) * EXTRUDE_K; }
function polyPath(g, pts) {
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}
/* n-gon circle: tilted markers never spend an arc() on a round footprint */
function circlePts(x, y, r, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  return out;
}
/* darken a palette colour for the side faces; anything that is not a hex
   token keeps the flat panel dark instead of inventing a shade */
function shadeColor(c, k) {
  let h = String(c == null ? "" : c).trim();
  if (h[0] === "#") h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-f]{6}$/i.test(h)) return "rgba(8,12,15,.92)";
  const n = parseInt(h, 16);
  return "rgb(" + Math.round((n >> 16 & 255) * k) + "," + Math.round((n >> 8 & 255) * k) + "," + Math.round((n & 255) * k) + ")";
}
/* footprint + front-facing side quads in ONE path, so a single fill paints
   the whole prism at the overlay alpha (no double-dark seams, no arc()):
   a back face swept along the extrusion vector always turns the other way,
   so the winding test drops exactly the faces the solid hides. */
function extrudeSides(g, pts, dx, dy, side) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const sgn = area < 0 ? -1 : 1;
  g.beginPath();
  polyPath(g, pts);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const cr = (b[0] - a[0]) * dy - (b[1] - a[1]) * dx;
    if (cr * sgn <= 0) continue;
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.lineTo(b[0] + dx, b[1] + dy);
    g.lineTo(a[0] + dx, a[1] + dy);
    g.closePath();
  }
  g.fillStyle = side;
  g.fill();
}
function label(g, text, x, y, font, color, halo) {
  g.font = font;
  g.lineWidth = 3; g.strokeStyle = halo || paint("halo", "rgba(6,10,13,.8)"); g.lineJoin = "round";
  g.strokeText(text, x, y);
  g.fillStyle = color; g.fillText(text, x, y);
}
/* map-side UI accent: selection ring, marker pulse, minimap viewport */
const SEL_COLOR = "#22d3ee", SEL_SOFT = "rgba(34,211,238,.4)";
const SEL_FILL = "rgba(34,211,238,.22)", SEL_VIEW = "rgba(34,211,238,.14)";
function drawPin(g, vp) {
  const [sx, sy] = project(pin.x, pin.y, vp);
  const pulse = 1 + 0.25 * Math.sin(performance.now() / 260);
  g.beginPath(); g.arc(sx, sy, 13 * pulse, 0, Math.PI * 2);
  g.fillStyle = SEL_FILL; g.fill();
  g.beginPath();
  g.moveTo(sx, sy);
  g.bezierCurveTo(sx - 9, sy - 12, sx - 7, sy - 24, sx, sy - 27);
  g.bezierCurveTo(sx + 7, sy - 24, sx + 9, sy - 12, sx, sy);
  g.fillStyle = "#ea4335"; g.fill();
  g.lineWidth = 1.6; g.strokeStyle = "#7d1a13"; g.stroke();
  g.beginPath(); g.arc(sx, sy - 17, 4, 0, Math.PI * 2); g.fillStyle = "#fff"; g.fill();
  if (pin.pulse) requestRender();
}
function drawSelection(g, vp) {
  if (selected && selected.kind === "line") return;   // the route itself is highlighted instead
  const p = entityPos(selected);
  if (!p) return;
  const [sx, sy] = project(p.x, p.y, vp);
  g.beginPath(); g.arc(sx, sy, 14, 0, Math.PI * 2);
  g.strokeStyle = SEL_COLOR; g.lineWidth = 2.4; g.stroke();
  g.beginPath(); g.arc(sx, sy, 19, 0, Math.PI * 2);
  g.strokeStyle = SEL_SOFT; g.lineWidth = 1.4; g.stroke();
}
function entityPos(sel) {
  if (!sel) return null;
  if (sel.kind === "town") return { x: sel.item.x, y: sel.item.y };
  if (sel.kind === "industry") return { x: sel.item.x, y: sel.item.y };
  if (sel.kind === "road") return { x: (sel.item.x0 + sel.item.x1) / 2, y: (sel.item.y0 + sel.item.y1) / 2 };
  if (sel.kind === "line" && sel.item.mid) return { x: sel.item.mid[0], y: sel.item.mid[1] };
  return null;
}

/* ---------------- minimap / scale / coords ---------------- */
function drawMinimap() {
  const mm = $("#minimap");
  if (!settings.layers.minimap) { mm.classList.add("hidden"); return; }
  mm.classList.remove("hidden");
  const g = mm.getContext("2d");
  const w = mm.width, h = mm.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = curStyle().bg; g.fillRect(0, 0, w, h);
  if (!data || !terrainCanvas) return;
  const W = data.world;
  const k = Math.min(w / W.width, h / W.height);
  const dw = W.width * k, dh = W.height * k;
  const ox = (w - dw) / 2, oy = (h - dh) / 2;
  g.imageSmoothingEnabled = true;
  g.drawImage(terrainCanvas, ox, oy, dw, dh);
  // viewport rectangle: inverse-project the four stage corners and reduce
  // them to their axis-aligned box — the minimap itself stays north-up
  const corners = [screenToWorld(0, 0), screenToWorld(stageW, 0),
                   screenToWorld(stageW, stageH), screenToWorld(0, stageH)];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of corners) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  x0 = clamp(x0, W.minX, W.maxX); x1 = clamp(x1, W.minX, W.maxX);
  y0 = clamp(y0, W.minY, W.maxY); y1 = clamp(y1, W.minY, W.maxY);
  const rx = ox + (x0 - W.minX) * k;
  const ry = oy + (W.maxY - y1) * k;
  const rw = (x1 - x0) * k;
  const rh = (y1 - y0) * k;
  g.strokeStyle = SEL_COLOR; g.lineWidth = 1.6;
  g.fillStyle = SEL_VIEW;
  g.fillRect(rx, ry, Math.max(2, rw), Math.max(2, rh));
  g.strokeRect(rx, ry, Math.max(2, rw), Math.max(2, rh));
}
$("#minimap").addEventListener("click", e => {
  if (!data) return;
  const mm = e.currentTarget, r = mm.getBoundingClientRect();
  const W = data.world;
  const k = Math.min(mm.width / W.width, mm.height / W.height);
  const ox = (mm.width - W.width * k) / 2, oy = (mm.height - W.height * k) / 2;
  const gx = (e.clientX - r.left) * (mm.width / r.width) - ox;
  const gy = (e.clientY - r.top) * (mm.height / r.height) - oy;
  animateView({
    scale: view.scale,
    x: stageW / 2 - (W.minX + gx / k - W.minX) * view.scale,
    y: stageH / 2 - (W.maxY - (W.maxY - gy / k)) * view.scale,
  }, 380);
});

function updateScaleBar() {
  if (!data) return;
  const targets = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  let best = targets[0], bestPx = 0;
  for (const t of targets) {
    const px = t * view.scale;
    if (px <= 130) { best = t; bestPx = px; }
  }
  $("#scaleLine").style.width = Math.max(30, Math.round(bestPx)) + "px";
  $("#scaleTxt").textContent = best >= 1000 ? (best / 1000) + " km" : best + " m";
}

