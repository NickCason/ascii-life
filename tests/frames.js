#!/usr/bin/env node
/* Print a creature's character field as text, several moments apart, so its articulation can be read directly.
   usage: node tests/frames.js <kind> [frames=4] [gap seconds=0.12] [seed=7] [warmup seconds=6] */
const S = require('../js/sim.js');
const [kind = 'butterfly', nF = 4, gap = 0.12, seed = 7, warm = 6] = process.argv.slice(2);
const cols = 150, rows = 60;
S.configure(cols, rows, 8, 15); S.clear();
const c = S.add(kind, 200, S.GW / 2, S.GH / 2, +seed);
for (let i = 0; i < +warm * 60; i++) S.step(1 / 60);
function grab(){
  S.rasterize(); const f = S.field();
  let x0 = cols, x1 = 0, y0 = rows, y1 = 0;
  const cx = Math.floor(c.x / 8), cy = Math.floor(c.y / 15), R = 34, Ry = 15;
  const lines = [];
  for (let y = Math.max(0, cy - Ry); y < Math.min(rows, cy + Ry); y++){
    let s = '';
    for (let x = Math.max(0, cx - R); x < Math.min(cols, cx + R); x++){ const i = y * cols + x; s += f.fv[i] > 0 ? String.fromCharCode(f.fc[i]) : ' '; }
    lines.push(s);
  }
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const ind = Math.min(...lines.filter(l => l.trim()).map(l => l.search(/\S/)));
  return lines.map(l => l.slice(ind).replace(/\s+$/, ''));
}
for (let k = 0; k < +nF; k++){
  console.log(`── ${kind} t=${S.time.toFixed(2)}s ` + '─'.repeat(30));
  console.log(grab().join('\n'));
  for (let i = 0; i < Math.round(+gap * 60); i++) S.step(1 / 60);
}
