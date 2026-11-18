/* ascii-life · app.js — the board: canvases, glow, trails, themes, controls. All simulation lives in sim.js. */
(() => {
'use strict';
const S = window.AsciiLife, TAU = Math.PI * 2, $ = s => document.querySelector(s);
const CH = []; for (let i = 0; i < 256; i++) CH[i] = String.fromCharCode(i);

const THEMES = {
  reef:     { mono:false, sat:92, bg:'#04060b', bezel:'#0a0d13', line:'#1a212d', dot:'#161d2b', accent:'#6ff2d2', halo:.85, trail:.88 },
  phosphor: { mono:true, hue:130, spread:16, sat:88, bg:'#020803', bezel:'#07100a', line:'#12261a', dot:'#0c2714', accent:'#5dff8f', halo:1, trail:.945 },
  amber:    { mono:true, hue:33,  spread:11, sat:96, bg:'#090502', bezel:'#110b05', line:'#2a1c0c', dot:'#2c1a06', accent:'#ffb347', halo:.95, trail:.92 },
  vfd:      { mono:true, hue:174, spread:20, sat:86, bg:'#020809', bezel:'#07100f', line:'#122725', dot:'#0b2625', accent:'#59f0e6', halo:1, trail:.9 },
};
const CELLS = { s:10, m:13, l:16 };
const FONT = 'ui-monospace,"SF Mono","Cascadia Mono","JetBrains Mono",Menlo,Consolas,"DejaVu Sans Mono",monospace';
const HUES = S.HUES, WHITE = S.WHITE, LEVELS = 24, VMAX = 1.6;

const board = $('#board'), cH = $('#halo'), cD = $('#dots'), cB = $('#bloom'), cG = $('#glyphs');
const xH = cH.getContext('2d'), xD = cD.getContext('2d'), xB = cB.getContext('2d'), xG = cG.getContext('2d');
let theme = 'reef', cellKey = window.innerWidth < 700 ? 's' : 'm', paused = false, seed = (Math.random() * 0xffff) | 0;
let W, H, dpr, cw, ch, cols = 0, rows, N, GW, GH, ox, oy, fontPx, pv, pc, pk, haloImg, LUT = [], RGB;

function hsl2rgb(h, s, l){
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t % 1 + 1) % 1; return t < 1/6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2/3 ? p + (q - p) * (2/3 - t) * 6 : p; };
  return [f(h + 1/3) * 255, f(h) * 255, f(h - 1/3) * 255];
}
function buildLUT(){
  const Th = THEMES[theme]; LUT = new Array((HUES + 1) * LEVELS); RGB = new Uint8Array((HUES + 1) * LEVELS * 3);
  for (let k = 0; k <= HUES; k++) for (let l = 0; l < LEVELS; l++){
    const v = (l + .5) / LEVELS * VMAX; let h, s;
    if (Th.mono){ h = Th.hue + ((k % HUES) / HUES - .5) * Th.spread * 2; s = k === WHITE ? Th.sat * .4 : Th.sat; }
    else { h = k === WHITE ? 205 : k / HUES * 360; s = k === WHITE ? 14 : Th.sat; }
    let li = 5 + 55 * Math.pow(Math.min(v, 1), .9);
    const bl = Math.max(0, Math.cos((h - 245) * Math.PI / 180)); li += bl * bl * 11 * Math.min(v, 1);   // blues read dark; lift them
    if (v > 1){ const o = (v - 1) / (VMAX - 1); li += o * 30; s *= 1 - o * .3; }
    if (k === WHITE) li += 14;
    li = Math.min(97, li);
    const q = k * LEVELS + l; LUT[q] = `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${li.toFixed(1)}%)`;
    const c = hsl2rgb(h, s / 100, Math.min(.62, li / 100 + .08)); RGB[q*3] = c[0]; RGB[q*3+1] = c[1]; RGB[q*3+2] = c[2];
  }
}
function resize(){
  const r = board.getBoundingClientRect(); W = Math.max(80, Math.floor(r.width)); H = Math.max(80, Math.floor(r.height));
  dpr = Math.min(2, window.devicePixelRatio || 1);
  fontPx = CELLS[cellKey]; cw = Math.round(fontPx * .64); ch = Math.round(fontPx * 1.12);
  cols = Math.max(8, Math.floor(W / cw)); rows = Math.max(6, Math.floor(H / ch)); N = cols * rows;
  GW = cols * cw; GH = rows * ch; ox = Math.floor((W - GW) / 2); oy = Math.floor((H - GH) / 2);
  for (const c of [cG, cD]){ c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  cB.width = Math.ceil(W / 2); cB.height = Math.ceil(H / 2); cH.width = cols; cH.height = rows;
  cH.style.left = ox + 'px'; cH.style.top = oy + 'px'; cH.style.width = GW + 'px'; cH.style.height = GH + 'px';
  pv = new Float32Array(N); pc = new Uint16Array(N); pk = new Uint8Array(N); haloImg = xH.createImageData(cols, rows);
  S.configure(cols, rows, cw, ch); drawDots();
}
function drawDots(){
  xD.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr); xD.clearRect(-ox, -oy, W, H);
  xD.fillStyle = THEMES[theme].dot; const rad = Math.max(.6, cw * .085); xD.beginPath();
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++){ const px = (x + .5) * cw, py = (y + .5) * ch; xD.moveTo(px + rad, py); xD.arc(px, py, rad, 0, TAU); }
  xD.fill();
}
function applyTheme(){
  const Th = THEMES[theme], st = document.documentElement.style;
  st.setProperty('--bg', Th.bg); st.setProperty('--bezel', Th.bezel); st.setProperty('--line', Th.line);
  st.setProperty('--accent', Th.accent); st.setProperty('--halo', Th.halo); st.setProperty('--glow', Th.accent + '38');
  buildLUT(); if (cols) drawDots();
  document.querySelectorAll('[data-theme]').forEach(b => b.setAttribute('aria-pressed', b.dataset.theme === theme));
}

/* one frame: the sim fills the field; unlit cells keep a fading ghost of what was last there */
function render(dt){
  S.rasterize(); const { fv, fc, fk } = S.field();
  const decay = Math.pow(THEMES[theme].trail, dt * 60), hd = haloImg.data, ls = LEVELS / VMAX;
  xG.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr); xG.clearRect(-ox, -oy, W, H);
  xG.font = `600 ${fontPx}px ${FONT}`; xG.textAlign = 'center'; xG.textBaseline = 'middle';
  let cur = '';
  for (let i = 0; i < N; i++){
    let v = fv[i], c, k; const j = i * 4;
    if (v > 0){ c = fc[i]; k = fk[i]; pv[i] = v * .5; pc[i] = c; pk[i] = k; }
    else {
      v = pv[i] * decay; if (v < .06){ pv[i] = 0; hd[j+3] = 0; continue; }
      pv[i] = v; k = pk[i]; c = v > .3 ? pc[i] : v > .15 ? 58 : 46;
    }
    const q = k * LEVELS + Math.min(LEVELS - 1, (v * ls) | 0), st = LUT[q];
    if (st !== cur){ xG.fillStyle = st; cur = st; }
    xG.fillText(CH[c] || '?', ((i % cols) + .5) * cw, (((i / cols) | 0) + .5) * ch + 1);
    hd[j] = RGB[q*3]; hd[j+1] = RGB[q*3+1]; hd[j+2] = RGB[q*3+2]; hd[j+3] = Math.min(255, v * 210);
  }
  xH.putImageData(haloImg, 0, 0);
  xB.clearRect(0, 0, cB.width, cB.height); xB.drawImage(cG, 0, 0, cB.width, cB.height);
}
let last = 0, fps = 60, statT = 0, jsMs = 0, frames = 0;
function frame(ms){
  requestAnimationFrame(frame);
  const now = ms / 1000; let dt = now - last; last = now; if (!(dt > 0)) return; fps += (1 / dt - fps) * .06; dt = Math.min(.05, dt);
  const t0 = performance.now();
  if (!paused) S.step(dt);
  render(paused ? 0 : dt); frames++;
  jsMs += (performance.now() - t0 - jsMs) * .05;
  statT -= dt; if (statT < 0){ statT = .3; $('#stat').textContent = `${S.creatures.length} creatures · ${cols}×${rows} cells · ${Math.round(fps)} fps · seed ${seed.toString(16).toUpperCase().padStart(4, '0')}`; }
}

/* controls */
const rnd = () => (Math.random() * 1e9) | 0;
function setCell(key){
  const before = ch; cellKey = key; resize(); S.rescale(ch / before);
  document.querySelectorAll('[data-cell]').forEach(b => b.setAttribute('aria-pressed', b.dataset.cell === cellKey));
}
function setPaused(p){ paused = p; const b = $('#pause'); b.setAttribute('aria-pressed', paused); b.textContent = paused ? 'Play' : 'Pause'; }
document.querySelectorAll('[data-theme]').forEach(b => b.addEventListener('click', () => { theme = b.dataset.theme; applyTheme(); }));
document.querySelectorAll('[data-cell]').forEach(b => b.addEventListener('click', () => setCell(b.dataset.cell)));
$('#add').addEventListener('click', () => S.add(null, null, null, null, rnd()));
$('#add10').addEventListener('click', () => { for (let i = 0; i < 10; i++) S.add(null, null, null, null, rnd()); });
$('#clear').addEventListener('click', () => S.clear());
$('#reseed').addEventListener('click', () => { seed = (Math.random() * 0xffff) | 0; S.buildScene(seed); });
$('#pause').addEventListener('click', () => setPaused(!paused));
const at = e => { const r = board.getBoundingClientRect(); return [e.clientX - r.left - ox, e.clientY - r.top - oy]; };
board.addEventListener('pointermove', e => { const p = at(e); S.pointer(p[0], p[1]); });
board.addEventListener('pointerleave', () => S.pointer(-1e6, -1e6));
board.addEventListener('pointerdown', e => { const p = at(e); S.add(null, null, p[0], p[1], rnd()); });
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
  if (e.key === ' '){ e.preventDefault(); setPaused(!paused); }
  else if (e.key === 'r') $('#reseed').click();
  else if (e.key === 't'){ const ks = Object.keys(THEMES); theme = ks[(ks.indexOf(theme) + 1) % ks.length]; applyTheme(); }
});
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(resize, 80); });

/* boot. URL options: ?seed=4f2a &theme=phosphor &cell=s|m|l &solo=butterfly (one creature, centred) */
const qs = new URLSearchParams(location.search);
if (qs.get('seed')) seed = parseInt(qs.get('seed'), 16) & 0xffff;
if (THEMES[qs.get('theme')]) theme = qs.get('theme');
if (CELLS[qs.get('cell')]) cellKey = qs.get('cell');
applyTheme(); resize();
if (S.SPECIES[qs.get('solo')]){ S.clear(); S.add(qs.get('solo'), qs.get('hue') ? +qs.get('hue') : 200, S.GW / 2, S.GH / 2, seed); }
else S.buildScene(seed);
document.querySelectorAll('[data-cell]').forEach(b => b.setAttribute('aria-pressed', b.dataset.cell === cellKey));
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPaused(true);
window.__life = {                                                // hooks for the test suite
  sim: S, setPaused, get paused(){ return paused; }, get fps(){ return fps; }, get js(){ return jsMs; }, get frames(){ return frames; },
  advance(sec){ for (let i = 0, n = Math.round(sec * 60); i < n; i++) S.step(1 / 60); render(1 / 60); },
  wipe(){ pv.fill(0); },                                         // drop the fading trails
};
requestAnimationFrame(frame);
})();
