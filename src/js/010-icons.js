/* ---------------- tiny inline icon set ----------------
   Hand-built 24×24 stroke glyphs in the Lucide/Feather style (ISC / MIT family),
   embedded as path data so the viewer stays a single file with no CDN, no
   bundler and no image requests. Circular / rounded forms on purpose. */
const ICONS = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  x: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  map: '<path d="M9 4.5 3.5 7v13L9 18.5l6 2.5 5.5-2.5v-13L15 7Z"/><path d="M9 4.5v14M15 7v14"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2.5h8.5A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18Z"/>',
  file: '<path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5Z"/><path d="M14 3v4.5h4.5"/><path d="M8.5 13.5h7M8.5 17h5"/>',
  download: '<path d="M12 4v10"/><path d="m8 10.5 4 4 4-4"/><path d="M4.5 17v2A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-2"/>',
  chart: '<path d="M3.5 20.5h17"/><path d="M7 20.5v-6"/><path d="M12 20.5V7.5"/><path d="M17 20.5v-9"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10.5" r="1.6"/><path d="m5 17 4.5-4 3.5 3 3-2.5 3.5 3.5"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17 2.2 2.2 0 0 0 0-4.4H10a1.8 1.8 0 0 1 0-3.6h4.4A4.6 4.6 0 0 0 19 7.9C19 5.4 15.9 3.5 12 3.5Z"/><circle cx="7.8" cy="10.2" r="1"/><circle cx="10.4" cy="7.2" r="1"/><circle cx="14.6" cy="7.4" r="1"/>',
  layers: '<path d="m12 3.5 8 4.3-8 4.3-8-4.3Z"/><path d="m4 12.2 8 4.3 8-4.3"/><path d="m4 16.6 8 4.3 8-4.3"/>',
  mountain: '<path d="m2.5 19.5 6.2-9.7 3.4 5.1 2.4-3.4 7 8Z"/><circle cx="17" cy="6.5" r="2"/>',
  contour: '<path d="M2.5 18.5c3.5-1.4 5.5-4.5 9.5-4.5s6 3.1 9.5 4.5"/><path d="M4.5 13.6c3-1.1 4.7-3.6 7.5-3.6s4.5 2.5 7.5 3.6"/><path d="M7 9c2-.8 3.2-2.5 5-2.5s3 1.7 5 2.5"/>',
  road: '<path d="M6.5 21 10 3"/><path d="M17.5 21 14 3"/><path d="M12 6.5v3M12 12v3M12 17.5v3"/>',
  town: '<path d="M3 21V8.5A1.5 1.5 0 0 1 4.5 7H10A1.5 1.5 0 0 1 11.5 8.5V21"/><path d="M11.5 12H17a1.5 1.5 0 0 1 1.5 1.5V21"/><path d="M2.5 21h19"/><path d="M6 11h1.5M6 15h1.5M14.5 16H16"/>',
  pin: '<path d="M12 21s6.5-5.7 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15.3 12 21 12 21Z"/><circle cx="12" cy="10.5" r="2.4"/>',
  factory: '<path d="M2.5 21V10.5l6 4v-4l6 4V6.5A1.5 1.5 0 0 1 16 5h4.5A1.5 1.5 0 0 1 22 6.5V21Z"/><path d="M2.5 21h20"/><path d="M6 17.5h1.5M11 17.5h1.5M16 17.5h1.5"/>',
  train: '<rect x="5" y="3.5" width="14" height="12.5" rx="3.2"/><path d="M5 11h14"/><path d="M8.8 19.5 11 16M15.2 19.5 13 16"/><path d="M9.3 13.8h.01M14.7 13.8h.01"/>',
  flame: '<path d="M12 3.2s5.2 4.4 5.2 9a5.2 5.2 0 1 1-10.4 0c0-2 .9-3.6 2-4.7 0 1.6.9 2.6 1.9 2.6C13.4 10.1 12 6.6 12 3.2Z"/>',
  database: '<ellipse cx="12" cy="6.2" rx="7.5" ry="2.9"/><path d="M4.5 6.2v11.6c0 1.6 3.4 2.9 7.5 2.9s7.5-1.3 7.5-2.9V6.2"/><path d="M4.5 12c0 1.6 3.4 2.9 7.5 2.9s7.5-1.3 7.5-2.9"/>',
  crosshair: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/><circle cx="12" cy="12" r="1.6"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/>',
  undo: '<path d="M4.5 9.5H15a4.75 4.75 0 0 1 0 9.5H9"/><path d="m8.5 5-4 4.5 4 4.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  minus: '<path d="M5.5 12h13"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11.5v5M12 8h.01"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
};
function icon(name, cls) {
  const d = ICONS[name];
  if (!d) return "";
  return `<svg class="ic${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" `
    + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}
/* every element carrying data-icon gets its glyph injected once */
function hydrateIcons(root) {
  for (const el of $$("[data-icon]", root || document)) {
    if (el.dataset.iconDone) continue;
    el.dataset.iconDone = "1";
    el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon));
  }
}
hydrateIcons();

