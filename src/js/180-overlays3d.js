/* ---------------- draped overlay paths ---------------- */
function ensureDrape3D(vp) {
  if (!cam3d || !cam3d.active) { drape3d = null; return; }
  // quantise the camera so tiny sub-pixel pans/zooms reuse the cached paths
  const sig = `${cam3d.pitch.toFixed(1)}|${cam3d.bearing.toFixed(1)}|${view.scale.toFixed(4)}|${Math.round(view.x)}|${Math.round(view.y)}|${settings.exaggeration.toFixed(1)}|${vp.w}|${vp.h}|${settings.roadWidth}|${settings.roadCasing}|${settings.contourInterval}|${settings.layers.contours}|${settings.layers.grid}|${settings.lineWidth}`;
  if (drape3d && drape3d.sig === sig) return;
  drape3d = { sig, roads: buildRoadPaths3D(), rails: buildRailPaths3D(), lines: buildLinePaths3D(), contours: buildContourPaths3D(), grid: buildGridPaths3D() };
}

function drapePolyline(pts, stepWorldMin) {
  if (!pts || pts.length < 2) return null;
  const s = view.scale;
  const LIFT = overlayLift(3.0);
  const out = [];
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    let z = z3dAt(p[0], p[1]) + LIFT;
    let [sx, sy] = project(p[0], p[1], null, z);
    if (k > 0) {
      const dx = p[0] - pts[k - 1][0], dy = p[1] - pts[k - 1][1];
      const len = Math.hypot(dx, dy);
      const step = Math.max(stepWorldMin || 6 / s, len / 12);
      const n = Math.max(1, Math.min(24, Math.ceil(len / step)));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const wx = pts[k - 1][0] + dx * t;
        const wy = pts[k - 1][1] + dy * t;
        z = z3dAt(wx, wy) + LIFT;
        const [x, y] = project(wx, wy, null, z);
        out.push([x, y, !isOccluded(wx, wy)]);
      }
    }
    out.push([sx, sy, !isOccluded(p[0], p[1])]);
  }
  // A single occluded sample between two visible ones is a depth-sampling
  // artefact rather than a real occluder; bridge it so the stroke does not
  // develop a one-point hole that flickers with sub-pixel camera motion.
  for (let i = 1; i < out.length - 1; i++) {
    if (!out[i][2] && out[i - 1][2] && out[i + 1][2]) out[i][2] = true;
  }
  const spans = [];
  let cur = null;
  for (const [x, y, vis] of out) {
    if (vis) {
      if (!cur) { cur = new Path2D(); cur.moveTo(x, y); }
      else cur.lineTo(x, y);
    } else {
      if (cur) { spans.push(cur); cur = null; }
    }
  }
  if (cur) spans.push(cur);
  return spans.length ? spans : null;
}

function buildRoadPaths3D() {
  const map = new Map();
  const visible = new Set(visibleTemplates());
  for (const r of data.roads) {
    if (!visible.has(r.tpl)) continue;
    let spans = map.get(r.tpl);
    if (!spans) { spans = []; map.set(r.tpl, spans); }
    const s = drapePolyline([[r.x0, r.y0], [r.x1, r.y1]], 8 / view.scale);
    if (s) spans.push(...s);
  }
  return map;
}

function buildRailPaths3D() {
  const out = [];
  for (const r of (data.rails || [])) {
    const pts = r.points && r.points.length > 1 ? r.points : [[r.x0, r.y0], [r.x1, r.y1]];
    const spans = drapePolyline(pts, 6 / view.scale);
    if (spans) out.push({ spans, rec: r });
  }
  return out;
}

function buildLinePaths3D() {
  const out = [];
  for (const l of data.lines) {
    if (!l.pts || l.pts.length < 2) continue;
    const spans = drapePolyline(l.pts, 10 / view.scale);
    if (spans) out.push({ l, spans });
  }
  return out;
}

function buildContourPaths3D() {
  if (!contourPaths || !contourPaths.segments) return null;
  const minor = [], index = [];
  const segs = contourPaths.segments;
  for (let i = 0; i < segs.length; i++) {
    const [x0, y0, x1, y1, lev, isIndex] = segs[i];
    const z = lev + overlayLift(2.0);
    const a = project(x0, y0, null, z);
    const b = project(x1, y1, null, z);
    if ((a[0] < -100 && b[0] < -100) || (a[1] < -100 && b[1] < -100) ||
        (a[0] > stageW + 100 && b[0] > stageW + 100) || (a[1] > stageH + 100 && b[1] > stageH + 100)) continue;
    if (isOccluded(x0, y0) && isOccluded(x1, y1)) continue;
    const p = new Path2D(); p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]);
    (isIndex ? index : minor).push(p);
  }
  return { minor, index };
}

function buildGridPaths3D() {
  if (!settings.layers.grid) return null;
  const W = data.world;
  const step = pickGridStep(view.scale);
  const out = [];
  for (let x = Math.ceil(W.minX / step) * step; x <= W.maxX; x += step) {
    const spans = drapePolyline([[x, W.minY], [x, W.maxY]], 12 / view.scale);
    if (spans) out.push(...spans);
  }
  for (let y = Math.ceil(W.minY / step) * step; y <= W.maxY; y += step) {
    const spans = drapePolyline([[W.minX, y], [W.maxX, y]], 12 / view.scale);
    if (spans) out.push(...spans);
  }
  return out;
}

