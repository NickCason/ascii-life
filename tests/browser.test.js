#!/usr/bin/env node
/* Real-browser checks (Playwright + Chromium). Loads the page from disk, or from ASCII_LIFE_URL if set
   (e.g. the GitHub Pages address), and drives it the way a person would. Screenshots land in tests/out/. */
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const BASE = process.env.ASCII_LIFE_URL || 'file://' + path.resolve(__dirname, '..', 'index.html');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const rows = []; let fails = 0;
const check = (name, ok, detail) => { rows.push([ok, name, detail || '']); if (!ok) fails++; };
const url = q => BASE + (q ? (BASE.includes('?') ? '&' : '?') + q : '');

(async () => {
  const browser = await chromium.launch();
  async function open(q, vp = { width: 1440, height: 860 }, extra = {}){
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, ...extra }), page = await ctx.newPage(), errs = [];
    page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('requestfailed', r => errs.push('request failed: ' + r.url()));
    await page.goto(url(q)); await page.waitForFunction(() => window.__life && window.__life.frames > 5, null, { timeout: 20000 });
    return { ctx, page, errs };
  }
  const lit = page => page.evaluate(() => { const f = window.__life.sim.field(); let n = 0; for (let i = 0; i < f.fv.length; i++) if (f.fv[i] > 0) n++; return n; });
  const ink = page => page.evaluate(() => { const c = document.querySelector('#glyphs'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0, h = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40){ n++; h = (h * 31 + i) | 0; } return [n, h]; });

  { // loads clean, draws, animates
    const { ctx, page, errs } = await open('seed=4f2a');
    await page.waitForTimeout(1500);
    const a = await ink(page); await page.waitForTimeout(400); const b = await ink(page);
    check('page loads with no errors', errs.length === 0, errs.join(' | '));
    check('glyphs are drawn on the board', a[0] > 3000, `${a[0]} lit pixels`);
    check('the picture changes from moment to moment', a[1] !== b[1]);
    const st = await page.evaluate(() => ({ n: __life.sim.creatures.length, kinds: [...new Set(__life.sim.creatures.map(c => c.g.kind))].sort().join(','), stat: document.querySelector('#stat').textContent, js: __life.js }));
    check('opening scene includes a butterfly and a dragonfly', /butterfly/.test(st.kinds) && /dragonfly/.test(st.kinds), st.kinds);
    check('status line reports the tank', /creatures · \d+×\d+ cells/.test(st.stat), st.stat);
    await page.screenshot({ path: path.join(OUT, 'reef.png') });

    // controls
    const n0 = st.n; await page.click('#add'); let n = await page.evaluate(() => __life.sim.creatures.length);
    check('+1 adds one creature', n === n0 + 1, `${n0} → ${n}`);
    await page.click('#add10'); n = await page.evaluate(() => __life.sim.creatures.length);
    check('+10 adds ten', n === n0 + 11, `→ ${n}`);
    const box = await page.locator('#board').boundingBox(); await page.mouse.click(box.x + box.width * .3, box.y + box.height * .4);
    const spawned = await page.evaluate(() => { const c = __life.sim.creatures[__life.sim.creatures.length - 1], r = document.querySelector('#board').getBoundingClientRect(); return [__life.sim.creatures.length, c.x / __life.sim.GW, c.y / __life.sim.GH]; });
    check('clicking the board releases a creature where you clicked', spawned[0] === n0 + 12 && Math.abs(spawned[1] - .3) < .03 && Math.abs(spawned[2] - .4) < .04, `at ${spawned[1].toFixed(2)}, ${spawned[2].toFixed(2)} of the board`);
    await page.click('#pause'); const t1 = await page.evaluate(() => __life.sim.time); await page.waitForTimeout(300); const t2 = await page.evaluate(() => __life.sim.time);
    check('Pause stops the simulation', t1 === t2 && await page.evaluate(() => __life.paused));
    await page.click('#pause'); await page.waitForTimeout(200); const t3 = await page.evaluate(() => __life.sim.time);
    check('Play resumes it', t3 > t2);
    await page.click('#clear'); n = await page.evaluate(() => __life.sim.creatures.length);
    check('Clear empties the tank', n === 0);
    await page.click('#reseed'); n = await page.evaluate(() => __life.sim.creatures.length);
    check('Reseed builds a fresh scene', n >= 4, `${n} creatures`);
    for (const key of ['s', 'l', 'm']){
      const before = await page.evaluate(() => __life.sim.creatures.length); await page.click(`#cell-${key}`); await page.waitForTimeout(250);
      const r = await page.evaluate(() => ({ n: __life.sim.creatures.length, ch: __life.sim.field().ch, ok: __life.sim.creatures.every(c => Number.isFinite(c.x) && Number.isFinite(c.y)) }));
      check(`cell size ${key.toUpperCase()} keeps the creatures`, r.n === before && r.ok, `cell height ${r.ch}px`);
    }
    for (const th of ['phosphor', 'amber', 'vfd', 'reef']){
      await page.click(`#th-${th}`); await page.waitForTimeout(250);
      const r = await page.evaluate(() => ({ pressed: document.querySelector('[data-theme][aria-pressed="true"]').dataset.theme, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() }));
      check(`${th} board switches on`, r.pressed === th, `accent ${r.accent}`);
      if (th !== 'reef') await page.screenshot({ path: path.join(OUT, th + '.png') });
    }
    check('still no errors after using every control', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  { // each body plan alone, stepped deterministically: is it drawn, and does it move?
    const { ctx, page, errs } = await open('seed=11&solo=fish', { width: 760, height: 520 }, { deviceScaleFactor: 2 });
    for (const kind of ['serpent', 'fish', 'lizard', 'crawler', 'jelly', 'butterfly', 'dragonfly', 'wisp']){
      const r = await page.evaluate(k => { const L = window.__life, S = L.sim; L.setPaused(true); S.reset(); L.wipe(); const c = S.add(k, 200, S.GW / 2, S.GH / 2, 11);
        if (k === 'butterfly' || k === 'dragonfly'){ c.head = -Math.PI / 2; for (let i = 0; i < c.g.n; i++){ c.bx[i] = c.x; c.by[i] = c.y + i * c.g.seg * S.U; } c.stT = 30; }
        L.advance(k === 'butterfly' || k === 'dragonfly' ? .05 : 4); const f = S.field(); let a = 0; const g0 = Array.from(f.fc);
        for (let i = 0; i < f.fv.length; i++) if (f.fv[i] > 0) a++;
        L.advance(.5); const f2 = S.field(); let moved = 0; for (let i = 0; i < f2.fv.length; i++) if (f2.fv[i] > 0 && f2.fc[i] !== g0[i]) moved++;
        return { a, moved }; }, kind);
      check(`${kind}: drawn and moving in the browser`, r.a > (kind === 'wisp' ? 3 : 25) && r.moved > 2, `${r.a} cells, ${r.moved} changed in half a second`);
      await page.screenshot({ path: path.join(OUT, `solo-${kind}.png`) });
    }
    check('solo runs raise no errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }
  { // phone
    const { ctx, page, errs } = await open('seed=4f2a', { width: 390, height: 780 }, { deviceScaleFactor: 2 });
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, n: __life.sim.creatures.length, right: Math.max(...[...document.querySelectorAll('.plate *, .rail *')].map(e => e.getBoundingClientRect().right)) }));
    check('phone width: nothing spills sideways', r.sw <= r.iw && r.right <= r.iw + .5, `content right edge ${Math.round(r.right)} of ${r.iw}px`);
    check('phone width: still shows creatures', r.n >= 4 && errs.length === 0, `${r.n} creatures`);
    await page.screenshot({ path: path.join(OUT, 'phone.png') });
    await ctx.close();
  }
  { // reduced motion
    const { ctx, page } = await open('seed=4f2a', { width: 900, height: 600 }, { reducedMotion: 'reduce' });
    const r = await page.evaluate(() => ({ p: __life.paused, label: document.querySelector('#pause').textContent })); const n = await lit(page);
    check('reduced-motion setting starts paused, with a picture on screen', r.p && r.label === 'Play' && n > 100, `${n} lit cells`);
    await ctx.close();
  }
  { // stress in a real browser
    const { ctx, page, errs } = await open('seed=7&cell=s');
    for (let i = 0; i < 10; i++) await page.click('#add10');
    await page.waitForTimeout(4000);
    const r = await page.evaluate(() => ({ n: __life.sim.creatures.length, js: __life.js, fps: __life.fps, ok: __life.sim.creatures.every(c => Number.isFinite(c.x)) }));
    check('100+ creatures: runs without errors', r.ok && errs.length === 0 && r.n > 100, `${r.n} creatures, ${r.js.toFixed(1)} ms of script per frame, ${Math.round(r.fps)} fps in this headless (no-GPU) browser`);
    await page.screenshot({ path: path.join(OUT, 'stress.png') });
    await ctx.close();
  }
  await browser.close();
  console.log(`\nBROWSER  (${BASE.replace(/^file:\/\/.*\//, 'file: ')})`);
  const w = Math.max(...rows.map(r => r[1].length));
  for (const [ok, name, detail] of rows) console.log(`  ${ok ? '✓' : '✗ FAIL'} ${name.padEnd(w)}  ${detail}`);
  console.log(`\n${rows.length - fails}/${rows.length} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
