/* --- drawing (world space) --- */
/* automated route highlight: metric OP value. A line whose metric is missing
   never matches — we never invent a value to compare against. */
const RULE_HIGHLIGHT = "#ffd166";
const RULE_DIM = 0.25;
function lineRuleActive() {
  const r = settings.lineRule;
  return !!(r && r.on && ECON_METRICS[r.metric]);
}
function ruleText(r) {
  const m = ECON_METRICS[r.metric];
  const op = r.op === "==" ? "=" : r.op;
  const v = Number(r.value);
  return `${m ? m.label : r.metric} ${op} ${Number.isFinite(v) ? fmt(v) : String(r.value)}`;
}
function lineRuleMatch(l) {
  const r = settings.lineRule;
  if (!l || !r) return false;
  const m = ECON_METRICS[r.metric];
  if (!m) return false;
  const v = m.get(l);
  if (v == null) return false;                     // no data → no match (never a fake 0)
  const n = Number(r.value);
  if (!Number.isFinite(n)) return false;
  if (r.op === ">") return v > n;
  if (r.op === ">=") return v >= n;
  if (r.op === "<") return v < n;
  if (r.op === "<=") return v <= n;
  if (r.op === "==") return v === n;
  return false;
}
function lineRuleDim(l) { return lineRuleActive() && !lineRuleMatch(l) ? RULE_DIM : 1; }
function drawLineRoutes(g, vp) {
  if (!settings.lineRoutes) return;                 // stops-only mode (routes hidden)
  const vis = visibleLines();
  if (!vis.length) return;
  const inView = new Set(vis);
  const selRaw = selectedLine(), hovRaw = hoveredLine();
  const sel = selRaw && inView.has(selRaw) ? selRaw : null;
  const hov = hovRaw && inView.has(hovRaw) ? hovRaw : null;
  const base = settings.lineWidth;
  const ruleOn = lineRuleActive();
  /* Data layers that live on the routes themselves (Line load, Cargo by line)
     recolour the colour pass below — the casing keeps its dark colour, so the
     overlay reads on the same route silhouette. Line overlays belong to the
     line layer, so they also draw in "Lines only". */
  const dl = settings.dataLayer;
  const colOf = dl === "load" ? loadRouteColor : dl === "linecargo" ? cargoRouteColor : null;
  let scaleW = null;
  if (dl === "linecargo") {
    let maxT = 0;
    for (const l of vis) { const t = metricValue(l, "transported"); if (t != null && t > maxT) maxT = t; }
    if (maxT > 0) {
      scaleW = l => {
        const t = metricValue(l, "transported");
        if (t == null) return base;                 // no figure → default width, never zero
        return base * clamp(0.55 + 1.45 * Math.sqrt(t / maxT), 0.55, 3);
      };
    }
  }
  const zw = overlayZoomK();
  const routeW = (l, extra) => (scaleW ? scaleW(l) : base) * zw + extra;
  g.lineCap = "round"; g.lineJoin = "round";
  g.globalAlpha = settings.overlayOpacity;
  const stroke = (l, w, casing, color, am) => {
    if (!l.path) return;
    g.globalAlpha = settings.overlayOpacity * lineRuleDim(l) * (am === undefined ? 1 : am);
    g.lineWidth = (casing ? w + CASING_OUTLINE : w) / vp.scale;
    g.strokeStyle = color || (casing ? "rgba(8,12,15,.8)" : lineColorCss(l));
    g.setLineDash(l.routeSource === "path" ? [] : [7 / vp.scale, 5 / vp.scale]);
    g.stroke(l.path);
    g.setLineDash([]);
    g.globalAlpha = settings.overlayOpacity;
  };
  /* NIGHT / TRANSPORT lay a soft glow under every route (drawn first = bottom) */
  if (paint("lineGlow", false)) {
    const gc = paint("glowColor", null);
    for (const l of vis) stroke(l, routeW(l, 7), false, gc || lineColorCss(l), 0.3);
  }
  /* matching routes get a bright halo so the rule reads at a glance */
  if (ruleOn) for (const l of vis) if (l.path && lineRuleMatch(l)) stroke(l, routeW(l, 3.4), false, RULE_HIGHLIGHT);
  const emph = new Set([sel, hov].filter(Boolean));
  /* quiet baseline: 127 routes at full strength drown the map — everything
     not hovered/selected sits back so the emphasis reads */
  for (const l of vis) if (!emph.has(l)) stroke(l, routeW(l, 0), true, undefined, 0.72);
  for (const l of vis) if (!emph.has(l)) stroke(l, routeW(l, 0), false, (colOf && colOf(l)) || undefined, 0.72);
  if (hov && !sel) {
    stroke(hov, routeW(hov, 1.6), true);
    stroke(hov, routeW(hov, 1.6), false, (colOf && colOf(hov)) || undefined);
  }
  if (sel) {
    stroke(sel, routeW(sel, 2.8), true);
    stroke(sel, routeW(sel, 2.8), false, (colOf && colOf(sel)) || undefined);
    if (hov && hov !== sel) {
      stroke(hov, routeW(hov, 1.6), true);
      stroke(hov, routeW(hov, 1.6), false, (colOf && colOf(hov)) || undefined);
    }
  }
  g.globalAlpha = 1;
}

/* --- drawing (screen space: stop markers + labels) --- */
function drawLineStops(g, vp) {
  const vis = visibleLines();
  if (!vis.length) return;
  const inView = new Set(vis);
  const selRaw = selectedLine(), hovRaw = hoveredLine();
  const sel = selRaw && inView.has(selRaw) ? selRaw : null;
  const hov = hovRaw && inView.has(hovRaw) ? hovRaw : null;
  const toScreen = (x, y) => project(x, y, vp);
  const onScreen = (sx, sy, m) => sx >= -m && sy >= -m && sx <= vp.w + m && sy <= vp.h + m;

  if (settings.lineStops || sel || hov) {
    for (const l of vis) {
      const strong = l === sel || l === hov;
      if (!settings.lineStops && !strong) continue;
      const col = lineColorCss(l);
      const grow = lineRuleActive() && lineRuleMatch(l) ? 1.35 : 1;   // matching routes: slightly bigger stops
      for (const s of stopsOf(l)) {
        if (s.x == null) continue;
        const [sx, sy] = toScreen(s.x, s.y);
        if (!onScreen(sx, sy, 20)) continue;
        const r = Math.max(0.5, settings.lineStopSize) * (strong ? 1.6 : 1) * grow * paint("stopScale", 1);
        g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2);
        g.fillStyle = col; g.fill();
        g.lineWidth = strong ? 2 : 1.2;
        g.strokeStyle = strong ? "#ffffff" : "rgba(8,12,15,.85)";
        g.stroke();
        if (paint("stopRing", false)) {           /* bright station ring (Night / Transport …) */
          g.beginPath(); g.arc(sx, sy, r + 3, 0, Math.PI * 2);
          g.strokeStyle = paint("stopRingColor", "rgba(255,255,255,.7)");
          g.lineWidth = 1.3; g.stroke();
        }
      }
    }
  }

  if (!settings.lineLabels) return;
  const placed = [];
  const overlaps = r => placed.some(q => !(r.x + r.w < q.x || q.x + q.w < r.x || r.y + r.h < q.y || q.y + q.h < r.y));
  const put = (text, x, y, font, color, priority) => {
    g.font = font;
    const w = (g.measureText ? g.measureText(text).width : text.length * 6.4);
    const rect = { x: x - 3, y: y - 11, w: w + 6, h: 14 };
    if (!onScreen(rect.x, rect.y, 4)) return false;
    if (overlaps(rect) && !priority) return false;   // selected/hovered line name always wins
    placed.push(rect);
    label(g, text, x, y, font, color, paint("lineHalo", null) || undefined);
    return true;
  };
  /* the line's own name first, then (for the selected line) its stop names */
  for (const l of [sel, hov].filter(Boolean)) {
    if (l.mid) put(l.label, ...toScreen(l.mid[0], l.mid[1]), "700 12px system-ui", lineColorCss(l), true);
    if (l !== sel) continue;
    stopsOf(l).forEach((s, i) => {
      if (s.x == null) return;
      const [sx, sy] = toScreen(s.x, s.y);
      const idx = s.index != null ? s.index : i + 1;
      put(`${idx}. ${s.name || "Stop " + idx}`, sx + 8, sy + 4, "600 11.5px system-ui", "#ffffff", false);
    });
  }
}

/* ============================================================
   View / projection
   ============================================================ */
const canvas = $("#map");
const ctx = canvas.getContext("2d");
const stage = $("#stage");
let view = { scale: 0.05, x: 0, y: 0 };   // x,y = screen px of world (minX, maxY)
let stageW = 1, stageH = 1, dpr = 1;
let selected = null, hovered = null, pin = null;

function screenToWorld(sx, sy) {
  const s = view.scale;
  if (tiltActive()) {
    const cx = stageW / 2, cy = stageH / 2;
    if (cam3d && cam3d.active && Math.abs(cam3d.sinP) > 1e-5) {
      // 3D inverse: find the world point on the terrain surface under the cursor
      const sinP = cam3d.sinP;
      const exag = cam3d.exag || 1;
      let z = 0, wx, wy;
      for (let i = 0; i < 12; i++) {
        const u = untilePt(sx, sy + z * s * exag * sinP, cx, cy);
        wx = data.world.minX + (u[0] - view.x) / s;
        wy = data.world.maxY - (u[1] - view.y) / s;
        const z2 = z3dAt(wx, wy);
        const dz = z2 - z;
        if (Math.abs(dz) < 0.05) break;
        z += dz * 0.65;
      }
      return [wx, wy];
    }
    const u = untilePt(sx, sy, cx, cy); sx = u[0]; sy = u[1];
  }
  return [data.world.minX + (sx - view.x) / s, data.world.maxY - (sy - view.y) / s];
}

/* ============================================================
   3D / tilt view (kepler-style) — one affine matrix M between the
   north-up screen space and the tilted screen space:

     M = translate(C) · scaleY(cos pitch) · rotate(bearing) · translate(-C)

   C is the stage centre: the single point the tilt never moves, so a
   point centred in north-up space stays centred on screen. pitch 0 +
   bearing 0 => M is the identity and is skipped everywhere, which keeps
   the default draw on exactly the canvas operations it always had.
   ============================================================ */
const TILT_MAX = 60;
function normBearing(b) {
  b = (+b || 0) % 360;
  if (b > 180) b -= 360;
  if (b < -180) b += 360;
  return b;
}
function tiltActive() { return !!settings && ((+settings.pitch || 0) !== 0 || (+settings.bearing || 0) !== 0); }
/* [a,b,c,d] of M in canvas order (x' = a·x + c·y + e), cached per setting pair */
function tiltParams() {
  const p = clamp(+settings.pitch || 0, 0, TILT_MAX), b = normBearing(+settings.bearing || 0);
  if (!p && !b) return null;
  const key = p + "/" + b, prev = tiltParams._c;
  if (!prev || prev.key !== key) {
    const t = (b * Math.PI) / 180, ct = Math.cos(t), st = Math.sin(t);
    const ky = Math.cos((p * Math.PI) / 180);          // screen-y compression of the pitch
    tiltParams._c = { key, m: [ct, ky * st, -st, ky * ct] };
  }
  return tiltParams._c.m;
}
/* full matrix incl. the translation about (cx, cy), for setTransform() */
function tiltMat(cx, cy) {
  const m = tiltParams();
  if (!m) return null;
  return [m[0], m[1], m[2], m[3], cx - (m[0] * cx + m[2] * cy), cy - (m[1] * cx + m[3] * cy)];
}
/* north-up screen -> tilted screen (plain identity while flat) */
function tiltPt(sx, sy, cx, cy) {
  const m = tiltParams();
  if (!m) return [sx, sy];
  const ex = cx - (m[0] * cx + m[2] * cy), ey = cy - (m[1] * cx + m[3] * cy);
  return [m[0] * sx + m[2] * sy + ex, m[1] * sx + m[3] * sy + ey];
}
/* screen delta -> north-up delta: the linear inverse of M */
function untileVec(dx, dy) {
  const m = tiltParams();
  if (!m) return [dx, dy];
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return [dx, dy];
  return [(m[3] * dx - m[2] * dy) / det, (m[0] * dy - m[1] * dx) / det];
}
/* tilted screen -> north-up screen */
function untilePt(sx, sy, cx, cy) {
  const m = tiltParams();
  if (!m) return [sx, sy];
  const ex = cx - (m[0] * cx + m[2] * cy), ey = cy - (m[1] * cx + m[3] * cy);
  return untileVec(sx - ex, sy - ey);
}
/* world -> north-up screen -> tilted screen. The single projection every
   screen-space draw and every hit test goes through; vp is the drawing
   context's own viewport (export / harness), the live view otherwise. */
function project(wx, wy, vp, wz) {
  const s = vp ? vp.scale : view.scale;
  const sx = (vp ? vp.ox : view.x) + (wx - data.world.minX) * s;
  const sy = (vp ? vp.oy : view.y) + (data.world.maxY - wy) * s;
  if (!tiltActive()) return [sx, sy];
  // live 3D view: add elevation offset to make the point sit on the terrain surface
  if (cam3d && cam3d.active && (!vp || vp.live) && wz !== 0) {
    const z = wz !== undefined ? wz : z3dAt(wx, wy) + overlayLift();
    return tiltPt3D(sx, sy, z, s);
  }
  return tiltPt(sx, sy, (vp ? vp.w : stageW) / 2, (vp ? vp.h : stageH) / 2);
}
function clampView() {
  if (!data) return;
  const sw = data.world.width * view.scale, sh = data.world.height * view.scale;
  const mx = Math.min(150, sw * 0.5, stageW * 0.5);
  const my = Math.min(150, sh * 0.5, stageH * 0.5);
  view.x = clamp(view.x, mx - sw, stageW - mx);
  view.y = clamp(view.y, my - sh, stageH - my);
}
function fitScale() {
  if (!data) return 0.05;
  const pad = 40;
  return Math.min((stageW - pad * 2) / data.world.width, (stageH - pad * 2) / data.world.height);
}
function limits() {
  const f = fitScale();
  return { min: f * 0.5, max: Math.max(f * 600, 24) };
}
function snapFitAxes() {
  // An axis that shows the whole world has nothing to pan — keep it centred.
  if (!data) return;
  const sw = data.world.width * view.scale, sh = data.world.height * view.scale;
  if (sw <= stageW) view.x = (stageW - sw) / 2;
  if (sh <= stageH) view.y = (stageH - sh) / 2;
}
function setView(s, x, y) {
  const lim = limits();
  view.scale = clamp(s, lim.min, lim.max);
  view.x = x; view.y = y;
  snapFitAxes();
  clampView();
  requestRender();
}
/* after a drag/flick, spring any axis that fits on screen back to centre */
function settle() {
  if (!data || drag || pinch) return;
  const sw = data.world.width * view.scale, sh = data.world.height * view.scale;
  const tx = sw <= stageW ? (stageW - sw) / 2 : view.x;
  const ty = sh <= stageH ? (stageH - sh) / 2 : view.y;
  if (Math.abs(tx - view.x) > 0.5 || Math.abs(ty - view.y) > 0.5)
    animateView({ scale: view.scale, x: tx, y: ty }, 340);
}
function centerOn(wx, wy, scale) {
  const s = scale || view.scale;
  setView(s, stageW / 2 - (wx - data.world.minX) * s, stageH / 2 - (data.world.maxY - wy) * s);
}
function fit(animate) {
  if (!data) return;
  const s = fitScale();
  const x = (stageW - data.world.width * s) / 2;
  const y = (stageH - data.world.height * s) / 2;
  if (animate) animateView({ scale: s, x, y }, 420);
  else { view.scale = s; view.x = x; view.y = y; clampView(); requestRender(); }
}

/* animated camera moves */
let anim = null;
function animateView(target, dur = 450) {
  cancelAnim();
  const from = { ...view };
  const lim = limits();
  target.scale = clamp(target.scale, lim.min, lim.max);
  const t0 = performance.now();
  anim = { id: requestAnimationFrame(step) };
  function step(now) {
    const k = clamp((now - t0) / dur, 0, 1);
    const e = 1 - Math.pow(1 - k, 3);
    view.scale = from.scale + (target.scale - from.scale) * e;
    view.x = from.x + (target.x - from.x) * e;
    view.y = from.y + (target.y - from.y) * e;
    clampView(); requestRender();
    if (k < 1 && anim) anim.id = requestAnimationFrame(step);
    else { anim = null; settle(); }
  }
}
function cancelAnim() { if (anim) { cancelAnimationFrame(anim.id); anim = null; } }
function zoomBy(factor, sx, sy, animate) {
  if (!data) return;
  const lim = limits();
  const target = clamp(view.scale * factor, lim.min, lim.max);
  if (sx === undefined) { sx = stageW / 2; sy = stageH / 2; }
  else if (tiltActive()) {
    /* keep the world point under the cursor: anchor on its north-up spot */
    const u = untilePt(sx, sy, stageW / 2, stageH / 2);
    sx = u[0]; sy = u[1];
  }
  const k = target / view.scale;
  const tx = sx - (sx - view.x) * k;
  const ty = sy - (sy - view.y) * k;
  if (animate) animateView({ scale: target, x: tx, y: ty }, 220);
  else setView(target, tx, ty);
}

