/*
 * Grainfall: the cellular simulation.
 *
 * The world is a W×H grid stored as parallel typed arrays (structure of
 * arrays). Each tick:
 *   1. every cell is updated once, bottom row first, alternating the
 *      horizontal scan direction so nothing drifts to one side;
 *   2. electricity spreads one cell through conductors;
 *   3. heat diffuses between neighbours;
 *   4. queued explosions go off;
 *   5. flying debris particles move and land.
 *
 * This file has no DOM dependencies so it can be tested in Node.
 */
(function () {
  'use strict';
  const G = (globalThis.Grainfall = globalThis.Grainfall || {});
  const { EL, E, STATE, ref } = G;
  const { SOLID, POWDER, LIQUID, GAS } = STATE;
  const N = EL.length;

  const AMBIENT = 20;
  const TMIN = -273;
  const TMAX = 6000;
  const F_BURN = 1;
  const SPARK_LIFE = 4;
  const REFRACT = -5;
  const PENDING = 100;
  const MAXV = 12;
  const MAX_PARTICLES = 3000;
  const MAX_BLASTS_PER_TICK = 500;
  const BATTERY_PERIOD = 10;

  const {
    EMPTY, SAND, DIRT, MUD, WATER, SALT_WATER, STEAM, SMOKE, FIRE, EMBER, SPARK, PLANT, FLOWER,
    SEED, VIRUS, ACID, CLONE, VOID, WALL, HEATER, COOLER, BATTERY, LAMP, WOOD, COAL, FUSE,
  } = E;

  // ------------------------------------------------------------ lookup tables
  const ST = new Uint8Array(N);
  const DENS = new Float32Array(N);
  const COND = new Float32Array(N);
  const RELAX = new Float32Array(N);
  const TEMP0 = new Float32Array(N);
  const SLIDE = new Float32Array(N);
  const DISP = new Uint8Array(N);
  const VISC = new Float32Array(N);
  const RISE = new Float32Array(N);
  const LIFE_MIN = new Int16Array(N);
  const LIFE_SPAN = new Int16Array(N);
  const MELT_T = new Float32Array(N).fill(Infinity);
  const MELT_TO = new Uint8Array(N);
  const MELT_ALT = new Uint8Array(N);
  const MELT_ALT_P = new Float32Array(N);
  const FREEZE_T = new Float32Array(N).fill(-Infinity);
  const FREEZE_TO = new Uint8Array(N);
  const FLAM = new Float32Array(N);
  const IGNITE_T = new Float32Array(N).fill(Infinity);
  const BURN_MIN = new Int16Array(N);
  const BURN_SPAN = new Int16Array(N);
  const BURN_T = new Float32Array(N);
  const BURN_INTO = new Uint8Array(N);
  const BURN_RES = new Float32Array(N);
  const EXPLOSIVE = new Uint8Array(N);
  const EXPL_R = new Uint8Array(N);
  const EXPL_P = new Float32Array(N);
  const IMPACT = new Uint8Array(N);
  const CONDUCTOR = new Uint8Array(N);
  const HARD = new Float32Array(N);
  const INDESTRUCT = new Uint8Array(N);
  const ACIDPROOF = new Uint8Array(N);
  const EXTING = new Uint8Array(N);
  const DEBRIS = new Uint8Array(N);
  const BRUSH = new Float32Array(N);
  const VIRUS_IMMUNE = new Uint8Array(N);

  for (const el of EL) {
    const t = el.id;
    ST[t] = el.state;
    DENS[t] = el.density;
    COND[t] = el.conduct;
    RELAX[t] = el.relax;
    TEMP0[t] = el.temp;
    SLIDE[t] = el.slide;
    DISP[t] = el.disp;
    VISC[t] = el.visc;
    RISE[t] = el.rise;
    if (el.life) { LIFE_MIN[t] = el.life[0]; LIFE_SPAN[t] = el.life[1] - el.life[0]; }
    if (el.melt) {
      MELT_T[t] = el.melt[0];
      MELT_TO[t] = ref(el.melt[1]);
      if (el.melt[2]) { MELT_ALT[t] = ref(el.melt[2]); MELT_ALT_P[t] = el.melt[3]; }
    }
    if (el.freeze) { FREEZE_T[t] = el.freeze[0]; FREEZE_TO[t] = ref(el.freeze[1]); }
    FLAM[t] = el.flammable;
    if (el.flammable > 0) IGNITE_T[t] = el.ignite;
    if (el.burn) {
      BURN_MIN[t] = el.burn[0];
      BURN_SPAN[t] = el.burn[1] - el.burn[0];
      BURN_T[t] = el.burn[2];
      BURN_INTO[t] = ref(el.burn[3]);
      BURN_RES[t] = el.burn[4];
    }
    if (el.explosive) { EXPLOSIVE[t] = 1; EXPL_R[t] = el.explosive[0]; EXPL_P[t] = el.explosive[1]; }
    IMPACT[t] = el.impact ? 1 : 0;
    CONDUCTOR[t] = el.conductor ? 1 : 0;
    HARD[t] = el.hardness;
    INDESTRUCT[t] = el.indestructible ? 1 : 0;
    ACIDPROOF[t] = el.acidProof ? 1 : 0;
    EXTING[t] = el.extinguish ? 1 : 0;
    DEBRIS[t] = ref(el.debris);
    BRUSH[t] = el.brush;
    VIRUS_IMMUNE[t] = t === EMPTY || t === VIRUS || t === EMBER || el.state === GAS || el.indestructible ? 1 : 0;
  }

  // Pairwise heat-transfer coefficient: harmonic mean of the conductivities
  // (like two resistors in series). Zero if either side insulates.
  const HEATK = new Float32Array(N * N);
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      const ca = COND[a], cb = COND[b];
      HEATK[a * N + b] = ca > 0 && cb > 0 ? ((2 * ca * cb) / (ca + cb)) * 0.24 : 0;
    }
  }

  // ---------------------------------------------------------------- reactions
  // [self, neighbour, chance per tick, self becomes, neighbour becomes]
  // null = unchanged, 'empty' = removed.
  const REACTIONS = [
    ['water', 'lava', 0.3, 'steam', 'obsidian'],
    ['salt_water', 'lava', 0.3, 'steam', 'obsidian'],
    ['snow', 'lava', 0.3, 'water', 'obsidian'],
    ['water', 'molten_metal', 0.3, 'steam', 'metal'],
    ['water', 'molten_glass', 0.3, 'steam', 'glass'],
    ['water', 'salt', 0.04, 'salt_water', 'empty'],
    ['ice', 'salt', 0.01, 'salt_water', null],
    ['snow', 'salt', 0.03, 'salt_water', null],
    ['water', 'dirt', 0.01, 'empty', 'mud'],
    ['metal', 'water', 0.0004, 'rust', null],
    ['metal', 'salt_water', 0.003, 'rust', null],
    ['plant', 'water', 0.006, null, 'plant'],
  ];
  const RX = new Int16Array(N * N).fill(-1);
  const RX_P = [];
  const RX_A = [];
  const RX_B = [];
  const RXHAS = new Uint8Array(N);
  function addReaction(a, b, p, toA, toB) {
    const idx = RX_P.length;
    RX_P.push(p);
    RX_A.push(toA);
    RX_B.push(toB);
    RX[a * N + b] = idx;
    RXHAS[a] = 1;
  }
  const rxId = (k) => (k === null ? -1 : k === 'empty' ? 0 : ref(k));
  for (const [a, b, p, ta, tb] of REACTIONS) {
    addReaction(ref(a), ref(b), p, rxId(ta), rxId(tb));
    addReaction(ref(b), ref(a), p, rxId(tb), rxId(ta));
  }

  // --------------------------------------------------------------- world state
  let W = 0, H = 0, SIZE = 0;
  let type, temp, life, aux, flags, shade, elec, vel, stamp, pendingBuf;
  let pendingCount = 0;
  let frame = 0;
  let stampVal = 1;
  let blastQ = [];

  // Flying debris (explosions), stored as parallel arrays.
  const PX = new Float32Array(MAX_PARTICLES);
  const PY = new Float32Array(MAX_PARTICLES);
  const PVX = new Float32Array(MAX_PARTICLES);
  const PVY = new Float32Array(MAX_PARTICLES);
  const PT = new Uint8Array(MAX_PARTICLES);
  const PTEMP = new Float32Array(MAX_PARTICLES);
  let pCount = 0;

  // xorshift32: fast and seedable (tests rely on determinism).
  let rng = 0x2545f491;
  function rand() {
    let s = rng;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    rng = s;
    return (s >>> 0) * 2.3283064365386963e-10;
  }
  const randInt = (n) => (rand() * n) | 0;

  function init(w, h) {
    W = w | 0;
    H = h | 0;
    SIZE = W * H;
    type = new Uint8Array(SIZE);
    temp = new Float32Array(SIZE).fill(AMBIENT);
    life = new Int16Array(SIZE);
    aux = new Uint8Array(SIZE);
    flags = new Uint8Array(SIZE);
    shade = new Uint8Array(SIZE);
    elec = new Int8Array(SIZE);
    vel = new Uint8Array(SIZE);
    stamp = new Uint8Array(SIZE);
    pendingBuf = new Int32Array(SIZE);
    for (let i = 0; i < SIZE; i++) shade[i] = randInt(256);
    blastQ = [];
    pCount = 0;
    frame = 0;
  }

  function clearWorld() {
    type.fill(0);
    temp.fill(AMBIENT);
    life.fill(0);
    aux.fill(0);
    flags.fill(0);
    elec.fill(0);
    vel.fill(0);
    blastQ = [];
    pCount = 0;
  }

  // ------------------------------------------------------------ cell helpers
  const NDX = [-1, 0, 1, -1, 1, -1, 0, 1];
  const NDY = [-1, -1, -1, 0, 0, 1, 1, 1];

  /** Index of a random 8-neighbour, or -1 if it falls outside the world. */
  function neighbor8(x, y) {
    const k = randInt(8);
    const nx = x + NDX[k], ny = y + NDY[k];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) return -1;
    return ny * W + nx;
  }

  /** Place a fresh cell of type t (uses the element's starting temperature). */
  function spawn(i, t) {
    type[i] = t;
    temp[i] = TEMP0[t];
    life[i] = LIFE_SPAN[t] || LIFE_MIN[t] ? LIFE_MIN[t] + randInt(LIFE_SPAN[t] + 1) : 0;
    aux[i] = 0;
    flags[i] = 0;
    elec[i] = 0;
    vel[i] = 0;
    shade[i] = randInt(256);
    stamp[i] = stampVal;
  }

  /** Turn cell i into type t, keeping its temperature (phase changes, reactions). */
  function morph(i, t) {
    type[i] = t;
    life[i] = LIFE_SPAN[t] || LIFE_MIN[t] ? LIFE_MIN[t] + randInt(LIFE_SPAN[t] + 1) : 0;
    aux[i] = 0;
    flags[i] = 0;
    vel[i] = 0;
    if (!CONDUCTOR[t]) elec[i] = 0;
    if ((t === FIRE || t === EMBER) && temp[i] < TEMP0[t]) temp[i] = TEMP0[t];
    stamp[i] = stampVal;
  }

  function clearCell(i) {
    type[i] = 0;
    life[i] = 0;
    aux[i] = 0;
    flags[i] = 0;
    elec[i] = 0;
    vel[i] = 0;
  }

  function swap(i, j) {
    let a = type[i]; type[i] = type[j]; type[j] = a;
    const f = temp[i]; temp[i] = temp[j]; temp[j] = f;
    a = life[i]; life[i] = life[j]; life[j] = a;
    a = aux[i]; aux[i] = aux[j]; aux[j] = a;
    a = flags[i]; flags[i] = flags[j]; flags[j] = a;
    a = shade[i]; shade[i] = shade[j]; shade[j] = a;
    a = elec[i]; elec[i] = elec[j]; elec[j] = a;
    a = vel[i]; vel[i] = vel[j]; vel[j] = a;
    stamp[i] = stampVal;
    stamp[j] = stampVal;
  }

  /** Can a falling cell of type t push into a cell holding u? */
  function canSink(t, u) {
    if (u === 0) return true;
    const s = ST[u];
    return (s === LIQUID || s === GAS) && DENS[t] > DENS[u];
  }

  /** Can a rising gas of type t push into a cell holding u? */
  function canRise(t, u) {
    if (u === 0) return true;
    const s = ST[u];
    if (s === GAS) return DENS[u] > DENS[t];
    if (s === LIQUID) return rand() < 0.3;
    return false;
  }

  /**
   * Is the cell resting on something that will not fall away? Solid ground
   * counts, as does a still fluid or powder that itself rests on something.
   */
  function supported(i, y) {
    if (y + 1 >= H) return true;
    const b = type[i + W];
    const sb = ST[b];
    if (sb === SOLID) return true;
    if (b === 0 || sb === GAS || vel[i + W] > 0) return false;
    if (y + 2 >= H) return true;
    const b2 = type[i + 2 * W];
    return b2 !== 0 && ST[b2] !== GAS && vel[i + 2 * W] === 0;
  }

  /** True if any 4-neighbour is open air or gas (fire needs oxygen). */
  function hasAir(i, x, y) {
    let u;
    if (x > 0) { u = type[i - 1]; if (u === 0 || ST[u] === GAS) return true; }
    if (x < W - 1) { u = type[i + 1]; if (u === 0 || ST[u] === GAS) return true; }
    if (y > 0) { u = type[i - W]; if (u === 0 || ST[u] === GAS) return true; }
    if (y < H - 1) { u = type[i + W]; if (u === 0 || ST[u] === GAS) return true; }
    return false;
  }

  function ignite(i) {
    const t = type[i];
    if (FLAM[t] <= 0 || (flags[i] & F_BURN) !== 0) return;
    flags[i] |= F_BURN;
    life[i] = BURN_MIN[t] + randInt(BURN_SPAN[t] + 1);
  }

  function infect(j) {
    const host = type[j];
    type[j] = VIRUS;
    aux[j] = host;
    flags[j] = 0;
    life[j] = 0;
    stamp[j] = stampVal;
  }

  // ------------------------------------------------------------- movement
  /**
   * Fall straight down with acceleration. Returns the new index, the same
   * index if the cell is drifting through a fluid, or -1 if blocked.
   */
  function fall(i, y, t) {
    if (y + 1 >= H) return -1;
    const below = type[i + W];
    if (!canSink(t, below)) return -1;
    if (below !== 0 && rand() < 0.5) return i; // drag through fluids
    let v = vel[i] + 1;
    if (v > MAXV) v = MAXV;
    let steps = 1 + (v >> 2);
    let cur = i, cy = y;
    do {
      const nxt = cur + W;
      const u = type[nxt];
      if (u !== 0) {
        if (!canSink(t, u)) break;
        swap(cur, nxt);
        cur = nxt;
        cy++;
        v = 1;
        break;
      }
      swap(cur, nxt);
      cur = nxt;
      cy++;
    } while (--steps > 0 && cy + 1 < H);
    vel[cur] = v;
    return cur;
  }

  function movePowder(i, x, y, t) {
    if (fall(i, y, t) >= 0) return;
    if (IMPACT[t] && vel[i] >= 8) { detonate(i, x, y, t); return; }
    vel[i] = 0;
    if (y + 1 >= H || rand() >= SLIDE[t]) return;
    const dir = rand() < 0.5 ? -1 : 1;
    let nx = x + dir;
    if (nx >= 0 && nx < W && canSink(t, type[i + W + dir])) { swap(i, i + W + dir); return; }
    nx = x - dir;
    if (nx >= 0 && nx < W && canSink(t, type[i + W - dir])) swap(i, i + W - dir);
  }

  function moveLiquid(i, x, y, t) {
    if (fall(i, y, t) >= 0) return;
    if (IMPACT[t] && vel[i] >= 8) { detonate(i, x, y, t); return; }
    vel[i] = 0;
    if (VISC[t] > 0 && rand() < VISC[t]) return; // thick liquids spread slowly
    const dir0 = rand() < 0.5 ? -1 : 1;
    if (y + 1 < H) {
      for (let a = 0, dir = dir0; a < 2; a++, dir = -dir) {
        const nx = x + dir;
        if (nx >= 0 && nx < W && canSink(t, type[i + W + dir])) { swap(i, i + W + dir); return; }
      }
    }
    // Flow sideways, stopping early above a drop so liquids pour off ledges.
    const d = DISP[t];
    for (let a = 0, dir = dir0; a < 2; a++, dir = -dir) {
      let best = -1;
      for (let k = 1; k <= d; k++) {
        const nx = x + dir * k;
        if (nx < 0 || nx >= W) break;
        const j = i + dir * k;
        const u = type[j];
        if (u !== 0 && ST[u] !== GAS) break;
        best = j;
        if (u !== 0) break;
        if (y + 1 < H && canSink(t, type[j + W])) break;
      }
      if (best >= 0) { swap(i, best); return; }
    }
  }

  function moveGas(i, x, y, t) {
    if (y > 0 && rand() < RISE[t]) {
      const r = rand();
      let dx = r < 0.5 ? 0 : r < 0.75 ? -1 : 1;
      if (x + dx < 0 || x + dx >= W) dx = 0;
      let j = i - W + dx;
      if (canRise(t, type[j])) { swap(i, j); return; }
      if (dx !== 0) {
        j = i - W;
        if (canRise(t, type[j])) { swap(i, j); return; }
      }
    }
    const dir = rand() < 0.5 ? -1 : 1;
    for (let a = 0, d = dir; a < 2; a++, d = -d) {
      const nx = x + d;
      if (nx >= 0 && nx < W && type[i + d] === 0) { swap(i, i + d); return; }
    }
  }

  // --------------------------------------------------------- fire & blasts
  /** Advance a burning cell. Returns true if it was consumed. */
  function burn(i, x, y, t) {
    if (EXPLOSIVE[t]) { detonate(i, x, y, t); return true; }
    const l = life[i] - 1;
    if (l <= 0) {
      const into = BURN_INTO[t];
      if (into !== 0 && rand() < BURN_RES[t]) morph(i, into);
      else if (rand() < 0.3) morph(i, SMOKE);
      else clearCell(i);
      return true;
    }
    // Smother cells sealed in by other material (fuses carry their own oxidiser).
    if (t !== FUSE && rand() < 0.1 && !hasAir(i, x, y)) {
      flags[i] &= ~F_BURN;
      if (temp[i] > IGNITE_T[t] - 60) temp[i] = IGNITE_T[t] - 60;
      return false;
    }
    life[i] = l;
    if (temp[i] < BURN_T[t]) temp[i] = BURN_T[t];
    if (t === FUSE) {
      // Fuses pass the flame along reliably, including into explosives.
      if (x > 0) fuseLight(i - 1);
      if (x < W - 1) fuseLight(i + 1);
      if (y > 0) fuseLight(i - W);
      if (y < H - 1) fuseLight(i + W);
    }
    // Throw flames (and the odd ember or puff of smoke) into open air above.
    if (rand() < 0.45 && y > 0) {
      const nx = x + randInt(3) - 1;
      if (nx >= 0 && nx < W) {
        const j = i - W + (nx - x);
        if (type[j] === 0) {
          const r = rand();
          if ((t === WOOD || t === COAL) && r < 0.01) spawn(j, EMBER);
          else if (r < 0.9) spawn(j, FIRE);
          else spawn(j, SMOKE);
        }
      }
    }
    const j = neighbor8(x, y);
    if (j >= 0) {
      const u = type[j];
      if (EXTING[u]) {
        if (rand() < 0.4) {
          flags[i] &= ~F_BURN;
          if (temp[i] > IGNITE_T[t] - 60) temp[i] = IGNITE_T[t] - 60;
          if ((u === WATER || u === SALT_WATER) && rand() < 0.3) morph(j, STEAM);
        }
      } else if (FLAM[u] > 0 && (flags[j] & F_BURN) === 0 && rand() < FLAM[u] * 0.5) {
        ignite(j);
      }
    }
    return false;
  }

  function fuseLight(j) {
    if (FLAM[type[j]] > 0 && (flags[j] & F_BURN) === 0 && rand() < 0.3) ignite(j);
  }

  function detonate(i, x, y, t) {
    spawn(i, FIRE);
    temp[i] = 1500;
    blastQ.push(x, y, EXPL_R[t], EXPL_P[t]);
  }

  function addParticle(x, y, vx, vy, t, tp) {
    if (pCount >= MAX_PARTICLES) return false;
    PX[pCount] = x;
    PY[pCount] = y;
    PVX[pCount] = vx;
    PVY[pCount] = vy;
    PT[pCount] = t;
    PTEMP[pCount] = tp;
    pCount++;
    return true;
  }

  function explode(cx, cy, r, p) {
    const r2 = r * r;
    const x0 = Math.max(0, cx - r), x1 = Math.min(W - 1, cx + r);
    const y0 = Math.max(0, cy - r), y1 = Math.min(H - 1, cy + r);
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const i = y * W + x;
        const d = Math.sqrt(d2);
        const f = 1 - d / (r + 1);
        const heat = 200 + 1000 * f;
        if (temp[i] < heat) temp[i] = heat;
        const t = type[i];
        if (t === 0) {
          if (rand() < f * 0.6) { spawn(i, FIRE); temp[i] = heat; }
          continue;
        }
        if (INDESTRUCT[t]) continue;
        if (EXPLOSIVE[t]) {
          if ((flags[i] & F_BURN) === 0) { flags[i] |= F_BURN; life[i] = 1; }
          continue;
        }
        if (FLAM[t] > 0 && rand() < 0.5) ignite(i);
        if (rand() >= f * p * (1 - HARD[t])) continue;
        const s = ST[t];
        if (f > 0.75 || s === GAS) {
          if (rand() < 0.5) { spawn(i, FIRE); temp[i] = heat; } else clearCell(i);
          continue;
        }
        const deb = DEBRIS[t] || (s === POWDER || s === LIQUID ? t : 0);
        if (deb !== 0 && rand() < 0.7) {
          const k = (f * p * 3.2 + rand() * 1.5) / (d || 1);
          addParticle(x + 0.5, y + 0.5, dx * k, dy * k - 1.8 * f * p, deb, temp[i]);
        }
        clearCell(i);
      }
    }
  }

  function processBlasts() {
    if (blastQ.length === 0) return;
    const q = blastQ;
    blastQ = [];
    const n = Math.min(q.length, MAX_BLASTS_PER_TICK * 4);
    for (let k = 0; k < n; k += 4) explode(q[k], q[k + 1], q[k + 2], q[k + 3]);
    for (let k = n; k < q.length; k++) blastQ.push(q[k]);
  }

  function landParticle(k) {
    let x = Math.floor(PX[k]), y = Math.floor(PY[k]);
    if (x < 0) x = 0; else if (x >= W) x = W - 1;
    if (y < 0) y = 0; else if (y >= H) y = H - 1;
    let i = y * W + x;
    for (let tries = 0; tries < 3 && type[i] !== 0; tries++) {
      if (i < W) return;
      i -= W;
    }
    if (type[i] !== 0) return;
    spawn(i, PT[k]);
    temp[i] = PTEMP[k];
  }

  function updateParticles() {
    for (let k = 0; k < pCount; k++) {
      PVY[k] += 0.22;
      PVX[k] *= 0.99;
      let x = PX[k], y = PY[k];
      const vx = PVX[k], vy = PVY[k];
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(vx), Math.abs(vy))));
      const sx = vx / steps, sy = vy / steps;
      let landed = false;
      for (let s = 0; s < steps; s++) {
        let nx = x + sx, ny = y + sy;
        if (nx < 0 || nx >= W) { PVX[k] = -PVX[k] * 0.4; nx = x; }
        if (ny < 0) { PVY[k] = 0; ny = 0; }
        if (ny >= H) { landed = true; break; }
        if (type[Math.floor(ny) * W + Math.floor(nx)] !== 0) { landed = true; break; }
        x = nx;
        y = ny;
      }
      PX[k] = x;
      PY[k] = y;
      if (landed) {
        landParticle(k);
        pCount--;
        PX[k] = PX[pCount]; PY[k] = PY[pCount]; PVX[k] = PVX[pCount]; PVY[k] = PVY[pCount];
        PT[k] = PT[pCount]; PTEMP[k] = PTEMP[pCount];
        k--;
      }
    }
  }

  // --------------------------------------------------- special behaviours
  // Each returns true when it fully handled the cell this tick (no movement).
  const BEHAVIOR = new Array(N).fill(null);

  BEHAVIOR[FIRE] = function (i, x, y) {
    const l = life[i] - 1;
    if (l <= 0 || temp[i] < 250) {
      if (rand() < 0.2) morph(i, SMOKE); else clearCell(i);
      return true;
    }
    life[i] = l;
    const want = 450 + l * 14;
    if (temp[i] < want) temp[i] = want;
    const j = neighbor8(x, y);
    if (j >= 0) {
      const u = type[j];
      if (u !== 0) {
        if (EXTING[u]) {
          clearCell(i);
          if ((u === WATER || u === SALT_WATER) && rand() < 0.2) morph(j, STEAM);
          return true;
        }
        if (FLAM[u] > 0 && (flags[j] & F_BURN) === 0 && rand() < FLAM[u]) ignite(j);
      }
    }
    if (y > 0 && rand() < RISE[FIRE]) {
      const r = rand();
      let dx = r < 0.5 ? 0 : r < 0.75 ? -1 : 1;
      if (x + dx < 0 || x + dx >= W) dx = 0;
      const k = i - W + dx;
      const u = type[k];
      if (u === 0 || (ST[u] === GAS && DENS[u] > DENS[FIRE])) swap(i, k);
    }
    return true;
  };

  BEHAVIOR[SMOKE] = function (i) {
    if (--life[i] <= 0) { clearCell(i); return true; }
    return false;
  };

  // Steam condenses on cold surfaces (and warms them a little as it does).
  BEHAVIOR[STEAM] = function (i, x, y) {
    const j = neighbor8(x, y);
    if (j < 0) return false;
    const u = type[j];
    if (u !== 0 && ST[u] === SOLID && COND[u] > 0 && temp[j] < 50 && rand() < 0.08) {
      morph(i, WATER);
      temp[i] = (temp[i] + temp[j]) * 0.5;
      if (temp[i] > 90) temp[i] = 90;
      temp[j] += 4;
      return true;
    }
    return false;
  };

  BEHAVIOR[EMBER] = function (i, x, y) {
    if (--life[i] <= 0) {
      if (rand() < 0.4) morph(i, E.ASH); else clearCell(i);
      return true;
    }
    if (temp[i] < 700) temp[i] = 700;
    const j = neighbor8(x, y);
    if (j >= 0) {
      const u = type[j];
      if (EXTING[u]) { morph(i, E.ASH); return true; }
      if (FLAM[u] > 0 && (flags[j] & F_BURN) === 0 && rand() < FLAM[u]) ignite(j);
    }
    return false;
  };

  BEHAVIOR[SPARK] = function (i) {
    if (--life[i] <= 0) { clearCell(i); return true; }
    if (elec[i] === 0) elec[i] = SPARK_LIFE;
    return true;
  };

  BEHAVIOR[HEATER] = function (i) { temp[i] = TEMP0[HEATER]; return true; };
  BEHAVIOR[COOLER] = function (i) { temp[i] = TEMP0[COOLER]; return true; };

  BEHAVIOR[BATTERY] = function (i) {
    if (elec[i] === 0 && frame % BATTERY_PERIOD === 0) elec[i] = SPARK_LIFE;
    return true;
  };

  BEHAVIOR[LAMP] = function (i) {
    if (elec[i] > 0) aux[i] = 255;
    else if (aux[i] > 0) aux[i] = (aux[i] * 0.93) | 0;
    return true;
  };

  BEHAVIOR[CLONE] = function (i, x, y) {
    const j = neighbor8(x, y);
    if (j < 0) return true;
    const u = type[j];
    if (aux[i] === 0) {
      if (u === CLONE) { if (aux[j] !== 0) aux[i] = aux[j]; }
      else if (u !== 0 && u !== VOID && u !== WALL) aux[i] = u;
    } else if (u === 0 && rand() < 0.4) {
      spawn(j, aux[i]);
      if (aux[i] === PLANT) aux[j] = 3;
    }
    return true;
  };

  BEHAVIOR[VOID] = function (i, x, y) {
    for (let k = 0; k < 8; k++) {
      const nx = x + NDX[k], ny = y + NDY[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      const u = type[j];
      if (u !== 0 && u !== VOID && u !== WALL && u !== CLONE) clearCell(j);
    }
    return true;
  };

  BEHAVIOR[ACID] = function (i, x, y) {
    const j = neighbor8(x, y);
    if (j < 0) return false;
    const u = type[j];
    if (ACIDPROOF[u]) return false;
    if (rand() < 0.2 * (1 - HARD[u] * 0.7)) {
      if (rand() < 0.15) morph(j, SMOKE); else clearCell(j);
      temp[i] += 6;
      if (rand() < 0.25) { clearCell(i); return true; }
    }
    return false;
  };

  BEHAVIOR[VIRUS] = function (i, x, y) {
    const j = neighbor8(x, y);
    if (j >= 0 && !VIRUS_IMMUNE[type[j]] && rand() < 0.06) infect(j);
    return false;
  };

  BEHAVIOR[SEED] = function (i, x, y) {
    if (y + 1 >= H) return false;
    const below = type[i + W];
    if ((below === DIRT || below === MUD) && temp[i] > 5 && temp[i] < 60 && rand() < 0.01) {
      morph(i, PLANT);
      life[i] = 18 + randInt(40); // growth budget
      aux[i] = 0; // main stem
      return true;
    }
    return false;
  };

  /*
   * Plants: aux holds the part (0 main stem, 1/2 branch growing left/right,
   * 3 leaf). A growing tip has life > 0 = remaining growth budget.
   */
  BEHAVIOR[PLANT] = function (i, x, y) {
    if (life[i] > 0 && rand() < 0.08) growPlant(i, x, y);
    return false; // still allow the plant + water reaction
  };

  function growPlant(i, x, y) {
    const budget = life[i];
    const kind = aux[i];
    life[i] = 0;
    let dx;
    if (kind === 0) { const r = rand(); dx = r < 0.15 ? -1 : r < 0.3 ? 1 : 0; }
    else dx = rand() < 0.65 ? (kind === 1 ? -1 : 1) : 0;
    const nx = x + dx, ny = y - 1;
    if (ny < 0 || nx < 0 || nx >= W) return;
    const j = ny * W + nx;
    if (type[j] !== 0) { bloom(x, y, kind); return; }
    spawn(j, PLANT);
    temp[j] = temp[i];
    life[j] = budget - 1;
    aux[j] = kind;
    if (budget - 1 <= 0) bloom(nx, ny, kind);
    if (kind === 0 && budget > 8 && rand() < 0.18) {
      const side = rand() < 0.5 ? -1 : 1;
      const bx = x + side;
      if (bx >= 0 && bx < W && type[i + side] === 0) {
        spawn(i + side, PLANT);
        life[i + side] = (budget * 0.45) | 0;
        aux[i + side] = side < 0 ? 1 : 2;
      }
    }
  }

  function bloom(x, y, kind) {
    if (kind === 0) {
      // A flower head: yellow centre, petals of one random hue around it.
      const hue = randInt(250);
      const cy = y - 1;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const d = Math.abs(dx) + Math.abs(dy);
          if (d > 2) continue;
          const px = x + dx, py = cy + dy;
          if (px < 0 || py < 0 || px >= W || py >= H) continue;
          const j = py * W + px;
          if (type[j] !== 0) continue;
          spawn(j, FLOWER);
          aux[j] = d === 0 ? 255 : hue;
        }
      }
    } else {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const px = x + dx, py = y + dy;
          if (px < 0 || py < 0 || px >= W || py >= H) continue;
          const j = py * W + px;
          if (type[j] === 0 && rand() < 0.7) { spawn(j, PLANT); aux[j] = 3; }
        }
      }
    }
  }

  function react(i, x, y, t) {
    const j = neighbor8(x, y);
    if (j < 0) return false;
    const r = RX[t * N + type[j]];
    if (r < 0 || rand() >= RX_P[r]) return false;
    const a = RX_A[r], b = RX_B[r];
    if (b >= 0) {
      if (b === 0) clearCell(j);
      else { morph(j, b); if (b === PLANT) aux[j] = 3; }
    }
    if (a >= 0) {
      if (a === 0) clearCell(i);
      else { morph(i, a); if (a === PLANT) aux[i] = 3; }
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ main update
  function update(i, x, y) {
    const t = type[i];
    stamp[i] = stampVal;
    const tp = temp[i];
    if (tp > MELT_T[t]) {
      if (rand() < 0.25) {
        morph(i, MELT_ALT[t] !== 0 && rand() < MELT_ALT_P[t] ? MELT_ALT[t] : MELT_TO[t]);
        return;
      }
    } else if (tp < FREEZE_T[t]) {
      if (rand() < 0.25) {
        const to = FREEZE_TO[t];
        if (ST[to] !== SOLID || (vel[i] <= 1 && supported(i, y))) { morph(i, to); return; }
        // A falling drop can't hang in mid-air as a solid: it hardens into its
        // debris (lava -> gravel, water -> snow) or stays liquid until it lands.
        if (DEBRIS[to] !== 0) { morph(i, DEBRIS[to]); return; }
      }
    }

    if ((flags[i] & F_BURN) !== 0) {
      if (burn(i, x, y, t)) return;
    } else {
      if (tp > IGNITE_T[t]) {
        if (EXPLOSIVE[t]) { detonate(i, x, y, t); return; }
        if (t === FUSE || hasAir(i, x, y)) ignite(i);
      }
      const b = BEHAVIOR[t];
      if (b !== null && b(i, x, y)) return;
      if (type[i] !== t) return;
      if (RXHAS[t] && react(i, x, y, t)) return;
    }

    const mt = t === VIRUS ? aux[i] : t;
    switch (ST[mt]) {
      case POWDER: movePowder(i, x, y, mt); break;
      case LIQUID: moveLiquid(i, x, y, mt); break;
      case GAS: moveGas(i, x, y, mt); break;
    }
  }

  function charge(j) {
    if (elec[j] !== 0) return;
    const u = type[j];
    if (CONDUCTOR[u]) {
      elec[j] = PENDING;
      pendingBuf[pendingCount++] = j;
    } else if (FLAM[u] > 0 && (flags[j] & F_BURN) === 0 && rand() < 0.2) {
      ignite(j);
    }
  }

  function electricStep() {
    pendingCount = 0;
    for (let i = 0; i < SIZE; i++) {
      const e = elec[i];
      if (e === 0) continue;
      if (e < 0) { elec[i] = e + 1; continue; }
      if (e === PENDING) continue;
      if (!CONDUCTOR[type[i]]) { elec[i] = 0; continue; }
      const x = i % W;
      if (x > 0) charge(i - 1);
      if (x < W - 1) charge(i + 1);
      if (i >= W) charge(i - W);
      if (i + W < SIZE) charge(i + W);
      elec[i] = e === 1 ? REFRACT : e - 1;
    }
    for (let k = 0; k < pendingCount; k++) elec[pendingBuf[k]] = SPARK_LIFE;
  }

  function heatStep() {
    for (let y = 0; y < H; y++) {
      const row = y * W;
      const lastRow = y === H - 1;
      for (let x = 0; x < W; x++) {
        const i = row + x;
        const ti = type[i];
        let tv = temp[i];
        const base = ti * N;
        if (x < W - 1) {
          const j = i + 1;
          const d = temp[j] - tv;
          if (d > 0.05 || d < -0.05) {
            const k = HEATK[base + type[j]];
            if (k > 0) { const f = d * k; tv += f; temp[j] -= f; }
          }
        }
        if (!lastRow) {
          const j = i + W;
          const d = temp[j] - tv;
          if (d > 0.05 || d < -0.05) {
            const k = HEATK[base + type[j]];
            if (k > 0) { const f = d * k; tv += f; temp[j] -= f; }
          }
        }
        const rl = RELAX[ti];
        if (rl > 0) tv += (AMBIENT - tv) * rl;
        temp[i] = tv;
      }
    }
  }

  function step() {
    frame++;
    stampVal = stampVal === 255 ? 1 : stampVal + 1;
    for (let y = H - 1; y >= 0; y--) {
      const row = y * W;
      if (((y ^ frame) & 1) === 0) {
        for (let x = 0; x < W; x++) {
          const i = row + x;
          if (type[i] !== 0 && stamp[i] !== stampVal) update(i, x, y);
        }
      } else {
        for (let x = W - 1; x >= 0; x--) {
          const i = row + x;
          if (type[i] !== 0 && stamp[i] !== stampVal) update(i, x, y);
        }
      }
    }
    electricStep();
    heatStep();
    processBlasts();
    updateParticles();
  }

  // ------------------------------------------------------------- painting
  function place(i, t, replace) {
    const u = type[i];
    if (t === SPARK) {
      if (CONDUCTOR[u] && u !== SPARK) { if (elec[i] === 0) elec[i] = SPARK_LIFE; }
      else if (u === 0) { if (rand() < BRUSH[t]) { spawn(i, SPARK); elec[i] = SPARK_LIFE; } }
      else if (FLAM[u] > 0) ignite(i);
      return;
    }
    if (t === VIRUS) {
      if (u === 0) { if (rand() < BRUSH[t]) { spawn(i, VIRUS); aux[i] = SAND; } }
      else if (!VIRUS_IMMUNE[u] && rand() < 0.3) infect(i);
      return;
    }
    if (t === FIRE && u !== 0) {
      if (FLAM[u] > 0 && rand() < 0.3) ignite(i);
      return;
    }
    if (u !== 0 && (!replace || u === t)) return;
    if (rand() >= BRUSH[t]) return;
    spawn(i, t);
    if (t === PLANT) aux[i] = 3;
  }

  /**
   * Apply a tool in a disc of radius r (cells) centred on (cx, cy).
   * tool: 'draw' | 'erase' | 'heat' | 'cool'
   */
  function paint(cx, cy, r, tool, t, replace) {
    const rad = Math.max(0, r - 1);
    const lim = rad * rad + rad;
    for (let dy = -rad; dy <= rad; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= H) continue;
      for (let dx = -rad; dx <= rad; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= W || dx * dx + dy * dy > lim) continue;
        const i = y * W + x;
        if (tool === 'draw') place(i, t, replace);
        else if (tool === 'erase') { clearCell(i); temp[i] = AMBIENT; }
        else if (tool === 'heat') temp[i] = Math.min(TMAX, temp[i] + 40);
        else if (tool === 'cool') temp[i] = Math.max(TMIN, temp[i] - 40);
      }
    }
  }

  /** Scene-building helper: unconditional placement of a fresh cell. */
  function setCell(x, y, t) {
    if (x < 0 || y < 0 || x >= W || y >= H) return -1;
    const i = y * W + x;
    if (t === 0) { clearCell(i); temp[i] = AMBIENT; return i; }
    spawn(i, t);
    if (t === PLANT) aux[i] = 3;
    return i;
  }

  function fillRect(x0, y0, x1, y1, t) {
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) setCell(x, y, t);
    }
  }

  // ------------------------------------------------------- save and load
  const MAGIC = 0x47463031; // "GF01"

  function toBase64(u8) {
    let s = '';
    for (let k = 0; k < u8.length; k += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(k, k + 0x8000));
    return btoa(s);
  }

  function fromBase64(str) {
    const s = atob(str);
    const u8 = new Uint8Array(s.length);
    for (let k = 0; k < s.length; k++) u8[k] = s.charCodeAt(k);
    return u8;
  }

  function serialize() {
    const n = SIZE;
    const u8 = new Uint8Array(12 + n * 7);
    const dv = new DataView(u8.buffer);
    dv.setUint32(0, MAGIC);
    dv.setUint16(4, W);
    dv.setUint16(6, H);
    dv.setUint32(8, n);
    u8.set(type, 12);
    u8.set(aux, 12 + n);
    u8.set(flags, 12 + 2 * n);
    const tOff = 12 + 3 * n, lOff = 12 + 5 * n;
    for (let i = 0; i < n; i++) {
      dv.setInt16(tOff + 2 * i, Math.max(-32768, Math.min(32767, Math.round(temp[i]))), true);
      dv.setInt16(lOff + 2 * i, life[i], true);
    }
    return toBase64(u8);
  }

  function deserialize(str) {
    let u8;
    try { u8 = fromBase64(str); } catch (e) { return false; }
    if (u8.length < 12) return false;
    const dv = new DataView(u8.buffer);
    if (dv.getUint32(0) !== MAGIC) return false;
    const w = dv.getUint16(4), h = dv.getUint16(6), n = dv.getUint32(8);
    if (n !== w * h || u8.length !== 12 + n * 7) return false;
    if (w !== W || h !== H) init(w, h);
    else clearWorld();
    const tOff = 12 + 3 * n, lOff = 12 + 5 * n;
    for (let i = 0; i < n; i++) {
      const t = u8[12 + i];
      type[i] = t < N ? t : 0;
      aux[i] = u8[12 + n + i];
      flags[i] = u8[12 + 2 * n + i];
      temp[i] = dv.getInt16(tOff + 2 * i, true);
      life[i] = dv.getInt16(lOff + 2 * i, true);
    }
    return true;
  }

  function cellAt(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    const i = y * W + x;
    let t = type[i];
    return { type: t, host: t === VIRUS ? aux[i] : 0, temp: temp[i], burning: (flags[i] & F_BURN) !== 0, charged: elec[i] > 0 };
  }

  function countCells() {
    let c = 0;
    for (let i = 0; i < SIZE; i++) if (type[i] !== 0) c++;
    return c;
  }

  G.sim = {
    AMBIENT, F_BURN, SPARK_LIFE,
    init, step, paint, setCell, fillRect, clearWorld, serialize, deserialize, cellAt, countCells,
    ignite: (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) ignite(y * W + x); },
    seed: (s) => { rng = s | 0 || 1; },
    random: rand,
    get W() { return W; },
    get H() { return H; },
    get frame() { return frame; },
    get type() { return type; },
    get temp() { return temp; },
    get life() { return life; },
    get aux() { return aux; },
    get flags() { return flags; },
    get shade() { return shade; },
    get elec() { return elec; },
    particles: {
      PX, PY, PT,
      get count() { return pCount; },
    },
  };
})();
