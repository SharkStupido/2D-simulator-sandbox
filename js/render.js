/*
 * Grainfall: renderer.
 *
 * Draws the grid 1:1 into an ImageData (one pixel per cell); CSS scales the
 * canvas up with crisp pixels. A second canvas receives only emissive pixels
 * (fire, lava, sparks, glowing-hot metal) and is blurred by CSS to fake bloom.
 */
(function () {
  'use strict';
  const G = (globalThis.Grainfall = globalThis.Grainfall || {});
  const { EL, E, STATE } = G;
  const N = EL.length;
  const SHADES = 16;

  // ------------------------------------------------------------ colour math
  const hexRGB = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
  const pack = (r, g, b) => ((255 << 24) | (clamp255(b) << 16) | (clamp255(g) << 8) | clamp255(r)) >>> 0;
  function mix(c1, c2, t) {
    const r1 = c1 & 255, g1 = (c1 >>> 8) & 255, b1 = (c1 >>> 16) & 255;
    const r2 = c2 & 255, g2 = (c2 >>> 8) & 255, b2 = (c2 >>> 16) & 255;
    return pack(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
  }
  function scale(c, k) {
    return pack((c & 255) * k, ((c >>> 8) & 255) * k, ((c >>> 16) & 255) * k);
  }
  const hash = (n) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };

  /** Build an n-entry lookup table by interpolating between [position, [r,g,b]] stops. */
  function gradient(n, stops, lo, hi) {
    const lut = new Uint32Array(n);
    for (let k = 0; k < n; k++) {
      const v = lo + ((hi - lo) * k) / (n - 1);
      let a = stops[0], b = stops[stops.length - 1];
      for (let s = 0; s < stops.length - 1; s++) {
        if (v >= stops[s][0] && v <= stops[s + 1][0]) { a = stops[s]; b = stops[s + 1]; break; }
      }
      const t = b[0] === a[0] ? 0 : Math.min(1, Math.max(0, (v - a[0]) / (b[0] - a[0])));
      lut[k] = pack(a[1][0] + (b[1][0] - a[1][0]) * t, a[1][1] + (b[1][1] - a[1][1]) * t, a[1][2] + (b[1][2] - a[1][2]) * t);
    }
    return lut;
  }

  function shadesOf(colors, salt) {
    const out = new Uint32Array(SHADES);
    for (let v = 0; v < SHADES; v++) {
      const [r, g, b] = hexRGB(colors[v % colors.length]);
      const j = 0.9 + 0.2 * hash(v * 7.13 + salt * 3.7);
      out[v] = pack(r * j, g * j, b * j);
    }
    return out;
  }

  // ---------------------------------------------------------------- palettes
  const PAL = new Uint32Array(N * SHADES);
  const ALPHA = new Float32Array(N).fill(1);
  const GLOWS = new Uint8Array(N);
  const ST = new Uint8Array(N);
  for (const el of EL) {
    PAL.set(shadesOf(el.color, el.id), el.id * SHADES);
    GLOWS[el.id] = el.glow ? 1 : 0;
    ST[el.id] = el.state;
  }
  ALPHA[E.GLASS] = 0.45;
  ALPHA[E.STEAM] = 0.62;
  ALPHA[E.METHANE] = 0.28;
  ALPHA[E.WATER] = 0.88;
  ALPHA[E.SALT_WATER] = 0.88;

  const LEAF = shadesOf(['#5cbf4a', '#52b142', '#66c955', '#4fa83f'], 99);
  const FLOWER_CENTER = shadesOf(['#ffd23f', '#ffc72c', '#ffdc5a'], 77);
  const HUE = new Uint32Array(256);
  for (let k = 0; k < 256; k++) {
    // Pleasant petal colours: full hue wheel, slightly pastel.
    const h = (k / 256) * 6, x = 1 - Math.abs((h % 2) - 1);
    const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
    HUE[k] = pack(70 + r * 185, 70 + g * 170, 90 + b * 165);
  }

  const FIRE_LUT = gradient(64, [
    [0, [90, 12, 6]], [12, [190, 40, 10]], [28, [255, 110, 20]], [44, [255, 185, 55]], [63, [255, 240, 170]],
  ], 0, 63);
  // Incandescence: what a hot solid or liquid looks like from 450 °C to 2450 °C.
  const BB = gradient(64, [
    [450, [90, 10, 5]], [650, [160, 25, 8]], [850, [215, 55, 10]], [1100, [255, 110, 20]],
    [1400, [255, 170, 50]], [1800, [255, 220, 120]], [2450, [255, 250, 230]],
  ], 450, 2450);
  // Thermal camera palette from −273 °C to 3000 °C.
  const HEAT = gradient(1024, [
    [-273, [230, 250, 255]], [-100, [90, 200, 255]], [-20, [40, 110, 230]], [20, [28, 36, 80]],
    [80, [90, 40, 140]], [200, [180, 40, 120]], [450, [235, 60, 40]], [900, [255, 150, 20]],
    [1600, [255, 235, 90]], [3000, [255, 255, 255]],
  ], -273, 3000);

  const SPARK_C = pack(255, 248, 200);
  const ELEC_C = pack(255, 244, 170);
  const ELEC_GLOW = pack(255, 220, 120);
  const LAMP_ON = pack(255, 241, 190);
  const LAMP_GLOW = pack(255, 214, 140);
  const FROST = pack(210, 235, 255);
  const BG_TOP = [13, 16, 22];
  const BG_BOTTOM = [24, 27, 36];

  const { FIRE, SMOKE, STEAM, PLANT, FLOWER, LAMP, VIRUS, CLONE, SPARK } = E;
  const GAS = STATE.GAS;

  class Renderer {
    constructor(canvas, glowCanvas) {
      this.canvas = canvas;
      this.glowCanvas = glowCanvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.gctx = glowCanvas.getContext('2d');
      this.W = 0;
      this.H = 0;
    }

    resize(W, H) {
      this.W = W;
      this.H = H;
      this.canvas.width = W;
      this.canvas.height = H;
      this.glowCanvas.width = W;
      this.glowCanvas.height = H;
      this.img = this.ctx.createImageData(W, H);
      this.px = new Uint32Array(this.img.data.buffer);
      this.gimg = this.gctx.createImageData(W, H);
      this.gl = new Uint32Array(this.gimg.data.buffer);
      this.bgRow = new Uint32Array(H);
      for (let y = 0; y < H; y++) {
        const t = H > 1 ? y / (H - 1) : 0;
        this.bgRow[y] = pack(
          BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t,
          BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t,
          BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t
        );
      }
    }

    /** Draw the world. Returns the number of occupied cells. */
    render(sim, opts) {
      const W = sim.W, H = sim.H;
      if (W !== this.W || H !== this.H) this.resize(W, H);
      const { type, temp, life, aux, flags, shade, elec } = sim;
      const frame = sim.frame;
      const px = this.px, gl = this.gl, bgRow = this.bgRow;
      const heatView = !!opts.heatView;
      const glowOn = !!opts.glow && !heatView;
      let count = 0;

      for (let y = 0; y < H; y++) {
        const bg = bgRow[y];
        let i = y * W;
        for (let x = 0; x < W; x++, i++) {
          const t = type[i];
          if (heatView) {
            let k = ((temp[i] + 273) * 0.31256) | 0;
            k = k < 0 ? 0 : k > 1023 ? 1023 : k;
            px[i] = t === 0 ? mix(bg, HEAT[k], 0.45) : mix(HEAT[k], PAL[t * SHADES + (shade[i] & 15)], 0.16);
            if (t !== 0) count++;
            continue;
          }
          if (t === 0) {
            px[i] = bg;
            if (glowOn) gl[i] = 0;
            continue;
          }
          count++;
          const s = shade[i] & 15;
          let c, g = 0;
          switch (t) {
            case FIRE: {
              let k = (life[i] * 1.5 + (shade[i] & 7)) | 0;
              if (k > 63) k = 63;
              c = FIRE_LUT[k];
              g = c;
              break;
            }
            case SMOKE: {
              const a = Math.min(1, life[i] / 140) * 0.8;
              c = mix(bg, PAL[t * SHADES + s], a);
              g = scale(c, 0.3); // soft haze in the blurred glow layer
              break;
            }
            case STEAM:
              c = mix(bg, PAL[t * SHADES + s], ALPHA[t]);
              g = scale(c, 0.6);
              break;
            case PLANT:
              c = aux[i] === 3 ? LEAF[s] : PAL[t * SHADES + s];
              break;
            case FLOWER:
              c = aux[i] === 255 ? FLOWER_CENTER[s] : HUE[(aux[i] + (s >> 1)) & 255];
              break;
            case LAMP: {
              const a = aux[i] / 255;
              c = mix(PAL[t * SHADES + s], LAMP_ON, a);
              if (a > 0.04) g = scale(LAMP_GLOW, a);
              break;
            }
            case VIRUS: {
              const pulse = 0.18 + 0.12 * Math.sin((frame + shade[i]) * 0.15);
              c = mix(PAL[t * SHADES + s], PAL[aux[i] * SHADES + s], pulse);
              break;
            }
            case CLONE:
              c = aux[i] !== 0 ? mix(PAL[t * SHADES + s], PAL[aux[i] * SHADES + s], 0.4) : PAL[t * SHADES + s];
              break;
            case SPARK:
              c = SPARK_C;
              g = c;
              break;
            default:
              c = PAL[t * SHADES + s];
              if (ALPHA[t] < 1) c = mix(bg, c, ALPHA[t]);
          }

          if ((flags[i] & 1) !== 0) {
            const f = FIRE_LUT[32 + ((shade[i] * 7 + frame * 13) & 31)];
            c = mix(c, f, 0.6);
            g = f;
          }

          const tp = temp[i];
          if (ST[t] !== GAS) {
            if (tp > 480) {
              let k = ((tp - 450) * 0.0315) | 0;
              if (k > 63) k = 63;
              const bb = BB[k];
              const a = tp > 1380 ? 0.92 : ((tp - 480) / 900) * 0.92;
              c = mix(c, bb, a);
              if (tp > 650 && g === 0) g = scale(bb, Math.min(1, (tp - 650) / 700));
            } else if (tp < -10) {
              c = mix(c, FROST, Math.min(0.45, (-10 - tp) / 250));
            }
          }

          if (elec[i] > 0) {
            c = mix(c, ELEC_C, 0.75);
            g = ELEC_GLOW;
          }
          if (g === 0 && GLOWS[t] === 1) g = c;
          px[i] = c;
          if (glowOn) gl[i] = g;
        }
      }

      // Flying debris from explosions.
      const P = sim.particles;
      for (let k = 0, n = P.count; k < n; k++) {
        const x = P.PX[k] | 0, y = P.PY[k] | 0;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const t = P.PT[k];
        const c = PAL[t * SHADES + (k & 15)];
        px[y * W + x] = c;
        if (glowOn && GLOWS[t]) gl[y * W + x] = c;
      }

      this.ctx.putImageData(this.img, 0, 0);
      if (glowOn) this.gctx.putImageData(this.gimg, 0, 0);
      return count;
    }

    clearGlow() {
      this.gctx.clearRect(0, 0, this.W, this.H);
    }
  }

  /** CSS colour for an element's palette swatch. */
  function swatch(t) {
    const base = PAL[t * SHADES];
    const css = (c) => `rgb(${c & 255} ${(c >>> 8) & 255} ${(c >>> 16) & 255})`;
    if (t === E.PLANT) return `linear-gradient(135deg, ${css(LEAF[0])}, ${css(PAL[t * SHADES + 1])})`;
    if (t === E.FIRE) return `linear-gradient(0deg, ${css(FIRE_LUT[20])}, ${css(FIRE_LUT[50])})`;
    return `linear-gradient(135deg, ${css(base)}, ${css(PAL[t * SHADES + 5])} 60%, ${css(PAL[t * SHADES + 2])})`;
  }

  G.Renderer = Renderer;
  G.swatch = swatch;
})();
