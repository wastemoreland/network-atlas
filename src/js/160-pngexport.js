/* ---------------- PNG export ---------------- */
function exportPng(mode) {
  if (!data) { toast("Load a map first", "err"); return; }
  /* a pitched view exports the 3D relief */
  if (mode !== "full" && (+settings.pitch || 0) > 0 && settings.lineView !== "lines" && init3D()) {
    if (exportPng3D()) return;
  }
  try {
    let w, h, vp;
    if (mode === "full") {
      w = Number(settings.exportSize) || 2048;
      h = Math.max(1, Math.round(w * data.world.height / data.world.width));
      vp = { scale: w / data.world.width, ox: 0, oy: 0, w, h, dpr: 1 };
    } else {
      w = Math.round(stageW * 2); h = Math.round(stageH * 2);
      vp = { scale: view.scale * 2, ox: view.x * 2, oy: view.y * 2, w, h, dpr: 1 };
    }
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const g = out.getContext("2d");
    /* The whole-map export is always flat and north-up: force the camera for the
       duration of the draw, whatever the user currently has on screen. */
    const sp = settings.pitch, sb = settings.bearing;
    if (mode === "full") { settings.pitch = 0; settings.bearing = 0; }
    try { drawScene(g, vp); }
    finally { if (mode === "full") { settings.pitch = sp; settings.bearing = sb; } }
    out.toBlob(blob => {
      if (!blob) { toast("PNG export failed", "err"); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `north-map-${mode === "full" ? "full" : "view"}-${Math.round(performance.now())}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast("Saved " + a.download, "ok");
    }, "image/png");
  } catch (e) { console.error(e); toast("PNG export failed: " + e.message, "err"); }
}

/* Render the live tilted camera into an offscreen PNG. The whole 3D pipeline is
   driven by the module-level view/stage globals, so the export temporarily scales
   them (and the WebGL buffers) to 2x, draws terrain + draped overlays into one
   canvas, and restores everything before yielding. */
function exportPng3D() {
  if (!data || !gl3d || !gl3d.ok) return false;
  const K = 2;
  const old = {
    stageW, stageH, dpr,
    view: { scale: view.scale, x: view.x, y: view.y },
    glW: GL_CANVAS.width, glH: GL_CANVAS.height,
  };
  let out = null;
  try {
    stageW = Math.max(1, Math.round(old.stageW * K));
    stageH = Math.max(1, Math.round(old.stageH * K));
    dpr = 1;
    view.scale = old.view.scale * K;
    view.x = old.view.x * K;
    view.y = old.view.y * K;

    GL_CANVAS.width = stageW; GL_CANVAS.height = stageH;
    gl3d.mesh = null; drape3d = null;
    gl3d.gl.viewport(0, 0, stageW, stageH);
    resizeDepthFBO();

    const vp = { scale: view.scale, ox: view.x, oy: view.y, w: stageW, h: stageH, dpr: 1, live: true };
    renderTerrain3D(vp);
    if (!cam3d || !cam3d.active || !gl3d.mesh) return false;

    /* overlays on a transparent layer, then composite over the terrain */
    const overlay = document.createElement("canvas");
    overlay.width = stageW; overlay.height = stageH;
    drawScene3D(overlay.getContext("2d"), vp);

    out = document.createElement("canvas");
    out.width = stageW; out.height = stageH;
    const g = out.getContext("2d");
    g.fillStyle = curStyle().bg;
    g.fillRect(0, 0, stageW, stageH);
    g.globalAlpha = clamp(settings.terrainOpacity, 0, 1);
    g.drawImage(GL_CANVAS, 0, 0, stageW, stageH);
    g.globalAlpha = 1;
    g.drawImage(overlay, 0, 0);
  } catch (e) {
    console.error(e);
    toast("3D export failed: " + e.message, "err");
    return false;
  } finally {
    stageW = old.stageW; stageH = old.stageH; dpr = old.dpr;
    view.scale = old.view.scale; view.x = old.view.x; view.y = old.view.y;
    GL_CANVAS.width = old.glW; GL_CANVAS.height = old.glH;
    gl3d.mesh = null; drape3d = null;
    if (gl3d && gl3d.ok) resize3D();
    requestRender();
  }
  if (!out) return false;
  out.toBlob(blob => {
    if (!blob) { toast("3D export failed", "err"); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `north-map-3d-${Math.round(performance.now())}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Saved " + a.download, "ok");
  }, "image/png");
  return true;
}

/* ---------------- misc UI ---------------- */
function toast(msg, kind) {
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .4s"; }, 3400);
  setTimeout(() => el.remove(), 3900);
}
function hideWelcome() { $("#welcome").setAttribute("hidden", ""); }
function showWelcome() { $("#welcome").removeAttribute("hidden"); }
let hintHidden = false;
function hideHint() { if (!hintHidden) { hintHidden = true; $("#hint").classList.add("off"); setTimeout(() => $("#hint").classList.add("hidden"), 700); } }

