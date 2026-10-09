/* ============================================================
   Data layers — economic / logistical overlays
   Flat screen-space drawing on top of the map. Every preset degrades to a
   written note (sidebar + legend) when the export lacks its data, and no
   preset invents values: unresolvable rows are skipped, absent figures
   keep the default size or the line's own colour.
   ============================================================ */
const MAP_DATA_LAYERS = ["flows", "freight", "passengers", "chains"];
function dataLayerActive() { return settings.dataLayer !== "none"; }
/* map-context presets hide in "Lines only"; the two line overlays do not */
function dataLayerMapOn() { return dataLayerActive() && MAP_DATA_LAYERS.indexOf(settings.dataLayer) >= 0; }
function dataLayerTitle() { return DATA_LAYER_TITLES[settings.dataLayer] || "None"; }
function dataLayerLabel() { return DATA_LAYER_METRICS[settings.dataLayer] || ""; }

/* entity id -> { rec, ind }: flow endpoints are resolved against the export,
   never guessed — a row whose endpoint is unknown is dropped. */
function entityLookup() {
  if (entIndex) return entIndex;
  entIndex = new Map();
  if (data) {
    for (const it of data.industries) if (it.entity != null && !entIndex.has(it.entity)) entIndex.set(it.entity, { rec: it, ind: true });
    for (const t of data.towns) if (t.entity != null && !entIndex.has(t.entity)) entIndex.set(t.entity, { rec: t, ind: false });
  }
  return entIndex;
}
function screenPos(vp, x, y) {
  return project(x, y, vp);
}
/* null = the export carries no flow block at all (the "missing data" state) */
function flowRows(industryOnly) {
  const e = data && data.econ;
  if (!e || !e.flows || !e.flows.length) return null;
  const idx = entityLookup();
  const out = [];
  for (const f of e.flows) {
    if (f.volume == null) continue;                 // no volume → nothing to size the line with
    const a = idx.get(f.from), b = idx.get(f.to);
    if (!a || !b) continue;                         // unresolved endpoint → skip, never fabricate
    if (industryOnly && !(a.ind && b.ind)) continue;
    out.push({ f, a: a.rec, b: b.rec });
  }
  return out;
}
/* width scale: sqrt(volume) normalised to the 95th percentile */
function p95(values) {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}
/* ---- route colours shared by the map and the legend ---- */
function loadRouteColor(l) {
  const v = metricValue(l, "load");                 // same helper as the route rule
  if (v == null) return null;                       // no report → the line keeps its own colour
  return v < 40 ? LOAD_RAMP.low : v <= 85 ? LOAD_RAMP.ok : LOAD_RAMP.high;
}
function dominantCargo(l) {
  const list = l.capacity;
  if (!list || !list.length) return null;
  let best = null;
  for (const c of list) {
    if (c.capacity == null) continue;
    if (!best || c.capacity > best.capacity) best = c;
  }
  return best;
}
function cargoRouteColor(l) {
  const c = dominantCargo(l);
  return c ? cargoColor(c.cargoTypeId) : null;
}
function cargoLabel(name, id) {
  if (name) return prettyIndustry(niceLabel(name));
  return id != null ? "#" + id : "Cargo";
}
/* ---- freight volume: yearly output per industry, absent stays absent ---- */
function industryOutput(it) {
  const outs = it.outputs;
  if (!outs || !outs.length) return null;
  let sum = 0, any = false;
  for (const o of outs) if (o && o.amount != null) { sum += o.amount; any = true; }
  return any ? sum : null;
}
function freightVisible(it) { return !settings.indOff.includes(it.tag); }
function freightStats() {
  let max = 0, min = null, n = 0;
  for (const it of data.industries) {
    if (!freightVisible(it)) continue;
    const v = industryOutput(it);
    if (v == null) continue;                        // industries without a reported output
    n++;                                            // stay out of the legend range
    if (v > max) max = v;
    if (min === null || v < min) min = v;
  }
  return { max, min: min === null ? 0 : min, n };
}
function townPopulation(t) { return (t.population != null && t.population > 0) ? t.population : null; }
function passengerStats() {
  let max = 0, min = null, n = 0;
  for (const t of data.towns) {
    const p = townPopulation(t);
    if (p == null) continue;
    n++;
    if (p > max) max = p;
    if (min === null || p < min) min = p;
  }
  return { max, min: min === null ? 0 : min, n };
}
/* ---- drawing (screen space, after the routes) ---- */
function drawFlowLayer(g, vp, industryOnly) {
  const rows = flowRows(industryOnly);
  if (!rows || !rows.length) return 0;
  const ref = p95(rows.map(r => r.f.volume)) || 1;
  const sc = settings.dataScale;
  const widthPx = v => clamp(1.5, Math.sqrt(v / ref) * 14, 14) * sc;
  /* one colour group at a time: strokeStyle changes once per cargo, the
     per-row width still gets its own path */
  const groups = new Map();
  for (const r of rows) {
    const c = cargoColor(r.f.cargoTypeId);
    let list = groups.get(c);
    if (!list) { list = []; groups.set(c, list); }
    list.push(r);
  }
  const arrows = [];
  for (const [color, list] of groups) {
    g.strokeStyle = color;
    for (const r of list) {
      if (is3DActive() && isOccluded(r.a.x, r.a.y) && isOccluded(r.b.x, r.b.y)) continue;
      const [x1, y1] = screenPos(vp, r.a.x, r.a.y);
      const [x2, y2] = screenPos(vp, r.b.x, r.b.y);
      const w = widthPx(r.f.volume);
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
      if (w >= 4) arrows.push({ x1, y1, x2, y2, w, color });
    }
  }
  /* chevron at the destination of the heavier flows — two segments, no arc */
  if (arrows.length) {
    g.lineWidth = Math.max(1.2, 1.6 * sc);
    const byColor = new Map();
    for (const a of arrows) {
      let list = byColor.get(a.color);
      if (!list) { list = []; byColor.set(a.color, list); }
      list.push(a);
    }
    for (const [color, list] of byColor) {
      g.strokeStyle = color;
      g.beginPath();
      for (const a of list) {
        const back = Math.atan2(a.y2 - a.y1, a.x2 - a.x1) + Math.PI;
        const len = clamp(a.w * 1.4, 5, 13);
        g.moveTo(a.x2 + Math.cos(back + 0.55) * len, a.y2 + Math.sin(back + 0.55) * len);
        g.lineTo(a.x2, a.y2);
        g.lineTo(a.x2 + Math.cos(back - 0.55) * len, a.y2 + Math.sin(back - 0.55) * len);
      }
      g.stroke();
    }
  }
  return rows.length;
}
function drawFreightLayer(g, vp) {
  const st = freightStats();
  const k = st.max > 0 ? 14 / Math.sqrt(st.max) : 0;
  const sc = settings.dataScale;
  for (const it of data.industries) {
    if (!freightVisible(it)) continue;
    if (is3DActive() && isOccluded(it.x, it.y)) continue;
    const [sx, sy] = screenPos(vp, it.x, it.y);
    if (sx < -40 || sy < -40 || sx > vp.w + 40 || sy > vp.h + 40) continue;
    const v = industryOutput(it);
    const r = (v == null ? 4 : 4 + Math.sqrt(v) * k) * sc;   // no report → base radius
    const on = !!it.producing;
    g.beginPath();
    g.arc(sx, sy, r, 0, Math.PI * 2);
    g.fillStyle = on ? "rgba(31,186,214,.34)" : "rgba(196,168,110,.26)";
    g.fill();
    g.lineWidth = 1.2;
    g.strokeStyle = on ? "rgba(31,186,214,.95)" : "rgba(196,168,110,.85)";
    g.stroke();
  }
}
function drawPassengerLayer(g, vp) {
  const st = passengerStats();
  if (!st.n) return;
  const k = 26 / Math.sqrt(st.max || 1);
  const sc = settings.dataScale;
  g.fillStyle = "rgba(31,186,214,.42)";
  g.strokeStyle = "rgba(31,186,214,.9)";
  g.lineWidth = 1.2;
  for (const t of data.towns) {
    const p = townPopulation(t);
    if (p == null) continue;                       // a town without a reported population is skipped
    if (is3DActive() && isOccluded(t.x, t.y)) continue;
    const [sx, sy] = screenPos(vp, t.x, t.y);
    if (sx < -60 || sy < -60 || sx > vp.w + 60 || sy > vp.h + 60) continue;
    g.beginPath();
    g.arc(sx, sy, clamp(4, Math.sqrt(p) * k, 36) * sc, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
}
function drawDataLayers(g, vp) {
  const k = settings.dataLayer;
  g.save();
  g.lineCap = "round"; g.lineJoin = "round";
  g.globalAlpha = settings.overlayOpacity * settings.dataOpacity;
  if (k === "flows") drawFlowLayer(g, vp, false);
  else if (k === "freight") drawFreightLayer(g, vp);
  else if (k === "passengers") drawPassengerLayer(g, vp);
  else if (k === "chains") { drawFreightLayer(g, vp); drawFlowLayer(g, vp, true); }
  g.globalAlpha = settings.overlayOpacity;
  g.restore();
}

/* ---- sidebar note: what the preset shows, or what the export lacks ---- */
/* Cargo flows are capped by the export (README): say how many of the total are
   shown, whether the cap bit, and which snapshot year it is. */
function flowCompletenessText() {
  const e = data && data.econ;
  if (!e) return "";
  const total = e.flowsTotal != null ? e.flowsTotal : e.flows.length;
  const parts = [`showing ${fmt(e.flows.length)} of ${fmt(total)} flows`];
  if (e.flowCap != null) parts.push(`capped at ${fmt(e.flowCap)}`);
  if (e.year != null) parts.push(`year ${fmt(e.year)}`);
  return parts.join(" · ");
}
function dataLayerHintText() {
  const k = settings.dataLayer;
  if (!data) return "Pick an overlay — it draws on top of the map from the export's cargo, line and population data.";
  if (k === "none") return "Pick an overlay — it draws on top of the map from the export's cargo, line and population data.";
  if (k === "flows" || k === "chains") {
    if (!data.econ || !data.econ.flows || !data.econ.flows.length) return "No cargo flow data in this export.";
    const c = flowCompletenessText();
    return (k === "chains"
      ? "Supply chains — industry to industry links, with the freight markers underneath."
      : "Cargo flows — one link per cargo movement, width = volume.") + (c ? " " + c + "." : "");
  }
  if (k === "freight") {
    if (!freightStats().n) return "No production data in this export.";
    return "Freight volume — circle per industry, radius = items produced per year.";
  }
  if (k === "passengers") {
    if (!passengerStats().n) return "No population data in this export.";
    return "Passengers — circle per town, radius = population.";
  }
  const vis = visibleLines();
  if (k === "load") {
    if (!vis.some(l => metricValue(l, "load") != null)) return "No capacity load data in this export.";
    return "Line load — blue under 40%, grey 40–85%, amber over 85%.";
  }
  if (k === "linecargo") {
    if (!vis.some(l => metricValue(l, "transported") != null)) return "No transported-goods data in this export.";
    return "Cargo by line — width = items carried last year, colour = the dominant cargo.";
  }
  return "";
}
/* the note has no id: it is found from the section it lives in */
function dataLayerHintEl() {
  const first = $$("[data-dlayer]")[0];
  const sec = first && first.closest ? first.closest(".sec") : null;
  return sec ? sec.querySelector(".hint-txt") : null;
}
function updateDataLayerHint() {
  const el = dataLayerHintEl();
  if (el) el.textContent = dataLayerHintText();
}

/* ---- legend pieces ---- */
function topCargoes(rows, n) {
  const agg = new Map();
  for (const r of rows) {
    const id = r.f.cargoTypeId;
    let e = agg.get(id);
    if (!e) { e = { id, name: r.f.cargoName, vol: 0 }; agg.set(id, e); }
    e.vol += r.f.volume || 0;
    if (!e.name && r.f.cargoName) e.name = r.f.cargoName;
  }
  return [...agg.values()].sort((a, b) => b.vol - a.vol).slice(0, n);
}
function flowLegendGradient(rows) {
  if (!rows || !rows.length) return "";
  const cols = topCargoes(rows, 5).map(c => cargoColor(c.id));
  return cols.length ? "linear-gradient(90deg," + cols.join(",") + ")" : "";
}
function sizeLegendRows(values, radiusOf) {
  const uniq = [...new Set(values)];
  return uniq.map(v =>
    `<div class="lg"><span class="dot" style="width:${radiusOf(v)}px;height:${radiusOf(v)}px;border-radius:50%;background:rgba(31,186,214,.5)"></span><span>${fmt(v)}</span></div>`).join("");
}
function dataLayerLegendHtml() {
  const k = settings.dataLayer;
  const head = `<h4 style="margin-top:8px">Data layers</h4>`
    + `<div class="lg"><b style="color:var(--text)">${esc(dataLayerTitle())}</b>`
    + `<span style="margin-left:auto">${esc(dataLayerLabel())}</span></div>`;
  if (k === "flows" || k === "chains") {
    const rows = flowRows(k === "chains");
    if (!rows) return head + `<div class="lg">No cargo flow data in this export.</div>`;
    if (!rows.length) return head + `<div class="lg">No resolvable flows in this export.</div>`;
    const grad = flowLegendGradient(rows);
    const shown = `<div class="bar" style="height:9px;border-radius:3px${grad ? ";background:" + grad : ""}"></div>`
      + `<div class="scale"><span>thin</span><span>${esc(dataLayerLabel())}</span><span>thick</span></div>`;
    const dots = topCargoes(rows, 3).map(c =>
      `<div class="lg"><span class="dot" style="background:${cargoColor(c.id)}"></span>${esc(cargoLabel(c.name, c.id))}<span style="margin-left:auto">${fmt(c.vol)}</span></div>`).join("");
    const total = data.econ.flows.length;
    const note = k === "chains"
      ? `<div class="lg" style="font-size:11px">${fmt(rows.length)} of ${fmt(total)} flows shown (industry to industry)</div>`
      : (rows.length < total
        ? `<div class="lg" style="font-size:11px">${fmt(total - rows.length)} flow${total - rows.length === 1 ? "" : "s"} skipped (unknown endpoint)</div>` : "");
    const complete = flowCompletenessText();
    return head + shown + dots + note + (complete ? `<div class="lg" style="font-size:11px" title="The export caps the flow table; compare shown with the total to see if it was truncated.">${esc(complete)}</div>` : "");
  }
  if (k === "freight") {
    const st = freightStats();
    if (!st.n) return head + `<div class="lg">No production data in this export.</div>`;
    const rows = sizeLegendRows([st.min, Math.round((st.min + st.max) / 2), st.max],
      v => Math.max(6, Math.round(5 + 11 * Math.sqrt(v / st.max))));
    return head + rows + `<div class="lg" style="font-size:11px">radius: items / year${st.n < data.industries.length ? ` · ${st.n} with output data` : ""}</div>`;
  }
  if (k === "passengers") {
    const st = passengerStats();
    if (!st.n) return head + `<div class="lg">No population data in this export.</div>`;
    const rows = sizeLegendRows([st.min, Math.round((st.min + st.max) / 2), st.max],
      v => Math.max(6, Math.round(5 + 11 * Math.sqrt(v / st.max))));
    return head + rows + `<div class="lg" style="font-size:11px">radius: population${st.n < data.towns.length ? ` · ${st.n} of ${data.towns.length} towns` : ""}</div>`;
  }
  if (k === "load") {
    const vis = visibleLines();
    const noData = vis.filter(l => metricValue(l, "load") == null).length;
    const bar = `<div class="bar" title="blue = under 40%, grey = 40–85%, amber = over 85%" style="background:linear-gradient(90deg,${LOAD_RAMP.low} 0%,${LOAD_RAMP.low} 24%,${LOAD_RAMP.ok} 32%,${LOAD_RAMP.ok} 66%,${LOAD_RAMP.high} 74%,${LOAD_RAMP.high})"></div>`
      + `<div class="scale"><span>&lt;40%</span><span>40–85%</span><span>&gt;85%</span></div>`;
    const note = noData
      ? `<div class="lg" style="font-size:11px">${noData} line${noData === 1 ? "" : "s"} without load data</div>` : "";
    return head + bar + note;
  }
  if (k === "linecargo") {
    const vis = visibleLines();
    if (!vis.length) return head + `<div class="lg">No lines shown.</div>`;
    const agg = new Map();
    let noData = 0;
    for (const l of vis) {
      if (metricValue(l, "transported") == null) noData++;
      const c = dominantCargo(l);
      if (!c) continue;
      const id = c.cargoTypeId;
      let e = agg.get(id);
      if (!e) { e = { id, name: c.name, n: 0 }; agg.set(id, e); }
      e.n++;
    }
    const top = [...agg.values()].sort((a, b) => b.n - a.n).slice(0, 4);
    if (!top.length && !noData) return head + `<div class="lg">No cargo data in this export.</div>`;
    const dots = top.map(c =>
      `<div class="lg"><span class="dot" style="background:${cargoColor(c.id)}"></span>${esc(cargoLabel(c.name, c.id))}<span style="margin-left:auto">${c.n}</span></div>`).join("");
    const note = noData
      ? `<div class="lg" style="font-size:11px">${noData} line${noData === 1 ? "" : "s"} without transported data</div>` : "";
    return head + dots + note;
  }
  return head;
}

/* ---------------- filters ---------------- */
function visibleTemplates() {
  const offCat = settings.roadCatsOff, off = settings.roadOff;
  return data.templates
    .filter(t => !offCat.includes(t.cat) && !off.includes(t.tpl))
    .map(t => t.tpl);
}
function visibleRoads() {
  const set = new Set(visibleTemplates());
  return data.roads.filter(r => set.has(r.tpl));
}

