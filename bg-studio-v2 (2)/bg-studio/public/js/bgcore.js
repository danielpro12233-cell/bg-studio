/*
 * bgcore.js – background removal core (pure functions, no DOM).
 * Loaded by the Web Worker in the browser and by the Node test suite.
 *
 * "Solid color" engine (v2):
 *   1. Learn the background colour from the image border (or use the colour you picked).
 *   2. Region-grow from the border using a perceptual (redmean) colour distance. Soft shadows and
 *      gradients are followed because a pixel may also join when it is close to its neighbour.
 *   3. Edge matting: pixels on the cut line are mixes of subject + background. Their real opacity
 *      is solved from the local background and subject colours, and the background colour is
 *      removed from them (no white / green halo).
 *   4. Optional shrink and soften.
 *
 * Also exports applyAlpha(), used by the AI engine to turn a model's matte into the final image.
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

  /** "Redmean" colour distance: much closer to what the eye sees than plain RGB distance. */
  function cdist(r1, g1, b1, r2, g2, b2) {
    const rm = (r1 + r2) / 2;
    const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2.996 - rm / 256) * db * db) / 1.732;
  }

  /** Dominant border colours (most common first). */
  function detectPalette(d, w, h, max) {
    const bins = new Map();
    let total = 0;
    const add = (x, y) => {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 128) return;
      total++;
      const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
      let b = bins.get(k);
      if (!b) { b = { n: 0, r: 0, g: 0, b: 0 }; bins.set(k, b); }
      b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2];
    };
    for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
    for (let y = 1; y < h - 1; y++) { add(0, y); add(w - 1, y); }
    if (!total) return [[255, 255, 255]];

    const sorted = Array.from(bins.values()).sort((a, b) => b.n - a.n);
    const out = [];
    for (const b of sorted) {
      const c = [Math.round(b.r / b.n), Math.round(b.g / b.n), Math.round(b.b / b.n)];
      const first = out.length === 0;
      if (!first && b.n < total * 0.12) break;
      if (out.every((p) => cdist(p[0], p[1], p[2], c[0], c[1], c[2]) > 28)) out.push(c);
      if (out.length >= (max || 3)) break;
    }
    return out;
  }

  /** Single most common border colour (kept for compatibility and tests). */
  function detectKeyColor(d, w, h) {
    return detectPalette(d, w, h, 1)[0];
  }

  /** Returns Uint8Array: 1 = background, 0 = keep. */
  function computeMask(d, w, h, palette, threshold, contiguous) {
    const pal = Array.isArray(palette[0]) ? palette : [palette];
    const n = w * h;
    const mask = new Uint8Array(n);

    const pdist = (p) => {
      const i = p * 4;
      if (d[i + 3] === 0) return 0;
      let best = Infinity;
      for (let k = 0; k < pal.length; k++) {
        const v = cdist(d[i], d[i + 1], d[i + 2], pal[k][0], pal[k][1], pal[k][2]);
        if (v < best) best = v;
      }
      return best;
    };

    if (!contiguous) {
      for (let p = 0; p < n; p++) if (pdist(p) <= threshold) mask[p] = 1;
      return mask;
    }

    // Region growing. A pixel joins when it is close to the background colours, or (a little
    // further away) when it is almost identical to the neighbour it is growing from. The second
    // rule follows soft shadows and gradients without leaking into a clearly different subject.
    const loose = threshold * 2.5;
    const stepTol = threshold * 0.12 + 3;
    const stack = new Int32Array(n);
    let sp = 0;
    const seed = (p) => {
      if (!mask[p] && pdist(p) <= threshold) { mask[p] = 1; stack[sp++] = p; }
    };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 1; y < h - 1; y++) { seed(y * w); seed(y * w + w - 1); }

    const grow = (from, q) => {
      if (mask[q]) return;
      const dq = pdist(q);
      let ok = dq <= threshold;
      if (!ok && dq <= loose) {
        const a = from * 4, b = q * 4;
        ok = cdist(d[a], d[a + 1], d[a + 2], d[b], d[b + 1], d[b + 2]) <= stepTol;
      }
      if (ok) { mask[q] = 1; stack[sp++] = q; }
    };

    while (sp > 0) {
      const p = stack[--sp];
      const x = p % w;
      if (x > 0) grow(p, p - 1);
      if (x < w - 1) grow(p, p + 1);
      if (p >= w) grow(p, p - w);
      if (p < n - w) grow(p, p + w);
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
   * Edge matting. For every subject pixel within 2px of the removed area, estimate the local
   * background colour B (from removed neighbours) and subject colour F (from solid interior
   * neighbours), solve  I = a*F + (1-a)*B  for the opacity a, then recover the pure subject
   * colour  F = (I - (1-a)*B) / a  so the old background colour does not bleed into the edge.
   * Returns the alpha map (Float32, 0..1); colours are corrected in `d` in place.
   */
  function matteEdges(d, w, h, mask) {
    const n = w * h;
    const alpha = new Float32Array(n);
    for (let p = 0; p < n; p++) alpha[p] = mask[p] ? 0 : 1;

    const near1 = expandMask(mask, w, h, 1);
    const near2 = expandMask(near1, w, h, 1);
    const R = 3;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (mask[p] || !near2[p]) continue; // only subject pixels on the cut line

        let br = 0, bg = 0, bb = 0, bn = 0;
        let fr = 0, fg = 0, fb = 0, fn = 0;
        const y0 = Math.max(0, y - R), y1 = Math.min(h - 1, y + R);
        const x0 = Math.max(0, x - R), x1 = Math.min(w - 1, x + R);
        for (let yy = y0; yy <= y1; yy++) {
          for (let xx = x0; xx <= x1; xx++) {
            const q = yy * w + xx;
            const i = q * 4;
            if (mask[q]) { br += d[i]; bg += d[i + 1]; bb += d[i + 2]; bn++; }
            else if (!near2[q]) { fr += d[i]; fg += d[i + 1]; fb += d[i + 2]; fn++; }
          }
        }
        if (!bn || !fn) continue; // nothing to compare with: keep the pixel as it is

        br /= bn; bg /= bn; bb /= bn;
        fr /= fn; fg /= fn; fb /= fn;
        const vr = fr - br, vg = fg - bg, vb = fb - bb;
        const len2 = vr * vr + vg * vg + vb * vb;
        if (len2 < 14 * 14) continue; // subject ~ background: cannot be separated reliably

        const i = p * 4;
        let a = ((d[i] - br) * vr + (d[i + 1] - bg) * vg + (d[i + 2] - bb) * vb) / len2;
        a = a < 0 ? 0 : a > 1 ? 1 : a;
        if (a > 0.97) continue;
        if (a < 0.04) { alpha[p] = 0; continue; }

        alpha[p] = a;
        d[i] = Math.max(0, Math.min(255, Math.round((d[i] - (1 - a) * br) / a)));
        d[i + 1] = Math.max(0, Math.min(255, Math.round((d[i + 1] - (1 - a) * bg) / a)));
        d[i + 2] = Math.max(0, Math.min(255, Math.round((d[i + 2] - (1 - a) * bb) / a)));
      }
    }
    return alpha;
  }

  /**
   * Removes the background in place.
   * @param {Uint8ClampedArray|Uint8Array} data RGBA pixels
   * @returns {{key:number[]}} main colour that was removed
   */
  function removeBackground(data, w, h, options) {
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || !data || data.length !== w * h * 4) {
      throw new Error('Invalid image data');
    }
    const o = normalizeOptions(options);
    // One background colour only: a subject that touches the image edge (shoulders, cropped products)
    // must never be mistaken for a second background colour. Gradients are handled by region growing.
    const palette = o.key ? [o.key] : detectPalette(data, w, h, 1);

    let mask = computeMask(data, w, h, palette, o.tolerance * 2.5, o.contiguous);
    if (o.shrink > 0) mask = expandMask(mask, w, h, o.shrink);

    const n = w * h;
    const alpha = matteEdges(data, w, h, mask);

    if (o.feather > 0) {
      const tmp = new Float32Array(n);
      const soft = alpha.slice();
      for (let pass = 0; pass < 2; pass++) {
        blurH(soft, tmp, w, h, o.feather);
        blurV(tmp, soft, w, h, o.feather);
      }
      // Softness only fades the subject's own edge; it never re-opacifies removed pixels (no halo).
      for (let i = 0; i < n; i++) alpha[i] = mask[i] ? 0 : Math.min(alpha[i], soft[i] + 0.0001);
    }

    for (let i = 0; i < n; i++) data[i * 4 + 3] = Math.round(data[i * 4 + 3] * alpha[i]);
    return { key: palette[0] };
  }

  /**
   * Applies a model matte (0..255 per pixel, same size as the image) to RGBA pixels in place.
   * `tightness` 0..100 moves the cut line: higher = tighter around the subject.
   */
  function applyAlpha(data, matte, w, h, tightness) {
    const n = w * h;
    if (!data || data.length !== n * 4 || !matte || matte.length !== n) throw new Error('Invalid matte');
    const t = clampInt(tightness, 0, 100, 50) / 100;
    const c = 0.25 + 0.5 * t;           // centre of the soft threshold
    const lo = c - 0.16, hi = c + 0.16; // width of the soft edge
    for (let i = 0; i < n; i++) {
      let a = (matte[i] / 255 - lo) / (hi - lo);
      a = a < 0 ? 0 : a > 1 ? 1 : a;
      a = a * a * (3 - 2 * a); // smoothstep
      data[i * 4 + 3] = Math.round(data[i * 4 + 3] * a);
    }
  }

  const api = { removeBackground, applyAlpha, detectKeyColor, detectPalette, computeMask, normalizeOptions, cdist };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    (typeof self !== 'undefined' ? self : globalThis).BGCore = api;
  }
})();
