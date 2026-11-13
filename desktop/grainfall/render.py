"""Grainfall renderer (port of js/render.js), vectorised with numpy.

Produces a Pillow image of the world: one pixel per cell, scaled up with crisp
nearest-neighbour pixels, plus a blurred, screen-blended glow layer for fire,
lava, sparks and anything glowing hot.
"""
import math

import numpy as np
from PIL import Image, ImageChops, ImageFilter

from .elements import ELEMENTS, GAS, ID

N = len(ELEMENTS)
SHADES = 16


def _hex(h):
    return int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)


def _hash(n):
    s = math.sin(n * 12.9898) * 43758.5453
    return s - math.floor(s)


def _shades(colors, salt):
    out = np.zeros((SHADES, 3), np.float32)
    for v in range(SHADES):
        r, g, b = _hex(colors[v % len(colors)])
        j = 0.9 + 0.2 * _hash(v * 7.13 + salt * 3.7)
        out[v] = (min(255, r * j), min(255, g * j), min(255, b * j))
    return out


def _gradient(n, stops, lo, hi):
    xs = np.linspace(lo, hi, n)
    pos = [s[0] for s in stops]
    return np.stack([np.interp(xs, pos, [s[1][c] for s in stops]) for c in range(3)], axis=1).astype(np.float32)


PAL = np.concatenate([_shades(e.color, e.id) for e in ELEMENTS])  # (N*16, 3)
ALPHA = np.ones(N, np.float32)
for _k, _a in (("glass", 0.45), ("steam", 0.62), ("methane", 0.28), ("water", 0.88), ("salt_water", 0.88)):
    ALPHA[ID[_k]] = _a
GLOWS = np.array([e.glow for e in ELEMENTS])
IS_GAS = np.array([e.state == GAS for e in ELEMENTS])

LEAF = _shades(("#5cbf4a", "#52b142", "#66c955", "#4fa83f"), 99)
FLOWER_CENTER = _shades(("#ffd23f", "#ffc72c", "#ffdc5a"), 77)
HUE = np.zeros((256, 3), np.float32)
for _k in range(256):
    _h = _k / 256 * 6
    _x = 1 - abs(_h % 2 - 1)
    _r, _g, _b = [(1, _x, 0), (_x, 1, 0), (0, 1, _x), (0, _x, 1), (_x, 0, 1), (1, 0, _x)][int(_h)]
    HUE[_k] = (70 + _r * 185, 70 + _g * 170, 90 + _b * 165)

FIRE_LUT = _gradient(64, [(0, (90, 12, 6)), (12, (190, 40, 10)), (28, (255, 110, 20)), (44, (255, 185, 55)), (63, (255, 240, 170))], 0, 63)
# Incandescence: what a hot solid or liquid looks like from 450 to 2450 degrees.
BB = _gradient(64, [(450, (90, 10, 5)), (650, (160, 25, 8)), (850, (215, 55, 10)), (1100, (255, 110, 20)),
                    (1400, (255, 170, 50)), (1800, (255, 220, 120)), (2450, (255, 250, 230))], 450, 2450)
# Thermal camera palette from -273 to 3000 degrees.
HEAT = _gradient(1024, [(-273, (230, 250, 255)), (-100, (90, 200, 255)), (-20, (40, 110, 230)), (20, (28, 36, 80)),
                        (80, (90, 40, 140)), (200, (180, 40, 120)), (450, (235, 60, 40)), (900, (255, 150, 20)),
                        (1600, (255, 235, 90)), (3000, (255, 255, 255))], -273, 3000)

SPARK_C = np.array((255, 248, 200), np.float32)
ELEC_C = np.array((255, 244, 170), np.float32)
ELEC_GLOW = np.array((255, 220, 120), np.float32)
LAMP_ON = np.array((255, 241, 190), np.float32)
LAMP_GLOW = np.array((255, 214, 140), np.float32)
FROST = np.array((210, 235, 255), np.float32)
BG_TOP = np.array((13, 16, 22), np.float32)
BG_BOTTOM = np.array((24, 27, 36), np.float32)

FIRE, SMOKE, STEAM, PLANT, FLOWER, LAMP, VIRUS, CLONE, SPARK = (
    ID[k] for k in ("fire", "smoke", "steam", "plant", "flower", "lamp", "virus", "clone", "spark")
)


def _mix(a, b, t):
    """Blend rows of a toward b by t (t broadcast per row)."""
    return a + (b - a) * np.asarray(t, np.float32)[..., None] if np.ndim(t) else a + (b - a) * t


def swatch_rgb(t):
    """Base colour of an element for palette swatches."""
    if t == PLANT:
        return tuple(int(v) for v in LEAF[0])
    if t == FIRE:
        return tuple(int(v) for v in FIRE_LUT[40])
    return tuple(int(v) for v in PAL[t * SHADES])


class Renderer:
    def __init__(self):
        self._bg_size = None

    def _background(self, W, H):
        if self._bg_size != (W, H):
            ys = np.linspace(0, 1, H, dtype=np.float32)[:, None]
            rows = BG_TOP + (BG_BOTTOM - BG_TOP) * ys
            self._bg = np.repeat(rows, W, axis=0)  # (W*H, 3)
            self._bg_size = (W, H)
        return self._bg

    def render(self, sim, heat_view=False, glow=True, size=None):
        """Return an RGB Pillow image of the world, scaled to `size`."""
        W, H = sim.W, sim.H
        bg = self._background(W, H)
        t = sim.type_np
        tp = sim.temp_np
        shade = sim.shade_np
        s = (shade & 15).astype(np.intp)
        ti = t.astype(np.intp)
        filled = t != 0

        if heat_view:
            k = np.clip(((tp + 273) * 0.31256).astype(np.intp), 0, 1023)
            heat = HEAT[k]
            c = np.where(filled[:, None], _mix(heat, PAL[ti * SHADES + s], 0.16), _mix(bg, heat, 0.45))
            g = None
        else:
            life = sim.life_np.astype(np.float32)
            aux = sim.aux_np
            c = PAL[ti * SHADES + s]
            g = np.zeros_like(c) if glow else None

            alpha = ALPHA[ti]
            m = filled & (alpha < 1)
            if m.any():
                c[m] = _mix(bg[m], c[m], alpha[m])

            m = t == FIRE
            if m.any():
                k = np.clip((life[m] * 1.5 + (shade[m] & 7)).astype(np.intp), 0, 63)
                c[m] = FIRE_LUT[k]
            m = t == SMOKE
            if m.any():
                c[m] = _mix(bg[m], c[m], np.minimum(1, life[m] / 140) * 0.8)
                if g is not None:
                    g[m] = c[m] * 0.3
            m = t == STEAM
            if m.any() and g is not None:
                g[m] = c[m] * 0.6
            m = (t == PLANT) & (aux == 3)
            if m.any():
                c[m] = LEAF[s[m]]
            m = t == FLOWER
            if m.any():
                a = aux[m].astype(np.intp)
                c[m] = np.where((a == 255)[:, None], FLOWER_CENTER[s[m]], HUE[(a + (s[m] >> 1)) & 255])
            m = t == LAMP
            if m.any():
                a = aux[m] / 255.0
                c[m] = _mix(c[m], LAMP_ON, a)
                if g is not None:
                    g[m] = LAMP_GLOW * np.where(a > 0.04, a, 0)[:, None]
            m = t == VIRUS
            if m.any():
                pulse = 0.18 + 0.12 * np.sin((sim.frame + shade[m]) * 0.15)
                c[m] = _mix(c[m], PAL[aux[m].astype(np.intp) * SHADES + s[m]], pulse)
            m = (t == CLONE) & (aux != 0)
            if m.any():
                c[m] = _mix(c[m], PAL[aux[m].astype(np.intp) * SHADES + s[m]], 0.4)
            m = t == SPARK
            if m.any():
                c[m] = SPARK_C

            m = (sim.flags_np & 1) != 0
            if m.any():
                f = FIRE_LUT[32 + ((shade[m].astype(np.intp) * 7 + sim.frame * 13) & 31)]
                c[m] = _mix(c[m], f, 0.6)
                if g is not None:
                    g[m] = f

            solid_ish = filled & ~IS_GAS[ti]
            m = solid_ish & (tp > 480)
            if m.any():
                tm = tp[m]
                bb = BB[np.clip(((tm - 450) * 0.0315).astype(np.intp), 0, 63)]
                a = np.where(tm > 1380, 0.92, (tm - 480) / 900 * 0.92)
                c[m] = _mix(c[m], bb, a)
                if g is not None:
                    gm = g[m]
                    hot = (tm > 650) & ~gm.any(axis=1)
                    gm[hot] = bb[hot] * np.minimum(1, (tm[hot] - 650) / 700)[:, None]
                    g[m] = gm
            m = solid_ish & (tp < -10)
            if m.any():
                c[m] = _mix(c[m], FROST, np.minimum(0.45, (-10 - tp[m]) / 250))

            m = sim.elec_np > 0
            if m.any():
                c[m] = _mix(c[m], ELEC_C, 0.75)
                if g is not None:
                    g[m] = ELEC_GLOW

            if g is not None:
                m = GLOWS[ti] & ~g.any(axis=1)
                g[m] = c[m]
                g[t == FIRE] = c[t == FIRE]
                g[t == SPARK] = SPARK_C

            c[~filled] = bg[~filled]
            if g is not None:
                g[~filled & ~(t == FIRE)] = 0

        # Flying debris from explosions.
        for p in sim.particles:
            x, y = int(p[0]), int(p[1])
            if 0 <= x < W and 0 <= y < H:
                c[y * W + x] = PAL[p[4] * SHADES + (x & 15)]

        img = Image.fromarray(np.clip(c, 0, 255).astype(np.uint8).reshape(H, W, 3), "RGB")
        out_size = size or (W, H)
        img = img.resize(out_size, Image.NEAREST)
        if g is not None and g.any():
            gimg = Image.fromarray(np.clip(g, 0, 255).astype(np.uint8).reshape(H, W, 3), "RGB")
            gimg = gimg.filter(ImageFilter.GaussianBlur(1.4)).resize(out_size, Image.BILINEAR)
            img = ImageChops.screen(img, gimg)
        return img
