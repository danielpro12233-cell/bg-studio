'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { removeBackground, detectKeyColor } = require('../public/js/bgcore');

function makeImage(w, h, painter) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = painter(x, y);
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return data;
}
const alphaAt = (d, w, x, y) => d[(y * w + x) * 4 + 3];

const GREEN = [0, 200, 0];
const RED = [220, 20, 20];

test('removes a solid background and keeps the subject', () => {
  const w = 40, h = 40;
  const d = makeImage(w, h, (x, y) => (x >= 12 && x < 28 && y >= 12 && y < 28 ? RED : GREEN));
  const { key } = removeBackground(d, w, h, { feather: 0, shrink: 0 });
  assert.deepEqual(key, GREEN);
  assert.equal(alphaAt(d, w, 0, 0), 0);
  assert.equal(alphaAt(d, w, 39, 39), 0);
  assert.equal(alphaAt(d, w, 20, 20), 255);
});

test('tolerates noise in the background', () => {
  const w = 40, h = 40;
  const d = makeImage(w, h, (x, y) => {
    if (x >= 12 && x < 28 && y >= 12 && y < 28) return RED;
    const n = (x * 7 + y * 13) % 9;
    return [GREEN[0] + n, GREEN[1] - n, GREEN[2] + n];
  });
  removeBackground(d, w, h, { feather: 0, tolerance: 22 });
  assert.equal(alphaAt(d, w, 1, 1), 0);
  assert.equal(alphaAt(d, w, 20, 20), 255);
});

test('contiguous mode keeps enclosed holes; global mode removes them', () => {
  const w = 40, h = 40;
  const painter = (x, y) => {
    const inRing = x >= 8 && x < 32 && y >= 8 && y < 32;
    const inHole = x >= 17 && x < 23 && y >= 17 && y < 23;
    return inRing && !inHole ? RED : GREEN;
  };
  const a = makeImage(w, h, painter);
  removeBackground(a, w, h, { feather: 0, contiguous: true });
  assert.equal(alphaAt(a, w, 20, 20), 255, 'enclosed hole stays in contiguous mode');

  const b = makeImage(w, h, painter);
  removeBackground(b, w, h, { feather: 0, contiguous: false });
  assert.equal(alphaAt(b, w, 20, 20), 0, 'hole removed in global mode');
  assert.equal(alphaAt(b, w, 10, 10), 255);
});

test('explicit key colour is honoured', () => {
  const w = 20, h = 20;
  const d = makeImage(w, h, (x) => (x < 10 ? RED : GREEN));
  removeBackground(d, w, h, { key: RED, feather: 0, contiguous: false });
  assert.equal(alphaAt(d, w, 2, 5), 0);
  assert.equal(alphaAt(d, w, 15, 5), 255);
});

test('shrink and feather only affect the foreground edge', () => {
  const w = 40, h = 40;
  const d = makeImage(w, h, (x, y) => (x >= 12 && x < 28 && y >= 12 && y < 28 ? RED : GREEN));
  removeBackground(d, w, h, { feather: 2, shrink: 1 });
  assert.equal(alphaAt(d, w, 5, 5), 0, 'background stays transparent');
  assert.equal(alphaAt(d, w, 20, 20), 255, 'interior stays opaque');
  assert.ok(alphaAt(d, w, 12, 20) < 255, 'edge is softened');
});

test('rejects malformed input and sanitises options', () => {
  assert.throws(() => removeBackground(new Uint8ClampedArray(10), 3, 3, {}));
  assert.throws(() => removeBackground(new Uint8ClampedArray(16), 0, 4, {}));
  const d = makeImage(4, 4, () => GREEN);
  assert.doesNotThrow(() => removeBackground(d, 4, 4, { tolerance: 'abc', feather: 9999, shrink: -5, key: ['x', 1] }));
});

test('detectKeyColor picks the dominant border colour', () => {
  const d = makeImage(10, 10, (x, y) => (x === 0 && y === 0 ? RED : GREEN));
  assert.deepEqual(detectKeyColor(d, 10, 10), GREEN);
});
