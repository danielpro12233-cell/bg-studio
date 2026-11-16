(() => {
  'use strict';

  // ---------- Limits ----------
  const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB upload
  const MAX_SIDE = 16384;                  // canvas safe limit
  const MAX_PIXELS = 40e6;                 // 40 megapixels
  const PREVIEW_MAX = 1400;                // preview long side

  const FORMATS = {
    png:  { mime: 'image/png',  ext: 'png',  lossy: false, name: 'PNG' },
    jpeg: { mime: 'image/jpeg', ext: 'jpg',  lossy: true,  name: 'JPG' },
    webp: { mime: 'image/webp', ext: 'webp', lossy: true,  name: 'WebP' },
    avif: { mime: 'image/avif', ext: 'avif', lossy: true,  name: 'AVIF' },
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    file: $('file'), drop: $('dropzone'), stage: $('stage'), preview: $('preview'), ghost: $('ghost'),
    info: $('info'), status: $('status'), result: $('result'),
    compare: $('btn-compare'), change: $('btn-change'),
    optsAi: $('opts-ai'), optsColor: $('opts-color'), aiEdge: $('ai-edge'), aiEdgeOut: $('ai-edge-out'),
    pick: $('btn-pick'), auto: $('btn-auto'), swatch: $('swatch'),
    tol: $('tolerance'), tolOut: $('tolerance-out'),
    feather: $('feather'), featherOut: $('feather-out'),
    shrink: $('shrink'), shrinkOut: $('shrink-out'),
    contiguous: $('contiguous'), remove: $('btn-remove'), reset: $('btn-reset'),
    format: $('format'), quality: $('quality'), qualityOut: $('quality-out'),
    bgmode: $('bgmode'), bgcolor: $('bgcolor'),
    download: $('btn-download'), copy: $('btn-copy'),
  };
  const engineRadios = Array.from(document.querySelectorAll('input[name="engine"]'));

  const state = {
    original: null,     // canvas holding the decoded source image
    current: null,      // canvas currently shown / exported
    fileName: 'image',
    fileSize: 0,
    removed: false,
    engine: 'ai',       // 'ai' | 'color'
    aiMatte: null,      // full-size 0..255 matte from the AI model (cached so the slider is instant)
    key: null,          // user-picked key colour, null = auto
    pickMode: false,
    busy: false,
    jobId: 0,
    worker: null,
    pending: false,     // a re-run was requested while the worker was busy
  };

  // ---------- Helpers ----------
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  const reduceMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduceMotion = () => Boolean(reduceMotionQuery && reduceMotionQuery.matches);
  const EASE = 'cubic-bezier(.22, 1, .36, 1)';

  function pulse(node) {
    if (reduceMotion()) return;
    node.classList.remove('pulse');
    void node.offsetWidth; // restart the animation
    node.classList.add('pulse');
  }

  function setStatus(msg, kind) {
    const text = msg || '';
    const changed = el.status.textContent !== text;
    el.status.textContent = text;
    el.status.dataset.kind = kind || 'info';
    if (text && changed) pulse(el.status);
  }

  function fillRange(input) {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--pct', `${clamp(pct, 0, 100)}%`);
  }

  function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function safeBaseName(name) {
    const base = String(name || '').replace(/\.[^.]*$/, '');
    const cleaned = base.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return cleaned || 'image';
  }

  function debounce(fn, ms) {
    let t = 0;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  const imageButtons = [el.pick, el.auto, el.remove, el.reset, el.download, el.change];

  function updateEnabled() {
    const has = !!state.original;
    imageButtons.forEach((b) => { b.disabled = !has || state.busy; });
    el.reset.disabled = !has || state.busy || !state.removed;
  }

  const spinnerButtons = [el.remove, el.auto, el.download];

  function setBusy(busy, message, spinnerBtn) {
    state.busy = busy;
    updateEnabled();
    el.stage.classList.toggle('is-busy', busy);
    el.stage.setAttribute('aria-busy', String(busy));
    spinnerButtons.forEach((b) => b.classList.toggle('is-busy', busy && b === spinnerBtn));
    if (message) setStatus(message, 'info');
    if (!busy && state.pending) {
      state.pending = false;
      queueMicrotask(() => { if (state.removed && !state.busy && state.engine === 'color') runColorRemoval(); });
    }
  }

  function canEncode(mime) {
    try { return makeCanvas(1, 1).toDataURL(mime).startsWith(`data:${mime}`); } catch { return false; }
  }

  async function sniffType(file) {
    const buf = new Uint8Array(await file.slice(0, 32).arrayBuffer());
    const ascii = (a, b) => String.fromCharCode(...buf.slice(a, b));
    if (buf[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
    if (ascii(0, 4) === 'GIF8') return 'gif';
    if (ascii(0, 2) === 'BM') return 'bmp';
    if (ascii(4, 8) === 'ftyp' && /^avi[fs]/.test(ascii(8, 12))) return 'avif';
    return null; // anything else (incl. SVG, HTML, executables) is rejected
  }

  // ---------- Preview ----------
  const previewCache = new WeakMap();

  function previewSource(image) {
    const scale = Math.min(1, PREVIEW_MAX / Math.max(image.width, image.height));
    if (scale >= 1) return { src: image, w: image.width, h: image.height };
    let c = previewCache.get(image);
    if (!c) {
      c = makeCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
      const cx = c.getContext('2d');
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(image, 0, 0, c.width, c.height);
      previewCache.set(image, c);
    }
    return { src: c, w: c.width, h: c.height };
  }

  let ghostAnim = null;

  function renderPreview(src, opts) {
    const image = src || state.current;
    if (!image) return;
    const { src: source, w, h } = previewSource(image);

    const canFade = Boolean(opts && opts.fade) && !reduceMotion() && !el.stage.hidden
      && el.preview.width === w && el.preview.height === h && typeof el.ghost.animate === 'function';
    if (ghostAnim) { ghostAnim.cancel(); ghostAnim = null; }
    if (canFade) {
      el.ghost.width = w;
      el.ghost.height = h;
      el.ghost.getContext('2d').drawImage(el.preview, 0, 0);
    }

    el.preview.width = w;
    el.preview.height = h;
    const ctx = el.preview.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
    el.info.textContent = `${image.width} × ${image.height}px · original ${fmtBytes(state.fileSize)}`;

    if (canFade) {
      ghostAnim = el.ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, easing: 'ease-out', fill: 'forwards' });
    }
  }

  function setSwatch(rgb) {
    if (!rgb) { el.swatch.hidden = true; return; }
    el.swatch.style.backgroundColor = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    el.swatch.hidden = false;
  }

  // ---------- Loading ----------
  async function loadFile(file) {
    if (!file || state.busy) return;
    if (file.size === 0) { setStatus('That file is empty.', 'error'); return; }
    if (file.size > MAX_FILE_BYTES) {
      setStatus(`That file is too large. Maximum is ${fmtBytes(MAX_FILE_BYTES)}.`, 'error');
      return;
    }
    const type = await sniffType(file);
    if (!type) {
      setStatus('Unsupported file. Please choose a PNG, JPEG, WebP, GIF, BMP or AVIF image.', 'error');
      return;
    }

    setBusy(true, 'Loading image…');
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      setBusy(false);
      setStatus('Could not read that image. It may be corrupted or unsupported by your browser.', 'error');
      return;
    }

    try {
      const { width, height } = bitmap;
      if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
        setStatus(`Image is too large (${width}×${height}). Maximum is ${MAX_SIDE}px per side and 40 megapixels.`, 'error');
        return;
      }
      const canvas = makeCanvas(width, height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);

      state.original = canvas;
      state.current = canvas;
      state.fileName = file.name;
      state.fileSize = file.size;
      state.removed = false;
      state.aiMatte = null;
      state.key = null;
      state.pickMode = false;
      state.jobId++;
      el.pick.setAttribute('aria-pressed', 'false');
      el.preview.classList.remove('picking');
      setSwatch(null);

      state.pending = false;
      const replacing = !el.stage.hidden;
      el.result.textContent = '';
      el.drop.hidden = true;
      el.stage.hidden = false;
      renderPreview();
      if (replacing && !reduceMotion() && typeof el.preview.animate === 'function') {
        el.preview.animate(
          [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }],
          { duration: 420, easing: EASE },
        );
      }
      if (window.innerWidth <= 900) {
        setTimeout(() => el.stage.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' }), 60);
      }
      setStatus(type === 'gif' ? 'Loaded (animated GIFs use the first frame).' : 'Image loaded. Press “Remove background”, or just convert it below.', 'ok');
    } finally {
      bitmap.close();
      setBusy(false);
    }
  }

  // ---------- Background removal: solid-colour engine (Web Worker) ----------
  function getWorker() {
    if (state.worker) return state.worker;
    const w = new Worker('js/worker.js');
    w.onmessage = onWorkerMessage;
    w.onerror = () => {
      w.terminate();
      state.worker = null;
      setBusy(false);
      setStatus('Background removal failed to run. Please reload the page and try again.', 'error');
    };
    state.worker = w;
    return w;
  }

  function onWorkerMessage(event) {
    const m = event.data;
    if (!m || m.id !== state.jobId || !state.original) return;
    setBusy(false);
    if (!m.ok) { setStatus('Background removal failed. Try a different image.', 'error'); return; }

    const { width, height } = state.original;
    const data = new Uint8ClampedArray(m.buffer);
    if (data.length !== width * height * 4) { setStatus('Background removal returned unexpected data.', 'error'); return; }

    const out = makeCanvas(width, height);
    out.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0);
    state.current = out;
    state.removed = true;
    setSwatch(state.key || m.key);
    updateEnabled();
    renderPreview(null, { fade: true });
    setStatus('Background removed. Not clean yet? Raise or lower Tolerance, or click “Pick color” and tap the background.', 'ok');
  }

  function runColorRemoval() {
    if (!state.original || state.busy) return;
    const { width, height } = state.original;
    let img;
    try {
      img = state.original.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height);
    } catch {
      setStatus('Could not read the image pixels.', 'error');
      return;
    }
    const id = ++state.jobId;
    setBusy(true, 'Removing background…', state.removeTrigger || el.remove);
    try {
      getWorker().postMessage({
        id,
        buffer: img.data.buffer,
        width,
        height,
        opts: {
          tolerance: Number(el.tol.value),
          feather: Number(el.feather.value),
          shrink: Number(el.shrink.value),
          contiguous: el.contiguous.checked,
          key: state.key,
        },
      }, [img.data.buffer]);
    } catch {
      setBusy(false);
      setStatus('Could not start background removal in this browser.', 'error');
    }
  }

  // ---------- Background removal: AI engine (runs in the browser, loaded on demand) ----------
  function upscaleMatte(m, width, height) {
    if (m.width === width && m.height === height) return m.data;
    const small = makeCanvas(m.width, m.height);
    const sctx = small.getContext('2d');
    const img = sctx.createImageData(m.width, m.height);
    for (let i = 0; i < m.data.length; i++) {
      const v = m.data[i];
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    const big = makeCanvas(width, height);
    const bctx = big.getContext('2d', { willReadFrequently: true });
    bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(small, 0, 0, width, height);
    const px = bctx.getImageData(0, 0, width, height).data;
    const out = new Uint8ClampedArray(width * height);
    for (let i = 0; i < out.length; i++) out[i] = px[i * 4];
    return out;
  }

  function applyAiMatte() {
    if (!state.original || !state.aiMatte || !window.BGCore) return;
    const { width, height } = state.original;
    const img = state.original.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height);
    window.BGCore.applyAlpha(img.data, state.aiMatte, width, height, Number(el.aiEdge.value));
    const out = makeCanvas(width, height);
    out.getContext('2d').putImageData(img, 0, 0);
    state.current = out;
    state.removed = true;
    updateEnabled();
    renderPreview(null, { fade: true });
  }

  async function runAiRemoval() {
    if (!state.original || state.busy) return;
    if (!window.BGAI || !window.BGCore) { setStatus('The AI module did not load. Please reload the page.', 'error'); return; }
    const id = ++state.jobId;
    setBusy(true, 'Starting AI… the first time it downloads a small model (about 26 MB).', el.remove);
    try {
      const m = await window.BGAI.matte(state.original, (pct) => {
        if (id === state.jobId) setStatus(`Downloading the AI model… ${pct}% (first time only)`, 'info');
      });
      if (id !== state.jobId || !state.original) return;
      state.aiMatte = upscaleMatte(m, state.original.width, state.original.height);
      applyAiMatte();
      setStatus('Done! Use “Cutout tightness” to fine-tune the edges. AI works best on people; for logos or plain backgrounds try “Solid color”.', 'ok');
    } catch {
      setStatus('The AI model could not load. Check your internet connection and try again, or use “Solid color”.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function runRemoval() {
    if (state.engine === 'ai') runAiRemoval(); else runColorRemoval();
  }

  const rerunIfRemoved = debounce(() => {
    if (!state.removed || state.engine !== 'color') return;
    if (state.busy) { state.pending = true; return; } // never drop a slider change
    runColorRemoval();
  }, 200);

  const reapplyAi = debounce(() => { if (state.engine === 'ai' && state.aiMatte && !state.busy) applyAiMatte(); }, 90);

  function setEngine(value) {
    state.engine = value === 'color' ? 'color' : 'ai';
    el.optsAi.hidden = state.engine !== 'ai';
    el.optsColor.hidden = state.engine !== 'color';
    engineRadios.forEach((r) => { r.checked = r.value === state.engine; });
    if (state.pickMode) {
      state.pickMode = false;
      el.pick.setAttribute('aria-pressed', 'false');
      el.preview.classList.remove('picking');
    }
  }

  // ---------- Convert / export ----------
  function buildOutput(fillColor) {
    const src = state.current;
    const out = makeCanvas(src.width, src.height);
    const ctx = out.getContext('2d');
    if (fillColor) {
      ctx.fillStyle = fillColor;
      ctx.fillRect(0, 0, out.width, out.height);
    }
    ctx.drawImage(src, 0, 0);
    return out;
  }

  function encode(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('Export failed. The image may be too large for this browser.')); return; }
        if (blob.type !== mime) {
          reject(new Error(`This browser can't create ${mime.split('/')[1].toUpperCase()} files. Choose another format.`));
          return;
        }
        resolve(blob);
      }, mime, quality);
    });
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  async function onDownload() {
    if (!state.current || state.busy) return;
    const fmt = FORMATS[el.format.value];
    if (!fmt) return;

    const needsFill = fmt.mime === 'image/jpeg' || el.bgmode.value === 'fill';
    const color = /^#[0-9a-fA-F]{6}$/.test(el.bgcolor.value) ? el.bgcolor.value : '#ffffff';

    setBusy(true, 'Converting…', el.download);
    try {
      await new Promise((r) => setTimeout(r, 0));
      const out = buildOutput(needsFill ? color : null);
      const q = clamp(parseInt(el.quality.value, 10) || 90, 1, 100) / 100;
      const blob = await encode(out, fmt.mime, q);
      saveBlob(blob, `${safeBaseName(state.fileName)}-bgstudio.${fmt.ext}`);
      el.result.textContent = `${fmt.name} · ${out.width}×${out.height}px · ${fmtBytes(blob.size)}`;
      pulse(el.result);
      setStatus('Done. Your download has started.', 'ok');
    } catch (err) {
      setStatus(err && err.message ? err.message : 'Export failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function syncFormatControls() {
    const fmt = FORMATS[el.format.value];
    el.quality.disabled = !fmt || !fmt.lossy;
    if (fmt && fmt.mime === 'image/jpeg') {
      el.bgmode.value = 'fill';
      el.bgmode.disabled = true;
    } else {
      el.bgmode.disabled = false;
    }
  }

  // ---------- Events ----------
  el.file.addEventListener('change', () => {
    const f = el.file.files && el.file.files[0];
    el.file.value = '';
    loadFile(f);
  });
  el.change.addEventListener('click', () => el.file.click());

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!state.original) el.drop.classList.add('drag');
  });
  window.addEventListener('dragleave', (e) => {
    if (e.target === document.documentElement || e.relatedTarget === null) el.drop.classList.remove('drag');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    el.drop.classList.remove('drag');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  document.addEventListener('paste', (e) => {
    const files = e.clipboardData && e.clipboardData.files;
    if (files && files[0]) loadFile(files[0]);
  });

  engineRadios.forEach((r) => r.addEventListener('change', () => { if (r.checked) setEngine(r.value); }));
  el.remove.addEventListener('click', runRemoval);

  el.auto.addEventListener('click', () => {
    state.key = null;
    setSwatch(null);
    state.removeTrigger = el.auto;
    runColorRemoval();
    state.removeTrigger = null;
  });

  el.reset.addEventListener('click', () => {
    if (!state.original) return;
    state.current = state.original;
    state.removed = false;
    state.pending = false;
    state.aiMatte = null;
    state.key = null;
    setSwatch(null);
    updateEnabled();
    renderPreview(null, { fade: true });
    setStatus('Restored the original image.', 'ok');
  });

  el.pick.addEventListener('click', () => {
    if (!state.original) return;
    state.pickMode = !state.pickMode;
    el.pick.setAttribute('aria-pressed', String(state.pickMode));
    el.preview.classList.toggle('picking', state.pickMode);
    setStatus(state.pickMode ? 'Click the background color in the preview.' : '', 'info');
  });

  el.preview.addEventListener('click', (e) => {
    if (!state.pickMode || !state.original) return;
    const rect = el.preview.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const { width, height } = state.original;
    const x = clamp(Math.floor(((e.clientX - rect.left) / rect.width) * width), 0, width - 1);
    const y = clamp(Math.floor(((e.clientY - rect.top) / rect.height) * height), 0, height - 1);
    const px = state.original.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data;
    state.key = [px[0], px[1], px[2]];
    state.pickMode = false;
    el.pick.setAttribute('aria-pressed', 'false');
    el.preview.classList.remove('picking');
    setSwatch(state.key);
    runColorRemoval();
  });

  let comparing = false;
  const showOriginal = () => { if (state.original && !comparing) { comparing = true; renderPreview(state.original, { fade: true }); } };
  const showCurrent = () => { if (state.current && comparing) { comparing = false; renderPreview(state.current, { fade: true }); } };
  el.compare.addEventListener('pointerdown', showOriginal);
  ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach((n) => el.compare.addEventListener(n, showCurrent));
  el.compare.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') showOriginal(); });
  el.compare.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') showCurrent(); });

  [[el.tol, el.tolOut], [el.feather, el.featherOut], [el.shrink, el.shrinkOut]].forEach(([input, out]) => {
    input.addEventListener('input', () => { out.textContent = input.value; fillRange(input); rerunIfRemoved(); });
  });
  el.contiguous.addEventListener('change', rerunIfRemoved);
  el.aiEdge.addEventListener('input', () => { el.aiEdgeOut.textContent = el.aiEdge.value; fillRange(el.aiEdge); reapplyAi(); });

  el.quality.addEventListener('input', () => { el.qualityOut.textContent = `${el.quality.value}%`; fillRange(el.quality); });
  el.format.addEventListener('change', syncFormatControls);
  el.download.addEventListener('click', onDownload);

  el.copy.addEventListener('click', async () => {
    const number = el.copy.dataset.copy || '';
    const original = 'Copy number';
    try {
      await navigator.clipboard.writeText(number);
      el.copy.textContent = 'Copied!';
    } catch {
      el.copy.textContent = 'Copy failed';
    }
    setTimeout(() => { el.copy.textContent = original; }, 1800);
  });

  // ---------- Init ----------
  Array.from(el.format.options).forEach((opt) => {
    const f = FORMATS[opt.value];
    if (f && !canEncode(f.mime)) {
      opt.disabled = true;
      opt.textContent = `${f.name} (not supported by this browser)`;
      if (el.format.value === opt.value) el.format.value = 'png';
    }
  });
  // Landing pages can preselect a format and an engine: <body data-format="jpeg" data-engine="color">.
  const wanted = document.body.dataset.format;
  const wantedOpt = wanted && Array.from(el.format.options).find((o) => o.value === wanted && !o.disabled);
  if (wantedOpt) el.format.value = wanted;
  setEngine(document.body.dataset.engine === 'color' ? 'color' : 'ai');

  document.querySelectorAll('input[type="range"]').forEach(fillRange);
  syncFormatControls();
  updateEnabled();

  // Scroll-reveal for content below the fold (never hides anything already visible; no JS = all visible).
  const revealEls = Array.from(document.querySelectorAll('.reveal'));
  if (revealEls.length && 'IntersectionObserver' in window && !reduceMotion()) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    revealEls.forEach((node) => {
      if (node.getBoundingClientRect().top > window.innerHeight) {
        node.classList.add('pre');
        io.observe(node);
      }
    });
  }
})();
