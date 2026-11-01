/*
 * Grainfall: starter scenes. Each builder fills the current world using
 * proportional coordinates so it works at any world size.
 */
(function () {
  'use strict';
  const G = (globalThis.Grainfall = globalThis.Grainfall || {});
  const { E } = G;

  function tree(sim, x, groundY, height) {
    for (let k = 1; k <= height; k++) sim.setCell(x, groundY - k, E.WOOD);
    const cy = groundY - height - 2;
    const r = Math.max(3, Math.round(height * 0.5));
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy * 1.6 > r * r || sim.random() < 0.15) continue;
        const i = sim.setCell(x + dx, cy + dy, E.PLANT);
        if (i >= 0) sim.aux[i] = 3;
      }
    }
  }

  function landscape(sim) {
    sim.clearWorld();
    const { W, H } = sim;
    const rnd = sim.random;
    const p1 = rnd() * 6.28, p2 = rnd() * 6.28;
    const base = H * 0.66;
    const lakeL = W * 0.5, lakeR = W * 0.84;
    const lakeC = (lakeL + lakeR) / 2, lakeHalf = (lakeR - lakeL) / 2;
    const ground = new Int16Array(W);
    for (let x = 0; x < W; x++) {
      let g = base + Math.sin(x * (90 / W) * 0.25 + p1) * H * 0.07 + Math.sin(x * (90 / W) * 0.8 + p2) * H * 0.02;
      const d = (x - lakeC) / lakeHalf;
      if (Math.abs(d) < 1) g += (1 - d * d) * H * 0.17;
      ground[x] = Math.round(g);
    }
    const waterLine = Math.max(ground[Math.floor(lakeL)], ground[Math.ceil(lakeR)]) + 2;

    for (let x = 0; x < W; x++) {
      const gy = ground[x];
      const nearLake = x > lakeL - W * 0.04 && x < lakeR + W * 0.04;
      const soil = 12 + Math.round(4 * Math.sin(x * 0.11 + p2));
      for (let y = gy; y < H; y++) {
        const depth = y - gy;
        let t;
        if (depth < soil) t = nearLake && depth < 7 ? E.SAND : E.DIRT;
        else t = E.STONE;
        sim.setCell(x, y, t);
      }
      if (x > lakeL - 2 && x < lakeR + 2) {
        for (let y = waterLine; y < gy; y++) sim.setCell(x, y, E.WATER);
      }
    }

    // Pockets of coal and gravel in the bedrock.
    for (let k = 0; k < 6; k++) {
      const cx = Math.floor(rnd() * W), cy = Math.floor(H * 0.86 + rnd() * H * 0.12);
      const r = 2 + Math.floor(rnd() * 3), t = k % 2 ? E.COAL : E.GRAVEL;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r && sim.type[(cy + dy) * W + cx + dx] === E.STONE) sim.setCell(cx + dx, cy + dy, t);
      }
    }

    // Seeds on the dry land sprout into flowering plants within a few seconds.
    const seeds = Math.max(4, Math.round(W / 28));
    for (let k = 0; k < seeds; k++) {
      let x = Math.floor(W * 0.05 + rnd() * W * 0.42);
      if (k % 3 === 2) x = Math.floor(lakeR + W * 0.05 + rnd() * W * 0.1);
      if (x >= W) continue;
      const gy = ground[x];
      if (sim.type[gy * W + x] === E.DIRT) sim.setCell(x, gy - 1, E.SEED);
    }
    // One grown tree on the left hill.
    const tx = Math.floor(W * 0.18);
    tree(sim, tx, ground[tx], Math.max(6, Math.round(H * 0.07)));
  }

  function volcano(sim) {
    sim.clearWorld();
    const { W, H } = sim;
    const rnd = sim.random;
    const cx = Math.round(W * 0.38);
    const baseY = Math.round(H * 0.84);
    const peakY = Math.round(H * 0.3);
    const halfW = W * 0.3;
    const seaX = Math.round(W * 0.7);
    const ground = new Int16Array(W);
    for (let x = 0; x < W; x++) {
      const d = Math.abs(x - cx) / halfW;
      let g = baseY;
      if (d < 1) g = baseY - Math.pow(1 - d, 1.15) * (baseY - peakY);
      if (Math.abs(x - cx) < W * 0.02) g += 2; // shallow crater
      if (x > seaX) g = baseY + Math.min(H * 0.1, (x - seaX) * 0.35);
      ground[x] = Math.round(g + Math.sin(x * 0.3) * 1.2);
    }
    for (let x = 0; x < W; x++) {
      const gy = ground[x];
      for (let y = gy; y < H; y++) {
        const depth = y - gy;
        let t = E.STONE;
        if (x > seaX - W * 0.05 && depth < 6) t = E.SAND;
        else if (depth < 3 && Math.abs(x - cx) > W * 0.06) t = E.DIRT;
        else if (rnd() < 0.04) t = E.OBSIDIAN;
        sim.setCell(x, y, t);
      }
      if (x > seaX - 2) for (let y = baseY - 2; y < gy; y++) sim.setCell(x, y, E.WATER);
    }
    // Magma chamber kept molten by heaters, and a crater that keeps erupting.
    const chY = Math.round(H * 0.7), rx = Math.round(W * 0.07), ry = Math.round(H * 0.07);
    for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) {
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) sim.setCell(cx + dx, chY + dy, E.LAVA);
    }
    for (let dx = -rx + 2; dx <= rx - 2; dx++) sim.setCell(cx + dx, chY + ry + 1, E.HEATER);
    const craterY = ground[cx];
    for (let dx = -2; dx <= 2; dx++) {
      const i = sim.setCell(cx + dx, craterY, E.CLONE);
      if (i >= 0) sim.aux[i] = E.LAVA;
    }
    // A flow already on its way down the eastern slope toward the trees.
    for (let x = cx + 3; x < cx + Math.round(W * 0.12); x++) {
      for (let k = 1; k <= 3; k++) sim.setCell(x, ground[x] - k, E.LAVA);
    }
    // Forest on the slopes, in the path of the lava.
    for (const f of [0.14, 0.22, 0.55, 0.62]) {
      const x = Math.round(W * f);
      tree(sim, x, ground[x], Math.max(5, Math.round(H * 0.05)));
    }
  }

  function workshop(sim) {
    sim.clearWorld();
    const { W, H } = sim;
    const X = (f) => Math.round(f * W);
    const fy = H - 4; // top of the floor
    sim.fillRect(0, fy, W - 1, H - 1, E.WALL);

    // Circuit: battery feeding a wire with lamps hanging from it.
    const bx = X(0.05), wireY = fy - Math.round(H * 0.42);
    sim.fillRect(bx - 2, fy - 4, bx + 2, fy - 1, E.BATTERY);
    sim.fillRect(bx, wireY, bx, fy - 5, E.METAL);
    sim.fillRect(bx, wireY, X(0.3), wireY, E.METAL);
    for (let x = bx + 5; x <= X(0.3) - 2; x += 6) {
      sim.fillRect(x, wireY + 1, x, wireY + 3, E.METAL);
      sim.fillRect(x - 1, wireY + 4, x + 1, wireY + 5, E.LAMP);
    }

    // Rain in a jar: a sealed glass tank with a heater under the middle.
    // Water boils, the steam cools under the lid and drips back down.
    const l = X(0.36), r = X(0.54), top = fy - Math.round(H * 0.5);
    const third = Math.round((r - l) / 3);
    sim.fillRect(l - 1, fy - 1, r + 1, fy - 1, E.GLASS);
    sim.fillRect(l + third, fy - 1, r - third, fy - 1, E.HEATER);
    sim.fillRect(l - 1, top, l - 1, fy - 1, E.GLASS);
    sim.fillRect(r + 1, top, r + 1, fy - 1, E.GLASS);
    sim.fillRect(l - 1, top, r + 1, top, E.GLASS);
    sim.fillRect(l, fy - Math.round(H * 0.14), r, fy - 2, E.WATER);

    // Acid in a glass beaker, slowly eating a metal bar.
    const al = X(0.58), ar = X(0.64), abot = fy - 1;
    sim.fillRect(al - 1, abot, ar + 1, abot, E.GLASS);
    sim.fillRect(al - 1, abot - 9, al - 1, abot - 1, E.GLASS);
    sim.fillRect(ar + 1, abot - 9, ar + 1, abot - 1, E.GLASS);
    sim.fillRect(al, abot - 5, ar, abot - 1, E.ACID);
    const mid = Math.round((al + ar) / 2);
    sim.fillRect(mid - 1, abot - 16, mid + 1, abot - 6, E.METAL);

    // A dam on a raised plinth holding back a reservoir, with TNT at its foot
    // and a long fuse. Light the sawdust on top of the fuse post with fire.
    const pl = X(0.69), py = fy - 6;
    sim.fillRect(pl, py, W - 1, fy - 1, E.WALL);
    const dl = X(0.8), dr = dl + Math.max(4, X(0.025));
    const damTop = py - Math.round(H * 0.4);
    sim.fillRect(dl, damTop, dr, py - 1, E.STONE);
    sim.fillRect(dr + 1, damTop + 4, W - 1, py - 1, E.WATER);
    sim.fillRect(dl - 3, py - 7, dl + 1, py - 1, E.TNT);
    const fx = pl + 2;
    sim.fillRect(fx, py - 1, dl - 4, py - 1, E.FUSE);
    sim.fillRect(fx, py - 9, fx, py - 1, E.FUSE);
    sim.fillRect(fx - 1, py - 10, fx + 1, py - 10, E.SAWDUST);
  }

  G.scenes = {
    list: [
      { key: 'landscape', name: 'Meadow' },
      { key: 'volcano', name: 'Volcano' },
      { key: 'workshop', name: 'Workshop' },
      { key: 'empty', name: 'Empty' },
    ],
    build(key, sim) {
      if (key === 'volcano') volcano(sim);
      else if (key === 'workshop') workshop(sim);
      else if (key === 'empty') sim.clearWorld();
      else landscape(sim);
    },
  };
})();
