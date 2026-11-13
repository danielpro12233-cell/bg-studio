'use strict';

// Runs background removal off the main thread so the UI never freezes.
importScripts('bgcore.js');

self.onmessage = (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  const { id, buffer, width, height, opts } = msg;
  try {
    if (!(buffer instanceof ArrayBuffer)) throw new Error('Invalid buffer');
    const data = new Uint8ClampedArray(buffer);
    const result = self.BGCore.removeBackground(data, width, height, opts);
    self.postMessage({ id, ok: true, buffer: data.buffer, key: result.key }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
