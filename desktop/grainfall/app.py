"""Grainfall desktop app: a tkinter window around the simulation."""
import math
import time
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from PIL import Image, ImageDraw, ImageTk

from . import scenes
from .elements import CATEGORIES, ELEMENTS, ID
from .render import Renderer, swatch_rgb
from .sim import Simulation

# Palette: basalt background, bone text, ochre-sand accent (matches the web version).
C = {
    "bg": "#0b0d12",
    "panel": "#141821",
    "panel2": "#1b202b",
    "line": "#2a3140",
    "fg": "#ece5d8",
    "muted": "#8f97a7",
    "accent": "#e3b25a",
    "accent_soft": "#3a3122",
    "accent_ink": "#1d1505",
    "danger": "#e2674f",
}
GRAINS = {"Fine": (300, 170), "Normal": (240, 140), "Coarse": (160, 95)}
SPEEDS = [(0.5, "½×"), (1, "1×"), (2, "2×"), (4, "4×")]
TOOLS = [("draw", "Draw"), ("erase", "Erase"), ("heat", "Heat"), ("cool", "Cool"), ("pick", "Pick")]
TICKS_PER_SECOND = 60
FILE_TYPES = [("Grainfall world", "*.grainfall"), ("All files", "*.*")]

HELP_TEXT = """Drawing
  Left-drag           Pour the selected material
  Right-drag          Erase
  Middle-click        Pick the material under the cursor
  Mouse wheel, [ ]    Brush size
  R                   Replace mode: paint over what is there

Keys
  Space               Pause or resume
  .                   Advance one tick
  D E H C P           Draw, erase, heat, cool, pick
  T                   Thermal camera
  G                   Glow
  Ctrl+S / Ctrl+O     Save / open a world file

Try this
  • Pour lava into water to make obsidian.
  • Melt sand with the Heat tool, then let it set into glass.
  • Connect a battery to lamps with a metal wire.
  • Lay a fuse to some TNT and light it with fire.
  • Drop seeds on dirt and watch them flower.
  • Touch a clone block with water to make a spring."""


def make_icon_image(size=64):
    """The app icon: a little pile of sand grains with a spark, drawn in code."""
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, 15, 15), radius=3, fill=(20, 24, 33, 255))
    sand = [(227, 194, 125), (217, 180, 106), (207, 167, 93), (232, 203, 140)]
    rows = [(7, 8), (5, 10), (4, 11), (3, 12)]
    for k, (a, b) in enumerate(rows):
        for x in range(a, b + 1):
            d.point((x, 9 + k), fill=sand[(x + k) % 4] + (255,))
    d.point((8, 5), fill=(255, 143, 42, 255))
    d.point((9, 6), fill=(255, 200, 90, 255))
    return img.resize((size, size), Image.NEAREST)


def fmt_temp(t):
    v = round(t)
    return ("−" + str(abs(v)) if v < 0 else str(v)) + " °C"


class App:
    def __init__(self, root):
        self.root = root
        root.title("Grainfall")
        root.configure(bg=C["bg"])
        root.geometry("1220x840")
        root.minsize(1060, 640)
        self._icon = ImageTk.PhotoImage(make_icon_image(64))
        root.iconphoto(True, self._icon)
        self._style()

        self.sim = Simulation(*GRAINS["Normal"])
        self.renderer = Renderer()
        self.scene = tk.StringVar(value="Meadow")
        self.grain = tk.StringVar(value="Normal")
        self.tool = tk.StringVar(value="draw")
        self.brush = tk.IntVar(value=4)
        self.replace = tk.BooleanVar(value=False)
        self.heat_view = tk.BooleanVar(value=False)
        self.glow = tk.BooleanVar(value=True)
        self.element = ID["sand"]
        self.paused = False
        self.step_once = False
        self.speed_idx = 1

        self.mouse_inside = False
        self.mouse_down = False
        self.mouse_button = 1
        self.cell = (0, 0)
        self.last_cell = (0, 0)
        self.view = (0, 0, 1.0)  # x offset, y offset, scale
        self.photo = None
        self.photo_size = None
        self.el_buttons = {}

        self._build()
        self._bind()
        scenes.build("landscape", self.sim)

        self.acc = 0.0
        self.last = time.perf_counter()
        self.fps_time = self.last
        self.fps_frames = 0
        self.frame_no = 0
        self.root.after(30, self._tick)

    # ------------------------------------------------------------- styling
    def _style(self):
        s = ttk.Style(self.root)
        s.theme_use("clam")
        base = ("Segoe UI", 10)
        s.configure(".", background=C["bg"], foreground=C["fg"], fieldbackground=C["panel"], bordercolor=C["line"],
                    lightcolor=C["panel"], darkcolor=C["panel"], troughcolor=C["panel"], font=base, focuscolor=C["accent"])
        s.configure("TFrame", background=C["bg"])
        s.configure("Panel.TFrame", background=C["panel"])
        s.configure("TLabel", background=C["bg"], foreground=C["fg"])
        s.configure("Muted.TLabel", foreground=C["muted"])
        s.configure("Title.TLabel", font=("Segoe UI Semibold", 16), foreground=C["fg"])
        s.configure("Mono.TLabel", font=("Consolas", 10), foreground=C["muted"])
        s.configure("Readout.TLabel", font=("Consolas", 10), foreground=C["fg"])
        s.configure("TButton", background=C["panel"], foreground=C["fg"], padding=(10, 4), relief="flat", width=-4)
        s.map("TButton", background=[("active", C["panel2"]), ("pressed", C["panel2"])])
        s.configure("Danger.TButton", foreground=C["danger"])
        for name in ("Toolbutton", "TCheckbutton", "TRadiobutton"):
            s.configure(name, background=C["panel"], foreground=C["muted"], padding=(10, 4), relief="flat",
                        indicatorbackground=C["panel"], indicatorforeground=C["accent"])
        s.map("Toolbutton", background=[("selected", C["accent"]), ("active", C["panel2"])],
              foreground=[("selected", C["accent_ink"]), ("active", C["fg"])])
        s.configure("TCombobox", fieldbackground=C["panel"], background=C["panel"], foreground=C["fg"],
                    arrowcolor=C["fg"], padding=4)
        s.map("TCombobox", fieldbackground=[("readonly", C["panel"])], foreground=[("readonly", C["fg"])],
              selectbackground=[("readonly", C["panel"])], selectforeground=[("readonly", C["fg"])])
        self.root.option_add("*TCombobox*Listbox.background", C["panel"])
        self.root.option_add("*TCombobox*Listbox.foreground", C["fg"])
        self.root.option_add("*TCombobox*Listbox.selectBackground", C["accent"])
        self.root.option_add("*TCombobox*Listbox.selectForeground", C["accent_ink"])
        s.configure("TNotebook", background=C["bg"], borderwidth=0, tabmargins=0)
        s.configure("TNotebook.Tab", background=C["bg"], foreground=C["muted"], padding=(14, 6), borderwidth=0)
        s.map("TNotebook.Tab", background=[("selected", C["panel"])], foreground=[("selected", C["accent"])])
        s.configure("Horizontal.TScale", background=C["accent"], troughcolor=C["panel2"], bordercolor=C["panel2"],
                    lightcolor=C["accent"], darkcolor=C["accent"], gripcount=0, sliderlength=14, sliderthickness=14)

    # -------------------------------------------------------------- layout
    def _build(self):
        root = self.root
        outer = ttk.Frame(root, padding=(16, 10))
        outer.pack(fill="both", expand=True)

        # Top bar
        bar = ttk.Frame(outer)
        bar.pack(fill="x")
        self._logo = ImageTk.PhotoImage(make_icon_image(28))
        ttk.Label(bar, image=self._logo).pack(side="left", padx=(0, 8))
        ttk.Label(bar, text="Grainfall", style="Title.TLabel").pack(side="left", padx=(0, 18))

        self.pause_btn = ttk.Button(bar, text="Pause", width=8, command=self.toggle_pause)
        self.pause_btn.pack(side="left", padx=2)
        ttk.Button(bar, text="Step", command=self.step).pack(side="left", padx=2)
        self.speed_btn = ttk.Button(bar, text="1×", width=4, command=self.cycle_speed)
        self.speed_btn.pack(side="left", padx=(2, 14))

        ttk.Checkbutton(bar, text="Thermal", style="Toolbutton", variable=self.heat_view).pack(side="left", padx=2)
        ttk.Checkbutton(bar, text="Glow", style="Toolbutton", variable=self.glow).pack(side="left", padx=(2, 14))

        ttk.Label(bar, text="Scene", style="Muted.TLabel").pack(side="left", padx=(0, 4))
        scene_box = ttk.Combobox(bar, textvariable=self.scene, values=[n for _, n in scenes.SCENES], width=10, state="readonly")
        scene_box.pack(side="left", padx=(0, 10))
        scene_box.bind("<<ComboboxSelected>>", lambda e: self.load_scene())
        ttk.Label(bar, text="Grain", style="Muted.TLabel").pack(side="left", padx=(0, 4))
        grain_box = ttk.Combobox(bar, textvariable=self.grain, values=list(GRAINS), width=8, state="readonly")
        grain_box.pack(side="left", padx=(0, 14))
        grain_box.bind("<<ComboboxSelected>>", lambda e: self.change_grain())

        ttk.Button(bar, text="Help", command=self.show_help).pack(side="right", padx=2)
        ttk.Button(bar, text="Clear", style="Danger.TButton", command=self.clear).pack(side="right", padx=2)
        ttk.Button(bar, text="Open…", command=self.open_file).pack(side="right", padx=2)
        ttk.Button(bar, text="Save…", command=self.save_file).pack(side="right", padx=2)

        # World canvas
        self.canvas = tk.Canvas(outer, bg=C["bg"], highlightthickness=0, bd=0)
        self.canvas.pack(fill="both", expand=True, pady=(10, 8))
        try:
            self.canvas.configure(cursor="none")
        except tk.TclError:
            self.canvas.configure(cursor="crosshair")
        self.img_id = self.canvas.create_image(0, 0, anchor="nw")
        self.frame_id = self.canvas.create_rectangle(0, 0, 0, 0, outline=C["line"])
        self.cursor_id = self.canvas.create_oval(0, 0, 0, 0, outline=C["fg"], width=1.5, state="hidden")
        self.hint_id = self.canvas.create_text(0, 0, anchor="nw", fill=C["fg"], font=("Consolas", 10),
                                               text="Pick a material below and drag to pour")

        # Tools row
        tools = ttk.Frame(outer)
        tools.pack(fill="x")
        for key, label in TOOLS:
            ttk.Radiobutton(tools, text=label, value=key, variable=self.tool, style="Toolbutton").pack(side="left", padx=1)
        ttk.Label(tools, text="Brush", style="Muted.TLabel").pack(side="left", padx=(18, 6))
        ttk.Scale(tools, from_=1, to=30, orient="horizontal", length=140, variable=self.brush,
                  command=lambda v: self.brush.set(round(float(v)))).pack(side="left")
        self.brush_lbl = ttk.Label(tools, textvariable=self.brush, width=3, style="Readout.TLabel")
        self.brush_lbl.pack(side="left", padx=(6, 12))
        ttk.Checkbutton(tools, text="Replace", style="Toolbutton", variable=self.replace).pack(side="left")
        self.sel_swatch = tk.Label(tools, width=2, bg=C["accent"], bd=0)
        self.sel_swatch.pack(side="left", padx=(18, 6))
        self.sel_name = ttk.Label(tools, text="", font=("Segoe UI Semibold", 10))
        self.sel_name.pack(side="left")
        self.sel_desc = ttk.Label(tools, text="", style="Muted.TLabel")
        self.sel_desc.pack(side="left", padx=(8, 0))

        # Material palette, one tab per category
        self.tabs = ttk.Notebook(outer)
        self.tabs.pack(fill="x", pady=(8, 0))
        self._swatches = []
        for cat, cat_name in CATEGORIES:
            page = tk.Frame(self.tabs, bg=C["panel"], padx=6, pady=6)
            self.tabs.add(page, text=cat_name)
            col = 0
            for el in ELEMENTS:
                if el.cat != cat:
                    continue
                sw = ImageTk.PhotoImage(Image.new("RGB", (16, 16), swatch_rgb(el.id)))
                self._swatches.append(sw)
                b = tk.Button(page, text=" " + el.name, image=sw, compound="left", anchor="w",
                              bg=C["panel"], fg=C["fg"], activebackground=C["panel2"], activeforeground=C["fg"],
                              relief="flat", bd=0, padx=8, pady=4, highlightthickness=1,
                              highlightbackground=C["panel"], highlightcolor=C["accent"], font=("Segoe UI", 10),
                              cursor="hand2", command=lambda i=el.id: self.select_element(i))
                b.grid(row=0, column=col, padx=3, pady=2, sticky="w")
                self.el_buttons[el.id] = b
                col += 1

        # Status bar
        status = ttk.Frame(outer)
        status.pack(fill="x", pady=(8, 0))
        self.readout = ttk.Label(status, text="", style="Readout.TLabel")
        self.readout.pack(side="left")
        self.stats = ttk.Label(status, text="", style="Mono.TLabel")
        self.stats.pack(side="right")

        self.select_element(self.element)

    def _bind(self):
        cv = self.canvas
        cv.bind("<Configure>", lambda e: self._fit())
        cv.bind("<Motion>", self._on_move)
        cv.bind("<Leave>", self._on_leave)
        cv.bind("<Enter>", lambda e: setattr(self, "mouse_inside", True))
        for btn in (1, 2, 3):
            cv.bind(f"<ButtonPress-{btn}>", lambda e, b=btn: self._on_press(e, b))
            cv.bind(f"<B{btn}-Motion>", self._on_move)
            cv.bind(f"<ButtonRelease-{btn}>", self._on_release)
        cv.bind("<MouseWheel>", lambda e: self.set_brush(self.brush.get() + (1 if e.delta > 0 else -1)))
        cv.bind("<Button-4>", lambda e: self.set_brush(self.brush.get() + 1))  # Linux wheel
        cv.bind("<Button-5>", lambda e: self.set_brush(self.brush.get() - 1))

        r = self.root
        r.bind("<KeyPress>", self._on_key)
        r.bind("<Control-s>", lambda e: self.save_file())
        r.bind("<Control-o>", lambda e: self.open_file())
        r.bind("<F1>", lambda e: self.show_help())
        r.protocol("WM_DELETE_WINDOW", r.destroy)

    # ------------------------------------------------------------- actions
    def select_element(self, el_id, switch_tab=False):
        el = ELEMENTS[el_id]
        if el_id == 0 or el.cat is None:
            return
        self.element = el_id
        for i, b in self.el_buttons.items():
            sel = i == el_id
            b.configure(bg=C["accent_soft"] if sel else C["panel"],
                        highlightbackground=C["accent"] if sel else C["panel"])
        if switch_tab:
            cats = [c for c, _ in CATEGORIES]
            self.tabs.select(cats.index(el.cat))
        self.sel_swatch.configure(bg="#%02x%02x%02x" % swatch_rgb(el_id))
        self.sel_name.configure(text=el.name)
        self.sel_desc.configure(text=el.desc)
        self.tool.set("draw")

    def set_brush(self, n):
        self.brush.set(max(1, min(30, int(n))))
        self._update_cursor()

    def toggle_pause(self):
        self.paused = not self.paused
        self.pause_btn.configure(text="Resume" if self.paused else "Pause")

    def step(self):
        if not self.paused:
            self.toggle_pause()
        self.step_once = True

    def cycle_speed(self):
        self.speed_idx = (self.speed_idx + 1) % len(SPEEDS)
        self.speed_btn.configure(text=SPEEDS[self.speed_idx][1])

    def _scene_key(self):
        return next(k for k, n in scenes.SCENES if n == self.scene.get())

    def load_scene(self):
        scenes.build(self._scene_key(), self.sim)

    def change_grain(self):
        self.sim.init(*GRAINS[self.grain.get()])
        self.load_scene()
        self._fit()

    def clear(self):
        if messagebox.askyesno("Clear the world?", "This removes everything in the world.", parent=self.root):
            self.sim.clear()

    def save_file(self):
        path = filedialog.asksaveasfilename(parent=self.root, title="Save world", defaultextension=".grainfall",
                                            filetypes=FILE_TYPES, initialfile="world.grainfall")
        if not path:
            return
        try:
            with open(path, "wb") as f:
                self.sim.save(f)
        except OSError as err:
            messagebox.showerror("Could not save", f"The world could not be saved:\n{err}", parent=self.root)

    def open_file(self):
        path = filedialog.askopenfilename(parent=self.root, title="Open world", filetypes=FILE_TYPES)
        if not path:
            return
        try:
            with open(path, "rb") as f:
                ok = self.sim.load(f)
        except OSError as err:
            messagebox.showerror("Could not open", f"The file could not be read:\n{err}", parent=self.root)
            return
        if not ok:
            messagebox.showerror("Could not open", "That file is not a Grainfall world.", parent=self.root)
        self._fit()

    def show_help(self):
        win = tk.Toplevel(self.root, bg=C["panel"], padx=22, pady=18)
        win.title("How to play")
        win.transient(self.root)
        win.resizable(False, False)
        tk.Label(win, text="How to play", bg=C["panel"], fg=C["accent"], font=("Segoe UI Semibold", 14)).pack(anchor="w")
        tk.Label(win, text=HELP_TEXT, bg=C["panel"], fg=C["fg"], justify="left", font=("Consolas", 10)).pack(anchor="w", pady=(10, 12))
        ttk.Button(win, text="Close", command=win.destroy).pack(anchor="e")
        win.bind("<Escape>", lambda e: win.destroy())
        win.focus_set()

    # --------------------------------------------------------------- input
    def _fit(self):
        cw, ch = max(1, self.canvas.winfo_width()), max(1, self.canvas.winfo_height())
        scale = min(cw / self.sim.W, ch / self.sim.H)
        w, h = int(self.sim.W * scale), int(self.sim.H * scale)
        ox, oy = (cw - w) // 2, (ch - h) // 2
        self.view = (ox, oy, scale)
        self.canvas.coords(self.img_id, ox, oy)
        self.canvas.coords(self.frame_id, ox - 1, oy - 1, ox + w, oy + h)
        self.canvas.coords(self.hint_id, ox + 10, oy + 10)
        self._update_cursor()

    def _to_cell(self, ex, ey):
        ox, oy, s = self.view
        return int((ex - ox) / s), int((ey - oy) / s)

    def _on_move(self, e):
        self.mouse_inside = True
        self.cell = self._to_cell(e.x, e.y)
        self._update_cursor()

    def _on_leave(self, e):
        if not self.mouse_down:
            self.mouse_inside = False
            self.canvas.itemconfigure(self.cursor_id, state="hidden")

    def _on_press(self, e, button):
        self.canvas.focus_set()
        self.canvas.itemconfigure(self.hint_id, state="hidden")
        self.cell = self.last_cell = self._to_cell(e.x, e.y)
        if button == 2 or (button == 1 and self.tool.get() == "pick"):
            self._pick(*self.cell)
            return
        self.mouse_down = True
        self.mouse_button = button
        self._stroke()

    def _on_release(self, e):
        self.mouse_down = False

    def _pick(self, x, y):
        c = self.sim.cell_at(x, y)
        if not c or c["type"] == 0:
            return
        t = c["type"]
        if t == ID["flower"]:
            t = ID["plant"]
        if ELEMENTS[t].cat:
            self.select_element(t, switch_tab=True)

    def _stroke(self):
        tool = "erase" if self.mouse_button == 3 else self.tool.get()
        if tool == "pick":
            return
        (x0, y0), (x1, y1) = self.last_cell, self.cell
        r = self.brush.get()
        dist = max(abs(x1 - x0), abs(y1 - y0))
        steps = max(1, math.ceil(dist / max(1, r * 0.5)))
        for k in range(1, steps + 1):
            f = k / steps
            self.sim.paint(round(x0 + (x1 - x0) * f), round(y0 + (y1 - y0) * f), r, tool, self.element, self.replace.get())
        self.last_cell = self.cell

    def _update_cursor(self):
        if not self.mouse_inside:
            return
        ox, oy, s = self.view
        d = 1 if self.tool.get() == "pick" else (self.brush.get() - 1) * 2 + 1
        size = max(6, d * s)
        cx, cy = ox + (self.cell[0] + 0.5) * s, oy + (self.cell[1] + 0.5) * s
        tool = "erase" if self.mouse_down and self.mouse_button == 3 else self.tool.get()
        color = {"erase": C["danger"], "heat": "#ff963c", "cool": "#78c8ff"}.get(tool, C["fg"])
        self.canvas.coords(self.cursor_id, cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2)
        self.canvas.itemconfigure(self.cursor_id, state="normal", outline=color)
        self.canvas.tag_raise(self.cursor_id)

    def _on_key(self, e):
        if isinstance(self.root.focus_get(), ttk.Combobox):
            return
        k = e.keysym.lower()
        actions = {
            "space": self.toggle_pause,
            "period": self.step,
            "bracketleft": lambda: self.set_brush(self.brush.get() - 1),
            "bracketright": lambda: self.set_brush(self.brush.get() + 1),
            "d": lambda: self.tool.set("draw"),
            "b": lambda: self.tool.set("draw"),
            "e": lambda: self.tool.set("erase"),
            "h": lambda: self.tool.set("heat"),
            "c": lambda: self.tool.set("cool"),
            "p": lambda: self.tool.set("pick"),
            "r": lambda: self.replace.set(not self.replace.get()),
            "t": lambda: self.heat_view.set(not self.heat_view.get()),
            "g": lambda: self.glow.set(not self.glow.get()),
        }
        if e.state & 0x4:  # Control held: leave to the Ctrl bindings
            return
        fn = actions.get(k)
        if fn:
            fn()
            return "break"

    # ---------------------------------------------------------------- loop
    def _tick(self):
        now = time.perf_counter()
        dt = min(0.1, now - self.last)
        self.last = now
        self.frame_no += 1

        if self.mouse_down:
            self._stroke()
        if not self.paused:
            speed = SPEEDS[self.speed_idx][0]
            self.acc += dt * TICKS_PER_SECOND * speed
            n, max_steps = 0, math.ceil(speed) + 1
            while self.acc >= 1 and n < max_steps:
                self.sim.step()
                self.acc -= 1
                n += 1
            if self.acc > 2:
                self.acc = 0  # too slow to keep up: drop the backlog
        elif self.step_once:
            self.sim.step()
        self.step_once = False

        self._draw()

        if self.frame_no % 6 == 0:
            self._update_readout()
        self.fps_frames += 1
        if now - self.fps_time >= 0.5:
            fps = self.fps_frames / (now - self.fps_time)
            self.stats.configure(text=f"{self.sim.count_cells():,} grains   {fps:.0f} fps   {self.sim.W}×{self.sim.H}")
            self.fps_time, self.fps_frames = now, 0

        # Wait out the rest of the frame, then run the next tick only once Tk
        # has had idle time to repaint widgets and handle input.
        spent = time.perf_counter() - now
        delay = max(4, int((1 / 60 - spent) * 1000))
        self.root.after(delay, lambda: self.root.after_idle(self._tick))

    def _draw(self):
        _, _, s = self.view
        size = (max(1, int(self.sim.W * s)), max(1, int(self.sim.H * s)))
        img = self.renderer.render(self.sim, heat_view=self.heat_view.get(), glow=self.glow.get(), size=size)
        if self.photo is None or self.photo_size != size:
            self.photo = ImageTk.PhotoImage(img)
            self.photo_size = size
            self.canvas.itemconfigure(self.img_id, image=self.photo)
        else:
            self.photo.paste(img)

    def _update_readout(self):
        if not self.mouse_inside:
            self.readout.configure(text="Paused" if self.paused else "")
            return
        c = self.sim.cell_at(*self.cell)
        if not c:
            return
        name = "Air" if c["type"] == 0 else ELEMENTS[c["type"]].name
        if c["type"] == ID["virus"] and c["host"]:
            name = f"Infected {ELEMENTS[c['host']].name.lower()}"
        bits = [name, fmt_temp(c["temp"])]
        if c["burning"]:
            bits.append("burning")
        if c["charged"]:
            bits.append("charged")
        if self.paused:
            bits.append("paused")
        self.readout.configure(text="  ·  ".join(bits))


def main():
    try:  # crisp text on high-DPI Windows displays (must happen before Tk starts)
        from ctypes import windll

        windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
