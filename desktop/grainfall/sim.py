"""Grainfall simulation (Python port of js/sim.js).

The world is a W x H grid stored as parallel flat buffers. Per-grain rules run
in plain Python over bytearray/array buffers (fast to index one item at a
time); heat diffusion runs on numpy views of the same memory.

Each tick:
  1. every cell is updated once, bottom row first, alternating the horizontal
     scan direction so nothing drifts to one side;
  2. electricity spreads one cell through conductors;
  3. heat diffuses between neighbours;
  4. queued explosions go off;
  5. flying debris particles move and land.
"""
import io
import math
import random
from array import array

import numpy as np

from .elements import ELEMENTS, ID, GAS, LIQUID, POWDER, SOLID, ref

N = len(ELEMENTS)
AMBIENT = 20.0
TMIN = -273.0
TMAX = 6000.0
F_BURN = 1
SPARK_LIFE = 4
REFRACT = -5
PENDING = 100
MAXV = 12
MAX_PARTICLES = 3000
MAX_BLASTS_PER_TICK = 500
BATTERY_PERIOD = 10

globals().update({k.upper(): v for k, v in ID.items()})  # SAND, WATER, ...

# ------------------------------------------------------------- lookup tables
ST = [e.state for e in ELEMENTS]
DENS = [float(e.density) for e in ELEMENTS]
COND = [float(e.conduct) for e in ELEMENTS]
TEMP0 = [float(e.temp) for e in ELEMENTS]
SLIDE = [e.slide for e in ELEMENTS]
DISP = [e.disp for e in ELEMENTS]
VISC = [e.visc for e in ELEMENTS]
RISE = [e.rise for e in ELEMENTS]
LIFE_MIN = [e.life[0] if e.life else 0 for e in ELEMENTS]
LIFE_SPAN = [e.life[1] - e.life[0] if e.life else 0 for e in ELEMENTS]
HAS_LIFE = [bool(e.life) for e in ELEMENTS]
MELT_T = [e.melt[0] if e.melt else math.inf for e in ELEMENTS]
MELT_TO = [ref(e.melt[1]) if e.melt else 0 for e in ELEMENTS]
MELT_ALT = [ref(e.melt[2]) if e.melt and len(e.melt) > 2 else 0 for e in ELEMENTS]
MELT_ALT_P = [e.melt[3] if e.melt and len(e.melt) > 3 else 0 for e in ELEMENTS]
FREEZE_T = [e.freeze[0] if e.freeze else -math.inf for e in ELEMENTS]
FREEZE_TO = [ref(e.freeze[1]) if e.freeze else 0 for e in ELEMENTS]
FLAM = [e.flammable for e in ELEMENTS]
IGNITE_T = [e.ignite if e.flammable > 0 else math.inf for e in ELEMENTS]
BURN_MIN = [e.burn[0] if e.burn else 0 for e in ELEMENTS]
BURN_SPAN = [e.burn[1] - e.burn[0] if e.burn else 0 for e in ELEMENTS]
BURN_T = [e.burn[2] if e.burn else 0 for e in ELEMENTS]
BURN_INTO = [ref(e.burn[3]) if e.burn else 0 for e in ELEMENTS]
BURN_RES = [e.burn[4] if e.burn else 0 for e in ELEMENTS]
EXPLOSIVE = [bool(e.explosive) for e in ELEMENTS]
EXPL_R = [e.explosive[0] if e.explosive else 0 for e in ELEMENTS]
EXPL_P = [e.explosive[1] if e.explosive else 0 for e in ELEMENTS]
IMPACT = [e.impact for e in ELEMENTS]
CONDUCTOR = [e.conductor for e in ELEMENTS]
HARD = [e.hardness for e in ELEMENTS]
INDESTRUCT = [e.indestructible for e in ELEMENTS]
ACIDPROOF = [e.acid_proof for e in ELEMENTS]
EXTING = [e.extinguish for e in ELEMENTS]
DEBRIS = [ref(e.debris) for e in ELEMENTS]
BRUSH = [e.brush for e in ELEMENTS]
VIRUS_IMMUNE = [
    t == EMPTY or t == VIRUS or t == EMBER or e.state == GAS or e.indestructible
    for t, e in enumerate(ELEMENTS)
]

# Pairwise heat transfer: harmonic mean of the two conductivities.
_c = np.array(COND, dtype=np.float64)
_ca, _cb = np.meshgrid(_c, _c, indexing="ij")
with np.errstate(divide="ignore", invalid="ignore"):
    HEATK = np.where((_ca > 0) & (_cb > 0), 2 * _ca * _cb / (_ca + _cb) * 0.24, 0).astype(np.float32).ravel()
RELAX = np.array([e.relax for e in ELEMENTS], dtype=np.float32)

# [self, neighbour, chance per tick, self becomes, neighbour becomes]
# None = unchanged, "empty" = removed.
REACTIONS = [
    ("water", "lava", 0.3, "steam", "obsidian"),
    ("salt_water", "lava", 0.3, "steam", "obsidian"),
    ("snow", "lava", 0.3, "water", "obsidian"),
    ("water", "molten_metal", 0.3, "steam", "metal"),
    ("water", "molten_glass", 0.3, "steam", "glass"),
    ("water", "salt", 0.04, "salt_water", "empty"),
    ("ice", "salt", 0.01, "salt_water", None),
    ("snow", "salt", 0.03, "salt_water", None),
    ("water", "dirt", 0.01, "empty", "mud"),
    ("metal", "water", 0.0004, "rust", None),
    ("metal", "salt_water", 0.003, "rust", None),
    ("plant", "water", 0.006, None, "plant"),
]
RX = {}  # (self, other) -> (chance, self_to, other_to); -1 = unchanged
RXHAS = [False] * N


def _rx_id(k):
    return -1 if k is None else 0 if k == "empty" else ID[k]


for _a, _b, _p, _ta, _tb in REACTIONS:
    RX[(ID[_a], ID[_b])] = (_p, _rx_id(_ta), _rx_id(_tb))
    RX[(ID[_b], ID[_a])] = (_p, _rx_id(_tb), _rx_id(_ta))
    RXHAS[ID[_a]] = RXHAS[ID[_b]] = True

# Static solids that only need attention when hot, cold or burning. Skipping
# them cheaply is what keeps the Python loop fast.
_BEHAVING = {FIRE, SMOKE, STEAM, EMBER, SPARK, HEATER, COOLER, BATTERY, LAMP, CLONE, VOID, ACID, VIRUS, SEED, PLANT}
QUIET = [ST[t] == SOLID and t not in _BEHAVING and not RXHAS[t] for t in range(N)]
QUIET_MAX = [min(MELT_T[t], IGNITE_T[t]) for t in range(N)]

NDX = (-1, 0, 1, -1, 1, -1, 0, 1)
NDY = (-1, -1, -1, 0, 0, 1, 1, 1)
SAVE_MAGIC = b"GFPY1"


class Simulation:
    """A Grainfall world. Create with a size, then call step() repeatedly."""

    def __init__(self, w=200, h=120, seed=None):
        self.random = random.Random(seed)
        self.init(w, h)

    # ----------------------------------------------------------- allocation
    def init(self, w, h):
        self.W, self.H = W, H = int(w), int(h)
        size = W * H
        self.SIZE = size
        self.type = bytearray(size)
        self.temp = array("f", [AMBIENT]) * size
        self.life = array("h", [0]) * size
        self.aux = bytearray(size)
        self.flags = bytearray(size)
        self.shade = bytearray(self.random.getrandbits(8) for _ in range(size))
        self.elec = array("b", [0]) * size
        self.vel = bytearray(size)
        self.stamp = bytearray(size)
        # numpy views sharing the same memory
        self.type_np = np.frombuffer(self.type, dtype=np.uint8)
        self.temp_np = np.frombuffer(self.temp, dtype=np.float32)
        self.life_np = np.frombuffer(self.life, dtype=np.int16)
        self.aux_np = np.frombuffer(self.aux, dtype=np.uint8)
        self.flags_np = np.frombuffer(self.flags, dtype=np.uint8)
        self.shade_np = np.frombuffer(self.shade, dtype=np.uint8)
        self.elec_np = np.frombuffer(self.elec, dtype=np.int8)
        self.vel_np = np.frombuffer(self.vel, dtype=np.uint8)
        self.particles = []  # [x, y, vx, vy, type, temp]
        self.frame = 0
        self._compile()

    def clear(self):
        self.type_np[:] = 0
        self.temp_np[:] = AMBIENT
        self.life_np[:] = 0
        self.aux_np[:] = 0
        self.flags_np[:] = 0
        self.elec_np[:] = 0
        self.vel_np[:] = 0
        self.particles.clear()
        self._blasts.clear()

    def count_cells(self):
        return int(np.count_nonzero(self.type_np))

    def cell_at(self, x, y):
        if not (0 <= x < self.W and 0 <= y < self.H):
            return None
        i = y * self.W + x
        t = self.type[i]
        return {
            "type": t,
            "host": self.aux[i] if t == VIRUS else 0,
            "temp": float(self.temp[i]),
            "burning": bool(self.flags[i] & F_BURN),
            "charged": self.elec[i] > 0,
        }

    # -------------------------------------------------------- save / load
    def save(self, fp):
        """Write the world to a binary file object."""
        buf = io.BytesIO()
        np.savez_compressed(
            buf,
            size=np.array([self.W, self.H]),
            type=self.type_np,
            aux=self.aux_np,
            flags=self.flags_np,
            temp=np.round(self.temp_np).astype(np.int16),
            life=self.life_np,
        )
        fp.write(SAVE_MAGIC + buf.getvalue())

    def load(self, fp):
        """Read a world written by save(). Returns False if it is not one."""
        data = fp.read()
        if not data.startswith(SAVE_MAGIC):
            return False
        try:
            z = np.load(io.BytesIO(data[len(SAVE_MAGIC):]))
            w, h = (int(v) for v in z["size"])
            arrays = {k: z[k] for k in ("type", "aux", "flags", "temp", "life")}
        except Exception:
            return False
        if any(a.size != w * h for a in arrays.values()):
            return False
        if (w, h) != (self.W, self.H):
            self.init(w, h)
        else:
            self.clear()
        t = arrays["type"].astype(np.uint8)
        t[t >= N] = 0
        self.type_np[:] = t
        self.aux_np[:] = arrays["aux"]
        self.flags_np[:] = arrays["flags"]
        self.temp_np[:] = arrays["temp"]
        self.life_np[:] = arrays["life"]
        return True

    # ------------------------------------------------------------ the rules
    def _compile(self):
        """Build the per-tick functions as closures over the world buffers.

        Closures read their variables much faster than attribute lookups, which
        matters for code that runs tens of thousands of times per tick.
        """
        W, H, SIZE = self.W, self.H, self.SIZE
        typ, temp, life, aux = self.type, self.temp, self.life, self.aux
        flags, shade, elec, vel, stamp = self.flags, self.shade, self.elec, self.vel, self.stamp
        particles = self.particles
        rand = self.random.random
        getbits = self.random.getrandbits
        blasts = []
        self._blasts = blasts
        state = {"frame": 0, "sv": 1}

        def randint(n):
            return int(rand() * n)

        def neighbor8(x, y):
            k = int(rand() * 8)
            nx, ny = x + NDX[k], y + NDY[k]
            if nx < 0 or ny < 0 or nx >= W or ny >= H:
                return -1
            return ny * W + nx

        def spawn(i, t):
            typ[i] = t
            temp[i] = TEMP0[t]
            life[i] = LIFE_MIN[t] + randint(LIFE_SPAN[t] + 1) if HAS_LIFE[t] else 0
            aux[i] = 0
            flags[i] = 0
            elec[i] = 0
            vel[i] = 0
            shade[i] = getbits(8)
            stamp[i] = state["sv"]

        def morph(i, t):
            typ[i] = t
            life[i] = LIFE_MIN[t] + randint(LIFE_SPAN[t] + 1) if HAS_LIFE[t] else 0
            aux[i] = 0
            flags[i] = 0
            vel[i] = 0
            if not CONDUCTOR[t]:
                elec[i] = 0
            if (t == FIRE or t == EMBER) and temp[i] < TEMP0[t]:
                temp[i] = TEMP0[t]
            stamp[i] = state["sv"]

        def clear_cell(i):
            typ[i] = 0
            life[i] = 0
            aux[i] = 0
            flags[i] = 0
            elec[i] = 0
            vel[i] = 0

        def swap(i, j):
            typ[i], typ[j] = typ[j], typ[i]
            temp[i], temp[j] = temp[j], temp[i]
            life[i], life[j] = life[j], life[i]
            aux[i], aux[j] = aux[j], aux[i]
            flags[i], flags[j] = flags[j], flags[i]
            shade[i], shade[j] = shade[j], shade[i]
            elec[i], elec[j] = elec[j], elec[i]
            vel[i], vel[j] = vel[j], vel[i]
            sv = state["sv"]
            stamp[i] = sv
            stamp[j] = sv

        def can_sink(t, u):
            if u == 0:
                return True
            s = ST[u]
            return (s == LIQUID or s == GAS) and DENS[t] > DENS[u]

        def can_rise(t, u):
            if u == 0:
                return True
            s = ST[u]
            if s == GAS:
                return DENS[u] > DENS[t]
            if s == LIQUID:
                return rand() < 0.3
            return False

        def supported(i, y):
            if y + 1 >= H:
                return True
            b = typ[i + W]
            sb = ST[b]
            if sb == SOLID:
                return True
            if b == 0 or sb == GAS or vel[i + W] > 0:
                return False
            if y + 2 >= H:
                return True
            b2 = typ[i + 2 * W]
            return b2 != 0 and ST[b2] != GAS and vel[i + 2 * W] == 0

        def has_air(i, x, y):
            if x > 0:
                u = typ[i - 1]
                if u == 0 or ST[u] == GAS:
                    return True
            if x < W - 1:
                u = typ[i + 1]
                if u == 0 or ST[u] == GAS:
                    return True
            if y > 0:
                u = typ[i - W]
                if u == 0 or ST[u] == GAS:
                    return True
            if y < H - 1:
                u = typ[i + W]
                if u == 0 or ST[u] == GAS:
                    return True
            return False

        def ignite(i):
            t = typ[i]
            if FLAM[t] <= 0 or flags[i] & F_BURN:
                return
            flags[i] |= F_BURN
            life[i] = BURN_MIN[t] + randint(BURN_SPAN[t] + 1)

        def infect(j):
            host = typ[j]
            typ[j] = VIRUS
            aux[j] = host
            flags[j] = 0
            life[j] = 0
            stamp[j] = state["sv"]

        # ------------------------------------------------------- movement
        def fall(i, y, t):
            """Fall with acceleration. New index, same index (drifting in a
            fluid) or -1 if blocked."""
            if y + 1 >= H:
                return -1
            below = typ[i + W]
            if not can_sink(t, below):
                return -1
            if below != 0 and rand() < 0.5:
                return i
            v = vel[i] + 1
            if v > MAXV:
                v = MAXV
            steps = 1 + (v >> 2)
            cur, cy = i, y
            while True:
                nxt = cur + W
                u = typ[nxt]
                if u != 0:
                    if not can_sink(t, u):
                        break
                    swap(cur, nxt)
                    cur = nxt
                    cy += 1
                    v = 1
                    break
                swap(cur, nxt)
                cur = nxt
                cy += 1
                steps -= 1
                if steps <= 0 or cy + 1 >= H:
                    break
            vel[cur] = v
            return cur

        def move_powder(i, x, y, t):
            if fall(i, y, t) >= 0:
                return
            if IMPACT[t] and vel[i] >= 8:
                detonate(i, x, y, t)
                return
            vel[i] = 0
            if y + 1 >= H or rand() >= SLIDE[t]:
                return
            d = -1 if rand() < 0.5 else 1
            nx = x + d
            if 0 <= nx < W and can_sink(t, typ[i + W + d]):
                swap(i, i + W + d)
                return
            nx = x - d
            if 0 <= nx < W and can_sink(t, typ[i + W - d]):
                swap(i, i + W - d)

        def move_liquid(i, x, y, t):
            if fall(i, y, t) >= 0:
                return
            if IMPACT[t] and vel[i] >= 8:
                detonate(i, x, y, t)
                return
            vel[i] = 0
            if VISC[t] > 0 and rand() < VISC[t]:
                return
            d0 = -1 if rand() < 0.5 else 1
            if y + 1 < H:
                for d in (d0, -d0):
                    nx = x + d
                    if 0 <= nx < W and can_sink(t, typ[i + W + d]):
                        swap(i, i + W + d)
                        return
            # Flow sideways, stopping above a drop so liquids pour off ledges.
            reach = DISP[t]
            for d in (d0, -d0):
                best = -1
                for k in range(1, reach + 1):
                    nx = x + d * k
                    if nx < 0 or nx >= W:
                        break
                    j = i + d * k
                    u = typ[j]
                    if u != 0 and ST[u] != GAS:
                        break
                    best = j
                    if u != 0:
                        break
                    if y + 1 < H and can_sink(t, typ[j + W]):
                        break
                if best >= 0:
                    swap(i, best)
                    return

        def move_gas(i, x, y, t):
            if y > 0 and rand() < RISE[t]:
                r = rand()
                dx = 0 if r < 0.5 else (-1 if r < 0.75 else 1)
                if x + dx < 0 or x + dx >= W:
                    dx = 0
                j = i - W + dx
                if can_rise(t, typ[j]):
                    swap(i, j)
                    return
                if dx != 0:
                    j = i - W
                    if can_rise(t, typ[j]):
                        swap(i, j)
                        return
            d0 = -1 if rand() < 0.5 else 1
            for d in (d0, -d0):
                nx = x + d
                if 0 <= nx < W and typ[i + d] == 0:
                    swap(i, i + d)
                    return

        # ---------------------------------------------------- fire & blasts
        def fuse_light(j):
            if FLAM[typ[j]] > 0 and not flags[j] & F_BURN and rand() < 0.3:
                ignite(j)

        def burn(i, x, y, t):
            """Advance a burning cell. True if it was consumed."""
            if EXPLOSIVE[t]:
                detonate(i, x, y, t)
                return True
            lv = life[i] - 1
            if lv <= 0:
                into = BURN_INTO[t]
                if into != 0 and rand() < BURN_RES[t]:
                    morph(i, into)
                elif rand() < 0.3:
                    morph(i, SMOKE)
                else:
                    clear_cell(i)
                return True
            # Smother cells sealed in by other material (fuses carry oxidiser).
            if t != FUSE and rand() < 0.1 and not has_air(i, x, y):
                flags[i] &= ~F_BURN
                if temp[i] > IGNITE_T[t] - 60:
                    temp[i] = IGNITE_T[t] - 60
                return False
            life[i] = lv
            if temp[i] < BURN_T[t]:
                temp[i] = BURN_T[t]
            if t == FUSE:
                if x > 0:
                    fuse_light(i - 1)
                if x < W - 1:
                    fuse_light(i + 1)
                if y > 0:
                    fuse_light(i - W)
                if y < H - 1:
                    fuse_light(i + W)
            # Throw flames (and the odd ember or puff of smoke) upward.
            if y > 0 and rand() < 0.45:
                nx = x + randint(3) - 1
                if 0 <= nx < W:
                    j = i - W + (nx - x)
                    if typ[j] == 0:
                        r = rand()
                        if (t == WOOD or t == COAL) and r < 0.01:
                            spawn(j, EMBER)
                        elif r < 0.9:
                            spawn(j, FIRE)
                        else:
                            spawn(j, SMOKE)
            j = neighbor8(x, y)
            if j >= 0:
                u = typ[j]
                if EXTING[u]:
                    if rand() < 0.4:
                        flags[i] &= ~F_BURN
                        if temp[i] > IGNITE_T[t] - 60:
                            temp[i] = IGNITE_T[t] - 60
                        if (u == WATER or u == SALT_WATER) and rand() < 0.3:
                            morph(j, STEAM)
                elif FLAM[u] > 0 and not flags[j] & F_BURN and rand() < FLAM[u] * 0.5:
                    ignite(j)
            return False

        def detonate(i, x, y, t):
            spawn(i, FIRE)
            temp[i] = 1500
            blasts.append((x, y, EXPL_R[t], EXPL_P[t]))

        def explode(cx, cy, r, p):
            r2 = r * r
            for y in range(max(0, cy - r), min(H - 1, cy + r) + 1):
                dy = y - cy
                for x in range(max(0, cx - r), min(W - 1, cx + r) + 1):
                    dx = x - cx
                    d2 = dx * dx + dy * dy
                    if d2 > r2:
                        continue
                    i = y * W + x
                    d = math.sqrt(d2)
                    f = 1 - d / (r + 1)
                    heat = 200 + 1000 * f
                    if temp[i] < heat:
                        temp[i] = heat
                    t = typ[i]
                    if t == 0:
                        if rand() < f * 0.6:
                            spawn(i, FIRE)
                            temp[i] = heat
                        continue
                    if INDESTRUCT[t]:
                        continue
                    if EXPLOSIVE[t]:
                        if not flags[i] & F_BURN:
                            flags[i] |= F_BURN
                            life[i] = 1
                        continue
                    if FLAM[t] > 0 and rand() < 0.5:
                        ignite(i)
                    if rand() >= f * p * (1 - HARD[t]):
                        continue
                    s = ST[t]
                    if f > 0.75 or s == GAS:
                        if rand() < 0.5:
                            spawn(i, FIRE)
                            temp[i] = heat
                        else:
                            clear_cell(i)
                        continue
                    deb = DEBRIS[t] or (t if s == POWDER or s == LIQUID else 0)
                    if deb and rand() < 0.7 and len(particles) < MAX_PARTICLES:
                        k = (f * p * 3.2 + rand() * 1.5) / (d or 1)
                        particles.append([x + 0.5, y + 0.5, dx * k, dy * k - 1.8 * f * p, deb, float(temp[i])])
                    clear_cell(i)

        def process_blasts():
            if not blasts:
                return
            now = blasts[:MAX_BLASTS_PER_TICK]
            del blasts[:MAX_BLASTS_PER_TICK]
            for b in now:
                explode(*b)

        def land(p):
            x = min(W - 1, max(0, int(math.floor(p[0]))))
            y = min(H - 1, max(0, int(math.floor(p[1]))))
            i = y * W + x
            for _ in range(3):
                if typ[i] == 0:
                    break
                if i < W:
                    return
                i -= W
            if typ[i] != 0:
                return
            spawn(i, p[4])
            temp[i] = p[5]

        def update_particles():
            keep = []
            for p in particles:
                p[3] += 0.22
                p[2] *= 0.99
                x, y, vx, vy = p[0], p[1], p[2], p[3]
                steps = max(1, math.ceil(max(abs(vx), abs(vy))))
                sx, sy = vx / steps, vy / steps
                landed = False
                for _ in range(steps):
                    nx, ny = x + sx, y + sy
                    if nx < 0 or nx >= W:
                        p[2] = -p[2] * 0.4
                        nx = x
                    if ny < 0:
                        p[3] = 0
                        ny = 0
                    if ny >= H:
                        landed = True
                        break
                    if typ[int(ny) * W + int(nx)] != 0:
                        landed = True
                        break
                    x, y = nx, ny
                p[0], p[1] = x, y
                if landed:
                    land(p)
                else:
                    keep.append(p)
            particles[:] = keep

        # ----------------------------------------------- special behaviours
        # Each returns True when it fully handled the cell this tick.
        def b_fire(i, x, y):
            lv = life[i] - 1
            if lv <= 0 or temp[i] < 250:
                if rand() < 0.2:
                    morph(i, SMOKE)
                else:
                    clear_cell(i)
                return True
            life[i] = lv
            want = 450 + lv * 14
            if temp[i] < want:
                temp[i] = want
            j = neighbor8(x, y)
            if j >= 0:
                u = typ[j]
                if u != 0:
                    if EXTING[u]:
                        clear_cell(i)
                        if (u == WATER or u == SALT_WATER) and rand() < 0.2:
                            morph(j, STEAM)
                        return True
                    if FLAM[u] > 0 and not flags[j] & F_BURN and rand() < FLAM[u]:
                        ignite(j)
            if y > 0 and rand() < RISE[FIRE]:
                r = rand()
                dx = 0 if r < 0.5 else (-1 if r < 0.75 else 1)
                if x + dx < 0 or x + dx >= W:
                    dx = 0
                k = i - W + dx
                u = typ[k]
                if u == 0 or (ST[u] == GAS and DENS[u] > DENS[FIRE]):
                    swap(i, k)
            return True

        def b_smoke(i, x, y):
            life[i] -= 1
            if life[i] <= 0:
                clear_cell(i)
                return True
            return False

        def b_steam(i, x, y):
            # Condense on cold surfaces, warming them a little.
            j = neighbor8(x, y)
            if j < 0:
                return False
            u = typ[j]
            if u != 0 and ST[u] == SOLID and COND[u] > 0 and temp[j] < 50 and rand() < 0.08:
                morph(i, WATER)
                temp[i] = min(90.0, (temp[i] + temp[j]) * 0.5)
                temp[j] += 4
                return True
            return False

        def b_ember(i, x, y):
            life[i] -= 1
            if life[i] <= 0:
                if rand() < 0.4:
                    morph(i, ASH)
                else:
                    clear_cell(i)
                return True
            if temp[i] < 700:
                temp[i] = 700
            j = neighbor8(x, y)
            if j >= 0:
                u = typ[j]
                if EXTING[u]:
                    morph(i, ASH)
                    return True
                if FLAM[u] > 0 and not flags[j] & F_BURN and rand() < FLAM[u]:
                    ignite(j)
            return False

        def b_spark(i, x, y):
            life[i] -= 1
            if life[i] <= 0:
                clear_cell(i)
                return True
            if elec[i] == 0:
                elec[i] = SPARK_LIFE
            return True

        def b_heater(i, x, y):
            temp[i] = TEMP0[HEATER]
            return True

        def b_cooler(i, x, y):
            temp[i] = TEMP0[COOLER]
            return True

        def b_battery(i, x, y):
            if elec[i] == 0 and state["frame"] % BATTERY_PERIOD == 0:
                elec[i] = SPARK_LIFE
            return True

        def b_lamp(i, x, y):
            if elec[i] > 0:
                aux[i] = 255
            elif aux[i] > 0:
                aux[i] = int(aux[i] * 0.93)
            return True

        def b_clone(i, x, y):
            j = neighbor8(x, y)
            if j < 0:
                return True
            u = typ[j]
            if aux[i] == 0:
                if u == CLONE:
                    if aux[j]:
                        aux[i] = aux[j]
                elif u != 0 and u != VOID and u != WALL:
                    aux[i] = u
            elif u == 0 and rand() < 0.4:
                spawn(j, aux[i])
                if aux[i] == PLANT:
                    aux[j] = 3
            return True

        def b_void(i, x, y):
            for k in range(8):
                nx, ny = x + NDX[k], y + NDY[k]
                if nx < 0 or ny < 0 or nx >= W or ny >= H:
                    continue
                j = ny * W + nx
                u = typ[j]
                if u != 0 and u != VOID and u != WALL and u != CLONE:
                    clear_cell(j)
            return True

        def b_acid(i, x, y):
            j = neighbor8(x, y)
            if j < 0:
                return False
            u = typ[j]
            if ACIDPROOF[u]:
                return False
            if rand() < 0.2 * (1 - HARD[u] * 0.7):
                if rand() < 0.15:
                    morph(j, SMOKE)
                else:
                    clear_cell(j)
                temp[i] += 6
                if rand() < 0.25:
                    clear_cell(i)
                    return True
            return False

        def b_virus(i, x, y):
            j = neighbor8(x, y)
            if j >= 0 and not VIRUS_IMMUNE[typ[j]] and rand() < 0.06:
                infect(j)
            return False

        def b_seed(i, x, y):
            if y + 1 >= H:
                return False
            below = typ[i + W]
            if (below == DIRT or below == MUD) and 5 < temp[i] < 60 and rand() < 0.01:
                morph(i, PLANT)
                life[i] = 18 + randint(40)  # growth budget
                aux[i] = 0  # main stem
                return True
            return False

        # Plants: aux is the part (0 stem, 1/2 branch left/right, 3 leaf);
        # a growing tip has life > 0 = remaining growth budget.
        def b_plant(i, x, y):
            if life[i] > 0 and rand() < 0.08:
                grow(i, x, y)
            return False

        def grow(i, x, y):
            budget, kind = life[i], aux[i]
            life[i] = 0
            if kind == 0:
                r = rand()
                dx = -1 if r < 0.15 else (1 if r < 0.3 else 0)
            else:
                dx = (-1 if kind == 1 else 1) if rand() < 0.65 else 0
            nx, ny = x + dx, y - 1
            if ny < 0 or nx < 0 or nx >= W:
                return
            j = ny * W + nx
            if typ[j] != 0:
                bloom(x, y, kind)
                return
            spawn(j, PLANT)
            temp[j] = temp[i]
            life[j] = budget - 1
            aux[j] = kind
            if budget - 1 <= 0:
                bloom(nx, ny, kind)
            if kind == 0 and budget > 8 and rand() < 0.18:
                side = -1 if rand() < 0.5 else 1
                if 0 <= x + side < W and typ[i + side] == 0:
                    spawn(i + side, PLANT)
                    life[i + side] = int(budget * 0.45)
                    aux[i + side] = 1 if side < 0 else 2

        def bloom(x, y, kind):
            if kind == 0:
                hue = randint(250)
                cy = y - 1
                for dy in range(-2, 3):
                    for dx in range(-2, 3):
                        dist = abs(dx) + abs(dy)
                        if dist > 2:
                            continue
                        px, py = x + dx, cy + dy
                        if px < 0 or py < 0 or px >= W or py >= H:
                            continue
                        j = py * W + px
                        if typ[j] != 0:
                            continue
                        spawn(j, FLOWER)
                        aux[j] = 255 if dist == 0 else hue
            else:
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        px, py = x + dx, y + dy
                        if px < 0 or py < 0 or px >= W or py >= H:
                            continue
                        j = py * W + px
                        if typ[j] == 0 and rand() < 0.7:
                            spawn(j, PLANT)
                            aux[j] = 3

        BEHAVIOR = [None] * N
        BEHAVIOR[FIRE] = b_fire
        BEHAVIOR[SMOKE] = b_smoke
        BEHAVIOR[STEAM] = b_steam
        BEHAVIOR[EMBER] = b_ember
        BEHAVIOR[SPARK] = b_spark
        BEHAVIOR[HEATER] = b_heater
        BEHAVIOR[COOLER] = b_cooler
        BEHAVIOR[BATTERY] = b_battery
        BEHAVIOR[LAMP] = b_lamp
        BEHAVIOR[CLONE] = b_clone
        BEHAVIOR[VOID] = b_void
        BEHAVIOR[ACID] = b_acid
        BEHAVIOR[VIRUS] = b_virus
        BEHAVIOR[SEED] = b_seed
        BEHAVIOR[PLANT] = b_plant

        def react(i, x, y, t):
            j = neighbor8(x, y)
            if j < 0:
                return False
            rx = RX.get((t, typ[j]))
            if rx is None or rand() >= rx[0]:
                return False
            _, a, b = rx
            if b >= 0:
                if b == 0:
                    clear_cell(j)
                else:
                    morph(j, b)
                    if b == PLANT:
                        aux[j] = 3
            if a >= 0:
                if a == 0:
                    clear_cell(i)
                else:
                    morph(i, a)
                    if a == PLANT:
                        aux[i] = 3
                return True
            return False

        # ------------------------------------------------------ main update
        def update(i, x, y):
            t = typ[i]
            stamp[i] = state["sv"]
            tp = temp[i]
            if tp > MELT_T[t]:
                if rand() < 0.25:
                    alt = MELT_ALT[t]
                    morph(i, alt if alt and rand() < MELT_ALT_P[t] else MELT_TO[t])
                    return
            elif tp < FREEZE_T[t]:
                if rand() < 0.25:
                    to = FREEZE_TO[t]
                    if ST[to] != SOLID or (vel[i] <= 1 and supported(i, y)):
                        morph(i, to)
                        return
                    # A falling drop can't hang in mid-air as a solid.
                    if DEBRIS[to]:
                        morph(i, DEBRIS[to])
                        return
            if flags[i] & F_BURN:
                if burn(i, x, y, t):
                    return
            else:
                if tp > IGNITE_T[t]:
                    if EXPLOSIVE[t]:
                        detonate(i, x, y, t)
                        return
                    if t == FUSE or has_air(i, x, y):
                        ignite(i)
                b = BEHAVIOR[t]
                if b is not None and b(i, x, y):
                    return
                if typ[i] != t:
                    return
                if RXHAS[t] and react(i, x, y, t):
                    return
            mt = aux[i] if t == VIRUS else t
            s = ST[mt]
            if s == POWDER:
                move_powder(i, x, y, mt)
            elif s == LIQUID:
                move_liquid(i, x, y, mt)
            elif s == GAS:
                move_gas(i, x, y, mt)

        # ---------------------------------------------------- electricity
        elec_np = self.elec_np

        def charge(j, pending):
            if elec[j] != 0:
                return
            u = typ[j]
            if CONDUCTOR[u]:
                elec[j] = PENDING
                pending.append(j)
            elif FLAM[u] > 0 and not flags[j] & F_BURN and rand() < 0.2:
                ignite(j)

        def electric_step():
            active = np.flatnonzero(elec_np)
            if active.size == 0:
                return
            pending = []
            for i in active.tolist():
                e = elec[i]
                if e < 0:
                    elec[i] = e + 1
                    continue
                if e == PENDING or e == 0:
                    continue
                if not CONDUCTOR[typ[i]]:
                    elec[i] = 0
                    continue
                x = i % W
                if x > 0:
                    charge(i - 1, pending)
                if x < W - 1:
                    charge(i + 1, pending)
                if i >= W:
                    charge(i - W, pending)
                if i + W < SIZE:
                    charge(i + W, pending)
                elec[i] = REFRACT if e == 1 else e - 1
            for j in pending:
                elec[j] = SPARK_LIFE

        # ------------------------------------------------------------ heat
        T2 = self.temp_np.reshape(H, W)
        typ2 = self.type_np.reshape(H, W)

        def heat_step():
            tp = typ2.astype(np.intp)
            base = tp * N
            k = HEATK[base[:, :-1] + tp[:, 1:]]
            d = (T2[:, 1:] - T2[:, :-1]) * k
            T2[:, :-1] += d
            T2[:, 1:] -= d
            k = HEATK[base[:-1, :] + tp[1:, :]]
            d = (T2[1:, :] - T2[:-1, :]) * k
            T2[:-1, :] += d
            T2[1:, :] -= d
            r = RELAX[tp]
            T2[:] += (AMBIENT - T2) * r

        # ------------------------------------------------------------ step
        rows = []
        for y in range(H - 1, -1, -1):
            row = y * W
            rows.append((y, row, range(row, row + W), range(row + W - 1, row - 1, -1)))

        def step():
            frame = state["frame"] + 1
            state["frame"] = frame
            sv = 1 if state["sv"] == 255 else state["sv"] + 1
            state["sv"] = sv
            for y, row, fwd, back in rows:
                for i in fwd if ((y ^ frame) & 1) == 0 else back:
                    t = typ[i]
                    if t == 0 or stamp[i] == sv:
                        continue
                    if QUIET[t] and flags[i] == 0 and FREEZE_T[t] <= temp[i] <= QUIET_MAX[t]:
                        continue
                    update(i, i - row, y)
            electric_step()
            heat_step()
            process_blasts()
            if particles:
                update_particles()
            self.frame = frame

        # --------------------------------------------------------- painting
        def place(i, t, replace):
            u = typ[i]
            if t == SPARK:
                if CONDUCTOR[u] and u != SPARK:
                    if elec[i] == 0:
                        elec[i] = SPARK_LIFE
                elif u == 0:
                    if rand() < BRUSH[t]:
                        spawn(i, SPARK)
                        elec[i] = SPARK_LIFE
                elif FLAM[u] > 0:
                    ignite(i)
                return
            if t == VIRUS:
                if u == 0:
                    if rand() < BRUSH[t]:
                        spawn(i, VIRUS)
                        aux[i] = SAND
                elif not VIRUS_IMMUNE[u] and rand() < 0.3:
                    infect(i)
                return
            if t == FIRE and u != 0:
                if FLAM[u] > 0 and rand() < 0.3:
                    ignite(i)
                return
            if u != 0 and (not replace or u == t):
                return
            if rand() >= BRUSH[t]:
                return
            spawn(i, t)
            if t == PLANT:
                aux[i] = 3

        def paint(cx, cy, r, tool, t=0, replace=False):
            rad = max(0, r - 1)
            lim = rad * rad + rad
            for dy in range(-rad, rad + 1):
                y = cy + dy
                if y < 0 or y >= H:
                    continue
                for dx in range(-rad, rad + 1):
                    x = cx + dx
                    if x < 0 or x >= W or dx * dx + dy * dy > lim:
                        continue
                    i = y * W + x
                    if tool == "draw":
                        place(i, t, replace)
                    elif tool == "erase":
                        clear_cell(i)
                        temp[i] = AMBIENT
                    elif tool == "heat":
                        temp[i] = min(TMAX, temp[i] + 40)
                    elif tool == "cool":
                        temp[i] = max(TMIN, temp[i] - 40)

        def set_cell(x, y, t):
            if x < 0 or y < 0 or x >= W or y >= H:
                return -1
            i = y * W + x
            if t == 0:
                clear_cell(i)
                temp[i] = AMBIENT
                return i
            spawn(i, t)
            if t == PLANT:
                aux[i] = 3
            return i

        def ignite_at(x, y):
            if 0 <= x < W and 0 <= y < H:
                ignite(y * W + x)

        self.step = step
        self.paint = paint
        self.set_cell = set_cell
        self.ignite = ignite_at

    def fill_rect(self, x0, y0, x1, y1, t):
        for y in range(max(0, y0), min(self.H - 1, y1) + 1):
            for x in range(max(0, x0), min(self.W - 1, x1) + 1):
                self.set_cell(x, y, t)
