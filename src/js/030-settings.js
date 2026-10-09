/* ---------------- settings ---------------- */
const DEFAULTS = {
  style: "terrain", customFrom: "terrain", detail: "normal",
  layers: { terrain: true, hillshade: true, contours: false, grid: false, roads: true, towns: true, industries: true, lines: true, data: true, minimap: true },
  terrainOpacity: 1, overlayOpacity: 1,
  /* data layers: economic / logistical overlays (see DATA_LAYER_TITLES) */
  dataLayer: "none", dataOpacity: 0.75, dataScale: 1,
  /* 3D view: orthographic tilt (0..60°) + free compass bearing (deg) */
  pitch: 0, bearing: 0,
  lineView: "linesmap", lineWidth: 2.6, lineStops: true, lineStopSize: 3, lineLabels: true, lineRoutes: true,
  lineOff: [], lineModeOff: [],
  /* Analytics / Explore: one chart slot. The a…/b… prefixes of the earlier
     two-slot layout are migrated in loadSettings(). */
  econ: {
    type: "bar", metric: "throughput", x: "headway", y: "load", size: "transported",
    sort: "throughput", dir: "desc", limit: "25", values: true, onlyData: false,
  },
  /* automated route highlight on the map: metric OP value */
  lineRule: { on: false, metric: "load", op: ">", value: 85 },
  seaAuto: true, seaLevel: 0,
  hillshadeStrength: 0.75, sunAzimuth: 315, sunElevation: 45, exaggeration: 2,
  elevAuto: true, elevMin: 0, elevMax: 300,
  contourInterval: "auto", contourIndex: true, contourColor: "#16242c", contourWidth: 1,
  roadColorMode: "class", roadColor: "#f3ecdd", roadWidth: 2, roadCasing: true,
  roadCatsOff: [], roadOff: [],
  townMetric: "max", townMin: 0, townSize: 1, townLabels: true,
  indLabels: false, indAutoLabels: true, indOff: [],
  exportSize: "2048",
  sections: {},
};
const STORE_KEY = "networkAtlas.settings.v2";
let settings = loadSettings();

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const saved = JSON.parse(raw);
    const s = Object.assign(structuredClone(DEFAULTS), saved);
    s.layers = Object.assign({}, DEFAULTS.layers, saved.layers || {});
    s.sections = Object.assign({}, DEFAULTS.sections, saved.sections || {});
    /* the heatmap became the data-layer presets: drop its settings from older
       saves and fall back when the stored preset is unknown here */
    for (const k of ["heatOpacity", "heatMetric", "heatRadius", "heatIntensity", "heatPalette"]) delete s[k];
    delete s.layers.heatmap;
    if (!DATA_LAYER_TITLES[s.dataLayer]) s.dataLayer = "none";
    /* the 3D view keys are new: an older save simply has none, and anything
       that is not a sane number falls back to the flat north-up default */
    s.pitch = Number.isFinite(+s.pitch) ? clamp(+s.pitch, 0, 60) : 0;
    s.bearing = Number.isFinite(+s.bearing) ? normBearing(+s.bearing) : 0;
    /* one chart slot now: carry the old a… keys over, drop the removed b… ones */
    s.econ = Object.assign({}, DEFAULTS.econ);
    if (saved.econ) {
      const legacy = { aType: "type", aMetric: "metric", aX: "x", aY: "y", aSize: "size" };
      for (const k in legacy) if (saved.econ[k] !== undefined) s.econ[legacy[k]] = saved.econ[k];
      for (const k of Object.keys(saved.econ)) if (k in DEFAULTS.econ) s.econ[k] = saved.econ[k];
    }
    s.lineRule = Object.assign({}, DEFAULTS.lineRule, saved.lineRule || {});
    /* the custom palette lives in STYLES — rebuild it from the preset it came from */
    if (s.style === "custom") STYLES.custom = cloneStyle(STYLES[s.customFrom] || STYLES.terrain);
    else if (!STYLES[s.style]) s.style = "terrain";
    return s;
  } catch { return structuredClone(DEFAULTS); }
}
let persistTimer = 0;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch {}
  }, 350);
}

