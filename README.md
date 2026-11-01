# Grainfall

A 2D falling-sand sandbox that runs in the browser. Pour, burn, melt, freeze,
wire up and blow up 44 materials, each grain simulated with temperature,
density and chemistry.

No build step and no dependencies: open `index.html` and play.

## Running it

- **Quickest:** open `index.html` in a browser (it works from `file://`).
- **Local server:** `npx serve .` or `python3 -m http.server`, then visit the printed URL.
- **Hosting:** the folder is a static site, so it works as-is on GitHub Pages or any static host.

## Controls

| Input | Action |
| --- | --- |
| Drag | Pour the selected material |
| Right-drag | Erase |
| Middle-click, or the **Pick** tool | Pick up the material under the cursor |
| Scroll, `[` `]` | Brush size |
| `Space` | Pause or resume |
| `.` | Advance one tick |
| `D` `E` `H` `C` `P` | Draw, erase, heat, cool, pick tools |
| `R` | Replace mode (paint over existing material) |
| `T` | Thermal camera |
| `G` | Glow effect |
| `?` | Help |

On touch screens, drag to draw and use the tool buttons to erase, heat, cool or pick.

The top bar has playback speed (½× to 4×), three starter scenes plus an empty
world, grain size (fine, normal, coarse), and a save slot stored in your browser.

## Materials

| Group | Materials |
| --- | --- |
| Powders | Sand, Dirt, Gravel, Salt, Snow, Coal, Sawdust, Ash, Rust |
| Liquids | Water, Salt Water, Oil, Acid, Lava, Mud, Nitro, Molten Glass, Molten Metal |
| Gases | Steam, Smoke, Methane |
| Solids | Wall, Stone, Wood, Metal, Glass, Ice, Obsidian |
| Energy | Fire, Ember, Spark, Battery, Lamp, Fuse, Gunpowder, TNT |
| Life | Seed, Plant, Virus |
| Machines | Clone, Void, Heater, Cooler |

Flowers grow on plants and are not in the palette.

## Things to try

- **Lava into water** makes obsidian and a burst of steam. Lava left in the open crusts over into stone.
- **Melt sand** with the Heat tool (above 1300 °C), then let it cool into glass.
- **Boil water** on a heater. The steam rises, cools, condenses on cold surfaces and rains back down.
- **Wire a circuit:** a Battery sends pulses through Metal (and Salt Water, but not pure water) to light Lamps. A Spark on a wire sets off anything flammable at the far end.
- **Lay a Fuse** to some TNT and light it with Fire. Explosives chain together and throw debris.
- **Drop Seeds on Dirt or Mud** and they grow into branching plants with flowers.
- **Touch a Clone block** with any material to turn it into an endless source. Void deletes whatever touches it.
- **Acid** eats through almost anything except glass and wall.
- **Virus** infects whatever it touches, keeping that material's behaviour. Only fire and heat stop it.

## How it works

The world is a grid of cells stored as parallel typed arrays (type,
temperature, lifetime, an auxiliary byte, flags, electric charge and
fall velocity). Each tick:

1. Every cell updates once, bottom row first. The horizontal scan direction
   alternates so nothing drifts to one side. Powders fall and pile, liquids flow
   and level out, gases rise, and denser materials sink through lighter fluids.
2. Electricity moves one cell per tick through conductors, with a short
   refractory period so pulses travel along wires instead of flooding them.
3. Heat diffuses between neighbours, using the harmonic mean of the two
   conductivities. Materials melt, boil, freeze and ignite at their own
   temperatures. Fire needs air, so sealed material smothers.
4. Explosions go off, and flying debris moves until it lands.

A drop that cools in mid-air never hangs there as a solid: lava hardens into
gravel and water freezes into snow.

Rendering writes one pixel per cell into an `ImageData` that CSS scales up
with crisp pixels. Glowing materials also draw to a second canvas that is
blurred and screen-blended on top for bloom.

## Project layout

```
index.html        page shell
css/style.css     layout and theme
js/elements.js    material definitions (the place to add new ones)
js/sim.js         simulation: movement, heat, fire, electricity, explosions
js/render.js      pixel renderer, glow layer and thermal camera
js/scenes.js      starter scenes
js/main.js        UI, input and the main loop
tests/            headless simulation tests (Node, no dependencies)
```

## Adding a material

Add an entry to `DEFS` in `js/elements.js`. Most behaviour comes from its
properties: state, density, conductivity, melting and freezing points,
flammability, explosiveness and conductivity to electricity. Anything more
specific goes in a `BEHAVIOR[...]` function in `js/sim.js`, or in a pairwise
reaction in the `REACTIONS` table.

## Tests

```
npm test          # or: node tests/sim.test.js
```

The suite runs the simulation headlessly in Node. It covers movement,
buoyancy, boiling and condensation, freezing, fire and smothering, fuses and
explosions, circuits, plant growth, acid, clone and void, save and load, every
scene and every material, plus a performance check.
