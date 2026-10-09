/* ============================================================
   Search
   ============================================================ */
let searchItems = [];
function runSearch(q) {
  const box = $("#searchResults");
  q = q.trim();
  if (!q) { box.classList.remove("on"); box.innerHTML = ""; return; }
  const coord = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(q);
  const out = [];
  if (coord && data) {
    out.push({ icon: icon("target"), title: `${coord[1]}, ${coord[2]}`, sub: "Go to coordinates", act: () => flyTo(+coord[1], +coord[2]) });
  }
  if (data) {
    const ql = q.toLowerCase();
    for (const l of data.lines) {
      if (out.length > 10) break;
      if (l.search.includes(ql))
        out.push({
          icon: icon("train"), title: l.label,
          sub: `Line · ${modesOf(l).length ? modesOf(l).join(", ") : "mode —"} · ${l.stops == null ? "—" : stopsOf(l).length} stops`,
          act: () => { hideSearch(); selectLine(l.id, { fly: true }); },
        });
    }
    for (const t of data.towns) if (t.name.toLowerCase().includes(ql))
      out.push({ icon: icon("pin"), title: t.name, sub: `Town · ${fmt(t.x)}, ${fmt(t.y)}`, act: () => selectAndFly("town", t) });
    const seen = new Set();
    for (const it of data.industries) {
      if (seen.has(it.tag)) continue;
      if (prettyIndustry(it.tag).toLowerCase().includes(ql) || it.tag.includes(ql)) {
        seen.add(it.tag);
        const count = data.industries.filter(x => x.tag === it.tag).length;
        out.push({ icon: icon("factory"), title: prettyIndustry(it.tag), sub: `${count} site${count > 1 ? "s" : ""} · filter to these`, act: () => isolateIndustry(it.tag) });
      }
    }
    for (const t of data.templates) {
      if (out.length > 12) break;
      if (t.label.toLowerCase().includes(ql) || t.cat.includes(ql))
        out.push({ icon: icon("road"), title: t.label, sub: `${ROAD_CATS[t.cat].label} · ${t.count} segments`, act: () => isolateTemplate(t.tpl) });
    }
  }
  searchItems = out.slice(0, 8);
  box.innerHTML = searchItems.map((s, i) =>
    `<div class="sres" data-i="${i}" tabindex="0" role="button"><div class="ico">${s.icon}</div><div><b>${esc(s.title)}</b><small>${esc(s.sub)}</small></div></div>`
  ).join("") || `<div class="sres"><div><small>No matches</small></div></div>`;
  box.classList.add("on");
}
function flyTo(wx, wy) {
  if (!data) return;
  const scale = Math.max(view.scale, Math.min(limits().max, Math.max(fitScale() * 8, 1.2)));
  const target = { scale, x: stageW / 2 - (wx - data.world.minX) * scale, y: stageH / 2 - (data.world.maxY - wy) * scale };
  pin = { x: wx, y: wy, pulse: true };
  animateView(target, 650);
  setTimeout(() => { pin = null; requestRender(); }, 6000);
}
function selectAndFly(kind, item) {
  showInfo({ kind, item });
  flyTo(item.x, item.y);
  hideSearch();
}
function isolateIndustry(tag) {
  settings.indOff = data.industries.map(i => i.tag).filter(t => t !== tag);
  settings.layers.industries = true;
  onSettingsChanged("indOff");
  syncControls(); refreshGenerated();
  const first = data.industries.find(i => i.tag === tag);
  if (first) flyTo(first.x, first.y);
  hideSearch();
}
function isolateTemplate(tpl) {
  settings.roadOff = data.templates.map(t => t.tpl).filter(t => t !== tpl);
  settings.roadCatsOff = [];
  settings.layers.roads = true;
  onSettingsChanged("roadOff");
  syncControls(); refreshGenerated();
  const meta = data.templates.find(t => t.tpl === tpl);
  if (meta) {
    const rs = data.roads.filter(r => r.tpl === tpl);
    const cx = rs.reduce((s, r) => s + r.x0 + r.x1, 0) / (rs.length * 2 || 1);
    const cy = rs.reduce((s, r) => s + r.y0 + r.y1, 0) / (rs.length * 2 || 1);
    flyTo(cx, cy);
  }
  hideSearch();
}
function hideSearch() { $("#searchResults").classList.remove("on"); }
$("#searchBox").addEventListener("input", e => runSearch(e.target.value));
/* "/" jumps to the search box — the one shortcut people expect from a map app */
document.addEventListener("keydown", e => {
  const tag = e.target && e.target.tagName;
  if (e.key !== "/" || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  if (e.preventDefault) e.preventDefault();
  const box = $("#searchBox");
  box.focus();
  if (box.select) box.select();
});
$("#searchBox").addEventListener("focus", e => { if (e.target.value) runSearch(e.target.value); });
$("#searchResults").addEventListener("click", e => {
  const el = e.target.closest(".sres");
  if (!el || !searchItems[+el.dataset.i]) return;
  searchItems[+el.dataset.i].act();
});
$("#searchResults").addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
  const el = e.target.closest(".sres");
  if (!el || !searchItems[+el.dataset.i]) return;
  e.preventDefault();
  searchItems[+el.dataset.i].act();
});
document.addEventListener("click", e => {
  if (!e.target.closest("#search")) hideSearch();
});

