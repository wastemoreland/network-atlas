/* ---------------- map style presets ----------------
   Every preset drives three layers of the look:
     bg / ramp / water / contour … the terrain pipeline (unchanged)
     apply … control values copied over when the preset is picked
     paint … draw-time extras: label halo, road casing & palette, route glow,
             town nodes, station rings, marker scale
   Tweaking one of those controls by hand moves the map to CUSTOM, which keeps
   the palette of the preset you came from but stops pushing its values. */
const STYLES = {
  satellite: {
    label: "Satellite", blurb: "Terrain · water · roads · towns · labels",
    bg: "#0b1013",
    ramp: ["#17281c", "#22391f", "#31452a", "#414b31", "#4f4f3c", "#665f52", "#9b948a"],
    water: ["#1d4257", "#09161f"], contour: "#0f1a12",
    paint: { townLabel: "#ffe9c2", halo: "rgba(4,8,11,.85)", casing: "rgba(4,7,10,.8)" },
    apply: { terrainOpacity: 1, roadColorMode: "class", roadWidth: 2, roadCasing: true, townLabels: true, indLabels: false, contourWidth: 1, layers: { contours: false, grid: false } },
  },
  atlas: {
    label: "Atlas", blurb: "Google-style light · muted land · clean labels",
    bg: "#e9e4d5",
    ramp: ["#cbdfae", "#e3e5b6", "#f2e8c9", "#eeddc0", "#e3cdb4", "#d9c3aa", "#ffffff"],
    water: ["#a9cbe6", "#74aad3"], contour: "#6b6248",
    paint: { lineHalo: "rgba(16,21,28,.85)", townLabel: "#3d4856", townFont: "700 13px system-ui", halo: "rgba(252,250,244,.95)", casing: "rgba(96,102,112,.4)" },
    apply: { terrainOpacity: 1, roadColorMode: "class", roadWidth: 1.8, roadCasing: true, townLabels: true, indLabels: false, contourWidth: 1, layers: { contours: false, grid: false } },
  },
  minimal: {
    label: "Minimal", blurb: "Quiet basemap · white roads · clean labels",
    bg: "#eef1f0",
    ramp: ["#dde7da", "#e5ecdf", "#ebeee7", "#f0efe9", "#f3f1ec", "#f6f4f0", "#ffffff"],
    water: ["#a9cbe9", "#7fb0dd"], contour: "#d7dedb",
    paint: { lineHalo: "rgba(16,21,28,.85)", townLabel: "#37414d", townFont: "650 12.5px system-ui", halo: "rgba(255,255,255,.95)", casing: "rgba(74,84,96,.45)" },
    apply: { terrainOpacity: 1, roadColorMode: "single", roadColor: "#ffffff", roadWidth: 1.9, roadCasing: true, townLabels: true, indLabels: false, contourWidth: 1, layers: { contours: false, grid: false } },
  },
  topo: {
    label: "Topo", blurb: "Elevation · contour lines · rivers",
    bg: "#efe7d0",
    ramp: ["#a9cc8b", "#c9dd9d", "#e5e3ad", "#eedba2", "#e6c98b", "#dab779", "#fbf7ee"],
    water: ["#8ec6ea", "#4f94c8"], contour: "#9a6b3f",
    paint: { lineHalo: "rgba(16,21,28,.85)", townLabel: "#4a3b25", townFont: "700 12.5px system-ui", halo: "rgba(250,246,234,.95)", casing: "rgba(92,70,40,.45)" },
    apply: { terrainOpacity: 1, roadColorMode: "class", roadWidth: 1.8, roadCasing: true, townLabels: true, indLabels: false, contourWidth: 1.1, layers: { contours: true, grid: false } },
  },
  night: {
    label: "Night", blurb: "Dark terrain · glowing network · bright stations",
    bg: "#06090c",
    ramp: ["#12261f", "#173328", "#1e3f34", "#294a3f", "#38554b", "#526059", "#c6d3da"],
    water: ["#15405c", "#071a28"], contour: "#0c1b26",
    paint: {
      townLabel: "#d5e6f2", halo: "rgba(2,6,10,.9)", casing: "rgba(3,6,9,.8)",
      stopRing: true, stopRingColor: "rgba(180,244,255,.8)",
    },
    apply: { terrainOpacity: 1, roadColorMode: "class", roadWidth: 2.1, roadCasing: true, townLabels: true, indLabels: false, contourWidth: 1, layers: { contours: false, grid: false } },
  },
  blueprint: {
    label: "Blueprint", blurb: "Monochrome · technical lines · contours",
    bg: "#0a2036",
    ramp: ["#0f3a63", "#155186", "#1f6bb0", "#3d8dc9", "#67acdd", "#9ccdeb", "#d8f0ff"],
    water: ["#08283f", "#041a2b"], contour: "#0a2b47",
    paint: { townLabel: "#d8f0ff", townFont: "600 12.5px system-ui", halo: "rgba(4,20,36,.9)", casing: "rgba(4,22,40,.55)" },
    apply: { terrainOpacity: 0.85, roadColorMode: "single", roadColor: "#bfe3ff", roadWidth: 1.5, roadCasing: true, townLabels: true, indLabels: false, contourWidth: 1, layers: { contours: true, grid: false } },
  },
  transport: {
    label: "Transport", blurb: "Terrain faded · network dominant · stations bright",
    bg: "#0b1116",
    ramp: ["#1a2226", "#232c31", "#2d373d", "#384349", "#455158", "#55636b", "#7c8a92"],
    water: ["#17394f", "#0a1b26"], contour: "#0d151b",
    paint: {
      townLabel: "#e8f2f8", halo: "rgba(3,7,10,.9)", casing: "rgba(3,7,10,.75)",
      stopRing: true, stopRingColor: "rgba(255,255,255,.75)", stopScale: 1.25,
      lineGlow: true, glowColor: "#22d3ee",
    },
    apply: { terrainOpacity: 0.22, roadColorMode: "single", roadColor: "#9db2c2", roadWidth: 1.9, roadCasing: false, townLabels: true, indLabels: false, contourWidth: 1, layers: { contours: false, grid: false } },
  },
  economy: {
    label: "Economy", blurb: "Industries · cargo flows · production",
    bg: "#11141a",
    ramp: ["#26352c", "#31402f", "#3d4a35", "#4a5340", "#575b48", "#666352", "#8d8877"],
    water: ["#1c4058", "#0a1c28"], contour: "#151b1f",
    paint: {
      townLabel: "#ffd9a8", halo: "rgba(6,9,12,.9)", casing: "rgba(5,8,11,.78)", indScale: 1.35,
      stopRing: true, stopRingColor: "rgba(255,214,140,.75)",
    },
    apply: { terrainOpacity: 0.55, roadColorMode: "class", roadWidth: 1.9, roadCasing: true, townLabels: true, indLabels: true, contourWidth: 1, layers: { contours: false, grid: false } },
  },
  network: {
    label: "Network", blurb: "Roads + rail as a graph · towns as nodes",
    bg: "#070b10",
    ramp: ["#131c22", "#1a242c", "#212d36", "#293844", "#324452", "#3d5262", "#5b7386"],
    water: ["#15364a", "#071722"], contour: "#0a1118",
    paint: {
      townLabel: "#ffffff", townFont: "700 12.5px system-ui", halo: "rgba(2,6,10,.9)",
      townNodes: true, townNode: "#9fd8ff",
      stopRing: true, stopRingColor: "rgba(120,235,255,.85)", stopScale: 1.2,
    },
    apply: { terrainOpacity: 0.3, roadColorMode: "class", roadWidth: 2.2, roadCasing: true, townLabels: true, indLabels: false, contourWidth: 1, layers: { contours: false, grid: false } },
  },
  terrain: {
    label: "Terrain", blurb: "Shaded relief, toned down — the default",
    bg: "#0d1418",
    ramp: ["#2a4a38", "#3a5a40", "#4f6548", "#667055", "#77745f", "#8e8b81", "#f0f2f3"],
    water: ["#37779f", "#0d2b45"], contour: "#16242c",
    paint: { casing: "rgba(6,10,13,.8)" },
    apply: { terrainOpacity: 1, roadColorMode: "class", roadColor: "#f3ecdd", roadWidth: 2, roadCasing: true, townLabels: true, indLabels: false, contourWidth: 1, layers: { contours: false, grid: false } },
  },
  grayscale: {
    label: "Grayscale", blurb: "Neutral tones · colour comes from the data",
    bg: "#101416",
    ramp: ["#15191b", "#3d4448", "#666e73", "#8f979c", "#b8bfc3", "#dcdfe1", "#ffffff"],
    water: ["#2b4657", "#101d26"], contour: "#0b0f11",
    paint: { roads: { highway: "#f4f4f4", town: "#e4e4e4", country: "#cbcbcb", airport: "#b9b9b9", constructions: "#8f8f8f", other: "#ababab" } },
    apply: { terrainOpacity: 1, roadColorMode: "class", roadWidth: 2, roadCasing: true, townLabels: true, indLabels: false, contourWidth: 1, layers: { contours: false, grid: false } },
  },
  /* CUSTOM is filled in when you start tweaking: it is a copy of the preset you
     came from, minus its `apply`, so nothing overwrites your controls any more. */
  custom: {
    label: "Custom", blurb: "Your tweaks · palette kept from the last preset",
    bg: "#0d1418",
    ramp: ["#2a4a38", "#3a5a40", "#4f6548", "#667055", "#77745f", "#8e8b81", "#f0f2f3"],
    water: ["#37779f", "#0d2b45"], contour: "#16242c",
  },
};
function curStyle() { return STYLES[settings.style] || STYLES.terrain; }
/* draw-time extras of the active preset */
function paint(key, fallback) {
  const p = curStyle().paint;
  return p && p[key] !== undefined ? p[key] : fallback;
}
function cloneStyle(s) {
  const c = { label: s.label, blurb: s.blurb, bg: s.bg, ramp: s.ramp.slice(), water: s.water.slice(), contour: s.contour };
  if (s.paint) c.paint = Object.assign({}, s.paint);
  return c;                       /* no `apply`: custom never pushes values back */
}
/* controls whose hand-editing turns the map into a CUSTOM preset */
const STYLE_CONTROLS = new Set(["roadColor", "roadColorMode", "roadWidth", "roadCasing",
  "contourColor", "contourWidth", "terrainOpacity", "overlayOpacity", "townLabels", "indLabels"]);
let applyingPreset = false;
function applyStylePreset(id) {
  const s = STYLES[id] || STYLES.terrain;
  settings.contourColor = s.contour;
  if (!s.apply) return;
  applyingPreset = true;
  for (const k of Object.keys(s.apply)) {
    const v = s.apply[k];
    if (k === "layers") Object.assign(settings.layers, v);
    else settings[k] = v;
  }
  applyingPreset = false;
}
function markCustom() {
  if (settings.style === "custom") return;
  settings.customFrom = settings.style;
  STYLES.custom = cloneStyle(STYLES[settings.style] || STYLES.terrain);
  settings.style = "custom";
  syncControls();
}
function isDarkStyle(name) {
  const bg = (STYLES[name] || STYLES.terrain).bg;
  const n = parseInt(bg.slice(1), 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const lin = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.35;
}
const ROAD_CATS = {
  highway: { label: "Highways", color: "#ffc95e" },
  town: { label: "Town streets", color: "#ffffff" },
  country: { label: "Country roads", color: "#d9d2c0" },
  airport: { label: "Airport surfaces", color: "#c1a6ff" },
  constructions: { label: "Entrances / construction", color: "#8fa3ad" },
  other: { label: "Other", color: "#7fd0ff" },
};
/* Road hierarchy — a network only reads when a motorway visibly outranks an
   avenue, which outranks an alley. Weight multiplies the base width and also
   decides the draw order (widest first, so narrow streets stay on top). */
function roadWeight(tpl, cat) {
  const t = tpl || "";
  if (cat === "highway") return 1.8;
  if (cat === "airport") return /runway/.test(t) ? 1.7 : 0.75;
  if (cat === "country") return /_medium/.test(t) ? 1.15 : 0.9;
  if (cat === "town") return /_medium/.test(t) ? 1.3 : /_xsmall/.test(t) ? 0.7 : 1;
  if (cat === "constructions") return 0.7;
  return 1;
}
/* Class colours per theme: dark maps get cool grey streets with a warm
   motorway (kepler/osm-dark flavour), light maps the white + yellow
   combination every phone map uses. A preset may override via paint.roads. */
const ROAD_DARK = { highway: "#f7c75b", town: "#c3cfda", country: "#93a3b1", airport: "#8fa0b4", constructions: "#63758a", other: "#9ec3de" };
const ROAD_LIGHT = { highway: "#ffce5c", town: "#ffffff", country: "#f4f1e8", airport: "#d3cdf1", constructions: "#9aa7b4", other: "#7fc4ef" };
function roadColorFor(cat) {
  const pal = paint("roads", null);
  if (pal && pal[cat]) return pal[cat];
  const t = (isDarkStyle(settings.style) ? ROAD_DARK : ROAD_LIGHT);
  return t[cat] || t.other;
}
/* Rails read as their own layer: steel greys on both themes so the track bed
   never blends into the warm street palette. Bridges get a slightly lighter,
   cleaner fill; tunnels are drawn at reduced alpha (see railEdgeAlpha). */
const RAIL_DARK = { fill: "#7f8b99", bridge: "#95a1ad", casing: "rgba(6,10,13,.85)" };
const RAIL_LIGHT = { fill: "#5c6672", bridge: "#6e7985", casing: "rgba(52,60,70,.5)" };
function railEdgeAlpha(edge) { return edge === "TUNNEL" ? 0.45 : 1; }
/* TRACK sits at country-road weight: a hair thicker than a town street,
   well under a motorway. A STREET rail rides at street weight. */
function railWeight(r) {
  if (r.roadType === "STREET") return 1;
  return 1.15;
}
const IND_RAW = new Set(["farm", "livestock_farm", "forest", "coal_mine", "iron_ore_mine", "oil_well", "oil_platform", "sand_pit", "clay_pit"]);
const IND_GROUPS = { raw: "#5fd39b", factory: "#ff9d5c", other: "#7fd0ff" };
/* ---------------- data layers ----------------
   One categorical palette for cargo (stable colour per cargoTypeId) and one
   semantic ramp for line load — both are drawn on the map and mirrored in the
   sidebar legend, so they live here, next to the other visual constants. */
const CARGO_PAL = ["#4d8dff", "#34d17f", "#ff9d5c", "#c17bff", "#ffd44d", "#ff6b8b",
  "#5ce1e6", "#8ff06a", "#ff8bf0", "#7fa8ff", "#ffb347", "#6ad6a5"];
/* Colour-blind-safe load ramp (blue → grey → amber), reinforced by the
   numeric range shown in the legend, so load never depends on colour alone. */
const LOAD_RAMP = { low: "#4d8dff", ok: "#8fa3ad", high: "#e8a33d" };
function cargoColor(id) {
  if (id == null) return "#9aa7b4";               // no cargo reported → neutral grey
  return CARGO_PAL[Math.abs(Math.round(id)) % CARGO_PAL.length];
}
const DATA_LAYER_TITLES = {
  none: "None", flows: "Cargo flows", freight: "Freight volume", load: "Line load",
  passengers: "Passengers", chains: "Supply chains", linecargo: "Cargo by line",
};
/* what the active preset measures (the legend caption) */
const DATA_LAYER_METRICS = {
  flows: "cargo volume", chains: "supply volume", freight: "items / year",
  passengers: "population", load: "capacity load", linecargo: "items carried / year",
};
const DETAIL_PX = { draft: 704, normal: 1408, full: 4096 };

