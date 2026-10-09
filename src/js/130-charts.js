/* --- charts (plain canvas, no libraries) --- */
function elide(g, s, max) {
  g.font = "12.5px system-ui";
  if (g.measureText(s).width <= max) return s;
  let t = s;
  while (t.length > 1 && g.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}
function noChartData(g, w, h) {
  g.fillStyle = "#7d8f99"; g.font = "14px system-ui";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("No data for this metric", w / 2, h / 2);
  g.textAlign = "left"; g.textBaseline = "alphabetic";
}
function drawEconBar(g, w, h, rows, key) {
  const items = rows.map(l => ({ l, v: metricValue(l, key) })).filter(r => r.v != null);
  if (!items.length) return noChartData(g, w, h);
  const pad = 14, labelW = Math.min(250, Math.max(96, w * 0.24)), valW = 116;
  const x0 = pad + labelW, x1 = Math.max(x0 + 10, w - valW - pad);
  const rowH = Math.min(34, (h - 2 * pad) / items.length);
  const bh = Math.max(2, rowH - 4);
  /* With hundreds of rows the per-row text cannot fit; keep the bars readable
     and drop the labels instead of drawing them on top of each other. */
  const showText = rowH >= 12;
  const showVals = showText && settings.econ.values;
  const nums = items.map(r => r.v);
  const maxV = Math.max(...nums, 0), minV = Math.min(...nums, 0);
  const span = (maxV - minV) || 1;
  const zero = x0 + ((0 - minV) / span) * (x1 - x0);
  g.font = "12.5px system-ui";
  items.forEach((r, i) => {
    const y = pad + i * rowH;
    const vx = x0 + ((r.v - minV) / span) * (x1 - x0);
    g.fillStyle = lineColorCss(r.l);
    g.fillRect(Math.min(zero, vx), y, Math.max(2, Math.abs(vx - zero)), bh);
    if (!showText) return;
    g.fillStyle = "#9fb0ba"; g.textAlign = "left";
    g.fillText(elide(g, r.l.label, labelW - 10), pad, y + bh - 2);
    if (showVals) {
      g.fillStyle = "#e6eef3"; g.textAlign = "right";
      g.fillText(ECON_METRICS[key].fmt(r.v), w - pad, y + bh - 2);
    }
    g.textAlign = "left";
  });
}
function drawEconDonut(g, w, h, rows, key) {
  const groups = new Map();
  for (const l of rows) {
    const v = metricValue(l, key);
    if (v == null || v <= 0) continue;
    const m = modesOf(l)[0] || "—";
    groups.set(m, (groups.get(m) || 0) + v);
  }
  const items = [...groups.entries()].sort((a, b) => b[1] - a[1]);
  if (!items.length) return noChartData(g, w, h);
  const total = items.reduce((s, [, v]) => s + v, 0) || 1;
  const R = Math.max(34, Math.min(h / 2 - 24, Math.min(w * 0.2, 170)));
  const cx = R + 26, cy = h / 2, r = R * 0.58;
  let a = -Math.PI / 2;
  items.forEach(([, v], i) => {
    const ang = (v / total) * Math.PI * 2;
    g.beginPath(); g.arc(cx, cy, R, a, a + ang); g.arc(cx, cy, r, a + ang, a, true); g.closePath();
    g.fillStyle = ECON_PALETTE[i % ECON_PALETTE.length]; g.fill();
    a += ang;
  });
  g.font = "12.5px system-ui"; g.textBaseline = "middle";
  const lx = cx + R + 30;
  const rowH = Math.min(26, Math.max(19, (h - 28) / items.length));
  items.forEach(([name, v], i) => {
    const y = 20 + i * rowH;
    if (y > h - 10) return;
    g.fillStyle = ECON_PALETTE[i % ECON_PALETTE.length];
    g.fillRect(lx, y - 5, 11, 11);
    g.fillStyle = "#9fb0ba"; g.textAlign = "left";
    g.fillText(elide(g, name, Math.max(40, w - lx - 170)), lx + 17, y);
    if (settings.econ.values) {
      g.fillStyle = "#e6eef3"; g.textAlign = "right";
      g.fillText(`${fmt(v)}  ·  ${Math.round((v / total) * 100)}%`, w - 8, y);
    }
    g.textAlign = "left";
  });
  g.textBaseline = "alphabetic";
}
function drawEconCargo(g, w, h, rows) {
  const groups = new Map();
  for (const l of rows) for (const c of capOf(l)) {
    if (c.used == null && c.capacity == null) continue;
    const k = c.name || "#" + c.cargoTypeId;
    const e = groups.get(k) || { used: 0, cap: 0 };
    if (c.used != null) e.used += c.used;
    if (c.capacity != null) e.cap += c.capacity;
    groups.set(k, e);
  }
  const items = [...groups.entries()].sort((a, b) => (b[1].cap - a[1].cap) || (b[1].used - a[1].used));
  if (!items.length) return noChartData(g, w, h);
  const pad = 14, labelW = Math.min(230, Math.max(96, w * 0.22)), valW = 140;
  const x0 = pad + labelW, x1 = Math.max(x0 + 10, w - valW - pad);
  const rowH = Math.min(34, (h - 2 * pad) / items.length);
  const bh = Math.max(2, rowH - 4);
  const showText = rowH >= 12;
  const showVals = showText && settings.econ.values;
  const maxV = Math.max(...items.map(([, e]) => Math.max(e.cap, e.used)), 1);
  g.font = "12.5px system-ui";
  items.forEach(([name, e], i) => {
    const y = pad + i * rowH;
    const wCap = ((e.cap || 0) / maxV) * (x1 - x0);
    const wUsed = ((e.used || 0) / maxV) * (x1 - x0);
    g.fillStyle = "rgba(255,255,255,.10)"; g.fillRect(x0, y, Math.max(2, wCap), bh);
    g.fillStyle = "#4fa3ff"; g.fillRect(x0, y, Math.max(2, wUsed), bh);
    if (!showText) return;
    g.fillStyle = "#9fb0ba"; g.textAlign = "left";
    g.fillText(elide(g, name, labelW - 10), pad, y + bh - 2);
    if (showVals) {
      g.fillStyle = "#e6eef3"; g.textAlign = "right";
      g.fillText(`${fmt(e.used)} / ${fmt(e.cap)}`, w - pad, y + bh - 2);
    }
    g.textAlign = "left";
  });
}
/* --- correlation --- */
/* Pearson r over the lines that carry BOTH values. Fewer than three points is
   not a correlation (two points are always ±1), so r stays null / "—". */
function pearson(rows, kx, ky) {
  const xs = [], ys = [];
  for (const l of rows) {
    const a = metricValue(l, kx), b = metricValue(l, ky);
    if (a == null || b == null) continue;
    xs.push(a); ys.push(b);
  }
  const n = xs.length;
  if (n < 3) return { r: null, n };
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (!(sxx > 0) || !(syy > 0)) return { r: null, n };   // one value repeated → nothing to correlate
  return { r: sxy / Math.sqrt(sxx * syy), n };
}
function fmtR(r) { return r == null ? "—" : r.toFixed(2); }
function corrColor(r) {
  if (r == null) return "rgba(255,255,255,.05)";
  const a = (0.14 + 0.78 * Math.abs(r)).toFixed(2);
  return r >= 0 ? `rgba(79,163,255,${a})` : `rgba(255,123,114,${a})`;
}
function metricShort(k) { return (ECON_METRICS[k] || {}).short || k; }

/* --- scatter / bubble: X and Y chosen by the user, size = a third metric --- */
function axisDomain(vals) {
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { const p = Math.abs(lo) * 0.1 || 1; return [lo - p, hi + p]; }
  const pad = (hi - lo) * 0.06;
  return [lo - pad, hi + pad];
}
function niceTicks(lo, hi, count) {
  const step0 = (hi - lo) / Math.max(1, count);
  if (!(step0 > 0)) return [lo];
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out.length ? out : [lo, hi];
}
function drawEconTip(g, w, h, lines, x, y) {
  if (!lines.length) return;
  g.font = "12.5px system-ui"; g.textAlign = "left"; g.textBaseline = "alphabetic";
  let tw = 0;
  for (const t of lines) tw = Math.max(tw, g.measureText(t).width);
  const bw = tw + 24, bh = lines.length * 17 + 14;
  const bx = Math.min(Math.max(6, x + 16), Math.max(6, w - bw - 6));
  const by = Math.min(Math.max(6, y - bh - 14), Math.max(6, h - bh - 6));
  g.fillStyle = "rgba(6,10,13,.96)"; g.fillRect(bx, by, bw, bh);
  g.strokeStyle = "rgba(255,255,255,.22)"; g.lineWidth = 1; g.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
  lines.forEach((t, i) => { g.fillStyle = i ? "#9fb0ba" : "#e6eef3"; g.fillText(t, bx + 11, by + 18 + i * 17); });
}
function drawEconScatter(g, w, h, rows, xk, yk, sk, hits) {
  const mx = ECON_METRICS[xk], my = ECON_METRICS[yk];
  if (!mx || !my) return noChartData(g, w, h);
  const ms = sk && sk !== "none" && ECON_METRICS[sk] ? ECON_METRICS[sk] : null;
  const pts = [];
  for (const l of rows) {
    const x = mx.get(l), y = my.get(l);
    if (x == null || y == null) continue;             // lines without both values are not plotted
    pts.push({ l, x, y, s: ms ? ms.get(l) : null });
  }
  if (!pts.length) return noChartData(g, w, h);
  const padL = 82, padR = 26, padT = 38, padB = 58;
  const x0 = padL, x1 = w - padR, y0 = padT, y1 = h - padB;
  if (x1 - x0 < 40 || y1 - y0 < 40) return noChartData(g, w, h);
  const [xa, xb] = axisDomain(pts.map(p => p.x));
  const [ya, yb] = axisDomain(pts.map(p => p.y));
  const sx = v => x0 + ((v - xa) / ((xb - xa) || 1)) * (x1 - x0);
  const sy = v => y1 - ((v - ya) / ((yb - ya) || 1)) * (y1 - y0);
  const xt = niceTicks(xa, xb, 5), yt = niceTicks(ya, yb, 4);
  g.font = "12px system-ui"; g.lineWidth = 1;
  g.strokeStyle = "rgba(255,255,255,.07)";
  for (const t of xt) { const X = Math.round(sx(t)) + 0.5; g.beginPath(); g.moveTo(X, y0); g.lineTo(X, y1); g.stroke(); }
  for (const t of yt) { const Y = Math.round(sy(t)) + 0.5; g.beginPath(); g.moveTo(x0, Y); g.lineTo(x1, Y); g.stroke(); }
  g.strokeStyle = "rgba(255,255,255,.3)";
  g.beginPath(); g.moveTo(x0 + 0.5, y0); g.lineTo(x0 + 0.5, y1 + 0.5); g.lineTo(x1, y1 + 0.5); g.stroke();
  g.fillStyle = "#9fb0ba";
  g.textAlign = "center"; g.textBaseline = "top";
  for (const t of xt) g.fillText(elide(g, mx.fmt(t), 104), sx(t), y1 + 10);
  g.textAlign = "right"; g.textBaseline = "middle";
  for (const t of yt) g.fillText(elide(g, my.fmt(t), padL - 18), x0 - 10, sy(t));
  g.textBaseline = "alphabetic"; g.font = "13px system-ui"; g.fillStyle = "#c7d3da";
  const axisLabel = m => m.label + (m.unit && m.unit.length <= 6 ? " (" + m.unit + ")" : "");
  g.textAlign = "left"; g.fillText(axisLabel(my), 8, y0 - 14);
  g.textAlign = "right"; g.fillText(axisLabel(mx), x1, h - 10);
  const modes = [...new Set(pts.map(p => (modesOf(p.l)[0] || "—")))].sort();
  const modeCol = m => ECON_PALETTE[Math.max(0, modes.indexOf(m)) % ECON_PALETTE.length];
  const svals = pts.map(p => p.s).filter(v => v != null && isFinite(v) && v > 0);
  const smax = svals.length ? Math.max(...svals) : 0;
  const rOf = v => (v == null || !smax) ? 5 : 5 + 17 * Math.sqrt(Math.max(0, v) / smax);
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  for (const p of pts.slice().sort((a, b) => rOf(b.s) - rOf(a.s))) {
    const cx = sx(p.x), cy = sy(p.y), r = rOf(p.s), col = modeCol(modesOf(p.l)[0] || "—");
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2);
    g.globalAlpha = 0.5; g.fillStyle = col; g.fill(); g.globalAlpha = 1;
    g.lineWidth = 1.4; g.strokeStyle = col; g.stroke();
    if (econHover && econHover.line === p.l) {
      g.beginPath(); g.arc(cx, cy, r + 3, 0, Math.PI * 2);
      g.lineWidth = 2; g.strokeStyle = "#ffffff"; g.stroke();
    }
    hits.points.push({ x: cx, y: cy, r, line: p.l, xk, yk, sk: ms ? sk : "none" });
  }
  g.font = "12px system-ui"; g.textBaseline = "top";
  let ly = y0 + 6;
  for (const m of modes) {
    const tw = g.measureText(m).width;
    g.fillStyle = modeCol(m); g.fillRect(x1 - tw - 32, ly + 1, 11, 11);
    g.fillStyle = "#c7d3da"; g.fillText(m, x1 - tw - 16, ly);
    ly += 17;
  }
  g.textBaseline = "alphabetic";
}

/* --- correlation matrix (a heatmap of r) + the click-to-explore cells --- */
function drawEconMatrix(g, w, h, rows, hits) {
  const keys = SCATTER_METRICS.filter(k => ECON_METRICS[k]);
  const n = keys.length;
  const pad = 12, labW = 92, labH = 44;
  const x0 = pad + labW, y0 = pad + labH;
  const cw = (w - pad - x0) / n, ch = (h - pad - y0) / n;
  if (cw < 18 || ch < 14) return noChartData(g, w, h);
  g.font = "12.5px system-ui"; g.fillStyle = "#9fb0ba";
  g.textAlign = "right"; g.textBaseline = "middle";
  for (let j = 0; j < n; j++) g.fillText(elide(g, metricShort(keys[j]), cw - 8), x0 + (j + 1) * cw - 5, y0 - labH / 2);
  for (let i = 0; i < n; i++) g.fillText(elide(g, metricShort(keys[i]), labW - 14), x0 - 10, y0 + (i + 0.5) * ch);
  g.font = "12.5px system-ui";
  for (let i = 0; i < n; i++) {
    const cov = rows.filter(l => metricValue(l, keys[i]) != null).length;
    for (let j = 0; j < n; j++) {
      const cx = x0 + j * cw, cy = y0 + i * ch;
      const pair = i === j ? { r: 1, n: cov } : pearson(rows, keys[j], keys[i]);
      g.fillStyle = i === j ? corrColor(1) : corrColor(pair.r);
      g.fillRect(cx, cy, Math.max(1, cw - 1), Math.max(1, ch - 1));
      const txt = i === j ? String(cov) : fmtR(pair.r);
      if (cw >= 24 && ch >= 18) {
        g.fillStyle = pair.r == null ? "#8294a0" : "#eef5f9";
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(txt, cx + cw / 2, cy + ch / 2);
      }
      hits.cells.push({
        x: cx, y: cy, w: Math.max(1, cw - 1), h: Math.max(1, ch - 1),
        xk: keys[j], yk: keys[i], r: i === j ? 1 : pair.r, n: pair.n, i, j,
      });
    }
  }
  g.font = "12px system-ui"; g.textAlign = "left"; g.textBaseline = "alphabetic";
  g.fillStyle = "#9fb0ba";
  g.fillText("blue = positive · red = negative · diagonal = lines with data · click a cell to explore", pad, h - 9);
}

/* --- ranking: bars sorted by the metric. Metrics where the low value is the
   one to look at first (Issues, Load) rank ascending, and the title says so. --- */
function econRankAsc(key) { return ECON_LOWER_BETTER.has(key); }
function drawEconRank(g, w, h, rows, key) {
  const m = ECON_METRICS[key];
  if (!m) return noChartData(g, w, h);
  const asc = econRankAsc(key);
  const items = rows.map(l => ({ l, v: m.get(l) })).filter(r => r.v != null).sort((a, b) => asc ? a.v - b.v : b.v - a.v);
  if (!items.length) return noChartData(g, w, h);
  const pad = 14, rankW = 30, labelW = Math.min(240, Math.max(96, w * 0.24)), valW = 116;
  const x0 = pad + rankW + labelW, x1 = Math.max(x0 + 10, w - valW - pad);
  const rowH = Math.min(34, (h - 2 * pad) / items.length);
  const bh = Math.max(2, rowH - 4);
  const showText = rowH >= 12;
  const showVals = showText && settings.econ.values;
  const maxV = Math.max(...items.map(r => r.v), 0), minV = Math.min(...items.map(r => r.v), 0);
  const span = (maxV - minV) || 1;
  const zero = x0 + ((0 - minV) / span) * (x1 - x0);
  g.font = "12.5px system-ui";
  items.forEach((r, i) => {
    const y = pad + i * rowH;
    const vx = x0 + ((r.v - minV) / span) * (x1 - x0);
    g.fillStyle = lineColorCss(r.l);
    g.fillRect(Math.min(zero, vx), y, Math.max(2, Math.abs(vx - zero)), bh);
    if (!showText) return;
    g.fillStyle = i === 0 ? "#ffe9b0" : "#7d8f99"; g.textAlign = "right";
    g.fillText(String(i + 1), pad + rankW - 8, y + bh - 2);
    g.fillStyle = "#9fb0ba"; g.textAlign = "left";
    g.fillText(elide(g, r.l.label, labelW - 10), pad + rankW, y + bh - 2);
    if (showVals) {
      g.fillStyle = "#e6eef3"; g.textAlign = "right";
      g.fillText(m.fmt(r.v), w - pad, y + bh - 2);
    }
    g.textAlign = "left";
  });
}

/* --- cargo flows: the export's econ.flows table as a ranked bar list --- */
function drawEconFlows(g, w, h, limit) {
  const e = data && data.econ;
  const flows = e && e.flows ? e.flows.filter(f => f.volume != null && f.volume > 0) : [];
  if (!flows.length) return noChartData(g, w, h);
  const sorted = flows.slice().sort((a, b) => b.volume - a.volume);
  const lim = limit && limit > 0 ? sorted.slice(0, limit) : sorted;
  const pad = 14, labelW = Math.min(340, Math.max(120, w * 0.34)), valW = 150;
  const x0 = pad + labelW, x1 = Math.max(x0 + 10, w - valW - pad);
  const rowH = Math.min(34, (h - 2 * pad) / lim.length);
  const bh = Math.max(2, rowH - 4);
  const showText = rowH >= 12;
  const showVals = showText && settings.econ.values;
  const maxV = Math.max(...lim.map(f => f.volume), 1);
  g.font = "12.5px system-ui";
  lim.forEach((f, i) => {
    const y = pad + i * rowH;
    const vw = (f.volume / maxV) * (x1 - x0);
    g.fillStyle = cargoColor(f.cargoTypeId);
    g.fillRect(x0, y, Math.max(2, vw), bh);
    if (!showText) return;
    const label = `${f.fromName || ("#" + f.from)} → ${f.toName || ("#" + f.to)}`;
    g.fillStyle = "#9fb0ba"; g.textAlign = "left";
    g.fillText(elide(g, label, labelW - 12), pad, y + bh - 2);
    if (showVals) {
      g.fillStyle = "#e6eef3"; g.textAlign = "right";
      g.fillText(`${fmt(f.volume)}${f.cargoName ? " · " + f.cargoName : ""}`, w - pad, y + bh - 2);
    }
    g.textAlign = "left";
  });
}

function drawEconChart(canvas, rows, hits) {
  const out = hits && hits.points ? hits : { points: [], cells: [] };
  out.points.length = 0;                    // rebuilt on every render
  out.cells.length = 0;
  if (!canvas || !canvas.getContext) return out;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 640, h = canvas.clientHeight || 480;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const g = canvas.getContext("2d");
  if (!g) return out;
  if (g.setTransform) g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#10181e"; g.fillRect(0, 0, w, h);
  g.font = "12.5px system-ui"; g.textAlign = "left"; g.textBaseline = "alphabetic";
  const e = settings.econ;
  const type = ECON_CHART_TYPES.includes(e.type) ? e.type : "bar";
  const key = ECON_METRICS[e.metric] ? e.metric : DEFAULTS.econ.metric;
  if (type === "donut") drawEconDonut(g, w, h, rows, key);
  else if (type === "cargo") drawEconCargo(g, w, h, rows);
  else if (type === "flows") drawEconFlows(g, w, h, Number(e.limit) || 0);
  else if (type === "scatter") drawEconScatter(g, w, h, rows, e.x, e.y, e.size, out);
  else if (type === "matrix") drawEconMatrix(g, w, h, rows, out);
  else if (type === "rank") drawEconRank(g, w, h, rows, key);
  else drawEconBar(g, w, h, rows, key);
  if (econHover) drawEconTip(g, w, h, econTipLines(econHover), econHover.x, econHover.y);
  return out;
}

/* --- panel --- */
function renderEconModeChips() {
  const host = $("#econModeChips");
  if (!host || !data) return;
  const modes = lineModeCounts();
  host.innerHTML = modes.length
    ? modes.map(([m, n]) => {
      const on = !settings.lineModeOff.includes(m);
      return `<label class="chip ${on ? "on" : ""}"><input type="checkbox" data-linemode="${esc(m)}" ${on ? "checked" : ""}><span>${esc(m)}</span><span class="count">${n}</span></label>`;
    }).join("")
    : `<span class="hint-txt" style="margin:0">No mode information in this export</span>`;
}
function econSyncControls() {
  const e = settings.econ;
  if (!ECON_METRICS[e.metric]) e.metric = DEFAULTS.econ.metric;
  if (!ECON_METRICS[e.sort] && !ECON_TEXT_SORTS.includes(e.sort)) e.sort = DEFAULTS.econ.sort;
  if (!ECON_CHART_TYPES.includes(e.type)) e.type = DEFAULTS.econ.type;
  const axisOk = k => SCATTER_METRICS.includes(k) && !!ECON_METRICS[k];
  if (!axisOk(e.x)) e.x = DEFAULTS.econ.x;
  if (!axisOk(e.y)) e.y = DEFAULTS.econ.y;
  const sizeOk = v => v === "none" || !!ECON_METRICS[v];
  if (!sizeOk(e.size)) e.size = DEFAULTS.econ.size;
  const fill = (sel, opts, val) => {
    const el = $(sel);
    if (!el) return;
    el.innerHTML = opts.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("");
    el.value = String(val);
  };
  const metricOpts = Object.entries(ECON_METRICS).map(([k, m]) => [k, m.label]);
  fill("#econMetric", metricOpts, e.metric);
  const axisOpts = SCATTER_METRICS.filter(k => ECON_METRICS[k]).map(k => [k, ECON_METRICS[k].label]);
  fill("#econX", axisOpts, e.x); fill("#econY", axisOpts, e.y);
  const sizeOpts = [["none", "None"], ...SIZE_METRICS.filter(k => ECON_METRICS[k]).map(k => [k, ECON_METRICS[k].label])];
  fill("#econSize", sizeOpts, e.size);
  fill("#econSort", [["name", "Name"], ["mode", "Mode"], ...metricOpts], e.sort);
  const set = (sel, v) => { const el = $(sel); if (el) el.value = String(v); };
  set("#econType", e.type); set("#econDir", e.dir); set("#econLimit", e.limit);
  const chk = (sel, v) => { const el = $(sel); if (el) el.checked = !!v; };
  chk("#econValues", e.values); chk("#econOnlyData", e.onlyData);
  econRail();
  renderEconModeChips();
}
/* only the controls the chosen chart type actually uses */
function econRail() {
  const e = settings.econ, t = e.type;
  const show = (id, on) => { const el = $("#" + id); if (el) el.classList.toggle("hidden", !on); };
  show("econMetricRow", t === "bar" || t === "donut" || t === "rank");
  show("econXRow", t === "scatter");
  show("econYRow", t === "scatter");
  show("econSizeRow", t === "scatter");
  /* Sorting only affects the row-list charts; scatter and matrix use every
     line, and the flows chart sorts itself by volume. Dim controls that cannot
     act instead of letting them silently do nothing. */
  const sortRows = !(t === "scatter" || t === "matrix" || t === "flows");
  for (const id of ["econSortRow", "econDirRow"]) {
    const el = $("#" + id); if (el) el.classList.toggle("dim", !sortRows);
    const ctrl = el && el.querySelector("select, input"); if (ctrl) ctrl.disabled = !sortRows;
  }
  const limitUses = !(t === "scatter" || t === "matrix");
  const lr = $("#econLimitRow"); if (lr) lr.classList.toggle("dim", !limitUses);
  const lc = $("#econLimit"); if (lc) lc.disabled = !limitUses;
  const valuesUse = !(t === "scatter" || t === "matrix");
  const vr = $("#econValuesRow"); if (vr) vr.classList.toggle("dim", !valuesUse);
  const vc = $("#econValues"); if (vc) vc.disabled = !valuesUse;
  const od = $("#econOnlyData"); if (od) od.disabled = (t === "flows");
  /* the filter's label names the metric it keys off (it is hidden for scatter) */
  const lab = $("#econOnlyDataLabel");
  if (lab) {
    let m;
    if (t === "scatter") m = ECON_METRICS[e.x] ? ECON_METRICS[e.x].label : null;
    else if (t === "matrix") m = "any chart metric";
    else if (t === "flows") m = null;
    else m = ECON_METRICS[e.metric] ? ECON_METRICS[e.metric].label : null;
    lab.textContent = m ? `Only lines with ${m} data` : "Only lines with chart data";
  }
}
/* title doubles as the correlation read-out and the colour/size legend */
function econChartTitle(rowsAll) {
  const e = settings.econ;
  const type = ECON_CHART_TYPES.includes(e.type) ? e.type : "bar";
  const key = ECON_METRICS[e.metric] ? e.metric : DEFAULTS.econ.metric;
  const base = ECON_TYPE_LABELS[type] || type;
  let tail;
  if (type === "scatter") {
    const c = pearson(rowsAll, e.x, e.y);
    const size = (e.size && e.size !== "none" && ECON_METRICS[e.size]) ? ECON_METRICS[e.size].label : null;
    tail = `${ECON_METRICS[e.x].label} × ${ECON_METRICS[e.y].label}`
      + (size ? ` · bubble = ${size}` : "")
      + ` · Pearson r = ${fmtR(c.r)} · n = ${c.n} · colour = mode`;
  } else if (type === "matrix") tail = `${rowsAll.length} lines · colour = Pearson r`;
  else if (type === "rank") tail = `${ECON_METRICS[key].label} — ${econRankAsc(key) ? "lowest" : "highest"} first · colour = line`;
  else if (type === "cargo") tail = `used (blue) vs capacity (grey)`;
  else if (type === "donut") tail = `${ECON_METRICS[key].label} · colour = mode`;
  else if (type === "flows") {
    tail = `items delivered last year · colour = cargo`
      + (data && data.econ && data.econ.year != null ? ` · year ${fmt(data.econ.year)}` : "");
  } else tail = `${ECON_METRICS[key].label} · colour = line`;
  if (!e.values && (type === "bar" || type === "cargo" || type === "rank" || type === "flows" || type === "donut")) tail += " · value labels off";
  return `${base} · ${tail}`;
}
function renderEcon() {
  if (!econOpen) return;
  if (!data) {                     // opened before an export was loaded
    const k = $("#econKpis"); if (k) k.innerHTML = "";
    const w = $("#econTableWrap"); if (w) w.classList.add("hidden");
    const e = $("#econEmpty");
    if (e) { e.textContent = "Load a map export first — it carries the lines and their statistics."; e.classList.remove("hidden"); }
    const s = $("#econSub"); if (s) s.textContent = "no map loaded";
    return;
  }
  econSyncControls();
  const rowsAll = econRows(false);
  let rowsChart = econRows(true);
  const e = settings.econ;
  /* "All rows" on 100+ lines cannot be labelled legibly: cap the chart and say
     so in the title; the table below still lists every line. */
  let capNote = "";
  if ((e.type === "bar" || e.type === "cargo" || e.type === "rank") && Number(e.limit) === 0 && rowsChart.length > 60) {
    capNote = ` · showing first 60 of ${fmt(rowsAll.length)}`;
    rowsChart = rowsChart.slice(0, 60);
  }
  renderEconKpis(rowsAll);
  renderEconTable(rowsAll);
  const ta = $("#econTitle");
  if (ta) ta.textContent = econChartTitle(rowsAll) + capNote;
  /* scatter and matrix reason about every matching line; the list charts honour the row limit */
  const rowsFor = (e.type === "scatter" || e.type === "matrix") ? rowsAll : rowsChart;
  econHits = drawEconChart($("#econChart"), rowsFor, econHits);
  const sub = $("#econSub");
  if (sub) {
    sub.textContent = `${fmt(rowsAll.length)} of ${fmt(data.lines.length)} lines`
      + (data.econ && data.econ.year != null ? ` · year ${fmt(data.econ.year)}` : "");
  }
  const sl = selectedLine(), sel = $("#econSel");
  if (sel) sel.textContent = sl ? `Selected: ${sl.label}` : "No line selected";
  const sm = $("#econShowMap");
  if (sm) { sm.disabled = !sl; sm.title = sl ? "Close this panel and centre the map on the selected line" : "Select a line first"; }
  const hint = $("#econHint");
  if (hint) hint.textContent = (econQuery || e.onlyData || settings.lineModeOff.length)
    ? "Filters are active — list and charts only show matching lines." : "";
  const fb = $("#econFilter");
  if (fb && fb.value !== econQuery) fb.value = econQuery;
}
let econPrevFocus = null;
function openEcon() {
  const box = $("#econ");
  if (!box) return false;
  econOpen = true;
  econPrevFocus = document.activeElement;
  box.classList.add("on");
  box.setAttribute("aria-hidden", "false");
  renderEcon();
  requestAnimationFrame(() => { const c = $("#econClose"); if (c && c.focus) c.focus(); });
  return true;
}
function closeEcon() {
  if (!econOpen) return false;
  econOpen = false;
  const box = $("#econ");
  if (box) { box.classList.remove("on"); box.setAttribute("aria-hidden", "true"); }
  if (econPrevFocus && econPrevFocus.focus) { try { econPrevFocus.focus(); } catch {} }
  econPrevFocus = null;
  return true;
}
function isEconOpen() { return econOpen; }
function setEcon(key, el) {
  const e = settings.econ;
  if (!(key in e)) return;
  let v = el.type === "checkbox" ? el.checked : el.value;
  if (key === "limit") v = Number(v);
  if (e[key] === v) return;
  e[key] = v;
  persist();
  renderEcon();
}
/* --- chart interaction: hover a bubble / cell, click to select or explore --- */
function econTipLines(h) {
  if (!h) return [];
  if (h.kind === "cell") {
    const out = [`${ECON_METRICS[h.xk].label} × ${ECON_METRICS[h.yk].label}`];
    out.push(h.i === h.j ? `${h.n} lines with data` : `r = ${fmtR(h.r)} · n = ${h.n}`);
    if (h.i !== h.j && h.r == null) out.push(h.n < 3 ? "needs 3+ lines with both values" : "no variation to correlate");
    else if (h.i !== h.j) out.push("click to open as a scatter");
    return out;
  }
  const out = [h.line.label];
  out.push(`${ECON_METRICS[h.xk].label}: ${metricText(h.line, h.xk)}`);
  out.push(`${ECON_METRICS[h.yk].label}: ${metricText(h.line, h.yk)}`);
  if (h.sk && h.sk !== "none" && ECON_METRICS[h.sk]) out.push(`${ECON_METRICS[h.sk].label}: ${metricText(h.line, h.sk)}`);
  return out;
}
function econPick(x, y) {
  for (const p of econHits.points) {
    const dx = p.x - x, dy = p.y - y;
    if (dx * dx + dy * dy <= (p.r + 4) * (p.r + 4)) return Object.assign({ kind: "point" }, p);
  }
  for (const c of econHits.cells) {
    if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return Object.assign({ kind: "cell" }, c);
  }
  return null;
}
function econHoverKey(h) {
  if (!h) return "";
  return `${h.kind}|${h.line ? h.line.id : h.xk + ">" + h.yk}`;
}
/* the interactive correlation explorer: a matrix cell opens as a scatter of that pair */
function econExplore(xk, yk) {
  if (!SCATTER_METRICS.includes(xk) || !SCATTER_METRICS.includes(yk)) return false;
  const e = settings.econ;
  e.x = xk; e.y = yk; e.type = "scatter";
  persist();
  renderEcon();
  return true;
}
function wireEconChart() {
  const c = $("#econChart");
  if (!c || !c.addEventListener) return;
  const at = e => {
    const r = (c.getBoundingClientRect && c.getBoundingClientRect()) || { left: 0, top: 0 };
    return {
      x: e.clientX != null ? e.clientX - r.left : (e.offsetX || 0),
      y: e.clientY != null ? e.clientY - r.top : (e.offsetY || 0),
    };
  };
  c.addEventListener("mousemove", e => {
    const pt = at(e), hit = econPick(pt.x, pt.y);
    if (econHoverKey(hit) !== econHoverKey(econHover)) { econHover = hit; renderEcon(); }
  });
  c.addEventListener("mouseleave", () => { if (econHover) { econHover = null; renderEcon(); } });
  c.addEventListener("click", e => {
    const pt = at(e), hit = econPick(pt.x, pt.y);
    if (!hit) return;
    if (hit.kind === "point" && hit.line) { selectLine(hit.line.id); renderEcon(); }
    else if (hit.kind === "cell") econExplore(hit.xk, hit.yk);
  });
}
wireEconChart();
/* the Analytics dialog traps Tab and restores focus on close (finding 47) */
document.addEventListener("keydown", e => {
  if (!econOpen || e.key !== "Tab") return;
  const box = $("#econ");
  if (!box) return;
  const f = $$("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])", box)
    .filter(el => !el.disabled && el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
/* save the current chart as a PNG (cargo / matrix / flows have no table form) */
$("#econChartPng").addEventListener("click", () => {
  const c = $("#econChart");
  if (!c || !c.toBlob) return;
  c.toBlob(blob => {
    if (!blob) { toast("Chart export failed", "err"); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `north-map-chart-${Math.round(performance.now())}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Saved " + a.download, "ok");
  }, "image/png");
});
function econSortBy(key) {
  const e = settings.econ;
  if (!ECON_METRICS[key] && !ECON_TEXT_SORTS.includes(key)) return;
  if (e.sort === key) e.dir = e.dir === "desc" ? "asc" : "desc";
  else { e.sort = key; e.dir = (ECON_TEXT_SORTS.includes(key) || ECON_LOWER_BETTER.has(key)) ? "asc" : "desc"; }
  persist();
  renderEcon();
}
$("#econBtn").addEventListener("click", () => { if (econOpen) closeEcon(); else openEcon(); });
$("#econClose").addEventListener("click", closeEcon);
$("#econFilter").addEventListener("input", e => { econQuery = String(e.target.value || "").trim().toLowerCase(); renderEcon(); });
$("#econFilter").addEventListener("keydown", e => {
  if (e.key === "Escape") { e.target.value = ""; econQuery = ""; renderEcon(); if (e.stopPropagation) e.stopPropagation(); }
});
window.addEventListener("resize", () => { if (econOpen) renderEcon(); });
$("#econTableBody").addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
  const tr = e.target.closest("tr[data-econline]");
  if (!tr) return;
  e.preventDefault();
  selectLine(Number(tr.dataset.econline)); renderEcon();
});

