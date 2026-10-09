/* ============================================================
   Transport lines — data model, filtering, panel, rendering
   ============================================================ */
const LINE_PALETTE = ["#4d8dff", "#34d17f", "#ff9d5c", "#c17bff", "#ffd44d", "#ff6b8b",
  "#5ce1e6", "#8ff06a", "#ff8bf0", "#7fa8ff", "#ffb347", "#6ad6a5"];
let lineQuery = "";           // lowercase text filter, not persisted
let lineHoverId = null;       // table row hovered (preview highlight on the map)

/* Lua tables arrive either as arrays or as `[n] = value` objects — normalise both. */
function luaArray(v) {
  if (!v || typeof v !== "object") return [];
  if (Array.isArray(v)) return v;
  const keys = Object.keys(v).filter(k => /^[0-9]+$/.test(k)).map(Number).sort((a, b) => a - b);
  return keys.map(k => v[k]);
}
function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
/* A field the export does not carry stays null (shown as “—”); it is never
   replaced by a zero, because zero would claim the game reported no value. */
function prepList(v, mapFn) { return (v === null || v === undefined) ? null : luaArray(v).map(mapFn).filter(Boolean); }

function prepareLines(rawLines) {
  const out = [];
  luaArray(rawLines).forEach((l, i) => {
    if (!l || typeof l !== "object") return;
    let color = null;
    if (Array.isArray(l.color) && l.color.length >= 3) {
      const c = [numOrNull(l.color[0]), numOrNull(l.color[1]), numOrNull(l.color[2])];
      if (!c.includes(null)) color = c;
    }
    const stops = prepList(l.stops, s => {
      if (!s || typeof s !== "object") return null;
      return {
        index: numOrNull(s.index),
        name: (typeof s.name === "string" && s.name) ? s.name : null,
        terminal: numOrNull(s.terminal),
        x: numOrNull(s.x), y: numOrNull(s.y),
        stationEntity: numOrNull(s.stationEntity),
      };
    });
    const rec = {
      id: numOrNull(l.id) !== null ? numOrNull(l.id) : i + 1,
      name: (typeof l.name === "string" && l.name) ? l.name : null,
      color,
      modes: prepList(l.modes, m => String(m)),
      stops,
      capacity: prepList(l.capacity, c => {
        if (!c || typeof c !== "object") return null;
        return {
          cargoTypeId: numOrNull(c.cargoTypeId),
          name: (typeof c.name === "string" && c.name) ? c.name : null,
          used: numOrNull(c.used), capacity: numOrNull(c.capacity),
        };
      }),
      issues: prepList(l.issues, x => {
        if (!x || typeof x !== "object") return null;
        return {
          type: (typeof x.type === "string" && x.type) ? x.type : null,
          stopIndex: numOrNull(x.stopIndex),
          cargoTypeId: numOrNull(x.cargoTypeId),
          cargoName: (typeof x.cargoName === "string" && x.cargoName) ? x.cargoName : null,
        };
      }),
      throughput: numOrNull(l.throughput),
      maxFrequency: numOrNull(l.maxFrequency),
      finance: null,
    };
    if (l.finance && typeof l.finance === "object") {
      const f = {};
      for (const k of ["balanceLastYear", "balanceFromTime", "balanceToTime", "year", "itemsTransportedLastYear"]) {
        const n = numOrNull(l.finance[k]);
        if (n !== null) f[k] = n;
      }
      rec.finance = Object.keys(f).length ? f : null;
    }
    rec.label = rec.name || "#" + rec.id;
    const stopPts = (stops || []).filter(s => s.x !== null && s.y !== null).map(s => [s.x, s.y]);
    /* The driven route arrives in the same coordinate space as the stop
       coordinates (both are projected by the world transform at draw time),
       so when it carries at least two valid points it replaces the straight
       stop-to-stop build. The game stores waypoints only where a line was
       routed manually; auto-routed lines store none and the export resolves
       them through the pathfinder into computedPath — same coordinates,
       same shape. Order: stored path > pathfinder computedPath > stops. */
    const readPts = src => {
      if (!src || typeof src !== "object") return null;
      const rp = [];
      for (const p of luaArray(src)) {
        if (!p || typeof p !== "object") continue;
        const px = numOrNull(p.x), py = numOrNull(p.y);
        if (px !== null && py !== null) rp.push([px, py]);
      }
      return rp.length >= 2 ? rp : null;
    };
    const stored = readPts(l.path);
    const comp = stored ? null : readPts(l.computedPath);
    const routePts = stored || comp;
    if (comp) {
      rec.computedPath = comp;
      if (typeof l.computedPathSource === "string" && l.computedPathSource) rec.computedPathSource = l.computedPathSource;
    }
    const pts = routePts || stopPts;
    rec.routeSource = stored ? "path" : comp ? "computedPath" : (stopPts.length >= 2 ? "stops" : null);
    rec.pts = pts;
    rec.mid = pts.length
      ? [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
      : null;
    const path = new Path2D();
    if (pts.length > 1) {
      path.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < pts.length; k++) path.lineTo(pts[k][0], pts[k][1]);
    }
    rec.path = pts.length > 1 ? path : null;
    rec.search = [
      rec.label, String(rec.id), (rec.modes || []).join(" "),
      (rec.capacity || []).map(c => c.name || "#" + c.cargoTypeId).join(" "),
      (stops || []).map(s => s.name || "").join(" "),
      (rec.issues || []).map(x => x.type || "").join(" "),
      rec.finance ? "balance transported" : "",
    ].join(" ").toLowerCase();
    out.push(rec);
  });
  out.sort((a, b) => a.id - b.id);
  out.forEach((l, i) => { l.index = i; });
  return out;
}
function resetLineState() {
  lineQuery = ""; lineHoverId = null;
  const el = $("#lineFilter");
  if (el && el.value) el.value = "";
}

/* --- accessors: a missing export field is null, a present one is an array --- */
const stopsOf = l => l.stops || [];
const capOf = l => l.capacity || [];
const issuesOf = l => l.issues || [];
const modesOf = l => l.modes || [];
function modesDisplay(l) { return modesOf(l).length ? modesOf(l).join(", ") : "—"; }
function lineColorCss(l) {
  if (l.color) {
    const [r, g, b] = l.color;
    const k = Math.max(r, g, b) > 1.0001 ? 1 : 255;
    const ch = v => Math.round(clamp(v * k, 0, 255));
    return `rgb(${ch(r)},${ch(g)},${ch(b)})`;
  }
  return LINE_PALETTE[(l.index || 0) % LINE_PALETTE.length];
}
/* Route provenance: drawn shapes come from three sources, and a user needs to
   know which one a line carries (the save's own waypoints are the only "real"
   route — see the README's Computed routes section). */
function routeProvenance(l) {
  switch (l.routeSource) {
    case "path":
      return { label: "stored route", title: "The save stores waypoints for this line; the drawn route is exactly what the game saved." };
    case "computedPath":
      return { label: "computed (pathfinder)", dashed: true, title: "The save stores no waypoints for this line; the route was computed by the game's pathfinder at export time." };
    case "stops":
      return { label: "stop-to-stop estimate", dashed: true, title: "No stored or computed route exists; the line is drawn straight between its stops as an estimate." };
    default:
      return { label: "—", title: "This line has no route to draw." };
  }
}
function capSummary(l) {
  const list = capOf(l);
  const detail = list.length
    ? list.map(c => `${c.name || "#" + c.cargoTypeId}: ${c.used == null ? "—" : fmt(c.used)} / ${c.capacity == null ? "—" : fmt(c.capacity)}`).join("\n")
    : "No capacity data in this export";
  const known = list.filter(c => c.used != null && c.capacity != null);
  if (!known.length) return { text: "—", title: detail };
  const u = known.reduce((s, c) => s + c.used, 0), c2 = known.reduce((s, c) => s + c.capacity, 0);
  return { text: `${fmt(u)}/${fmt(c2)}${known.length > 1 ? " +" + (known.length - 1) : ""}`, title: detail };
}
function issueCargoText(x) {
  if (x.cargoName) return esc(x.cargoName);
  if (x.cargoTypeId != null) return "#" + x.cargoTypeId;
  return null;
}

/* --- filtering --- */
function lineById(id) { return data && data.lines ? (data.lines.find(l => l.id === id) || null) : null; }
function lineIsOn(l) { return !settings.lineOff.includes(l.id); }
function lineHasModeOn(l) {
  const ms = modesOf(l);
  if (!ms.length) return true;                       // no mode reported → mode filter does not apply
  return ms.some(m => !settings.lineModeOff.includes(m));
}
function linePassesQuery(l) { return !lineQuery || l.search.includes(lineQuery); }
/* table rows: text + mode filter (visibility checkboxes are shown as rows) */
function filteredLines() { return data ? data.lines.filter(l => linePassesQuery(l) && lineHasModeOn(l)) : []; }
/* drawn on the map: table rows minus the individually hidden lines */
function visibleLines() { return filteredLines().filter(lineIsOn); }
function lineModeCounts() {
  const counts = new Map();
  for (const l of (data ? data.lines : [])) for (const m of modesOf(l)) counts.set(m, (counts.get(m) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}
function selectedLine() { return selected && selected.kind === "line" ? selected.item : null; }
function hoveredLine() {
  if (hovered && hovered.kind === "line") return hovered.item;
  return lineHoverId !== null ? lineById(lineHoverId) : null;
}

/* --- sidebar panel --- */
function renderLineCount() {
  const el = $("#lineCount");
  if (!el) return;
  el.textContent = data ? `${visibleLines().length} / ${data.lines.length} shown` : "";
}
function renderLineModeChips() {
  const host = $("#lineModeChips");
  if (!host) return;
  const modes = lineModeCounts();
  host.innerHTML = modes.length
    ? modes.map(([m, n]) => {
      const on = !settings.lineModeOff.includes(m);
      return `<label class="chip ${on ? "on" : ""}"><input type="checkbox" data-linemode="${esc(m)}" ${on ? "checked" : ""}><span>${esc(m)}</span><span class="count">${n}</span></label>`;
    }).join("")
    : `<span class="hint-txt" style="margin:0">No mode information in this export</span>`;
}
function lineRowHtml(l, selId) {
  const on = lineIsOn(l);
  return `<tr class="lrow${selId === l.id ? " sel" : ""}${on ? "" : " off"}" data-line="${l.id}">
    <td><span class="lname"><input type="checkbox" data-lineon="${l.id}" ${on ? "checked" : ""} title="Show this line on the map"><span class="ldot" style="background:${lineColorCss(l)}"></span><span class="t" title="${esc(l.label)}">${esc(l.label)}</span></span></td>
    <td class="m" title="${esc(modesOf(l).join(", "))}">${modesDisplay(l)}</td>
  </tr>`;
}
function lineTableData() { return filteredLines().map(l => ({ id: l.id, label: l.label, html: lineRowHtml(l, selectedLine() ? selectedLine().id : null) })); }
function renderLineTable() {
  const body = $("#lineTableBody"), empty = $("#lineEmpty"), wrap = $("#lineTableWrap");
  if (!body || !data) return;
  const rows = filteredLines();
  const sel = selectedLine();
  body.innerHTML = rows.map(l => lineRowHtml(l, sel ? sel.id : null)).join("");
  if (empty) {
    if (!data.lines.length) {
      empty.textContent = "No lines in this export — re-export with a newer version of the mod to include them.";
      empty.classList.remove("hidden");
    } else if (!rows.length) {
      empty.textContent = "No line matches the filter";
      empty.classList.remove("hidden");
    } else empty.classList.add("hidden");
  }
  if (wrap) wrap.classList.toggle("hidden", !data.lines.length);
}
/* The sidebar list only carries identity: name, colour, mode.
   All statistics live in the Economy panel (top bar). */
function renderLineDetail() {
  const host = $("#lineDetail");
  if (!host || !data) return;
  const l = selectedLine();
  if (!l) {
    host.innerHTML = `<div class="hint-txt" style="margin:8px 0 0">Select a line in the table — or click a route / stop on the map. Statistics, graphs and cargo data are in the <b>Analytics</b> panel (top bar).</div>`;
    return;
  }
  const prov = routeProvenance(l);
  host.innerHTML = `<div class="ldet">
    <div class="hd"><span class="ldot" style="background:${lineColorCss(l)}"></span><b title="${esc(l.label)}">${esc(l.label)}</b><span class="m">${modesDisplay(l)}</span><button class="btn small" data-icon="x" id="lineClear">Clear</button></div>
    <div class="hint-txt" style="margin:4px 0 0" title="${esc(prov.title)}">Route: <b style="color:var(--text)">${esc(prov.label)}</b></div>
    <div class="btnrow" style="margin-top:6px"><button class="btn small" data-icon="chart" data-econopen="line">Open Analytics panel</button></div>
  </div>`;
  hydrateIcons(host);
}
function renderLinesPanel() {
  if (!data) return;
  renderLineModeChips();
  renderLineTable();
  renderLineDetail();
  renderLineCount();
  renderLineRule();
}
/* the rule block in the Lines sidebar: metric list + match counter */
let ruleMetricSig = "";
function renderLineRule() {
  const sel = $("#lineRuleMetric"), out = $("#lineRuleCount");
  if (sel) {
    const keys = Object.keys(ECON_METRICS);
    if (!keys.includes(settings.lineRule.metric)) keys.push(settings.lineRule.metric);
    const sig = keys.join(",");
    if (sig !== ruleMetricSig) {                  // rebuild only when the metric list changes
      sel.innerHTML = keys.map(k => {
        const m = ECON_METRICS[k] || { label: k };
        return `<option value="${k}">${esc(m.label)}${k === "headway" ? " (min)" : ""}</option>`;
      }).join("");
      ruleMetricSig = sig;
    }
    sel.value = settings.lineRule.metric;
  }
  if (!out) return;
  const r = settings.lineRule;
  if (!data || !r) { out.textContent = ""; return; }
  if (!r.on) { out.textContent = "Highlight is off — switch it on to colour matching routes."; return; }
  const vis = visibleLines();
  const routes = vis.filter(l => l.path);
  const hit = routes.filter(lineRuleMatch);
  const noData = routes.filter(l => !lineRuleMatch(l) && metricValue(l, r.metric) == null).length;
  if (!routes.length) { out.textContent = "No routes to highlight."; return; }
  let msg = `${hit.length} of ${routes.length} routes match ${ruleText(r)}`;
  if (noData) msg += ` · ${noData} without data for this metric`;
  if (!settings.layers.lines) msg += " · lines layer is off";
  else if (!settings.lineRoutes) msg += " · routes are hidden (Draw routes off)";
  out.textContent = msg;
}

/* --- selection --- */
function selectLine(id, opts) {
  const l = lineById(id);
  if (!l) return;
  opts = opts || {};
  const already = selected && selected.kind === "line" && selected.item.id === id;
  if (already && opts.toggle) { closeInfo(); return; }
  showInfo({ kind: "line", item: l });
  if (opts.fly) focusLine(l);
}
function lineBox(l) {
  if (!l.pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of l.pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}
function focusLine(l) {
  if (!data || !l) return;
  const b = lineBox(l);
  if (!b) return;
  /* the box as it looks on screen right now (rotated + tilted corners) */
  const cs = [project(b.x0, b.y0), project(b.x1, b.y0), project(b.x0, b.y1), project(b.x1, b.y1)];
  let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
  for (const p of cs) {
    if (p[0] < sx0) sx0 = p[0];
    if (p[0] > sx1) sx1 = p[0];
    if (p[1] < sy0) sy0 = p[1];
    if (p[1] > sy1) sy1 = p[1];
  }
  const m = 40;
  if (sx0 >= m && sy0 >= m && sx1 <= stageW - m && sy1 <= stageH - m) { requestRender(); return; }   // already visible
  const w = Math.max(b.x1 - b.x0, 1), h = Math.max(b.y1 - b.y0, 1);
  const s = clamp(Math.min((stageW - 140) / w, (stageH - 140) / h), limits().min, limits().max);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  animateView({ scale: s, x: stageW / 2 - (cx - data.world.minX) * s, y: stageH / 2 - (data.world.maxY - cy) * s }, 420);
}
function setLineFilter(q) {
  lineQuery = String(q || "").trim().toLowerCase();
  renderLineTable();
  renderLineCount();
  requestRender();
}
/* make sure the selected line actually has a visible row to scroll to */
function revealSelectedLine() {
  const l = selectedLine();
  if (!l || !data) return;
  let changed = false;
  if (lineQuery) { lineQuery = ""; const box = $("#lineFilter"); if (box) box.value = ""; changed = true; }
  if (settings.lineModeOff.length) { settings.lineModeOff = []; changed = true; }
  if (!lineIsOn(l)) { toggleIn(settings.lineOff, l.id, false); changed = true; }
  if (changed) { syncControls(); persist(); renderLinesPanel(); }
  renderLineTable();
  const tr = document.querySelector(`tr[data-line="${l.id}"]`);
  if (tr && tr.scrollIntoView) tr.scrollIntoView({ block: "nearest" });
  requestRender();
}

