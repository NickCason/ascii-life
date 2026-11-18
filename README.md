# ascii-life

A lit character board of procedurally animated ASCII creatures. Nothing is a sprite: every creature is a small
block of genome data, simulated in pixel space and then written into a grid of character cells.

**Live:** https://nickcason.github.io/ascii-life/

![Reef board](docs/reef.png)

Works on a desk and on a phone, installs as an app, and runs offline once loaded.

## Run it

Open `index.html` in a browser, or `node tests/serve.js` and visit the address it prints (installing and offline
use need http). No build step, no dependencies.

- **Click or tap open water** to release a creature there.
- **Click or tap a creature** to open its card:
  - *Type anything.* The text is the creature's seed, so the same words always make the same creature, and the
    characters you typed become the glyphs it is drawn in. A colour word or a species word is taken literally: `red koi`,
    `blue snake`, `pink moth`.
  - *Shuffle* writes a random word into the box. *Copy* and *Copy ×10* duplicate it. *Delete* removes it.
- **Walls** keeps every creature inside a lit frame. On by default on phones.
- **Full screen** makes the board the whole window. On a phone it always is; controls sit behind the ≡ button.

URL options: `?seed=4f2a` (hex), `&theme=reef|phosphor|amber|vfd`, `&cell=s|m|l`, `&walls=1|0`, `&solo=butterfly`.
Keys: space pauses, `r` reseeds, `t` cycles the board, `w` walls, `f` full screen, Esc closes, Delete removes the selection.

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
- **Light** is faked from the board itself. The lamps sit on a grid, so the light falling anywhere is a blurred copy of
  what the board is emitting. That blur is done in script on a cols×rows field at three ranges: a tight glow around
  the glyphs, the light reaching the unlit lamps nearby (each lamp shows the colour that reaches it), and a wide wash
  that carries past the bezel. The wall frame is lit the same way. No CSS blur, mask or blend layers are used, so the
  cost is the same on a phone as on a desktop.

## Layout

- `js/sim.js`: simulation, rasteriser, hit-testing, text → creature. No DOM, so it also runs in Node.
- `js/app.js`: canvases, light, themes, the creature card, controls.
- `manifest.webmanifest`, `sw.js`, `icons/`: install and offline. The worker is network-first, so a deploy shows up
  as soon as you are online. `tools/make-icons.js` regenerates the icons from `tools/icon.html`.
- `tests/motion.test.js`: 182 checks against the simulation itself: feet that must not slide, waves that must run the
  right way, wings in step, walls that must hold, reshaping that must be repeatable.
- `tests/browser.test.js`: 64 checks in a real browser (Playwright + Chromium) on desktop and an emulated phone,
  including install metadata and starting with the network off. Set `ASCII_LIFE_URL` to test a deployed copy.
- `tests/frames.js`: prints a creature as text, moment by moment: `node tests/frames.js butterfly 6 0.05`.

```
npm install      # Playwright, for the browser checks only
npm test
```
