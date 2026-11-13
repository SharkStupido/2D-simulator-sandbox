"""Grainfall starter scenes (port of js/scenes.js).

Each builder fills the current world using proportional coordinates so it works
at any world size.
"""
import math

from .elements import ID

SAND, DIRT, STONE, WATER, COAL, GRAVEL, SEED, WOOD, PLANT = (
    ID[k] for k in ("sand", "dirt", "stone", "water", "coal", "gravel", "seed", "wood", "plant")
)
OBSIDIAN, LAVA, HEATER, CLONE, WALL, BATTERY, METAL, LAMP = (
    ID[k] for k in ("obsidian", "lava", "heater", "clone", "wall", "battery", "metal", "lamp")
)
GLASS, ACID, TNT, FUSE, SAWDUST = (ID[k] for k in ("glass", "acid", "tnt", "fuse", "sawdust"))

SCENES = [("landscape", "Meadow"), ("volcano", "Volcano"), ("workshop", "Workshop"), ("empty", "Empty")]


def jround(v):
    """Round half up, like JavaScript's Math.round."""
    return int(math.floor(v + 0.5))


def tree(sim, x, ground_y, height):
    rnd = sim.random.random
    for k in range(1, height + 1):
        sim.set_cell(x, ground_y - k, WOOD)
    cy = ground_y - height - 2
    r = max(3, jround(height * 0.5))
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy * 1.6 > r * r or rnd() < 0.15:
                continue
            i = sim.set_cell(x + dx, cy + dy, PLANT)
            if i >= 0:
                sim.aux[i] = 3


def landscape(sim):
    sim.clear()
    W, H = sim.W, sim.H
    rnd = sim.random.random
    p1, p2 = rnd() * 6.28, rnd() * 6.28
    base = H * 0.66
    lake_l, lake_r = W * 0.5, W * 0.84
    lake_c, lake_half = (lake_l + lake_r) / 2, (lake_r - lake_l) / 2
    ground = []
    for x in range(W):
        g = base + math.sin(x * (90 / W) * 0.25 + p1) * H * 0.07 + math.sin(x * (90 / W) * 0.8 + p2) * H * 0.02
        d = (x - lake_c) / lake_half
        if abs(d) < 1:
            g += (1 - d * d) * H * 0.17
        ground.append(jround(g))
    water_line = max(ground[math.floor(lake_l)], ground[min(W - 1, math.ceil(lake_r))]) + 2

    for x in range(W):
        gy = ground[x]
        near_lake = lake_l - W * 0.04 < x < lake_r + W * 0.04
        soil = 12 + jround(4 * math.sin(x * 0.11 + p2))
        for y in range(gy, H):
            depth = y - gy
            if depth < soil:
                t = SAND if near_lake and depth < 7 else DIRT
            else:
                t = STONE
            sim.set_cell(x, y, t)
        if lake_l - 2 < x < lake_r + 2:
            for y in range(water_line, gy):
                sim.set_cell(x, y, WATER)

    # Pockets of coal and gravel in the bedrock.
    for k in range(6):
        cx, cy = int(rnd() * W), int(H * 0.86 + rnd() * H * 0.12)
        r = 2 + int(rnd() * 3)
        t = COAL if k % 2 else GRAVEL
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                x, y = cx + dx, cy + dy
                if dx * dx + dy * dy <= r * r and 0 <= x < W and 0 <= y < H and sim.type[y * W + x] == STONE:
                    sim.set_cell(x, y, t)

    # Seeds on the dry land sprout into flowering plants within a few seconds.
    for k in range(max(4, jround(W / 28))):
        x = int(W * 0.05 + rnd() * W * 0.42)
        if k % 3 == 2:
            x = int(lake_r + W * 0.05 + rnd() * W * 0.1)
        if x >= W:
            continue
        gy = ground[x]
        if 0 <= gy < H and sim.type[gy * W + x] == DIRT:
            sim.set_cell(x, gy - 1, SEED)
    # One grown tree on the left hill.
    tx = int(W * 0.18)
    tree(sim, tx, ground[tx], max(6, jround(H * 0.07)))


def volcano(sim):
    sim.clear()
    W, H = sim.W, sim.H
    rnd = sim.random.random
    cx = jround(W * 0.38)
    base_y = jround(H * 0.84)
    peak_y = jround(H * 0.3)
    half_w = W * 0.3
    sea_x = jround(W * 0.7)
    ground = []
    for x in range(W):
        d = abs(x - cx) / half_w
        g = base_y
        if d < 1:
            g = base_y - (1 - d) ** 1.15 * (base_y - peak_y)
        if abs(x - cx) < W * 0.02:
            g += 2  # shallow crater
        if x > sea_x:
            g = base_y + min(H * 0.1, (x - sea_x) * 0.35)
        ground.append(jround(g + math.sin(x * 0.3) * 1.2))
    for x in range(W):
        gy = ground[x]
        for y in range(gy, H):
            depth = y - gy
            t = STONE
            if x > sea_x - W * 0.05 and depth < 6:
                t = SAND
            elif depth < 3 and abs(x - cx) > W * 0.06:
                t = DIRT
            elif rnd() < 0.04:
                t = OBSIDIAN
            sim.set_cell(x, y, t)
        if x > sea_x - 2:
            for y in range(base_y - 2, gy):
                sim.set_cell(x, y, WATER)
    # Magma chamber kept molten by heaters, and a crater that keeps erupting.
    ch_y, rx, ry = jround(H * 0.7), jround(W * 0.07), jround(H * 0.07)
    for dy in range(-ry, ry + 1):
        for dx in range(-rx, rx + 1):
            if (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1:
                sim.set_cell(cx + dx, ch_y + dy, LAVA)
    for dx in range(-rx + 2, rx - 1):
        sim.set_cell(cx + dx, ch_y + ry + 1, HEATER)
    crater_y = ground[cx]
    for dx in range(-2, 3):
        i = sim.set_cell(cx + dx, crater_y, CLONE)
        if i >= 0:
            sim.aux[i] = LAVA
    # A flow already on its way down the eastern slope toward the trees.
    for x in range(cx + 3, min(W, cx + jround(W * 0.12))):
        for k in range(1, 4):
            sim.set_cell(x, ground[x] - k, LAVA)
    # Forest on the slopes, in the path of the lava.
    for f in (0.14, 0.22, 0.55, 0.62):
        x = jround(W * f)
        tree(sim, x, ground[x], max(5, jround(H * 0.05)))


def workshop(sim):
    sim.clear()
    W, H = sim.W, sim.H

    def X(f):
        return jround(f * W)

    fill = sim.fill_rect
    fy = H - 4  # top of the floor
    fill(0, fy, W - 1, H - 1, WALL)

    # Circuit: battery feeding a wire with lamps hanging from it.
    bx, wire_y = X(0.05), fy - jround(H * 0.42)
    fill(bx - 2, fy - 4, bx + 2, fy - 1, BATTERY)
    fill(bx, wire_y, bx, fy - 5, METAL)
    fill(bx, wire_y, X(0.3), wire_y, METAL)
    for x in range(bx + 5, X(0.3) - 1, 6):
        fill(x, wire_y + 1, x, wire_y + 3, METAL)
        fill(x - 1, wire_y + 4, x + 1, wire_y + 5, LAMP)

    # Rain in a jar: a sealed glass tank with a heater under the middle.
    l, r, top = X(0.36), X(0.54), fy - jround(H * 0.5)
    third = jround((r - l) / 3)
    fill(l - 1, fy - 1, r + 1, fy - 1, GLASS)
    fill(l + third, fy - 1, r - third, fy - 1, HEATER)
    fill(l - 1, top, l - 1, fy - 1, GLASS)
    fill(r + 1, top, r + 1, fy - 1, GLASS)
    fill(l - 1, top, r + 1, top, GLASS)
    fill(l, fy - jround(H * 0.14), r, fy - 2, WATER)

    # Acid in a glass beaker, slowly eating a metal bar.
    al, ar, abot = X(0.58), X(0.64), fy - 1
    fill(al - 1, abot, ar + 1, abot, GLASS)
    fill(al - 1, abot - 9, al - 1, abot - 1, GLASS)
    fill(ar + 1, abot - 9, ar + 1, abot - 1, GLASS)
    fill(al, abot - 5, ar, abot - 1, ACID)
    mid = jround((al + ar) / 2)
    fill(mid - 1, abot - 16, mid + 1, abot - 6, METAL)

    # A dam on a raised plinth holding back a reservoir, with TNT at its foot
    # and a long fuse. Light the sawdust on top of the fuse post with fire.
    pl, py = X(0.69), fy - 6
    fill(pl, py, W - 1, fy - 1, WALL)
    dl = X(0.8)
    dr = dl + max(4, X(0.025))
    dam_top = py - jround(H * 0.4)
    fill(dl, dam_top, dr, py - 1, STONE)
    fill(dr + 1, dam_top + 4, W - 1, py - 1, WATER)
    fill(dl - 3, py - 7, dl + 1, py - 1, TNT)
    fx = pl + 2
    fill(fx, py - 1, dl - 4, py - 1, FUSE)
    fill(fx, py - 9, fx, py - 1, FUSE)
    fill(fx - 1, py - 10, fx + 1, py - 10, SAWDUST)


def build(key, sim):
    if key == "volcano":
        volcano(sim)
    elif key == "workshop":
        workshop(sim)
    elif key == "empty":
        sim.clear()
    else:
        landscape(sim)
