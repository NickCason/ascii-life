#!/usr/bin/env node
/* Real-browser checks (Playwright + Chromium), driving the page the way a person would on a desk and on a phone.
   Serves the repo over http on a spare port, or tests a deployed copy if ASCII_LIFE_URL is set. Screenshots → tests/out/. */
const path = require('path'), fs = require('fs');
const { chromium, devices } = require('playwright');
const { serve } = require('./serve.js');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const rows = []; let fails = 0, group = '';
const check = (name, ok, detail) => { rows.push([group, !!ok, name, detail || '']); if (!ok) fails++; };

(async () => {
  const local = process.env.ASCII_LIFE_URL ? null : await serve();
  const BASE = process.env.ASCII_LIFE_URL || local.url, url = q => BASE + (q ? '?' + q : '');
  const browser = await chromium.launch();
  async function open(q, opts = {}){
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1, ...opts }), page = await ctx.newPage(), errs = [];
    page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('requestfailed', r => errs.push('request failed: ' + r.url()));
    await page.goto(url(q)); await page.waitForFunction(() => window.__life && window.__life.frames > 5, null, { timeout: 30000 });
    return { ctx, page, errs };
  }
  const count = page => page.evaluate(() => __life.sim.creatures.length);
  // where on screen is creature #i, and where is a patch of open water?
  const spot = (page, i) => page.evaluate(i => { const L = __life, S = L.sim, c = S.creatures[i], f = S.field(), o = L.origin(); L.advance(0);
    const own = []; for (let q = 0; q < f.fo.length; q++) if (f.fo[q] === c.id) own.push(q); if (!own.length) return null; const q = own[own.length >> 1];
    return [o[0] + (q % f.cols + .5) * f.cw, o[1] + ((q / f.cols | 0) + .5) * f.ch]; }, i);
  // the creature with the most cells on the board right now
  const biggest = page => page.evaluate(() => { const L = __life, S = L.sim, f = S.field(), n = new Map(); L.advance(0); for (let q = 0; q < f.fo.length; q++){ const o = f.fo[q]; if (o && o !== S.WALL) n.set(o, (n.get(o) || 0) + 1); } const id = [...n.entries()].sort((a, b) => b[1] - a[1])[0][0]; return S.creatures.findIndex(c => c.id === id); });
  const water = (page, top) => page.evaluate(top => { const L = __life, S = L.sim, f = S.field(), o = L.origin(); L.advance(0);
    for (let t = 0; t < 4000; t++){ const x = 8 + Math.floor(Math.random() * (f.cols - 16)), y = 6 + Math.floor(Math.random() * ((top ? f.rows * .4 : f.rows) - 12)); let free = true;
      for (let dy = -4; dy <= 4 && free; dy++) for (let dx = -5; dx <= 5; dx++) if (f.fo[(y + dy) * f.cols + x + dx]){ free = false; break; }
      if (free) return [o[0] + (x + .5) * f.cw, o[1] + (y + .5) * f.ch, (x + .5) / f.cols, (y + .5) / f.rows]; } return null; }, !!top);
  const ink = page => page.evaluate(() => { const c = document.querySelector('#glyphs'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0, h = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40){ n++; h = (h * 31 + i) | 0; } return [n, h]; });

  group = 'DESK';
  {
    const { ctx, page, errs } = await open('seed=4f2a'); await page.waitForTimeout(1500);
    const a = await ink(page); await page.waitForTimeout(400); const b = await ink(page);
    check('page loads with no errors', errs.length === 0, errs.join(' | '));
    check('glyphs are drawn on the board', a[0] > 3000, `${a[0]} lit pixels`);
    check('the picture changes from moment to moment', a[1] !== b[1]);
    const st = await page.evaluate(() => ({ n: __life.sim.creatures.length, kinds: [...new Set(__life.sim.creatures.map(c => c.g.kind))].sort().join(','), stat: document.querySelector('#stat').textContent, imm: __life.immersive, walls: __life.sim.walls, card: document.querySelector('#card').hidden }));
    check('opening scene includes a butterfly and a dragonfly', /butterfly/.test(st.kinds) && /dragonfly/.test(st.kinds), st.kinds);
    check('desk layout: bezel and rail shown, walls off, no card open', !st.imm && !st.walls && st.card && await page.isVisible('.plate') && await page.isVisible('#rail'), st.stat);
    await page.screenshot({ path: path.join(OUT, 'reef.png') });

    const n0 = st.n; await page.click('#add'); check('+1 adds one creature', await count(page) === n0 + 1);
    await page.click('#add10'); check('+10 adds ten', await count(page) === n0 + 11);
    await page.click('#pause'); const t1 = await page.evaluate(() => __life.sim.time); await page.waitForTimeout(300);
    check('Pause stops the simulation', t1 === await page.evaluate(() => __life.sim.time) && await page.evaluate(() => __life.paused));

    // light: lamps near a creature are lit, lamps far from everything are dark
    const lamp = await page.evaluate(() => { const L = __life, S = L.sim, f = S.field(); L.advance(0); let near = 0, far = 255, nearN = 0;
      for (let i = 0; i < f.fo.length; i++){ if (f.fv[i] > 0) continue; const x = i % f.cols, y = (i / f.cols) | 0; let d = 1e9;
        for (let dy = -12; dy <= 12; dy++) for (let dx = -20; dx <= 20; dx++){ const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= f.cols || Y >= f.rows) continue; if (f.fv[Y * f.cols + X] > .5) d = Math.min(d, Math.hypot(dx * f.cw, dy * f.ch)); }
        if (d < 14){ near += L.lamp(i); nearN++; } else if (d > 1e8) far = Math.min(far, L.lamp(i)); }
      return [near / nearN, far]; });
    check('lamps beside a creature are lit by it; lamps far away stay dark', lamp[0] > 70 && lamp[1] < 6, `mean lamp level ${lamp[0].toFixed(0)}/255 next to a glyph, ${lamp[1]} far from any`);

    // tools (sim paused, so targets hold still)
    const w = await water(page); let n = await count(page); await page.mouse.click(w[0], w[1]);
    const last = await page.evaluate(() => { const S = __life.sim, c = S.creatures[S.creatures.length - 1]; return [S.creatures.length, c.x / S.GW, c.y / S.GH]; });
    check('clicking open water releases a creature there', last[0] === n + 1 && Math.abs(last[1] - w[2]) < .02 && Math.abs(last[2] - w[3]) < .03, `at ${last[1].toFixed(2)}, ${last[2].toFixed(2)} of the board`);
    const fishI = await biggest(page), wantKind = await page.evaluate(i => __life.sim.creatures[i].g.kind, fishI), p = await spot(page, fishI); n = await count(page);
    await page.mouse.click(p[0], p[1]);
    let s = await page.evaluate(() => ({ hidden: document.querySelector('#card').hidden, kind: document.querySelector('#card-kind').textContent, sel: __life.selected && __life.selected.g.kind, n: __life.sim.creatures.length }));
    check('clicking a creature opens its card and adds nothing', !s.hidden && s.kind === wantKind && s.sel === wantKind && s.n === n, `card says "${s.kind}"`);
    const id = await page.evaluate(() => __life.selected.id);
    await page.fill('#card-text', 'red koi nick'); await page.waitForTimeout(400);
    s = await page.evaluate(() => { const c = __life.selected; return { id: c.id, kind: c.g.kind, hue: c.g.hue, tw: c.g.tw, text: c.text, g: JSON.stringify(c.g) }; });
    check('typing reshapes it: red, a fish, drawn in its letters', s.id === id && s.kind === 'fish' && (s.hue < 12 || s.hue > 348) && s.tw.startsWith('redkoi'), `hue ${s.hue.toFixed(0)}, glyphs "${s.tw}"`);
    await page.fill('#card-text', 'pink moth'); await page.waitForTimeout(400);
    const moth = await page.evaluate(() => [__life.selected.g.kind, document.querySelector('#card-kind').textContent, __life.selected.id]);
    check('a species word changes what it is', moth[0] === 'butterfly' && moth[1] === 'butterfly' && moth[2] === id, moth[0]);
    await page.fill('#card-text', 'red koi nick'); await page.waitForTimeout(400);
    check('the same words bring the same creature back', await page.evaluate(() => JSON.stringify(__life.selected.g)) === s.g);
    await page.click('#card-shuffle'); const sh = await page.evaluate(() => [document.querySelector('#card-text').value, __life.selected.text]);
    check('Shuffle writes a word into the box, so the result can be typed again', sh[0].length >= 4 && sh[0] === sh[1], `"${sh[0]}"`);
    n = await count(page); await page.click('#card-copy'); await page.click('#card-copy10');
    check('Copy and Copy ×10 add eleven of it', await count(page) === n + 11);
    const w2 = await water(page); n = await count(page); await page.mouse.click(w2[0], w2[1]);
    check('clicking away closes the card without adding', await page.evaluate(() => document.querySelector('#card').hidden && !__life.selected) && await count(page) === n);
    const p2 = await spot(page, await biggest(page)); await page.mouse.click(p2[0], p2[1]); await page.click('#card-del');
    check('Delete removes the creature and closes the card', await count(page) === n - 1 && await page.evaluate(() => document.querySelector('#card').hidden));
    const p3 = await spot(page, await biggest(page)); await page.mouse.click(p3[0], p3[1]); const wasOpen = await page.evaluate(() => !document.querySelector('#card').hidden); await page.keyboard.press('Escape');
    check('Escape closes the card', wasOpen && await page.evaluate(() => document.querySelector('#card').hidden));
    const pz = await page.evaluate(() => [__life.paused, __life.sim.time]); await page.click('#pause'); await page.waitForTimeout(500); const pz2 = await page.evaluate(() => [__life.paused, __life.sim.time]);
    check('Play resumes', pz[0] && !pz2[0] && pz2[1] > pz[1], `paused ${pz[0]}→${pz2[0]}, clock ${pz[1].toFixed(2)}→${pz2[1].toFixed(2)} s`);

    await page.click('#walls'); await page.evaluate(() => __life.advance(25));
    const wl = await page.evaluate(() => { const S = __life.sim, f = S.field(); let ring = 0; for (let i = 0; i < f.fo.length; i++) if (f.fo[i] === S.WALL) ring++; return { on: S.walls, pressed: document.querySelector('#walls').getAttribute('aria-pressed'), ring, inside: S.creatures.every(c => c.x >= 0 && c.x <= S.GW && c.y >= 0 && c.y <= S.GH), n: S.creatures.length }; });
    check('Walls: frame drawn and every creature held inside', wl.on && wl.pressed === 'true' && wl.ring > 300 && wl.inside, `${wl.n} creatures, ${wl.ring} frame cells`);
    await page.screenshot({ path: path.join(OUT, 'walls.png') }); await page.click('#walls');

    await page.click('#clear'); check('Clear empties the tank', await count(page) === 0);
    await page.click('#reseed'); check('Reseed builds a fresh scene', await count(page) >= 4);
    for (const key of ['s', 'l', 'm']){
      const before = await count(page), pos0 = await page.evaluate(() => __life.sim.creatures.map(c => c.x / __life.sim.GW)); await page.click(`#cell-${key}`); await page.waitForTimeout(250);
      const r = await page.evaluate(() => ({ n: __life.sim.creatures.length, ch: __life.sim.field().ch, pos: __life.sim.creatures.map(c => c.x / __life.sim.GW), ok: __life.sim.creatures.every(c => Number.isFinite(c.x) && Number.isFinite(c.y)) }));
      const drift = Math.max(...r.pos.map((x, i) => Math.abs(x - pos0[i])));
      check(`cell size ${key.toUpperCase()} keeps every creature where it was`, r.n === before && r.ok && drift < .08, `cell height ${r.ch}px, largest shift ${(drift * 100).toFixed(1)}% of the board`);
    }
    for (const th of ['phosphor', 'amber', 'vfd', 'reef']){
      await page.click(`#th-${th}`); await page.waitForTimeout(250);
      check(`${th} board switches on`, await page.evaluate(() => document.querySelector('[data-theme][aria-pressed="true"]').dataset.theme) === th);
      if (th !== 'reef') await page.screenshot({ path: path.join(OUT, th + '.png') });
    }
    await page.keyboard.press('f'); await page.waitForTimeout(300);
    const im = await page.evaluate(() => { const r = document.querySelector('#board').getBoundingClientRect(); return [__life.immersive, r.width * r.height / (innerWidth * innerHeight)]; });
    check('F makes the board the whole window', im[0] && im[1] > .99, `${(im[1] * 100).toFixed(1)}% of the window`);
    await page.keyboard.press('f'); await page.waitForTimeout(300); check('F again brings the bezel back', !(await page.evaluate(() => __life.immersive)));
    check('still no errors after using every control', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  group = 'CREATURES';
  {
    const { ctx, page, errs } = await open('seed=11&solo=fish', { viewport: { width: 760, height: 520 }, deviceScaleFactor: 2 });
    for (const kind of ['serpent', 'fish', 'lizard', 'crawler', 'jelly', 'butterfly', 'dragonfly', 'wisp']){
      const r = await page.evaluate(k => { const L = window.__life, S = L.sim; L.setPaused(true); S.reset(); L.wipe(); const c = S.add(k, 200, S.GW / 2, S.GH / 2, 11);
        if (k === 'butterfly' || k === 'dragonfly'){ c.head = -Math.PI / 2; for (let i = 0; i < c.g.n; i++){ c.bx[i] = c.x; c.by[i] = c.y + i * c.g.seg * S.U; } c.stT = 30; }
        L.advance(k === 'butterfly' || k === 'dragonfly' ? .05 : 4); const f = S.field(); let a = 0; const g0 = Array.from(f.fc);
        for (let i = 0; i < f.fv.length; i++) if (f.fv[i] > 0) a++;
        L.advance(.5); const f2 = S.field(); let moved = 0; for (let i = 0; i < f2.fv.length; i++) if (f2.fv[i] > 0 && f2.fc[i] !== g0[i]) moved++;
        return { a, moved }; }, kind);
      check(`${kind}: drawn and moving`, r.a > (kind === 'wisp' ? 3 : 25) && r.moved > 2, `${r.a} cells, ${r.moved} changed in half a second`);
      await page.screenshot({ path: path.join(OUT, `solo-${kind}.png`) });
    }
    check('no errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  group = 'PHONE';
  {
    const { ctx, page, errs } = await open('seed=4f2a', { ...devices['Pixel 7'] }); await page.waitForTimeout(800);
    const r = await page.evaluate(() => { const b = document.querySelector('#board').getBoundingClientRect(), rail = getComputedStyle(document.querySelector('#rail')), f = __life.sim.field();
      return { imm: __life.immersive, walls: __life.sim.walls, fill: b.width * b.height / (innerWidth * innerHeight), used: f.cols * f.cw * f.rows * f.ch / (innerWidth * innerHeight), sw: document.documentElement.scrollWidth, iw: innerWidth, sh: document.documentElement.scrollHeight, ih: innerHeight, rail: rail.visibility, n: __life.sim.creatures.length, plate: getComputedStyle(document.querySelector('.plate')).display }; });
    check('board is the whole screen', r.imm && r.fill > .995 && r.plate === 'none', `board covers ${(r.fill * 100).toFixed(1)}% of the screen; lit cells cover ${(r.used * 100).toFixed(1)}%`);
    check('nothing scrolls or spills', r.sw <= r.iw && r.sh <= r.ih, `${r.sw}×${r.sh} content in a ${r.iw}×${r.ih} screen`);
    check('walls are on by default, controls tucked away', r.walls && r.rail === 'hidden' && await page.isVisible('#fab'), `${r.n} creatures`);
    await page.screenshot({ path: path.join(OUT, 'phone.png') });
    await page.tap('#fab'); await page.waitForFunction(() => document.querySelector('#rail').getBoundingClientRect().bottom <= innerHeight + 1, null, { timeout: 8000 }).catch(() => {});   // let the slide-up finish
    const sheet = await page.evaluate(() => { const b = document.querySelector('#rail').getBoundingClientRect(); return [getComputedStyle(document.querySelector('#rail')).visibility, b.bottom <= innerHeight + 1 && b.top >= 0, Math.min(...[...document.querySelectorAll('#rail button:not([hidden])')].map(e => e.getBoundingClientRect().height))]; });
    const sb = await page.evaluate(() => { const b = document.querySelector('#rail').getBoundingClientRect(); return [b.top, b.bottom, innerHeight]; });
    check('the button opens the control sheet, fully on screen', sheet[0] === 'visible' && sb[0] >= 0 && sb[1] <= sb[2] + 1, `sheet spans ${sb[0].toFixed(0)}–${sb[1].toFixed(0)} of ${sb[2]}px, ${sheet[0]}`);
    check('sheet buttons are finger-sized', sheet[2] >= 40);
    await page.screenshot({ path: path.join(OUT, 'phone-sheet.png') });
    await page.tap('#pause'); let n = await count(page);
    const w = await water(page, true); await page.touchscreen.tap(w[0], w[1]); await page.waitForTimeout(350);        // above the sheet
    check('tapping the board first closes the sheet, adding nothing', await page.evaluate(() => getComputedStyle(document.querySelector('#rail')).visibility) === 'hidden' && await count(page) === n);
    await page.evaluate(() => { window.__log = []; window.addEventListener('click', e => window.__log.push((e.target.id || e.target.className || e.target.nodeName) + '@' + Math.round(e.clientX) + ',' + Math.round(e.clientY)), true); });
    const bi = await biggest(page), p = await spot(page, bi); await page.touchscreen.tap(p[0], p[1]); await page.waitForTimeout(200);
    const dbg = await page.evaluate(() => JSON.stringify({ log: window.__log, cls: document.body.className, n: __life.sim.creatures.length, iw: innerWidth, ih: innerHeight }));
    const cardBox = await page.evaluate(() => { const c = document.querySelector('#card'), b = c.getBoundingClientRect(); return { hidden: c.hidden, bottom: innerHeight - b.bottom, inside: b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight, font: parseFloat(getComputedStyle(document.querySelector('#card-text')).fontSize) }; });
    check('tapping a creature opens its card along the bottom', !cardBox.hidden && cardBox.inside && cardBox.bottom < 40, cardBox.hidden ? `tapped ${p.map(Math.round)} for creature #${bi}: ${dbg}` : `${cardBox.bottom.toFixed(0)}px above the bottom edge`);
    if (cardBox.hidden) throw new Error('card did not open: ' + dbg);
    check('text box will not trigger iOS zoom', cardBox.font >= 16, `${cardBox.font}px`);
    await page.screenshot({ path: path.join(OUT, 'phone-card.png') });
    await page.fill('#card-text', 'blue snake'); await page.waitForTimeout(400);
    const k = await page.evaluate(() => [__life.selected.g.kind, __life.selected.g.hue]);
    check('typing on the phone reshapes it', k[0] === 'serpent' && Math.abs(k[1] - 218) < 10, `${k[0]}, hue ${k[1].toFixed(0)}`);
    n = await count(page); await page.tap('#card-del');
    check('Delete works by touch', await count(page) === n - 1 && await page.evaluate(() => document.querySelector('#card').hidden));
    const w2 = await water(page); await page.touchscreen.tap(w2[0], w2[1]); check('tapping open water releases a creature', await count(page) === n);
    await page.evaluate(() => { __life.setPaused(false); __life.advance(30); });
    check('after 30 s walled in, every creature is still on screen', await page.evaluate(() => __life.sim.creatures.every(c => c.x >= 0 && c.x <= __life.sim.GW && c.y >= 0 && c.y <= __life.sim.GH)));
    check('no errors on the phone', errs.length === 0, errs.join(' | '));
    await ctx.close();
    const land = await open('seed=4f2a', { ...devices['Pixel 7 landscape'] }); await land.page.waitForTimeout(500);
    const lr = await land.page.evaluate(() => { const b = document.querySelector('#board').getBoundingClientRect(); return [b.width * b.height / (innerWidth * innerHeight), __life.sim.creatures.length, __life.immersive]; });
    check('landscape: still full screen', lr[2] && lr[0] > .995 && lr[1] >= 4 && land.errs.length === 0, `${lr[1]} creatures`);
    await land.page.screenshot({ path: path.join(OUT, 'phone-landscape.png') }); await land.ctx.close();
  }

  group = 'INSTALL';
  {
    const { ctx, page, errs } = await open('seed=4f2a');
    const m = await page.evaluate(async () => { const link = document.querySelector('link[rel="manifest"]'), res = await fetch(link.href), j = await res.json(); const icons = [];
      for (const ic of j.icons.concat([{ src: document.querySelector('link[rel="apple-touch-icon"]').getAttribute('href'), sizes: '180x180' }])){ const b = new DataView(await (await fetch(new URL(ic.src, link.href))).arrayBuffer()); icons.push([ic.sizes, b.getUint32(16) + 'x' + b.getUint32(20), b.getUint32(0) === 0x89504e47]); }
      return { ok: res.ok, j, icons, start: new URL(j.start_url, link.href).href, page: location.origin + location.pathname, theme: document.querySelector('meta[name="theme-color"]').content, apple: !!document.querySelector('meta[name="apple-mobile-web-app-capable"]') }; });
    check('manifest loads and asks for a full-screen app', m.ok && m.j.name === 'ASCII Life' && m.j.display === 'fullscreen' && m.j.display_override.includes('standalone') && m.start === m.page, `start ${m.start}`);
    check('icons exist at the sizes they claim', m.icons.every(i => i[2] && i[0] === i[1]) && m.j.icons.some(i => i.purpose === 'maskable') && m.icons.some(i => i[0] === '512x512') && m.icons.some(i => i[0] === '192x192'), m.icons.map(i => i[1]).join(', '));
    check('iOS home-screen tags present', m.apple && !!m.theme);
    const sw = await page.evaluate(async () => { const reg = await navigator.serviceWorker.ready; return { scope: reg.scope, active: !!reg.active }; });
    check('service worker installs', sw.active && sw.scope === m.page.replace(/index\.html$/, ''), sw.scope);
    await page.reload(); await page.waitForFunction(() => window.__life && window.__life.frames > 5); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.waitForTimeout(600); await ctx.setOffline(true); errs.length = 0;
    await page.reload(); await page.waitForFunction(() => window.__life && window.__life.frames > 5, null, { timeout: 15000 });
    const off = await page.evaluate(async () => [__life.sim.creatures.length, await fetch('README.md?' + Date.now()).then(r => r.ok, () => false)]);   // an uncached file must be unreachable: proof the network really is off
    check('with the network off, the app still starts', off[0] >= 4 && off[1] === false && errs.filter(e => !/README|sw\.js|Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(e)).length === 0, `${off[0]} creatures; uncached file reachable: ${off[1]}; ${errs.filter(e => !/README|sw\.js|Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(e)).join(' | ')}`);
    await page.goto(url('seed=beef&theme=amber')); await page.waitForFunction(() => window.__life && window.__life.frames > 5, null, { timeout: 15000 });
    check('offline with options in the address still starts', await page.evaluate(() => document.querySelector('#stat').textContent.includes('BEEF')));
    await ctx.setOffline(false); await ctx.close();
  }

  group = 'OTHER';
  {
    const rm = await open('seed=4f2a', { viewport: { width: 900, height: 600 }, reducedMotion: 'reduce' });
    const r = await rm.page.evaluate(() => { const f = __life.sim.field(); let n = 0; for (let i = 0; i < f.fv.length; i++) if (f.fv[i] > 0) n++; return [__life.paused, document.querySelector('#pause').textContent, n]; });
    check('reduced-motion setting starts paused, with a picture on screen', r[0] && r[1] === 'Play' && r[2] > 100, `${r[2]} lit cells`); await rm.ctx.close();
    const { ctx, page, errs } = await open('seed=7&cell=s');
    for (let i = 0; i < 10; i++) await page.click('#add10');
    await page.waitForTimeout(4000);
    const s = await page.evaluate(() => ({ n: __life.sim.creatures.length, js: __life.js, fps: __life.fps, ok: __life.sim.creatures.every(c => Number.isFinite(c.x)) }));
    check('100+ creatures: runs without errors', s.ok && errs.length === 0 && s.n > 100, `${s.n} creatures, ${s.js.toFixed(1)} ms of script per frame, ${Math.round(s.fps)} fps in this headless (no-GPU) browser`);
    await page.screenshot({ path: path.join(OUT, 'stress.png') }); await ctx.close();
  }

  await browser.close(); if (local) local.close();
  console.log(`\nBROWSER  ${process.env.ASCII_LIFE_URL || 'local copy over http'}`);
  const w = Math.max(...rows.map(r => r[2].length)); let g = '';
  for (const [grp, ok, name, detail] of rows){ if (grp !== g){ g = grp; console.log(`\n${grp}`); } console.log(`  ${ok ? '✓' : '✗ FAIL'} ${name.padEnd(w)}  ${detail}`); }
  console.log(`\n${rows.length - fails}/${rows.length} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
