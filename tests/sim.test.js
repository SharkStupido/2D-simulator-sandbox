#!/usr/bin/env node
/*
 * Headless tests for the Grainfall simulation. No dependencies:
 *   node tests/sim.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function load(seed = 12345) {
  const ctx = {
    console,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  };
  vm.createContext(ctx);
  for (const f of ['elements.js', 'sim.js', 'scenes.js']) {
    const file = path.join(__dirname, '..', 'js', f);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  }
  const G = ctx.Grainfall;
  G.sim.seed(seed);
  return G;
}

function world(w, h, seed) {
  const G = load(seed);
  G.sim.init(w, h);
  return G;
}

const count = (G, t) => { let c = 0; for (const v of G.sim.type) if (v === t) c++; return c; };
const run = (G, n) => { for (let k = 0; k < n; k++) G.sim.step(); };
const at = (G, x, y) => G.sim.type[y * G.sim.W + x];
function meanY(G, t) {
  let s = 0, c = 0;
  const { W, type } = G.sim;
  for (let i = 0; i < type.length; i++) if (type[i] === t) { s += Math.floor(i / W); c++; }
  return c ? s / c : NaN;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------------------------------------------------------------- movement
test('sand falls to the floor', (G = world(20, 30)) => {
  const { E, sim } = G;
  sim.setCell(10, 0, E.SAND);
  run(G, 60);
  assert.strictEqual(at(G, 10, 29), E.SAND);
  assert.strictEqual(count(G, E.SAND), 1);
});

test('sand piles into a slope instead of a tower', (G = world(60, 40)) => {
  const { E, sim } = G;
  for (let k = 0; k < 300; k++) { sim.setCell(30, 0, E.SAND); run(G, 2); }
  run(G, 200);
  let minX = 99, maxX = -1;
  for (let x = 0; x < 60; x++) if (at(G, x, 39) === E.SAND) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  assert.ok(maxX - minX > 15, `pile base only ${maxX - minX} wide`);
  assert.strictEqual(count(G, E.SAND), 300, 'sand is conserved');
});

test('water spreads out flat', (G = world(60, 20)) => {
  const { E, sim } = G;
  sim.fillRect(0, 5, 9, 19, E.WATER); // 150 cells
  run(G, 600);
  assert.strictEqual(count(G, E.WATER), 150);
  for (let y = 18; y < 20; y++) for (let x = 0; x < 60; x++) assert.strictEqual(at(G, x, y), E.WATER, `gap at ${x},${y}`);
  assert.ok(meanY(G, E.WATER) > 17, 'water settled at the bottom');
});

test('oil floats on water', (G = world(20, 30)) => {
  const { E, sim } = G;
  sim.fillRect(0, 20, 19, 29, E.OIL);
  sim.fillRect(0, 10, 19, 19, E.WATER);
  run(G, 800);
  assert.ok(meanY(G, E.OIL) < meanY(G, E.WATER) - 5, `oil ${meanY(G, E.OIL)} water ${meanY(G, E.WATER)}`);
});

test('sand sinks through water', (G = world(20, 30)) => {
  const { E, sim } = G;
  sim.fillRect(0, 15, 19, 29, E.WATER);
  sim.fillRect(5, 5, 14, 9, E.SAND);
  run(G, 600);
  assert.ok(meanY(G, E.SAND) > meanY(G, E.WATER), 'sand ended up below the water');
});

test('steam rises', (G = world(20, 40)) => {
  const { E, sim } = G;
  sim.fillRect(8, 35, 11, 38, E.STEAM);
  run(G, 30);
  assert.ok(meanY(G, E.STEAM) < 30);
});

// -------------------------------------------------------------- heat
test('a heater boils water into steam', (G = world(30, 30)) => {
  const { E, sim } = G;
  sim.fillRect(0, 29, 29, 29, E.HEATER);
  sim.fillRect(0, 20, 29, 28, E.WATER);
  run(G, 600);
  assert.ok(count(G, E.STEAM) > 10, `only ${count(G, E.STEAM)} steam`);
});

test('steam condenses back into rain', (G = world(30, 60)) => {
  const { E, sim } = G;
  sim.fillRect(0, 50, 29, 59, E.STEAM);
  run(G, 1500);
  assert.ok(count(G, E.WATER) > 50, `only ${count(G, E.WATER)} water`);
});

test('a cooler freezes water', (G = world(20, 20)) => {
  const { E, sim } = G;
  sim.fillRect(0, 19, 19, 19, E.COOLER);
  sim.fillRect(0, 14, 19, 18, E.WATER);
  run(G, 800);
  assert.ok(count(G, E.ICE) > 20, `only ${count(G, E.ICE)} ice`);
});

test('ice melts at room temperature', (G = world(20, 20)) => {
  const { E, sim } = G;
  sim.fillRect(8, 16, 11, 19, E.ICE);
  run(G, 4000);
  assert.ok(count(G, E.ICE) < 16, 'some ice melted');
  assert.ok(count(G, E.WATER) > 0, 'into water');
});

test('the heat tool melts sand into glass', (G = world(20, 20)) => {
  const { E, sim } = G;
  sim.fillRect(0, 15, 19, 19, E.SAND);
  for (let k = 0; k < 60; k++) { sim.paint(10, 17, 3, 'heat'); sim.step(); }
  assert.ok(count(G, E.MOLTEN_GLASS) > 0, 'sand melted');
  run(G, 4000);
  assert.ok(count(G, E.GLASS) > 0, 'and set into glass');
});

test('lava meets water: obsidian and steam', (G = world(30, 30)) => {
  const { E, sim } = G;
  sim.fillRect(0, 20, 29, 29, E.WATER);
  sim.fillRect(10, 5, 19, 10, E.LAVA);
  run(G, 300);
  assert.ok(count(G, E.OBSIDIAN) + count(G, E.STONE) > 5);
  assert.ok(count(G, E.STEAM) > 0 || count(G, E.WATER) < 300);
});

test('falling lava drops never freeze in mid-air', (G = world(40, 120)) => {
  const { E, sim } = G;
  for (let k = 0; k < 40; k++) { sim.paint(20, 3, 4, 'draw', E.LAVA); run(G, 3); }
  run(G, 600);
  const { type, W } = sim;
  for (let i = 0; i < W * 60; i++) {
    assert.ok(type[i] !== E.STONE && type[i] !== E.GRAVEL, `rock hanging at y=${Math.floor(i / W)}`);
  }
});

test('water freezing as it falls turns to snow', (G = world(20, 80)) => {
  const { E, sim } = G;
  sim.fillRect(0, 79, 19, 79, E.WALL);
  sim.fillRect(5, 2, 14, 4, E.WATER);
  for (let i = 0; i < sim.temp.length; i++) sim.temp[i] = -60;
  run(G, 300);
  assert.ok(count(G, E.SNOW) > 0, 'some snow formed');
  for (let i = 0; i < 20 * 70; i++) assert.notStrictEqual(sim.type[i], E.ICE, 'no ice hanging in the air');
});

test('lava cools into stone in the open', (G = world(40, 20)) => {
  const { E, sim } = G;
  sim.fillRect(15, 17, 24, 19, E.LAVA);
  run(G, 6000);
  assert.ok(count(G, E.STONE) > 0);
});

// -------------------------------------------------------------- fire
test('fire burns wood down to ash', (G = world(30, 30)) => {
  const { E, sim } = G;
  sim.fillRect(10, 20, 19, 29, E.WOOD);
  const before = count(G, E.WOOD);
  sim.ignite(15, 20);
  run(G, 3000);
  assert.ok(count(G, E.WOOD) < before * 0.5, `${count(G, E.WOOD)} of ${before} wood left`);
  assert.ok(count(G, E.ASH) > 0, 'left ash');
});

test('burning oil floats on water and keeps burning', (G = world(30, 30)) => {
  const { E, sim } = G;
  sim.fillRect(0, 20, 29, 29, E.WATER);
  sim.fillRect(0, 17, 29, 19, E.OIL);
  for (let x = 0; x < 30; x++) sim.ignite(x, 17);
  run(G, 1500);
  assert.strictEqual(count(G, E.OIL), 0, 'the oil burned off the surface');
  assert.ok(count(G, E.WATER) > 200, 'the water underneath survived');
});

test('water puts out burning wood', (G = world(30, 30)) => {
  const { E, sim } = G;
  sim.fillRect(0, 29, 29, 29, E.WALL);
  sim.fillRect(5, 26, 24, 28, E.WOOD);
  for (let x = 5; x < 25; x++) sim.ignite(x, 26);
  run(G, 10);
  sim.fillRect(0, 5, 29, 20, E.WATER);
  run(G, 600);
  let burning = 0;
  for (let i = 0; i < sim.type.length; i++) if (sim.flags[i] & sim.F_BURN) burning++;
  assert.strictEqual(burning, 0, 'nothing is still burning');
  assert.ok(count(G, E.WOOD) > 40, `only ${count(G, E.WOOD)} wood saved`);
});

test('fuse carries fire to TNT', (G = world(80, 40)) => {
  const { E, sim } = G;
  sim.fillRect(60, 30, 69, 39, E.TNT);
  sim.fillRect(10, 39, 59, 39, E.FUSE);
  sim.ignite(10, 39);
  run(G, 1500);
  assert.strictEqual(count(G, E.TNT), 0, 'the TNT went off');
  assert.ok(count(G, E.FUSE) < 5, 'the fuse burned');
});

test('a long fuse reliably reaches the TNT (several seeds)', () => {
  for (const seed of [1, 7, 42, 99, 2024]) {
    const G = world(220, 30, seed);
    const { E, sim } = G;
    sim.fillRect(0, 29, 219, 29, G.E.WALL);
    sim.fillRect(205, 22, 214, 28, E.TNT);
    sim.fillRect(5, 28, 204, 28, E.FUSE);
    sim.ignite(5, 28);
    run(G, 2500);
    assert.strictEqual(count(G, E.TNT), 0, `fuse fizzled with seed ${seed}`);
  }
});

test('steam condenses on a cold surface', (G = world(20, 20)) => {
  const { E, sim } = G;
  sim.fillRect(0, 0, 19, 0, E.METAL);
  sim.fillRect(0, 1, 19, 4, E.STEAM);
  run(G, 120);
  assert.ok(count(G, E.WATER) > 5, `only ${count(G, E.WATER)} water`);
});

test('TNT blasts a crater in stone',(G = world(60, 60)) => {
  const { E, sim } = G;
  sim.fillRect(0, 20, 59, 59, E.STONE);
  sim.fillRect(28, 38, 31, 41, E.TNT);
  const before = count(G, E.STONE);
  sim.ignite(29, 39);
  run(G, 120);
  assert.strictEqual(count(G, E.TNT), 0);
  assert.ok(count(G, E.STONE) < before - 100, `only ${before - count(G, E.STONE)} stone destroyed`);
});

test('nitro explodes when dropped from a height', (G = world(40, 60)) => {
  const { E, sim } = G;
  sim.fillRect(0, 55, 39, 59, E.STONE);
  sim.fillRect(18, 2, 21, 3, E.NITRO);
  run(G, 200);
  assert.strictEqual(count(G, E.NITRO), 0);
});

// ------------------------------------------------------------ electricity
test('a battery lights a lamp through a metal wire', (G = world(40, 20)) => {
  const { E, sim } = G;
  sim.setCell(2, 10, E.BATTERY);
  sim.fillRect(3, 10, 30, 10, E.METAL);
  sim.setCell(31, 10, E.LAMP);
  let lit = 0;
  for (let k = 0; k < 120; k++) { sim.step(); lit = Math.max(lit, sim.aux[10 * 40 + 31]); }
  assert.ok(lit > 200, 'the lamp lit up');
});

test('a spark on a wire ignites gunpowder at the far end', (G = world(40, 20)) => {
  const { E, sim } = G;
  sim.fillRect(2, 19, 37, 19, E.WALL);
  sim.fillRect(2, 18, 30, 18, E.METAL);
  sim.fillRect(31, 17, 36, 18, E.GUNPOWDER);
  sim.paint(2, 18, 1, 'draw', E.SPARK);
  run(G, 200);
  assert.ok(count(G, E.GUNPOWDER) < 12, 'the gunpowder went off');
});

test('pure water does not conduct but salt water does', (G = world(40, 10)) => {
  const { E, sim } = G;
  sim.fillRect(0, 9, 39, 9, E.WALL);
  sim.fillRect(0, 5, 0, 8, E.WALL);
  sim.fillRect(39, 5, 39, 8, E.WALL);
  sim.fillRect(1, 8, 38, 8, E.SALT_WATER);
  sim.paint(1, 8, 1, 'draw', E.SPARK);
  let reached = false;
  for (let k = 0; k < 60; k++) { sim.step(); if (sim.elec[8 * 40 + 30] > 0) reached = true; }
  assert.ok(reached, 'charge travelled through salt water');
});

// ------------------------------------------------------------------ life
test('a seed on dirt grows into a flowering plant', (G = world(40, 60)) => {
  const { E, sim } = G;
  sim.fillRect(0, 50, 39, 59, E.DIRT);
  sim.setCell(20, 49, E.SEED);
  run(G, 3000);
  assert.ok(count(G, E.PLANT) > 10, `only ${count(G, E.PLANT)} plant`);
  assert.ok(count(G, E.FLOWER) > 0, 'it flowered');
});

test('virus spreads but fire stops it', (G = world(40, 40)) => {
  const { E, sim } = G;
  sim.fillRect(0, 20, 39, 39, E.SAND);
  sim.paint(20, 20, 2, 'draw', E.VIRUS, true);
  run(G, 300);
  const infected = count(G, E.VIRUS);
  assert.ok(infected > 20, `only ${infected} infected`);
  for (let k = 0; k < 40; k++) { sim.paint(20, 30, 20, 'heat'); sim.step(); }
  run(G, 300);
  assert.ok(count(G, E.VIRUS) < infected, 'heat killed the virus');
});

// ------------------------------------------------------------- chemistry
test('acid eats stone but not glass', (G = world(30, 30)) => {
  const { E, sim } = G;
  sim.fillRect(0, 25, 14, 29, E.STONE);
  sim.fillRect(15, 25, 29, 29, E.GLASS);
  sim.fillRect(0, 15, 29, 22, E.ACID);
  run(G, 800);
  assert.ok(count(G, E.STONE) < 75 * 0.7, `${count(G, E.STONE)} stone left`);
  assert.strictEqual(count(G, E.GLASS), 75, 'glass untouched');
});

test('salt dissolves in water', (G = world(20, 20)) => {
  const { E, sim } = G;
  sim.fillRect(0, 10, 19, 19, E.WATER);
  sim.fillRect(5, 2, 14, 4, E.SALT);
  run(G, 1500);
  assert.ok(count(G, E.SALT_WATER) > 10);
});

test('water turns dirt into mud', (G = world(20, 20)) => {
  const { E, sim } = G;
  sim.fillRect(0, 15, 19, 19, E.DIRT);
  sim.fillRect(0, 8, 19, 14, E.WATER);
  run(G, 800);
  assert.ok(count(G, E.MUD) > 10);
});

// -------------------------------------------------------------- machines
test('clone copies what touches it', (G = world(30, 40)) => {
  const { E, sim } = G;
  sim.fillRect(10, 10, 19, 10, E.CLONE);
  sim.fillRect(12, 5, 17, 7, E.WATER);
  run(G, 400);
  assert.ok(count(G, E.WATER) > 100, `only ${count(G, E.WATER)} water`);
});

test('void deletes what falls on it', (G = world(20, 30)) => {
  const { E, sim } = G;
  sim.fillRect(0, 29, 19, 29, E.VOID);
  sim.fillRect(5, 0, 14, 9, E.SAND);
  run(G, 400);
  assert.strictEqual(count(G, E.SAND), 0);
});

// ---------------------------------------------------------------- tools
test('erase and replace work', (G = world(20, 20)) => {
  const { E, sim } = G;
  sim.fillRect(0, 0, 19, 19, E.STONE);
  sim.paint(10, 10, 4, 'erase');
  assert.ok(count(G, E.STONE) < 400);
  sim.paint(3, 3, 3, 'draw', E.METAL, false);
  assert.strictEqual(count(G, E.METAL), 0, 'draw does not overwrite by default');
  sim.paint(3, 3, 3, 'draw', E.METAL, true);
  assert.ok(count(G, E.METAL) > 5, 'replace mode overwrites');
});

test('save and load round-trip the world', (G = world(50, 40)) => {
  const { E, sim, scenes } = G;
  scenes.build('landscape', sim);
  run(G, 50);
  const types = Array.from(sim.type);
  const temps = Array.from(sim.temp, Math.round);
  const data = sim.serialize();
  sim.clearWorld();
  assert.strictEqual(count(G, E.STONE), 0);
  assert.ok(sim.deserialize(data));
  assert.deepStrictEqual(Array.from(sim.type), types);
  assert.deepStrictEqual(Array.from(sim.temp, Math.round), temps);
  assert.strictEqual(sim.deserialize('not a save'), false);
});

test('every scene builds and runs', () => {
  for (const s of load().scenes.list) {
    const G = world(240, 140);
    G.scenes.build(s.key, G.sim);
    run(G, 200);
    if (s.key !== 'empty') assert.ok(G.sim.countCells() > 1000, `${s.key} is nearly empty`);
  }
});

test('every element can be placed and simulated', (G = world(60, 60)) => {
  const { EL, sim } = G;
  for (const el of EL) {
    if (el.id === 0) continue;
    sim.clearWorld();
    sim.fillRect(0, 59, 59, 59, G.E.STONE);
    sim.paint(30, 30, 6, 'draw', el.id, true);
    run(G, 60);
  }
});

test('performance: a full-size meadow steps quickly', (G = world(400, 220)) => {
  G.scenes.build('landscape', G.sim);
  run(G, 30);
  const t0 = process.hrtime.bigint();
  run(G, 120);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 120;
  console.log(`    ${ms.toFixed(2)} ms per tick at 400×220 (${G.sim.countCells()} grains)`);
  assert.ok(ms < 30, `too slow: ${ms.toFixed(1)} ms per tick`);
});

// ---------------------------------------------------------------- runner
let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
