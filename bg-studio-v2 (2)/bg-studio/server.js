'use strict';

/**
 * Hardened zero-dependency static file server for BG Studio.
 * - GET/HEAD only, strict path resolution (no traversal, no dotfiles, no symlink escape)
 * - Extension allow-list
 * - Strict security headers (CSP, nosniff, frame-ancestors none, COOP/CORP, HSTS when behind HTTPS)
 * - Per-IP rate limiting, request/header size & time limits
 * - No third-party packages => no supply-chain attack surface
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { loadAdsterra, publicConfig, framePage, hasAds, FRAME_CSP } = require('./lib/adsterra');

const PUBLIC_DIR = fs.realpathSync(path.join(__dirname, 'public'));

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json'],
]);

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.svg', '.txt', '.webmanifest']);
const MAX_CACHED_FILE = 5 * 1024 * 1024; // larger files are streamed instead of held in memory

/**
 * Fills the "__SITE_URL__" placeholders (canonical, Open Graph, breadcrumbs) used by the generated pages.
 * Lines that need the site URL are dropped when SITE_URL is not configured, so a page never ships a
 * broken or relative canonical link.
 */
function applySiteUrl(html, site) {
  const out = [];
  for (const line of html.split('\n')) {
    if (!line.includes('__SITE_URL__')) out.push(line);
    else if (site) out.push(line.split('__SITE_URL__').join(site));
  }
  return out.join('\n');
}

/** Every public/*.html page, for sitemap.xml ('/' first, privacy policy last). */
function listPagePaths() {
  let files = [];
  try { files = fs.readdirSync(PUBLIC_DIR); } catch { /* no pages */ }
  const paths = files
    .filter((f) => /^[a-z0-9-]+\.html$/i.test(f))
    .map((f) => (f === 'index.html' ? '/' : `/${f}`));
  const rank = (p) => (p === '/' ? 0 : p === '/privacy.html' ? 2 : 1);
  return paths.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Accepts only a plain https origin like https://example.com (no path, no query). */
function parseSiteUrl(value) {
  const v = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
  const ok = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{2,5})?$/i.test(v);
  return ok ? v : null;
}

// The optional AI background remover loads Transformers.js + ONNX Runtime from jsDelivr and the model
// files from Hugging Face. Nothing else is allowed, and no image is ever sent anywhere.
const AI_SCRIPT_ORIGIN = 'https://cdn.jsdelivr.net';
const AI_CONNECT = [AI_SCRIPT_ORIGIN, 'https://huggingface.co', 'https://*.huggingface.co', 'https://*.hf.co'];

function buildSecurityHeaders(httpsMode, ads) {
  const cfg = ads || {};
  const adsOn = hasAds(cfg);
  const frameAds = Boolean(Object.keys(cfg.banners || {}).length || cfg.native);
  // Social Bar and Popunder must run inside the page itself, so they need a wider policy.
  const inject = [cfg.socialBar, cfg.popunder].filter(Boolean);
  const injectHosts = [...new Set(inject.map((u) => new URL(u).origin))];

  const csp = [
    "default-src 'none'",
    `script-src ${["'self'", AI_SCRIPT_ORIGIN, "'wasm-unsafe-eval'", ...injectHosts].join(' ')}`,
    inject.length ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    inject.length ? "img-src 'self' data: https:" : "img-src 'self' data:",
    `connect-src ${["'self'", ...AI_CONNECT, ...(inject.length ? ['https:'] : [])].join(' ')}`,
    frameAds || inject.length ? `frame-src ${["'self'", ...(inject.length ? ['https:'] : [])].join(' ')}` : null,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].filter(Boolean);
  if (httpsMode) csp.push('upgrade-insecure-requests');

  const headers = {
    'Content-Security-Policy': csp.join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': adsOn ? 'strict-origin-when-cross-origin' : 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-DNS-Prefetch-Control': 'off',
    'X-Permitted-Cross-Domain-Policies': 'none',
  };
  if (httpsMode) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

function makeLimiter(max, windowMs) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs);
  timer.unref();

  return {
    check(key) {
      const now = Date.now();
      if (hits.size > 50000) hits.clear(); // hard memory cap
      let entry = hits.get(key);
      if (!entry || entry.reset <= now) {
        entry = { count: 0, reset: now + windowMs };
        hits.set(key, entry);
      }
      entry.count++;
      return { allowed: entry.count <= max, retryAfter: Math.max(1, Math.ceil((entry.reset - now) / 1000)) };
    },
    close() { clearInterval(timer); },
  };
}

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff) {
      const parts = xff.split(',');
      return parts[parts.length - 1].trim(); // the entry appended by our own proxy
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

/** Maps a request URL to a file inside PUBLIC_DIR, or null if it is not acceptable. */
function resolveRequestPath(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048 || rawUrl[0] !== '/') return null;
  const pathname = rawUrl.split('?')[0].split('#')[0];

  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;

  let segments = decoded.split('/').filter(Boolean);
  // Rejects '.', '..' and every dotfile / dot-directory (.git, .env, ...)
  if (segments.some((s) => s.startsWith('.'))) return null;
  if (segments.length === 0) segments = ['index.html'];

  const file = path.join(PUBLIC_DIR, ...segments);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return null;
  return file;
}

function createServer(options = {}) {
  const {
    rateLimitMax = 120,
    rateLimitWindowMs = 60000,
    trustProxy = false,
    httpsMode = false,
    adsDir = path.join(__dirname, 'adsterra'),
    siteUrl = '',
  } = options;

  const site = parseSiteUrl(siteUrl);
  const ads = loadAdsterra(adsDir);
  const securityHeaders = buildSecurityHeaders(httpsMode, ads);
  const frameHeaders = { 'Content-Security-Policy': FRAME_CSP, 'X-Frame-Options': 'SAMEORIGIN' };
  const limiter = makeLimiter(rateLimitMax, rateLimitWindowMs);
  const assetCache = new Map(); // real path -> { mtimeMs, size, body, gz, etag }

  function send(req, res, status, type, body, extra) {
    res.writeHead(status, {
      ...securityHeaders,
      'Content-Type': type,
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      ...extra,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  function reply(req, res, status, text, extra) {
    send(req, res, status, 'text/plain; charset=utf-8', `${text}\n`, extra);
  }

  /** Reads a file once, applies the SITE_URL placeholders to HTML, and keeps gzip + ETag in memory. */
  function loadAsset(real, st, ext, cb) {
    const hit = assetCache.get(real);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return cb(null, hit);
    fs.readFile(real, (err, buf) => {
      if (err) return cb(err);
      const body = ext === '.html' ? Buffer.from(applySiteUrl(buf.toString('utf8'), site), 'utf8') : buf;
      const hash = crypto.createHash('sha1').update(body).digest('hex').slice(0, 20);
      const entry = {
        mtimeMs: st.mtimeMs,
        size: st.size,
        body,
        gz: COMPRESSIBLE.has(ext) && body.length > 512 ? zlib.gzipSync(body, { level: 9 }) : null,
        etag: `"${hash}"`,
      };
      if (assetCache.size > 200) assetCache.clear();
      assetCache.set(real, entry);
      cb(null, entry);
    });
  }

  function notModified(req, etag) {
    const inm = req.headers['if-none-match'];
    if (typeof inm !== 'string') return false;
    const bare = etag.slice(1, -1);
    return inm.split(',').some((t) => t.trim().replace(/^W\//, '').replace(/-gz"$/, '"') === `"${bare}"`);
  }

  function serveFile(req, res, file) {
    const ext = path.extname(file).toLowerCase();
    const type = MIME.get(ext);
    if (!type) return reply(req, res, 404, 'Not found');

    fs.realpath(file, (err, real) => {
      if (err || !real.startsWith(PUBLIC_DIR + path.sep)) return reply(req, res, 404, 'Not found');
      fs.stat(real, (statErr, st) => {
        if (statErr || !st.isFile()) return reply(req, res, 404, 'Not found');
        const cacheControl = ext === '.html' ? 'no-cache' : 'public, max-age=300';

        if (st.size > MAX_CACHED_FILE) {
          res.writeHead(200, { ...securityHeaders, 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': cacheControl });
          if (req.method === 'HEAD') { res.end(); return; }
          const stream = fs.createReadStream(real);
          stream.on('error', () => res.destroy());
          stream.pipe(res);
          return;
        }

        loadAsset(real, st, ext, (loadErr, entry) => {
          if (loadErr) return reply(req, res, 404, 'Not found');
          const gzip = Boolean(entry.gz) && /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));
          const headers = {
            ...securityHeaders,
            'Content-Type': type,
            'Cache-Control': cacheControl,
            ETag: gzip ? `${entry.etag.slice(0, -1)}-gz"` : entry.etag,
            Vary: 'Accept-Encoding',
          };
          if (notModified(req, entry.etag)) { res.writeHead(304, headers); res.end(); return; }
          const body = gzip ? entry.gz : entry.body;
          if (gzip) headers['Content-Encoding'] = 'gzip';
          headers['Content-Length'] = body.length;
          res.writeHead(200, headers);
          res.end(req.method === 'HEAD' ? undefined : body);
        });
      });
    });
  }

  const server = http.createServer(
    { maxHeaderSize: 8192, requestTimeout: 15000, headersTimeout: 10000, keepAliveTimeout: 5000 },
    (req, res) => {
      req.resume(); // we never read request bodies

      const rl = limiter.check(clientIp(req, trustProxy));
      if (!rl.allowed) return reply(req, res, 429, 'Too many requests', { 'Retry-After': String(rl.retryAfter) });

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return reply(req, res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
      }

      const pathOnly = String(req.url).split('?')[0];

      // One address per page: /index.html permanently redirects to /
      if (pathOnly === '/index.html') {
        return send(req, res, 301, 'text/plain; charset=utf-8', 'Moved\n', { Location: '/', 'Cache-Control': 'public, max-age=3600' });
      }

      if (pathOnly === '/healthz') return reply(req, res, 200, 'ok');

      // Pages that were removed in v2 (compress / resize) forward to the home page.
      if (pathOnly === '/compress-image-to-100kb.html' || pathOnly === '/resize-image.html') {
        return send(req, res, 301, 'text/plain; charset=utf-8', 'Moved\n', { Location: '/', 'Cache-Control': 'public, max-age=3600' });
      }

      if (pathOnly === '/ads-config.json') {
        return send(req, res, 200, 'application/json; charset=utf-8', JSON.stringify(publicConfig(ads)));
      }

      // Banner / native ad frames (built from the validated /adsterra files, sandboxed by the page).
      const frame = /^\/ad\/(native|\d{2,3}x\d{2,3})\.html$/.exec(pathOnly);
      if (frame) {
        const html = framePage(ads, frame[1]);
        if (!html) return reply(req, res, 404, 'Not found');
        return send(req, res, 200, 'text/html; charset=utf-8', html, frameHeaders);
      }

      // With SITE_URL set, robots.txt and sitemap.xml point search engines at your real domain.
      if (site && pathOnly === '/robots.txt') {
        return send(req, res, 200, 'text/plain; charset=utf-8',
          `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`, { 'Cache-Control': 'public, max-age=3600' });
      }

      if (pathOnly === '/sitemap.xml') {
        if (!site) return reply(req, res, 404, 'Not found');
        const urls = listPagePaths().map((p) => `  <url><loc>${site}${p}</loc></url>\n`).join('');
        const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
          + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
          + urls
          + '</urlset>\n';
        return send(req, res, 200, 'application/xml; charset=utf-8', xml, { 'Cache-Control': 'public, max-age=3600' });
      }

      if (pathOnly === '/ads.txt') {
        if (!ads.adsTxt) return reply(req, res, 404, 'Not found');
        return send(req, res, 200, 'text/plain; charset=utf-8', `${ads.adsTxt}\n`, { 'Cache-Control': 'public, max-age=3600' });
      }

      const file = resolveRequestPath(req.url);
      if (!file) return reply(req, res, 400, 'Bad request');
      return serveFile(req, res, file);
    },
  );

  server.maxRequestsPerSocket = 100;
  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    else socket.destroy();
  });
  server.on('close', () => limiter.close());
  return server;
}

module.exports = { createServer, resolveRequestPath, parseSiteUrl, applySiteUrl };

if (require.main === module) {
  const port = parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer({
    trustProxy: process.env.TRUST_PROXY === '1',
    httpsMode: process.env.BEHIND_HTTPS === '1',
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '120', 10),
    siteUrl: process.env.SITE_URL || '',
  });
  if (process.env.SITE_URL && !parseSiteUrl(process.env.SITE_URL)) {
    console.warn('SITE_URL must look like https://yourdomain.com (https, no path); sitemap/robots stay default.');
  }
  const adsEnabled = hasAds(loadAdsterra(path.join(__dirname, 'adsterra')));
  server.listen(port, host, () => {
    console.log(`BG Studio running at http://${host}:${port} (Adsterra ads ${adsEnabled ? 'ENABLED' : 'off (see adsterra/README.txt)'})`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
