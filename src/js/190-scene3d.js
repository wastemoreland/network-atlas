/* ---------------- 3D scene drawing ---------------- */

/* Overlay strokes are a fixed pixel width in the map's own world transform, so
   without this they do not grow as the terrain is zoomed. Scale them by the
   current zoom relative to a world-fit view (where the configured width is the
   intended one), clamped so the network neither vanishes when zoomed out nor
   becomes slabs when zoomed in. Used by both the 2D and the 3D overlay pass so
   the two modes always agree at the same zoom and switching between them does
   not change the thickness. */
function overlayZoomK() {
  const ratio = view.scale / Math.max(1e-6, fitScale());
  // Exact at (and above) the world-fit view; a touch thinner below it so a
  // zoomed-out network recedes instead of crowding the terrain.
  const k = ratio < 1 ? ratio * (0.8 + 0.2 * ratio) : ratio;
  return clamp(k, 0.2, 6);
}

function drawScene3D(g, vp) {
  g.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
  g.clearRect(0, 0, vp.w, vp.h);
  if (!data) return;

  ensureDrape3D(vp);
  const ov = settings.overlayOpacity;
  const linesOnly = settings.lineView === "lines";
  const zw = overlayZoomK();

  g.save();
  g.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
  g.lineCap = "round"; g.lineJoin = "round";

  if (!linesOnly && settings.layers.contours && drape3d && drape3d.contours) {
    const px = Math.max(0.35, settings.contourWidth);
    g.globalAlpha = ov * 0.55;
    g.strokeStyle = settings.contourColor;
    g.lineWidth = px * zw;
    for (const p of drape3d.contours.minor) g.stroke(p);
    if (settings.contourIndex) {
      g.globalAlpha = ov * 0.95;
      g.lineWidth = px * 1.8 * zw;
      for (const p of drape3d.contours.index) g.stroke(p);
    }
    g.globalAlpha = 1;
  }

  if (!linesOnly && settings.layers.grid && drape3d && drape3d.grid) {
    const dark = isDarkStyle(settings.style);
    g.strokeStyle = dark ? "rgba(255,255,255,.18)" : "rgba(45,35,15,.28)";
    g.lineWidth = clamp(zw, 0.5, 3);
    for (const p of drape3d.grid) g.stroke(p);
  }

  if (!linesOnly && settings.layers.roads && drape3d && drape3d.roads && ov > 0) {
    const visible = visibleTemplates();
    const list = [];
    for (const tpl of visible) {
      const spans = drape3d.roads.get(tpl);
      if (!spans || !spans.length) continue;
      const meta = data.templates.find(t => t.tpl === tpl);
      const cat = meta ? meta.cat : "other";
      list.push({ tpl, spans, cat, w: settings.roadWidth * roadWeight(tpl, cat) });
    }
    list.sort((a, b) => b.w - a.w);
    if (settings.roadCasing) {
      g.strokeStyle = paint("casing", isDarkStyle(settings.style) ? "rgba(6,10,13,.8)" : "rgba(74,84,96,.4)");
      g.globalAlpha = ov;
      for (const r of list) {
        g.lineWidth = r.w * zw + CASING_OUTLINE;
        for (const p of r.spans) g.stroke(p);
      }
    }
    const single = settings.roadColorMode === "single";
    for (const r of list) {
      g.lineWidth = r.w * zw;
      g.strokeStyle = single ? settings.roadColor : roadColorFor(r.cat);
      g.globalAlpha = ov;
      for (const p of r.spans) g.stroke(p);
    }
    g.globalAlpha = 1;
  }

  if (!linesOnly && settings.layers.roads && drape3d && drape3d.rails && drape3d.rails.length && ov > 0) {
    const pal = isDarkStyle(settings.style) ? RAIL_DARK : RAIL_LIGHT;
    const list = drape3d.rails.map(r => ({ spans: r.spans, rec: r.rec, w: settings.roadWidth * railWeight(r.rec) }));
    list.sort((a, b) => b.w - a.w);
    for (const r of list) {
      g.globalAlpha = ov * railEdgeAlpha(r.rec.edgeType);
      g.lineWidth = r.w * zw + CASING_OUTLINE;
      g.strokeStyle = pal.casing;
      for (const p of r.spans) g.stroke(p);
    }
    for (const r of list) {
      g.globalAlpha = ov * railEdgeAlpha(r.rec.edgeType);
      g.lineWidth = r.w * zw;
      g.strokeStyle = r.rec.edgeType === "BRIDGE" ? pal.bridge : pal.fill;
      for (const p of r.spans) g.stroke(p);
    }
    g.globalAlpha = 1;
  }

  if (settings.layers.lines && data.lines.length && drape3d && drape3d.lines) drawLineRoutes3D(g, vp);
  g.restore();

  g.save();
  g.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
  g.globalAlpha = ov;
  if (!linesOnly && settings.layers.industries) drawIndustries3D(g, vp);
  if (!linesOnly && settings.layers.towns) drawTowns3D(g, vp);
  if (!linesOnly && dataLayerMapOn()) drawDataLayers(g, vp);
  if (settings.layers.lines && data.lines.length) drawLineStops3D(g, vp);
  if (pin) drawPin3D(g, vp);
  if (selected) drawSelection3D(g, vp);
  g.globalAlpha = 1;
  g.restore();
}

function drawLineRoutes3D(g, vp) {
  if (!settings.lineRoutes) return;
  const vis = visibleLines();
  if (!vis.length) return;
  const inView = new Set(vis);
  const selRaw = selectedLine(), hovRaw = hoveredLine();
  const sel = selRaw && inView.has(selRaw) ? selRaw : null;
  const hov = hovRaw && inView.has(hovRaw) ? hovRaw : null;
  const base = settings.lineWidth;
  const ruleOn = lineRuleActive();
  const dl = settings.dataLayer;
  const colOf = dl === "load" ? loadRouteColor : dl === "linecargo" ? cargoRouteColor : null;
  let scaleW = null;
  if (dl === "linecargo") {
    let maxT = 0;
    for (const l of vis) { const t = metricValue(l, "transported"); if (t != null && t > maxT) maxT = t; }
    if (maxT > 0) scaleW = l => {
      const t = metricValue(l, "transported");
      return t == null ? base : base * clamp(0.55 + 1.45 * Math.sqrt(t / maxT), 0.55, 3);
    };
  }
  const zw = overlayZoomK();
  const routeW = (l, extra) => (scaleW ? scaleW(l) : base) * zw + extra;
  g.lineCap = "round"; g.lineJoin = "round";

  const stroke = (item, w, casing, color, am) => {
    if (!item.spans) return;
    g.globalAlpha = settings.overlayOpacity * lineRuleDim(item.l) * (am === undefined ? 1 : am);
    g.lineWidth = casing ? w + CASING_OUTLINE : w;
    g.strokeStyle = color || (casing ? "rgba(8,12,15,.8)" : lineColorCss(item.l));
    g.setLineDash(item.l.routeSource === "path" ? [] : [7, 5]);
    for (const p of item.spans) g.stroke(p);
    g.setLineDash([]);
    g.globalAlpha = settings.overlayOpacity;
  };

  const map = new Map();
  for (const item of drape3d.lines) map.set(item.l.id, item);
  const all = vis.map(l => map.get(l.id)).filter(Boolean);
  const emph = new Set([sel, hov].filter(Boolean).map(l => map.get(l.id)).filter(Boolean));
  for (const item of all) {
    if (paint("lineGlow", false)) {
      const gc = paint("glowColor", null);
      stroke(item, routeW(item.l, 7), false, gc || lineColorCss(item.l), 0.3);
    }
  }
  if (ruleOn) for (const item of all) if (lineRuleMatch(item.l)) stroke(item, routeW(item.l, 3.4), false, RULE_HIGHLIGHT);
  for (const item of all) if (!emph.has(item)) stroke(item, routeW(item.l, 0), true, undefined, 0.72);
  for (const item of all) if (!emph.has(item)) stroke(item, routeW(item.l, 0), false, (colOf && colOf(item.l)) || undefined, 0.72);
  if (hov && !sel) {
    const item = map.get(hov.id); if (item) { stroke(item, routeW(hov, 1.6), true); stroke(item, routeW(hov, 1.6), false, (colOf && colOf(hov)) || undefined); }
  }
  if (sel) {
    const item = map.get(sel.id); if (item) { stroke(item, routeW(sel, 2.8), true); stroke(item, routeW(sel, 2.8), false, (colOf && colOf(sel)) || undefined); }
    if (hov && hov !== sel) {
      const item2 = map.get(hov.id); if (item2) { stroke(item2, routeW(hov, 1.6), true); stroke(item2, routeW(hov, 1.6), false, (colOf && colOf(hov)) || undefined); }
    }
  }
  g.globalAlpha = 1;
}

function drawTowns3D(g, vp) {
  const max = data.townMax || 1;
  const list = data.towns.map(t => ({ t, v: townValue(t) })).filter(o => o.v >= settings.townMin).sort((a, b) => b.v - a.v);
  const placed = [];
  for (const { t, v } of list) {
    if (isOccluded(t.x, t.y)) continue;
    const [sx, sy] = project(t.x, t.y, vp);
    if (sx < -60 || sy < -60 || sx > vp.w + 60 || sy > vp.h + 60) continue;
    const rank = Math.sqrt(v / max);
    const r = (4.5 + 13 * rank) * settings.townSize;
    if (paint("townNodes", false)) {
      const rr = Math.max(3, r * 0.42);
      const node = paint("townNode", "#f6c558");
      const halo = paint("halo", "rgba(6,10,13,.8)");
      const dy = -extrudeHeight(rr);
      extrudeSides(g, circlePts(sx, sy, rr, 12), 0, dy, shadeColor(node, 0.55));
      g.beginPath(); polyPath(g, circlePts(sx, sy + dy, rr, 12));
      g.fillStyle = node; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = halo; g.stroke();
    }
    if (!settings.townLabels) continue;
    const base = paint("townFont", "600 12.5px system-ui");
    const m = /(\d+(?:\.\d+)?)px/.exec(base);
    const size = (m ? parseFloat(m[1]) : 12.5) * (0.94 + 0.45 * rank);
    let font = base.replace(/(\d+(?:\.\d+)?)px/, size.toFixed(1) + "px");
    if (rank > 0.55) font = font.replace(/^(\d{3})/, w => String(Math.max(+w, 700)));
    const x = sx + r + 5, y = sy - r - 3;
    g.font = font;
    const w = (g.measureText ? g.measureText(t.name).width : t.name.length * 6.4);
    const box = { x: x - 3, y: y - size, w: w + 6, h: size * 1.35 };
    const hit = placed.some(p => !(box.x > p.x + p.w || box.x + box.w < p.x || box.y > p.y + p.h || box.y + box.h < p.y));
    if (hit) continue;
    placed.push(box);
    label(g, t.name, x, y, font, paint("townLabel", "#ffe6a8"));
  }
}

function drawIndustries3D(g, vp) {
  const showLabels = settings.indLabels || (settings.indAutoLabels && vp.scale >= 1);
  for (const it of data.industries) {
    if (settings.indOff.includes(it.tag)) continue;
    if (isOccluded(it.x, it.y)) continue;
    const [sx, sy] = project(it.x, it.y, vp);
    if (sx < -40 || sy < -40 || sx > vp.w + 40 || sy > vp.h + 40) continue;
    const color = IND_GROUPS[it.group] || IND_GROUPS.other;
    const k = paint("indScale", 1);
    const s = 6.5 * k;
    const dy = -extrudeHeight(s * 0.55);
    drawIndustryIcon(g, it.group, sx, sy + dy, s, color);
    if (it.onWater) {
      g.beginPath();
      polyPath(g, circlePts(sx, sy, s + 3, 12));
      g.strokeStyle = "rgba(120,220,255,.85)"; g.lineWidth = 1.2; g.stroke();
    }
    if (showLabels) label(g, prettyIndustry(it.tag), sx + s + 4, sy + 4, "600 11.5px system-ui", color);
  }
}

function drawLineStops3D(g, vp) {
  const vis = visibleLines();
  if (!vis.length) return;
  const inView = new Set(vis);
  const selRaw = selectedLine(), hovRaw = hoveredLine();
  const sel = selRaw && inView.has(selRaw) ? selRaw : null;
  const hov = hovRaw && inView.has(hovRaw) ? hovRaw : null;
  const onScreen = (sx, sy, m) => sx >= -m && sy >= -m && sx <= vp.w + m && sy <= vp.h + m;

  if (settings.lineStops || sel || hov) {
    for (const l of vis) {
      const strong = l === sel || l === hov;
      if (!settings.lineStops && !strong) continue;
      const col = lineColorCss(l);
      const grow = lineRuleActive() && lineRuleMatch(l) ? 1.35 : 1;
      for (const s of stopsOf(l)) {
        if (s.x == null) continue;
        if (isOccluded(s.x, s.y)) continue;
        const [sx, sy] = project(s.x, s.y, vp);
        if (!onScreen(sx, sy, 20)) continue;
        const r = Math.max(0.5, settings.lineStopSize) * (strong ? 1.6 : 1) * grow * paint("stopScale", 1);
        g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2);
        g.fillStyle = col; g.fill();
        g.lineWidth = strong ? 2 : 1.2;
        g.strokeStyle = strong ? "#ffffff" : "rgba(8,12,15,.85)";
        g.stroke();
        if (paint("stopRing", false)) {
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
    if (overlaps(rect) && !priority) return false;
    placed.push(rect);
    label(g, text, x, y, font, color, paint("lineHalo", null) || undefined);
    return true;
  };
  for (const l of [sel, hov].filter(Boolean)) {
    if (l.mid) put(l.label, ...project(l.mid[0], l.mid[1], vp), "700 12px system-ui", lineColorCss(l), true);
    if (l !== sel) continue;
    stopsOf(l).forEach((s, i) => {
      if (s.x == null) return;
      const [sx, sy] = project(s.x, s.y, vp);
      const idx = s.index != null ? s.index : i + 1;
      put(`${idx}. ${s.name || "Stop " + idx}`, sx + 8, sy + 4, "600 11.5px system-ui", "#ffffff", false);
    });
  }
}

function drawPin3D(g, vp) {
  if (isOccluded(pin.x, pin.y)) return;
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

function drawSelection3D(g, vp) {
  if (selected && selected.kind === "line") return;
  const p = entityPos(selected);
  if (!p) return;
  if (isOccluded(p.x, p.y)) return;
  const [sx, sy] = project(p.x, p.y, vp);
  g.beginPath(); g.arc(sx, sy, 14, 0, Math.PI * 2);
  g.strokeStyle = SEL_COLOR; g.lineWidth = 2.4; g.stroke();
  g.beginPath(); g.arc(sx, sy, 19, 0, Math.PI * 2);
  g.strokeStyle = SEL_SOFT; g.lineWidth = 1.4; g.stroke();
}

