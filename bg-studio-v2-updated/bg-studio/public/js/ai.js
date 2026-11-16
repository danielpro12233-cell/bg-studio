/*
 * ai.js – optional "AI" background removal (portrait matting) that runs in the visitor's browser.
 *
 * Model: MODNet (Apache-2.0) via Transformers.js (Apache-2.0), loaded on demand from jsDelivr and
 * Hugging Face the first time the visitor chooses AI mode. The browser caches the ~26 MB model,
 * so later visits are fast. No image is ever uploaded: only the model files are downloaded.
 *
 * Exposes window.BGAI.matte(canvas, onProgress) -> Promise<{ data: Uint8ClampedArray, width, height }>
 */
(() => {
  'use strict';

  const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.0';
  const MODEL_ID = 'Xenova/modnet';
  const MAX_SIDE = 1024; // the model works on a downscaled copy; the matte is scaled back up by the app

  let loading = null;

  function makeProgress(onProgress) {
    const files = new Map();
    return (e) => {
      if (!e || typeof onProgress !== 'function') return;
      if (e.status === 'progress' && e.file && Number(e.total) > 0) {
        files.set(e.file, { loaded: Number(e.loaded) || 0, total: Number(e.total) });
        let loaded = 0;
        let total = 0;
        files.forEach((f) => { loaded += f.loaded; total += f.total; });
        onProgress(Math.min(99, Math.round((loaded / total) * 100)));
      }
    };
  }

  function load(onProgress) {
    if (loading) return loading;
    loading = (async () => {
      const tf = await import(TRANSFORMERS_URL);
      tf.env.allowLocalModels = false;
      const cb = makeProgress(onProgress);
      const model = await tf.AutoModel.from_pretrained(MODEL_ID, { dtype: 'fp32', progress_callback: cb });
      const processor = await tf.AutoProcessor.from_pretrained(MODEL_ID);
      return { tf, model, processor };
    })();
    loading.catch(() => { loading = null; }); // allow a retry after a network error
    return loading;
  }

  async function matte(canvas, onProgress) {
    const { tf, model, processor } = await load(onProgress);

    // Downscale for speed and memory, then read RGB pixels.
    const scale = Math.min(1, MAX_SIDE / Math.max(canvas.width, canvas.height));
    const w = Math.max(1, Math.round(canvas.width * scale));
    const h = Math.max(1, Math.round(canvas.height * scale));
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    const ctx = small.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, w, h);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const rgb = new Uint8ClampedArray(w * h * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2];
    }

    const image = new tf.RawImage(rgb, w, h, 3);
    const { pixel_values } = await processor(image);
    const { output } = await model({ input: pixel_values });
    const mask = await tf.RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(w, h);
    return { data: new Uint8ClampedArray(mask.data), width: w, height: h };
  }

  window.BGAI = { matte };
})();
