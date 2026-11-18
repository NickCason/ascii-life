/* ascii-life · sim.js
   Simulation + character-field rasteriser. No DOM: runs in the browser (window.AsciiLife) and in Node (require).
   Every creature is plain genome data, simulated in pixel space, then written into the board as three numbers
   per cell: glyph code, brightness, colour key. */
(function (root, factory){
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AsciiLife = factory();
})(typeof self !== 'undefined' ? self : this, function (){
'use strict';

/* ───────────── helpers ───────────── */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const frac = x => x - Math.floor(x);
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rr = (rng, a, b) => a + (b - a) * rng();
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
function hash3(a, b, c){ let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const codes = s => Array.from(s, c => c.charCodeAt(0));
const HUES = 72, WHITE = HUES;
const hk = h => (Math.round(((h % 360) + 360) % 360 / 360 * HUES)) % HUES;

/* ───────────── board state ───────────── */
let cols = 0, rows = 0, cw = 8, ch = 15, N = 0, GW = 0, GH = 0, U = 1;
let fv, fc, fk, fo;                                              // the output field: brightness, glyph, colour key, owner id
let sid, ssd, snx, sny, sdd, ss, su, s2, sf, stx, sty, touched, nT = 0, stamp = 0;   // shape scratch
let creatures = [], motes = [], parts = [];
let T = 0, mx = -1e6, my = -1e6, uid = 1;
let WALLS = false, OWN = 0, SEL = 0, bx0 = 0, bx1 = 0, by0 = 0, by1 = 0;
const WALL = 65535;

function configure(c, r, cellW, cellH){
  cols = c; rows = r; cw = cellW; ch = cellH; N = cols * rows; GW = cols * cw; GH = rows * ch;
  U = ch / 9 * clamp(Math.sqrt(N / 9000) + .15, .78, 1);            // creatures shrink a little on small boards so more of them fit
  fv = new Float32Array(N); fc = new Uint16Array(N); fk = new Uint8Array(N); fo = new Uint16Array(N);
  sid = new Uint32Array(N); ssd = new Float32Array(N); snx = new Float32Array(N); sny = new Float32Array(N);
  sdd = new Float32Array(N); ss = new Float32Array(N); su = new Float32Array(N); s2 = new Float32Array(N); sf = new Uint8Array(N);
  stx = new Float32Array(N); sty = new Float32Array(N); touched = new Int32Array(N); stamp = 0;
}

/* ───────────── the pen: glow wave + twinkle for whatever is being drawn ───────────── */
let LB = .75, LA = .5, LK = .5, LP = 0, LF = 0, LS = 4, GR = 0;
let TWD = 0, TWS = null, TWK = WHITE, CID = 0;
function lum(s){ const w = .5 + .5 * Math.sin(s * LK - LP); return LB + LA * Math.pow(w, LS) + LF; }
function tint(k, s){ if (!GR || k === WHITE) return k; k = (k + Math.round(s * GR)) % HUES; return k < 0 ? k + HUES : k; }   // hue drifts along the body
function put(i, code, v, k){
  if (TWD > 0){                                                  // a cell briefly becomes some other bright symbol
    const tb = (T * 9 + frac(i * .6180339) * 5) | 0, h = hash3(i, tb, CID), d = TWD * (.4 + v * .8);
    if (h < d){ code = TWS[(h / d * TWS.length) | 0]; v = v * .4 + 1 + h / d * .35; k = hash3(i, tb, 7) < .5 ? WHITE : TWK; }
  }
  fv[i] = v; fc[i] = code; fk[i] = k; fo[i] = OWN;
  if (OWN === SEL && SEL){ const x = i % cols, y = (i / cols) | 0; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
}
function dot(x, y, code, v, k, raw){
  const cx = Math.floor(x / cw), cy = Math.floor(y / ch); if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
  const i = cy * cols + cx; if (raw){ fv[i] = v; fc[i] = code; fk[i] = k; fo[i] = OWN; } else put(i, code, v, k);
}
/* a stroke picks its glyph from its slope, and for shallow strokes from where it crosses the cell:  _ . - ' "  */
function lineGlyph(dx, dy, y){
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ay > ax * 3.2) return 124;
  if (ay > ax * .62) return dx * dy > 0 ? 92 : 47;
  const fy = frac(y / ch);
  if (ay < ax * .14) return fy > .7 ? 95 : fy < .22 ? 175 : 45;
  return fy > .8 ? 95 : fy > .6 ? 46 : fy > .38 ? 45 : (dx * dy > 0 ? 96 : 39);
}
function line(ax, ay, bx, by, k, v0, v1, s0, s1, code){
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy), n = Math.max(1, Math.ceil(len / (cw * .45))); let last = -1;
  for (let j = 0; j <= n; j++){
    const h = j / n, x = ax + dx * h, y = ay + dy * h, cx = Math.floor(x / cw), cy = Math.floor(y / ch);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
    const i = cy * cols + cx; if (i === last) continue; last = i;
    const s = s0 + (s1 - s0) * h; put(i, code || lineGlyph(dx, dy, y), (v0 + (v1 - v0) * h) * lum(s), tint(k, s));
  }
}

/* ───────────── filled shapes: gather signed distances, then classify outline vs interior ───────────── */
function beginShape(){ stamp++; nT = 0; }
function capsule(ax, ay, ar, bx, by, br, sa, sb){
  const pad = Math.max(ar, br) + ch;
  const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - pad) / cw)), x1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx) + pad) / cw));
  const y0 = Math.max(0, Math.floor((Math.min(ay, by) - pad) / ch)), y1 = Math.min(rows - 1, Math.floor((Math.max(ay, by) + pad) / ch));
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-6, L = Math.sqrt(L2);
  for (let cy = y0; cy <= y1; cy++){ const py = (cy + .5) * ch;
    for (let cx = x0; cx <= x1; cx++){ const px = (cx + .5) * cw;
      const h = clamp(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1);
      const ex = px - (ax + dx * h), ey = py - (ay + dy * h), d = Math.hypot(ex, ey), r = ar + (br - ar) * h, sd = d - r;
      if (sd > ch) continue;
      const i = cy * cols + cx;
      if (sid[i] !== stamp){ sid[i] = stamp; touched[nT++] = i; ssd[i] = 1e9; }
      if (sd < ssd[i]){
        ssd[i] = sd; sdd[i] = d; sf[i] = 0; s2[i] = 0;
        if (d > 1e-3){ snx[i] = ex / d; sny[i] = ey / d; } else { snx[i] = 0; sny[i] = -1; }
        stx[i] = dx / L; sty[i] = dy / L;
        ss[i] = sa + (sb - sa) * h; su[i] = clamp((dx * ey - dy * ex) / L / Math.max(r, 1e-3), -1, 1);
      }
    }
  }
}
/* ellipse centred at (cx0,cy0); local +Y runs along ang with semi-axis b, local X across it with semi-axis a.
   half=true keeps only the +Y half (a bell with a flat base through the centre). */
function ellipse(cx0, cy0, ang, a, b, half){
  const fx = Math.cos(ang), fy = Math.sin(ang), px = -fy, py = fx, rad = Math.max(a, b) + ch;
  const x0 = Math.max(0, Math.floor((cx0 - rad) / cw)), x1 = Math.min(cols - 1, Math.floor((cx0 + rad) / cw));
  const y0 = Math.max(0, Math.floor((cy0 - rad) / ch)), y1 = Math.min(rows - 1, Math.floor((cy0 + rad) / ch));
  for (let cy = y0; cy <= y1; cy++){ const wy = (cy + .5) * ch - cy0;
    for (let cx = x0; cx <= x1; cx++){ const wx = (cx + .5) * cw - cx0;
      const lx = wx * px + wy * py, ly = wx * fx + wy * fy, e = Math.hypot(lx / a, ly / b);
      let gx = lx / (a * a), gy = ly / (b * b); const gl = Math.hypot(gx, gy);
      let sd = gl > 1e-9 ? (e - 1) * e / gl : -Math.min(a, b), nx, ny, rim = 0;
      if (gl > 1e-9){ gx /= gl; gy /= gl; nx = gx * px + gy * fx; ny = gx * py + gy * fy; } else { nx = 0; ny = -1; }
      if (half){ const sdB = -ly - ch * .2; if (sdB > sd){ sd = sdB; nx = -fx; ny = -fy; rim = 1; } }
      if (sd > ch) continue;
      const i = cy * cols + cx;
      if (sid[i] !== stamp){ sid[i] = stamp; touched[nT++] = i; ssd[i] = 1e9; }
      if (sd < ssd[i]){ ssd[i] = sd; sdd[i] = 1e6; sf[i] = rim; snx[i] = nx; sny[i] = ny; stx[i] = -fx; sty[i] = -fy; ss[i] = e; su[i] = clamp(lx / a, -1, 1); s2[i] = clamp(ly / b, -1, 1); }
    }
  }
}

/* outline vocabularies. ramp = five heights a near-horizontal edge can sit at inside its cell (low → high);
   flat = the three line-like glyphs used when the edge is truly level; L/R = side walls, cycled along the body. */
function OUT(ramp, flat, L, R){ return { ramp:codes(ramp), flat:codes(flat), L:codes(L), R:codes(R) }; }
const OUTS = {
  soft:  OUT('_.~\'"', '_~"', '(', ')'),
  clean: OUT('_.-\'¯', '_-¯', '(', ')'),
  round: OUT('_,-\'"', '_="', '({', ')}'),
  hard:  OUT('_,=\'"', '_=¯', '[', ']'),
  scaly: OUT('_,^\'"', 'v=^', '{(', '})'),
  wing:  OUT('_.-\'"', '_-"', '(', ')'),
  buzz:  OUT('_.=\'"', '_=~', '<', '>'),
};
/* interior textures */
const RAMP = 0, BANDS = 1, FLOW = 2, SPOTS = 3, STRIPE = 4, JELLY = 5, WING = 6, CHECK = 7, NOISE = 8;
const SK = {
  core:   { t:RAMP, c:codes('.:=+*#') },
  pearl:  { t:RAMP, c:codes('.:oO0@') },
  moss:   { t:RAMP, c:codes(',;!i%&') },
  bands:  { t:BANDS, c:codes('#=:='), f:.9 },
  tiger:  { t:BANDS, c:codes('WM::'), f:.7 },
  rings:  { t:BANDS, c:codes('O-:-'), f:.8 },
  arrows: { t:FLOW, c:codes('>v<^'), fill:58, f:1 },
  scales: { t:FLOW, c:codes(')u(n'), fill:46, f:1.2 },
  plates: { t:FLOW, c:codes(']U[A'), fill:61, f:.8 },
  koi:    { t:SPOTS, c:codes(':@8') },
  freck:  { t:SPOTS, c:codes('.o*') },
  stripe: { t:STRIPE, c:codes('=:.') },
  jelly:  { t:JELLY, c:codes('@:') },
};
let SKK = 0;                                                     // which colour the last skin glyph wants: 0 body, 1 outline hue, 2 white, 3 accent
function skinGlyph(sk, s, u, w, tx, ty){
  const c = sk.c, au = Math.abs(u); SKK = 0;
  switch (sk.t){
    case RAMP: return c[Math.min(c.length - 1, ((1 - au) * c.length * 1.1) | 0)];
    case BANDS: return c[((s * sk.f + au * 1.3) | 0) % c.length];
    case FLOW:                                                   // glyphs that point the way the animal is heading
      if (((s * sk.f) | 0) & 1) return sk.fill;
      return Math.abs(tx) > Math.abs(ty) ? (tx < 0 ? c[0] : c[2]) : (ty < 0 ? c[1] : c[3]);
    case SPOTS: { const h = hash3((s * 1.1) | 0, (u * 1.6 + 2) | 0, CID), d = sk.d || .3, L = c.length; if (h < d * .25){ SKK = 2; return c[L - 1]; } if (h < d){ SKK = 1; return c[Math.max(0, L - 2)]; } return c[0]; }
    case STRIPE: { const L = c.length; if (au < .28){ SKK = 1; return c[L - 1]; } return au < .7 ? c[Math.min(1, L - 1)] : c[0]; }
    case CHECK: return (((s * (sk.f || 1)) | 0) + ((u * 2 + 2) | 0)) & 1 ? c[c.length - 1] : c[Math.min(1, c.length - 1)];
    case NOISE: return c[(hash3((s * 1.3) | 0, (u * 2 + 2) | 0, CID) * c.length) | 0];
    case JELLY: { if (s < .46){ if (frac(au * (sk.rings || 4.2)) > .34){ SKK = 3; return c[0]; } return 32; } return frac(au * (sk.canals || 3.4) + .5) < .3 ? c[1] : 32; }
    case WING: {                                                 // s radial, u across the chord, w root(-1) → tip(+1)
      if (sk.eye){ const de = Math.hypot((w - sk.ex) / .36, u / .52); if (de < .5){ SKK = 2; return sk.eye[0]; } if (de < 1.05){ SKK = 3; return sk.eye[1]; } }
      if (s > .7){ SKK = 3; return sk.m[((w * 3 + u * 3 + 8) | 0) % sk.m.length]; }
      return c[(((w + 1) * 2.4) | 0) % c.length];
    }
  }
  return 35;
}
function endShape(st){
  const out = st.out, sk = st.skin;
  for (let n = 0; n < nT; n++){
    const i = touched[n], sd = ssd[i], nx = snx[i], ny = sny[i], anx = Math.abs(nx), any = Math.abs(ny);
    const a = any / (anx + 1e-6), flatish = a > 1.25, t0 = flatish ? .42 * ch * any : 1.2;
    if (sd > t0) continue;
    const step = Math.max(anx * cw, any * ch) || cw, s = ss[i], u = su[i], L = lum(s);
    if (sd > t0 - step){                                         // outline cell
      let code;
      if (sf[i] && st.rim) code = st.rim[Math.floor(u * 5 + LP * .5) & 1];
      else if (sdd[i] < step * .45) code = lineGlyph(stx[i], sty[i], ((i / cols | 0) + .5) * ch);
      else if (flatish){
        const fr = clamp(.5 + (ny < 0 ? sd : -sd) / (any * ch), .001, .999);          // where the edge crosses the cell: 0 top … 1 bottom
        if (a > 5) code = out.flat[fr > .66 ? 0 : fr > .33 ? 1 : 2];
        else { const q = ((1 - fr) * 5) | 0; code = q === 3 ? (nx * ny < 0 ? 96 : 39) : out.ramp[q]; }
      }
      else if (a < .4){ const set = nx < 0 ? out.L : out.R; code = set[(Math.abs(s) | 0) % set.length]; }
      else code = nx * ny > 0 ? 47 : 92;
      put(i, code, st.edgeV * L, tint(st.k, s));
    } else {                                                     // interior cell
      const code = skinGlyph(sk, s, u, s2[i], stx[i], sty[i]); if (code === 32) continue;
      put(i, code, st.fillV * (.6 + .4 * (1 - Math.abs(u))) * L, SKK === 0 ? tint(st.k2, s) : SKK === 1 ? tint(st.k, s) : SKK === 2 ? WHITE : st.k3);
    }
  }
}

/* ───────────── shed symbols: bubbles, dust, footprints, embers ───────────── */
const BUBBLE = codes('.oO°'), DUST = codes('*+\'.'), PRINT = codes(',..'), EMBER = codes('*+:.'), PLANK = codes('°·.');
function emit(x, y, vx, vy, life, k, set, v){ if (parts.length < 600) parts.push({ x, y, vx, vy, life, max:life, k, set, v:v || .9 }); }

/* ───────────── trailing strands (tentacles) ───────────── */
class Strand {
  constructor(n, seg, ph){ this.n = n; this.seg = seg; this.ph = ph; this.x = new Float32Array(n); this.y = new Float32Array(n); this.live = false; }
  update(ax, ay, bx, by, dt, drift, swayA, swayPh){
    const x = this.x, y = this.y, n = this.n, seg = this.seg;
    if (!this.live){ for (let j = 0; j < n; j++){ x[j] = ax + bx * seg * j; y[j] = ay + by * seg * j; } this.live = true; }
    x[0] = ax; y[0] = ay; const px = -by, py = bx;
    for (let j = 1; j < n; j++){
      const w = Math.sin(swayPh - j * .6 + this.ph) * swayA * (j / n);
      x[j] += (bx * drift + px * w) * dt; y[j] += (by * drift + py * w) * dt;
      const dx = x[j] - x[j-1], dy = y[j] - y[j-1], d = Math.hypot(dx, dy) || 1;
      x[j] = x[j-1] + dx / d * seg; y[j] = y[j-1] + dy / d * seg;
    }
  }
  draw(k, v0, v1, s0, ds, glyphs){                               // without a glyph list, a strand writes its own bends: ) ( | ~ : .
    const x = this.x, y = this.y, n = this.n, q = this.seg * this.seg;
    for (let j = 0; j < n - 1; j++){
      const dx = x[j+1] - x[j], dy = y[j+1] - y[j]; let code = 0;
      if (glyphs) code = glyphs[j % glyphs.length];
      else {
        const j0 = j > 0 ? j - 1 : j, j1 = j < n - 2 ? j + 1 : j;
        const c = ((x[j0+1] - x[j0]) * (y[j1+1] - y[j1]) - (y[j0+1] - y[j0]) * (x[j1+1] - x[j1])) / q;
        const ax = Math.abs(dx), ay = Math.abs(dy), tip = j / (n - 1);
        if (ay > ax * 1.4){ const b = c * (dy > 0 ? 1 : -1); code = b > .1 ? 41 : b < -.1 ? 40 : tip > .82 ? 46 : tip > .62 ? 58 : 124; }
        else if (ay < ax * .5 && Math.abs(c) > .1) code = 126;
      }
      line(x[j], y[j], x[j+1], y[j+1], k, lerp(v0, v1, j / (n - 1)), lerp(v0, v1, (j + 1) / (n - 1)), s0 + j * ds, s0 + (j + 1) * ds, code);
    }
  }
}

/* ───────────── steering shared by everything that roams ───────────── */
function steer(c, x, y, head, wander){
  let turn = (Math.sin(T * .37 + c.ph) * .6 + Math.sin(T * .83 + c.ph * 1.7) * .4 + Math.sin(T * .19 + c.ph * 2.3) * .5) * wander;
  const mb = Math.min((WALLS ? 175 : 150) * U, GW * .3, GH * .3); let wx = 0, wy = 0;      // edges push harder the deeper you go
  if (x < mb) wx = (mb - x) / mb; else if (x > GW - mb) wx = -(x - (GW - mb)) / mb;
  if (y < mb) wy = (mb - y) / mb; else if (y > GH - mb) wy = -(y - (GH - mb)) / mb;
  if (wx || wy){ const depth = Math.min(1.6, Math.hypot(wx, wy)); turn += clamp(angDiff(Math.atan2(wy, wx), head), -1.3, 1.3) * depth * depth * (WALLS ? 3.8 : 2.6); }
  const R = 220 * U;
  for (const o of creatures){
    if (o === c) continue; const dx = x - o.x, dy = y - o.y, d = Math.hypot(dx, dy);
    if (d < R && d > 1) turn += clamp(angDiff(Math.atan2(dy, dx), head), -1, 1) * (1 - d / R) * 1.4;
  }
  return turn;
}
/* walls on: a head that reaches the frame is held there and turned back toward open water */
function hold(c, x, y, pad){
  const X = clamp(x, pad, Math.max(pad, GW - pad)), Y = clamp(y, pad, Math.max(pad, GH - pad));
  if (X !== x || Y !== y){ c.head += clamp(angDiff(Math.atan2(GH / 2 - Y, GW / 2 - X), c.head), -1, 1) * .05; c.bump = 1; }
  HX = X; HY = Y;
}
let HX = 0, HY = 0;
function glowState(c, x, y, dt, rate){
  c.flash *= Math.exp(-dt * rate); c.flashT -= dt;
  if (c.flashT < 0){ c.flash = .85; c.flashT = rr(c.rng, 4, 13); }
  let pr = Math.max(0, 1 - Math.hypot(x - mx, y - my) / (170 * U)); if (c.id === SEL) pr = Math.max(pr, .75);
  c.near += (pr - c.near) * Math.min(1, dt * 6);
}

/* ───────────── genomes ─────────────
   A creature is f(base type, text). The text is hashed into a seed. The seed first draws the traits every base type
   shares (size, pace, palette, glow, texture), so a name keeps its character whatever body it is given; then the base
   type draws one of its forms and that form's proportions. Lengths are board units (1 unit = 1/9 of a cell height). */
function profile(p, f){ return f < p.pm ? lerp(p.rh, p.R, smooth(f / p.pm)) : lerp(p.R, p.rt, Math.pow(smooth((f - p.pm) / (1 - p.pm)), p.pw)); }
const PALS = ['.:=+*#', '.:oO0@', ',;!i%&', '\'"^*xX', '-=+#', '.oO8', ':;!|I', '~sS$', '.,:;', 'vwVW', 'nmNM', '.°o¤', '·:×+', '-~=#'];
const FLOWS = ['>v<^', ')u(n', ']U[A', '}v{^'], TWSETS = ['*+°x\'', '*°o+', '+x\'*', '*\'"^', '¤°*·', '#$%&', '!?*+'], BODYOUT = ['soft', 'clean', 'round', 'hard', 'scaly'];
function skinFor(rng){
  const t = pick(rng, [RAMP, RAMP, BANDS, BANDS, FLOW, SPOTS, STRIPE, CHECK, NOISE]);
  if (t === FLOW) return { t, c:codes(pick(rng, FLOWS)), fill: pick(rng, [58, 46, 61, 45, 39]), f: rr(rng, .7, 1.4) };
  return { t, c:codes(pick(rng, PALS)), f: rr(rng, .5, 1.4), d: rr(rng, .15, .45) };
}
function traits(rng, R){
  const cap = clamp(Math.min(GW, GH) / (U * 260), 1, 1.75), q = rng();                    // nothing outgrows the board it is on
  let size = q < .2 ? rr(rng, .5, .72) : q < .72 ? rr(rng, .78, 1.2) : q < .94 ? rr(rng, 1.25, 1.6) : rr(rng, 1.6, 2.1);
  if (R.size) size = R.size * rr(rng, .93, 1.07);
  size = Math.min(size, cap * (R.size > 1.7 ? 1.2 : 1));
  let pace = clamp(rr(rng, .65, 1.45) * Math.pow(size, -.3), .45, 1.9); if (R.pace) pace = R.pace * rr(rng, .9, 1.1);
  const hue = R.hue != null ? R.hue + rr(rng, -8, 8) : rng() * 360, sign = rng() < .5 ? -1 : 1;
  const scheme = R.rainbow ? 'rainbow' : R.ghost ? 'ghost' : pick(rng, ['analog', 'analog', 'analog', 'complement', 'triad', 'mono', 'split', 'ghost', 'drift', 'drift']);
  let hue2 = hue + sign * rr(rng, 20, 50), hue3 = hue + 160, grad = 0, pale = false;
  if (scheme === 'complement'){ hue2 = hue + 180 + rr(rng, -15, 15); hue3 = hue + 90; }
  else if (scheme === 'triad'){ hue2 = hue + 120; hue3 = hue + 240; }
  else if (scheme === 'mono'){ hue2 = hue + rr(rng, -8, 8); hue3 = hue; }
  else if (scheme === 'split'){ hue2 = hue + 150; hue3 = hue + 210; }
  else if (scheme === 'ghost'){ pale = true; hue2 = hue; hue3 = hue + 180; }
  else if (scheme === 'drift'){ grad = sign * rr(rng, 50, 150); hue3 = hue + 150; }
  else if (scheme === 'rainbow'){ grad = sign * 330; hue2 = hue + 20; }
  const mode = R.strobe ? 'strobe' : pick(rng, ['wave', 'wave', 'wave', 'throb', 'chase', 'steady', 'strobe']);
  const glow = mode === 'throb' ? { mode, lb:.62, la:.5, k:0, w: rr(rng, 1.5, 3), sharp:2 }
    : mode === 'chase' ? { mode, lb:.5, la:.95, k: rr(rng, .8, 1.4), w: rr(rng, 4, 7), sharp:10 }
    : mode === 'steady' ? { mode, lb:.92, la:.12, k:.5, w:2, sharp:2 }
    : mode === 'strobe' ? { mode, lb:.55, la:.15, k:.5, w:2, sharp:2, strobe: rr(rng, 1.2, 2.6) }
    : { mode, lb:.7, la:.6, k: rr(rng, .35, .6), w: rr(rng, 2.5, 4.2), sharp:4 };
  if (R.bright) glow.lb += .16; if (R.dim) glow.lb -= .2;
  return { size, pace, hue, hue2, hue3, grad, pale, scheme, glow, skin: skinFor(rng), out: pick(rng, BODYOUT), tw: pick(rng, TWSETS),
    twd: R.sparkly ? rr(rng, .05, .09) : pick(rng, [0, .006, .012, .012, .02, .035]) };
}
function common(kind, form, t){
  return { kind, form, size:t.size, pace:t.pace, hue:t.hue, hue2:t.hue2, hue3:t.hue3, pale:t.pale, grad:t.grad, scheme:t.scheme, glow:t.glow, skin:t.skin, out:t.out, tw:t.tw, twd:t.twd, fillV:.5, edgeV:1, strands:[] };
}
const fitWave = (A, seg, n, waves) => Math.min(A, .7 * seg * (n - 1) / (TAU * waves));     // never ask a joint to bend past ~45°
const fitLen = (n, seg, lo) => Math.max(lo, Math.min(n, Math.floor(.7 * Math.max(GW, GH) / U / seg) + 1));   // a body is never longer than the board can hold
function tailLobes(rng, type, len, r){
  if (type === 'fan'){ const m = pick(rng, [3, 5]), out = []; for (let j = 0; j < m; j++) out.push({ a:(j / (m - 1) * 2 - 1) * .8, len:len * .9, r:r * .8 }); return out; }
  if (type === 'paddle') return [{ a:0, len, r:r * 1.3 }];
  if (type === 'lunate'){ const a = rr(rng, .85, 1.05); return [{ a:-a, len:len * 1.25, r:r * .55 }, { a, len:len * 1.25, r:r * .55 }]; }
  const a = rr(rng, .45, .7); return [{ a:-a, len, r }, { a, len, r }];
}
function legSet(list, o){                                         // lengthen the legs until the far end of a stride is within reach
  const need = Math.hypot(o.reach - .7 * o.rb, (1 - o.swing) * o.cycle / 2) * 1.14, k = Math.max(1, need / (o.l1 + o.l2));
  return { list, l1:o.l1 * k, l2:o.l2 * k, reach:o.reach, cycle:o.cycle, swing:o.swing, foot:o.foot };
}
const SPECIES = {
  serpent(rng, t, W){                                            // a wave runs head → tail, growing as it goes
    const form = pick(rng, ['eel', 'eel', 'viper', 'ribbon', 'worm', 'dragon', 'dragon']), g = common('serpent', form, t);
    let R0 = rr(rng, 10, 15) * t.size, n = Math.round(rr(rng, 20, 30)), headK = 1.05, rtK = .12, pm = .08, pw = 1.35, waves = rr(rng, 1.1, 1.5), a1 = rr(rng, 1.3, 1.7), sp = 1;
    g.eye = { code: pick(rng, [111, 111, 79, 48, 42]), n:2 };
    if (form === 'viper'){ n = Math.round(rr(rng, 11, 17)); R0 *= 1.25; headK = rr(rng, 1.3, 1.65); pm = .3; pw = 1; waves = rr(rng, .8, 1.1); }
    else if (form === 'ribbon'){ n = Math.round(rr(rng, 34, 46)); R0 *= .6; waves = rr(rng, 1.8, 2.6); a1 = rr(rng, 1.6, 2.2); sp = 1.15; }
    else if (form === 'worm'){ n = Math.round(rr(rng, 14, 26)); g.bead = rr(rng, .14, .28); headK = .95; rtK = .6; pm = .2; pw = .8; a1 = rr(rng, .6, 1); waves = rr(rng, 1.4, 2); sp = .6; g.eye = { code:46, n:2 }; }
    else if (form === 'dragon'){ g.frill = { every: pick(rng, [1, 2, 2, 3]) }; headK = rr(rng, 1.15, 1.45); g.strands.push({ at:0, fwd:true, pair:true, ang: rr(rng, .7, 1.2), n: Math.round(rr(rng, 4, 7)), seg:R0 * .55, v0:.9, v1:.35, drift:30 }); }
    if (rng() < .3 && form !== 'worm') g.tail = { swing:.4, lobes: tailLobes(rng, pick(rng, ['fork', 'fan', 'paddle']), R0 * .9, R0 * .3) };
    if (rng() < .25 && !g.frill) g.frill = { every: pick(rng, [2, 3]) };
    if (W.long) n = Math.round(n * 1.5); if (W.short) n = Math.round(n * .6); if (W.fat) R0 *= 1.35; if (W.thin) R0 *= .7; if (W.spiky) g.frill = { every:1 };
    n = fitLen(clamp(n, 8, 52), R0 * .85, 8);
    const seg = R0 * .85, lam = (n - 1) * seg / waves, speed = rr(rng, 52, 72) * t.pace * sp * Math.pow(t.size, .35), slip = .7;
    return Object.assign(g, { mode:'swim', n, seg, prof:{ rh:R0 * headK, R:R0, pm, rt:Math.max(1.5, R0 * rtK), pw }, speed, turn:.7, bend:.45, slip, lam, fB:1.15 * speed / (slip * lam),
      idle:.7, burst:[2, 5], coast:[1, 2.5], acc:1.8, drag:.7, wave:{ a0:R0 * .22, a1: fitWave(R0 * a1, seg, n, waves), pw:1.3, k:TAU * waves / (n - 1) } });
  },
  fish(rng, t, W){                                               // stiff front, working tail; beats in bursts, then glides
    const form = pick(rng, ['torpedo', 'torpedo', 'disc', 'needle', 'puffer', 'tadpole', 'ray', 'squid', 'angler', 'betta']), g = common('fish', form, t);
    let R0 = rr(rng, 12, 18) * t.size, n = 8, segK = .6, P = { rh:.6, pm:.32, rt:.2, pw:.9 }, aK = .55, sp = 1, tail = 'fork', tailK = 1.4, idle = .12, burst = [.6, 1.4], coast = [1, 2.8];
    g.eye = { code: pick(rng, [79, 79, 111, 48, 64]), n:2 }; g.bubbles = true; g.fins = [{ at:2, len:1.05, r0:.16, r1:.26, open:1.25, tuck:.5 }];
    switch (form){
      case 'disc': n = 6; segK = .5; R0 *= 1.2; P = { rh:.7, pm:.45, rt:.25, pw:1 }; tail = 'fan'; tailK = 1; sp = .7; g.fins = [{ at:2, len:1.5, r0:.2, r1:.18, open:.95, tuck:.6 }, { at:3, len:1.2, r0:.18, r1:.14, open:.8, tuck:.5 }]; break;
      case 'needle': n = 12; segK = .55; R0 *= .55; P = { rh:.45, pm:.45, rt:.2, pw:1 }; tailK = 1.2; sp = 1.35; g.fins = [{ at:6, len:.9, r0:.14, r1:.2, open:1.1, tuck:.45 }]; break;
      case 'puffer': n = 5; segK = .5; R0 *= 1.3; P = { rh:.8, pm:.5, rt:.3, pw:1 }; tail = 'paddle'; tailK = .7; sp = .5; aK = .3; idle = .5; g.frill = { every:1 }; g.fins = [{ at:2, len:.5, r0:.12, r1:.2, open:1.3, tuck:1.1, flap:.35, ff:3 }]; break;
      case 'tadpole': n = 10; segK = .5; P = { rh:1, pm:.12, rt:.1, pw:.5 }; tail = null; aK = .8; idle = .6; burst = [1, 3]; coast = [.5, 1.5]; g.fins = []; break;
      case 'ray': n = 9; segK = .55; R0 *= .85; P = { rh:.7, pm:.3, rt:.1, pw:.6 }; tail = null; sp = .7; aK = .2; idle = .55; burst = [2, 4]; coast = [1, 2]; g.bubbles = false;
        g.fins = [{ at:2, len:2.2, r0:.75, r1:.2, open:1.5, tuck:1.35, flap:.42, ff:.7 }]; g.strands.push({ at:'tail', count:1, spread:0, n:9, seg:R0 * .5, v0:.9, v1:.3, drift:20 }); break;
      case 'squid': n = 7; P = { rh:.35, pm:.55, rt:.55, pw:1 }; tail = null; aK = .25; idle = .06; burst = [.35, .8]; coast = [1.2, 2.6]; g.bubbles = false; g.eye = { code:79, n:2, rear:true };
        g.fins = [{ at:1, len:.8, r0:.3, r1:.12, open:1.4, tuck:1.2, flap:.3, ff:1.6 }]; g.strands.push({ at:'tail', count: Math.round(rr(rng, 6, 8)), spread:.55, n: Math.round(rr(rng, 7, 10)), seg:R0 * .45, v0:.9, v1:.3, drift:26 }); break;
      case 'angler': n = 6; segK = .55; R0 *= 1.15; P = { rh:.95, pm:.25, rt:.2, pw:.8 }; tailK = .9; sp = .6; g.lure = { len:R0 * 2.2, n:4, tip: pick(rng, [42, 64, 164]), f: rr(rng, 1.5, 3) }; g.eye = { code:46, n:2 }; break;
      case 'betta': tail = 'fan'; tailK = 1.9; sp = .75; g.fins = [{ at:2, len:1.7, r0:.2, r1:.34, open:1.1, tuck:.6 }, { at:4, len:1.4, r0:.18, r1:.3, open:.9, tuck:.5 }];
        g.strands.push({ at:'tail', count:3, spread:.5, n:6, seg:R0 * .5, v0:.8, v1:.25, drift:18 }); break;
    }
    if (rng() < .2 && form !== 'squid' && form !== 'ray') g.strands.push({ at:0, fwd:true, pair:true, ang: rr(rng, .8, 1.3), n:4, seg:R0 * .4, v0:.8, v1:.3, drift:22 });      // barbels
    if (form === 'torpedo' && rng() < .4) tail = pick(rng, ['lunate', 'fan']);
    if (W.long) n = Math.round(n * 1.4); if (W.short) n = Math.max(5, Math.round(n * .7)); if (W.fat) R0 *= 1.3; if (W.thin) R0 *= .72; if (W.spiky) g.frill = { every:1 };
    const waves = .9, seg = R0 * segK, lam = (n - 1) * seg / waves, speed = rr(rng, 46, 66) * t.pace * sp * Math.pow(t.size, .35), slip = .75;
    for (const f of g.fins){ f.len *= R0; f.r0 *= R0; f.r1 *= R0; f.at = Math.min(f.at, n - 2); }
    if (tail) g.tail = { swing:.55, lobes: tailLobes(rng, tail, R0 * tailK, R0 * .38) };
    return Object.assign(g, { mode:'swim', n, seg, prof:{ rh:R0 * P.rh, R:R0, pm:P.pm, rt:R0 * P.rt, pw:P.pw }, speed, turn:.9, bend:.5, slip, lam, fB:1.15 * speed / (slip * lam),
      idle, burst, coast, acc:3.2, drag:.9, wave:{ a0:R0 * .05, a1: fitWave(R0 * aK, seg, n, waves), pw:1.8, k:TAU * waves / (n - 1) } });
  },
  lizard(rng, t, W){                                             // trot: diagonal feet move together and the trunk bends with them
    const form = pick(rng, ['gecko', 'skink', 'monitor', 'axolotl', 'horned', 'newt']), g = common('lizard', form, t);
    let R0 = rr(rng, 10, 13) * t.size, n = 16, P = { rh:.9, R:1.05, pm:.3, rt:.1, pw:.6 }, legK = 1, sp = 1, aT = .6;
    g.eye = { code: pick(rng, [111, 111, 79, 42]), n:2 }; g.prints = true; g.tongue = R0 * 1.7;
    switch (form){
      case 'gecko': n = 13; P = { rh:1.15, R:1.05, pm:.3, rt:.3, pw:1 }; legK = 1.1; break;
      case 'skink': n = 22; R0 *= .8; P = { rh:.85, R:1, pm:.25, rt:.1, pw:.8 }; legK = .7; aT = .8; break;
      case 'monitor': n = 21; P = { rh:.8, R:1.05, pm:.28, rt:.08, pw:.55 }; g.tongue = R0 * 2.6; sp = 1.1; break;
      case 'axolotl': n = 14; P = { rh:1.1, R:1, pm:.25, rt:.15, pw:.8 }; sp = .6; g.tongue = 0; g.prints = false;
        g.strands.push({ at:1, pair:true, count:3, ang:1.15, n:3, seg:R0 * .45, v0:.95, v1:.45, drift:8, idle:2.2, accent:true }); g.tail = { swing:.5, lobes:[{ a:0, len:R0 * 1.3, r:R0 * .45 }] }; break;
      case 'horned': P.rh = 1.1; g.frill = { every:2 }; g.ant = { len:R0 * 1.3, n:2, splay:.7, tip:39 }; break;
      case 'newt': n = 18; R0 *= .85; sp = .8; g.tail = { swing:.6, lobes:[{ a:0, len:R0 * 1.6, r:R0 * .3 }] }; break;
    }
    if (W.long) n = Math.round(n * 1.35); if (W.short) n = Math.round(n * .75); if (W.fat) R0 *= 1.3; if (W.thin) R0 *= .75; if (W.spiky) g.frill = { every:1 };
    n = fitLen(clamp(n, 10, 30), R0 * .8, 10);
    const seg = R0 * .8, sh = Math.max(2, Math.round(n * .19)), hip = Math.max(sh + 2, Math.round(n * .44)), trunk = hip - sh, swing = .38, k = TAU / (2 * trunk), mid = Math.round((sh + hip) / 2);
    const legs = legSet([{ i:sh, side:-1, off:0 }, { i:sh, side:1, off:.5 }, { i:hip, side:-1, off:.5 }, { i:hip, side:1, off:0 }],
      { l1:R0 * 1.5 * legK, l2:R0 * 1.7 * legK, reach:R0 * (1.3 + legK), cycle:R0 * 4.3 * legK, swing, foot:[42, 39], rb:R0 * P.R });
    return Object.assign(g, { mode:'crawl', n, seg, mid, prof:{ rh:R0 * P.rh, R:R0 * P.R, pm:P.pm, rt:Math.max(1.2, R0 * P.rt), pw:P.pw }, speed: Math.min(rr(rng, 60, 80) * t.pace * sp * Math.pow(t.size, .35), legs.cycle * 3.2), turn:.8, bend:.5,
      burst:[1.5, 4], coast:[.4, 1.4], legs, wave:{ a0:R0 * .18, a1: fitWave(R0 * aT, seg, n, (n - 1) / (2 * trunk)), pw:1.4, k, ph:-Math.PI / 2 - TAU * swing + k * mid } });
  },
  crawler(rng, t, W){                                            // a stepping wave runs down the legs, sides out of phase
    const form = pick(rng, ['centipede', 'centipede', 'millipede', 'beetle', 'isopod', 'silverfish']), g = common('crawler', form, t);
    let R0 = rr(rng, 9.5, 12) * t.size, n = Math.round(rr(rng, 16, 26)), segK = 1, every = 2, lag = rr(rng, .12, .2), L = { l1:1.3, l2:1.7, reach:2.3, cyc:3.2 }, P = { rh:1.15, pm:.05, rt:.7, pw:1 }, aK = [.25, .5], sp = 1, legsTo = 1;
    const swing = .4; g.eye = { code: pick(rng, [42, 42, 111, 39]), n:2 }; g.prints = true; g.ant = { len:R0 * 3.4, n:5, splay:.42, tip:176 };
    switch (form){
      case 'millipede': n = Math.round(rr(rng, 22, 36)); every = 1; lag = rr(rng, .06, .1); L = { l1:.9, l2:1.2, reach:1.9, cyc:2 }; sp = .55; g.bead = rr(rng, .08, .16); g.ant = { len:R0 * 1.4, n:3, splay:.5, tip:176 }; break;
      case 'beetle': n = Math.round(rr(rng, 6, 7)); R0 *= 1.45; segK = .8; every = 1; lag = .5; L = { l1:1.1, l2:1.3, reach:1.9, cyc:2.4 }; P = { rh:.7, pm:.55, rt:.6, pw:1 }; aK = [.03, .05]; legsTo = .7; g.out = 'hard'; g.ant = { len:R0 * 1.6, n:3, splay:.6, tip:176 }; break;
      case 'isopod': n = Math.round(rr(rng, 8, 12)); R0 *= 1.35; segK = .6; every = 1; lag = rr(rng, .1, .14); L = { l1:.8, l2:1, reach:1.75, cyc:1.6 }; P = { rh:.75, pm:.4, rt:.5, pw:1 }; aK = [.05, .12]; sp = .7; g.bead = .1; g.ant = { len:R0 * 1.2, n:3, splay:.7, tip:176 };
        g.strands.push({ at:'tail', count:2, spread:.5, n:3, seg:R0 * .4, v0:.8, v1:.4, drift:10 }); break;
      case 'silverfish': n = Math.round(rr(rng, 10, 14)); P = { rh:.9, pm:.2, rt:.15, pw:1 }; lag = .5; legsTo = .5; sp = 1.3; aK = [.1, .45]; g.ant = { len:R0 * 4.5, n:6, splay:.35, tip:39 };
        g.strands.push({ at:'tail', count:3, spread:.45, n:6, seg:R0 * .55, v0:.8, v1:.3, drift:16 }); break;
    }
    if (W.long) n = Math.round(n * 1.5); if (W.short) n = Math.round(n * .6); if (W.fat) R0 *= 1.3; if (W.thin) R0 *= .75; if (W.spiky) g.frill = { every:1 };
    n = fitLen(clamp(n, 6, 44), R0 * segK, 6);
    const seg = R0 * segK, list = [], last = Math.max(2, Math.round((n - 2) * legsTo));
    for (let i = 1, j = 0; i <= last && i < n - 1; i += every, j++){ list.push({ i, side:-1, off:-j * lag }); list.push({ i, side:1, off:.5 - j * lag }); }
    const k = TAU * lag / every, legs = legSet(list, { l1:R0 * L.l1, l2:R0 * L.l2, reach:R0 * L.reach, cycle:R0 * L.cyc, swing, foot:[39, 96], rb:R0 * Math.max(1, P.rh) * (1 + (g.bead || 0)) });
    legs.lag = lag; legs.every = every;
    return Object.assign(g, { mode:'crawl', n, seg, prof:{ rh:R0 * P.rh, R:R0, pm:P.pm, rt:R0 * P.rt, pw:P.pw }, speed: Math.min(rr(rng, 48, 66) * t.pace * sp * Math.pow(t.size, .35), legs.cycle * 3.6), turn:.8, bend:.42,
      burst:[2, 5], coast:[.3, 1.2], legs, wave:{ a0:R0 * aK[0], a1: fitWave(R0 * aK[1], seg, n, (n - 1) * k / TAU), pw:1, k, ph:-Math.PI / 2 - TAU * (swing + (1 - swing) / 2) + k } });
  },
  jelly(rng, t, W){
    const form = pick(rng, ['moon', 'lion', 'lion', 'box', 'comet', 'bloom']), g = common('jelly', form, t);
    let a = rr(rng, 30, 50) * t.size, ratio = rr(rng, .72, .95), tn = Math.round(rr(rng, 5, 8)), tl = Math.round(rr(rng, 9, 13)), tsK = .3, an = Math.round(rr(rng, 2, 3)), al = 7, fq = rr(rng, .42, .62), sp = 1;
    switch (form){
      case 'moon': ratio = rr(rng, .42, .62); tn = Math.round(rr(rng, 9, 14)); tl = Math.round(rr(rng, 4, 6)); tsK = .16; an = 4; al = 4; fq = rr(rng, .5, .7); break;
      case 'lion': tn = Math.round(rr(rng, 6, 10)); tl = Math.round(rr(rng, 12, 20)); an = Math.round(rr(rng, 3, 5)); al = Math.round(rr(rng, 8, 12)); break;
      case 'box': a *= .75; ratio = rr(rng, 1.1, 1.35); tn = 4; tl = Math.round(rr(rng, 10, 16)); an = 0; fq = rr(rng, .8, 1.1); sp = 1.5; break;
      case 'comet': a *= .7; tn = Math.round(rr(rng, 2, 3)); tl = Math.round(rr(rng, 18, 26)); an = 1; break;
      case 'bloom': tn = 0; an = Math.round(rr(rng, 5, 7)); al = Math.round(rr(rng, 6, 9)); ratio = rr(rng, .6, .8); break;
    }
    if (W.long) tl = Math.round(tl * 1.6); if (W.short) tl = Math.max(3, Math.round(tl * .5)); if (W.fat) ratio *= .75; if (W.thin) ratio *= 1.3;
    return Object.assign(g, { a, b:a * ratio, freq:fq * Math.pow(t.size, -.4) * clamp(t.pace, .7, 1.4), speed: rr(rng, 13, 20) * sp * t.pace * Math.pow(t.size, .35), tn, tl, ts:a * tsK, an, al, as:a * .26,
      armGlyphs: codes(pick(rng, ['}{', 'S$', ')(', '%:', '&;', '~s', '{(', '§:'])), rim: codes(pick(rng, ['wv', 'wv', 'mn', 'uU', '^v', '~-'])),
      bell:{ t:JELLY, c:codes(pick(rng, ['@:', 'O:', '%.', '*:', '8;', 'o.'])), rings: rr(rng, 3, 5.5), canals: rr(rng, 2.4, 5) }, out: pick(rng, ['soft', 'soft', 'clean', 'round']) });
  },
  butterfly(rng, t, W){                                          // seen from above: wings foreshorten as they rise
    const form = pick(rng, ['classic', 'classic', 'swallowtail', 'moth', 'skipper', 'atlas', 'glasswing']), g = common('butterfly', form, t);
    let L = rr(rng, 48, 62) * t.size, fw = { len:1, chord: rr(rng, .58, .7), sweep: rr(rng, .25, .4) }, hw = { len: rr(rng, .66, .78), chord: rr(rng, .5, .6), sweep:-rr(rng, .45, .65) };
    let hz = rr(rng, 3.6, 4.8), sp = 1, perch = [2.5, 5], eyeF = rng() < .6, eyeH = rng() < .6, cell = pick(rng, [':\'', '.:', '=-', ';,', '~-', '\':.', 'oO']);
    switch (form){
      case 'swallowtail': hw.tip = { len:.55, r0:.07, r1:.035, ang:-1.25 }; fw.sweep = rr(rng, .35, .5); break;
      case 'moth': fw = { len:1, chord:.5, sweep:-rr(rng, .05, .25) }; hw = { len:.55, chord:.45, sweep:-rr(rng, .7, .9) }; hz *= .8; perch = [4, 8]; g.pale = g.pale || rng() < .4; break;
      case 'skipper': L *= .62; fw.chord = .45; hz = rr(rng, 6, 7.5); sp = 1.35; break;
      case 'atlas': L *= 1.25; fw.tip = { len:.42, r0:.2, r1:.07, ang:.55 }; hz = rr(rng, 2.6, 3.2); sp = .8; break;
      case 'glasswing': cell = '. '; eyeF = eyeH = false; break;
    }
    if (W.fat){ fw.chord *= 1.25; hw.chord *= 1.25; } if (W.thin){ fw.chord *= .75; hw.chord *= .75; } if (W.long && !hw.tip) hw.tip = { len:.6, r0:.07, r1:.035, ang:-1.25 };
    const fl = Math.min(7.5, hz * Math.pow(t.size, -.5)), seg = L * .15, margin = codes(pick(rng, ['%o', '#:', '8.', '&,', '*.', '=-'])), ring = pick(rng, [79, 111, 48, 42]), ex = rr(rng, .1, .35);
    const wing = (w, at, eye) => ({ len:L * w.len, chord:L * w.chord, sweep:w.sweep, at, gap:1, tip: w.tip ? { len:L * w.tip.len, r0:L * w.tip.r0, r1:L * w.tip.r1, ang:w.tip.ang } : null,
      skin:{ t:WING, c:codes(cell), m:margin, eye: eye ? [64, ring] : null, ex } });
    return Object.assign(g, { flight:'flutter', n:4, seg, speed: rr(rng, 55, 75) * t.pace * sp * Math.pow(t.size, .35), turn:1, fw: wing(fw, seg * .4, eyeF), hw: wing(hw, -seg * .7, eyeH),
      flapHz:fl, baskHz: rr(rng, .35, .55), thOpen:.14, thShut:1.36, thGlide:.42, surge:.9, jink:.85, shimmy:36, acc:3.4 * fl, brake:1.7 * fl,
      fly:[7, 14], perch, glide:[.25, .7], flapRun:[.7, 1.8], out:'wing', fillV:.55, ant:{ len:L * .4, n:3 }, dust:true, body:[111, 56] });
  },
  dragonfly(rng, t, W){                                          // hovers, pivots, then darts in a straight line
    const form = pick(rng, ['hawker', 'hawker', 'damsel', 'darter']), g = common('dragonfly', form, t);
    let L = rr(rng, 36, 46) * t.size, n = 8, chord = .2, sF = .14, sH = -.2, sp = 1, hover = [.7, 1.7];
    if (form === 'damsel'){ L *= .82; n = 9; chord = .14; sF = -.3; sH = -.5; sp = .6; hover = [1, 2.2]; }
    else if (form === 'darter'){ L *= .8; n = 6; chord = .27; sp = 1.15; hover = [.5, 1.2]; }
    if (W.long) n += 3; if (W.fat) chord *= 1.4;
    const seg = L * .16, skin = { t:WING, c:codes(pick(rng, ['-~', '=-', '.-', '~\''])), m:codes(pick(rng, ['=-', '-=', '~-'])), eye:null, ex:0 };
    return Object.assign(g, { flight:'dart', n, seg, speed: rr(rng, 190, 250) * sp * clamp(t.pace, .7, 1.4) * Math.pow(t.size, .3), turn:.6,
      fw:{ len:L, chord:L * chord, sweep:sF, at:seg * .3, gap:1, tip:null, skin }, hw:{ len:L * .94, chord:L * chord * 1.1, sweep:sH, at:-seg * .8, gap:1, tip:null, skin },
      flapHz:11, thOpen:.08, hover, dart:[.25, .55], acc:9, brake:10, out:'buzz', edgeV:.9, body:[79, 35], twd: Math.max(t.twd, .04) });
  },
  wisp(rng, t, W){
    const form = pick(rng, ['mote', 'mote', 'comet', 'swarm']), g = common('wisp', form, t);
    let n = 7, seg = 6, sp = 1;
    if (form === 'comet'){ n = Math.round(rr(rng, 12, 16)); seg = 7; sp = 1.2; }
    else if (form === 'swarm'){ n = 4; sp = .7; g.swarm = { k: Math.round(rr(rng, 3, 6)), rad: rr(rng, 12, 24) * t.size }; }
    return Object.assign(g, { mode:'swim', n, seg: seg * clamp(t.size, .7, 1.5), prof:{ rh:1, R:1, pm:.5, rt:1, pw:1 }, speed: rr(rng, 60, 90) * t.pace * sp, turn:1.7, bend:.9,
      slip:.7, lam:30, fB:1.6, idle:.25, burst:[.3, .9], coast:[.4, 1.4], acc:4, drag:2, wave:{ a0:0, a1:3, pw:1, k:.9 },
      thin:codes(pick(rng, ['@*+::..', 'O*+:..', '#*=:-.', '0o°·..', '@%*+:.'])), blinkF: rr(rng, 1.4, 2.6), embers:true, twd:0, glow: Object.assign({}, t.glow, { lb:t.glow.lb * .42, la:t.glow.la * .4 }) });
  },
};
const KINDS = Object.keys(SPECIES);

/* ───────────── anything with a spine: serpent, fish, lizard, crawler, wisp ───────────── */
function usePen(c, g, k, len){                                   // load a creature's glow, twinkle and hue drift into the pen
  const G = g.glow; LB = G.lb; LA = G.la; LK = G.k * k; LP = T * G.w + c.ph; LS = G.sharp; LF = c.flash * .7 + c.near * .45;
  if (G.strobe){ const b = Math.max(0, Math.sin(T * G.strobe + c.ph)); LF += Math.pow(b, 8) * .9; }
  GR = g.grad ? g.grad * .2 / len : 0; CID = c.id; TWS = c.tw; TWK = c.k3; TWD = g.twd * (1 + c.flash * 5 + c.near * 2);
}
class Spined {
  constructor(g, x, y, rng, head){
    this.g = g; this.rng = rng; this.id = uid++; const n = g.n; this.ph = rng() * TAU; this.head = head == null ? rng() * TAU : head;
    this.bx = new Float32Array(n); this.by = new Float32Array(n); this.px = new Float32Array(n); this.py = new Float32Array(n); this.r = new Float32Array(n);
    this.k = g.pale ? WHITE : hk(g.hue); this.k2 = hk(g.hue2); this.k3 = hk(g.hue3);
    this.v = g.speed * U * .6; this.eff = .5; this.burst = true; this.gaitT = rr(rng, .3, 2); this.gp = rng(); this.wph = g.legs ? TAU * this.gp + g.wave.ph : rng() * TAU; this.amp = g.legs ? 1 : .6; this.turnS = 0;
    this.flash = 0; this.flashT = rr(rng, 3, 10); this.near = 0; this.emitT = rr(rng, .5, 3); this.tongueT = rr(rng, 1, 4); this.tongueU = 0;
    this.st = { k:this.k, k2:this.k2, k3:this.k3, skin:g.skin, out:OUTS[g.out] || OUTS.soft, fillV:g.fillV, edgeV:g.edgeV };
    this.tw = codes(g.tw);
    if (g.legs) this.legs = g.legs.list.map(l => ({ i:l.i, side:l.side, off:l.off, fx:0, fy:0, sx:0, sy:0, hx:0, hy:0, sw:false, fixT:0, rho:1, nx:0, ny:0 }));
    this.strands = [];
    for (const sp of g.strands || []){                           // whiskers, gills, streamers, tentacles: each a strand hung at an angle
      const angs = [], c = sp.count || 1;
      if (sp.pair) for (let j = 0; j < c; j++){ angs.push(sp.ang + j * .28); angs.push(-(sp.ang + j * .28)); }
      else for (let j = 0; j < c; j++) angs.push(c > 1 ? (j / (c - 1) * 2 - 1) * sp.spread : 0);
      for (const a of angs) this.strands.push({ sp, a, s:new Strand(sp.n, sp.seg * U, rr(rng, -.8, .8)) });
    }
    this.place(x, y);
  }
  get x(){ return this.px[0]; } get y(){ return this.py[0]; }
  place(x, y){
    const g = this.g, n = g.n, c = Math.cos(this.head), s = Math.sin(this.head), seg = g.seg * U, bead = g.bead || 0;
    for (let i = 0; i < n; i++){ this.bx[i] = this.px[i] = x - c * seg * i; this.by[i] = this.py[i] = y - s * seg * i; this.r[i] = profile(g.prof, i / (n - 1)) * U * (1 + bead * Math.cos(Math.PI * i)); }
    this.pose(); for (const q of this.strands) q.s.live = false;
    if (this.legs) this.plantLegs();
  }
  /* The displayed chain is the base path with the travelling wave laid across it. Joints are marched along that
     wavy curve one exact segment at a time, so the wave stays local: a wiggle at the neck cannot swing the tail,
     however tightly the body is curled, and a body that undulates harder simply covers less of its path. */
  wavePoint(t){
    const g = this.g, m1 = g.n - 1, seg = g.seg * U, W = g.wave, j = Math.min(m1 - 1, t | 0), f = t - j, bx = this.bx, by = this.by;
    const fx = (bx[j] - bx[j+1]) / seg, fy = (by[j] - by[j+1]) / seg, off = (W.a0 + (W.a1 - W.a0) * Math.pow(Math.min(1, t / m1), W.pw)) * this.amp * U * Math.sin(this.wph - W.k * t);
    DX = bx[j] - fx * seg * f - fy * off; DY = by[j] - fy * seg * f + fx * off;
  }
  pose(){
    const g = this.g, n = g.n, m1 = n - 1, px = this.px, py = this.py, seg = g.seg * U, W = g.wave, amp = this.amp * U;
    this.wavePoint(0); px[0] = DX; py[0] = DY; let t = 0;
    for (let i = 1; i < n; i++){
      const sl = W.k * (W.a0 + (W.a1 - W.a0) * Math.pow(Math.min(1, t / m1), W.pw)) * amp / seg, rate = seg * Math.sqrt(1 + sl * sl * .5), lo = t + .05;
      t += seg / rate;                                             // may run just past the last base joint on a tight curl: the path continues straight
      for (let it = 0; it < 3; it++){ this.wavePoint(t); t = Math.max(lo, t - (Math.hypot(DX - px[i-1], DY - py[i-1]) - seg) / rate); }
      this.wavePoint(t); const dx = DX - px[i-1], dy = DY - py[i-1], d = Math.hypot(dx, dy) || 1; px[i] = px[i-1] + dx / d * seg; py[i] = py[i-1] + dy / d * seg;
    }
  }
  frame(i){                                                      // unit vector toward the head at joint i
    const px = this.px, py = this.py, n = this.g.n, i0 = i > 0 ? i - 1 : 0, i1 = i < n - 1 ? i + 1 : n - 1;
    let fx = px[i0] - px[i1], fy = py[i0] - py[i1]; const fl = Math.hypot(fx, fy) || 1; FX = fx / fl; FY = fy / fl;
  }
  legFrame(L){                                                   // where a leg hangs from, and its neutral footing
    this.frame(L.i); const i = L.i, qx = -FY * L.side, qy = FX * L.side, reach = this.g.legs.reach * U;
    L.hx = this.px[i] + qx * this.r[i] * .7; L.hy = this.py[i] + qy * this.r[i] * .7;
    return [FX, FY, this.px[i] + qx * reach, this.py[i] + qy * reach];
  }
  plantLegs(){
    const lg = this.g.legs, cyc = lg.cycle * U, sf = lg.swing, st = (1 - sf) * cyc;
    for (const L of this.legs){
      const [fx, fy, hx, hy] = this.legFrame(L), q = frac(this.gp + L.off), along = q < sf ? -st * .5 : st * .5 - (q - sf) * cyc;
      L.fx = L.sx = hx + fx * along; L.fy = L.sy = hy + fy * along; L.sw = q < sf; L.fixT = 0; L.rho = 1; L.nx = this.px[L.i]; L.ny = this.py[L.i];
    }
  }
  update(dt){
    const g = this.g, n = g.n, rng = this.rng, bx = this.bx, by = this.by, px = this.px, py = this.py, hx = bx[0], hy = by[0], vmax = g.speed * U;
    let turn = steer(this, hx, hy, this.head, g.turn);
    this.gaitT -= dt;
    if (this.gaitT <= 0){ this.burst = !this.burst; const d = this.burst ? g.burst : g.coast; this.gaitT = rr(rng, d[0], d[1]); }
    if (g.mode === 'swim'){                                      // effort drives the body wave at once; speed follows with lag, then coasts
      const eT = this.burst ? 1 : g.idle; this.eff += (eT - this.eff) * Math.min(1, dt * (eT > this.eff ? 5 : 2));
      const vT = vmax * (.3 + .85 * this.eff); this.v += (vT - this.v) * Math.min(1, dt * (vT > this.v ? g.acc : g.drag));
      this.amp = .3 + .7 * this.eff; this.wph += TAU * g.fB * (.3 + .7 * this.eff) * dt;
    } else {                                                     // walkers: the gait clock is distance travelled, and the spine wave is locked to it
      const vT = this.burst ? vmax : 0; this.v += (vT - this.v) * Math.min(1, dt * (vT > this.v ? 4 : 6));
      this.gp += this.v * dt / (g.legs.cycle * U); this.amp = 1; this.wph = TAU * this.gp + g.wave.ph;   // amplitude held: relaxing the wave would drag the hips off planted feet
      turn *= Math.min(1, this.v / (vmax * .3));                 // no spinning on the spot
    }
    const tmax = g.legs ? clamp(this.v / ((g.legs.reach + g.prof.R + g.seg) * U), .25, 2.4)     // walkers turn about a circle wider than their reach
      : clamp(this.v / (g.prof.R * U * 2 + g.seg * U), .5, 2.4);                // a big body sweeps a wide arc; only small ones can turn on a coin
    turn = clamp(turn, -tmax, tmax); this.turnS += (turn - this.turnS) * Math.min(1, dt * 4); this.head += turn * dt;
    bx[0] = hx + Math.cos(this.head) * this.v * dt; by[0] = hy + Math.sin(this.head) * this.v * dt;
    if (WALLS){ hold(this, bx[0], by[0], Math.min(this.r[0], 2 * ch) + ch * 1.5); bx[0] = HX; by[0] = HY; }
    let pa = this.head; const seg = g.seg * U;
    for (let i = 1; i < n; i++){                                 // base chain: every joint follows the one ahead, with a bend limit
      let a = Math.atan2(by[i-1] - by[i], bx[i-1] - bx[i]); const d = angDiff(a, pa);
      if (d > g.bend) a = pa + g.bend; else if (d < -g.bend) a = pa - g.bend;
      bx[i] = bx[i-1] - Math.cos(a) * seg; by[i] = by[i-1] - Math.sin(a) * seg; pa = a;
    }
    this.pose(); const W = g.wave;
    for (const q of this.strands){                               // strands hang off a joint and take the body's wave as their sway
      const sp = q.sp, i = sp.at === 'tail' ? n - 1 : sp.at; this.frame(i);
      const bxx = sp.fwd ? FX : -FX, byy = sp.fwd ? FY : -FY, ca = Math.cos(q.a), sa = Math.sin(q.a), dx = bxx * ca - byy * sa, dy = bxx * sa + byy * ca, o = this.r[i] * .7;
      q.s.update(px[i] + dx * o, py[i] + dy * o, dx, dy, dt, sp.drift * U, (sp.sway || 12) * U, this.wph - W.k * i + T * (sp.idle || 0));
    }
    if (this.legs){
      const lg = g.legs, cyc = lg.cycle * U, sf = lg.swing, st = (1 - sf) * cyc, maxLen = (lg.l1 + lg.l2) * U * .97;
      for (const L of this.legs){
        const [fx, fy, homeX, homeY] = this.legFrame(L), q = frac(this.gp + L.off), step = this.v * dt;
        if (step > .01) L.rho += (clamp(Math.hypot(px[L.i] - L.nx, py[L.i] - L.ny) / step, .15, 1.3) - L.rho) * Math.min(1, dt * 8);   // this joint's ground speed ÷ the head's
        L.nx = px[L.i]; L.ny = py[L.i];
        if (q < sf){                                             // swing: fly to where the foot must be by the time it lands
          if (!L.sw){ L.sw = true; L.sx = L.fx; L.sy = L.fy; L.fixT = 0; }
          const u = q / sf, ahead = (st * .5 + (1 - u) * sf * cyc) * L.rho, e = smooth(u);
          L.fx = lerp(L.sx, homeX + fx * ahead, e); L.fy = lerp(L.sy, homeY + fy * ahead, e);
        } else {                                                 // stance: the foot does not move
          if (L.sw){ L.sw = false; if (g.prints && this.v > vmax * .2) emit(L.fx, L.fy, 0, 0, 1.5, this.k2, PRINT, .4); }
          if (!L.fixT && Math.hypot(L.fx - L.hx, L.fy - L.hy) > maxLen){ L.fixT = 1e-6; L.sx = L.fx; L.sy = L.fy; }
          if (L.fixT){                                           // over-stretched by a hard turn: one quick corrective step
            L.fixT += dt / .12; const e = smooth(Math.min(1, L.fixT)), along = (st * .5 - (q - sf) * cyc) * L.rho;
            L.fx = lerp(L.sx, homeX + fx * along, e); L.fy = lerp(L.sy, homeY + fy * along, e); if (L.fixT >= 1) L.fixT = 0;
          }
        }
      }
    }
    if (g.tongue){ this.tongueT -= dt; if (this.tongueT < 0){ this.tongueT = rr(rng, 2.5, 6); this.tongueU = 1; } if (this.tongueU > 0) this.tongueU = Math.max(0, this.tongueU - dt / .32); }
    this.emitT -= dt;
    if (this.emitT < 0){
      if (g.bubbles){ this.emitT = rr(rng, 1.2, 4.5); emit(px[0], py[0], rr(rng, -4, 4) * U, -rr(rng, 10, 16) * U, rr(rng, 1.6, 2.6), hk(195), BUBBLE, .8); }
      else if (g.embers){ this.emitT = rr(rng, .12, .4); emit(px[n-1], py[n-1], rr(rng, -3, 3) * U, rr(rng, -6, 1) * U, rr(rng, .7, 1.3), this.k, EMBER, .6); }
      else this.emitT = 9;
    }
    glowState(this, px[0], py[0], dt, 2.6);
  }
  draw(){
    const g = this.g, n = g.n, px = this.px, py = this.py, r = this.r, k = this.k, k2 = this.k2;
    usePen(this, g, 1, n - 1);
    if (g.thin){                                                 // wisps: a blinking mote, its tail, and sometimes a few companions
      const b = Math.max(0, Math.sin(T * g.blinkF + this.ph)); LF += b * b * b * b * 1.05;
      for (let i = n - 2; i >= 0; i--) line(px[i], py[i], px[i+1], py[i+1], k, 1 - i / n, 1 - (i + 1) / n, i, i + 1, g.thin[Math.min(i, g.thin.length - 1)]);
      if (g.swarm) for (let q = 0; q < g.swarm.k; q++){
        const h = hash3(q, this.id, 3), a = T * (1.2 + h * 2.2) * (q & 1 ? 1 : -1) + h * TAU, rad = g.swarm.rad * U * (.5 + .5 * hash3(q, this.id, 5)), bl = Math.max(0, Math.sin(T * (1.5 + h * 2) + h * 9));
        dot(px[0] + Math.cos(a) * rad, py[0] + Math.sin(a) * rad * .8, bl > .8 ? 42 : bl > .4 ? 43 : 46, .35 + bl * bl * 1.1, q % 3 ? k : this.k3, true);
      }
      return;
    }
    this.frame(0); const fx = FX, fy = FY;
    for (const q of this.strands) q.s.draw(q.sp.accent ? this.k3 : k2, q.sp.v0, q.sp.v1, q.sp.at === 'tail' ? n - 1 : q.sp.at, .5, null);
    if (this.legs){
      const lg = g.legs, l1 = lg.l1 * U, l2 = lg.l2 * U;
      for (const L of this.legs){
        const dx = L.fx - L.hx, dy = L.fy - L.hy, d = Math.hypot(dx, dy) || 1, dm = Math.min(d, l1 + l2 - .5);
        const ex = L.hx + dx / d * dm, ey = L.hy + dy / d * dm, a0 = Math.atan2(dy, dx), a = Math.acos(clamp((l1 * l1 + dm * dm - l2 * l2) / (2 * l1 * dm), -1, 1));
        const i = L.i, bx = px[i-1] - px[i], by = py[i-1] - py[i];
        let ka = a0 + a; if (Math.cos(ka) * bx + Math.sin(ka) * by < Math.cos(a0 - a) * bx + Math.sin(a0 - a) * by) ka = a0 - a;   // knees point forward
        const kx = L.hx + Math.cos(ka) * l1, ky = L.hy + Math.sin(ka) * l1;
        line(L.hx, L.hy, kx, ky, k2, .85, .8, i, i + .5, 0); line(kx, ky, ex, ey, k2, .8, .7, i + .5, i + 1, 0);
        dot(ex, ey, lg.foot[L.sw ? 1 : 0], .95 * lum(i + 1), k);
      }
    }
    if (g.ant){
      const base = Math.atan2(fy, fx), sl = g.ant.len * U / g.ant.n, still = 1 - Math.min(1, this.v / (g.speed * U));
      for (let sd = -1; sd <= 1; sd += 2){
        let ax = px[0] + fx * r[0] * .6, ay = py[0] + fy * r[0] * .6;
        for (let j = 0; j < g.ant.n; j++){
          const a = base + sd * (g.ant.splay + .1 * j) + Math.sin(T * (3.1 + still * 3) + j * .7 + sd + this.ph) * (.2 + still * .25);
          const bx = ax + Math.cos(a) * sl, by = ay + Math.sin(a) * sl; line(ax, ay, bx, by, k2, .8 - j * .1, .7 - j * .1, -j, -j - 1, 0); ax = bx; ay = by;
        }
        dot(ax, ay, g.ant.tip, .9, this.k3);
      }
    }
    if (g.lure){                                                 // a lamp on a stalk: the brightest thing on the animal
      const base = Math.atan2(fy, fx), sl = g.lure.len * U / g.lure.n; let ax = px[0] + fx * r[0] * .7, ay = py[0] + fy * r[0] * .7;
      for (let j = 0; j < g.lure.n; j++){ const a = base + Math.sin(T * 1.7 + j * .9 + this.ph) * .3 * (j + 1) / g.lure.n, bx = ax + Math.cos(a) * sl, by = ay + Math.sin(a) * sl; line(ax, ay, bx, by, k2, .6, .6, 0, 0, 0); ax = bx; ay = by; }
      const b = .5 + .5 * Math.sin(T * g.lure.f + this.ph); dot(ax, ay, g.lure.tip, 1.2 + .45 * b * b, this.k3, true);
    }
    if (this.tongueU > 0){
      const len = Math.sin(this.tongueU * Math.PI) * g.tongue * U, sx = px[0] + fx * r[0], sy = py[0] + fy * r[0], ex = sx + fx * len, ey = sy + fy * len;
      line(sx, sy, ex, ey, hk(348), 1, 1, 0, 0, 0); dot(ex, ey, Math.abs(fx) > Math.abs(fy) ? (fx > 0 ? 60 : 62) : (fy > 0 ? 94 : 89), 1.1, hk(348), true);
    }
    beginShape();
    for (let i = 0; i < n - 1; i++) capsule(px[i], py[i], r[i], px[i+1], py[i+1], r[i+1], i, i + 1);
    if (g.tail){                                                 // the fin carries the body wave on, a beat late
      const ba = Math.atan2(py[n-1] - py[n-2], px[n-1] - px[n-2]) + g.tail.swing * this.amp * Math.sin(this.wph - g.wave.k * (n - 1) - 1);
      for (const lb of g.tail.lobes){ const a = ba + lb.a, len = lb.len * U; capsule(px[n-1], py[n-1], r[n-1] + 1, px[n-1] + Math.cos(a) * len, py[n-1] + Math.sin(a) * len, lb.r * U, n - 1, n + 1); }
    }
    if (g.fins) for (const f of g.fins){                         // spread to glide and steer, tucked while the tail works; some beat like wings
      const i = f.at; let tx = px[i+1] - px[i], ty = py[i+1] - py[i]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl; const len = f.len * U, beat = f.flap ? f.flap * Math.sin(T * Math.PI * (f.ff || 1) + this.ph) : 0;
      for (let sd = -1; sd <= 1; sd += 2){
        const a = clamp(lerp(f.open, f.tuck, this.eff) + .16 * Math.sin(T * 5 + this.ph) * (1 - this.eff) + sd * this.turnS * .22 + beat, .2, 1.75);
        const dx = tx * Math.cos(a) + ty * sd * Math.sin(a), dy = ty * Math.cos(a) - tx * sd * Math.sin(a);
        capsule(px[i], py[i], f.r0 * U, px[i] + dx * (r[i] + len), py[i] + dy * (r[i] + len), f.r1 * U, i, i + 1.5);
      }
    }
    endShape(this.st);
    if (g.frill) for (let i = 2; i < n - 1; i += g.frill.every){ // spikes that point outward whichever way the body runs
      this.frame(i);
      for (let sd = -1; sd <= 1; sd += 2){ const qx = -FY * sd, qy = FX * sd, o = r[i] + cw * .9; dot(px[i] + qx * o, py[i] + qy * o, Math.abs(qy) * cw > Math.abs(qx) * ch * .5 ? (qy < 0 ? 94 : 118) : (qx < 0 ? 60 : 62), .8 * lum(i), this.k3); }
    }
    const E = g.eye, ei = E.rear ? n - 2 : 0; this.frame(ei);
    const blink = ((T * .31 + this.ph) % 4) < .1, eye = blink ? 45 : E.code, r0 = r[ei];
    if (E.n === 2 && r0 > cw * 1.2){ const qx = -FY * r0 * .55, qy = FX * r0 * .55, hx = px[ei] + FX * r0 * .1, hy = py[ei] + FY * r0 * .1; dot(hx + qx, hy + qy, eye, 1.35, WHITE, true); dot(hx - qx, hy - qy, eye, 1.35, WHITE, true); }
    else dot(px[ei], py[ei], eye, 1.35, WHITE, true);
  }
}
let FX = 1, FY = 0, DX = 0, DY = 0;

/* ───────────── jellyfish ───────────── */
class Jelly {
  constructor(g, x, y, rng, head){
    this.g = g; this.rng = rng; this.id = uid++; this.x = x; this.y = y; this.head = head == null ? -Math.PI / 2 + rr(rng, -.3, .3) : head; this.ph = rng() * TAU; this.phase = rng(); this.vel = 0; this.c = 0; this.cRim = 0;
    this.k = g.pale ? WHITE : hk(g.hue); this.k2 = hk(g.hue2); this.k3 = hk(g.hue3); this.flash = 0; this.flashT = rr(rng, 3, 9); this.near = 0; this.a = g.a * U; this.b = g.b * U;
    this.tent = []; for (let i = 0; i < g.tn; i++) this.tent.push({ f:(g.tn > 1 ? i / (g.tn - 1) * 2 - 1 : 0) * .86, s:new Strand(g.tl, g.ts * U, rr(rng, -.9, .9)) });
    this.arms = []; for (let i = 0; i < g.an; i++) this.arms.push({ f:(g.an > 1 ? i / (g.an - 1) * 2 - 1 : 0) * .3, s:new Strand(g.al, g.as * U, rr(rng, -.6, .6)) });
    this.st = { k:this.k, k2:this.k2, k3:this.k3, skin:g.bell, out:OUTS[g.out] || OUTS.soft, fillV:.62, edgeV:1, rim:g.rim };
    this.tw = codes(g.tw);
  }
  relax(){ for (const t of this.tent) t.s.live = false; for (const a of this.arms) a.s.live = false; }
  update(dt){
    const g = this.g, up = -Math.PI / 2;
    if (WALLS){                                                  // walled in: roam like the rest, leaning upward, and never leave
      const turn = steer(this, this.x, this.y, this.head, .3) + angDiff(up, this.head) * .1; this.head += clamp(turn, -1.1, 1.1) * dt;
      hold(this, this.x, this.y, Math.max(this.a, this.b) + ch * 1.5); this.x = HX; this.y = HY;
    } else {
      let want = up + (Math.sin(T * .23 + this.ph) * .3 + Math.sin(T * .51 + this.ph * 1.9) * .18);
      const m = 90 * U; if (this.x < m) want += .45; else if (this.x > GW - m) want -= .45;
      const reach = g.tl * g.ts * U + this.b;
      if (this.y < -reach){ this.y = GH + this.b + 4; this.x = GW * (.12 + .76 * this.rng()); this.relax(); }     // off the top: re-enter from below
      this.head += angDiff(want, this.head) * 1.4 * dt;
    }
    const before = this.phase % 1; this.phase += dt * g.freq; const p = this.phase % 1, pr = (p + .92) % 1;
    const pulse = q => q < .28 ? smooth(q / .28) : 1 - smooth((q - .28) / .72);
    this.c = pulse(p); this.cRim = pulse(pr);                    // the squeeze starts at the crown; the rim follows a beat later
    const thrust = p < .28 ? Math.sin(p / .28 * Math.PI) : 0;
    this.vel += (thrust * g.speed * U * 5 - this.vel * 1.8) * dt;
    const sp = this.vel + g.speed * U * .2, fx = Math.cos(this.head), fy = Math.sin(this.head), px = -fy, py = fx;
    this.x += fx * sp * dt; this.y += fy * sp * dt;
    this.a = g.a * U * (1 - .2 * this.cRim); this.b = g.b * U * (1 + .16 * this.c);
    const slack = 1 - clamp(this.vel / (g.speed * U * 1.4), 0, 1);                         // taut while surging, wafting while it glides
    for (const t of this.tent) t.s.update(this.x + px * this.a * t.f - fx * 2, this.y + py * this.a * t.f - fy * 2, -fx, -fy, dt, (10 + 14 * (1 - slack)) * U, (14 + 26 * slack) * U * g.freq * 2, TAU * this.phase);
    for (const a of this.arms) a.s.update(this.x + px * this.a * a.f - fx * 2, this.y + py * this.a * a.f - fy * 2, -fx, -fy, dt, 12 * U, (8 + 12 * slack) * U * g.freq * 2, TAU * this.phase - .8);
    if (p < before) for (let q = 0; q < 3; q++) emit(this.x + px * this.a * rr(this.rng, -.8, .8), this.y, -fx * 18 * U + rr(this.rng, -8, 8) * U, -fy * 18 * U + rr(this.rng, -6, 6) * U, rr(this.rng, 1, 1.8), this.k3, PLANK, .7);
    glowState(this, this.x, this.y, dt, 2.2);
  }
  draw(){
    usePen(this, this.g, 2.2, 6); LF += this.c * .22; TWD *= 1 + this.c;
    for (const t of this.tent) t.s.draw(this.k2, .85, .14, 1, .55, null);
    for (const a of this.arms) a.s.draw(this.k, 1, .4, 1, .55, this.g.armGlyphs);
    LK = this.g.glow.k * 5.2; beginShape(); ellipse(this.x, this.y, this.head, this.a, this.b, true); endShape(this.st);
  }
}

/* ───────────── winged things, seen from above: butterfly (flutter, glide, perch) and dragonfly (hover, dart) ───────────── */
class Flyer {
  constructor(g, x, y, rng, head){
    this.g = g; this.rng = rng; this.id = uid++; this.x = x; this.y = y; this.head = head == null ? rng() * TAU : head; this.ph = rng() * TAU; const n = g.n;
    this.bx = new Float32Array(n); this.by = new Float32Array(n);
    const c = Math.cos(this.head), s = Math.sin(this.head); for (let i = 0; i < n; i++){ this.bx[i] = x - c * g.seg * U * i; this.by[i] = y - s * g.seg * U * i; }
    this.k = g.pale ? WHITE : hk(g.hue); this.k2 = hk(g.hue2); this.k3 = hk(g.hue3); this.flash = 0; this.flashT = rr(rng, 3, 9); this.near = 0;
    this.v = 0; this.flap = rng(); this.th = g.thOpen; this.thH = g.thOpen; this.kick = 0; this.down = 0;
    this.perch = false; this.glide = false; this.dart = false; this.stT = rr(rng, 3, 8); this.modeT = rr(rng, .5, 1.5); this.aim = this.head;
    const out = OUTS[g.out];
    this.stF = { k:this.k, k2:this.k2, k3:this.k3, skin:g.fw.skin, out, fillV:g.fillV, edgeV:g.edgeV };
    this.stH = { k:g.pale ? WHITE : this.k2, k2:g.pale ? this.k2 : hk(g.hue), k3:this.k3, skin:g.hw.skin, out, fillV:g.fillV * .9, edgeV:g.edgeV * .9 };
    this.tw = codes(g.tw);
  }
  update(dt){
    const g = this.g, rng = this.rng; let turn = 0, vT = 0, thT = g.thOpen, rate = 40; this.down = 0;
    this.stT -= dt;
    if (g.flight === 'flutter'){
      if (this.stT <= 0){ this.perch = !this.perch; const d = this.perch ? g.perch : g.fly; this.stT = rr(rng, d[0], d[1]); this.glide = false; this.modeT = rr(rng, g.flapRun[0], g.flapRun[1]); }
      if (this.perch){                                           // settled: wings open and close slowly
        this.flap += g.baskHz * dt; thT = lerp(g.thOpen, g.thShut, .5 - .5 * Math.cos(TAU * this.flap)); rate = 10;
      } else {
        turn = steer(this, this.x, this.y, this.head, g.turn);
        this.modeT -= dt; if (this.modeT <= 0){ this.glide = !this.glide; const d = this.glide ? g.glide : g.flapRun; this.modeT = rr(rng, d[0], d[1]); if (!this.glide) this.flap = Math.ceil(this.flap); }
        if (this.glide){ thT = g.thGlide; vT = g.speed * U * .8; rate = 14; }
        else {
          const prev = this.flap; this.flap += g.flapHz * dt;
          thT = lerp(g.thOpen, g.thShut, .5 + .5 * Math.cos(TAU * this.flap));           // whole numbers = top of the stroke, wings together
          this.down = Math.max(0, Math.sin(TAU * this.flap)); vT = g.speed * U * (.6 + g.surge * this.down);      // the downstroke is what pushes
          if (Math.floor(this.flap) !== Math.floor(prev)){
            this.kick = rr(rng, -g.jink, g.jink);                // every beat knocks the heading a little
            if (g.dust){ const a = this.head + Math.PI / 2 * (rng() < .5 ? 1 : -1), d = g.fw.len * U * .7; emit(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d, rr(rng, -6, 6) * U, rr(rng, -2, 9) * U, rr(rng, .7, 1.3), this.k3, DUST, .7); }
          }
        }
      }
    } else {
      if (this.stT <= 0){
        this.dart = !this.dart; const d = this.dart ? g.dart : g.hover; this.stT = rr(rng, d[0], d[1]);
        if (!this.dart){                                         // pick the next line while hovering: one that stays on the board
          const m = 110 * U, reach = g.speed * U * .45; this.aim = Math.atan2(GH / 2 - this.y, GW / 2 - this.x) + rr(rng, -.5, .5);
          for (let q = 0; q < 8; q++){ const a = this.head + rr(rng, -2.6, 2.6), ex = this.x + Math.cos(a) * reach, ey = this.y + Math.sin(a) * reach; if (ex > m && ex < GW - m && ey > m && ey < GH - m){ this.aim = a; break; } }
        }
      }
      this.flap += g.flapHz * dt; thT = g.thOpen + .1 + .1 * Math.sin(TAU * this.flap); rate = 60;
      if (this.dart) vT = g.speed * U;                           // a dart is a straight line
      else { vT = g.speed * U * .02; if (this.v < g.speed * U * .12) turn = clamp(angDiff(this.aim, this.head), -.6, .6) * 6; }   // pivot once it has stopped
    }
    this.th += (thT - this.th) * Math.min(1, dt * rate); this.thH += (this.th - this.thH) * Math.min(1, dt * 22);
    this.v += (vT - this.v) * Math.min(1, dt * (vT > this.v ? g.acc : g.brake));
    turn += this.kick * 7; this.kick *= Math.exp(-dt * 7); this.head += clamp(turn, -5, 5) * dt;
    const lat = g.flight !== 'flutter' || this.perch || this.glide ? 0 : Math.sin(Math.PI * this.flap) * g.shimmy * U;   // slips sideways, alternating each beat
    const c = Math.cos(this.head), s = Math.sin(this.head), bx = this.bx, by = this.by, n = g.n, seg = g.seg * U;
    this.x += (c * this.v - s * lat) * dt; this.y += (s * this.v + c * lat) * dt;
    if (WALLS){ hold(this, this.x, this.y, g.fw.len * U * .75 + ch); this.x = HX; this.y = HY; }
    bx[0] = this.x; by[0] = this.y;
    let pa = this.head;
    for (let i = 1; i < n; i++){
      let a = Math.atan2(by[i-1] - by[i], bx[i-1] - bx[i]); const d = angDiff(a, pa);
      if (d > .16) a = pa + .16; else if (d < -.16) a = pa - .16;
      bx[i] = bx[i-1] - Math.cos(a) * seg; by[i] = by[i-1] - Math.sin(a) * seg; pa = a;
    }
    glowState(this, this.x, this.y, dt, 2.6);
  }
  span(){ return [Math.max(.12, Math.cos(this.th)), Math.max(.12, Math.cos(this.thH))]; }
  draw(){
    const g = this.g, bx = this.bx, by = this.by, n = g.n;
    usePen(this, g, 4.4, 1); TWD *= 1 + this.down;
    if (g.flight === 'dart') LF += (hash3((T * 30) | 0, this.id, 1) - .5) * .35;          // wings too fast to see: they shimmer instead
    let fx = bx[0] - bx[1], fy = by[0] - by[1]; const fl = Math.hypot(fx, fy) || 1; fx /= fl; fy /= fl;
    const nx = -fy, ny = fx, tx = bx[1], ty = by[1], sp = this.span();
    for (let pass = 0; pass < 2; pass++){                        // hindwings first, forewings over them
      const Wg = pass ? g.fw : g.hw, s = pass ? sp[0] : sp[1], cs = Math.cos(Wg.sweep), sn = Math.sin(Wg.sweep);
      for (let sd = -1; sd <= 1; sd += 2){
        const dx = nx * sd * cs + fx * sn, dy = ny * sd * cs + fy * sn, b = Wg.len * U * .5 * s, a = Wg.chord * U * .5, o = b + Wg.gap * U;
        const wx = tx + fx * Wg.at * U + dx * o, wy = ty + fy * Wg.at * U + dy * o;
        beginShape(); ellipse(wx, wy, Math.atan2(dy, dx), a, b, false);
        if (Wg.tip){                                               // a pointed tip or a trailing tail on the wing, folding with it
          const ct = Math.cos(Wg.tip.ang), st = Math.sin(Wg.tip.ang), ux = dx * ct + fx * st, uy = dy * ct + fy * st, len = Wg.tip.len * U * (.35 + .65 * s), sx = wx + dx * b * .5 + ux * a * .45, sy = wy + dy * b * .5 + uy * a * .45;
          capsule(sx, sy, Wg.tip.r0 * U, sx + ux * len, sy + uy * len, Wg.tip.r1 * U, .8, 1);
        }
        endShape(pass ? this.stF : this.stH);
      }
    }
    TWD = 0;
    for (let i = 1; i < n - 1; i++) line(bx[i], by[i], bx[i+1], by[i+1], this.k2, 1, .7, i, i + 1, 0);
    dot(bx[1], by[1], g.body[1], 1.1, this.k, true); dot(bx[0] + fx * cw * .4, by[0] + fy * ch * .4, g.body[0], 1.3, WHITE, true);
    if (g.ant){
      const base = Math.atan2(fy, fx), sl = g.ant.len * U / g.ant.n;
      for (let sd = -1; sd <= 1; sd += 2){
        let ax = bx[0] + fx * ch * .5, ay = by[0] + fy * ch * .5;
        for (let j = 0; j < g.ant.n; j++){ const a = base + sd * (.3 + .14 * j) + Math.sin(T * 2.3 + j + sd + this.ph) * .12; const ex = ax + Math.cos(a) * sl, ey = ay + Math.sin(a) * sl; line(ax, ay, ex, ey, this.k2, .8, .7, 0, 0, 0); ax = ex; ay = ey; }
        dot(ax, ay, 176, 1, this.k3, true);
      }
    }
  }
}

/* ───────────── tank ───────────── */
function build(g, x, y, rng, head){ return new (g.kind === 'jelly' ? Jelly : g.flight ? Flyer : Spined)(g, x, y, rng, head); }

/* text → creature. The text is the seed. Words it contains are taken literally: a base type, a colour, and a handful of
   plain descriptions. Symbols typed (anything that is not a letter or digit) become the skin; every character typed
   joins the set that twinkles through the creature. */
const HUEWORDS = { red:0, scarlet:6, crimson:350, orange:28, amber:38, gold:48, yellow:58, lime:88, green:125, emerald:140, mint:152, teal:172, aqua:182, cyan:186, sky:200, blue:218, navy:232, indigo:248, violet:268, purple:282, magenta:305, pink:328, rose:342 };
const KINDWORDS = { serpent:'serpent', snake:'serpent', eel:'serpent', worm:'serpent', dragon:'serpent', fish:'fish', koi:'fish', carp:'fish', minnow:'fish', squid:'fish', ray:'fish',
  jelly:'jelly', jellyfish:'jelly', medusa:'jelly', lizard:'lizard', gecko:'lizard', newt:'lizard', salamander:'lizard', axolotl:'lizard', crawler:'crawler', centipede:'crawler', millipede:'crawler', beetle:'crawler', bug:'crawler',
  butterfly:'butterfly', moth:'butterfly', dragonfly:'dragonfly', damselfly:'dragonfly', wisp:'wisp', firefly:'wisp', spark:'wisp' };
const SIZEWORDS = { tiny:.42, small:.6, little:.6, big:1.45, large:1.45, huge:1.75, giant:2.1 }, PACEWORDS = { slow:.55, lazy:.5, calm:.65, fast:1.6, quick:1.5, swift:1.7 };
const FLAGWORDS = { long:'long', short:'short', fat:'fat', thick:'fat', thin:'thin', slim:'thin', spiky:'spiky', spiny:'spiky', bright:'bright', dim:'dim', dark:'dim',
  sparkly:'sparkly', glitter:'sparkly', sparkle:'sparkly', ghost:'ghost', white:'ghost', pale:'ghost', rainbow:'rainbow', strobe:'strobe', blink:'strobe' };
function readText(text){
  text = String(text == null ? '' : text); let h = 2166136261; for (let i = 0; i < text.length; i++){ h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  const R = { seed: h | 0, kind:null, hue:null, size:0, pace:0, chars:[], syms:[] }, seen = new Set();
  for (const w of text.toLowerCase().split(/[^a-z]+/)){
    if (KINDWORDS[w]) R.kind = KINDWORDS[w]; if (w in HUEWORDS) R.hue = HUEWORDS[w]; if (SIZEWORDS[w]) R.size = SIZEWORDS[w]; if (PACEWORDS[w]) R.pace = PACEWORDS[w]; if (FLAGWORDS[w]) R[FLAGWORDS[w]] = true;
  }
  for (let i = 0; i < text.length; i++){
    const c = text.charCodeAt(i); if (!((c > 32 && c < 127) || (c > 160 && c < 256)) || seen.has(c)) continue; seen.add(c);
    if (R.chars.length < 10) R.chars.push(c);
    if (R.syms.length < 8 && !((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122))) R.syms.push(c);
  }
  return R;
}
function wear(g, R){
  if (R.chars.length) g.tw += String.fromCharCode(...R.chars.slice(0, 4));
  const sy = R.syms; if (!sy.length) return;
  const cyc = n => Array.from({ length:n }, (_, i) => sy[i % sy.length]);
  if (g.kind === 'jelly'){ g.bell = Object.assign({}, g.bell, { c: cyc(2) }); g.armGlyphs = cyc(Math.max(2, Math.min(3, sy.length))); }
  else if (g.thin) g.thin = cyc(5).concat([58, 46]);
  else if (g.fw){ for (const w of [g.fw, g.hw]) w.skin = Object.assign({}, w.skin, { c: cyc(Math.min(3, sy.length)), m: cyc(Math.min(4, sy.length)).reverse() }); }
  else g.skin = { t: g.skin.t === FLOW ? BANDS : g.skin.t, c: cyc(Math.max(2, Math.min(6, sy.length))), f: g.skin.f || 1, d: g.skin.d || .3 };
}
/* genome(base, text): traits come from the text alone, so a name keeps its size, colours and glow in any body;
   the body is drawn from the text and the base together. A base word in the text wins unless force is set. */
function genome(kind, text, force){
  const R = readText(text); if (!force && R.kind) kind = R.kind; if (!SPECIES[kind]) kind = R.kind || KINDS[(R.seed >>> 0) % KINDS.length];
  const t = traits(mulberry32(R.seed), R), g = SPECIES[kind](mulberry32(R.seed ^ Math.imul(KINDS.indexOf(kind) + 1, 0x9E3779B1)), t, R);
  wear(g, R); return g;
}
const SYL = ['ka', 'lu', 'mi', 'ro', 'ne', 'ti', 'sha', 'vo', 'zu', 'el', 'an', 'ir', 'om', 'ys', 'qu', 'ax', 'be', 'dri', 'fen', 'gol', 'pa', 'su', 'ho', 'wy', 'ce', 'ju'];
function nameFrom(seed){ const rng = mulberry32(seed | 0); let w = ''; const q = rng(); for (let i = 0, n = q < .12 ? 2 : q < .62 ? 3 : 4; i < n; i++) w += pick(rng, SYL); return w; }
function reshape(c, text, kind, force){
  const i = creatures.indexOf(c); if (i < 0) return null;
  const g = genome(kind || c.g.kind, text, force), d = build(g, c.x, c.y, mulberry32(readText(text).seed ^ (c.id * 2654435761)), c.head);
  d.id = c.id; d.text = text; d.flash = 1.2; creatures[i] = d; return d;
}
function clone(c, n){
  const rng = mulberry32((c.id * 7919 + creatures.length * 31 + 5) | 0), out = [];
  for (let i = 0; i < n; i++){
    const a = rng() * TAU, d = rr(rng, 50, 170) * U, k = build(c.g, clamp(c.x + Math.cos(a) * d, ch * 3, GW - ch * 3), clamp(c.y + Math.sin(a) * d, ch * 3, GH - ch * 3), mulberry32((rng() * 1e9) | 0));
    k.text = c.text; k.flash = 1; creatures.push(k); out.push(k);
  }
  return out;
}
function remove(c){ const i = creatures.indexOf(c); if (i >= 0) creatures.splice(i, 1); if (c && c.id === SEL) SEL = 0; return i >= 0; }
function pickAt(x, y, rad){                                      // nearest creature-owned cell to a point, within rad cells
  const cx = Math.floor(x / cw), cy = Math.floor(y / ch); let best = 0, bd = 1e9; rad = rad == null ? 2 : rad;
  for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++){
    const X = cx + dx, Y = cy + dy; if (X < 0 || Y < 0 || X >= cols || Y >= rows) continue;
    const o = fo[Y * cols + X]; if (!o || o === WALL) continue;
    const d = dx * dx * cw * cw + dy * dy * ch * ch; if (d < bd){ bd = d; best = o; }
  }
  return best ? creatures.find(c => c.id === best) || null : null;
}
const CAST = [['serpent', 'teal'], ['jelly', 'violet'], ['butterfly', 'magenta'], ['fish', 'orange'], ['crawler', 'lime'], ['lizard', 'gold'], ['wisp', 'yellow'], ['dragonfly', 'cyan'], ['jelly', 'sky'], ['fish', 'pink'], ['butterfly', 'amber'], ['wisp', 'yellow'], ['serpent', 'crimson'], ['fish', 'blue'], ['lizard', 'mint'], ['wisp', 'gold']];
function freeSpot(rng){
  let best = null, bd = -1;
  for (let q = 0; q < 14; q++){
    const x = rr(rng, .12, .88) * GW, y = rr(rng, .16, .84) * GH; let d = 1e9;
    for (const c of creatures) d = Math.min(d, Math.hypot(c.x - x, c.y - y));
    if (d > bd){ bd = d; best = [x, y]; }
  }
  return best;
}
function buildMotes(rng){
  motes = []; const m = Math.round(N / 210), set = [46, 46, 183, 39, 43, 42, 58, 176, 164, 215];
  for (let i = 0; i < m; i++) motes.push({ x: rng() * GW, y: rng() * GH, vx: rr(rng, -5, 5), vy: rr(rng, -4, 2), ph: rng() * TAU, w: rr(rng, .5, 1.6), k: hk(rng() * 360), c: pick(rng, set) });
}
function buildScene(seed, settle){                              // the opening cast: one of each body, each a colour word and a made-up name
  const rng = mulberry32(seed * 7919 + 13); creatures = []; parts = []; uid = 1; T = 0; SEL = 0;
  const count = clamp(Math.round(N / 1000), 4, CAST.length);
  for (let i = 0; i < count; i++){ const [kind, colour] = CAST[i], p = freeSpot(rng), text = colour + ' ' + nameFrom((rng() * 1e9) | 0); const c = build(genome(kind, text, true), p[0], p[1], mulberry32((rng() * 1e9) | 0)); c.text = text; creatures.push(c); }
  buildMotes(rng);
  for (let i = 0, n = Math.round((settle == null ? 2.5 : settle) * 60); i < n; i++) step(1 / 60);
  for (const c of creatures) c.flash = 0;
}
function add(kind, text, x, y, seed){                            // no text → a made-up name; no base → one picked at random
  const rng = mulberry32(seed | 0); if (text == null) text = nameFrom((rng() * 1e9) | 0); if (!kind) kind = readText(text).kind || pick(rng, KINDS);
  if (x == null){ const p = freeSpot(rng); x = p[0]; y = p[1]; }
  const c = build(genome(kind, text), x, y, mulberry32((rng() * 1e9) | 0)); c.text = text; c.flash = 1; creatures.push(c); return c;
}
function rescale(fx, fy){                                       // board changed shape: rebuild every creature at its scaled spot
  if (fy == null) fy = fx;
  creatures = creatures.map(c => { const d = build(c.g, c.x * fx, c.y * fy, mulberry32(c.id * 9973 + 7), c.head); d.id = c.id; d.text = c.text; return d; });
  parts = []; buildMotes(mulberry32(4242));
}
function step(dt){
  T += dt;
  for (const c of creatures) c.update(dt);
  for (const m of motes){
    m.x += (m.vx + Math.sin(T * .4 + m.ph) * 4) * dt * U; m.y += m.vy * dt * U;
    if (m.x < 0) m.x += GW; else if (m.x >= GW) m.x -= GW; if (m.y < 0) m.y += GH; else if (m.y >= GH) m.y -= GH;
  }
  for (let i = parts.length - 1; i >= 0; i--){
    const p = parts[i]; p.life -= dt;
    if (p.life <= 0){ parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - Math.min(1, dt * 1.2); p.vy *= 1 - Math.min(1, dt * .5);
  }
}
function rasterize(){
  fv.fill(0); TWD = 0;
  fo.fill(0); OWN = 0;
  for (const m of motes){ const s = Math.max(0, Math.sin(T * m.w + m.ph)), v = .13 + .95 * Math.pow(s, 12); dot(m.x, m.y, v > .5 ? 42 : m.c, v, m.k, true); }
  for (const p of parts){ const a = 1 - p.life / p.max; dot(p.x, p.y, p.set[Math.min(p.set.length - 1, (a * p.set.length) | 0)], p.v * (1 - a * a), p.k, true); }
  if (SEL){ bx0 = cols; bx1 = -1; by0 = rows; by1 = -1; }
  for (const c of creatures){ OWN = c.id; c.draw(); }
  OWN = 0; TWD = 0;
  if (WALLS){                                                    // the frame: dim on its own, lit by the renderer where light reaches it
    const set = (i, code) => { fv[i] = .16; fc[i] = code; fk[i] = WHITE; fo[i] = WALL; };
    for (let x = 0; x < cols; x++){ const c = x === 0 || x === cols - 1 ? 43 : 61; set(x, c); set((rows - 1) * cols + x, c); }
    for (let y = 1; y < rows - 1; y++){ set(y * cols, 124); set(y * cols + cols - 1, 124); }
  }
  if (SEL && bx1 >= bx0){                                        // crop marks around whatever is selected
    const x0 = Math.max(0, bx0 - 2), x1 = Math.min(cols - 1, bx1 + 2), y0 = Math.max(0, by0 - 1), y1 = Math.min(rows - 1, by1 + 1), v = 1.05 + .3 * Math.sin(T * 6);
    const mark = (x, y, code) => { if (x < 0 || y < 0 || x >= cols || y >= rows) return; const i = y * cols + x; fv[i] = v; fc[i] = code; fk[i] = WHITE; fo[i] = 0; };
    for (const [x, sx] of [[x0, 1], [x1, -1]]) for (const [y, sy] of [[y0, 1], [y1, -1]]){ mark(x, y, 43); mark(x + sx, y, 45); mark(x + 2 * sx, y, 45); mark(x, y + sy, 124); }
  }
}

return {
  configure, buildScene, add, rescale, step, rasterize, genome, nameFrom, reshape, clone, remove, pickAt, readText, SPECIES, KINDS, CAST, OUTS, SK, HUES, WHITE, WALL, hk, mulberry32,
  Spined, Jelly, Flyer,
  clear(){ creatures = []; parts = []; SEL = 0; },
  reset(){ creatures = []; parts = []; motes = []; uid = 1; T = 0; mx = my = -1e6; SEL = 0; WALLS = false; },
  select(c){ SEL = c ? c.id : 0; }, get selected(){ return SEL ? creatures.find(c => c.id === SEL) || null : null; },
  set walls(b){ WALLS = !!b; }, get walls(){ return WALLS; },
  pointer(x, y){ mx = x; my = y; },
  field(){ return { fv, fc, fk, fo, cols, rows, cw, ch }; },
  get creatures(){ return creatures; }, get parts(){ return parts; }, get time(){ return T; }, get U(){ return U; }, get GW(){ return GW; }, get GH(){ return GH; },
};
});
