#!/usr/bin/env node
/* Print a creature's character field as text, several moments apart, so its articulation can be read directly.
   usage: node tests/frames.js <base> [name or form:<form>] [frames=3] [gap seconds=0.15] [warmup seconds=6]
   e.g.   node tests/frames.js fish form:squid 4 0.2      node tests/frames.js jelly "tiny pink nick" */
const S = require('../js/sim.js');
let [kind = 'butterfly', name = 'form:classic', nF = 3, gap = 0.15, warm = 6] = process.argv.slice(2);
const cols = 170, rows = 70; S.configure(cols, rows, 8, 15); S.reset();
if (name.startsWith('form:')){ const want = name.slice(5); let found = null; for (let i = 0; i < 4000 && !found; i++){ const t = S.nameFrom(i * 13 + 1); if (S.genome(kind, t, true).form === want) found = t; } if (!found){ console.error('no name found for form', want); process.exit(1); } name = found; }
const c = S.add(kind, name, S.GW / 2, S.GH / 2, 7), g = c.g;
console.log(`${g.kind} / ${g.form}  "${name}"  size ${g.size.toFixed(2)} pace ${g.pace.toFixed(2)} scheme ${g.scheme} glow ${g.glow.mode} skin ${g.skin.t}:${String.fromCharCode(...g.skin.c)} twinkle ${g.twd}`);
for (let i = 0; i < +warm * 60; i++) S.step(1 / 60);
function grab(){
  S.rasterize(); const f = S.field(), cx = Math.floor(c.x / 8), cy = Math.floor(c.y / 15), R = 50, Ry = 22, lines = [];
  for (let y = Math.max(0, cy - Ry); y < Math.min(rows, cy + Ry); y++){ let s = ''; for (let x = Math.max(0, cx - R); x < Math.min(cols, cx + R); x++){ const i = y * cols + x; s += f.fv[i] > 0 && f.fo[i] === c.id ? String.fromCharCode(f.fc[i]) : ' '; } lines.push(s); }
  while (lines.length && !lines[0].trim()) lines.shift(); while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const ind = Math.min(...lines.filter(l => l.trim()).map(l => l.search(/\S/))); return lines.map(l => l.slice(ind).replace(/\s+$/, ''));
}
for (let k = 0; k < +nF; k++){ console.log(`── t=${S.time.toFixed(2)}s ` + '─'.repeat(40)); console.log(grab().join('\n')); for (let i = 0; i < Math.round(+gap * 60); i++) S.step(1 / 60); }
