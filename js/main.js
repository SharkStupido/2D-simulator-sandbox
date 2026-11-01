/*
 * Grainfall: UI wiring, input and the main loop.
 */
(function () {
  'use strict';
  const G = globalThis.Grainfall;
  const { sim, EL, E, CATEGORIES, scenes } = G;

  const $ = (sel) => document.querySelector(sel);
  const SAVE_KEY = 'grainfall.save.v1';
  const SPEEDS = [0.5, 1, 2, 4];
  const SPEED_LABELS = ['½×', '1×', '2×', '4×'];
  const GRAIN_PX = { fine: 2.4, normal: 3.4, coarse: 5 }; // target CSS px per cell
  const TICK_MS = 1000 / 60;

  const state = {
    tool: 'draw',
    element: E.SAND,
    brush: 4,
    replace: false,
    paused: false,
    speed: 1,
    heatView: false,
    glow: true,
    tab: 'powders',
    grain: 'normal',
    scene: 'landscape',
  };

  const stage = $('#stage');
  const viewport = $('#viewport');
  const canvas = $('#world');
  const glowCanvas = $('#glow');
  const cursor = $('#cursor');
  const readout = $('#readout');
  const toastEl = $('#toast');
  const renderer = new G.Renderer(canvas, glowCanvas);
  let cssScale = 1;

  // ------------------------------------------------------------ world setup
  function worldSize() {
    const r = stage.getBoundingClientRect();
    const px = GRAIN_PX[state.grain] || GRAIN_PX.normal;
    const w = Math.round(Math.max(100, Math.min(480, r.width / px)));
    const h = Math.round(Math.max(70, Math.min(320, r.height / px)));
    return [w, h];
  }

  function newWorld(sceneKey) {
    const [w, h] = worldSize();
    sim.init(w, h);
    renderer.resize(w, h);
    scenes.build(sceneKey, sim);
    fit();
  }

  function fit() {
    const r = stage.getBoundingClientRect();
    if (!sim.W || r.width <= 0 || r.height <= 0) return;
    cssScale = Math.min(r.width / sim.W, r.height / sim.H);
    viewport.style.width = Math.floor(sim.W * cssScale) + 'px';
    viewport.style.height = Math.floor(sim.H * cssScale) + 'px';
    glowCanvas.style.filter = `blur(${Math.max(2, cssScale * 1.8).toFixed(1)}px)`;
    updateCursor();
  }

  // ---------------------------------------------------------------- palette
  const tabsEl = $('#tabs');
  const elementsEl = $('#elements');

  function buildTabs() {
    tabsEl.textContent = '';
    for (const c of CATEGORIES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.textContent = c.name;
      b.dataset.cat = c.key;
      b.setAttribute('aria-selected', String(c.key === state.tab));
      b.addEventListener('click', () => { state.tab = c.key; buildTabs(); buildElements(); });
      tabsEl.appendChild(b);
    }
  }

  function buildElements() {
    elementsEl.textContent = '';
    for (const el of EL) {
      if (el.cat !== state.tab) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'el';
      b.setAttribute('role', 'option');
      b.title = el.desc;
      b.dataset.id = el.id;
      b.setAttribute('aria-selected', String(el.id === state.element));
      const sw = document.createElement('span');
      sw.className = 'sw';
      sw.style.background = G.swatch(el.id);
      const name = document.createElement('span');
      name.textContent = el.name;
      b.append(sw, name);
      b.addEventListener('click', () => selectElement(el.id));
      elementsEl.appendChild(b);
    }
  }

  function selectElement(id, switchTab) {
    const el = EL[id];
    if (!el || id === E.EMPTY) return;
    state.element = id;
    if (switchTab && el.cat && el.cat !== state.tab) { state.tab = el.cat; buildTabs(); buildElements(); }
    for (const b of elementsEl.children) b.setAttribute('aria-selected', String(Number(b.dataset.id) === id));
    $('#sel-swatch').style.background = G.swatch(id);
    $('#sel-name').textContent = el.name;
    $('#sel-desc').textContent = el.desc;
    setTool('draw');
  }

  function setTool(tool) {
    state.tool = tool;
    for (const b of document.querySelectorAll('#tools button')) b.setAttribute('aria-checked', String(b.dataset.tool === tool));
    cursor.dataset.tool = tool;
  }

  function setBrush(n) {
    state.brush = Math.max(1, Math.min(30, Math.round(n)));
    $('#brush').value = state.brush;
    $('#brush-out').textContent = state.brush;
    updateCursor();
  }

  // ------------------------------------------------------------------ toast
  let toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 1800);
  }

  // ------------------------------------------------------------------ input
  const pointer = { inside: false, down: false, button: 0, x: 0, y: 0, lastX: 0, lastY: 0, id: -1 };

  function toCell(e) {
    const r = canvas.getBoundingClientRect();
    return [
      Math.floor(((e.clientX - r.left) / r.width) * sim.W),
      Math.floor(((e.clientY - r.top) / r.height) * sim.H),
    ];
  }

  function updateCursor() {
    if (!pointer.inside) { cursor.hidden = true; return; }
    cursor.hidden = false;
    const d = state.tool === 'pick' ? 1 : (state.brush - 1) * 2 + 1;
    const size = Math.max(6, d * cssScale);
    const cx = (pointer.x + 0.5) * cssScale, cy = (pointer.y + 0.5) * cssScale;
    cursor.style.width = size + 'px';
    cursor.style.height = size + 'px';
    cursor.style.transform = `translate(${cx - size / 2}px, ${cy - size / 2}px)`;
  }

  function activeTool() {
    if (pointer.button === 2) return 'erase';
    return state.tool;
  }

  function pickAt(x, y) {
    const c = sim.cellAt(x, y);
    if (!c || c.type === E.EMPTY) return;
    let id = c.type === E.VIRUS ? E.VIRUS : c.type;
    if (!EL[id].cat) id = id === E.FLOWER ? E.PLANT : id;
    if (!EL[id].cat) return;
    selectElement(id, true);
    toast(`Picked ${EL[id].name}`);
  }

  function stroke() {
    const tool = activeTool();
    if (tool === 'pick') return;
    const x0 = pointer.lastX, y0 = pointer.lastY, x1 = pointer.x, y1 = pointer.y;
    const dist = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    const spacing = Math.max(1, state.brush * 0.5);
    const steps = Math.max(1, Math.ceil(dist / spacing));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      sim.paint(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), state.brush, tool, state.element, state.replace);
    }
    pointer.lastX = x1;
    pointer.lastY = y1;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (pointer.down) return;
    e.preventDefault();
    const [x, y] = toCell(e);
    pointer.x = pointer.lastX = x;
    pointer.y = pointer.lastY = y;
    pointer.inside = true;
    if (e.button === 1 || (state.tool === 'pick' && e.button === 0)) {
      pickAt(x, y);
      return;
    }
    pointer.down = true;
    pointer.button = e.button;
    pointer.id = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
    stroke();
  });

  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = toCell(e);
    pointer.x = x;
    pointer.y = y;
    pointer.inside = e.pointerType !== 'touch' || pointer.down;
    updateCursor();
  });

  const endStroke = (e) => {
    if (e.pointerId !== pointer.id) return;
    pointer.down = false;
    pointer.id = -1;
    if (e.pointerType === 'touch') { pointer.inside = false; updateCursor(); }
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', () => {
    if (!pointer.down) { pointer.inside = false; updateCursor(); }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    setBrush(state.brush + (e.deltaY < 0 ? 1 : -1));
  }, { passive: false });

  // ---------------------------------------------------------------- readout
  // Shows the hint until the player first points at the world, then a live
  // readout of whatever is under the cursor.
  let showHint = true;

  function fmtTemp(t) {
    const v = Math.round(t);
    return (v < 0 ? '\u2212' + Math.abs(v) : String(v)) + ' \u00b0C';
  }

  function updateReadout() {
    if (!pointer.inside) {
      if (showHint) return;
      readout.hidden = !state.paused;
      if (state.paused) readout.textContent = 'Paused';
      return;
    }
    const c = sim.cellAt(pointer.x, pointer.y);
    if (!c) return;
    showHint = false;
    readout.hidden = false;
    let name = c.type === E.EMPTY ? 'Air' : EL[c.type].name;
    if (c.type === E.VIRUS && c.host) name = `Infected ${EL[c.host].name.toLowerCase()}`;
    const bits = [fmtTemp(c.temp)];
    if (c.burning) bits.push('burning');
    if (c.charged) bits.push('charged');
    if (state.paused) bits.push('paused');
    readout.textContent = '';
    const b = document.createElement('b');
    b.textContent = name;
    readout.append(b, ' \u00b7 ' + bits.join(' \u00b7 '));
  }

  // ------------------------------------------------------------- top bar
  function setPaused(p) {
    state.paused = p;
    const btn = $('#btn-pause');
    btn.dataset.paused = String(p);
    btn.setAttribute('aria-label', p ? 'Resume' : 'Pause');
    btn.title = p ? 'Resume (Space)' : 'Pause (Space)';
  }

  function setSpeed(idx) {
    state.speed = (idx + SPEEDS.length) % SPEEDS.length;
    $('#btn-speed').textContent = SPEED_LABELS[state.speed];
  }

  function setHeatView(on) {
    state.heatView = on;
    $('#btn-heat').setAttribute('aria-pressed', String(on));
    glowCanvas.hidden = on || !state.glow;
  }

  function setGlow(on) {
    state.glow = on;
    $('#btn-glow').setAttribute('aria-pressed', String(on));
    glowCanvas.hidden = state.heatView || !on;
    if (!on) renderer.clearGlow();
  }

  function setReplace(on) {
    state.replace = on;
    $('#btn-replace').setAttribute('aria-pressed', String(on));
  }

  let stepOnce = false;
  $('#btn-pause').addEventListener('click', () => setPaused(!state.paused));
  $('#btn-step').addEventListener('click', () => { setPaused(true); stepOnce = true; });
  $('#btn-speed').addEventListener('click', () => setSpeed(state.speed + 1));
  $('#btn-heat').addEventListener('click', () => setHeatView(!state.heatView));
  $('#btn-glow').addEventListener('click', () => setGlow(!state.glow));
  $('#btn-replace').addEventListener('click', () => setReplace(!state.replace));

  const sceneSel = $('#scene');
  for (const s of scenes.list) {
    const o = document.createElement('option');
    o.value = s.key;
    o.textContent = s.name;
    sceneSel.appendChild(o);
  }
  sceneSel.addEventListener('change', () => {
    state.scene = sceneSel.value;
    scenes.build(state.scene, sim);
    toast(`Loaded ${scenes.list.find((s) => s.key === state.scene).name}`);
  });

  $('#grain').addEventListener('change', (e) => {
    state.grain = e.target.value;
    newWorld(state.scene);
    toast(`Rebuilt the world at ${sim.W} × ${sim.H}`);
  });

  $('#btn-save').addEventListener('click', () => {
    try {
      localStorage.setItem(SAVE_KEY, sim.serialize());
      toast('Saved in this browser');
    } catch (err) {
      toast('Could not save: browser storage is unavailable');
    }
  });

  $('#btn-load').addEventListener('click', () => {
    let data = null;
    try { data = localStorage.getItem(SAVE_KEY); } catch (err) { data = null; }
    if (!data) { toast('No saved world yet. Press Save first.'); return; }
    if (sim.deserialize(data)) {
      renderer.resize(sim.W, sim.H);
      fit();
      toast('Loaded your saved world');
    } else {
      toast('The saved world could not be read');
    }
  });

  const clearBtn = $('#btn-clear');
  let clearTimer = 0;
  clearBtn.addEventListener('click', () => {
    if (clearBtn.classList.contains('armed')) {
      clearTimeout(clearTimer);
      clearBtn.classList.remove('armed');
      clearBtn.textContent = 'Clear';
      sim.clearWorld();
      toast('World cleared');
      return;
    }
    clearBtn.classList.add('armed');
    clearBtn.textContent = 'Confirm';
    clearTimer = setTimeout(() => { clearBtn.classList.remove('armed'); clearBtn.textContent = 'Clear'; }, 2500);
  });

  // ------------------------------------------------------------------ help
  const help = $('#help');
  function setHelp(open) {
    help.hidden = !open;
    $('#btn-help').setAttribute('aria-expanded', String(open));
    if (open) $('#btn-help-close').focus();
  }
  $('#btn-help').addEventListener('click', () => setHelp(help.hidden));
  $('#btn-help-close').addEventListener('click', () => setHelp(false));
  help.addEventListener('click', (e) => { if (e.target === help) setHelp(false); });

  // ------------------------------------------------------------ dock wiring
  for (const b of document.querySelectorAll('#tools button')) b.addEventListener('click', () => setTool(b.dataset.tool));
  $('#brush').addEventListener('input', (e) => setBrush(Number(e.target.value)));

  // --------------------------------------------------------------- keyboard
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'SELECT' || tag === 'INPUT') return;
    const k = e.key;
    if (k === 'Escape' && !help.hidden) { setHelp(false); return; }
    if (k === ' ') {
      e.preventDefault();
      if (tag === 'BUTTON') e.target.blur(); // so the key does not also click it
      setPaused(!state.paused);
      return;
    }
    if (tag === 'BUTTON' && k === 'Enter') return;
    switch (k.toLowerCase()) {
      case '.': setPaused(true); stepOnce = true; break;
      case '[': setBrush(state.brush - 1); break;
      case ']': setBrush(state.brush + 1); break;
      case 'd': case 'b': setTool('draw'); break;
      case 'e': setTool('erase'); break;
      case 'h': setTool('heat'); break;
      case 'c': setTool('cool'); break;
      case 'p': case 'i': setTool('pick'); break;
      case 'r': setReplace(!state.replace); break;
      case 't': setHeatView(!state.heatView); break;
      case 'g': setGlow(!state.glow); break;
      case '?': case '/': setHelp(help.hidden); break;
      default: return;
    }
  });

  // ------------------------------------------------------------------ loop
  let last = performance.now();
  let acc = 0;
  let fpsAcc = 0, fpsFrames = 0, frameNo = 0;
  let cells = 0;

  function frame(now) {
    const dt = Math.min(100, now - last);
    last = now;
    fpsAcc += dt;
    fpsFrames++;
    frameNo++;

    if (pointer.down) stroke();

    if (!state.paused) {
      acc += (dt / TICK_MS) * SPEEDS[state.speed];
      let n = 0;
      const maxSteps = Math.ceil(SPEEDS[state.speed]) + 1;
      while (acc >= 1 && n < maxSteps) { sim.step(); acc -= 1; n++; }
      if (acc > 2) acc = 0; // too slow to keep up: drop the backlog
    } else if (stepOnce) {
      sim.step();
    }
    stepOnce = false;

    cells = renderer.render(sim, state);

    if (frameNo % 6 === 0) updateReadout();
    if (fpsAcc >= 500) {
      $('#stat-fps').textContent = Math.round((fpsFrames * 1000) / fpsAcc) + ' fps';
      $('#stat-cells').textContent = cells.toLocaleString('en-US') + ' grains';
      fpsAcc = 0;
      fpsFrames = 0;
    }
    requestAnimationFrame(frame);
  }

  // ----------------------------------------------------------------- start
  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(fit, 60); });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => fit()).observe(stage);

  function start(data) {
    buildTabs();
    buildElements();
    selectElement(state.element);
    setBrush(state.brush);
    setSpeed(state.speed);
    setGlow(state.glow);

    let restored = false;
    if (data && typeof data.save === 'string' && sim.deserialize(data.save)) {
      renderer.resize(sim.W, sim.H);
      fit();
      restored = true;
    }
    if (!restored) newWorld(state.scene);
    sceneSel.value = state.scene;

    // Keep the world across live page updates when the host supports it.
    try {
      const hot = globalThis.claude && globalThis.claude.hot;
      if (hot && typeof hot.snapshot === 'function') hot.snapshot(() => ({ save: sim.serialize() }));
    } catch (err) { /* optional */ }

    requestAnimationFrame((t) => { last = t; frame(t); });
  }

  const hot = globalThis.claude && globalThis.claude.hot;
  if (hot && typeof hot.ready === 'function') hot.ready(start);
  else start((hot && hot.data) || {});
})();
