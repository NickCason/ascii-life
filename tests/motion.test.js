#!/usr/bin/env node
/* Motion + raster checks, straight against sim.js (no browser).
   Each check measures something a viewer would notice if it were wrong: feet that slide, a wave running the wrong
   way, wings out of step, glyphs that are all slashes. Every form of every base type is put through the checks for
   its kind. Prints every measurement; exits non-zero on any failure. */
const S = require('../js/sim.js');
const TAU = Math.PI * 2, DT = 1 / 60, CW = 8, CH = 15;
const out = []; let fails = 0;
function check(group, name, ok, detail){ out.push([ok ? 'PASS' : 'FAIL', group, name, detail || '']); if (!ok) fails++; }
const f2 = x => (Math.round(x * 100) / 100).toString();
const mean = a => a.reduce((p, c) => p + c, 0) / (a.length || 1);
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) * (x - m)))); };
const frac = x => x - Math.floor(x);
const pct = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * p))]; };
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };
function corr(a, b){ const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++){ n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / (Math.sqrt(da * db) || 1); }
function bestLag(a, b, maxLag){ let best = 0, bc = -2; for (let L = -maxLag; L <= maxLag; L++){ const x = [], y = []; for (let i = Math.max(0, -L); i < Math.min(a.length, a.length - L); i++){ x.push(a[i]); y.push(b[i + L]); } const c = corr(x, y); if (c > bc){ bc = c; best = L; } } return [best, bc]; }
function board(cols = 200, rows = 70){ S.configure(cols, rows, CW, CH); S.reset(); }
function solo(kind, name, cols, rows){ board(cols, rows); return S.add(kind, name, S.GW / 2, S.GH / 2, 7); }
function run(secs, fn){ const n = Math.round(secs / DT); for (let i = 0; i < n; i++){ S.step(DT); if (fn) fn(i); } }
const ALL = S.KINDS;
const headOf = c => [c.x, c.y];
const finite = c => { const xs = c.px ? [...c.px, ...c.py, ...c.bx, ...c.by] : c.bx ? [c.x, c.y, ...c.bx, ...c.by] : [c.x, c.y, c.a, c.b]; return xs.every(Number.isFinite) && Number.isFinite(c.head); };
function lateral(c, i){ const i0 = Math.max(0, i - 1), i1 = Math.min(c.g.n - 1, i + 1); let tx = c.bx[i0] - c.bx[i1], ty = c.by[i0] - c.by[i1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l; return (c.px[i] - c.bx[i]) * -ty + (c.py[i] - c.by[i]) * tx; }

/* names that between them cover every form a base type has (first name found for each form, plus two spares) */
board();
const COVER = {}, FORMS = {};
for (const kind of ALL){
  const seen = new Map(); for (let i = 0; i < 3000; i++){ const t = S.nameFrom(i * 31 + 5), f = S.genome(kind, t, true).form; if (!seen.has(f)) seen.set(f, t); }
  FORMS[kind] = [...seen.keys()]; COVER[kind] = [...seen.values(), S.nameFrom(90001), S.nameFrom(90002)];
}
const kindNote = kind => `${COVER[kind].length} names, forms: ${FORMS[kind].join(' ')}`;

/* ── 1. every form: stays finite, stays on the board, never teleports, is repeatable ── */
for (const kind of ALL){
  let okFinite = true, okBounds = true, worstStep = 0, maxTurn = 0, worst = '';
  for (const name of COVER[kind]){
    const c = solo(kind, name), g = c.g, top = (kind === 'jelly' ? g.speed * 6 : g.flight === 'dart' ? g.speed * 1.2 : g.flight ? g.speed * 2.4 : g.speed * 1.4) * S.U; let [lx, ly] = headOf(c), lh = c.head;
    run(60, () => {
      if (!finite(c)) okFinite = false;
      const [x, y] = headOf(c), d = Math.hypot(x - lx, y - ly);
      if (!(kind === 'jelly' && d > S.GH * .5)) worstStep = Math.max(worstStep, d / DT / top);        // a jelly re-entering from below is the one allowed jump
      maxTurn = Math.max(maxTurn, Math.abs(angDiff(c.head, lh)) / DT); lx = x; ly = y; lh = c.head;
      const mx = S.GW * .3, my = kind === 'jelly' ? S.GH * 1.2 : S.GH * .3;
      if (x < -mx || x > S.GW + mx || y < -my || y > S.GH + my){ okBounds = false; worst = `"${name}" at ${x | 0},${y | 0}`; }
    });
  }
  check('sanity', `${kind}: state stays finite`, okFinite, kindNote(kind));
  check('sanity', `${kind}: stays on or near the board`, okBounds, worst);
  check('sanity', `${kind}: no teleporting`, worstStep < 1.5, `fastest frame = ${f2(worstStep)} × its own top speed`);
  check('sanity', `${kind}: no snap turns`, maxTurn < 9, `peak turn rate ${f2(maxTurn)} rad/s`);
  const a = solo(kind, COVER[kind][0]); run(20); const pa = headOf(a); const b = solo(kind, COVER[kind][0]); run(20); const pb = headOf(b);
  check('sanity', `${kind}: same name → same motion`, pa[0] === pb[0] && pa[1] === pb[1]);
}

/* ── 2. swimmers: joints keep their spacing, the wave runs head → tail and grows, the body slips through the water ── */
for (const kind of ['serpent', 'fish']){
  let segErr = 0, maxBend = 0, envBad = [], lagBad = [], slipBad = []; const slips = [], cvs = [], glide = [], lead = [], steady = [];
  for (const name of COVER[kind]){
    const c = solo(kind, name), g = c.g, n = g.n, seg = g.seg * S.U, waves = g.wave.k * (n - 1) / TAU, i1 = Math.round(n * .5), i2 = Math.min(n - 1, i1 + Math.max(1, Math.round(.22 * (n - 1) / waves)));
    const d1 = [], d2 = [], vs = [], effs = [], env = [[], [], []]; let lastW = c.wph, wsum = 0, dist = 0, lp = [c.bx[0], c.by[0]];
    run(8);
    run(40, () => {
      for (let i = 0; i < n - 1; i++){
        segErr = Math.max(segErr, Math.abs(Math.hypot(c.px[i] - c.px[i+1], c.py[i] - c.py[i+1]) - seg));
        if (i > 0){ const a = Math.atan2(c.py[i-1] - c.py[i], c.px[i-1] - c.px[i]), b = Math.atan2(c.py[i] - c.py[i+1], c.px[i] - c.px[i+1]); maxBend = Math.max(maxBend, Math.abs(angDiff(a, b))); }
      }
      const third = n / 3; for (let i = 0; i < n; i++) env[Math.min(2, Math.floor(i / third))].push(lateral(c, i) ** 2);
      d1.push(lateral(c, i1)); d2.push(lateral(c, i2)); vs.push(c.v); effs.push(c.eff);
      wsum += c.wph - lastW; lastW = c.wph; dist += Math.hypot(c.bx[0] - lp[0], c.by[0] - lp[1]); lp = [c.bx[0], c.by[0]];
    });
    const e = env.map(a => Math.sqrt(mean(a))); if (!(e[0] < e[1] && e[1] < e[2])) envBad.push(`${g.form} ${e.map(f2).join('/')}`);
    const lag = bestLag(d1, d2, 110)[0] * DT; if (!(lag > 0)) lagBad.push(`${g.form} ${f2(lag)}s`);
    const slip = (dist / 40) / ((wsum / 40) / g.wave.k * seg); slips.push(slip); if (!(slip > .4 && slip < .98)) slipBad.push(`${g.form} ${f2(slip)}`);
    const cv = sd(vs) / mean(vs);
    if (kind === 'fish' && g.idle < .2){                          // the burst-and-glide forms
      cvs.push(cv); lead.push(bestLag(effs, vs, 90)[0] * DT);
      for (let i = 60; i < effs.length - 60; i++) if (effs[i - 1] > .9 && effs[i] < effs[i - 1] - 1e-6 && effs[i + 30] < .7) glide.push(vs[i + 30] / vs[i]);
    } else steady.push(cv);
  }
  check('swim', `${kind}: joints stay exactly one segment apart`, segErr < 1e-2, `max error ${segErr.toExponential(1)} px over ${kindNote(kind)}`);
  check('swim', `${kind}: no kinks`, maxBend < 1.45, `sharpest joint ${f2(maxBend)} rad`);
  check('swim', `${kind}: sway grows from head to tail in every form`, envBad.length === 0, envBad.join('; ') || 'all forms');
  check('swim', `${kind}: wave travels head → tail in every form`, lagBad.length === 0, lagBad.join('; ') || 'all forms');
  check('swim', `${kind}: body slips (moves slower than its own wave)`, slipBad.length === 0, `speed ÷ wave speed ${f2(Math.min(...slips))}–${f2(Math.max(...slips))} ${slipBad.join('; ')}`);
  if (kind === 'fish'){
    check('swim', 'fish: the bursting forms really burst and glide', cvs.length >= 3 && Math.min(...cvs) > .15, `speed variation ${cvs.map(f2).join(', ')}`);
    check('swim', 'fish: keeps gliding half a second after the tail stops', glide.length > 5 && mean(glide) > .7, `${glide.length} coasts, speed kept ${f2(mean(glide))}`);
    check('swim', 'fish: the tail works first, speed follows', lead.every(l => l > .08), `speed trails tail effort by ${f2(mean(lead))} s`);
    check('swim', 'fish: the cruising forms (ray, tadpole, puffer) keep a steadier pace', steady.length >= 2 && mean(steady) < mean(cvs), `variation ${f2(mean(steady))} vs ${f2(mean(cvs))}`);
  } else check('swim', 'serpent: undulates continuously', Math.max(...steady) < .2, `speed variation up to ${f2(Math.max(...steady))}`);
}

/* ── 3. walkers: planted feet do not slide, legs never over-reach, the gait pattern is the intended one ── */
for (const kind of ['lizard', 'crawler']){
  let slide = 0, ext = [], fixes = 0, legSecs = 0, bothSides = 0, sync = 0, syncN = 0, pauseMove = 0, inside = 0, stanceN = 0, pausesSeen = 0, stepHz = 0; const stepsErr = [], coup = [], lagErr = [], dutyErr = [];
  for (const name of COVER[kind]){
    const c = solo(kind, name), g = c.g, lg = g.legs, maxLen = (lg.l1 + lg.l2) * S.U, vmax = g.speed * S.U;
    run(4);
    const prev = c.legs.map(L => ({ x:L.fx, y:L.fy, sw:L.sw, fix:L.fixT })), steps = c.legs.map(() => 0), onset = c.legs.map(() => []), duty = [], lat = [], pred = [], gp0 = c.gp; let gpl = c.gp, tick = 0;
    run(60, () => {
      const moving = c.v > vmax * .6, still = c.v < .5; if (still) pausesSeen++; tick = Math.max(tick, c.gp - gpl); gpl = c.gp; stepHz = Math.max(stepHz, c.v / (lg.cycle * S.U));
      c.legs.forEach((L, q) => {
        const P = prev[q], moved = Math.hypot(L.fx - P.x, L.fy - P.y);
        if (!L.sw && !P.sw && !L.fixT && !P.fix){ slide = Math.max(slide, moved); stanceN++; if (Math.hypot(L.fx - c.px[L.i], L.fy - c.py[L.i]) < c.r[L.i]) inside++; }
        if (still) pauseMove = Math.max(pauseMove, moved);
        if (L.fixT && !P.fix) fixes++;
        if (L.sw && !P.sw){ steps[q]++; onset[q].push(c.gp); }
        ext.push(Math.hypot(L.fx - L.hx, L.fy - L.hy) / maxLen);
        if (moving) duty.push(L.sw ? 0 : 1);
        P.x = L.fx; P.y = L.fy; P.sw = L.sw; P.fix = L.fixT;
      });
      legSecs += c.legs.length * DT;
      for (let q = 0; q < c.legs.length; q += 2) if (c.legs[q].sw && c.legs[q + 1].sw) bothSides++;
      if (kind === 'lizard' && moving){ syncN++; if (c.legs[0].sw === c.legs[3].sw && c.legs[1].sw === c.legs[2].sw) sync++; lat.push(lateral(c, g.mid)); pred.push(-Math.cos(TAU * (c.gp - lg.swing))); }
    });
    steps.forEach(s => stepsErr.push(Math.abs(s - (c.gp - gp0)))); dutyErr.push(Math.abs(mean(duty) - (1 - lg.swing)));
    if (kind === 'lizard') coup.push(corr(lat, pred));
    else for (let q = 0; q + 2 < c.legs.length; q += 2) for (const ga of onset[q]){ const gb = onset[q + 2].find(x => x > ga); if (gb !== undefined && gb - ga < 1) lagErr.push(Math.max(0, Math.abs((gb - ga) - lg.lag) - tick)); }   // the next pair back starts a fixed share of a cycle later
  }
  ext.sort((a, b) => a - b);
  check('walk', `${kind}: planted feet never slide`, slide === 0, `max stance-foot movement ${slide} px over ${stanceN} samples; ${kindNote(kind)}`);
  check('walk', `${kind}: feet stay outside the body`, inside / stanceN < .004, `${inside} of ${stanceN} stance samples under the body`);
  check('walk', `${kind}: legs never over-reach`, ext[Math.floor(ext.length * .999)] <= 1, `99.9th pct reach = ${f2(ext[Math.floor(ext.length * .999)])} of leg length, max ${f2(ext[ext.length - 1])}`);
  check('walk', `${kind}: corrective steps are rare`, fixes / (legSecs / 60) < 2, `${f2(fixes / (legSecs / 60))} per leg per minute`);
  check('walk', `${kind}: time on the ground matches the gait`, Math.max(...dutyErr) < .05, `worst error ${f2(Math.max(...dutyErr))}`);
  check('walk', `${kind}: left and right of a pair never swing together`, bothSides === 0, `${bothSides} frames`);
  check('walk', `${kind}: one step per gait cycle, tied to distance`, Math.max(...stepsErr) <= 1.01, `worst step-count error ${f2(Math.max(...stepsErr))}`);
  check('walk', `${kind}: stands still when paused`, pausesSeen > 60 && pauseMove < .5, `${pausesSeen} paused frames, max foot drift ${f2(pauseMove)} px`);
  if (kind === 'lizard'){
    check('walk', 'lizard: diagonal feet move as pairs (trot)', sync === syncN, `${sync}/${syncN} frames in step`);
    check('walk', 'lizard: trunk bends in time with the feet, every form', Math.min(...coup) > .8, `spine↔gait correlation ${coup.map(f2).join(', ')}`);
  } else check('walk', 'crawler: stepping wave runs down the body at each form\'s own lag', lagErr.length > 200 && Math.max(...lagErr) < .01, `${lagErr.length} pair-to-pair onsets, worst error ${f2(Math.max(...lagErr))} of a cycle beyond one frame`);
  check('walk', `${kind}: steps slowly enough to be seen`, stepHz < 4, `fastest stepping ${f2(stepHz)} per second`);
}

/* ── 4. jellyfish: upright, pulse then surge then glide, tentacles trail and wave with the bell ── */
{
  let tilt = 0, segErr = 0, trail = 0, trailN = 0, wraps = 0; const peakPh = [], troughPh = [], aAt = [], lock = [];
  for (const name of COVER.jelly){
    const c = solo('jelly', name), bins = Array.from({ length: 20 }, () => []), abin = Array.from({ length: 20 }, () => []), tip = []; let ly = c.y;
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
    if (tip.length && c.g.tl >= 8){ const d = tip.map((x, i) => x - mean(tip.slice(Math.max(0, i - 90), i + 90))); let z = 0; for (let i = 1; i < d.length; i++) if (d[i - 1] < 0 && d[i] >= 0) z++; lock.push(z / 90 / c.g.freq); }
    const m = bins.map(mean), am = abin.map(mean); peakPh.push(m.indexOf(Math.max(...m)) / 20); troughPh.push(m.indexOf(Math.min(...m)) / 20); aAt.push(am.indexOf(Math.min(...am)) / 20);
  }
  check('jelly', 'bell stays upright', tilt < .9, `max tilt ${f2(tilt)} rad; ${kindNote('jelly')}`);
  check('jelly', 'surge follows the squeeze', peakPh.every(p => p >= .1 && p <= .45), `fastest at ${peakPh.map(f2).join(', ')} of the cycle (squeeze ends at 0.28)`);
  check('jelly', 'slowest just before the next squeeze', troughPh.every(p => p >= .85 || p <= .08), `slowest at ${troughPh.map(f2).join(', ')}`);
  check('jelly', 'rim closes a beat after the crown', aAt.every(p => p > .28 && p < .5), `narrowest at ${aAt.map(f2).join(', ')}`);
  check('jelly', 'tentacles keep their length', segErr < 1e-2, `max error ${segErr.toExponential(1)} px`);
  check('jelly', 'tentacles trail behind', trail / trailN > .97, `${f2(100 * trail / trailN)}% of samples`);
  check('jelly', 'long tentacles wave in time with the bell', lock.length >= 2 && lock.every(r => r > .7 && r < 1.35), `tentacle sway rate ÷ pulse rate = ${lock.map(f2).join(', ')}`);
  check('jelly', 're-enters from below after leaving the top', wraps >= 3, `${wraps} re-entries`);
}

/* ── 5. butterfly: wings in step, flap pushes, glides and perches really happen ── */
{
  let spanOK = true, sawPerch = 0, sawGlide = 0, sawFlap = 0, perchV = [], perchRange = []; const hz = [], lagH = [], surge = [], tort = [];
  for (const name of COVER.butterfly){
    const c = solo('butterfly', name), th = [], thH = [], vDown = [], vUp = [], tflap = []; let perchT = 0, pth = [], path = 0, p0 = headOf(c), lp = headOf(c), win = 0, tt = 0;
    run(3);
    run(90, () => {
      tt += DT; const [a, b] = c.span(); if (!(a >= .12 && a <= 1 && b >= .12 && b <= 1)) spanOK = false;
      const [x, y] = headOf(c);
      if (c.perch){ sawPerch++; perchT += DT; if (perchT > 1.2){ perchV.push(c.v); pth.push(c.th); } }
      else { if (pth.length > 60) perchRange.push(Math.max(...pth) - Math.min(...pth)); pth = []; perchT = 0;
        if (c.glide) sawGlide++; else { sawFlap++; tflap.push(tt); th.push(c.th); thH.push(c.thH); (c.down > .6 ? vDown : c.down === 0 ? vUp : []).push(c.v); }
        path += Math.hypot(x - lp[0], y - lp[1]); win++; if (win === 120){ const net = Math.hypot(x - p0[0], y - p0[1]); if (net > 20) tort.push(path / net); path = 0; win = 0; p0 = [x, y]; } }
      lp = [x, y];
    });
    const mid = (Math.max(...th) + Math.min(...th)) / 2, pk = []; for (let i = 1; i < th.length - 1; i++) if (th[i] > th[i-1] && th[i] >= th[i+1] && th[i] > mid) pk.push(tflap[i]);
    const gaps = []; for (let i = 1; i < pk.length; i++){ const d = pk[i] - pk[i-1]; if (d < .6) gaps.push(d); }
    hz.push(1 / mean(gaps) / c.g.flapHz); lagH.push(bestLag(th, thH, 12)[0] * DT); surge.push(mean(vDown) / mean(vUp));
  }
  const fishT = []; for (const name of COVER.fish){ const c = solo('fish', name); let path = 0, p0 = headOf(c), lp = headOf(c), win = 0; run(3); run(40, () => { const [x, y] = headOf(c); path += Math.hypot(x - lp[0], y - lp[1]); lp = [x, y]; if (++win === 120){ const net = Math.hypot(x - p0[0], y - p0[1]); if (net > 20) fishT.push(path / net); path = 0; win = 0; p0 = [x, y]; } }); }
  check('butterfly', 'wing spans stay in range', spanOK, kindNote('butterfly'));
  check('butterfly', 'flaps, glides and perches all occur', sawPerch > 300 && sawGlide > 300 && sawFlap > 1000, `frames: flap ${sawFlap}, glide ${sawGlide}, perch ${sawPerch}`);
  check('butterfly', 'every form beats at its own rate', hz.every(r => r > .85 && r < 1.12), `measured ÷ genome flap rate = ${hz.map(f2).join(', ')}`);
  check('butterfly', 'hindwings follow the forewings', lagH.every(l => l > 0 && l < .12), `hindwing lag ${f2(mean(lagH) * 1000)} ms`);
  check('butterfly', 'downstroke pushes it forward', surge.every(s => s > 1.08), `speed on downstroke ÷ upstroke = ${surge.map(f2).join(', ')}`);
  check('butterfly', 'comes to rest when perched', mean(perchV) < 2, `mean perched speed ${f2(mean(perchV))} px/s`);
  check('butterfly', 'opens and closes its wings while perched', perchRange.length > 3 && mean(perchRange) > .9, `wing angle sweep ${f2(mean(perchRange))} rad over ${perchRange.length} perches`);
  check('butterfly', 'flight path is more erratic than a fish', mean(tort) > mean(fishT) * 1.1, `path ÷ straight line: butterfly ${f2(mean(tort))}, fish ${f2(mean(fishT))}`);
  // seen head-on (heading straight up) the two sides must mirror, tails and tips included
  let worst = 0, cells = 1e9;
  for (const name of COVER.butterfly.map(n => 'big ' + n)){
    const c = solo('butterfly', name); c.head = -Math.PI / 2; for (let i = 0; i < c.g.n; i++){ c.bx[i] = Math.floor(S.GW / 2 / CW) * CW + CW / 2; c.by[i] = S.GH / 2 + i * c.g.seg * S.U; } c.x = c.bx[0]; c.y = c.by[0]; c.th = c.thH = c.g.thOpen; c.flash = 0; c.g.twd = 0;
    S.rasterize(); const f = S.field(), mid = Math.floor(c.x / CW); let L = 0, mism = 0, tot = 0;
    for (let y = 0; y < f.rows; y++) for (let d = 1; d < 60; d++){ const a = f.fv[y * f.cols + mid - d] > 0, b = f.fv[y * f.cols + mid + d] > 0; if (a) L++; if (a || b){ tot++; if (a !== b) mism++; } }
    worst = Math.max(worst, mism / tot); cells = Math.min(cells, L);
  }
  check('butterfly', 'left and right wings mirror each other in every form', cells > 40 && worst < .05, `worst form ${f2(100 * worst)}% not mirrored; smallest wing ${cells} cells`);
}

/* ── 6. dragonfly: hovers, pivots, darts straight ── */
{
  let hov = 0, dart = 0, n = 0; const dartTurn = [], hovTurn = [];
  for (const name of COVER.dragonfly){ const c = solo('dragonfly', name), vm = c.g.speed * S.U; let lh = c.head; run(3); run(60, () => { n++; const tr = Math.abs(angDiff(c.head, lh)) / DT; lh = c.head; if (c.v < vm * .1){ hov++; hovTurn.push(tr); } else if (c.v > vm * .7){ dart++; dartTurn.push(tr); } }); }
  check('dragonfly', 'spends real time hovering', hov / n > .3, `${f2(100 * hov / n)}% of frames near-still; ${kindNote('dragonfly')}`);
  check('dragonfly', 'darts at speed', dart / n > .06, `${f2(100 * dart / n)}% of frames above 70% top speed`);
  check('dragonfly', 'darts are straight, pivots happen in the hover', mean(dartTurn) < mean(hovTurn) * .6, `turn rate: dart ${f2(mean(dartTurn))} vs hover ${f2(mean(hovTurn))} rad/s`);
}

/* ── 7. what lands on the board: valid glyphs, a real vocabulary, twinkles that come and go ── */
const need = { serpent:14, fish:14, lizard:14, crawler:14, jelly:14, butterfly:14, dragonfly:9, wisp:6 };
for (const kind of ALL){
  const hist = new Map(); let bad = 0, lit = 0, slashes = 0, tw = 0, twLit = 0, twChanged = 0, minLit = 1e9, frames = 0;
  for (const name of COVER[kind]){
    const c = solo(kind, name, 170, 64); c.flash = 0; run(3); let twPrev = null;
    run(6, i => {
      if (i % 6) return; S.rasterize(); const f = S.field(); let n = 0; const cur = new Set();
      for (let q = 0; q < f.fv.length; q++){ const v = f.fv[q]; if (!(v > 0)){ if (!Number.isFinite(v)) bad++; continue; } const k = f.fc[q]; n++;
        if (!(k > 32 && k < 256) || (k > 126 && k < 161)) bad++; hist.set(k, (hist.get(k) || 0) + 1); if (k === 47 || k === 92) slashes++; if (c.g.twd > 0 && v > 1.25 && c.tw.includes(k)){ tw++; cur.add(q); } }
      lit += n; if (c.g.twd > 0) twLit += n; minLit = Math.min(minLit, n); frames++;
      if (twPrev){ let same = 0; for (const q of cur) if (twPrev.has(q)) same++; twChanged += cur.size - same; } twPrev = cur;
    });
  }
  const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(e => String.fromCharCode(e[0])).join('');
  check('board', `${kind}: every glyph is printable`, bad === 0, `${bad} bad cells`);
  check('board', `${kind}: even its smallest form is drawn`, minLit >= (kind === 'wisp' ? 3 : 6), `${Math.round(lit / frames)} cells on average, never fewer than ${minLit}`);
  check('board', `${kind}: uses a real vocabulary`, hist.size >= need[kind], `${hist.size} different glyphs across its forms; commonest: ${top}`);
  check('board', `${kind}: not mostly slashes`, slashes / lit < .3, `${f2(100 * slashes / lit)}% of cells are / or \\`);
  if (kind !== 'wisp'){ const share = tw / Math.max(1, twLit); check('board', `${kind}: twinkles, but sparingly`, share > .002 && share < .12, `${f2(100 * share)}% of a twinkling creature's cells are a bright stray symbol at any moment`);
    check('board', `${kind}: twinkles move around`, twChanged / Math.max(1, tw) > .5, `${f2(100 * twChanged / Math.max(1, tw))}% are in a new cell 0.1 s later`); }
}

/* ── 8. variety: how far apart two creatures of the same base type can be ── */
{
  board(176, 49); const allForms = new Set(), schemes = new Set(), glows = new Set(), skins = new Set(), outs = new Set();
  for (const kind of ALL){
    const G = []; for (let i = 0; i < 300; i++) G.push(S.genome(kind, S.nameFrom(500000 + i * 17), true));
    const forms = new Set(G.map(g => g.form)), sizes = G.map(g => g.size), speeds = G.map(g => g.speed), uniq = new Set(G.map(g => JSON.stringify(g))), names = new Set(G.map((g, i) => S.nameFrom(500000 + i * 17)));
    G.forEach(g => { allForms.add(kind + ':' + g.form); schemes.add(g.scheme); glows.add(g.glow.mode); skins.add(g.skin.t + ':' + String.fromCharCode(...g.skin.c)); outs.add(g.out); });
    const cells = []; for (let i = 0; i < 40; i++){ const c = solo(kind, S.nameFrom(500000 + i * 17), 176, 49); c.flash = 0; run(1.5); S.rasterize(); const f = S.field(); let n = 0; for (let q = 0; q < f.fo.length; q++) if (f.fo[q] === c.id) n++; cells.push(n); }
    board(176, 49);
    check('variety', `${kind}: every form turns up`, forms.size === FORMS[kind].length && forms.size >= (kind === 'wisp' || kind === 'dragonfly' ? 3 : 5), `${forms.size} forms in 300 names: ${[...forms].join(' ')}`);
    check('variety', `${kind}: every different name makes a different creature`, uniq.size === names.size && names.size > 290, `${names.size} distinct names → ${uniq.size} distinct genomes`);
    check('variety', `${kind}: real range of size and speed`, pct(sizes, .95) / pct(sizes, .05) > 2.2 && pct(speeds, .95) / pct(speeds, .05) > (kind === 'dragonfly' ? 1.6 : 2.2), `size ×${f2(pct(sizes, .05))}–×${f2(pct(sizes, .95))}, speed ${Math.round(pct(speeds, .05))}–${Math.round(pct(speeds, .95))} units/s (5th–95th pct)`);
    check('variety', `${kind}: real range of footprint on the board`, pct(cells, .95) / Math.max(1, pct(cells, .05)) > (kind === 'wisp' ? 1.5 : 4), `${pct(cells, .05)}–${pct(cells, .95)} cells (5th–95th pct), ${Math.min(...cells)}–${Math.max(...cells)} overall`);
  }
  check('variety', 'colour schemes, glow behaviours, textures, outlines all vary', schemes.size >= 7 && glows.size === 5 && skins.size >= 60 && outs.size >= 6, `${allForms.size} forms, ${schemes.size} colour schemes, ${glows.size} glow behaviours, ${skins.size} textures, ${outs.size} outline styles`);
}

/* ── 9. fuzz: random names and random word combinations must still produce sound creatures ── */
{
  const words = ['tiny', 'small', 'big', 'huge', 'giant', 'slow', 'fast', 'long', 'short', 'fat', 'thin', 'spiky', 'bright', 'dim', 'sparkly', 'ghost', 'rainbow', 'strobe', 'red', 'blue', '#@%', '<>~', '0', '!!'];
  const rng = S.mulberry32(20261118); let runs = 0; const bad = [];
  for (const kind of ALL) for (let t = 0; t < 26; t++){
    let name = S.nameFrom((rng() * 1e9) | 0); for (let w = 0, k = (rng() * 4) | 0; w < k; w++) name = words[(rng() * words.length) | 0] + ' ' + name;
    const c = solo(kind, name, 150, 56), g = c.g, seg = g.seg * S.U; let why = ''; const prev = c.legs ? c.legs.map(L => ({ x:L.fx, y:L.fy, sw:L.sw, fix:L.fixT })) : null, maxLen = c.legs ? (g.legs.l1 + g.legs.l2) * S.U : 0; let over = 0, legN = 0;
    run(20, i => {
      if (why) return; if (!finite(c)){ why = 'not finite'; return; }
      if (c.px) for (let j = 0; j < g.n - 1; j++) if (Math.abs(Math.hypot(c.px[j] - c.px[j+1], c.py[j] - c.py[j+1]) - seg) > .01){ why = 'joint spacing'; return; }
      if (c.legs) c.legs.forEach((L, q) => { const P = prev[q]; if (!L.sw && !P.sw && !L.fixT && !P.fix && (L.fx !== P.x || L.fy !== P.y)) why = 'foot slid'; legN++; if (Math.hypot(L.fx - L.hx, L.fy - L.hy) > maxLen * 1.001) over++; P.x = L.fx; P.y = L.fy; P.sw = L.sw; P.fix = L.fixT; });
      if (c.tent) for (const tt of c.tent){ const s = tt.s; for (let j = 0; j < s.n - 1; j++) if (Math.abs(Math.hypot(s.x[j] - s.x[j+1], s.y[j] - s.y[j+1]) - s.seg) > .01) why = 'tentacle length'; }
      if (i % 20 === 0){ S.rasterize(); const f = S.field(); let n = 0; for (let q = 0; q < f.fv.length; q++){ if (!(f.fv[q] > 0)) continue; const k = f.fc[q]; if (f.fo[q] === c.id) n++; if (!(k > 32 && k < 256) || (k > 126 && k < 161)) why = 'bad glyph ' + k; } if (n < (kind === 'wisp' ? 2 : 3) && c.x > 0 && c.x < S.GW && c.y > 0 && c.y < S.GH) why = 'not drawn'; }
    });
    if (!why && legN && over / legN > .002) why = `over-reach ${f2(100 * over / legN)}%`;
    runs++; if (why) bad.push(`${kind} "${name}" (${g.form}): ${why}`);
  }
  check('fuzz', 'random names with random descriptive words all make sound creatures', bad.length === 0, bad.length ? bad.slice(0, 4).join(' | ') : `${runs} creatures, 20 s each: finite, joints exact, feet planted, within reach, drawn, printable`);
}

/* ── 10. the whole tank ── */
{
  S.configure(176, 51, CW, CH); S.reset(); S.buildScene(0x4f2a); let ok = true, t0 = process.hrtime.bigint();
  run(40, () => { if (!S.creatures.every(finite)) ok = false; S.rasterize(); });
  const ms9 = Number(process.hrtime.bigint() - t0) / 1e6 / (40 * 60), kinds = new Set(S.creatures.map(c => c.g.kind));
  check('tank', 'opening scene has every body plan', ALL.every(k => kinds.has(k)), S.creatures.map(c => `${c.g.form} ${c.g.kind}`).join(', '));
  check('tank', 'opening scene runs clean for 40 s', ok, `${S.creatures.length} creatures, ${f2(ms9)} ms per frame (step + draw to field) on this machine`);
  check('tank', 'every creature in it has a name that rebuilds it', S.creatures.every(c => JSON.stringify(S.genome(c.g.kind, c.text, true)) === JSON.stringify(c.g)), S.creatures.map(c => c.text).join(', '));
  let near = 0, nn = 0; const nnd = []; run(30, i => { if (i % 30) return; for (const a of S.creatures){ let d = 1e9; for (const b of S.creatures) if (a !== b) d = Math.min(d, Math.hypot(a.x - b.x, a.y - b.y)); nn++; nnd.push(d / S.U); if (d < 30 * S.U) near++; } });
  const chance = .5 / Math.sqrt(S.creatures.length / ((S.GW / S.U) * (S.GH / S.U)));          // mean nearest-neighbour distance if positions were random
  check('tank', 'creatures spread out more than chance', mean(nnd) > chance * 1.1 && near / nn < .04, `nearest neighbour averages ${f2(mean(nnd))} units (random placement would give ${f2(chance)}); ${f2(100 * near / nn)}% of samples within 30 units`);
  const before = S.creatures.length, k0 = S.creatures.map(c => c.g.kind + c.text).join(); S.configure(220, 64, 6, 11); S.rescale(1, 1); run(5);
  check('tank', 'changing cell size keeps every creature and its name', S.creatures.length === before && S.creatures.map(c => c.g.kind + c.text).join() === k0 && S.creatures.every(finite));
  S.configure(234, 70, 6, 11); S.reset(); S.buildScene(7); for (let i = 0; i < 100; i++) S.add(null, null, null, null, 1000 + i);
  ok = true; t0 = process.hrtime.bigint(); let maxParts = 0;
  run(15, () => { if (!S.creatures.every(finite)) ok = false; S.rasterize(); maxParts = Math.max(maxParts, S.parts.length); });
  const ms100 = Number(process.hrtime.bigint() - t0) / 1e6 / (15 * 60), mix = new Set(S.creatures.map(c => c.g.kind + ':' + c.g.form));
  check('tank', '100+ random creatures run clean', ok && maxParts <= 600, `${S.creatures.length} creatures in ${mix.size} different forms, ${f2(ms100)} ms per frame here, ${maxParts} shed particles at peak`);
  S.configure(176, 51, CW, CH); S.reset(); const c = S.add('fish', null, 400, 300, 5); S.pointer(c.x, c.y); run(1, () => S.pointer(c.x, c.y));
  check('tank', 'a creature under the pointer lights up', c.near > .8, `glow ${f2(c.near)}`);
}

/* ── 11. walls: nothing gets its head past the frame, and the frame is drawn ── */
for (const kind of ALL){
  let headOut = 0, nodeOut = 0, nodes = 0, okFinite = true, maxTurn = 0, maxStep = 0;
  for (const name of COVER[kind]){
    const c = solo(kind, name, 120, 60); S.walls = true; let lh = c.head, [lx, ly] = headOf(c);
    run(40, () => {
      if (!finite(c)) okFinite = false;
      const [x, y] = headOf(c); if (x < 0 || x > S.GW || y < 0 || y > S.GH) headOut++;
      maxStep = Math.max(maxStep, Math.hypot(x - lx, y - ly) / DT); lx = x; ly = y;
      maxTurn = Math.max(maxTurn, Math.abs(angDiff(c.head, lh)) / DT); lh = c.head;
      const xs = c.px || c.bx, ys = c.py || c.by; if (xs) for (let i = 0; i < xs.length; i++){ nodes++; if (xs[i] < 0 || xs[i] > S.GW || ys[i] < 0 || ys[i] > S.GH) nodeOut++; }
    });
  }
  check('walls', `${kind}: head never leaves the board`, okFinite && headOut === 0, `${headOut} frames outside`);
  if (kind !== 'jelly') check('walls', `${kind}: body stays inside too`, nodeOut / nodes < .01, `${f2(100 * nodeOut / nodes)}% of joint samples outside`);
  else check('walls', 'jelly: turns back instead of leaving by the top', maxStep < 400, `largest single-frame move ${f2(maxStep)} px/s`);
  check('walls', `${kind}: turns away without snapping`, maxTurn < 9, `peak turn rate ${f2(maxTurn)} rad/s`);
}
{
  S.configure(120, 50, CW, CH); S.reset(); S.buildScene(3, 1); S.walls = true; S.rasterize(); let f = S.field(), ring = 0, bad = 0;
  for (let y = 0; y < f.rows; y++) for (let x = 0; x < f.cols; x++){ const edge = x === 0 || y === 0 || x === f.cols - 1 || y === f.rows - 1, w = f.fo[y * f.cols + x] === S.WALL; if (w) ring++; if (w !== edge) bad++; }
  check('walls', 'frame is drawn on the outer ring of cells and nowhere else', bad === 0 && ring === 2 * (f.cols + f.rows) - 4, `${ring} frame cells`);
  S.walls = false; S.rasterize(); f = S.field(); let left = 0; for (let i = 0; i < f.fo.length; i++) if (f.fo[i] === S.WALL) left++;
  check('walls', 'frame disappears when walls are off', left === 0);
}

/* ── 12. tools: pick a creature, reshape it from a base and a name, copy it, delete it ── */
{
  let hit = 0, tried = 0, miss = 0;
  for (const kind of ALL){
    const c = solo(kind, 'big ' + COVER[kind][0], 160, 60); run(3); S.rasterize(); const f = S.field(); let own = -1;
    for (let i = 0; i < f.fo.length; i++) if (f.fo[i] === c.id){ own = i; break; }
    tried++; if (own >= 0 && S.pickAt((own % f.cols + .5) * CW, ((own / f.cols | 0) + .5) * CH, 0) === c) hit++;
    if (S.pickAt(c.x > S.GW / 2 ? 30 : S.GW - 30, c.y > S.GH / 2 ? 30 : S.GH - 30, 2) !== null) miss++;
  }
  check('tools', 'a click on a creature finds that creature', hit === tried, `${hit}/${tried} base types`);
  check('tools', 'a click on open water finds nothing', miss === 0, `${miss} false hits`);

  board(160, 60); const a = S.add('fish', null, 300, 300, 1), b = S.add('fish', null, 700, 500, 2), idA = a.id, [ax, ay] = headOf(a);
  const a1 = S.reshape(a, 'nick'), b1 = S.reshape(b, 'nick'), a2 = S.reshape(a1, 'nick!');
  check('tools', 'same name on the same base → same creature, whichever one it is typed on', JSON.stringify(a1.g) === JSON.stringify(b1.g), `${a1.g.kind} · ${a1.g.form}`);
  check('tools', 'one more character → a different creature', JSON.stringify(a2.g) !== JSON.stringify(a1.g));
  check('tools', 'reshaping keeps identity and place', a2.id === idA && Math.hypot(a2.x - ax, a2.y - ay) < 1 && S.creatures.length === 2 && S.creatures.includes(a2), `id ${a2.id}, moved ${f2(Math.hypot(a2.x - ax, a2.y - ay))} px`);

  // one name through all eight bases: the body changes, the character does not
  let cur = S.reshape(a2, 'kalumiro', 'fish', true); const t0 = cur.g, seen = new Set(); let kept = 0;
  for (const k of ALL){ cur = S.reshape(cur, 'kalumiro', k, true); seen.add(cur.g.kind); if (cur.g.size === t0.size && cur.g.hue === t0.hue && cur.g.scheme === t0.scheme && cur.g.glow.mode === t0.glow.mode && cur.text === 'kalumiro' && cur.id === idA) kept++; }
  check('tools', 'changing base keeps the name\'s size, colours and glow, and changes the body', seen.size === ALL.length && kept === ALL.length, `"kalumiro" as ${[...seen].join(', ')}: size ×${f2(t0.size)}, ${t0.scheme} colours, ${t0.glow.mode} glow in all ${kept}`);
  const forced = S.reshape(cur, 'blue snake', 'fish', true).g.kind, worded = S.reshape(S.creatures[0], 'blue snake', 'fish').g.kind;
  check('tools', 'a base word in the name wins when typing; the base button wins when pressed', forced === 'fish' && worded === 'serpent', `pressed fish → ${forced}; typed "blue snake" → ${worded}`);

  const words = { 'red koi':['fish', 0], 'blue snake':['serpent', 218], 'pink moth':['butterfly', 328], 'green gecko':['lizard', 125], 'gold medusa':['jelly', 48] }; let okW = 0;
  for (const [t, [k, h]] of Object.entries(words)){ cur = S.reshape(S.creatures[0], t); if (cur.g.kind === k && Math.abs(angDiff(cur.g.hue * TAU / 360, h * TAU / 360)) < .16) okW++; }
  check('tools', 'colour words and base words are taken literally', okW === 5, `${okW}/5 phrases`);
  const G = (k, t) => S.genome(k, t, true), tiny = G('fish', 'tiny zed').size, giant = G('fish', 'giant zed').size, slow = G('serpent', 'slow zed').pace, fast = G('serpent', 'fast zed').pace;
  const avgN = pre => mean(Array.from({ length:60 }, (_, i) => G('serpent', pre + S.nameFrom(7000 + i)).n)), longN = avgN('long '), plainN = avgN(''), shortN = avgN('short ');
  check('tools', 'tiny / giant, slow / fast, long / short are obeyed', tiny < .5 && giant > 1.6 && fast > slow * 2 && longN > plainN && plainN > shortN, `size ×${f2(tiny)} vs ×${f2(giant)}, pace ${f2(slow)} vs ${f2(fast)}, serpent joints averaged over 60 names: short ${f2(shortN)} / plain ${f2(plainN)} / long ${f2(longN)}`);
  check('tools', 'spiky, rainbow, ghost, sparkly, strobe are obeyed', ALL.filter(k => k !== 'wisp').every(k => { const g = G(k, 'rainbow ghost sparkly strobe zed'); return Math.abs(g.grad) > 300 || g.pale && g.glow.mode === 'strobe' && g.twd >= .04; }) && !!G('lizard', 'spiky zed').frill && !!G('fish', 'spiky zed').frill && G('fish', 'rainbow zed').scheme === 'rainbow' && G('jelly', 'ghost zed').pale);

  let wore = 0; const lettered = ALL.every(k => G(k, 'Zq').tw.includes('Z') && G(k, 'Zq').tw.includes('q'));
  for (const kind of ALL){
    const c = solo(kind, 'big #@% zed', 160, 60); c.flash = 0; const seenG = new Set(); run(4, i => { if (i % 10) return; S.rasterize(); const f = S.field(); for (let q = 0; q < f.fv.length; q++) if (f.fv[q] > 0 && f.fo[q] === c.id) seenG.add(String.fromCharCode(f.fc[q])); });
    if ([...'#@%'].filter(ch => seenG.has(ch)).length >= 2) wore++;
  }
  check('tools', 'symbols typed become the skin, on every base', wore === ALL.length, `${wore}/${ALL.length} base types drawn in # @ %`);
  check('tools', 'letters typed join the set that twinkles', lettered);

  board(160, 60); const c = S.add('lizard', null, 600, 400, 4), kids = S.clone(c, 10);
  check('tools', 'copy ×10 makes ten more of the same', S.creatures.length === 11 && kids.every(k => k.g === c.g && k.text === c.text && k.x > 0 && k.x < S.GW && k.y > 0 && k.y < S.GH && k.id !== c.id));
  S.select(c); S.rasterize(); let f = S.field(), marks = 0; for (let i = 0; i < f.fv.length; i++) if (f.fv[i] > 0 && f.fc[i] === 43 && f.fo[i] === 0 && f.fk[i] === S.WHITE) marks++;
  check('tools', 'the selected creature gets crop marks', marks === 4 && S.selected === c, `${marks} corner marks`);
  const gone = S.remove(c); S.rasterize(); f = S.field(); let owned = 0; for (let i = 0; i < f.fo.length; i++) if (f.fo[i] === c.id) owned++;
  check('tools', 'delete removes it and clears the selection', gone && S.creatures.length === 10 && S.selected === null && owned === 0);
  run(5); check('tools', 'the tank keeps running after edits', S.creatures.every(finite));
}

const w = Math.max(...out.map(r => r[2].length));
let g = '';
for (const [st, grp, name, detail] of out){ if (grp !== g){ g = grp; console.log(`\n${grp.toUpperCase()}`); } console.log(`  ${st === 'PASS' ? '✓' : '✗ FAIL'} ${name.padEnd(w)}  ${detail}`); }
console.log(`\n${out.length - fails}/${out.length} checks passed`);
process.exit(fails ? 1 : 0);
