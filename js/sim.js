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
let fv, fc, fk;                                                  // the output field
let sid, ssd, snx, sny, sdd, ss, su, s2, sf, stx, sty, touched, nT = 0, stamp = 0;   // shape scratch
let creatures = [], motes = [], parts = [];
let T = 0, mx = -1e6, my = -1e6, uid = 1;

function configure(c, r, cellW, cellH){
  cols = c; rows = r; cw = cellW; ch = cellH; N = cols * rows; GW = cols * cw; GH = rows * ch; U = ch / 9;
  fv = new Float32Array(N); fc = new Uint16Array(N); fk = new Uint8Array(N);
  sid = new Uint32Array(N); ssd = new Float32Array(N); snx = new Float32Array(N); sny = new Float32Array(N);
  sdd = new Float32Array(N); ss = new Float32Array(N); su = new Float32Array(N); s2 = new Float32Array(N); sf = new Uint8Array(N);
  stx = new Float32Array(N); sty = new Float32Array(N); touched = new Int32Array(N); stamp = 0;
}

/* ───────────── the pen: glow wave + twinkle for whatever is being drawn ───────────── */
let LB = .75, LA = .5, LK = .5, LP = 0, LF = 0;
let TWD = 0, TWS = null, TWK = WHITE, CID = 0;
function lum(s){ const w = .5 + .5 * Math.sin(s * LK - LP), w2 = w * w; return LB + LA * w2 * w2 + LF; }
function put(i, code, v, k){
  if (TWD > 0){                                                  // a cell briefly becomes some other bright symbol
    const tb = (T * 9 + frac(i * .6180339) * 5) | 0, h = hash3(i, tb, CID), d = TWD * (.4 + v * .8);
    if (h < d){ code = TWS[(h / d * TWS.length) | 0]; v = v * .4 + 1 + h / d * .35; k = hash3(i, tb, 7) < .5 ? WHITE : TWK; }
  }
  fv[i] = v; fc[i] = code; fk[i] = k;
}
function dot(x, y, code, v, k, raw){
  const cx = Math.floor(x / cw), cy = Math.floor(y / ch); if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
  const i = cy * cols + cx; if (raw){ fv[i] = v; fc[i] = code; fk[i] = k; } else put(i, code, v, k);
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
    put(i, code || lineGlyph(dx, dy, y), (v0 + (v1 - v0) * h) * lum(s0 + (s1 - s0) * h), k);
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
const RAMP = 0, BANDS = 1, FLOW = 2, SPOTS = 3, STRIPE = 4, JELLY = 5, WING = 6;
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
    case SPOTS: { const h = hash3((s * 1.1) | 0, (u * 1.6 + 2) | 0, CID); if (h < .08){ SKK = 2; return c[2]; } if (h < .34){ SKK = 1; return c[1]; } return c[0]; }
    case STRIPE: if (au < .28){ SKK = 1; return c[0]; } return au < .7 ? c[1] : c[2];
    case JELLY: { if (s < .46){ if (frac(au * 4.2) > .34){ SKK = 3; return c[0]; } return 32; } return frac(au * 3.4 + .5) < .3 ? c[1] : 32; }
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
      put(i, code, st.edgeV * L, st.k);
    } else {                                                     // interior cell
      const code = skinGlyph(sk, s, u, s2[i], stx[i], sty[i]); if (code === 32) continue;
      put(i, code, st.fillV * (.6 + .4 * (1 - Math.abs(u))) * L, SKK === 0 ? st.k2 : SKK === 1 ? st.k : SKK === 2 ? WHITE : st.k3);
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
  const mb = Math.min(150 * U, GW * .28, GH * .28); let wx = 0, wy = 0;                 // walls push harder the deeper you go
  if (x < mb) wx = (mb - x) / mb; else if (x > GW - mb) wx = -(x - (GW - mb)) / mb;
  if (y < mb) wy = (mb - y) / mb; else if (y > GH - mb) wy = -(y - (GH - mb)) / mb;
  if (wx || wy){ const depth = Math.min(1.6, Math.hypot(wx, wy)); turn += clamp(angDiff(Math.atan2(wy, wx), head), -1.3, 1.3) * depth * depth * 2.6; }
  const R = 220 * U;
  for (const o of creatures){
    if (o === c) continue; const dx = x - o.x, dy = y - o.y, d = Math.hypot(dx, dy);
    if (d < R && d > 1) turn += clamp(angDiff(Math.atan2(dy, dx), head), -1, 1) * (1 - d / R) * 1.4;
  }
  return turn;
}
function glowState(c, x, y, dt, rate){
  c.flash *= Math.exp(-dt * rate); c.flashT -= dt;
  if (c.flashT < 0){ c.flash = .85; c.flashT = rr(c.rng, 4, 13); }
  const pr = Math.max(0, 1 - Math.hypot(x - mx, y - my) / (170 * U)); c.near += (pr - c.near) * Math.min(1, dt * 6);
}

/* ───────────── species: genomes are plain data in board units (1 unit = 1/9 of a cell height) ───────────── */
function profile(p, f){ return f < p.pm ? lerp(p.rh, p.R, smooth(f / p.pm)) : lerp(p.R, p.rt, Math.pow(smooth((f - p.pm) / (1 - p.pm)), p.pw)); }
const SPECIES = {
  serpent(rng, hue){                                             // eel-style: a wave runs head → tail, growing as it goes
    const R0 = rr(rng, 10, 15), n = Math.round(rr(rng, 20, 30)), seg = R0 * .85, waves = rr(rng, 1.1, 1.5), lam = (n - 1) * seg / waves, speed = rr(rng, 52, 72), slip = .7;
    return { kind:'serpent', mode:'swim', hue, hue2: hue + rr(rng, -45, 45), hue3: hue + 160, n, seg,
      prof:{ rh:R0 * 1.05, R:R0, pm:.08, rt:1.5, pw:1.35 }, speed, turn:.7, bend:.45, slip, lam, fB: 1.15 * speed / (slip * lam),
      idle:.7, burst:[2, 5], coast:[1, 2.5], acc:1.8, drag:.7, wave:{ a0:R0 * .22, a1:R0 * rr(rng, 1.3, 1.7), pw:1.3, k: TAU * waves / (n - 1) },
      skin: pick(rng, [SK.scales, SK.arrows, SK.core, SK.bands, SK.rings, SK.stripe]), out: pick(rng, ['soft', 'scaly', 'clean']), fillV:.5, edgeV:1,
      eye:111, frill: rng() < .4 ? { every:2 } : null, tw:'*+°x\'', twd:.012, lb:.7, la:.6, pk: rr(rng, .35, .6), pw: rr(rng, 2.5, 4.2) };
  },
  fish(rng, hue){                                                // stiff front, working tail; beats in bursts, then glides
    const R0 = rr(rng, 12, 18), n = 8, seg = R0 * .6, waves = .9, lam = (n - 1) * seg / waves, speed = rr(rng, 46, 66), slip = .75;
    return { kind:'fish', mode:'swim', hue, hue2: hue + rr(rng, -35, 35), hue3: hue + 170, n, seg,
      prof:{ rh:R0 * .6, R:R0, pm:.32, rt:R0 * .2, pw:.9 }, speed, turn:.9, bend:.5, slip, lam, fB: 1.15 * speed / (slip * lam),
      idle:.12, burst:[.6, 1.4], coast:[1, 2.8], acc:3.2, drag:.9, wave:{ a0:R0 * .05, a1:R0 * .55, pw:1.8, k: TAU * waves / (n - 1) },
      skin: pick(rng, [SK.koi, SK.freck, SK.scales, SK.pearl, SK.stripe, SK.tiger]), out: pick(rng, ['soft', 'clean', 'round']), fillV:.5, edgeV:1,
      eye:79, tail:{ len:R0 * 1.4, spread:.55, r:R0 * .38, swing:.55 }, fins:[{ at:2, len:R0 * 1.05, open:1.25, tuck:.5, r:R0 * .26 }], bubbles:true,
      tw:'*°o+', twd:.01, lb:.72, la:.5, pk:.9, pw: rr(rng, 3, 5) };
  },
  lizard(rng, hue){                                              // trot: diagonal feet move together and the trunk bends with them
    const R0 = rr(rng, 10, 13), n = 16, seg = R0 * .8, swing = .38, k = TAU / 8;
    return { kind:'lizard', mode:'crawl', hue, hue2: hue + rr(rng, -30, 30), hue3: hue + 150, n, seg,
      prof:{ rh:R0 * .9, R:R0 * 1.05, pm:.3, rt:1.2, pw:.6 }, speed: rr(rng, 60, 80), turn:.8, bend:.5,
      burst:[1.5, 4], coast:[.4, 1.4], wave:{ a0:R0 * .18, a1:R0 * .6, pw:1.4, k, ph: -Math.PI / 2 - TAU * swing + 5 * k },
      skin: pick(rng, [SK.core, SK.koi, SK.plates, SK.moss, SK.stripe]), out: pick(rng, ['clean', 'round', 'scaly']), fillV:.5, edgeV:1, eye:111,
      legs:{ list:[{ i:3, side:-1, off:0 }, { i:3, side:1, off:.5 }, { i:7, side:-1, off:.5 }, { i:7, side:1, off:0 }],
        l1:R0 * 1.5, l2:R0 * 1.7, reach:R0 * 2.3, cycle:R0 * 4.4, swing, foot:[42, 39] }, tongue:R0 * 1.7, prints:true,
      tw:'*+\'^', twd:.008, lb:.72, la:.5, pk:.5, pw:3 };
  },
  crawler(rng, hue){                                             // many legs: a stepping wave runs down the body, sides out of phase
    const R0 = rr(rng, 9.5, 12), n = Math.round(rr(rng, 16, 24)), lag = .16, swing = .4, list = [];
    for (let i = 1, j = 0; i < n - 1; i += 2, j++){ list.push({ i, side:-1, off:-j * lag }); list.push({ i, side:1, off:.5 - j * lag }); }
    return { kind:'crawler', mode:'crawl', hue, hue2: hue + rr(rng, -30, 30), hue3: hue + 140, n, seg: R0,
      prof:{ rh:R0 * 1.15, R:R0, pm:.05, rt:R0 * .7, pw:1 }, speed: rr(rng, 48, 66), turn:.8, bend:.42,
      burst:[2, 5], coast:[.3, 1.2], wave:{ a0:R0 * .25, a1:R0 * .5, pw:1, k: TAU * lag / 2, ph: -Math.PI / 2 - TAU * (swing + (1 - swing) / 2) + TAU * lag / 2 },
      skin: pick(rng, [SK.rings, SK.bands, SK.plates, SK.tiger]), out: pick(rng, ['hard', 'clean', 'round']), fillV:.5, edgeV:1, eye:42,
      legs:{ list, l1:R0 * 1.3, l2:R0 * 1.7, reach:R0 * 2.3, cycle:R0 * 3.2, swing, foot:[39, 96] }, ant:{ len:R0 * 3.4, n:5 }, prints:true,
      tw:'+x\'*', twd:.008, lb:.7, la:.6, pk:.7, pw:5 };
  },
  jelly(rng, hue){
    const a = rr(rng, 30, 50);
    return { kind:'jelly', hue, hue2: hue + rr(rng, -50, 50), hue3: hue + rr(rng, 120, 200), a, b: a * rr(rng, .72, .95), freq: rr(rng, .42, .62), speed: rr(rng, 13, 20),
      tn: Math.round(rr(rng, 5, 8)), tl: Math.round(rr(rng, 9, 13)), ts: a * .3, an: Math.round(rr(rng, 2, 3)), al:7, as: a * .26,
      armGlyphs: codes(pick(rng, ['}{', 'S$', ')(', '%:', '&;'])), tw:'*°+¤', twd:.014 };
  },
  butterfly(rng, hue){                                           // seen from above: wings foreshorten as they rise
    const L = rr(rng, 48, 62), seg = L * .15;
    return { kind:'butterfly', flight:'flutter', hue, hue2: hue + rr(rng, -40, 40), hue3: hue + rr(rng, 140, 200), n:4, seg, speed: rr(rng, 55, 75), turn:1,
      fw:{ len:L, chord:L * rr(rng, .58, .7), sweep: rr(rng, .25, .4), at:seg * .4, gap:1 },
      hw:{ len:L * rr(rng, .66, .78), chord:L * rr(rng, .5, .6), sweep:-rr(rng, .45, .65), at:-seg * .7, gap:1 },
      flapHz: rr(rng, 3.6, 4.8), baskHz: rr(rng, .35, .55), thOpen:.14, thShut:1.36, thGlide:.42, surge:.9, jink:.85, shimmy:36, acc:14, brake:7,
      fly:[7, 14], perch:[2.5, 5], glide:[.25, .7], flapRun:[.7, 1.8],
      wing:{ t:WING, c:codes(pick(rng, [':\'', '.:', '=-', ';,'])), m:codes(pick(rng, ['%o', '#:', '8.', '&,'])), eye:[64, pick(rng, [79, 111, 48])], ex: rr(rng, .1, .35) },
      out:'wing', fillV:.55, edgeV:1, ant:{ len:L * .4, n:3 }, dust:true, body:[111, 56], tw:'*°+\'.', twd:.018 };
  },
  dragonfly(rng, hue){                                           // hovers, pivots, then darts in a straight line
    const L = rr(rng, 36, 46), seg = L * .16;
    return { kind:'dragonfly', flight:'dart', hue, hue2: hue + rr(rng, -30, 30), hue3: hue + 180, n:8, seg, speed: rr(rng, 190, 250), turn:.6,
      fw:{ len:L, chord:L * .2, sweep:.14, at:seg * .3, gap:1 }, hw:{ len:L * .94, chord:L * .22, sweep:-.2, at:-seg * .8, gap:1 },
      flapHz:11, thOpen:.08, hover:[.7, 1.7], dart:[.25, .55], acc:9, brake:10,
      wing:{ t:WING, c:codes('-~'), m:codes('=-'), eye:null, ex:0 }, out:'buzz', fillV:.5, edgeV:.9, body:[79, 35], tw:'*\'"+', twd:.07 };
  },
  wisp(rng, hue){
    return { kind:'wisp', mode:'swim', hue, hue2:hue, hue3:hue + 30, n:7, seg:6, prof:{ rh:1, R:1, pm:.5, rt:1, pw:1 }, speed: rr(rng, 60, 90), turn:1.7, bend:.9,
      slip:.7, lam:30, fB:1.6, idle:.25, burst:[.3, .9], coast:[.4, 1.4], acc:4, drag:2, wave:{ a0:0, a1:3, pw:1, k:.9 },
      thin:codes('@*+::..'), blinkF: rr(rng, 1.4, 2.6), embers:true, tw:'*+', twd:0, lb:.3, la:.2, pk:1, pw:6 };
  },
};

/* ───────────── anything with a spine: serpent, fish, lizard, crawler, wisp ───────────── */
class Spined {
  constructor(g, x, y, rng){
    this.g = g; this.rng = rng; this.id = uid++; const n = g.n; this.ph = rng() * TAU; this.head = rng() * TAU;
    this.bx = new Float32Array(n); this.by = new Float32Array(n); this.px = new Float32Array(n); this.py = new Float32Array(n); this.r = new Float32Array(n);
    this.k = hk(g.hue); this.k2 = hk(g.hue2); this.k3 = hk(g.hue3);
    this.v = g.speed * U * .6; this.eff = .5; this.burst = true; this.gaitT = rr(rng, .3, 2); this.wph = rng() * TAU; this.gp = rng(); this.amp = .6; this.turnS = 0;
    this.flash = 0; this.flashT = rr(rng, 3, 10); this.near = 0; this.emitT = rr(rng, .5, 3); this.tongueT = rr(rng, 1, 4); this.tongueU = 0;
    this.st = { k:this.k, k2:this.k2, k3:this.k3, skin:g.skin, out:OUTS[g.out] || OUTS.soft, fillV:g.fillV, edgeV:g.edgeV };
    this.tw = codes(g.tw);
    if (g.legs) this.legs = g.legs.list.map(l => ({ i:l.i, side:l.side, off:l.off, fx:0, fy:0, sx:0, sy:0, hx:0, hy:0, sw:false, fixT:0, slid:0 }));
    this.place(x, y);
  }
  get x(){ return this.px[0]; } get y(){ return this.py[0]; }
  place(x, y){
    const g = this.g, n = g.n, c = Math.cos(this.head), s = Math.sin(this.head), seg = g.seg * U;
    for (let i = 0; i < n; i++){ this.bx[i] = this.px[i] = x - c * seg * i; this.by[i] = this.py[i] = y - s * seg * i; this.r[i] = profile(g.prof, i / (n - 1)) * U; }
    if (this.legs) this.plantLegs();
  }
  legFrame(L){                                                   // where a leg hangs from, and its neutral footing
    const i = L.i, px = this.px, py = this.py; let fx = px[i-1] - px[i+1], fy = py[i-1] - py[i+1]; const fl = Math.hypot(fx, fy) || 1; fx /= fl; fy /= fl;
    const qx = -fy * L.side, qy = fx * L.side, reach = this.g.legs.reach * U;
    L.hx = px[i] + qx * this.r[i] * .7; L.hy = py[i] + qy * this.r[i] * .7;
    return [fx, fy, px[i] + qx * reach, py[i] + qy * reach];
  }
  plantLegs(){
    const lg = this.g.legs, cyc = lg.cycle * U, sf = lg.swing, st = (1 - sf) * cyc;
    for (const L of this.legs){
      const [fx, fy, hx, hy] = this.legFrame(L), q = frac(this.gp + L.off), along = q < sf ? -st * .5 : st * .5 - (q - sf) * cyc;
      L.fx = L.sx = hx + fx * along; L.fy = L.sy = hy + fy * along; L.sw = q < sf; L.fixT = 0;
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
      this.gp += this.v * dt / (g.legs.cycle * U); this.amp = .25 + .75 * Math.min(1, this.v / vmax); this.wph = TAU * this.gp + g.wave.ph;
      turn *= Math.min(1, this.v / (vmax * .3));                 // no spinning on the spot
    }
    turn = clamp(turn, -2.4, 2.4); this.turnS += (turn - this.turnS) * Math.min(1, dt * 4); this.head += turn * dt;
    bx[0] = hx + Math.cos(this.head) * this.v * dt; by[0] = hy + Math.sin(this.head) * this.v * dt;
    let pa = this.head; const seg = g.seg * U;
    for (let i = 1; i < n; i++){                                 // base chain: every joint follows the one ahead, with a bend limit
      let a = Math.atan2(by[i-1] - by[i], bx[i-1] - bx[i]); const d = angDiff(a, pa);
      if (d > g.bend) a = pa + g.bend; else if (d < -g.bend) a = pa - g.bend;
      bx[i] = bx[i-1] - Math.cos(a) * seg; by[i] = by[i-1] - Math.sin(a) * seg; pa = a;
    }
    const W = g.wave, amp = this.amp * U;                        // displayed chain = base + travelling lateral wave, joints kept exactly seg apart
    let off = W.a0 * amp * Math.sin(this.wph), f0x = (bx[0] - bx[1]) / seg, f0y = (by[0] - by[1]) / seg;
    px[0] = bx[0] - f0y * off; py[0] = by[0] + f0x * off;
    for (let i = 1; i < n; i++){
      const fx = (bx[i-1] - bx[i]) / seg, fy = (by[i-1] - by[i]) / seg;
      const want = (W.a0 + (W.a1 - W.a0) * Math.pow(i / (n - 1), W.pw)) * amp * Math.sin(this.wph - W.k * i);
      const d = clamp(want - off, -.8 * seg, .8 * seg), along = Math.sqrt(seg * seg - d * d); off += d;
      px[i] = px[i-1] - fx * along - fy * d; py[i] = py[i-1] - fy * along + fx * d;
    }
    if (this.legs){
      const lg = g.legs, cyc = lg.cycle * U, sf = lg.swing, st = (1 - sf) * cyc, maxLen = (lg.l1 + lg.l2) * U * .97;
      for (const L of this.legs){
        const [fx, fy, homeX, homeY] = this.legFrame(L), q = frac(this.gp + L.off);
        if (q < sf){                                             // swing: fly to where the foot must be by the time it lands
          if (!L.sw){ L.sw = true; L.sx = L.fx; L.sy = L.fy; L.fixT = 0; }
          const u = q / sf, ahead = st * .5 + (1 - u) * sf * cyc, e = smooth(u);
          L.fx = lerp(L.sx, homeX + fx * ahead, e); L.fy = lerp(L.sy, homeY + fy * ahead, e);
        } else {                                                 // stance: the foot does not move
          if (L.sw){ L.sw = false; if (g.prints && this.v > vmax * .2) emit(L.fx, L.fy, 0, 0, 1.5, this.k2, PRINT, .4); }
          if (!L.fixT && Math.hypot(L.fx - L.hx, L.fy - L.hy) > maxLen){ L.fixT = 1e-6; L.sx = L.fx; L.sy = L.fy; }
          if (L.fixT){                                           // over-stretched by a hard turn: one quick corrective step
            L.fixT += dt / .12; const e = smooth(Math.min(1, L.fixT)), along = st * .5 - (q - sf) * cyc;
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
    LB = g.lb; LA = g.la; LK = g.pk; LP = T * g.pw + this.ph; LF = this.flash * .7 + this.near * .45;
    CID = this.id; TWS = this.tw; TWK = this.k3; TWD = g.twd * (1 + this.flash * 5 + this.near * 2);
    if (g.thin){
      const b = Math.max(0, Math.sin(T * g.blinkF + this.ph)); LF += b * b * b * b * 1.05;
      for (let i = n - 2; i >= 0; i--) line(px[i], py[i], px[i+1], py[i+1], k, 1 - i / n, 1 - (i + 1) / n, i, i + 1, g.thin[Math.min(i, g.thin.length - 1)]);
      return;
    }
    let fx = px[0] - px[1], fy = py[0] - py[1]; const fl = Math.hypot(fx, fy) || 1; fx /= fl; fy /= fl;
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
          const a = base + sd * (.42 + .1 * j) + Math.sin(T * (3.1 + still * 3) + j * .7 + sd + this.ph) * (.2 + still * .25);
          const bx = ax + Math.cos(a) * sl, by = ay + Math.sin(a) * sl; line(ax, ay, bx, by, k2, .8 - j * .1, .7 - j * .1, -j, -j - 1, 0); ax = bx; ay = by;
        }
        dot(ax, ay, 176, .9, this.k3);
      }
    }
    if (this.tongueU > 0){
      const len = Math.sin(this.tongueU * Math.PI) * g.tongue * U, sx = px[0] + fx * r[0], sy = py[0] + fy * r[0], ex = sx + fx * len, ey = sy + fy * len;
      line(sx, sy, ex, ey, hk(348), 1, 1, 0, 0, 0); dot(ex, ey, Math.abs(fx) > Math.abs(fy) ? (fx > 0 ? 60 : 62) : (fy > 0 ? 94 : 89), 1.1, hk(348), true);
    }
    beginShape();
    for (let i = 0; i < n - 1; i++) capsule(px[i], py[i], r[i], px[i+1], py[i+1], r[i+1], i, i + 1);
    if (g.tail){                                                 // the fin carries the body wave on, a beat late
      const ba = Math.atan2(py[n-1] - py[n-2], px[n-1] - px[n-2]) + g.tail.swing * this.amp * Math.sin(this.wph - g.wave.k * (n - 1) - 1), len = g.tail.len * U;
      for (let sd = -1; sd <= 1; sd += 2){ const a = ba + sd * g.tail.spread; capsule(px[n-1], py[n-1], r[n-1] + 1, px[n-1] + Math.cos(a) * len, py[n-1] + Math.sin(a) * len, g.tail.r * U, n - 1, n + 1); }
    }
    if (g.fins) for (const f of g.fins){                         // spread to glide and steer, tucked while the tail works
      const i = f.at; let tx = px[i+1] - px[i], ty = py[i+1] - py[i]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl; const len = f.len * U;
      for (let sd = -1; sd <= 1; sd += 2){
        const a = clamp(lerp(f.open, f.tuck, this.eff) + .16 * Math.sin(T * 5 + this.ph) * (1 - this.eff) + sd * this.turnS * .22, .25, 1.6);
        const dx = tx * Math.cos(a) + ty * sd * Math.sin(a), dy = ty * Math.cos(a) - tx * sd * Math.sin(a);
        capsule(px[i], py[i], f.r * U * .6, px[i] + dx * (r[i] + len), py[i] + dy * (r[i] + len), f.r * U, i, i + 1.5);
      }
    }
    endShape(this.st);
    if (g.frill) for (let i = 2; i < n - 2; i += g.frill.every){ // spikes that point outward whichever way the body runs
      let tx = px[i-1] - px[i+1], ty = py[i-1] - py[i+1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      for (let sd = -1; sd <= 1; sd += 2){ const qx = -ty * sd, qy = tx * sd, o = r[i] + cw * .9; dot(px[i] + qx * o, py[i] + qy * o, Math.abs(qy) * cw > Math.abs(qx) * ch * .5 ? (qy < 0 ? 94 : 118) : (qx < 0 ? 60 : 62), .8 * lum(i), this.k3); }
    }
    const blink = ((T * .31 + this.ph) % 4) < .1, eye = blink ? 45 : g.eye, r0 = r[0];
    if (r0 > cw * 1.2){ const qx = -fy * r0 * .55, qy = fx * r0 * .55, hx = px[0] + fx * r0 * .1, hy = py[0] + fy * r0 * .1; dot(hx + qx, hy + qy, eye, 1.35, WHITE, true); dot(hx - qx, hy - qy, eye, 1.35, WHITE, true); }
    else dot(px[0], py[0], eye, 1.35, WHITE, true);
  }
}

/* ───────────── jellyfish ───────────── */
class Jelly {
  constructor(g, x, y, rng){
    this.g = g; this.rng = rng; this.id = uid++; this.x = x; this.y = y; this.head = -Math.PI / 2 + rr(rng, -.3, .3); this.ph = rng() * TAU; this.phase = rng(); this.vel = 0; this.c = 0; this.cRim = 0;
    this.k = hk(g.hue); this.k2 = hk(g.hue2); this.k3 = hk(g.hue3); this.flash = 0; this.flashT = rr(rng, 3, 9); this.near = 0; this.a = g.a * U; this.b = g.b * U;
    this.tent = []; for (let i = 0; i < g.tn; i++) this.tent.push({ f:(g.tn > 1 ? i / (g.tn - 1) * 2 - 1 : 0) * .86, s:new Strand(g.tl, g.ts * U, rr(rng, -.9, .9)) });
    this.arms = []; for (let i = 0; i < g.an; i++) this.arms.push({ f:(g.an > 1 ? i / (g.an - 1) * 2 - 1 : 0) * .3, s:new Strand(g.al, g.as * U, rr(rng, -.6, .6)) });
    this.st = { k:this.k, k2:this.k2, k3:this.k3, skin:SK.jelly, out:OUTS.soft, fillV:.62, edgeV:1, rim:codes('wv') };
    this.tw = codes(g.tw);
  }
  relax(){ for (const t of this.tent) t.s.live = false; for (const a of this.arms) a.s.live = false; }
  update(dt){
    const g = this.g, up = -Math.PI / 2;
    let want = up + (Math.sin(T * .23 + this.ph) * .3 + Math.sin(T * .51 + this.ph * 1.9) * .18);
    const m = 90 * U; if (this.x < m) want += .45; else if (this.x > GW - m) want -= .45;
    const reach = g.tl * g.ts * U + this.b;
    if (this.y < -reach){ this.y = GH + this.b + 4; this.x = GW * (.12 + .76 * this.rng()); this.relax(); }       // off the top: re-enter from below
    this.head += angDiff(want, this.head) * 1.4 * dt;
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
    LB = .68; LA = .5; LK = 1.1; LP = T * 2.4 + this.ph; LF = this.flash * .7 + this.near * .45 + this.c * .22;
    CID = this.id; TWS = this.tw; TWK = this.k3; TWD = this.g.twd * (1 + this.flash * 5 + this.near * 2 + this.c);
    for (const t of this.tent) t.s.draw(this.k2, .85, .14, 1, .55, null);
    for (const a of this.arms) a.s.draw(this.k, 1, .4, 1, .55, this.g.armGlyphs);
    LK = 2.6; beginShape(); ellipse(this.x, this.y, this.head, this.a, this.b, true); endShape(this.st);
  }
}

/* ───────────── winged things, seen from above: butterfly (flutter, glide, perch) and dragonfly (hover, dart) ───────────── */
class Flyer {
  constructor(g, x, y, rng){
    this.g = g; this.rng = rng; this.id = uid++; this.x = x; this.y = y; this.head = rng() * TAU; this.ph = rng() * TAU; const n = g.n;
    this.bx = new Float32Array(n); this.by = new Float32Array(n);
    const c = Math.cos(this.head), s = Math.sin(this.head); for (let i = 0; i < n; i++){ this.bx[i] = x - c * g.seg * U * i; this.by[i] = y - s * g.seg * U * i; }
    this.k = hk(g.hue); this.k2 = hk(g.hue2); this.k3 = hk(g.hue3); this.flash = 0; this.flashT = rr(rng, 3, 9); this.near = 0;
    this.v = 0; this.flap = rng(); this.th = g.thOpen; this.thH = g.thOpen; this.kick = 0; this.down = 0;
    this.perch = false; this.glide = false; this.dart = false; this.stT = rr(rng, 3, 8); this.modeT = rr(rng, .5, 1.5); this.aim = this.head;
    const out = OUTS[g.out];
    this.stF = { k:this.k, k2:this.k2, k3:this.k3, skin:g.wing, out, fillV:g.fillV, edgeV:g.edgeV };
    this.stH = { k:this.k2, k2:this.k, k3:this.k3, skin:g.wing, out, fillV:g.fillV * .9, edgeV:g.edgeV * .9 };
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
    this.x += (c * this.v - s * lat) * dt; this.y += (s * this.v + c * lat) * dt; bx[0] = this.x; by[0] = this.y;
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
    LB = .74; LA = .45; LK = 2.2; LP = T * 3 + this.ph; LF = this.flash * .7 + this.near * .45;
    if (g.flight === 'dart') LF += (hash3((T * 30) | 0, this.id, 1) - .5) * .35;          // wings too fast to see: they shimmer instead
    CID = this.id; TWS = this.tw; TWK = this.k3; TWD = g.twd * (1 + this.flash * 5 + this.near * 2 + this.down);
    let fx = bx[0] - bx[1], fy = by[0] - by[1]; const fl = Math.hypot(fx, fy) || 1; fx /= fl; fy /= fl;
    const nx = -fy, ny = fx, tx = bx[1], ty = by[1], sp = this.span();
    for (let pass = 0; pass < 2; pass++){                        // hindwings first, forewings over them
      const Wg = pass ? g.fw : g.hw, s = pass ? sp[0] : sp[1], cs = Math.cos(Wg.sweep), sn = Math.sin(Wg.sweep);
      for (let sd = -1; sd <= 1; sd += 2){
        const dx = nx * sd * cs + fx * sn, dy = ny * sd * cs + fy * sn, b = Wg.len * U * .5 * s, a = Wg.chord * U * .5, o = b + Wg.gap * U;
        beginShape(); ellipse(tx + fx * Wg.at * U + dx * o, ty + fy * Wg.at * U + dy * o, Math.atan2(dy, dx), a, b, false); endShape(pass ? this.stF : this.stH);
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
function make(kind, hue, x, y, seed){
  const rng = mulberry32(seed | 0), g = SPECIES[kind](rng, hue);
  return new (kind === 'jelly' ? Jelly : g.flight ? Flyer : Spined)(g, x, y, rng);
}
const CAST = [['serpent', 168], ['jelly', 272], ['butterfly', 312], ['fish', 24], ['crawler', 104], ['lizard', 48], ['wisp', 56], ['dragonfly', 188], ['jelly', 196], ['fish', 322], ['butterfly', 36], ['wisp', 60], ['serpent', 352], ['fish', 212], ['lizard', 150], ['wisp', 64]];
const KINDS = ['serpent', 'serpent', 'fish', 'fish', 'jelly', 'jelly', 'crawler', 'lizard', 'butterfly', 'butterfly', 'dragonfly', 'wisp'];
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
function buildScene(seed, settle){
  const rng = mulberry32(seed * 7919 + 13); creatures = []; parts = []; uid = 1; T = 0;
  const count = clamp(Math.round(N / 1000), 4, CAST.length);
  for (let i = 0; i < count; i++){ const [kind, hue] = CAST[i], p = freeSpot(rng); creatures.push(make(kind, hue + rr(rng, -10, 10), p[0], p[1], (rng() * 1e9) | 0)); }
  buildMotes(rng);
  for (let i = 0, n = Math.round((settle == null ? 2.5 : settle) * 60); i < n; i++) step(1 / 60);
  for (const c of creatures) c.flash = 0;
}
function add(kind, hue, x, y, seed){
  const rng = mulberry32(seed | 0); if (!kind) kind = pick(rng, KINDS); if (hue == null) hue = rng() * 360;
  if (x == null){ const p = freeSpot(rng); x = p[0]; y = p[1]; }
  const c = make(kind, hue, x, y, (rng() * 1e9) | 0); c.flash = 1; creatures.push(c); return c;
}
function rescale(f){                                            // cell size changed: rebuild every creature at its scaled spot
  creatures = creatures.map(c => new c.constructor(c.g, c.x * f, c.y * f, mulberry32(c.id * 9973 + 7)));
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
  for (const m of motes){ const s = Math.max(0, Math.sin(T * m.w + m.ph)), v = .13 + .95 * Math.pow(s, 12); dot(m.x, m.y, v > .5 ? 42 : m.c, v, m.k, true); }
  for (const p of parts){ const a = 1 - p.life / p.max; dot(p.x, p.y, p.set[Math.min(p.set.length - 1, (a * p.set.length) | 0)], p.v * (1 - a * a), p.k, true); }
  for (const c of creatures) c.draw();
  TWD = 0;
}

return {
  configure, buildScene, add, rescale, step, rasterize, make, SPECIES, KINDS, CAST, OUTS, SK, HUES, WHITE, hk, mulberry32,
  Spined, Jelly, Flyer,
  clear(){ creatures = []; parts = []; },
  reset(){ creatures = []; parts = []; motes = []; uid = 1; T = 0; mx = my = -1e6; },
  pointer(x, y){ mx = x; my = y; },
  field(){ return { fv, fc, fk, cols, rows, cw, ch }; },
  get creatures(){ return creatures; }, get parts(){ return parts; }, get time(){ return T; }, get U(){ return U; }, get GW(){ return GW; }, get GH(){ return GH; },
};
});
