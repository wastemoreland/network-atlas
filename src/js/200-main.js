/* ============================================================
   Init
   ============================================================ */
function init() {
  syncControls();
  applySectionState();
  syncOutputs();
  resize();
  const q = new URLSearchParams(location.search);
  const st = q.get("style");
  if (st && STYLES[st] && st !== settings.style) { setSetting("style", st); syncControls(); syncOutputs(); }
  const src = q.get("src");
  if (src) { loadUrl(src); return; }
  loadHandle().then(rec => {
    if (rec) {
      const btn = $("#wReopen");
      btn.classList.remove("hidden");
      btn.textContent = "Reopen " + (rec.path || "last file");
    }
  });
}
init();
window.__viewer = {
  get view() { return view; },
  get data() { return data; },
  get settings() { return settings; },
  fit, centerOn, zoomBy, setSetting, loadFile, loadUrl,
  screenToWorld, buildTerrain, buildContours, elevationAt,
  requestRender, exportPng, nearestEntity, drawScene,
  get lines() { return data ? data.lines : []; },
  get selectedLine() { return selectedLine(); },
  visibleLines, filteredLines, lineById, selectLine, setLineFilter, focusLine,
  renderLinesPanel, renderLineTable, renderLineDetail, lineColorCss, prepareLines,
  openEcon, closeEcon, renderEcon, econSortBy, metricValue, metricText,
  econRows, econFiltered, econSorted, econKpis,
  econChartTitle, econRail, econPick, econExplore,
  get econHits() { return econHits; },
  pearson, fmtR, corrColor, drawEconChart,
  lineRuleMatch, lineRuleActive, lineRuleDim, ruleText, renderLineRule,
  get RULE_HIGHLIGHT() { return RULE_HIGHLIGHT; },
  headwaySeconds, fmtHeadwaySeconds, headwayTitle, capTotals,
  get econOpen() { return econOpen; },
  get terrainCanvas() { return terrainCanvas; },
  get contourPaths() { return contourPaths; },
};
