/* ascii-life · app.js — the board: canvases, light, trails, themes, selection, controls. All simulation lives in sim.js. */
(() => {
'use strict';
const S = window.AsciiLife, TAU = Math.PI * 2, $ = s => document.querySelector(s), $$ = s => document.querySelectorAll(s);
const CH = []; for (let i = 0; i < 256; i++) CH[i] = String.fromCharCode(i);

const THEMES = {
  reef:     { mono:false, sat:92, bg:'#04060b', bezel:'#0a0d13', line:'#1a212d', dot:'#161d2b', accent:'#6ff2d2', trail:.88 },
  phosphor: { mono:true, hue:130, spread:16, sat:88, bg:'#020803', bezel:'#07100a', line:'#12261a', dot:'#0c2714', accent:'#5dff8f', trail:.945 },
  amber:    { mono:true, hue:33,  spread:11, sat:96, bg:'#090502', bezel:'#110b05', line:'#2a1c0c', dot:'#2c1a06', accent:'#ffb347', trail:.92 },
  vfd:      { mono:true, hue:174, spread:20, sat:86, bg:'#020809', bezel:'#07100f', line:'#122725', dot:'#0b2625', accent:'#59f0e6', trail:.9 },
};
const CELLS = { s:10, m:13, l:16 };
const FONT = 'ui-monospace,"SF Mono","Cascadia Mono","JetBrains Mono",Menlo,Consolas,"DejaVu Sans Mono",monospace';
const HUES = S.HUES, WHITE = S.WHITE, WALL = S.WALL, LEVELS = 24, VMAX = 1.6;
const coarse = matchMedia('(pointer: coarse)').matches, phone = () => coarse || innerWidth < 760;
const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;

const board = $('#board'), card = $('#card'), cardText = $('#card-text');
const cA = $('#amb'), cH = $('#glow'), cD = $('#dots'), cL = $('#lamps'), cG = $('#glyphs'), cB = document.createElement('canvas'), cF = document.createElement('canvas');
const xA = cA.getContext('2d'), xH = cH.getContext('2d'), xD = cD.getContext('2d'), xL = cL.getContext('2d'), xB = cB.getContext('2d'), xG = cG.getContext('2d'), xF = cF.getContext('2d');
const PX = 7, PY = 5;                                              // how many cells past the board edge the ambient light is drawn
let theme = 'reef', cellKey = phone() ? 's' : 'm', paused = false, seed = (Math.random() * 0xffff) | 0, immersive = phone(), sel = null;
let W, H, dpr, cw, ch, cols = 0, rows, N, GW = 0, GH = 0, ox, oy, fontPx, pv, pc, pk, on;
let LUT = [], UNIT, E, HOT, F1, F2, F3, TMP, imgGlow, imgLit, imgAmb, imgHot;

/* ───────────── colour ───────────── */
function hsl2rgb(h, s, l){
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t % 1 + 1) % 1; return t < 1/6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2/3 ? p + (q - p) * (2/3 - t) * 6 : p; };
  return [f(h + 1/3) * 255, f(h) * 255, f(h - 1/3) * 255];
}
function buildLUT(){
  const Th = THEMES[theme]; LUT = new Array((HUES + 1) * LEVELS); UNIT = new Float32Array((HUES + 1) * 3);
  for (let k = 0; k <= HUES; k++){
    let h, s;
    if (Th.mono){ h = Th.hue + ((k % HUES) / HUES - .5) * Th.spread * 2; s = k === WHITE ? Th.sat * .4 : Th.sat; }
    else { h = k === WHITE ? 205 : k / HUES * 360; s = k === WHITE ? 14 : Th.sat; }
    const bl = Math.max(0, Math.cos((h - 245) * Math.PI / 180));                         // blues read dark; lift them
    for (let l = 0; l < LEVELS; l++){
      const v = (l + .5) / LEVELS * VMAX; let li = 5 + 55 * Math.pow(Math.min(v, 1), .9) + bl * bl * 11 * Math.min(v, 1), sat = s;
      if (v > 1){ const o = (v - 1) / (VMAX - 1); li += o * 32; sat *= 1 - o * .35; }       // past full brightness the glyph burns toward white
      if (k === WHITE) li += 14;
      LUT[k * LEVELS + l] = `hsl(${h.toFixed(1)} ${sat.toFixed(1)}% ${Math.min(97, li).toFixed(1)}%)`;
    }
    const u = hsl2rgb(h, Math.min(1, s / 100 + .05), k === WHITE ? .8 : .56 + bl * bl * .08); UNIT[k*3] = u[0] / 255; UNIT[k*3+1] = u[1] / 255; UNIT[k*3+2] = u[2] / 255;   // the colour of the light it throws
  }
}
function hueKey(r, g, b){                                         // which palette entry a colour of light is closest to
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (d < mx * .18) return WHITE;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360;
  return Math.round(h / 360 * HUES) % HUES;
}

/* ───────────── geometry ───────────── */
function place(c){ c.style.left = ox + 'px'; c.style.top = oy + 'px'; c.style.width = GW + 'px'; c.style.height = GH + 'px'; }
function resize(){
  const r = board.getBoundingClientRect(), oGW = GW, oGH = GH, oU = S.U, had = cols > 0;
  W = Math.max(80, Math.floor(r.width)); H = Math.max(80, Math.floor(r.height)); dpr = Math.min(2, window.devicePixelRatio || 1);
  fontPx = CELLS[cellKey]; cw = Math.round(fontPx * .64); ch = Math.round(fontPx * 1.12);
  cols = Math.max(8, Math.floor(W / cw)); rows = Math.max(6, Math.floor(H / ch)); N = cols * rows;
  GW = cols * cw; GH = rows * ch; ox = Math.floor((W - GW) / 2); oy = Math.floor((H - GH) / 2);
  for (const c of [cG, cD]){ c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  cB.width = Math.ceil(W * dpr / 3); cB.height = Math.ceil(H * dpr / 3);
  for (const c of [cH, cF]){ c.width = cols; c.height = rows; }
  cL.width = cols * 3; cL.height = rows * 3; cA.width = cols + 2 * PX; cA.height = rows + 2 * PY;
  place(cH); place(cL);
  cA.style.left = ox - PX * cw + 'px'; cA.style.top = oy - PY * ch + 'px'; cA.style.width = GW + 2 * PX * cw + 'px'; cA.style.height = GH + 2 * PY * ch + 'px';
  pv = new Float32Array(N); pc = new Uint16Array(N); pk = new Uint8Array(N); on = new Uint8Array(N);
  E = new Float32Array(N * 3); HOT = new Float32Array(N * 3); F1 = new Float32Array(N * 3); F2 = new Float32Array(N * 3); F3 = new Float32Array(N * 3); TMP = new Float32Array(N * 3);
  imgGlow = xH.createImageData(cols, rows); imgLit = xL.createImageData(cols * 3, rows * 3); imgAmb = xA.createImageData(cols + 2 * PX, rows + 2 * PY); imgHot = xF.createImageData(cols, rows);
  S.configure(cols, rows, cw, ch); drawDots();
  if (had && S.creatures.length && (Math.abs(S.U - oU) > 1e-6 || Math.abs(GW - oGW) > oGW * .12 || Math.abs(GH - oGH) > oGH * .12)) S.rescale(GW / oGW, GH / oGH);
}
function drawDots(){
  xD.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr); xD.clearRect(-ox, -oy, W, H);
  xD.fillStyle = THEMES[theme].dot; const rad = Math.max(.6, cw * .085); xD.beginPath();
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++){ const px = (x + .5) * cw, py = (y + .5) * ch; xD.moveTo(px + rad, py); xD.arc(px, py, rad, 0, TAU); }
  xD.fill();
}
function applyTheme(){
  const Th = THEMES[theme], st = document.documentElement.style;
  st.setProperty('--bg', Th.bg); st.setProperty('--bezel', Th.bezel); st.setProperty('--line', Th.line); st.setProperty('--accent', Th.accent);
  $('meta[name="theme-color"]').content = Th.bg;
  buildLUT(); if (cols) drawDots();
  $$('[data-theme]').forEach(b => b.setAttribute('aria-pressed', b.dataset.theme === theme));
}

/* ───────────── light: the board's own glow, spread outward at three ranges ─────────────
   Lamps sit on a grid, so the light falling anywhere is a blurred copy of what the board is emitting. Blurring a
   cols×rows field is nearly free, which is why this runs the same on a phone. */
function boxH(s, d, r){
  const inv = 1 / (2 * r + 1), w = cols;
  for (let y = 0; y < rows; y++){
    const row = y * w * 3; let a0 = 0, a1 = 0, a2 = 0;
    for (let x = -r; x <= r; x++){ const j = row + (x < 0 ? 0 : x >= w ? w - 1 : x) * 3; a0 += s[j]; a1 += s[j+1]; a2 += s[j+2]; }
    for (let x = 0; x < w; x++){
      const j = row + x * 3; d[j] = a0 * inv; d[j+1] = a1 * inv; d[j+2] = a2 * inv;
      const xo = x - r, xi = x + r + 1, jo = row + (xo < 0 ? 0 : xo) * 3, ji = row + (xi >= w ? w - 1 : xi) * 3;
      a0 += s[ji] - s[jo]; a1 += s[ji+1] - s[jo+1]; a2 += s[ji+2] - s[jo+2];
    }
  }
}
function boxV(s, d, r){
  const inv = 1 / (2 * r + 1), w3 = cols * 3, h = rows;
  for (let x = 0; x < cols; x++){
    const col = x * 3; let a0 = 0, a1 = 0, a2 = 0;
    for (let y = -r; y <= r; y++){ const j = col + (y < 0 ? 0 : y >= h ? h - 1 : y) * w3; a0 += s[j]; a1 += s[j+1]; a2 += s[j+2]; }
    for (let y = 0; y < h; y++){
      const j = col + y * w3; d[j] = a0 * inv; d[j+1] = a1 * inv; d[j+2] = a2 * inv;
      const yo = y - r, yi = y + r + 1, jo = col + (yo < 0 ? 0 : yo) * w3, ji = col + (yi >= h ? h - 1 : yi) * w3;
      a0 += s[ji] - s[jo]; a1 += s[ji+1] - s[jo+1]; a2 += s[ji+2] - s[jo+2];
    }
  }
}
function spread(src, dst, rx, ry, passes){ let s = src; for (let p = 0; p < passes; p++){ boxH(s, TMP, rx); boxV(TMP, dst, ry); s = dst; } }
function paint(img, F, gain, maxA){                               // light field → colour at full strength, intensity in alpha
  const d = img.data;
  for (let i = 0, j = 0, q = 0; i < N; i++, j += 3, q += 4){
    const r = F[j], g = F[j+1], b = F[j+2], m = Math.max(r, g, b); if (m < 2e-4){ d[q+3] = 0; continue; }
    const s = 255 / m; d[q] = r * s; d[q+1] = g * s; d[q+2] = b * s; d[q+3] = maxA * (1 - Math.exp(-m * gain));
  }
}
function paintGlow(){                                             // tight glow laid over the wide wash, in one image
  const d = imgGlow.data;
  for (let i = 0, j = 0, q = 0; i < N; i++, j += 3, q += 4){
    const m1 = Math.max(F1[j], F1[j+1], F1[j+2]), m3 = Math.max(F3[j], F3[j+1], F3[j+2]);
    const a1 = m1 > 2e-4 ? .8 * (1 - Math.exp(-m1 * 1.5)) : 0, a3 = m3 > 2e-4 ? .26 * (1 - Math.exp(-m3 * 5)) * (1 - a1) : 0, a = a1 + a3;
    if (a < .004){ d[q+3] = 0; continue; }
    const k1 = m1 > 2e-4 ? a1 / m1 : 0, k3 = m3 > 2e-4 ? a3 / m3 : 0, s = 255 / a;
    d[q] = (F1[j] * k1 + F3[j] * k3) * s; d[q+1] = (F1[j+1] * k1 + F3[j+1] * k3) * s; d[q+2] = (F1[j+2] * k1 + F3[j+2] * k3) * s; d[q+3] = a * 255;
  }
}
function paintLamps(){                                            // one soft point per unlit cell, coloured by the light reaching it
  const d = imgLit.data, w = cols * 3;
  for (let i = 0, j = 0; i < N; i++, j += 3){
    const q = ((((i / cols) | 0) * 3 + 1) * w + (i % cols) * 3 + 1) * 4, r = F2[j], g = F2[j+1], b = F2[j+2], m = Math.max(r, g, b);
    if (on[i] || m < 2e-4){ d[q+3] = 0; continue; }
    const s = 255 / m; d[q] = r * s; d[q+1] = g * s; d[q+2] = b * s; d[q+3] = 255 * (1 - Math.exp(-m * 6.5));
  }
}
function paintAmb(){                                              // the widest light, carried past the board edge and faded out
  const d = imgAmb.data, w = cols + 2 * PX, h = rows + 2 * PY;
  for (let y = 0, q = 0; y < h; y++){
    const cy = y - PY, sy = cy < 0 ? 0 : cy >= rows ? rows - 1 : cy, fy = cy < 0 ? 1 + cy / PY : cy >= rows ? 1 - (cy - rows + 1) / PY : 1;
    for (let x = 0; x < w; x++, q += 4){
      const cx = x - PX, sx = cx < 0 ? 0 : cx >= cols ? cols - 1 : cx, fx = cx < 0 ? 1 + cx / PX : cx >= cols ? 1 - (cx - cols + 1) / PX : 1;
      const j = (sy * cols + sx) * 3, r = F3[j], g = F3[j+1], b = F3[j+2], m = Math.max(r, g, b), f = fx * fy;
      if (m < 2e-4 || f <= 0){ d[q+3] = 0; continue; }
      const s = 255 / m; d[q] = r * s; d[q+1] = g * s; d[q+2] = b * s; d[q+3] = 190 * (1 - Math.exp(-m * 7)) * f * f;
    }
  }
}

/* one frame: the sim fills the field; unlit cells keep a fading ghost; then the light is worked out from what was drawn */
function render(dt){
  S.rasterize(); const { fv, fc, fk, fo } = S.field();
  const decay = Math.pow(THEMES[theme].trail, dt * 60), ls = LEVELS / VMAX;
  xG.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr); xG.clearRect(-ox, -oy, W, H);
  xG.font = `600 ${fontPx}px ${FONT}`; xG.textAlign = 'center'; xG.textBaseline = 'middle';
  let cur = '', hot = 0; E.fill(0); HOT.fill(0);
  for (let i = 0, j = 0; i < N; i++, j += 3){
    let v = fv[i], c, k, wall = false;
    if (v > 0){
      c = fc[i]; k = fk[i];
      if (fo[i] === WALL){                                         // the frame shows whatever light last reached it
        wall = true; pv[i] = 0; const r = F2[j], g = F2[j+1], b = F2[j+2], m = Math.max(r, g, b);
        if (m > .003){ v += Math.min(1.1, m * 9); k = hueKey(r, g, b); }
      } else { pv[i] = v * .5; pc[i] = c; pk[i] = k; }
    } else {
      v = pv[i] * decay; if (v < .06){ pv[i] = 0; on[i] = 0; continue; }
      pv[i] = v; k = pk[i]; c = v > .3 ? pc[i] : v > .15 ? 58 : 46;
    }
    on[i] = 1;
    const st = LUT[k * LEVELS + Math.min(LEVELS - 1, (v * ls) | 0)]; if (st !== cur){ xG.fillStyle = st; cur = st; }
    xG.fillText(CH[c] || '?', ((i % cols) + .5) * cw, (((i / cols) | 0) + .5) * ch + 1);
    if (wall) continue;
    const u = k * 3, w = v * v; E[j] = UNIT[u] * w; E[j+1] = UNIT[u+1] * w; E[j+2] = UNIT[u+2] * w;
    if (v > 1.08){ const h = (v - 1) * 1.5; HOT[j] = (UNIT[u] * .6 + .4) * h; HOT[j+1] = (UNIT[u+1] * .6 + .4) * h; HOT[j+2] = (UNIT[u+2] * .6 + .4) * h; hot++; }
  }
  spread(E, F1, 1, 1, 2);                                          // hugging the glyphs
  spread(F1, F2, 2, 1, 2);                                         // reaching the lamps around them
  spread(F2, F3, 8, 5, 2);                                         // hanging over the whole board, and past its edge
  paintGlow(); xH.putImageData(imgGlow, 0, 0);
  paintLamps(); xL.putImageData(imgLit, 0, 0);
  if (!immersive){ paintAmb(); xA.putImageData(imgAmb, 0, 0); }
  xG.setTransform(1, 0, 0, 1, 0, 0); xG.imageSmoothingEnabled = true;
  xG.globalCompositeOperation = 'lighter';
  if (!lean){                                                      // bloom: a third-size copy laid back over itself
    xB.clearRect(0, 0, cB.width, cB.height); xB.drawImage(cG, 0, 0, cB.width, cB.height);
    xG.globalAlpha = .5; xG.drawImage(cB, 0, 0, cG.width, cG.height); xG.globalAlpha = 1;
  }
  if (hot){                                                        // anything past full brightness flares white over its neighbours
    paint(imgHot, HOT, 1.5, 185); xF.putImageData(imgHot, 0, 0); xG.drawImage(cF, ox * dpr, oy * dpr, GW * dpr, GH * dpr);
  }
  xG.globalCompositeOperation = 'source-over';
}
let last = 0, fps = 0, statT = 0, jsMs = 0, frames = 0, fpsN = 0, fpsT = 0, slow = 0, lean = false;
function frame(ms){
  requestAnimationFrame(frame);
  const now = ms / 1000; let dt = now - last; last = now; if (!(dt > 0)) return;
  fpsN++; fpsT += dt;
  if (fpsT >= .75){                                                // frames actually drawn, counted over the last ¾ s
    fps = fpsN / fpsT; fpsN = 0; fpsT = 0;
    if (!paused && !lean){ slow = fps < 24 ? slow + 1 : 0; if (slow >= 4) lean = true; }           // struggling for 3 s: drop the bloom pass, the one costly step
  }
  dt = Math.min(.05, dt);
  const t0 = performance.now();
  if (!paused) S.step(dt);
  render(paused ? 0 : dt); frames++;
  jsMs += (performance.now() - t0 - jsMs) * .05;
  statT -= dt;
  if (statT < 0){
    statT = .3; const n = S.creatures.length;
    $('#stat').textContent = `${n} creature${n === 1 ? '' : 's'} · ${cols}×${rows} cells · ${Math.round(fps)} fps · seed ${seed.toString(16).toUpperCase().padStart(4, '0')}`;
    $('#stat2').textContent = `${n} · ${cols}×${rows} · ${Math.round(fps)} fps`;
    if (sel && !S.creatures.includes(sel)) closeCard();
  }
}

/* ───────────── the selected creature ───────────── */
const rnd = () => (Math.random() * 1e9) | 0;
const label = c => { $('#card-kind').textContent = c.g.kind + ' · ' + c.g.form; $$('[data-base]').forEach(b => b.setAttribute('aria-pressed', b.dataset.base === c.g.kind)); };
function openCard(c, x, y){
  sel = c; S.select(c); card.hidden = false; label(c); cardText.value = c.text || '';
  if (!immersive){ const cwid = card.offsetWidth, chei = card.offsetHeight; card.style.left = Math.max(8, Math.min(W - cwid - 8, x + ox + 22)) + 'px'; card.style.top = Math.max(8, Math.min(H - chei - 8, y + oy + 22)) + 'px'; }
  else { card.style.left = ''; card.style.top = ''; }
}
function closeCard(){ sel = null; S.select(null); card.hidden = true; cardText.blur(); }
let typeT = 0;
/* the creature is f(base, name). Typing changes the name; a base button changes the base and keeps the name. */
function applyText(base){ if (!sel) return; const t = cardText.value; if (!t.trim()) return; sel = S.reshape(sel, t, base || sel.g.kind, !!base) || sel; label(sel); }
cardText.addEventListener('input', () => { clearTimeout(typeT); typeT = setTimeout(applyText, 130); });
cardText.addEventListener('keydown', e => { if (e.key === 'Enter'){ clearTimeout(typeT); applyText(); cardText.blur(); } e.stopPropagation(); if (e.key === 'Escape') closeCard(); });
$$('[data-base]').forEach(b => b.addEventListener('click', () => { clearTimeout(typeT); applyText(b.dataset.base); }));
$('#card-shuffle').addEventListener('click', () => { clearTimeout(typeT); cardText.value = S.nameFrom(rnd()); applyText(sel && sel.g.kind); });
$('#card-copy').addEventListener('click', () => { if (sel) S.clone(sel, 1); });
$('#card-copy10').addEventListener('click', () => { if (sel) S.clone(sel, 10); });
$('#card-del').addEventListener('click', () => { if (sel) S.remove(sel); closeCard(); });
$('#card-close').addEventListener('click', closeCard);

/* ───────────── controls ───────────── */
function setCell(key){ cellKey = key; resize(); $$('[data-cell]').forEach(b => b.setAttribute('aria-pressed', b.dataset.cell === cellKey)); }
function setPaused(p){ paused = p; const b = $('#pause'); b.setAttribute('aria-pressed', paused); b.textContent = paused ? 'Play' : 'Pause'; }
function setWalls(b){ S.walls = b; $('#walls').setAttribute('aria-pressed', !!b); }
function setSheet(b){ document.body.classList.toggle('sheet', b && immersive); }
function setImmersive(b){
  immersive = b; document.body.classList.toggle('immersive', b); if (!b) setSheet(false);
  const fs = !!document.fullscreenElement; $('#full').textContent = (phone() ? fs : b) ? 'Exit full screen' : 'Full screen';
  $('#full').hidden = phone() && (standalone || !document.fullscreenEnabled);
  $('#hint').textContent = coarse ? 'Tap open water to release a creature. Tap a creature to reshape, copy or delete it.' : 'Click open water to release a creature. Click a creature to reshape, copy or delete it.';
  if (cols){ resize(); if (sel) closeCard(); }
}
$$('[data-theme]').forEach(b => b.addEventListener('click', () => { theme = b.dataset.theme; applyTheme(); }));
$$('[data-cell]').forEach(b => b.addEventListener('click', () => setCell(b.dataset.cell)));
$('#add').addEventListener('click', () => S.add(null, null, null, null, rnd()));
$('#add10').addEventListener('click', () => { for (let i = 0; i < 10; i++) S.add(null, null, null, null, rnd()); });
$('#clear').addEventListener('click', () => { S.clear(); closeCard(); });
$('#reseed').addEventListener('click', () => { closeCard(); seed = (Math.random() * 0xffff) | 0; S.buildScene(seed); });
$('#pause').addEventListener('click', () => setPaused(!paused));
$('#walls').addEventListener('click', () => setWalls(!S.walls));
$('#fab').addEventListener('click', e => { e.stopPropagation(); setSheet(true); });
$('#sheet-close').addEventListener('click', () => setSheet(false));
$('#full').addEventListener('click', () => {
  const el = document.documentElement, fs = !!document.fullscreenElement;
  if (phone()){ if (fs) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen().catch(() => {}); return; }
  setImmersive(!immersive);
  if (immersive && el.requestFullscreen) el.requestFullscreen().catch(() => {}); else if (!immersive && fs) document.exitFullscreen().catch(() => {});
});
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && !phone() && immersive) setImmersive(false); else setImmersive(immersive); });
const at = e => { const r = board.getBoundingClientRect(); return [e.clientX - r.left - ox, e.clientY - r.top - oy]; };
board.addEventListener('pointermove', e => { if (e.pointerType !== 'touch'){ const p = at(e); S.pointer(p[0], p[1]); } });
board.addEventListener('pointerleave', () => S.pointer(-1e6, -1e6));
board.addEventListener('click', e => {
  if (e.target.closest('.card, .fab')) return;
  if (document.body.classList.contains('sheet')){ setSheet(false); return; }
  const p = at(e), hit = S.pickAt(p[0], p[1], coarse ? 3 : 2);
  if (hit) openCard(hit, p[0], p[1]); else if (sel) closeCard(); else S.add(null, null, p[0], p[1], rnd());
});
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || (e.target.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter'))) return;
  if (e.key === ' '){ e.preventDefault(); setPaused(!paused); }
  else if (e.key === 'Escape'){ if (sel) closeCard(); else setSheet(false); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && sel){ S.remove(sel); closeCard(); }
  else if (e.key === 'r') $('#reseed').click();
  else if (e.key === 'w') setWalls(!S.walls);
  else if (e.key === 'f') $('#full').click();
  else if (e.key === 't'){ const ks = Object.keys(THEMES); theme = ks[(ks.indexOf(theme) + 1) % ks.length]; applyTheme(); }
});
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (!coarse && (innerWidth < 760) !== immersive && !document.fullscreenElement) setImmersive(innerWidth < 760); else resize(); }, 90); });
if (window.visualViewport){                                        // keep the card above the on-screen keyboard
  const vv = window.visualViewport, kb = () => document.documentElement.style.setProperty('--kb', Math.max(0, innerHeight - vv.height - vv.offsetTop) + 'px');
  vv.addEventListener('resize', kb); vv.addEventListener('scroll', kb);
}
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#install').hidden = false; });
$('#install').addEventListener('click', () => { if (installEvt){ installEvt.prompt(); installEvt = null; $('#install').hidden = true; } });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});

/* boot. URL options: ?seed=4f2a &theme=phosphor &cell=s|m|l &walls=1|0 &solo=butterfly[&name=tiny+red+nick] (one creature, centred) */
const qs = new URLSearchParams(location.search);
if (qs.get('seed')) seed = parseInt(qs.get('seed'), 16) & 0xffff;
if (THEMES[qs.get('theme')]) theme = qs.get('theme');
if (CELLS[qs.get('cell')]) cellKey = qs.get('cell');
document.body.classList.toggle('immersive', immersive);
applyTheme(); resize(); setImmersive(immersive);
setWalls(qs.has('walls') ? qs.get('walls') !== '0' : phone());
if (S.SPECIES[qs.get('solo')]){ S.clear(); S.add(qs.get('solo'), qs.get('name'), S.GW / 2, S.GH / 2, seed); }
else S.buildScene(seed);
$$('[data-cell]').forEach(b => b.setAttribute('aria-pressed', b.dataset.cell === cellKey));
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPaused(true);
window.__life = {                                                  // hooks for the test suite
  sim: S, setPaused, setWalls, get paused(){ return paused; }, get fps(){ return fps; }, get js(){ return jsMs; }, get frames(){ return frames; },
  get immersive(){ return immersive; }, get selected(){ return sel; }, get lean(){ return lean; },
  advance(sec){ for (let i = 0, n = Math.round(sec * 60); i < n; i++) S.step(1 / 60); render(1 / 60); },
  wipe(){ pv.fill(0); },                                           // drop the fading trails
  lamp(i){ return imgLit.data[((((i / cols) | 0) * 3 + 1) * cols * 3 + (i % cols) * 3 + 1) * 4 + 3]; },   // how lit the lamp in cell i is, 0–255
  origin(){ const r = board.getBoundingClientRect(); return [r.left + ox, r.top + oy]; },
};
requestAnimationFrame(frame);
})();
