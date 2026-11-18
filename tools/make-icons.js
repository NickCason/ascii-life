#!/usr/bin/env node
/* Renders tools/icon.html into the PNG icons the manifest and iOS need. Run after changing the icon. */
const path = require('path'); const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(), src = 'file://' + path.join(__dirname, 'icon.html'), out = n => path.join(__dirname, '..', 'icons', n);
  for (const [name, size, q, clear] of [['icon-192.png', 192, '?round=1', true], ['icon-512.png', 512, '?round=1', true], ['maskable-512.png', 512, '?pad=1', false], ['apple-touch-icon.png', 180, '', false]]){
    const p = await b.newPage({ viewport: { width: size, height: size } }); await p.goto(src + q); await p.screenshot({ path: out(name), omitBackground: clear }); await p.close();
  }
  await b.close(); console.log('icons written');
})();
