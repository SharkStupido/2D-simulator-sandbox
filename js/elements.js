/*
 * Grainfall: element definitions.
 *
 * Every material in the world is one entry in DEFS. The simulation turns these
 * into flat typed-array lookup tables (see sim.js), so adding a new material is
 * mostly a matter of adding an entry here.
 *
 * Temperatures are in degrees Celsius. Density is relative (air = 1): a moving
 * cell can only push into a fluid cell that is lighter than itself.
 */
(function () {
  'use strict';
  const G = (globalThis.Grainfall = globalThis.Grainfall || {});

  const STATE = { NONE: 0, SOLID: 1, POWDER: 2, LIQUID: 3, GAS: 4 };
  const { NONE, SOLID, POWDER, LIQUID, GAS } = STATE;

  // Palette categories, in display order.
  const CATEGORIES = [
    { key: 'powders', name: 'Powders' },
    { key: 'liquids', name: 'Liquids' },
    { key: 'gases', name: 'Gases' },
    { key: 'solids', name: 'Solids' },
    { key: 'energy', name: 'Energy' },
    { key: 'life', name: 'Life' },
    { key: 'machines', name: 'Machines' },
  ];

  /*
   * Fields (all optional except key/name/state):
   *   cat        palette category, or null to hide from the palette
   *   color      list of hex colours; each grain picks one and is jittered
   *   density    relative density used for sinking / floating
   *   conduct    thermal conductivity 0..1 (0 = perfect insulator)
   *   temp       temperature when freshly placed
   *   relax      rate at which the cell drifts back toward room temperature
   *   slide      powders: chance to slide diagonally off a pile (angle of repose)
   *   disp       liquids: how many cells it can flow sideways per tick
   *   visc       liquids: chance to skip a movement tick (thickness)
   *   rise       gases: chance per tick to drift upward
   *   life       [min, max] lifetime in ticks for short-lived things
   *   melt       [temp, key(, altKey, altChance)] becomes key above temp
   *   freeze     [temp, key] becomes key below temp
   *   flammable  chance per contact to catch fire
   *   ignite     auto-ignition temperature
   *   burn       [minTicks, maxTicks, flameTemp, residueKey, residueChance]
   *   explosive  [radius, power] blast when ignited
   *   impact     explodes when it lands hard
   *   conductor  carries electricity
   *   hardness   0..1 resistance to blasts and acid
   *   indestructible, acidProof, extinguish (puts out fire), glow
   *   debris     what the material shatters into in an explosion
   *   brush      density of the brush spray (1 = solid fill)
   */
  const DEFS = [
    { key: 'empty', name: 'Air', cat: null, state: NONE, color: ['#000000'], density: 1, conduct: 0.005, relax: 0.02, acidProof: true },

    // ---------------------------------------------------------------- Powders
    { key: 'sand', name: 'Sand', cat: 'powders', state: POWDER,
      color: ['#e3c27d', '#d9b46a', '#cfa75d', '#e8cb8c'], density: 160, conduct: 0.15, slide: 0.95,
      melt: [1300, 'molten_glass'], hardness: 0.1,
      desc: 'Pours and piles up. Melts into molten glass above 1300 °C.' },
    { key: 'dirt', name: 'Dirt', cat: 'powders', state: POWDER,
      color: ['#7a5534', '#6b4a2c', '#835c3a', '#5f4127'], density: 150, conduct: 0.12, slide: 0.3, hardness: 0.1,
      desc: 'Clumpy soil. Soaks up water into mud. Seeds sprout on it.' },
    { key: 'gravel', name: 'Gravel', cat: 'powders', state: POWDER,
      color: ['#8d8a85', '#77746f', '#9c9993', '#6a6763'], density: 210, conduct: 0.25, slide: 0.7,
      melt: [1150, 'lava'], hardness: 0.4,
      desc: 'Broken stone. Heavy and loose. Melts back into lava.' },
    { key: 'salt', name: 'Salt', cat: 'powders', state: POWDER,
      color: ['#f2f0ea', '#e6e3dc', '#faf9f6', '#dcd8cf'], density: 130, conduct: 0.2, slide: 0.85, hardness: 0.1,
      desc: 'Dissolves into salt water and melts ice and snow.' },
    { key: 'snow', name: 'Snow', cat: 'powders', state: POWDER,
      color: ['#f4f8fc', '#e8f0f8', '#ffffff', '#dde8f2'], density: 90, conduct: 0.1, temp: -8, slide: 0.25,
      melt: [2, 'water'], hardness: 0.05, extinguish: true,
      desc: 'Starts at −8 °C and settles in soft drifts. Melts above 2 °C.' },
    { key: 'coal', name: 'Coal', cat: 'powders', state: POWDER,
      color: ['#2b2a2d', '#232225', '#353338', '#1d1c1f'], density: 170, conduct: 0.15, slide: 0.5, hardness: 0.3,
      flammable: 0.03, ignite: 380, burn: [700, 1300, 1050, 'ash', 0.6],
      desc: 'Hard to light, but burns for a long time at over 1000 °C.' },
    { key: 'sawdust', name: 'Sawdust', cat: 'powders', state: POWDER,
      color: ['#d7b98a', '#c9a877', '#e0c597', '#bf9d6b'], density: 70, conduct: 0.08, slide: 0.6, hardness: 0.05,
      flammable: 0.5, ignite: 220, burn: [30, 80, 650, 'ash', 0.3],
      desc: 'Light wood shavings. Floats on water and catches fire easily.' },
    { key: 'ash', name: 'Ash', cat: 'powders', state: POWDER,
      color: ['#9a958f', '#a8a39d', '#8b8681', '#b3aea8'], density: 60, conduct: 0.08, slide: 0.5, hardness: 0.02,
      desc: 'What is left after a fire. Light enough to float.' },
    { key: 'rust', name: 'Rust', cat: 'powders', state: POWDER,
      color: ['#9c4a22', '#8a3f1c', '#ad5629', '#7c3618'], density: 190, conduct: 0.1, slide: 0.45, hardness: 0.1,
      desc: 'Flaky iron oxide. Metal slowly rusts in water, faster in salt water.' },

    // ---------------------------------------------------------------- Liquids
    { key: 'water', name: 'Water', cat: 'liquids', state: LIQUID,
      color: ['#2f6fd6', '#2a66c9', '#3478e0', '#2c6ad0'], density: 100, conduct: 0.35, disp: 5,
      melt: [100, 'steam'], freeze: [0, 'ice'], extinguish: true, brush: 0.5,
      desc: 'Boils at 100 °C and freezes at 0 °C. Puts out fires.' },
    { key: 'salt_water', name: 'Salt Water', cat: 'liquids', state: LIQUID,
      color: ['#3a86c8', '#3f8fd1', '#3580c0', '#3888c9'], density: 110, conduct: 0.38, disp: 5,
      melt: [104, 'steam', 'salt', 0.3], freeze: [-6, 'ice'], extinguish: true, conductor: true, brush: 0.5,
      desc: 'Conducts electricity. Boiling it leaves salt behind.' },
    { key: 'oil', name: 'Oil', cat: 'liquids', state: LIQUID,
      color: ['#5a3d17', '#4e3413', '#65461c', '#553a16'], density: 80, conduct: 0.12, disp: 4, visc: 0.15,
      flammable: 0.4, ignite: 240, burn: [80, 160, 800, 'smoke', 0.3], brush: 0.5,
      desc: 'Floats on water and burns with heavy smoke.' },
    { key: 'acid', name: 'Acid', cat: 'liquids', state: LIQUID,
      color: ['#8fe03a', '#7fd42e', '#9cea48', '#86da34'], density: 105, conduct: 0.3, disp: 4, acidProof: true, brush: 0.5,
      desc: 'Eats through almost anything. Glass and wall resist it.' },
    { key: 'lava', name: 'Lava', cat: 'liquids', state: LIQUID,
      color: ['#ff5a14', '#ff7a1e', '#f04a0c', '#ff8f2a'], density: 250, conduct: 0.1, temp: 1600, disp: 2, visc: 0.55,
      freeze: [750, 'stone'], glow: true, hardness: 0.3, brush: 0.5,
      desc: 'Molten rock at 1600 °C. Hardens into stone, or obsidian in water.' },
    { key: 'mud', name: 'Mud', cat: 'liquids', state: LIQUID,
      color: ['#5c3f26', '#523822', '#664629', '#57391f'], density: 150, conduct: 0.25, disp: 1, visc: 0.75,
      melt: [100, 'dirt'], brush: 0.5,
      desc: 'Wet dirt. Thick and slow. Dries back into dirt when heated.' },
    { key: 'nitro', name: 'Nitro', cat: 'liquids', state: LIQUID,
      color: ['#d9e05a', '#cdd44e', '#e3ea6a', '#d3da54'], density: 120, conduct: 0.2, disp: 4,
      flammable: 1, ignite: 160, explosive: [7, 1.6], impact: true, brush: 0.5,
      desc: 'Unstable liquid explosive. Detonates from heat, sparks or a hard landing.' },
    { key: 'molten_glass', name: 'Molten Glass', cat: 'liquids', state: LIQUID,
      color: ['#ffb24a', '#ffa23a', '#ffc15c', '#ffaa44'], density: 230, conduct: 0.25, temp: 1500, disp: 1, visc: 0.7,
      freeze: [1000, 'glass'], glow: true, brush: 0.5,
      desc: 'Glowing, syrupy glass. Sets into solid glass below 1000 °C.' },
    { key: 'molten_metal', name: 'Molten Metal', cat: 'liquids', state: LIQUID,
      color: ['#ffd27a', '#ffc562', '#ffe08f', '#ffcb6e'], density: 700, conduct: 0.8, temp: 1800, disp: 2, visc: 0.3,
      freeze: [1300, 'metal'], glow: true, conductor: true, brush: 0.5,
      desc: 'Liquid metal at 1800 °C. Casts into solid metal as it cools.' },

    // ------------------------------------------------------------------ Gases
    { key: 'steam', name: 'Steam', cat: 'gases', state: GAS,
      color: ['#e4ebf2', '#f0f4f8', '#d8e0ea'], density: 0.6, conduct: 0.004, temp: 110, relax: 0.003, rise: 0.8,
      freeze: [60, 'water'], acidProof: true, brush: 0.3,
      desc: 'Rises, cools and condenses back into water below 60 °C.' },
    { key: 'smoke', name: 'Smoke', cat: 'gases', state: GAS,
      color: ['#5d5f66', '#6a6c73', '#53555c'], density: 0.9, conduct: 0.05, relax: 0.01, rise: 0.6,
      life: [120, 320], acidProof: true, brush: 0.3,
      desc: 'Drifts upward and slowly fades away.' },
    { key: 'methane', name: 'Methane', cat: 'gases', state: GAS,
      color: ['#a7d4a0', '#9fcf9a', '#b1dbaa'], density: 0.5, conduct: 0.05, rise: 0.45, acidProof: true,
      flammable: 0.9, ignite: 350, burn: [2, 6, 1100, 'fire', 1], brush: 0.3,
      desc: 'Invisible-ish flammable gas. Ignites in a fast flash.' },

    // ----------------------------------------------------------------- Solids
    { key: 'wall', name: 'Wall', cat: 'solids', state: SOLID,
      color: ['#4b4f5a', '#454953', '#525661'], density: 10000, conduct: 0, indestructible: true, acidProof: true,
      desc: 'Indestructible and perfectly insulating.' },
    { key: 'stone', name: 'Stone', cat: 'solids', state: SOLID,
      color: ['#7d7f86', '#71737a', '#888a91', '#686a71'], density: 10000, conduct: 0.25, hardness: 0.55,
      melt: [1150, 'lava'], debris: 'gravel',
      desc: 'Solid rock. Melts into lava above 1150 °C.' },
    { key: 'wood', name: 'Wood', cat: 'solids', state: SOLID,
      color: ['#8b5a2b', '#7f5226', '#966331', '#744b22'], density: 10000, conduct: 0.1, hardness: 0.3,
      flammable: 0.04, ignite: 300, burn: [250, 500, 700, 'ash', 0.25], debris: 'sawdust',
      desc: 'Burns steadily and leaves ash.' },
    { key: 'metal', name: 'Metal', cat: 'solids', state: SOLID,
      color: ['#a9b0b8', '#9ea5ad', '#b5bcc4', '#959ca4'], density: 10000, conduct: 0.9, hardness: 0.85,
      melt: [1500, 'molten_metal'], conductor: true,
      desc: 'Conducts heat and electricity. Melts above 1500 °C.' },
    { key: 'glass', name: 'Glass', cat: 'solids', state: SOLID,
      color: ['#bfe3ef', '#cdeaf3', '#b4dcea'], density: 10000, conduct: 0.2, hardness: 0.2,
      melt: [1300, 'molten_glass'], acidProof: true,
      desc: 'Clear and acid-proof, but shatters in blasts.' },
    { key: 'ice', name: 'Ice', cat: 'solids', state: SOLID,
      color: ['#a8d8f0', '#b8e0f4', '#9bd0ea'], density: 10000, conduct: 0.4, temp: -15, hardness: 0.25,
      melt: [2, 'water'], debris: 'snow', extinguish: true,
      desc: 'Starts at −15 °C and chills what it touches. Melts above 2 °C.' },
    { key: 'obsidian', name: 'Obsidian', cat: 'solids', state: SOLID,
      color: ['#2a2238', '#241d31', '#30283f', '#352c47'], density: 10000, conduct: 0.2, hardness: 0.75,
      melt: [1300, 'lava'], debris: 'gravel',
      desc: 'Volcanic glass, formed when lava meets water.' },

    // ----------------------------------------------------------------- Energy
    { key: 'fire', name: 'Fire', cat: 'energy', state: GAS,
      color: ['#ff9a2a'], density: 0.2, conduct: 0.5, temp: 900, rise: 0.8, life: [18, 42], glow: true, acidProof: true, brush: 0.35,
      desc: 'Flickers upward, ignites anything flammable.' },
    { key: 'ember', name: 'Ember', cat: 'energy', state: POWDER,
      color: ['#ff8a2a', '#ff6a1a', '#ffae4a'], density: 50, conduct: 0.3, temp: 850, slide: 0.6, life: [40, 150],
      glow: true, acidProof: true, brush: 0.2,
      desc: 'Glowing hot particle. Falls and sets things alight.' },
    { key: 'spark', name: 'Spark', cat: 'energy', state: GAS,
      color: ['#fff6b0'], density: 0.2, conduct: 0.3, temp: 400, life: [3, 6], glow: true, conductor: true, acidProof: true, brush: 0.4,
      desc: 'Electrifies metal and other conductors. Ignites flammables.' },
    { key: 'battery', name: 'Battery', cat: 'energy', state: SOLID,
      color: ['#3b7d5a', '#357352', '#418763'], density: 10000, conduct: 0.3, hardness: 0.6, conductor: true,
      desc: 'Sends a steady pulse of electricity into touching conductors.' },
    { key: 'lamp', name: 'Lamp', cat: 'energy', state: SOLID,
      color: ['#5e5a48', '#58543f', '#645f4c'], density: 10000, conduct: 0.3, hardness: 0.3, conductor: true,
      desc: 'Lights up when electricity flows through it.' },
    { key: 'fuse', name: 'Fuse', cat: 'energy', state: SOLID,
      color: ['#8f7b55', '#a38d63', '#857250'], density: 10000, conduct: 0.1, hardness: 0.1,
      flammable: 0.9, ignite: 150, burn: [24, 34, 600, null, 0],
      desc: 'Burns along its length at a steady pace. Great for TNT.' },
    { key: 'gunpowder', name: 'Gunpowder', cat: 'energy', state: POWDER,
      color: ['#4a4a50', '#3e3e44', '#56565c', '#606068'], density: 140, conduct: 0.12, slide: 0.8, hardness: 0.05,
      flammable: 1, ignite: 180, explosive: [3, 1.1],
      desc: 'Pours like sand. Each grain pops when lit.' },
    { key: 'tnt', name: 'TNT', cat: 'energy', state: SOLID,
      color: ['#c8352a', '#b82f25', '#d63d31'], density: 10000, conduct: 0.12, hardness: 0.3,
      flammable: 1, ignite: 250, explosive: [10, 1.5],
      desc: 'Big blast. Chains with other explosives.' },

    // ------------------------------------------------------------------- Life
    { key: 'seed', name: 'Seed', cat: 'life', state: POWDER,
      color: ['#b58b3c', '#a37a30', '#c49a48'], density: 110, conduct: 0.1, slide: 0.5, hardness: 0.05,
      flammable: 0.3, ignite: 250, burn: [10, 30, 500, 'ash', 0.5], brush: 0.08,
      desc: 'Drop onto dirt or mud and it grows into a flowering plant.' },
    { key: 'plant', name: 'Plant', cat: 'life', state: SOLID,
      color: ['#3d8a3a', '#357d33', '#449440'], density: 10000, conduct: 0.15, hardness: 0.15,
      flammable: 0.25, ignite: 260, burn: [30, 80, 550, 'ash', 0.2], debris: 'sawdust',
      desc: 'Slowly grows into water it touches.' },
    { key: 'flower', name: 'Flower', cat: null, state: SOLID,
      color: ['#e86aa8'], density: 10000, conduct: 0.1, hardness: 0.05,
      flammable: 0.4, ignite: 220, burn: [10, 30, 450, 'ash', 0.2],
      desc: 'Petals at the top of a grown plant.' },
    { key: 'virus', name: 'Virus', cat: 'life', state: SOLID,
      color: ['#a13ec4', '#8f34b0', '#b44ad6'], density: 10000, conduct: 0.15, hardness: 0.1,
      flammable: 0.5, ignite: 200, burn: [5, 15, 400, 'smoke', 0.5], brush: 0.3,
      desc: 'Infects whatever it touches. Only fire and heat stop it.' },

    // --------------------------------------------------------------- Machines
    { key: 'clone', name: 'Clone', cat: 'machines', state: SOLID,
      color: ['#c9c23a', '#bdb630', '#d3cc46'], density: 10000, conduct: 0, indestructible: true, acidProof: true,
      desc: 'Copies the first material that touches it, forever.' },
    { key: 'void', name: 'Void', cat: 'machines', state: SOLID,
      color: ['#2b0f3a', '#260d33', '#311242'], density: 10000, conduct: 0, indestructible: true, acidProof: true,
      desc: 'Deletes anything that touches it.' },
    { key: 'heater', name: 'Heater', cat: 'machines', state: SOLID,
      color: ['#b8412d', '#a83a28', '#c24a33'], density: 10000, conduct: 0.9, temp: 900, hardness: 0.9, acidProof: true,
      desc: 'Holds itself at 900 °C.' },
    { key: 'cooler', name: 'Cooler', cat: 'machines', state: SOLID,
      color: ['#3a88c9', '#3480bf', '#4291d2'], density: 10000, conduct: 0.9, temp: -150, hardness: 0.9, acidProof: true,
      desc: 'Holds itself at −150 °C.' },
  ];

  const EL = [];
  const E = {};
  DEFS.forEach((d, id) => {
    const el = Object.assign(
      {
        id, cat: null, density: 1, conduct: 0.1, temp: 20, relax: 0, slide: 0, disp: 0, visc: 0, rise: 0.7,
        life: null, melt: null, freeze: null, flammable: 0, ignite: Infinity, burn: null, explosive: null,
        impact: false, conductor: false, hardness: 0, indestructible: false, acidProof: false,
        extinguish: false, glow: false, debris: null, brush: null, desc: '',
      },
      d
    );
    if (el.brush === null) el.brush = el.state === POWDER ? 0.4 : 1;
    EL.push(el);
    E[d.key.toUpperCase()] = id;
  });
  if (EL.length > 255) throw new Error('Too many elements for a Uint8 grid');

  // Resolve string references (melt/freeze/burn residue/debris) into ids.
  const ref = (k) => (k == null ? 0 : E[k.toUpperCase()]);
  for (const el of EL) {
    for (const k of [el.melt && el.melt[1], el.melt && el.melt[2], el.freeze && el.freeze[1], el.burn && el.burn[3], el.debris]) {
      if (k != null && ref(k) === undefined) throw new Error(`Unknown element "${k}" in ${el.key}`);
    }
  }

  G.STATE = STATE;
  G.CATEGORIES = CATEGORIES;
  G.EL = EL;
  G.E = E;
  G.ref = ref;
})();
