/* ---------------- hover / click hit-testing ---------------- */
function nearestEntity(p, radius) {
  if (!data) return null;
  const linesOnly = settings.lineView === "lines";   // map layers are not drawn in this view
  let best = null, bestD = radius;
  const consider = (kind, item, x, y) => {
    const [sx, sy] = project(x, y);
    const d = Math.hypot(sx - p.x, sy - p.y);
    if (d < bestD) { bestD = d; best = { kind, item }; }
  };
  if (!linesOnly && settings.layers.towns) for (const t of data.towns) { if (townValue(t) >= settings.townMin) consider("town", t, t.x, t.y); }
  if (!linesOnly && settings.layers.industries) for (const it of data.industries) { if (!settings.indOff.includes(it.tag)) consider("industry", it, it.x, it.y); }
  if (best) return best;
  /* lines: stop markers first (easy to hit), then the route itself */
  if (settings.layers.lines && data.lines.length) {
    const vis = visibleLines();
    const stopR = Math.max(radius, settings.lineStopSize * 2.2);
    let lineBest = null, lineD = stopR;
    for (const l of vis) {
      for (const s of stopsOf(l)) {
        if (s.x == null) continue;
        const [sx, sy] = project(s.x, s.y);
        const d = Math.hypot(sx - p.x, sy - p.y);
        if (d < lineD) { lineD = d; lineBest = l; }
      }
    }
    if (lineBest) return { kind: "line", item: lineBest };
    if (!settings.lineRoutes) return null;          // routes are not drawn, so not clickable
    let segBest = null, segD = 9;
    for (const l of vis) {
      const pts = l.pts;
      for (let i = 1; i < pts.length; i++) {
        const d = distToSegment(p, { x0: pts[i - 1][0], y0: pts[i - 1][1], x1: pts[i][0], y1: pts[i][1] });
        if (d < segD) { segD = d; segBest = l; }
      }
    }
    if (segBest) return { kind: "line", item: segBest };
  }
  if (!linesOnly && settings.layers.roads) {
    let rd = 8;
    let bestRoad = null;
    for (const r of visibleRoads()) {
      const d = distToSegment(p, r);
      if (d < rd) { rd = d; bestRoad = r; }
    }
    if (bestRoad) return { kind: "road", item: bestRoad };
  }
  return null;
}
function distToSegment(p, r) {
  const [a, ay] = project(r.x0, r.y0);
  const [b, by] = project(r.x1, r.y1);
  const dx = b - a, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - a) * dx + (p.y - ay) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a + dx * t), p.y - (ay + dy * t));
}
function updateHover(p) {
  const ent = data ? nearestEntity(p, 11) : null;
  const changed = (ent && ent.item) !== (hovered && hovered.item);
  hovered = ent;
  canvas.classList.toggle("pick", !!ent);
  if (changed) requestRender();

  if (data) {
    const [wx, wy] = screenToWorld(p.x, p.y);
    const inside = wx >= data.world.minX && wx <= data.world.maxX && wy >= data.world.minY && wy <= data.world.maxY;
    let txt = `x ${fmt(wx)} · y ${fmt(wy)}`;
    if (inside) {
      const elev = elevationAt(wx, wy);
      if (elev !== null) txt += ` · ${elev >= 0 ? "+" : ""}${fmt(elev, 1)} m`;
      txt += ` · tile ${Math.floor((wx - data.world.minX) / 256)}, ${Math.floor((data.world.maxY - wy) / 256)}`;
    }
    $("#coords").textContent = txt;
  }
}
function elevationAt(wx, wy) {
  const t = data.terrain;
  const fx = clamp((wx - data.world.minX) / data.world.width * (t.gw - 1), 0, t.gw - 1);
  // grid rows run south → north (row 0 = minY), same order the terrain raster uses
  const fy = clamp((wy - data.world.minY) / data.world.height * (t.gh - 1), 0, t.gh - 1);
  const i0 = Math.floor(fx), j0 = Math.floor(fy);
  const i1 = Math.min(t.gw - 1, i0 + 1), j1 = Math.min(t.gh - 1, j0 + 1);
  const ax = fx - i0, ay = fy - j0;
  const g = t.grid;
  const a = g[j0 * t.gw + i0], b = g[j0 * t.gw + i1], c = g[j1 * t.gw + i0], d = g[j1 * t.gw + i1];
  return (a + (b - a) * ax) * (1 - ay) + (c + (d - c) * ax) * ay;
}
function handleClick(p) {
  const ent = nearestEntity(p, 13);
  if (ent) showInfo(ent);
  else closeInfo();
}

/* ---------------- info card ---------------- */
function showInfo(ent) {
  selected = ent;
  const card = $("#infocard");
  const title = $("#infoTitle"), sub = $("#infoSub"), body = $("#infoBody");
  if (ent.kind === "town") {
    const t = ent.item;
    title.textContent = t.name;
    sub.textContent = "Town";
    let html =
      row("Position", `${fmt(t.x)}, ${fmt(t.y)} m`) +
      row("Elevation", fmt(elevationAt(t.x, t.y), 1) + " m");
    if (t.population != null) html += row("Population", fmt(t.population));
    if (t.lineUsage != null) html += row("Line coverage", fmt(t.lineUsage * 100, 0) + "%");
    html += metaBlock("Size factors",
      (t.factors || [0, 0, 0]).map((f, i) => `<span>Factor ${i + 1}</span><span>${fmt(f || 0, 1)}</span>`));
    html += row(TOWN_METRIC_LABELS[settings.townMetric] || "Size", fmt(townValue(t), 1));
    if (Array.isArray(t.landUse) && t.landUse.length)
      html += metaBlock("Land use (used / capacity)", t.landUse.map(u =>
        `<span>${esc(humanize(u.type))}</span><span>${fmt(u.used)}${u.capacity != null ? " / " + fmt(u.capacity) : ""}</span>`));
    if (Array.isArray(t.stock) && t.stock.length)
      html += metaBlock("In stock (stock / capacity)", t.stock.map(s =>
        `<span>${esc(cargoLabel(s.name, s.cargoTypeId))}</span><span>${fmt(s.stock)}${s.capacity != null ? " / " + fmt(s.capacity) : ""}</span>`));
    body.innerHTML = `<div class="hint-txt" style="margin:0 0 6px" title="Factors 1–3 are unlabelled size factors from the game; try each metric in the Towns panel.">The game does not label its three size factors.</div>` + html;
  } else if (ent.kind === "industry") {
    const it = ent.item;
    title.textContent = prettyIndustry(it.tag);
    sub.textContent = (it.group === "raw" ? "Raw material site" : "Factory / processing");
    let html =
      row("Position", `${fmt(it.x)}, ${fmt(it.y)} m`) +
      row("Elevation", fmt(elevationAt(it.x, it.y), 1) + " m");
    if (it.level != null || it.maxLevel != null)
      html += row("Level", `${it.level != null ? fmt(it.level) : "—"}${it.maxLevel != null ? " / " + fmt(it.maxLevel) : ""}`);
    if (it.producing != null) html += row("Producing", it.producing ? "yes" : "no");
    if (it.productionRating != null) html += row("Production rating", fmt(it.productionRating, 2));
    if (it.boostFromRule != null) html += row("Bonus from rules", it.boostFromRule ? "yes" : "no");
    if (it.boostFromPersonCapacity != null) html += row("Bonus from workers", it.boostFromPersonCapacity ? "yes" : "no");
    html += row("On water", it.onWater ? "yes" : "no");
    html += row("Rotation", fmt(it.angle * 180 / Math.PI, 0) + "°");
    html += ioBlock(it.inputs, it.outputs);
    body.innerHTML = html;
  } else if (ent.kind === "line") {
    const l = ent.item;
    const prov = routeProvenance(l);
    title.textContent = l.label;
    sub.textContent = `${modesOf(l).length ? modesOf(l).join(", ") : "mode —"} · ${l.stops == null ? "—" : stopsOf(l).length} stops`;
    body.innerHTML =
      row("Mode", esc(modesDisplay(l))) +
      `<div class="kv"><span title="${esc(prov.title)}">Route</span><span>${esc(prov.label)}</span></div>` +
      `<div style="margin-top:8px"><button class="btn small" data-icon="chart" data-econopen="line">Open Analytics panel</button>
       <button class="btn small" data-icon="eye" id="lineShowInList">Show in list</button></div>`;
  } else {
    const r = ent.item;
    const meta = data.templates.find(t => t.tpl === r.tpl);
    title.textContent = meta ? meta.label : "Road";
    sub.textContent = (ROAD_CATS[r.cat] || ROAD_CATS.other).label;
    body.innerHTML =
      row("Length", fmt(r.len, 1) + " m") +
      row("From", `${fmt(r.x0)}, ${fmt(r.y0)} m`) +
      row("To", `${fmt(r.x1)}, ${fmt(r.y1)} m`) +
      row("Midpoint", `${fmt((r.x0 + r.x1) / 2)}, ${fmt((r.y0 + r.y1) / 2)} m`) +
      row("Segments", fmt(meta ? meta.count : 1)) +
      (meta ? `<div class="kv"><span>Template</span><span title="${esc(r.tpl)}">${esc(meta.label)}</span></div>` : "");
  }
  card.classList.add("on");
  hydrateIcons(card);
  updateInfoCard();
  if (ent.kind === "line") { renderLineTable(); renderLineDetail(); renderLineCount(); renderEcon(); scrollLineRowIntoView(ent.item.id); }
  requestRender();
}
/* Selecting a line on the map should reveal its row in the sidebar list. */
function scrollLineRowIntoView(id) {
  const tr = document.querySelector(`tr[data-line="${id}"]`);
  if (tr && tr.scrollIntoView) tr.scrollIntoView({ block: "nearest" });
}
const row = (k, v) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`;
/* A labelled sub-block of small label/value lines (land use, stock, cargo). */
function metaBlock(label, lines) {
  if (!lines || !lines.length) return "";
  return `<div class="kv" style="display:block"><span style="color:var(--muted)" title="${esc(label)}">${esc(label)}</span>`
    + lines.map(l => `<div style="display:flex;justify-content:space-between;gap:12px;font-size:12px;font-variant-numeric:tabular-nums;padding-left:2px">${l}</div>`).join("")
    + `</div>`;
}
function cargoAmount(c) {
  return `${fmt(c.amount == null ? 0 : c.amount)}${c.maxAmount != null ? " / " + fmt(c.maxAmount) : ""}`;
}
function ioBlock(inputs, outputs) {
  let html = "";
  if (Array.isArray(inputs) && inputs.length)
    html += metaBlock("Consumed / year", inputs.map(c => `<span>${esc(cargoLabel(c.name, c.cargoTypeId))}</span><span>${cargoAmount(c)}</span>`));
  if (Array.isArray(outputs) && outputs.length)
    html += metaBlock("Produced / year", outputs.map(c => `<span>${esc(cargoLabel(c.name, c.cargoTypeId))}</span><span>${cargoAmount(c)}</span>`));
  return html;
}
function updateInfoCard() {
  if (!selected || !data) return;
  const card = $("#infocard");
  const p = entityPos(selected);
  if (!p) {                                   // no position (e.g. a line without coordinates)
    card.style.left = Math.max(8, stageW - 260) + "px";
    card.style.top = "16px";
    return;
  }
  const [sx, sy] = project(p.x, p.y);
  const w = card.offsetWidth || 230, h = card.offsetHeight || 150;
  let left = sx + 24, top = sy - h / 2;
  if (left + w > stageW - 8) left = sx - w - 24;
  if (left < 8) left = 8;
  top = clamp(top, 8, Math.max(8, stageH - h - 8));
  card.style.left = Math.round(left) + "px";
  card.style.top = Math.round(top) + "px";
}
function closeInfo() {
  const wasLine = !!(selected && selected.kind === "line");
  selected = null;
  $("#infocard").classList.remove("on");
  if (wasLine && data) { renderLineTable(); renderLineDetail(); renderLineCount(); renderEcon(); }
  requestRender();
}
$("#infoClose").addEventListener("click", closeInfo);

