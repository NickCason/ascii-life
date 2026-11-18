#!/usr/bin/env node
/* Motion + raster checks, straight against sim.js (no browser).
   Each check measures something a viewer would notice if it were wrong: feet that slide, a wave running the wrong
   way, wings out of step, glyphs that are all slashes. Prints every measurement; exits non-zero on any failure. */
const S = require('../js/sim.js');
const TAU = Math.PI * 2, DT = 1 / 60, CW = 8, CH = 15;
const out = []; let fails = 0;
function check(group, name, ok, detail){ out.push([ok ? 'PASS' : 'FAIL', group, name, detail || '']); if (!ok) fails++; }
const f2 = x => (Math.round(x * 100) / 100).toString();
const mean = a => a.reduce((p, c) => p + c, 0) / (a.length || 1);
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) * (x - m)))); };
const rms = a => Math.sqrt(mean(a.map(x => x * x)));
const frac = x => x - Math.floor(x);
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };
function corr(a, b){ const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++){ n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / (Math.sqrt(da * db) || 1); }
function bestLag(a, b, maxLag){ let best = 0, bc = -2; for (let L = -maxLag; L <= maxLag; L++){ const x = [], y = []; for (let i = Math.max(0, -L); i < Math.min(a.length, a.length - L); i++){ x.push(a[i]); y.push(b[i + L]); } const c = corr(x, y); if (c > bc){ bc = c; best = L; } } return [best, bc]; }
function solo(kind, seed, cols = 200, rows = 70){ S.configure(cols, rows, CW, CH); S.reset(); return S.add(kind, 200, S.GW / 2, S.GH / 2, seed); }
function run(secs, fn){ const n = Math.round(secs / DT); for (let i = 0; i < n; i++){ S.step(DT); if (fn) fn(i); } }
const SEEDS = [1, 2, 3, 4, 5, 6];
const ALL = Object.keys(S.SPECIES);
const headOf = c => [c.x, c.y];
const finite = c => { const xs = c.px ? [...c.px, ...c.py, ...c.bx, ...c.by] : c.bx ? [c.x, c.y, ...c.bx, ...c.by] : [c.x, c.y, c.a, c.b]; return xs.every(Number.isFinite) && Number.isFinite(c.head); };
function lateral(c, i){ const i0 = Math.max(0, i - 1), i1 = Math.min(c.g.n - 1, i + 1); let tx = c.bx[i0] - c.bx[i1], ty = c.by[i0] - c.by[i1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l; return (c.px[i] - c.bx[i]) * -ty + (c.py[i] - c.by[i]) * tx; }

/* ── 1. every species: stays finite, stays on the board, never teleports, is repeatable ── */
for (const kind of ALL){
  let okFinite = true, okBounds = true, maxStep = 0, maxTurn = 0, worst = '';
  for (const seed of SEEDS){
    const c = solo(kind, seed); let [lx, ly] = headOf(c), lh = c.head;
    run(60, () => {
      if (!finite(c)) okFinite = false;
      const [x, y] = headOf(c), d = Math.hypot(x - lx, y - ly);
      if (!(kind === 'jelly' && d > S.GH * .5)) maxStep = Math.max(maxStep, d / DT);          // a jelly re-entering from below is the one allowed jump
      maxTurn = Math.max(maxTurn, Math.abs(angDiff(c.head, lh)) / DT); lx = x; ly = y; lh = c.head;
      const mx = S.GW * .3, my = kind === 'jelly' ? S.GH * 1.2 : S.GH * .3;
      if (x < -mx || x > S.GW + mx || y < -my || y > S.GH + my){ okBounds = false; worst = `seed ${seed} at ${x | 0},${y | 0}`; }
    });
  }
  const vmax = (kind === 'jelly' ? S.SPECIES.jelly(S.mulberry32(1), 0).speed * 6 : kind === 'dragonfly' ? 260 : kind === 'butterfly' ? 140 : 110) * S.U;
  check('sanity', `${kind}: state stays finite (6 seeds × 60 s)`, okFinite);
  check('sanity', `${kind}: stays on or near the board`, okBounds, worst);
  check('sanity', `${kind}: no teleporting`, maxStep < vmax * 1.5, `peak head speed ${f2(maxStep)} px/s (limit ${f2(vmax * 1.5)})`);
  check('sanity', `${kind}: no snap turns`, maxTurn < 9, `peak turn rate ${f2(maxTurn)} rad/s`);
  const a = solo(kind, 42); run(20); const pa = headOf(a); const b = solo(kind, 42); run(20); const pb = headOf(b);
  check('sanity', `${kind}: same seed → same motion`, pa[0] === pb[0] && pa[1] === pb[1], `${f2(pa[0])},${f2(pa[1])}`);
}

/* ── 2. swimmers: joints keep their spacing, the wave runs head → tail and grows, the body slips through the water ── */
for (const kind of ['serpent', 'fish']){
  let segErr = 0, maxBend = 0; const env = [[], [], []], lags = [], slips = [], cvs = [], glide = [], lead = [];
  for (const seed of SEEDS){
    const c = solo(kind, seed), n = c.g.n, seg = c.g.seg * S.U, i1 = Math.round(n * .5), i2 = Math.min(n - 1, i1 + Math.max(1, Math.round(n * .2)));
    const d1 = [], d2 = [], vs = [], effs = []; let lastW = c.wph, wsum = 0, dist = 0, lp = headOf(c);
    run(8);                                                       // settle
    run(40, () => {
      for (let i = 0; i < n - 1; i++){
        segErr = Math.max(segErr, Math.abs(Math.hypot(c.px[i] - c.px[i+1], c.py[i] - c.py[i+1]) - seg));
        if (i > 0){ const a = Math.atan2(c.py[i-1] - c.py[i], c.px[i-1] - c.px[i]), b = Math.atan2(c.py[i] - c.py[i+1], c.px[i] - c.px[i+1]); maxBend = Math.max(maxBend, Math.abs(angDiff(a, b))); }
      }
      const third = Math.floor(n / 3); for (let t = 0; t < 3; t++){ let s = 0; for (let i = t * third; i < (t + 1) * third; i++) s += lateral(c, i) ** 2; env[t].push(s / third); }
      d1.push(lateral(c, i1)); d2.push(lateral(c, i2)); vs.push(c.v); effs.push(c.eff);
      wsum += c.wph - lastW; lastW = c.wph; dist += Math.hypot(c.bx[0] - lp[0], c.by[0] - lp[1]); lp = [c.bx[0], c.by[0]];
    });
    const [lag] = bestLag(d1, d2, 90); lags.push(lag * DT);
    const waveSpeed = (wsum / 40) / c.g.wave.k * seg;            // px/s the crest moves back along the body
    slips.push((dist / 40) / waveSpeed); cvs.push(sd(vs) / mean(vs)); lead.push(bestLag(effs, vs, 90)[0] * DT);
    for (let i = 60; i < effs.length - 60; i++){                  // coast onset: effort drops, speed must outlast it
      if (effs[i - 1] > .9 && effs[i] < effs[i - 1] - 1e-6 && effs[i + 30] < .7) glide.push(vs[i + 30] / vs[i]);
    }
  }
  const e = env.map(a => Math.sqrt(mean(a)));
  check('swim', `${kind}: joints stay exactly one segment apart`, segErr < 1e-2, `max error ${segErr.toExponential(1)} px`);
  check('swim', `${kind}: no kinks`, maxBend < 1.35, `sharpest joint ${f2(maxBend)} rad`);
  check('swim', `${kind}: sway grows from head to tail`, e[0] < e[1] && e[1] < e[2], `rms sway by thirds ${e.map(f2).join(' < ')} px`);
  check('swim', `${kind}: wave travels head → tail`, lags.every(l => l > 0), `tail lags mid-body by ${f2(mean(lags))} s`);
  check('swim', `${kind}: body slips (moves slower than its own wave)`, slips.every(s => s > .4 && s < .98), `speed ÷ wave speed = ${f2(mean(slips))}`);
  if (kind === 'fish'){
    check('swim', 'fish: bursts and glides (speed is not constant)', mean(cvs) > .18, `speed variation ${f2(mean(cvs))}`);
    check('swim', 'fish: keeps gliding half a second after the tail stops', glide.length > 5 && mean(glide) > .7, `${glide.length} coasts, speed kept ${f2(mean(glide))}`);
    check('swim', 'fish: the tail works first, speed follows', lead.every(l => l > .08), `speed trails tail effort by ${f2(mean(lead))} s`);
  } else check('swim', 'serpent: undulates continuously', mean(cvs) < .2, `speed variation ${f2(mean(cvs))}`);
}

/* ── 3. walkers: planted feet do not slide, legs never over-reach, the gait pattern is the intended one ── */
for (const kind of ['lizard', 'crawler']){
  let slide = 0, ext = [], duty = [], fixes = 0, legSecs = 0, bothSides = 0, sync = 0, syncN = 0, pauseMove = 0, inside = 0, stanceN = 0, stepsErr = [], coup = [], onsetDelay = [], pausesSeen = 0;
  for (const seed of SEEDS){
    const c = solo(kind, seed), lg = c.g.legs, maxLen = (lg.l1 + lg.l2) * S.U, vmax = c.g.speed * S.U, cyc = lg.cycle * S.U;
    run(4);
    const prev = c.legs.map(L => ({ x:L.fx, y:L.fy, sw:L.sw, fix:L.fixT })); const steps = c.legs.map(() => 0); const onset = c.legs.map(() => []); let dist = 0, t = 0;
    const lat = [], pred = []; let gp0 = c.gp;
    run(60, () => {
      t += DT; const moving = c.v > vmax * .6, still = c.v < .5;
      if (still) pausesSeen++;
      c.legs.forEach((L, q) => {
        const P = prev[q], moved = Math.hypot(L.fx - P.x, L.fy - P.y);
        if (!L.sw && !P.sw && !L.fixT && !P.fix){ slide = Math.max(slide, moved); stanceN++; if (Math.hypot(L.fx - c.px[L.i], L.fy - c.py[L.i]) < c.r[L.i]) inside++; }
        if (still) pauseMove = Math.max(pauseMove, moved);
        if (L.fixT && !P.fix) fixes++;
        if (L.sw && !P.sw){ steps[q]++; onset[q].push(t); }
        ext.push(Math.hypot(L.fx - L.hx, L.fy - L.hy) / maxLen);
        if (moving) duty.push(L.sw ? 0 : 1);
        P.x = L.fx; P.y = L.fy; P.sw = L.sw; P.fix = L.fixT;
      });
      legSecs += c.legs.length * DT;
      for (let q = 0; q < c.legs.length; q += 2) if (c.legs[q].sw && c.legs[q + 1].sw) bothSides++;
      if (kind === 'lizard' && moving){ syncN++; if (c.legs[0].sw === c.legs[3].sw && c.legs[1].sw === c.legs[2].sw) sync++; lat.push(lateral(c, 5)); pred.push(-Math.cos(TAU * (c.gp - lg.swing))); }
      dist += c.v * DT;
    });
    const expected = (c.gp - gp0); steps.forEach(s => stepsErr.push(Math.abs(s - expected)));
    if (kind === 'lizard') coup.push(corr(lat, pred));
    if (kind === 'crawler'){                                      // a leg pair further back starts its swing later by a fixed share of the cycle
      const meanV = dist / 60;
      for (let q = 0; q + 2 < c.legs.length; q += 2){ const A = onset[q], B = onset[q + 2]; for (const ta of A){ const tb = B.find(x => x > ta); if (tb !== undefined && tb - ta < .6) onsetDelay.push(tb - ta); } }
    }
  }
  ext.sort((a, b) => a - b);
  check('walk', `${kind}: planted feet never slide`, slide === 0, `max stance-foot movement ${slide} px over ${stanceN} samples`);
  check('walk', `${kind}: feet stay outside the body`, inside / stanceN < .002, `${inside} of ${stanceN} stance samples under the body`);
  check('walk', `${kind}: legs never over-reach`, ext[Math.floor(ext.length * .999)] <= 1, `99.9th pct reach = ${f2(ext[Math.floor(ext.length * .999)])} of leg length, max ${f2(ext[ext.length - 1])}`);
  check('walk', `${kind}: corrective steps are rare`, fixes / (legSecs / 60) < 2, `${f2(fixes / (legSecs / 60))} per leg per minute`);
  const lgS = S.SPECIES[kind](S.mulberry32(1), 0).legs.swing;
  check('walk', `${kind}: time on the ground matches the gait`, Math.abs(mean(duty) - (1 - lgS)) < .04, `duty ${f2(mean(duty))} vs designed ${f2(1 - lgS)}`);
  check('walk', `${kind}: left and right of a pair never swing together`, bothSides === 0, `${bothSides} frames`);
  check('walk', `${kind}: one step per gait cycle, tied to distance`, Math.max(...stepsErr) <= 1.01, `worst step-count error ${f2(Math.max(...stepsErr))}`);
  check('walk', `${kind}: stands still when paused`, pausesSeen > 60 && pauseMove < .5, `${pausesSeen} paused frames, max foot drift ${f2(pauseMove)} px`);
  if (kind === 'lizard'){
    check('walk', 'lizard: diagonal feet move as pairs (trot)', sync === syncN, `${sync}/${syncN} frames in step`);
    check('walk', 'lizard: trunk bends in time with the feet', mean(coup) > .8, `spine↔gait correlation ${f2(mean(coup))}`);
  } else {
    const g = S.SPECIES.crawler(S.mulberry32(1), 0);
    check('walk', 'crawler: stepping wave runs down the body', onsetDelay.length > 50 && mean(onsetDelay) > .02 && sd(onsetDelay) / mean(onsetDelay) < .6, `next pair starts ${f2(mean(onsetDelay))} s later (±${f2(sd(onsetDelay))}), ${onsetDelay.length} samples`);
  }
}

/* ── 4. jellyfish: upright, pulse then surge then glide, tentacles trail and slacken ── */
{
  let tilt = 0, segErr = 0, trail = 0, trailN = 0, wraps = 0; const peakPh = [], troughPh = [], aAt = [], lock = [];
  for (const seed of SEEDS){
    const c = solo('jelly', seed), bins = Array.from({ length: 20 }, () => []), abin = Array.from({ length: 20 }, () => []), tip = []; let ly = c.y;
    run(6);
    run(90, () => {
      tilt = Math.max(tilt, Math.abs(angDiff(c.head, -Math.PI / 2)));
      const p = frac(c.phase), bi = Math.min(19, Math.floor(p * 20)); bins[bi].push(c.vel); abin[bi].push(c.a);
      if (c.y - ly > S.GH * .5) wraps++; ly = c.y;
      const fx = Math.cos(c.head), fy = Math.sin(c.head);
      for (const t of c.tent){
        const s = t.s; for (let j = 0; j < s.n - 1; j++) segErr = Math.max(segErr, Math.abs(Math.hypot(s.x[j] - s.x[j+1], s.y[j] - s.y[j+1]) - s.seg));
        const dx = s.x[s.n - 1] - s.x[0], dy = s.y[s.n - 1] - s.y[0]; trailN++; if (dx * -fx + dy * -fy > 0) trail++;
        if (t === c.tent[0]) tip.push(dx * -fy + dy * fx);
      }
    });
    { const d = tip.map((x, i) => x - mean(tip.slice(Math.max(0, i - 90), i + 90))); let z = 0; for (let i = 1; i < d.length; i++) if (d[i - 1] < 0 && d[i] >= 0) z++; lock.push(z / 90 / c.g.freq); }
    const m = bins.map(mean), am = abin.map(mean); peakPh.push(m.indexOf(Math.max(...m)) / 20); troughPh.push(m.indexOf(Math.min(...m)) / 20); aAt.push(am.indexOf(Math.min(...am)) / 20);
  }
  check('jelly', 'bell stays upright', tilt < .9, `max tilt ${f2(tilt)} rad`);
  check('jelly', 'surge follows the squeeze', peakPh.every(p => p >= .1 && p <= .45), `fastest at ${peakPh.map(f2).join(', ')} of the cycle (squeeze ends at 0.28)`);
  check('jelly', 'slowest just before the next squeeze', troughPh.every(p => p >= .85 || p <= .08), `slowest at ${troughPh.map(f2).join(', ')}`);
  check('jelly', 'rim closes a beat after the crown', aAt.every(p => p > .28 && p < .5), `narrowest at ${aAt.map(f2).join(', ')}`);
  check('jelly', 'tentacles keep their length', segErr < 1e-2, `max error ${segErr.toExponential(1)} px`);
  check('jelly', 'tentacles trail behind', trail / trailN > .97, `${f2(100 * trail / trailN)}% of samples`);
  check('jelly', 'tentacles wave in time with the bell', lock.every(r => r > .75 && r < 1.3), `tentacle sway rate ÷ pulse rate = ${lock.map(f2).join(', ')}`);
  check('jelly', 're-enters from below after leaving the top', wraps >= 3, `${wraps} re-entries in 9 min`);
}

/* ── 5. butterfly: wings in step, flap pushes, glides and perches really happen ── */
{
  let spanOK = true, sawPerch = 0, sawGlide = 0, sawFlap = 0, perchV = [], perchRange = []; const hz = [], lagH = [], surge = [], tort = [];
  for (const seed of SEEDS){
    const c = solo('butterfly', seed), th = [], thH = [], vDown = [], vUp = []; let perchT = 0, pth = [], path = 0, p0 = headOf(c), lp = headOf(c), win = 0, tt = 0; const tflap = [];
    run(3);
    run(90, i => {
      tt += DT; const [a, b] = c.span(); if (!(a >= .12 && a <= 1 && b >= .12 && b <= 1)) spanOK = false;
      const [x, y] = headOf(c);
      if (c.perch){ sawPerch++; perchT += DT; if (perchT > 1.2){ perchV.push(c.v); pth.push(c.th); } }
      else { if (pth.length > 60){ perchRange.push(Math.max(...pth) - Math.min(...pth)); } pth = []; perchT = 0;
        if (c.glide) sawGlide++; else { sawFlap++; tflap.push(tt); th.push(c.th); thH.push(c.thH); (c.down > .6 ? vDown : c.down === 0 ? vUp : []).push(c.v); }
        path += Math.hypot(x - lp[0], y - lp[1]); win++; if (win === 120){ const net = Math.hypot(x - p0[0], y - p0[1]); if (net > 20) tort.push(path / net); path = 0; win = 0; p0 = [x, y]; } }
      lp = [x, y];
    });
    const pk = []; for (let i = 1; i < th.length - 1; i++) if (th[i] > th[i-1] && th[i] >= th[i+1] && th[i] > 1) pk.push(tflap[i]);
    const gaps = []; for (let i = 1; i < pk.length; i++){ const d = pk[i] - pk[i-1]; if (d < .5) gaps.push(d); }
    hz.push(1 / mean(gaps) / c.g.flapHz); lagH.push(bestLag(th, thH, 12)[0] * DT); surge.push(mean(vDown) / mean(vUp));
  }
  const fishT = []; for (const seed of SEEDS){ const c = solo('fish', seed); let path = 0, p0 = headOf(c), lp = headOf(c), win = 0; run(3); run(60, () => { const [x, y] = headOf(c); path += Math.hypot(x - lp[0], y - lp[1]); lp = [x, y]; if (++win === 120){ const net = Math.hypot(x - p0[0], y - p0[1]); if (net > 20) fishT.push(path / net); path = 0; win = 0; p0 = [x, y]; } }); }
  check('butterfly', 'wing spans stay in range', spanOK);
  check('butterfly', 'flaps, glides and perches all occur', sawPerch > 300 && sawGlide > 300 && sawFlap > 1000, `frames: flap ${sawFlap}, glide ${sawGlide}, perch ${sawPerch}`);
  check('butterfly', 'beats at its own rate', hz.every(r => r > .85 && r < 1.1), `measured ÷ genome flap rate = ${hz.map(f2).join(', ')}`);
  check('butterfly', 'hindwings follow the forewings', lagH.every(l => l > 0 && l < .12), `hindwing lag ${f2(mean(lagH) * 1000)} ms`);
  check('butterfly', 'downstroke pushes it forward', surge.every(s => s > 1.08), `speed on downstroke ÷ upstroke = ${surge.map(f2).join(', ')}`);
  check('butterfly', 'comes to rest when perched', mean(perchV) < 2, `mean perched speed ${f2(mean(perchV))} px/s`);
  check('butterfly', 'opens and closes its wings while perched', perchRange.length > 3 && mean(perchRange) > .9, `wing angle sweep ${f2(mean(perchRange))} rad over ${perchRange.length} perches`);
  check('butterfly', 'flight path is more erratic than a fish', mean(tort) > mean(fishT) * 1.1, `path ÷ straight line: butterfly ${f2(mean(tort))}, fish ${f2(mean(fishT))}`);
  // seen head-on (heading straight up) the two sides must mirror
  const c = solo('butterfly', 9); c.head = -Math.PI / 2; for (let i = 0; i < c.g.n; i++){ c.bx[i] = Math.floor(S.GW / 2 / CW) * CW + CW / 2; c.by[i] = S.GH / 2 + i * c.g.seg * S.U; } c.x = c.bx[0]; c.y = c.by[0]; c.th = c.thH = c.g.thOpen; c.flash = 0;
  S.rasterize(); const f = S.field(), mid = Math.floor(c.x / CW); let L = 0, R = 0, mism = 0, tot = 0;
  for (let y = 0; y < f.rows; y++) for (let d = 1; d < 40; d++){ const a = f.fv[y * f.cols + mid - d] > 0, b = f.fv[y * f.cols + mid + d] > 0; if (a) L++; if (b) R++; if (a || b){ tot++; if (a !== b) mism++; } }
  check('butterfly', 'left and right wings mirror each other', L > 40 && mism / tot < .04, `${L} cells left, ${R} right, ${f2(100 * mism / tot)}% not mirrored`);
}

/* ── 6. dragonfly: hovers, pivots, darts straight ── */
{
  let hov = 0, dart = 0, n = 0; const dartTurn = [], hovTurn = [];
  for (const seed of SEEDS){ const c = solo('dragonfly', seed), vm = c.g.speed * S.U; let lh = c.head; run(3); run(60, () => { n++; const tr = Math.abs(angDiff(c.head, lh)) / DT; lh = c.head; if (c.v < vm * .1){ hov++; hovTurn.push(tr); } else if (c.v > vm * .7){ dart++; dartTurn.push(tr); } }); }
  check('dragonfly', 'spends real time hovering', hov / n > .3, `${f2(100 * hov / n)}% of frames near-still`);
  check('dragonfly', 'darts at speed', dart / n > .06, `${f2(100 * dart / n)}% of frames above 70% top speed`);
  check('dragonfly', 'darts are straight, pivots happen in the hover', mean(dartTurn) < mean(hovTurn) * .6, `turn rate: dart ${f2(mean(dartTurn))} vs hover ${f2(mean(hovTurn))} rad/s`);
}

/* ── 7. what lands on the board: valid glyphs, a real vocabulary, twinkles that come and go ── */
const need = { serpent:11, fish:11, lizard:11, crawler:11, jelly:11, butterfly:13, dragonfly:8, wisp:4 };
for (const kind of ALL){
  const hist = new Map(); let bad = 0, lit = 0, slashes = 0, tw = 0, twChanged = 0, twPrev = null, minLit = 1e9, frames = 0;
  for (const seed of [1, 2, 3]){
    const c = solo(kind, seed, 160, 60); c.flash = 0; run(3);
    run(8, i => {
      if (i % 6) return; S.rasterize(); const f = S.field(); let n = 0; const cur = new Set();
      for (let q = 0; q < f.fv.length; q++){ const v = f.fv[q]; if (!(v > 0)) { if (!Number.isFinite(v)) bad++; continue; } const k = f.fc[q]; n++;
        if (!(k > 32 && k < 256) || (k > 126 && k < 161)) bad++; hist.set(k, (hist.get(k) || 0) + 1); if (k === 47 || k === 92) slashes++; if (v > 1.25 && c.tw.includes(k)){ tw++; cur.add(q); } }
      lit += n; minLit = Math.min(minLit, n); frames++;
      if (twPrev){ let same = 0; for (const q of cur) if (twPrev.has(q)) same++; twChanged += cur.size - same; } twPrev = cur;
    });
  }
  const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(e => String.fromCharCode(e[0])).join('');
  check('board', `${kind}: every glyph is printable`, bad === 0, `${bad} bad cells`);
  check('board', `${kind}: is actually drawn`, minLit >= (kind === 'wisp' ? 3 : 25), `${Math.round(lit / frames)} cells on average, never fewer than ${minLit}`);
  check('board', `${kind}: uses a real vocabulary`, hist.size >= need[kind], `${hist.size} different glyphs; commonest: ${top}`);
  check('board', `${kind}: not mostly slashes`, slashes / lit < .3, `${f2(100 * slashes / lit)}% of cells are / or \\`);
  if (kind !== 'wisp'){ const share = tw / lit; check('board', `${kind}: twinkles, but sparingly`, share > .002 && share < .1, `${f2(100 * share)}% of its cells are a bright stray symbol at any moment`);
    check('board', `${kind}: twinkles move around`, twChanged / Math.max(1, tw) > .5, `${f2(100 * twChanged / Math.max(1, tw))}% are in a new cell 0.1 s later`); }
}

/* ── 8. the whole tank ── */
{
  S.configure(176, 51, CW, CH); S.reset(); S.buildScene(0x4f2a); let ok = true, t0 = process.hrtime.bigint();
  run(40, i => { if (!S.creatures.every(finite)) ok = false; S.rasterize(); });
  const ms9 = Number(process.hrtime.bigint() - t0) / 1e6 / (40 * 60), kinds = new Set(S.creatures.map(c => c.g.kind));
  check('tank', 'opening scene has every body plan', ['serpent', 'jelly', 'butterfly', 'fish', 'crawler', 'lizard', 'wisp', 'dragonfly'].every(k => kinds.has(k)), [...kinds].join(', '));
  check('tank', 'opening scene runs clean for 40 s', ok, `${S.creatures.length} creatures, ${f2(ms9)} ms per frame (step + draw to field) on this machine`);
  let near = 0, nn = 0; const nnd = []; run(30, i => { if (i % 30) return; for (const a of S.creatures){ let d = 1e9; for (const b of S.creatures) if (a !== b) d = Math.min(d, Math.hypot(a.x - b.x, a.y - b.y)); nn++; nnd.push(d / S.U); if (d < 30 * S.U) near++; } });
  const chance = .5 / Math.sqrt(S.creatures.length / ((S.GW / S.U) * (S.GH / S.U)));          // mean nearest-neighbour distance if positions were random
  check('tank', 'creatures spread out more than chance', mean(nnd) > chance * 1.1 && near / nn < .04, `nearest neighbour averages ${f2(mean(nnd))} units (random placement would give ${f2(chance)}); ${f2(100 * near / nn)}% of samples within 30 units`);
  const before = S.creatures.length, k0 = S.creatures.map(c => c.g.kind).join(); S.configure(220, 64, 6, 11); S.rescale(11 / 15); run(5);
  check('tank', 'changing cell size keeps every creature', S.creatures.length === before && S.creatures.map(c => c.g.kind).join() === k0 && S.creatures.every(finite));
  S.configure(234, 70, 6, 11); S.reset(); S.buildScene(7); for (let i = 0; i < 100; i++) S.add(null, null, null, null, 1000 + i);
  ok = true; t0 = process.hrtime.bigint(); let maxParts = 0;
  run(15, () => { if (!S.creatures.every(finite)) ok = false; S.rasterize(); maxParts = Math.max(maxParts, S.parts.length); });
  const ms100 = Number(process.hrtime.bigint() - t0) / 1e6 / (15 * 60);
  check('tank', '100+ creatures run clean', ok && maxParts <= 600, `${S.creatures.length} creatures, ${f2(ms100)} ms per frame here, ${maxParts} shed particles at peak`);
  S.configure(176, 51, CW, CH); S.reset(); const c = S.add('fish', 20, 400, 300, 5); S.pointer(c.x, c.y); run(1, () => S.pointer(c.x, c.y));
  check('tank', 'a creature under the pointer lights up', c.near > .8, `glow ${f2(c.near)}`);
}

const w = Math.max(...out.map(r => r[2].length));
let g = '';
for (const [st, grp, name, detail] of out){ if (grp !== g){ g = grp; console.log(`\n${grp.toUpperCase()}`); } console.log(`  ${st === 'PASS' ? '✓' : '✗ FAIL'} ${name.padEnd(w)}  ${detail}`); }
console.log(`\n${out.length - fails}/${out.length} checks passed`);
process.exit(fails ? 1 : 0);
