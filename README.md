# ascii-life

A lit character board of procedurally animated ASCII creatures. Nothing is a sprite: every creature is a small
block of genome data, simulated in pixel space and then written into a grid of character cells.

**Live:** https://nickcason.github.io/ascii-life/

![Reef board](docs/reef.png)

This is the look demo. The tank features (copy one to a hundred, save environments, build your own creature)
are not built yet.

## Run it

Open `index.html` in a browser. No build step, no dependencies.

URL options: `?seed=4f2a` (hex), `&theme=reef|phosphor|amber|vfd`, `&cell=s|m|l`, `&solo=butterfly` (one creature, centred).
Keys: space pauses, `r` reseeds, `t` cycles the board theme. Click the board to release a creature there.

## Creatures

| | how it moves |
|---|---|
| serpent | a wave runs head to tail and grows as it goes; the body slips through the water slower than its own wave |
| fish | stiff front, working tail; beats in bursts, then glides with fins spread |
| jellyfish | the crown squeezes, the rim follows, it surges and coasts; each pulse sends a wave down the tentacles |
| lizard | trot: diagonal feet move as pairs, planted feet stay planted, the trunk bends in time |
| crawler | a stepping wave runs down many legs, left and right out of phase |
| butterfly | seen from above: wings foreshorten as they rise; flaps, glides, and perches to bask |
| dragonfly | hovers, pivots on the spot, darts in a straight line |
| wisp | a blinking mote with a fading tail |

## How it draws

- **Shapes** are signed-distance capsules and ellipses. The outermost ring of cells becomes the outline; the glyph
  is chosen by which way the edge runs and, for near-level edges, by where it crosses the cell (`_ . - ' "`).
- **Skins** fill the inside: depth ramps, bands, spots, and glyphs that point the way the animal is heading.
- **Twinkle**: a small share of a creature's cells briefly become some other bright symbol.
- **Glow** is a one-pixel-per-cell colour canvas, blurred under the glyph canvas. Unlit cells keep a fading ghost.

## Layout

- `js/sim.js`: simulation and rasteriser. No DOM, so it also runs in Node.
- `js/app.js`: canvases, themes, controls.
- `tests/motion.test.js`: 145 checks against the simulation itself: feet that must not slide, waves that must run
  the right way, wings that must stay in step, glyph vocabulary.
- `tests/browser.test.js`: 33 checks in a real browser (Playwright + Chromium). Set `ASCII_LIFE_URL` to test a deployed copy.
- `tests/frames.js`: prints a creature as text, moment by moment: `node tests/frames.js butterfly 6 0.05`.

```
npm install      # Playwright, for the browser checks only
npm test
```
