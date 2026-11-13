/*
 * bgcore.js – background removal core (pure functions, no DOM).
 * Loaded by the Web Worker in the browser and by the Node test suite.
 *
 * Method: colour-key flood fill.
 *   1. Pick a key colour (auto-detected from the image border, or supplied).
 *   2. Mark pixels within `tolerance` of the key colour as background,
 *      either only those connected to the image edges (contiguous) or everywhere.
 *   3. Optionally shrink the edge and soften it.
 */
(function () {
  'use strict';

  function clampInt(v, min, max, fallback) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function normalizeOptions(opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    let key = null;
    if (Array.isArray(o.key) && o.key.length === 3) {
      key = o.key.map((c) => clampInt(c, 0, 255, 0));
    }
    return {
      tolerance: clampInt(o.tolerance, 0, 100, 22),
      feather: clampInt(o.feather, 0, 10, 1),
      shrink: clampInt(o.shrink, 0, 4, 0),
      contiguous: o.contiguous !== false,
      key,
    };
  }

  /** Most common (quantised) colour along the image border. */
  function detectKeyColor(d, w, h) {
    const bins = new Map();
    const add = (x, y) => {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 128) return;
      const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
      let b = bins.get(k);
      if (!b) { b = { n: 0, r: 0, g: 0, b: 0 }; bins.set(k, b); }
      b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2];
    };
    for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
    for (let y = 1; y < h - 1; y++) { add(0, y); add(w - 1, y); }
    let best = null;
    for (const b of bins.values()) if (!best || b.n > best.n) best = b;
    if (!best) return [255, 255, 255];
    return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
  }

  /** Returns Uint8Array: 1 = background, 0 = keep. */
  function computeMask(d, w, h, key, threshold, contiguous) {
    const n = w * h;
    const mask = new Uint8Array(n);
    const t2 = threshold * threshold;
    const kr = key[0], kg = key[1], kb = key[2];

    const isBg = (p) => {
      const i = p * 4;
      if (d[i + 3] === 0) return true;
      const dr = d[i] - kr, dg = d[i + 1] - kg, db = d[i + 2] - kb;
      return dr * dr + dg * dg + db * db <= t2;
    };

    if (!contiguous) {
      for (let p = 0; p < n; p++) if (isBg(p)) mask[p] = 1;
      return mask;
    }

    const stack = new Int32Array(n);
    let sp = 0;
    const seed = (p) => {
      if (!mask[p] && isBg(p)) { mask[p] = 1; stack[sp++] = p; }
    };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 1; y < h - 1; y++) { seed(y * w); seed(y * w + w - 1); }

    while (sp > 0) {
      const p = stack[--sp];
      const x = p % w;
      if (x > 0) seed(p - 1);
      if (x < w - 1) seed(p + 1);
      if (p >= w) seed(p - w);
      if (p < n - w) seed(p + w);
    }
    return mask;
  }

  /** Grow the background mask by `n` pixels (4-neighbourhood). */
  function expandMask(mask, w, h, n) {
    let cur = mask;
    for (let k = 0; k < n; k++) {
      const next = cur.slice();
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          if (cur[p]) continue;
          if ((x > 0 && cur[p - 1]) || (x < w - 1 && cur[p + 1]) ||
              (y > 0 && cur[p - w]) || (y < h - 1 && cur[p + w])) next[p] = 1;
        }
      }
      cur = next;
    }
    return cur;
  }

  function blurH(src, dst, w, h, r) {
    const div = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        dst[row + x] = sum / div;
        sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
  }

  function blurV(src, dst, w, h, r) {
    const div = 2 * r + 1;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += src[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = sum / div;
        sum += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
      }
    }
  }

  /**
   * Removes the background in place.
   * @param {Uint8ClampedArray|Uint8Array} data RGBA pixels
   * @returns {{key:number[]}} key colour that was removed
   */
  function removeBackground(data, w, h, options) {
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || !data || data.length !== w * h * 4) {
      throw new Error('Invalid image data');
    }
    const o = normalizeOptions(options);
    const key = o.key || detectKeyColor(data, w, h);

    let mask = computeMask(data, w, h, key, o.tolerance * 2.5, o.contiguous);
    if (o.shrink > 0) mask = expandMask(mask, w, h, o.shrink);

    const n = w * h;
    let alpha = new Float32Array(n);
    for (let i = 0; i < n; i++) alpha[i] = mask[i] ? 0 : 1;

    if (o.feather > 0) {
      const tmp = new Float32Array(n);
      for (let pass = 0; pass < 2; pass++) {
        blurH(alpha, tmp, w, h, o.feather);
        blurV(tmp, alpha, w, h, o.feather);
      }
    }

    // Softness only fades the foreground edge; it never re-opacifies removed pixels (no halo).
    for (let i = 0; i < n; i++) {
      const a = mask[i] ? 0 : alpha[i];
      data[i * 4 + 3] = Math.round(data[i * 4 + 3] * a);
    }
    return { key };
  }

  const api = { removeBackground, detectKeyColor, computeMask, normalizeOptions };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    (typeof self !== 'undefined' ? self : globalThis).BGCore = api;
  }
})();
