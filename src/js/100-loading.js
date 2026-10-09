/* ============================================================
   Rebuild scheduling
   ============================================================ */
const rebuildTimers = {};
let busyCount = 0;
function scheduleRebuild(kind, delay = 140) {
  if (!data) return;
  clearTimeout(rebuildTimers[kind]);
  rebuildTimers[kind] = setTimeout(() => runRebuild(kind), delay);
}
async function runRebuild(kind) {
  if (!data) return;
  const id = ++busyCount;
  try {
    if (kind === "terrain") {
      setBusy(0.02, "Rendering terrain…");
      await buildTerrain(p => { if (id === busyCount) setBusy(p, "Rendering terrain…"); });
      contourPaths = null;
      buildContoursIfVisible();
      setBusy(null);
    } else if (kind === "contours") {
      if (!settings.layers.contours) { contourPaths = null; setBusy(null); return; }
      setBusy(0.2, "Building contours…"); await yieldUI();
      buildContours(); setBusy(null);
    }
  } catch (e) {
    console.error(e); setBusy(null); toast("Render failed: " + e.message, "err");
  }
  refreshLive();
  requestRender();
}
function buildContoursIfVisible() {
  if (settings.layers.contours && !contourPaths) buildContours();
}

function setBusy(pct, label) {
  const el = $("#busy");
  if (pct === null) { el.classList.remove("on"); $("#busyBar").style.width = "0%"; if (loadInfo) setStatusFromData(); return; }
  el.classList.add("on");
  $("#busyBar").style.width = Math.round(clamp(pct, 0, 1) * 100) + "%";
  if (label) $("#status").textContent = label;
}

/* ============================================================
   Loading
   ============================================================ */
async function loadFrom(name, reader, bytes) {
  const t0 = performance.now();
  try {
    setBusy(0.02, "Reading " + name + "…");
    const text = await reader();
    setBusy(0.1, "Parsing export…");
    const parsed = await parseExport(text, p => setBusy(0.1 + p * 0.75, "Parsing export… " + Math.round(p * 100) + "%"));
    setBusy(0.9, "Preparing layers…");
    await yieldUI();
    ingest(parsed, name, bytes);
    loadInfo = { name, bytes, parseMs: Math.round(performance.now() - t0) };
    await rebuildAll();
    fit(false);
    hideWelcome();
    setStatusFromData();
    refreshGenerated(true);
    syncControls();
    setBusy(null);
    toast("Loaded " + name, "ok");
    $("#fileChip").classList.remove("hidden");
    $("#fileChip").textContent = name + (bytes ? " · " + (bytes / 1048576).toFixed(1) + " MB" : "");
    $("#fileChip").title = name;
    return true;
  } catch (e) {
    console.error(e);
    setBusy(null);
    toast("Could not load export: " + e.message, "err");
    $("#status").textContent = "Error: " + e.message;
    return false;
  }
}
async function rebuildAll() {
  const chain = [];
  if (settings.layers.terrain) {
    setBusy(0.9, "Rendering terrain…");
    await buildTerrain(p => setBusy(0.9 + p * 0.09, "Rendering terrain…"));
  }
  if (settings.layers.contours) { setBusy(0.99, "Contours…"); await yieldUI(); buildContours(); }
  return Promise.all(chain);
}
function setStatusFromData() {
  if (!data) return;
  const lenKm = data.stats.roadLen / 1000;
  const total = data.lines.length;
  const lineTxt = total ? `${fmt(visibleLines().length)} of ${fmt(total)} lines shown` : "0 lines";
  $("#status").textContent =
    `${fmt(data.roads.length)} road segments (${fmt(lenKm, 1)} km) · ${data.towns.length} towns · ${data.industries.length} industries · ${lineTxt} · parsed in ${loadInfo ? loadInfo.parseMs : "?"} ms`;
}
function loadFile(file) {
  return loadFrom(file.name, () => file.text(), file.size);
}
async function loadUrl(url) {
  const name = decodeURIComponent(url.split("/").pop() || "network_atlas_export.lua");
  let bytes = 0;
  const reader = async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    bytes = Number(res.headers.get("content-length")) || 0;
    return res.text();
  };
  return loadFrom(name, reader, bytes);
}

/* file input / buttons */
$("#file").addEventListener("change", e => {
  const f = e.target.files && e.target.files[0];
  if (f) loadFile(f);
  e.target.value = "";
});
const pickFile = () => $("#file").click();
$("#openBtn").addEventListener("click", pickFile);
$("#wOpen").addEventListener("click", pickFile);
$("#fitBtn").addEventListener("click", () => fit(true));
$("#pngView").addEventListener("click", () => exportPng("view"));
$("#pngFull").addEventListener("click", () => exportPng("full"));

/* In-app picker when a folder holds several exports (replaces window.prompt). */
function chooseEntry(list) {
  return new Promise(resolve => {
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = `<div class="wcard" style="text-align:left"><h2>Choose an export</h2>
      <p>${list.length} Lua files found in that folder.</p><div class="flist"></div></div>`;
    const host = ov.querySelector(".flist");
    host.innerHTML = list.map((f, i) =>
      `<button class="btn" data-fi="${i}" title="${esc(f.path)}">${esc(f.path)}</button>`).join("");
    document.body.appendChild(ov);
    let done = false;
    const finish = v => { if (done) return; done = true; ov.remove(); document.removeEventListener("keydown", onKey, true); resolve(v); };
    const onKey = e => { if (e.key === "Escape") { e.preventDefault(); finish(null); } };
    ov.addEventListener("click", e => {
      const b = e.target.closest("[data-fi]");
      if (b) { finish(list[+b.dataset.fi]); return; }
      if (e.target === ov) finish(null);
    });
    document.addEventListener("keydown", onKey, true);
    const first = host.querySelector("button");
    if (first && first.focus) first.focus();
  });
}

/* folder picker (Chromium) — lets you point at the game userdata folder */
async function openFolder() {
  if (!window.showDirectoryPicker) { toast("Folder picker needs Chrome/Edge — use “Open export…” instead", "err"); pickFile(); return; }
  try {
    const dir = await window.showDirectoryPicker({ mode: "read" });
    const found = [];
    await scanDir(dir, "", found, 0);
    const maps = found.filter(f => /map/i.test(f.path));
    const list = maps.length ? maps : found;
    if (!list.length) { toast("No .lua exports found in that folder", "err"); return; }
    if (list.length === 1) { await openEntry(list[0]); return; }
    const chosen = await chooseEntry(list);
    if (chosen) await openEntry(chosen);
  } catch (e) {
    if (e && e.name === "AbortError") return;
    toast("Folder open failed: " + e.message, "err");
  }
}
async function scanDir(handle, base, out, depth) {
  if (depth > 3 || out.length > 40) return;
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind === "file" && /\.lua$/i.test(name)) out.push({ entry, path: base + name });
    else if (entry.kind === "directory" && out.length <= 40 && name !== "shader_cache") await scanDir(entry, base + name + "/", out, depth + 1);
  }
}
async function openEntry(item) {
  const file = await item.entry.getFile();
  try { await saveHandle(item.entry, item.path); } catch {}
  await loadFile(file);
}
$("#folderBtn").addEventListener("click", openFolder);
$("#wFolder").addEventListener("click", openFolder);

/* remember the last opened handle so a save can be re-opened quickly */
let lastHandle = null;
function idbOpen() {
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error("no idb"));
    const rq = indexedDB.open("networkAtlas", 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore("handles");
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function saveHandle(handle, path) {
  const db = await idbOpen();
  await new Promise((res, rej) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put({ handle, path, at: Date.now() }, "last");
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
async function loadHandle() {
  try {
    const db = await idbOpen();
    const rec = await new Promise((res, rej) => {
      const rq = db.transaction("handles").objectStore("handles").get("last");
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
    if (rec && rec.handle) return rec;
  } catch {}
  return null;
}
async function reopenLast() {
  const rec = await loadHandle();
  if (!rec) return;
  try {
    const perm = await rec.handle.queryPermission({ mode: "read" });
    if (perm !== "granted") {
      const ok = await rec.handle.requestPermission({ mode: "read" });
      if (ok !== "granted") throw new Error("permission denied");
    }
    const file = await rec.handle.getFile();
    await loadFile(file);
  } catch (e) { toast("Could not reopen: " + e.message, "err"); }
}
$("#wReopen").addEventListener("click", reopenLast);

/* drag & drop anywhere */
let dragDepth = 0;
window.addEventListener("dragenter", e => {
  e.preventDefault(); dragDepth++;
  $("#dropOverlay").classList.add("on");
  $("#dropZone").classList.add("hot");
});
window.addEventListener("dragleave", e => {
  e.preventDefault();
  if (--dragDepth <= 0) { dragDepth = 0; $("#dropOverlay").classList.remove("on"); $("#dropZone").classList.remove("hot"); }
});
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => {
  e.preventDefault(); dragDepth = 0;
  $("#dropOverlay").classList.remove("on");
  $("#dropZone").classList.remove("hot");
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadFile(f);
});

/* ============================================================
   Map interaction — pan / zoom (Google-Maps style)
   ============================================================ */
const pointers = new Map();
let drag = null, pinch = null, velocity = null, momentumRAF = 0, moved = 0;
/* right-drag (or shift + left-drag) spins the compass and tips the camera */
let tiltDrag = null;

function evtPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
/* write the camera in one go so a drag only triggers one settings pass */
function setTilt(bearing, pitch) {
  const b = normBearing(bearing), p = clamp(+pitch || 0, 0, TILT_MAX);
  let changed = false;
  if (settings.bearing !== b) { settings.bearing = b; changed = true; }
  if (settings.pitch !== p) { settings.pitch = p; changed = true; }
  if (changed) onSettingsChanged("pitch");
}
canvas.addEventListener("pointerdown", e => {
  if (!data) return;
  const p = evtPos(e);
  if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
    cancelAnim(); stopMomentum();
    tiltDrag = { id: e.pointerId, x: p.x, y: p.y, bearing: +settings.bearing || 0, pitch: +settings.pitch || 0 };
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    canvas.classList.add("dragging");
    hideHint();
    return;
  }
  cancelAnim(); stopMomentum();
  pointers.set(e.pointerId, p);
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  if (pointers.size === 1) {
    drag = { x: p.x, y: p.y, vx: p.y, ox: view.x, oy: view.y, t: performance.now(), lastT: performance.now(), lx: p.x, ly: p.y };
    velocity = { x: 0, y: 0 };
    moved = 0;
    canvas.classList.add("dragging");
    hideHint();
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const c = tiltActive() ? untilePt((a.x + b.x) / 2, (a.y + b.y) / 2, stageW / 2, stageH / 2) : [(a.x + b.x) / 2, (a.y + b.y) / 2];
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: c[0], cy: c[1], scale: view.scale, ox: view.x, oy: view.y };
    drag = null;
  }
});
canvas.addEventListener("pointermove", e => {
  const p = evtPos(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);

  if (tiltDrag && e.pointerId === tiltDrag.id) {
    /* dx turns the compass (0.3°/px), dy tips the camera up / flat */
    const dx = p.x - tiltDrag.x, dy = p.y - tiltDrag.y;
    setTilt(tiltDrag.bearing + dx * 0.3, tiltDrag.pitch - dy * 0.3);
    return;
  }
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const c = tiltActive() ? untilePt((a.x + b.x) / 2, (a.y + b.y) / 2, stageW / 2, stageH / 2) : [(a.x + b.x) / 2, (a.y + b.y) / 2];
    const cx = c[0], cy = c[1];
    const k = clamp(dist / Math.max(1, pinch.dist), 0.05, 20);
    const target = clamp(pinch.scale * k, limits().min, limits().max);
    const s = target / pinch.scale;
    view.scale = target;
    view.x = cx - (pinch.cx - pinch.ox) * s;
    view.y = cy - (pinch.cy - pinch.oy) * s;
    clampView(); requestRender();
    return;
  }
  if (drag && pointers.size === 1) {
    const dx = p.x - drag.x, dy = p.y - drag.y;
    moved += Math.abs(dx) + Math.abs(dy);
    /* the drag is a screen-space gesture: undo the tilt so the point under
       the finger is exactly the point that moves */
    const dd = tiltActive() ? untileVec(dx, dy) : [dx, dy];
    view.x = drag.ox + dd[0];
    view.y = drag.oy + dd[1];
    const now = performance.now();
    const dt = Math.max(16, now - drag.lastT);
    const vd = (p.x - drag.lx) / dt * 16, vy = (p.y - drag.ly) / dt * 16;
    const vv = tiltActive() ? untileVec(vd, vy) : [vd, vy];
    velocity.x = vv[0];
    velocity.y = vv[1];
    drag.lastT = now; drag.lx = p.x; drag.ly = p.y;
    clampView(); requestRender();
    return;
  }
  updateHover(p);
});
function endPointer(e) {
  const had = pointers.has(e.pointerId);
  pointers.delete(e.pointerId);
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
  if (tiltDrag && e.pointerId === tiltDrag.id) {
    tiltDrag = null;
    canvas.classList.remove("dragging");
    return;
  }
  if (pinch && pointers.size < 2) {
    pinch = null;
    const [a] = [...pointers.values()];
    if (a) {
      drag = { x: a.x, y: a.y, vx: a.y, ox: view.x, oy: view.y, t: performance.now(), lastT: performance.now(), lx: a.x, ly: a.y };
      velocity = { x: 0, y: 0 };
      moved = Math.max(moved, 8);   // finished a pinch, not a click
    } else settle();
  } else if (drag && pointers.size === 0) {
    canvas.classList.remove("dragging");
    if (moved < 6 && had) {
      handleClick(evtPos(e));
      drag = null;
    } else {
      drag = null;
      startMomentum();
    }
  }
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
/* no browser menu on the map: right-drag belongs to the tilt gesture */
canvas.addEventListener("contextmenu", e => { if (e && e.preventDefault) e.preventDefault(); });

function startMomentum() {
  if (!velocity || !data) return;
  const sw = data.world.width * view.scale, sh = data.world.height * view.scale;
  const freeX = sw > stageW, freeY = sh > stageH;
  if (!freeX && !freeY) { settle(); return; }   // whole map on screen: nothing to fling
  const v = { x: freeX ? clamp(velocity.x, -48, 48) : 0, y: freeY ? clamp(velocity.y, -48, 48) : 0 };
  if (Math.hypot(v.x, v.y) < 1.2) { settle(); return; }
  const step = () => {
    v.x *= 0.92; v.y *= 0.92;
    view.x += v.x; view.y += v.y;
    clampView(); requestRender();
    if (Math.hypot(v.x, v.y) > 0.35) momentumRAF = requestAnimationFrame(step);
    else { momentumRAF = 0; settle(); }
  };
  cancelAnimationFrame(momentumRAF);
  momentumRAF = requestAnimationFrame(step);
}
function stopMomentum() { if (momentumRAF) { cancelAnimationFrame(momentumRAF); momentumRAF = 0; } }

canvas.addEventListener("wheel", e => {
  if (!data) return;
  e.preventDefault();
  cancelAnim(); stopMomentum();
  const p = evtPos(e);
  let factor;
  if (e.deltaMode === 1) factor = Math.pow(1.15, e.deltaY);        // lines
  else if (e.deltaMode === 2) factor = e.deltaY > 0 ? 0.5 : 2;      // pages
  else factor = Math.exp(-e.deltaY * 0.0022);                        // pixels
  zoomBy(clamp(factor, 0.2, 5), p.x, p.y, false);
  hideHint();
}, { passive: false });

canvas.addEventListener("dblclick", e => {
  if (!data) return;
  const p = evtPos(e);
  zoomBy(2, p.x, p.y, true);
});
$("#zoomIn").addEventListener("click", () => zoomBy(1.7, undefined, undefined, true));
$("#zoomOut").addEventListener("click", () => zoomBy(1 / 1.7, undefined, undefined, true));
$("#zoomFit").addEventListener("click", () => fit(true));

window.addEventListener("keydown", e => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") {
    if (e.key === "Escape") e.target.blur();
    return;
  }
  if (!data) return;
  const pan = 90;
  let handled = true;
  const panBy = (dx, dy) => {
    const u = tiltActive() ? untileVec(dx, dy) : [dx, dy];
    view.x += u[0]; view.y += u[1];
  };
  switch (e.key) {
    case "ArrowLeft": panBy(pan, 0); break;
    case "ArrowRight": panBy(-pan, 0); break;
    case "ArrowUp": panBy(0, pan); break;
    case "ArrowDown": panBy(0, -pan); break;
    case "+": case "=": zoomBy(1.6, undefined, undefined, true); break;
    case "-": case "_": zoomBy(1 / 1.6, undefined, undefined, true); break;
    case "0": case "Home": fit(true); break;
    case "Escape": if (closeEcon()) break; closeInfo(); hideSearch(); break;
    default: handled = false;
  }
  if (handled) { e.preventDefault(); cancelAnim(); clampView(); requestRender(); hideHint(); }
});

