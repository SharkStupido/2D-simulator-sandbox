"""Headless tests for the Python simulation. Run from the desktop folder:

    python -m unittest discover tests
"""
import io
import os
import sys
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from grainfall import scenes  # noqa: E402
from grainfall.elements import ELEMENTS, ID  # noqa: E402
from grainfall.render import Renderer  # noqa: E402
from grainfall.sim import F_BURN, Simulation  # noqa: E402

E = type("E", (), {k.upper(): v for k, v in ID.items()})


def world(w, h, seed=12345):
    return Simulation(w, h, seed=seed)


def count(sim, t):
    return int((sim.type_np == t).sum())


def run(sim, n):
    for _ in range(n):
        sim.step()


def mean_y(sim, t):
    idx = (sim.type_np == t).nonzero()[0]
    return float((idx // sim.W).mean()) if idx.size else float("nan")


def at(sim, x, y):
    return sim.type[y * sim.W + x]


class Movement(unittest.TestCase):
    def test_sand_falls_to_the_floor(self):
        s = world(20, 30)
        s.set_cell(10, 0, E.SAND)
        run(s, 60)
        self.assertEqual(at(s, 10, 29), E.SAND)
        self.assertEqual(count(s, E.SAND), 1)

    def test_sand_piles_into_a_slope(self):
        s = world(60, 40)
        for _ in range(300):
            s.set_cell(30, 0, E.SAND)
            run(s, 2)
        run(s, 200)
        xs = [x for x in range(60) if at(s, x, 39) == E.SAND]
        self.assertGreater(max(xs) - min(xs), 15)
        self.assertEqual(count(s, E.SAND), 300)

    def test_water_spreads_out_flat(self):
        s = world(60, 20)
        s.fill_rect(0, 5, 9, 19, E.WATER)
        run(s, 600)
        self.assertEqual(count(s, E.WATER), 150)
        for y in (18, 19):
            for x in range(60):
                self.assertEqual(at(s, x, y), E.WATER, f"gap at {x},{y}")

    def test_oil_floats_on_water(self):
        s = world(20, 30)
        s.fill_rect(0, 20, 19, 29, E.OIL)
        s.fill_rect(0, 10, 19, 19, E.WATER)
        run(s, 800)
        self.assertLess(mean_y(s, E.OIL), mean_y(s, E.WATER) - 5)

    def test_steam_rises(self):
        s = world(20, 40)
        s.fill_rect(8, 35, 11, 38, E.STEAM)
        run(s, 30)
        self.assertLess(mean_y(s, E.STEAM), 30)

    def test_falling_lava_never_freezes_in_mid_air(self):
        s = world(40, 120)
        for _ in range(40):
            s.paint(20, 3, 4, "draw", E.LAVA)
            run(s, 3)
        run(s, 600)
        top = s.type_np[: 40 * 60]
        self.assertFalse(((top == E.STONE) | (top == E.GRAVEL)).any())


class Heat(unittest.TestCase):
    def test_heater_boils_water(self):
        s = world(30, 30)
        s.fill_rect(0, 29, 29, 29, E.HEATER)
        s.fill_rect(0, 20, 29, 28, E.WATER)
        run(s, 600)
        self.assertGreater(count(s, E.STEAM), 10)

    def test_cooler_freezes_water(self):
        s = world(20, 20)
        s.fill_rect(0, 19, 19, 19, E.COOLER)
        s.fill_rect(0, 14, 19, 18, E.WATER)
        run(s, 800)
        self.assertGreater(count(s, E.ICE), 20)

    def test_heat_tool_melts_sand_into_glass(self):
        s = world(20, 20)
        s.fill_rect(0, 15, 19, 19, E.SAND)
        for _ in range(60):
            s.paint(10, 17, 3, "heat")
            s.step()
        self.assertGreater(count(s, E.MOLTEN_GLASS), 0)
        run(s, 4000)
        self.assertGreater(count(s, E.GLASS), 0)

    def test_lava_meets_water(self):
        s = world(30, 30)
        s.fill_rect(0, 20, 29, 29, E.WATER)
        s.fill_rect(10, 5, 19, 10, E.LAVA)
        run(s, 300)
        self.assertGreater(count(s, E.OBSIDIAN) + count(s, E.STONE), 5)


class Fire(unittest.TestCase):
    def test_fire_burns_wood_to_ash(self):
        s = world(30, 30)
        s.fill_rect(10, 20, 19, 29, E.WOOD)
        s.ignite(15, 20)
        run(s, 3000)
        self.assertLess(count(s, E.WOOD), 50)
        self.assertGreater(count(s, E.ASH), 0)

    def test_water_puts_out_burning_wood(self):
        s = world(30, 30)
        s.fill_rect(0, 29, 29, 29, E.WALL)
        s.fill_rect(5, 26, 24, 28, E.WOOD)
        for x in range(5, 25):
            s.ignite(x, 26)
        run(s, 10)
        s.fill_rect(0, 5, 29, 20, E.WATER)
        run(s, 600)
        self.assertEqual(int((s.flags_np & F_BURN).sum()), 0)
        self.assertGreater(count(s, E.WOOD), 40)

    def test_long_fuse_reaches_tnt(self):
        for seed in (1, 7, 42):
            s = world(220, 30, seed)
            s.fill_rect(0, 29, 219, 29, E.WALL)
            s.fill_rect(205, 22, 214, 28, E.TNT)
            s.fill_rect(5, 28, 204, 28, E.FUSE)
            s.ignite(5, 28)
            run(s, 2500)
            self.assertEqual(count(s, E.TNT), 0, f"fuse fizzled with seed {seed}")

    def test_tnt_blasts_a_crater(self):
        s = world(60, 60)
        s.fill_rect(0, 20, 59, 59, E.STONE)
        s.fill_rect(28, 38, 31, 41, E.TNT)
        before = count(s, E.STONE)
        s.ignite(29, 39)
        run(s, 120)
        self.assertEqual(count(s, E.TNT), 0)
        self.assertLess(count(s, E.STONE), before - 100)


class Electricity(unittest.TestCase):
    def test_battery_lights_a_lamp(self):
        s = world(40, 20)
        s.set_cell(2, 10, E.BATTERY)
        s.fill_rect(3, 10, 30, 10, E.METAL)
        s.set_cell(31, 10, E.LAMP)
        lit = 0
        for _ in range(120):
            s.step()
            lit = max(lit, s.aux[10 * 40 + 31])
        self.assertGreater(lit, 200)

    def test_salt_water_conducts(self):
        s = world(40, 10)
        s.fill_rect(0, 9, 39, 9, E.WALL)
        s.fill_rect(1, 8, 38, 8, E.SALT_WATER)
        s.paint(1, 8, 1, "draw", E.SPARK)
        reached = False
        for _ in range(60):
            s.step()
            reached = reached or s.elec[8 * 40 + 30] > 0
        self.assertTrue(reached)


class LifeAndMachines(unittest.TestCase):
    def test_seed_grows_and_flowers(self):
        s = world(40, 60)
        s.fill_rect(0, 50, 39, 59, E.DIRT)
        s.set_cell(20, 49, E.SEED)
        run(s, 3000)
        self.assertGreater(count(s, E.PLANT), 10)
        self.assertGreater(count(s, E.FLOWER), 0)

    def test_acid_eats_stone_not_glass(self):
        s = world(30, 30)
        s.fill_rect(0, 25, 14, 29, E.STONE)
        s.fill_rect(15, 25, 29, 29, E.GLASS)
        s.fill_rect(0, 15, 29, 22, E.ACID)
        run(s, 800)
        self.assertLess(count(s, E.STONE), 75 * 0.7)
        self.assertEqual(count(s, E.GLASS), 75)

    def test_clone_and_void(self):
        s = world(30, 40)
        s.fill_rect(10, 10, 19, 10, E.CLONE)
        s.fill_rect(12, 5, 17, 7, E.WATER)
        s.fill_rect(0, 39, 29, 39, E.VOID)
        run(s, 400)
        self.assertGreater(count(s, E.WATER), 0)
        self.assertGreater(count(s, E.CLONE), 0)
        self.assertNotEqual(s.aux[10 * 30 + 12], 0, "clone picked up water")

    def test_virus_spreads(self):
        s = world(40, 40)
        s.fill_rect(0, 20, 39, 39, E.SAND)
        s.paint(20, 20, 2, "draw", E.VIRUS, True)
        run(s, 300)
        self.assertGreater(count(s, E.VIRUS), 20)


class WorldAndTools(unittest.TestCase):
    def test_save_and_load_round_trip(self):
        s = world(50, 40)
        scenes.build("landscape", s)
        run(s, 50)
        types = s.type_np.copy()
        buf = io.BytesIO()
        s.save(buf)
        s.clear()
        buf.seek(0)
        self.assertTrue(s.load(buf))
        self.assertTrue((s.type_np == types).all())
        self.assertFalse(s.load(io.BytesIO(b"not a world")))

    def test_every_scene_builds_runs_and_renders(self):
        r = Renderer()
        for key, _ in scenes.SCENES:
            s = world(160, 95)
            scenes.build(key, s)
            run(s, 100)
            if key != "empty":
                self.assertGreater(s.count_cells(), 1000, key)
            img = r.render(s, size=(640, 380))
            self.assertEqual(img.size, (640, 380))
            r.render(s, heat_view=True)

    def test_every_element_can_be_placed_and_simulated(self):
        s = world(60, 60)
        for el in ELEMENTS[1:]:
            s.clear()
            s.fill_rect(0, 59, 59, 59, E.STONE)
            s.paint(30, 30, 6, "draw", el.id, True)
            run(s, 40)

    def test_performance(self):
        s = world(240, 140)
        scenes.build("landscape", s)
        run(s, 20)
        t0 = time.perf_counter()
        run(s, 40)
        ms = (time.perf_counter() - t0) / 40 * 1000
        print(f"\n    {ms:.1f} ms per tick at 240x140")
        self.assertLess(ms, 60)


if __name__ == "__main__":
    unittest.main()
