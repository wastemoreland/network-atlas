/* ============================================================
   Economy / cargo / transport panel (fullscreen)
   Everything statistical lives here: the sidebar list only carries
   name / colour / mode.
   ============================================================ */
let econOpen = false;
let econQuery = "";
/* hit boxes of the chart (scatter bubbles / matrix cells) + the current hover */
let econHits = { points: [], cells: [] };          // hit boxes of the single chart
let econHover = null;

/* getMaxFrequency is cycles per second. The game converts it itself with
   1/f and shows a duration — gui/line_util.tl calculateFrequencySeconds() and
   api.util.formatMinutesSeconds(). We round to the nearest second (the game
   truncates) and show minutes / hours the same way. */
function headwaySeconds(freq) {
  if (freq == null || !(freq >= 0.0001)) return null;   // the game shows "--" here
  return Math.round(1 / freq);
}
function fmtHeadwaySeconds(s) {
  if (s == null || !(s > 0)) return "—";
  if (s < 60) return s + " s";
  if (s < 3600) { const m = s / 60; return (Number.isInteger(m) ? m : fmtMax(m, 1)) + " min"; }
  const h = s / 3600;
  return (Number.isInteger(h) ? h : fmtMax(h, 1)) + " h";
}
function headwayTitle(freq) {
  const s = headwaySeconds(freq);
  if (s == null) return "No frequency in this export";
  return `Every ${fmtHeadwaySeconds(s)} (${s} s; getMaxFrequency ${fmtMax(freq)} cycles/s)`;
}
function capTotals(l) {
  const known = capOf(l).filter(c => c.used != null && c.capacity != null);
  if (!known.length) return null;
  return { used: known.reduce((s, c) => s + c.used, 0), cap: known.reduce((s, c) => s + c.capacity, 0) };
}
const ECON_METRICS = {
  stops: { label: "Stops", short: "Stops", unit: "count", get: l => (l.stops == null ? null : stopsOf(l).length), fmt: v => fmt(v) },
  headway: { label: "Frequency", short: "Freq", unit: "time between vehicles", get: l => { const s = headwaySeconds(l.maxFrequency); return s ? s / 60 : null; }, fmt: v => fmtHeadwaySeconds(Math.round(v * 60)) },
  throughput: { label: "Station throughput", short: "THR", unit: "items / year", get: l => (l.throughput == null ? null : l.throughput), fmt: v => fmt(v) },
  capUsed: { label: "Capacity used", short: "Used", unit: "mixed cargo units", get: l => { const c = capTotals(l); return c ? c.used : null; }, fmt: v => fmt(v) },
  capTotal: { label: "Capacity", short: "Cap", unit: "mixed cargo units", get: l => { const c = capTotals(l); return c ? c.cap : null; }, fmt: v => fmt(v) },
  load: { label: "Capacity load", short: "Load %", unit: "%", get: l => { const c = capTotals(l); return c && c.cap > 0 ? (c.used / c.cap) * 100 : null; }, fmt: v => fmt(v, 0) + "%" },
  balance: { label: "Balance (last year)", short: "Balance", unit: "game currency", get: l => { const f = l.finance; return f && f.balanceLastYear != null ? f.balanceLastYear : null; }, fmt: v => "¤ " + fmt(v) },
  transported: { label: "Transported (last year)", short: "Transported", unit: "items / year", get: l => { const f = l.finance; return f && f.itemsTransportedLastYear != null ? f.itemsTransportedLastYear : null; }, fmt: v => fmt(v) },
  issues: { label: "Issues", short: "Issues", unit: "count", get: l => (l.issues == null ? null : issuesOf(l).length), fmt: v => fmt(v) },
  /* derived: balance per item actually carried — only when BOTH fields are present */
  balancePerItem: {
    label: "Balance per item", short: "Bal/item", unit: "game currency / item",
    get: l => {
      const f = l.finance;
      if (!f || f.balanceLastYear == null || f.itemsTransportedLastYear == null) return null;
      return f.itemsTransportedLastYear > 0 ? f.balanceLastYear / f.itemsTransportedLastYear : null;
    },
    fmt: v => "¤ " + fmt(v, 2),
  },
};
const ECON_TEXT_SORTS = ["name", "mode"];
const ECON_TYPE_LABELS = {
  bar: "Bars per line", donut: "Share by mode", cargo: "Capacity by cargo", flows: "Cargo flows",
  scatter: "Scatter / bubble", matrix: "Correlation matrix", rank: "Ranking",
};
/* one chart module, seven types — the Analytics / Explore section */
const ECON_CHART_TYPES = ["bar", "donut", "cargo", "flows", "scatter", "matrix", "rank"];
/* the axes a user may pick for a scatter (Frequency / Stops / Capacity / Load % / THR / Balance / Transported) */
const SCATTER_METRICS = ["headway", "stops", "capTotal", "load", "throughput", "balance", "transported"];
const SIZE_METRICS = ["transported", "capTotal", "capUsed", "throughput", "stops", "balance", "issues"];
/* metrics where the value to look at first is the low one — the ranking flips */
const ECON_LOWER_BETTER = new Set(["issues", "load"]);
const ECON_PALETTE = ["#4fa3ff", "#ffb454", "#5fd39b", "#ff7b72", "#c792ea", "#7fd0ff", "#f6c558", "#9ccdeb"];
const ECON_COLS = [
  ["name", "Name"], ["mode", "Mode"], ["stops", "Stops"], ["headway", "Frequency"],
  ["throughput", "Thr /yr"], ["capTotal", "Capacity"], ["load", "Load"], ["issues", "Issues"],
  ["balance", "Balance ¤"], ["transported", "Transported /yr"],
];
function metricValue(l, key) { const m = ECON_METRICS[key]; return m ? m.get(l) : null; }
function metricText(l, key) { const v = metricValue(l, key); return v == null ? "—" : ECON_METRICS[key].fmt(v); }
function econSortValue(l, key) {
  if (key === "name") return l.label.toLowerCase();
  if (key === "mode") return (modesOf(l)[0] || "\uffff").toLowerCase();
  return metricValue(l, key);
}
function econSorted(rows, key, dir) {
  const numeric = !ECON_TEXT_SORTS.includes(key);
  const known = [], missing = [];
  for (const l of rows) (econSortValue(l, key) == null ? missing : known).push(l);
  known.sort((a, b) => {
    const va = econSortValue(a, key), vb = econSortValue(b, key);
    const c = numeric ? va - vb : String(va).localeCompare(String(vb));
    return dir === "desc" ? -c : c;
  });
  return known.concat(missing);              // lines without that value always last
}
/* text (own query) + mode filter + "only lines with data"; the map's
   show/hide checkboxes are deliberately ignored here.
   Which metric "only lines with chart data" keys off depends on the chart:
   scatter has a visible X, matrix has no single metric (any counts), and the
   flows view does not filter lines at all. */
function econOnlyPass(l) {
  const e = settings.econ;
  if (!e.onlyData) return true;
  if (e.type === "flows") return true;
  if (e.type === "scatter") return metricValue(l, e.x) != null;
  if (e.type === "matrix") return SCATTER_METRICS.some(k => metricValue(l, k) != null);
  return metricValue(l, e.metric) != null;
}
function econFiltered() {
  if (!data) return [];
  return data.lines.filter(l =>
    lineHasModeOn(l) &&
    (!econQuery || l.search.includes(econQuery)) &&
    econOnlyPass(l));
}
function econRows(limit) {
  const rows = econSorted(econFiltered(), settings.econ.sort, settings.econ.dir);
  const lim = Number(settings.econ.limit) || 0;
  return limit && lim > 0 ? rows.slice(0, lim) : rows;
}

/* --- key figures --- */
function econKpis(rows) {
  const n = rows.length;
  const pick = key => rows.filter(l => metricValue(l, key) != null);
  const sum = key => { const k = pick(key); return k.length ? k.reduce((s, l) => s + metricValue(l, key), 0) : null; };
  const mean = key => { const k = pick(key); return k.length ? k.reduce((s, l) => s + metricValue(l, key), 0) / k.length : null; };
  const sub = key => (n && pick(key).length !== n ? `${pick(key).length} of ${n} lines with data` : "");
  const miss = "not in this export";
  const out = [{ k: "Lines", v: fmt(n), s: data ? `${fmt(data.lines.length)} in export` : "" }];
  const stops = sum("stops");
  out.push({ k: "Stops", v: stops == null ? "—" : fmt(stops), s: stops == null ? miss : sub("stops") });
  const hw = pick("headway");
  const avgHw = hw.length ? hw.reduce((s, l) => s + metricValue(l, "headway"), 0) / hw.length : null;
  out.push({ k: "Avg frequency", v: avgHw == null ? "—" : fmtHeadwaySeconds(Math.round(avgHw * 60)), s: avgHw == null ? miss : sub("headway") });
  const thr = sum("throughput");
  out.push({ k: "Throughput", v: thr == null ? "—" : fmt(thr), s: thr == null ? miss : sub("throughput") + " · items/year" });
  /* Capacity units differ by cargo (passengers, tonnes, …), so summing them is
     dimensionally meaningless. Show the per-line average instead; Load is the
     capacity-weighted average and says it mixes cargo units. */
  const cu = mean("capUsed"), ct = mean("capTotal");
  out.push({ k: "Avg capacity used", v: cu == null ? "—" : fmt(cu), s: cu == null ? miss : "avg per line · mixes cargo units" });
  out.push({ k: "Avg capacity", v: ct == null ? "—" : fmt(ct), s: ct == null ? miss : "avg per line · mixes cargo units" });
  const both = rows.filter(l => metricValue(l, "capUsed") != null && metricValue(l, "capTotal") > 0);
  const load = both.length
    ? both.reduce((s, l) => s + metricValue(l, "capUsed"), 0) / both.reduce((s, l) => s + metricValue(l, "capTotal"), 0) * 100
    : null;
  out.push({ k: "Load", v: load == null ? "—" : fmt(load, 0) + "%", s: load == null ? "needs used + capacity" : "weighted avg · mixes cargo units" });
  const bal = sum("balance");
  out.push({ k: "Balance (last year)", v: bal == null ? "—" : ECON_METRICS.balance.fmt(bal), s: bal == null ? miss : "last game year — not profit" });
  const tr = sum("transported");
  out.push({ k: "Transported (last year)", v: tr == null ? "—" : fmt(tr), s: tr == null ? miss : sub("transported") + " · items/year" });
  const iss = sum("issues");
  out.push({ k: "Issues", v: iss == null ? "—" : fmt(iss), s: iss == null ? miss : sub("issues") });
  return out;
}
function renderEconKpis(rows) {
  const host = $("#econKpis");
  if (!host) return;
  host.innerHTML = econKpis(rows).map(c =>
    `<div class="kpi"><div class="k">${c.k}</div><div class="v" title="${esc(c.s || c.v)}">${c.v}</div><div class="s">${esc(c.s || "")}</div></div>`).join("");
}
function renderEconTable(rows) {
  const head = $("#econHead"), body = $("#econTableBody"), empty = $("#econEmpty"), wrap = $("#econTableWrap");
  if (!head || !body || !data) return;
  const sort = settings.econ.sort, dir = settings.econ.dir;
  head.innerHTML = "<tr>" + ECON_COLS.map(([k, t]) => {
    const arrow = k === sort ? (dir === "desc" ? " ▼" : " ▲") : "";
    const m = ECON_METRICS[k];
    const aria = k === sort ? (dir === "desc" ? "descending" : "ascending") : "none";
    return `<th scope="col" data-econsort="${k}" aria-sort="${aria}" class="${k === sort ? "sorted" : ""}" title="Click to sort${m && m.unit ? " · " + esc(m.unit) : ""}">${t}${arrow}</th>`;
  }).join("") + "</tr>";
  const sel = selectedLine();
  body.innerHTML = rows.map(l => {
    const cap = capSummary(l), load = metricValue(l, "load");
    return `<tr class="erow${sel && sel.id === l.id ? " sel" : ""}" data-econline="${l.id}" tabindex="0" role="button" aria-label="Select ${esc(l.label)}">
      <td class="t"><span class="lname"><span class="ldot" style="background:${lineColorCss(l)}"></span><span title="${esc(l.label)}">${esc(l.label)}</span></span></td>
      <td class="m" title="${esc(modesOf(l).join(", "))}">${modesDisplay(l)}</td>
      <td class="n" title="Stops">${metricText(l, "stops")}</td>
      <td class="n" title="${esc(headwayTitle(l.maxFrequency))}">${l.maxFrequency == null ? "—" : fmtHeadwaySeconds(headwaySeconds(l.maxFrequency))}</td>
      <td class="n" title="Station throughput · items / year">${metricText(l, "throughput")}</td>
      <td class="n" title="${esc(cap.title)}">${cap.text}</td>
      <td class="n" title="Capacity used / capacity">${load == null ? "—" : fmt(load, 0) + "%"}</td>
      <td class="n" title="Configuration issues">${metricText(l, "issues")}</td>
      <td class="n" title="Balance of the last export year, in game currency — not a profit">${metricText(l, "balance")}</td>
      <td class="n" title="Items transported last year (items / year)">${metricText(l, "transported")}</td>
    </tr>`;
  }).join("");
  if (empty) {
    empty.textContent = data.lines.length ? "No line matches the filter" : "No lines in this export — re-export with a newer version of the mod to include them.";
    empty.classList.toggle("hidden", !!rows.length);
  }
  if (wrap) wrap.classList.toggle("hidden", !data.lines.length);
}

