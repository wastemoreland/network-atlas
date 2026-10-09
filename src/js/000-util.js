"use strict";
/* ============================================================
   Network Atlas — renders transport-fever-3 map exports
   ============================================================ */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/* Extra lineWidth added to a casing stroke so the outline is a constant 2 px on
   each side of the fill, independent of the (scaled) fill width. */
const CASING_OUTLINE = 4;
const fmt = (n, d = 0) => Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtMax = (n, d = 3) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const yieldUI = () => new Promise(r => setTimeout(r, 0));
const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };

