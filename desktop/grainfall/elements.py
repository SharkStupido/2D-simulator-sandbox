"""Grainfall material definitions.

Every material in the world is one entry in ELEMENTS. The simulation turns
these into flat lookup tables, so adding a material is mostly a matter of
adding an entry here. This table matches js/elements.js in the browser version.

Temperatures are in degrees Celsius. Density is relative (air = 1): a moving
cell can only push into a fluid cell that is lighter than itself.
"""
from dataclasses import dataclass

INF = float("inf")

# Physical states
NONE, SOLID, POWDER, LIQUID, GAS = range(5)

CATEGORIES = [
    ("powders", "Powders"),
    ("liquids", "Liquids"),
    ("gases", "Gases"),
    ("solids", "Solids"),
    ("energy", "Energy"),
    ("life", "Life"),
    ("machines", "Machines"),
]


@dataclass
class E:
    """One material. See the browser version's js/elements.js for field notes."""

    key: str
    name: str
    state: int
    color: tuple
    cat: str = None
    density: float = 1
    conduct: float = 0.1  # thermal conductivity 0..1 (0 = insulator)
    temp: float = 20  # temperature when freshly placed
    relax: float = 0  # drift back toward room temperature per tick
    slide: float = 0  # powders: chance to slide off a pile
    disp: int = 0  # liquids: sideways flow per tick
    visc: float = 0  # liquids: chance to skip spreading (thickness)
    rise: float = 0.7  # gases: chance per tick to drift upward
    life: tuple = None  # (min, max) lifetime in ticks
    melt: tuple = None  # (temp, key[, alt_key, alt_chance]) above temp
    freeze: tuple = None  # (temp, key) below temp
    flammable: float = 0
    ignite: float = INF
    burn: tuple = None  # (min ticks, max ticks, flame temp, residue key, residue chance)
    explosive: tuple = None  # (radius, power)
    impact: bool = False
    conductor: bool = False
    hardness: float = 0
    indestructible: bool = False
    acid_proof: bool = False
    extinguish: bool = False
    glow: bool = False
    debris: str = None
    brush: float = None
    desc: str = ""
    id: int = 0


ELEMENTS = [
    E(key="empty", name="Air", state=NONE, conduct=0.005, relax=0.02, acid_proof=True, color=("#000000",)),
    E(key="sand", name="Sand", state=POWDER, cat="powders", density=160, conduct=0.15, slide=0.95, melt=(1300, "molten_glass"), hardness=0.1, desc="Pours and piles up. Melts into molten glass above 1300 °C.", color=("#e3c27d", "#d9b46a", "#cfa75d", "#e8cb8c")),
    E(key="dirt", name="Dirt", state=POWDER, cat="powders", density=150, conduct=0.12, slide=0.3, hardness=0.1, desc="Clumpy soil. Soaks up water into mud. Seeds sprout on it.", color=("#7a5534", "#6b4a2c", "#835c3a", "#5f4127")),
    E(key="gravel", name="Gravel", state=POWDER, cat="powders", density=210, conduct=0.25, slide=0.7, melt=(1150, "lava"), hardness=0.4, desc="Broken stone. Heavy and loose. Melts back into lava.", color=("#8d8a85", "#77746f", "#9c9993", "#6a6763")),
    E(key="salt", name="Salt", state=POWDER, cat="powders", density=130, conduct=0.2, slide=0.85, hardness=0.1, desc="Dissolves into salt water and melts ice and snow.", color=("#f2f0ea", "#e6e3dc", "#faf9f6", "#dcd8cf")),
    E(key="snow", name="Snow", state=POWDER, cat="powders", density=90, temp=-8, slide=0.25, melt=(2, "water"), hardness=0.05, extinguish=True, desc="Starts at −8 °C and settles in soft drifts. Melts above 2 °C.", color=("#f4f8fc", "#e8f0f8", "#ffffff", "#dde8f2")),
    E(key="coal", name="Coal", state=POWDER, cat="powders", density=170, conduct=0.15, slide=0.5, flammable=0.03, ignite=380, burn=(700, 1300, 1050, "ash", 0.6), hardness=0.3, desc="Hard to light, but burns for a long time at over 1000 °C.", color=("#2b2a2d", "#232225", "#353338", "#1d1c1f")),
    E(key="sawdust", name="Sawdust", state=POWDER, cat="powders", density=70, conduct=0.08, slide=0.6, flammable=0.5, ignite=220, burn=(30, 80, 650, "ash", 0.3), hardness=0.05, desc="Light wood shavings. Floats on water and catches fire easily.", color=("#d7b98a", "#c9a877", "#e0c597", "#bf9d6b")),
    E(key="ash", name="Ash", state=POWDER, cat="powders", density=60, conduct=0.08, slide=0.5, hardness=0.02, desc="What is left after a fire. Light enough to float.", color=("#9a958f", "#a8a39d", "#8b8681", "#b3aea8")),
    E(key="rust", name="Rust", state=POWDER, cat="powders", density=190, slide=0.45, hardness=0.1, desc="Flaky iron oxide. Metal slowly rusts in water, faster in salt water.", color=("#9c4a22", "#8a3f1c", "#ad5629", "#7c3618")),
    E(key="water", name="Water", state=LIQUID, cat="liquids", density=100, conduct=0.35, disp=5, melt=(100, "steam"), freeze=(0, "ice"), extinguish=True, desc="Boils at 100 °C and freezes at 0 °C. Puts out fires.", brush=0.5, color=("#2f6fd6", "#2a66c9", "#3478e0", "#2c6ad0")),
    E(key="salt_water", name="Salt Water", state=LIQUID, cat="liquids", density=110, conduct=0.38, disp=5, melt=(104, "steam", "salt", 0.3), freeze=(-6, "ice"), conductor=True, extinguish=True, desc="Conducts electricity. Boiling it leaves salt behind.", brush=0.5, color=("#3a86c8", "#3f8fd1", "#3580c0", "#3888c9")),
    E(key="oil", name="Oil", state=LIQUID, cat="liquids", density=80, conduct=0.12, disp=4, visc=0.15, flammable=0.4, ignite=240, burn=(80, 160, 800, "smoke", 0.3), desc="Floats on water and burns with heavy smoke.", brush=0.5, color=("#5a3d17", "#4e3413", "#65461c", "#553a16")),
    E(key="acid", name="Acid", state=LIQUID, cat="liquids", density=105, conduct=0.3, disp=4, acid_proof=True, desc="Eats through almost anything. Glass and wall resist it.", brush=0.5, color=("#8fe03a", "#7fd42e", "#9cea48", "#86da34")),
    E(key="lava", name="Lava", state=LIQUID, cat="liquids", density=250, temp=1600, disp=2, visc=0.55, freeze=(750, "stone"), hardness=0.3, glow=True, desc="Molten rock at 1600 °C. Hardens into stone, or obsidian in water.", brush=0.5, color=("#ff5a14", "#ff7a1e", "#f04a0c", "#ff8f2a")),
    E(key="mud", name="Mud", state=LIQUID, cat="liquids", density=150, conduct=0.25, disp=1, visc=0.75, melt=(100, "dirt"), desc="Wet dirt. Thick and slow. Dries back into dirt when heated.", brush=0.5, color=("#5c3f26", "#523822", "#664629", "#57391f")),
    E(key="nitro", name="Nitro", state=LIQUID, cat="liquids", density=120, conduct=0.2, disp=4, flammable=1, ignite=160, explosive=(7, 1.6), impact=True, desc="Unstable liquid explosive. Detonates from heat, sparks or a hard landing.", brush=0.5, color=("#d9e05a", "#cdd44e", "#e3ea6a", "#d3da54")),
    E(key="molten_glass", name="Molten Glass", state=LIQUID, cat="liquids", density=230, conduct=0.25, temp=1500, disp=1, visc=0.7, freeze=(1000, "glass"), glow=True, desc="Glowing, syrupy glass. Sets into solid glass below 1000 °C.", brush=0.5, color=("#ffb24a", "#ffa23a", "#ffc15c", "#ffaa44")),
    E(key="molten_metal", name="Molten Metal", state=LIQUID, cat="liquids", density=700, conduct=0.8, temp=1800, disp=2, visc=0.3, freeze=(1300, "metal"), conductor=True, glow=True, desc="Liquid metal at 1800 °C. Casts into solid metal as it cools.", brush=0.5, color=("#ffd27a", "#ffc562", "#ffe08f", "#ffcb6e")),
    E(key="steam", name="Steam", state=GAS, cat="gases", density=0.6, conduct=0.004, temp=110, relax=0.003, rise=0.8, freeze=(60, "water"), acid_proof=True, desc="Rises, cools and condenses back into water below 60 °C.", brush=0.3, color=("#e4ebf2", "#f0f4f8", "#d8e0ea")),
    E(key="smoke", name="Smoke", state=GAS, cat="gases", density=0.9, conduct=0.05, relax=0.01, rise=0.6, life=(120, 320), acid_proof=True, desc="Drifts upward and slowly fades away.", brush=0.3, color=("#5d5f66", "#6a6c73", "#53555c")),
    E(key="methane", name="Methane", state=GAS, cat="gases", density=0.5, conduct=0.05, rise=0.45, flammable=0.9, ignite=350, burn=(2, 6, 1100, "fire", 1), acid_proof=True, desc="Invisible-ish flammable gas. Ignites in a fast flash.", brush=0.3, color=("#a7d4a0", "#9fcf9a", "#b1dbaa")),
    E(key="wall", name="Wall", state=SOLID, cat="solids", density=10000, conduct=0, indestructible=True, acid_proof=True, desc="Indestructible and perfectly insulating.", color=("#4b4f5a", "#454953", "#525661")),
    E(key="stone", name="Stone", state=SOLID, cat="solids", density=10000, conduct=0.25, melt=(1150, "lava"), hardness=0.55, debris="gravel", desc="Solid rock. Melts into lava above 1150 °C.", color=("#7d7f86", "#71737a", "#888a91", "#686a71")),
    E(key="wood", name="Wood", state=SOLID, cat="solids", density=10000, flammable=0.04, ignite=300, burn=(250, 500, 700, "ash", 0.25), hardness=0.3, debris="sawdust", desc="Burns steadily and leaves ash.", color=("#8b5a2b", "#7f5226", "#966331", "#744b22")),
    E(key="metal", name="Metal", state=SOLID, cat="solids", density=10000, conduct=0.9, melt=(1500, "molten_metal"), conductor=True, hardness=0.85, desc="Conducts heat and electricity. Melts above 1500 °C.", color=("#a9b0b8", "#9ea5ad", "#b5bcc4", "#959ca4")),
    E(key="glass", name="Glass", state=SOLID, cat="solids", density=10000, conduct=0.2, melt=(1300, "molten_glass"), hardness=0.2, acid_proof=True, desc="Clear and acid-proof, but shatters in blasts.", color=("#bfe3ef", "#cdeaf3", "#b4dcea")),
    E(key="ice", name="Ice", state=SOLID, cat="solids", density=10000, conduct=0.4, temp=-15, melt=(2, "water"), hardness=0.25, extinguish=True, debris="snow", desc="Starts at −15 °C and chills what it touches. Melts above 2 °C.", color=("#a8d8f0", "#b8e0f4", "#9bd0ea")),
    E(key="obsidian", name="Obsidian", state=SOLID, cat="solids", density=10000, conduct=0.2, melt=(1300, "lava"), hardness=0.75, debris="gravel", desc="Volcanic glass, formed when lava meets water.", color=("#2a2238", "#241d31", "#30283f", "#352c47")),
    E(key="fire", name="Fire", state=GAS, cat="energy", density=0.2, conduct=0.5, temp=900, rise=0.8, life=(18, 42), acid_proof=True, glow=True, desc="Flickers upward, ignites anything flammable.", brush=0.35, color=("#ff9a2a",)),
    E(key="ember", name="Ember", state=POWDER, cat="energy", density=50, conduct=0.3, temp=850, slide=0.6, life=(40, 150), acid_proof=True, glow=True, desc="Glowing hot particle. Falls and sets things alight.", brush=0.2, color=("#ff8a2a", "#ff6a1a", "#ffae4a")),
    E(key="spark", name="Spark", state=GAS, cat="energy", density=0.2, conduct=0.3, temp=400, life=(3, 6), conductor=True, acid_proof=True, glow=True, desc="Electrifies metal and other conductors. Ignites flammables.", brush=0.4, color=("#fff6b0",)),
    E(key="battery", name="Battery", state=SOLID, cat="energy", density=10000, conduct=0.3, conductor=True, hardness=0.6, desc="Sends a steady pulse of electricity into touching conductors.", color=("#3b7d5a", "#357352", "#418763")),
    E(key="lamp", name="Lamp", state=SOLID, cat="energy", density=10000, conduct=0.3, conductor=True, hardness=0.3, desc="Lights up when electricity flows through it.", color=("#5e5a48", "#58543f", "#645f4c")),
    E(key="fuse", name="Fuse", state=SOLID, cat="energy", density=10000, flammable=0.9, ignite=150, burn=(24, 34, 600, None, 0), hardness=0.1, desc="Burns along its length at a steady pace. Great for TNT.", color=("#8f7b55", "#a38d63", "#857250")),
    E(key="gunpowder", name="Gunpowder", state=POWDER, cat="energy", density=140, conduct=0.12, slide=0.8, flammable=1, ignite=180, explosive=(3, 1.1), hardness=0.05, desc="Pours like sand. Each grain pops when lit.", color=("#4a4a50", "#3e3e44", "#56565c", "#606068")),
    E(key="tnt", name="TNT", state=SOLID, cat="energy", density=10000, conduct=0.12, flammable=1, ignite=250, explosive=(10, 1.5), hardness=0.3, desc="Big blast. Chains with other explosives.", color=("#c8352a", "#b82f25", "#d63d31")),
    E(key="seed", name="Seed", state=POWDER, cat="life", density=110, slide=0.5, flammable=0.3, ignite=250, burn=(10, 30, 500, "ash", 0.5), hardness=0.05, desc="Drop onto dirt or mud and it grows into a flowering plant.", brush=0.08, color=("#b58b3c", "#a37a30", "#c49a48")),
    E(key="plant", name="Plant", state=SOLID, cat="life", density=10000, conduct=0.15, flammable=0.25, ignite=260, burn=(30, 80, 550, "ash", 0.2), hardness=0.15, debris="sawdust", desc="Slowly grows into water it touches.", color=("#3d8a3a", "#357d33", "#449440")),
    E(key="flower", name="Flower", state=SOLID, density=10000, flammable=0.4, ignite=220, burn=(10, 30, 450, "ash", 0.2), hardness=0.05, desc="Petals at the top of a grown plant.", color=("#e86aa8",)),
    E(key="virus", name="Virus", state=SOLID, cat="life", density=10000, conduct=0.15, flammable=0.5, ignite=200, burn=(5, 15, 400, "smoke", 0.5), hardness=0.1, desc="Infects whatever it touches. Only fire and heat stop it.", brush=0.3, color=("#a13ec4", "#8f34b0", "#b44ad6")),
    E(key="clone", name="Clone", state=SOLID, cat="machines", density=10000, conduct=0, indestructible=True, acid_proof=True, desc="Copies the first material that touches it, forever.", color=("#c9c23a", "#bdb630", "#d3cc46")),
    E(key="void", name="Void", state=SOLID, cat="machines", density=10000, conduct=0, indestructible=True, acid_proof=True, desc="Deletes anything that touches it.", color=("#2b0f3a", "#260d33", "#311242")),
    E(key="heater", name="Heater", state=SOLID, cat="machines", density=10000, conduct=0.9, temp=900, hardness=0.9, acid_proof=True, desc="Holds itself at 900 °C.", color=("#b8412d", "#a83a28", "#c24a33")),
    E(key="cooler", name="Cooler", state=SOLID, cat="machines", density=10000, conduct=0.9, temp=-150, hardness=0.9, acid_proof=True, desc="Holds itself at −150 °C.", color=("#3a88c9", "#3480bf", "#4291d2")),
]

ID = {}
for _i, _el in enumerate(ELEMENTS):
    _el.id = _i
    if _el.brush is None:
        _el.brush = 0.4 if _el.state == POWDER else 1.0
    ID[_el.key] = _i
assert len(ELEMENTS) < 256


def ref(key):
    """Element id for a key; None (no element) maps to 0."""
    return 0 if key is None else ID[key]


# Validate references early so typos fail loudly.
for _el in ELEMENTS:
    for _k in (
        _el.melt and _el.melt[1],
        _el.melt and len(_el.melt) > 2 and _el.melt[2],
        _el.freeze and _el.freeze[1],
        _el.burn and _el.burn[3],
        _el.debris,
    ):
        if _k and _k not in ID:
            raise ValueError(f'Unknown element "{_k}" in {_el.key}')
