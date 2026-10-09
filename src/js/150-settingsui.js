/* ============================================================
   Settings UI wiring
   ============================================================ */
const REBUILD_OF = {
  style: "terrain", detail: "terrain", seaLevel: "terrain", seaAuto: "terrain",
  hillshadeStrength: "terrain", sunAzimuth: "terrain", sunElevation: "terrain",
  exaggeration: "terrain", elevAuto: "terrain", elevMin: "terrain", elevMax: "terrain",
  "layers.terrain": "none", "layers.hillshade": "terrain",
  "layers.contours": "contours", "layers.grid": "none",
  "layers.roads": "none", "layers.towns": "none", "layers.industries": "none",
  "layers.lines": "none", "layers.data": "none", "layers.minimap": "none",
  lineView: "none", lineWidth: "none", lineStops: "none", lineLabels: "none",
  lineOff: "none", lineModeOff: "none",
  contourInterval: "contours", contourIndex: "contours", contourColor: "contours", contourWidth: "contours",
  roadCatsOff: "none", roadOff: "none", roadColorMode: "none", roadColor: "none", roadWidth: "none", roadCasing: "none",
  townMetric: "none", townMin: "none", indOff: "none",
  dataLayer: "none", dataOpacity: "none", dataScale: "none",
  /* 3D view: redraw only, the camera matrix is recomputed per draw */
  pitch: "none", bearing: "none",
};
function setSetting(path, value) {
  const parts = path.split(".");
  let o = settings;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  const last = parts[parts.length - 1];
  if (o[last] === value) return;
  o[last] = value;
  onSettingsChanged(path);
}
function onSettingsChanged(path) {
  if (path === "style") {
    applyStylePreset(settings.style);            // palette + the preset's controls
    syncControls();
    if (data) scheduleRebuild("contours", 60);   // preset may switch contours on/off
  } else if (STYLE_CONTROLS.has(path) && !applyingPreset && settings.style !== "custom") {
    markCustom();                                // hand-tweaked → CUSTOM keeps the palette
  }
  if (path === "townMetric" && data) updateTownScale();
  if (path === "dataLayer") updateDataLayerHint();
  if (path === "lineView" && settings.lineView === "lines") {
    if (!settings.layers.lines) { settings.layers.lines = true; syncControls(); }   // "Lines only" makes no sense without lines
    if (MAP_DATA_LAYERS.indexOf(settings.dataLayer) >= 0) { settings.dataLayer = "none"; updateDataLayerHint(); }   // map-only presets cannot draw here
  }
  const kind = REBUILD_OF[path] || "none";
  if (kind !== "none" && data) scheduleRebuild(kind, path.startsWith("layers.") ? 30 : 140);
  if (gl3d && (path === "detail" || path === "exaggeration" || path === "seaAuto" || path === "seaLevel")) gl3d.mesh = null;
  syncOutputs(); persist();
  if (FILTER_PATHS.has(path)) refreshGenerated(); else refreshLive();
  if (String(path).indexOf("lineRule") === 0) renderLineRule();
  requestRender();
}
const FILTER_PATHS = new Set(["roadCatsOff", "roadOff", "indOff", "townMin", "townMetric", "layers.roads", "layers.towns", "layers.industries",
  "lineOff", "lineModeOff", "layers.lines", "lineView"]);
document.addEventListener("input", e => {
  const el = e.target;
  if (!el || !el.dataset) return;
  if (el.dataset.econ !== undefined) { setEcon(el.dataset.econ, el); return; }
  if (el.dataset.set !== undefined) {
    const v = el.type === "checkbox" ? el.checked
      : (el.type === "range" || el.type === "number") ? Number(el.value)
        : el.value;
    setSetting(el.dataset.set, v);
    return;
  }
  /* the checkbox means "visible", while ...Off holds the *hidden* ids,
     so checked must REMOVE the id from that list (they used to add it: inverted) */
  if (el.dataset.roadcat !== undefined) { toggleIn(settings.roadCatsOff, el.dataset.roadcat, !el.checked); onSettingsChanged("roadCatsOff"); return; }
  if (el.dataset.road !== undefined) { toggleIn(settings.roadOff, el.dataset.road, !el.checked); onSettingsChanged("roadOff"); return; }
  if (el.dataset.ind !== undefined) { toggleIn(settings.indOff, el.dataset.ind, !el.checked); onSettingsChanged("indOff"); return; }
  if (el.dataset.lineon !== undefined) { toggleIn(settings.lineOff, Number(el.dataset.lineon), !el.checked); onSettingsChanged("lineOff"); return; }
  if (el.dataset.linemode !== undefined) { toggleIn(settings.lineModeOff, el.dataset.linemode, !el.checked); onSettingsChanged("lineModeOff"); return; }
});
function toggleIn(arr, v, want) {
  const i = arr.indexOf(v);
  if (want && i < 0) arr.push(v);
  if (!want && i >= 0) arr.splice(i, 1);
}
document.addEventListener("click", e => {
  const t = e.target;
  if (!t || !t.closest) return;
  const sr = t.closest(".secReset");
  if (sr) { resetSection(sr.dataset.reset); return; }
  /* map camera buttons (#zoomctl, no ids): 3D/2D toggle + compass reset */
  const act = t.closest("[data-act]");
  if (act) {
    const a = act.dataset && act.dataset.act;
    if (a === "tilt") setSetting("pitch", (settings.pitch || 0) > 1 ? 0 : 45);
    else if (a === "compass") setSetting("bearing", 0);
    return;
  }
  if (t.closest("#econClose")) { closeEcon(); return; }
  const eo = t.closest("[data-econopen]");
  if (eo) {
    if (eo.dataset.econopen === "map") { const l = selectedLine(); closeEcon(); if (l) selectLine(l.id, { fly: true }); }
    else openEcon();
    return;
  }
  const es = t.closest("[data-econsort]");
  if (es) { econSortBy(es.dataset.econsort); return; }
  const er = t.closest("tr[data-econline]");
  if (er) { selectLine(Number(er.dataset.econline)); renderEcon(); return; }
  if (t.id === "econ") { closeEcon(); return; }        // clicked the backdrop
  if (t.closest("#lineClear")) { closeInfo(); return; }
  if (t.closest("#lineShowInList")) { revealSelectedLine(); return; }
  const tr = t.closest("tr[data-line]");
  if (tr) {
    if (t.closest("input")) return;      // the checkbox only toggles visibility
    selectLine(Number(tr.dataset.line), { fly: true, toggle: true });
    return;
  }
  const sw = t.closest("[data-style]");
  if (sw) { setSetting("style", sw.dataset.style); syncControls(); return; }
  const dl = t.closest("[data-dlayer]");
  if (dl) { setSetting("dataLayer", dl.dataset.dlayer); syncControls(); return; }
  const cp = t.closest("[data-cam]");
  if (cp) {
    const c = cp.dataset.cam;
    if (c === "iso") { setSetting("pitch", 35.264); setSetting("bearing", 45); }
    else if (c === "p15") { setSetting("pitch", 15); setSetting("bearing", 45); }
    else if (c === "p45") { setSetting("pitch", 45); setSetting("bearing", 45); }
    else if (c === "p60") { setSetting("pitch", 60); setSetting("bearing", 45); }
    else if (c === "flat") { setSetting("pitch", 0); setSetting("bearing", 0); }
    syncControls();
    return;
  }
  const q = t.closest("[data-quick]");
  if (q) { doQuick(q.dataset.quick); return; }
});
/* hovering a row previews that line on the map (route + stop labels) */
document.addEventListener("mouseover", e => {
  const t = e.target;
  const tr = t && t.closest ? t.closest("tr[data-line]") : null;
  const id = tr ? Number(tr.dataset.line) : null;
  if (id !== lineHoverId) { lineHoverId = id; requestRender(); }
});
$("#lineFilter").addEventListener("input", e => setLineFilter(e.target.value));
$("#lineFilter").addEventListener("keydown", e => {
  if (e.key === "Escape") { e.target.value = ""; setLineFilter(""); }
});
function doQuick(cmd) {
  const [what, mode] = cmd.split(":");
  if (what === "roads") {
    if (mode === "all") { settings.roadCatsOff = []; settings.roadOff = []; }
    else { settings.roadCatsOff = Object.keys(ROAD_CATS); }
    onSettingsChanged("roadCatsOff");
  } else if (what === "ind") {
    const tags = [...new Set(data.industries.map(i => i.tag))];
    if (mode === "all") settings.indOff = [];
    else if (mode === "none") settings.indOff = tags;
    else settings.indOff = tags.filter(t => (indGroup(t) === "raw") !== (mode === "raw"));
    settings.layers.industries = mode !== "none";
    onSettingsChanged("indOff");
  } else if (what === "lines") {
    if (!data) return;
    settings.lineOff = mode === "all" ? [] : data.lines.map(l => l.id);
    settings.layers.lines = true;
    onSettingsChanged("lineOff");
  } else if (what === "lineModes") {
    if (!data) return;
    const modes = lineModeCounts().map(([m]) => m);
    settings.lineModeOff = mode === "all" ? [] : modes;
    onSettingsChanged("lineModeOff");
  } else if (what === "rule") {
    const r = settings.lineRule;
    if (mode === "load85") Object.assign(r, { on: true, metric: "load", op: ">", value: 85 });
    else if (mode === "load40") Object.assign(r, { on: true, metric: "load", op: "<", value: 40 });
    else if (mode === "loss") Object.assign(r, { on: true, metric: "balance", op: "<", value: 0 });
    else if (mode === "issues") Object.assign(r, { on: true, metric: "issues", op: ">", value: 0 });
    else if (mode === "off") r.on = false;
    onSettingsChanged("lineRule.on");
  }
  syncControls();
}
const FORMATTERS = {
  pitch: v => Math.round(v) + "°",
  bearing: v => Math.round(v) + "°",
  terrainOpacity: v => Math.round(v * 100) + "%",
  overlayOpacity: v => Math.round(v * 100) + "%",
  dataOpacity: v => Math.round(v * 100) + "%",
  dataScale: v => v.toFixed(2) + "×",
  seaLevel: v => fmt(v) + " m",
  hillshadeStrength: v => Math.round(v * 100) + "%",
  sunAzimuth: v => v + "°",
  sunElevation: v => v + "°",
  exaggeration: v => v.toFixed(1) + "×",
  contourWidth: v => v + " px",
  roadWidth: v => v + " px",
  lineWidth: v => v + " px",
  lineStopSize: v => v + " px",
  townMin: v => fmt(v, 1),
  townSize: v => v.toFixed(1) + "×",
};
function syncOutputs() {
  for (const el of $$("[data-out]")) {
    const key = el.dataset.out;
    const v = settings[key];
    el.textContent = FORMATTERS[key] ? FORMATTERS[key](v) : v;
  }
  syncTiltUI();
}
/* the two camera buttons of #zoomctl: 3D/2D label + the rotating compass */
function syncTiltUI() {
  const t = $('[data-act="tilt"]');
  if (t) t.textContent = (settings.pitch || 0) > 1 ? "2D" : "3D";
  const c = $('[data-act="compass"]');
  if (!c) return;
  const n = c.querySelector(".cneedle");
  if (n) n.style.transform = "rotate(" + (settings.bearing || 0) + "deg)";
  c.classList.toggle("act", !!((settings.pitch || 0) || (settings.bearing || 0)));
}
function syncControls() {
  for (const el of $$("[data-set]")) {
    const key = el.dataset.set;
    const parts = key.split(".");
    let v = settings;
    for (const p of parts) v = v && v[p];
    if (el.type === "checkbox") el.checked = !!v;
    else if (document.activeElement !== el) el.value = v;
  }
  for (const el of $$("[data-dlayer]")) {
    const mapOnly = MAP_DATA_LAYERS.indexOf(el.dataset.dlayer) >= 0;
    const off = settings.lineView === "lines" && mapOnly;
    el.classList.toggle("sel", el.dataset.dlayer === settings.dataLayer);
    el.disabled = off;
    el.title = off ? "Not available in Lines only — switch View to Lines + map"
      : (DATA_LAYER_TITLES[el.dataset.dlayer] || "");
  }
  /* highlight the matching 3D camera preset (tolerates the rounded display) */
  const camP = Math.round(+settings.pitch || 0), camB = Math.round(normBearing(+settings.bearing || 0));
  for (const el of $$("[data-cam]")) {
    const c = el.dataset.cam;
    const on = (c === "iso" && camP === 35 && camB === 45) ||
               (c === "p15" && camP === 15 && camB === 45) ||
               (c === "p45" && camP === 45 && camB === 45) ||
               (c === "p60" && camP === 60 && camB === 45) ||
               (c === "flat" && camP === 0 && camB === 0);
    el.classList.toggle("primary", on);
  }
  for (const el of $$("[data-style]")) {
    el.classList.toggle("sel", el.dataset.style === settings.style);
    const s = STYLES[el.dataset.style];
    const bar = el.querySelector("i");
    /* preview water + background + the terrain ramp, not just the ramp, so
       presets are distinguishable without applying them */
    if (s && bar) bar.style.background = `linear-gradient(135deg,${s.water[1]} 0 12%,${s.water[0]} 12% 22%,${s.bg} 22% 26%,${s.ramp[1]} 26% 48%,${s.ramp[3]} 48% 66%,${s.ramp[5]} 66% 84%,${s.ramp[6]} 84% 100%)`;
    if (s && s.blurb) el.title = s.label + " — " + s.blurb;
  }
  const tmm = $("#townMinMetric");
  if (tmm) tmm.textContent = TOWN_METRIC_LABELS[settings.townMetric] || "size";
  $("#elevMin").disabled = settings.elevAuto;
  $("#elevMax").disabled = settings.elevAuto;
  $('input[data-set="seaLevel"]').disabled = settings.seaAuto;
  if (data) {
    $("#waterLevelTxt").textContent = fmt(data.terrain.waterLevel, 1) + " m";
    $("#elevMin").value = settings.elevAuto ? Math.round(data.terrain.min) : settings.elevMin;
    $("#elevMax").value = settings.elevAuto ? Math.round(data.terrain.max) : settings.elevMax;
  }
  syncOutputs();
}
$("#sidebarToggle").addEventListener("click", () => {
  $("#sidebar").classList.toggle("closed");
  setTimeout(resize, 200);
});
$("#resetSettings").addEventListener("click", () => {
  if (!window.confirm("Reset all settings to their defaults?")) return;
  const secs = settings.sections;                    // keep which sections are open
  settings = structuredClone(DEFAULTS);
  settings.sections = secs;
  try { localStorage.removeItem(STORE_KEY); } catch {}
  syncControls(); refreshGenerated(true);
  if (data) { scheduleRebuild("terrain", 10); scheduleRebuild("contours", 10); }
  requestRender();
  toast("Settings reset", "ok");
});
/* settings a section owns, so each section can be reset on its own (finding 31) */
const SECTION_RESET = {
  mapstyle: ["style", "customFrom", "detail"],
  layers: ["layers", "terrainOpacity", "overlayOpacity"],
  terrain: ["detail", "layers.hillshade", "hillshadeStrength", "sunAzimuth", "sunElevation", "exaggeration", "seaAuto", "seaLevel", "elevAuto", "elevMin", "elevMax"],
  contour: ["layers.contours", "contourInterval", "contourIndex", "contourColor", "contourWidth"],
  roads: ["roadColorMode", "roadColor", "roadWidth", "roadCasing", "roadCatsOff", "roadOff"],
  towns: ["townLabels", "townMetric", "townMin", "townSize"],
  inds: ["indLabels", "indAutoLabels", "indOff"],
  lines: ["lineView", "lineWidth", "lineStops", "lineStopSize", "lineLabels", "lineRoutes", "lineOff", "lineModeOff", "lineRule"],
  datalayers: ["dataLayer", "dataOpacity", "dataScale"],
  camera: ["pitch", "bearing"],
  export: ["exportSize"],
};
function resetSection(sec) {
  const keys = SECTION_RESET[sec];
  if (!keys) return;
  for (const path of keys) {
    const parts = path.split(".");
    const def = parts.reduce((o, k) => (o == null ? undefined : o[k]), DEFAULTS);
    const val = (def && typeof def === "object") ? structuredClone(def) : def;
    let o = settings;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = val;
  }
  if (sec === "mapstyle") applyStylePreset(settings.style);
  syncControls(); refreshGenerated();
  if (data) { scheduleRebuild("terrain", 10); scheduleRebuild("contours", 10); }
  requestRender();
  toast("Section reset", "ok");
}
/* remember which sidebar sections are open/closed (finding 27) */
$("#sidebar").addEventListener("toggle", e => {
  const el = e.target;
  if (!el || !el.matches || !el.matches("details[data-sec]")) return;
  settings.sections[el.dataset.sec] = el.open;
  persist();
}, true);
function applySectionState() {
  const saved = settings.sections || {};
  for (const el of $$("#sidebar details[data-sec]")) {
    if (saved[el.dataset.sec] !== undefined) el.open = !!saved[el.dataset.sec];
  }
}

/* ---------------- generated side panel lists ---------------- */
function refreshGenerated() {
  if (!data) return;
  updateTownScale();
  buildRoadCatList();
  buildTemplateList();
  buildIndChips();
  renderLinesPanel();
  renderEcon();
  refreshLive();
}
function refreshLive() {
  if (!data) return;
  updateDataLayerHint();
  buildStats();
  buildLegend();
  renderLineCount();
}
function updateTownScale() {
  if (!data) return;
  data.townMax = Math.max(1, ...data.towns.map(townValue));
  const inp = $("#townMin");
  inp.max = String(Math.ceil(data.townMax));
  if (settings.townMin > data.townMax) settings.townMin = 0;
  inp.value = String(settings.townMin);
  const lab = $("#townMinMetric");
  if (lab) lab.textContent = TOWN_METRIC_LABELS[settings.townMetric] || "size";
}
function buildRoadCatList() {
  const host = $("#roadCats");
  const groups = {};
  for (const t of data.templates) {
    const g = groups[t.cat] || (groups[t.cat] = { cat: t.cat, count: 0, len: 0 });
    g.count += t.count; g.len += t.len;
  }
  host.innerHTML = Object.values(groups).sort((a, b) => b.count - a.count).map(g => {
    const on = !settings.roadCatsOff.includes(g.cat);
    const meta = ROAD_CATS[g.cat] || ROAD_CATS.other;
    return `<label class="catrow ${on ? "on" : ""}">
      <input type="checkbox" data-roadcat="${g.cat}" ${on ? "checked" : ""}>
      <span class="dot" style="background:${meta.color}"></span>
      <span>${meta.label}</span>
      <span class="meta">${fmt(g.count)} · ${fmt(g.len / 1000, 1)} km</span></label>`;
  }).join("");
}
function buildTemplateList() {
  const host = $("#roadTemplates");
  host.innerHTML = data.templates.map(t => {
    const on = !settings.roadOff.includes(t.tpl);
    return `<label class="chip ${on ? "on" : ""}" title="${esc(t.tpl)}">
      <input type="checkbox" data-road="${esc(t.tpl)}" ${on ? "checked" : ""}>
      <span class="dot" style="background:${(ROAD_CATS[t.cat] || ROAD_CATS.other).color}"></span>
      <span>${esc(t.label)}</span><span class="count">${fmt(t.count)}</span></label>`;
  }).join("");
}
function buildIndChips() {
  const host = $("#indChips");
  const counts = {};
  for (const it of data.industries) counts[it.tag] = (counts[it.tag] || 0) + 1;
  host.innerHTML = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([tag, n]) => {
    const on = !settings.indOff.includes(tag);
    const color = IND_GROUPS[indGroup(tag)];
    return `<label class="chip ${on ? "on" : ""}"><input type="checkbox" data-ind="${esc(tag)}" ${on ? "checked" : ""}>
      <span class="dot" style="background:${color}"></span><span>${esc(prettyIndustry(tag))}</span><span class="count">${n}</span></label>`;
  }).join("");
}
function buildStats() {
  const vis = new Set(visibleTemplates());
  const visRoads = data.roads.filter(r => vis.has(r.tpl));
  const visLen = visRoads.reduce((s, r) => s + r.len, 0);
  const visInd = data.industries.filter(i => !settings.indOff.includes(i.tag)).length;
  const user = [
    ["File", esc(data.name)],
    ["Size", data.bytes ? (data.bytes / 1048576).toFixed(1) + " MB" : "—"],
    ["World", `${fmt(data.world.width)} × ${fmt(data.world.height)} m`],
    ["Tiles", `${data.world.tilesX} × ${data.world.tilesY}`],
    ["Elevation", `${fmt(data.terrain.min, 1)} … ${fmt(data.terrain.max, 1)} m`],
    ["Sea level", fmt(settings.seaAuto ? data.terrain.waterLevel : settings.seaLevel, 1) + " m"],
    ["Road segments shown", `${fmt(visRoads.length)} / ${fmt(data.roads.length)}`],
    ["Road length", `${fmt(visLen / 1000, 1)} / ${fmt(data.stats.roadLen / 1000, 1)} km`],
    ["Towns", `${data.towns.filter(t => townValue(t) >= settings.townMin).length} / ${data.towns.length}`],
    ["Industries", `${visInd} / ${data.industries.length}`],
    ["Lines shown", `${fmt(visibleLines().length)} / ${fmt(data.lines.length)}`],
    ["Line stops", fmt(data.lines.reduce((s, l) => s + stopsOf(l).length, 0))],
  ];
  const diag = [
    ["Format", esc(data.format)],
    ["Height samples", `${fmt(data.terrain.gw)} × ${fmt(data.terrain.gh)}`],
    ["Terrain raster", terrainMeta ? `${terrainMeta.nw}×${terrainMeta.nh} in ${Math.round(terrainMeta.ms)} ms` : "—"],
    ["Contours", contourPaths ? `${contourPaths.interval} m interval · ${contourPaths.levels.length} lines · ${Math.round(contourPaths.ms)} ms` : "off"],
  ];
  $("#stats").innerHTML = user.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  const d = $("#diagStats");
  if (d) d.innerHTML = diag.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
}
function buildLegend() {
  const el = $("#legend");
  if (!data) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  const cs = curStyle();
  /* preset badge: tells you which look is active even with the sidebar closed */
  let html = `<div class="lg" title="${esc(cs.blurb || cs.label)}" style="color:var(--text);font-weight:650;margin-bottom:5px;padding-bottom:5px;border-bottom:1px solid var(--line)">`
    + `<span class="dot" style="width:13px;height:13px;border-radius:50%;background:linear-gradient(135deg,${cs.ramp[1]},${cs.ramp[5]})"></span>${esc(cs.label)}</div>`;
  if (settings.layers.terrain) {
    const eMin = settings.elevAuto ? data.terrain.min : Math.min(settings.elevMin, settings.elevMax);
    const eMax = settings.elevAuto ? data.terrain.max : Math.max(settings.elevMax, eMin + 1);
    const stops = curStyle().ramp.map(c => c).join(",");
    html += `<h4>Elevation</h4><div class="bar" style="background:linear-gradient(90deg,${stops})"></div>
      <div class="scale"><span>${fmt(eMin, 0)} m</span><span>${fmt(eMax, 0)} m</span></div>`;
  }
  if (settings.layers.roads && settings.roadColorMode === "class") {
    const roadPal = paint("roads", null);
    const colorOf = c => (roadPal && roadPal[c]) || (ROAD_CATS[c] || ROAD_CATS.other).color;
    const groups = {};
    for (const t of data.templates) {
      if (settings.roadCatsOff.includes(t.cat) || settings.roadOff.includes(t.tpl)) continue;
      groups[t.cat] = (groups[t.cat] || 0) + t.count;
    }
    const keys = Object.keys(groups);
    if (keys.length) {
      html += `<h4 style="margin-top:8px">Roads</h4>` + keys.map(c =>
        `<div class="lg"><span class="dot" style="background:${colorOf(c)}"></span>${(ROAD_CATS[c] || ROAD_CATS.other).label} <span style="margin-left:auto">${fmt(groups[c])}</span></div>`).join("");
    }
  }
  if (settings.layers.industries) {
    html += `<h4 style="margin-top:8px">Industries</h4>
      <div class="lg"><span class="dot" style="background:${IND_GROUPS.raw}"></span>Raw materials</div>
      <div class="lg"><span class="dot" style="background:${IND_GROUPS.factory}"></span>Factories</div>`;
  }
  if (settings.layers.towns) {
    html += `<h4 style="margin-top:8px">Towns</h4><div class="lg"><span class="dot" style="background:${paint("townNode", "#f6c558")};height:11px;border-radius:50%"></span>Size: ${settings.townMetric}</div>`;
  }
  if (settings.layers.lines && data.lines.length) {
    const modes = lineModeCounts().slice(0, 5).map(([m, n]) => `${m} ${n}`).join(" · ");
    const nComp = data.lines.filter(l => l.routeSource === "computedPath").length;
    html += `<h4 style="margin-top:8px">Transport lines</h4>
      <div class="lg"><span class="dot" style="background:linear-gradient(90deg,${LINE_PALETTE.slice(0, 5).join(",")})"></span>${fmt(visibleLines().length)} / ${fmt(data.lines.length)} shown</div>` +
      (modes ? `<div class="lg" style="font-size:11px">${esc(modes)}</div>` : "") +
      (nComp ? `<div class="lg" style="font-size:11px" title="The game stores route waypoints only for manually routed lines. For these lines the export resolved the actual route through the pathfinder.">${fmt(nComp)} route${nComp === 1 ? "" : "s"} computed by pathfinder</div>` : "");
  }
  if (dataLayerActive()) html += dataLayerLegendHtml();
  el.innerHTML = html;
}

