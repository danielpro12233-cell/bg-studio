'use strict';

/**
 * Adsterra support. You paste the codes Adsterra gives you ("GET CODE") into the text files in the
 * /adsterra folder; this module reads them once at start-up, validates every value strictly and builds:
 *
 *   - /ads-config.json      what the page may show (no secrets, just validated URLs)
 *   - /ad/<size>.html       tiny "ad frames" that hold the banner code. Banner scripts run inside a
 *                           sandboxed iframe, so they can never touch the tool or the visitor's image.
 *   - /ads.txt              from adsterra/ads.txt (optional)
 *   - extra Content-Security-Policy origins, added ONLY for what you actually configured
 *
 * Nothing in the files is ever copied into a page as raw HTML: only a validated https URL, a hex key
 * and fixed numbers are used.
 */

const fs = require('node:fs');
const path = require('node:path');

const BANNER_SIZES = ['728x90', '468x60', '320x50', '300x250', '160x300', '160x600'];

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const KEY_RE = /^[A-Za-z0-9]{16,64}$/;
const CONTAINER_RE = /^container-[A-Za-z0-9]{8,64}$/;

/** Accepts only a plain https URL with a real hostname (no credentials). "//host/x" becomes https. */
function cleanUrl(value) {
  let u = typeof value === 'string' ? value.trim() : '';
  if (u.startsWith('//')) u = `https:${u}`;
  if (u.length > 600 || /[\s"'<>`\\]/.test(u)) return '';
  let parsed;
  try { parsed = new URL(u); } catch { return ''; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return '';
  if (!HOST_RE.test(parsed.hostname)) return '';
  return parsed.href;
}

function readSnippet(dir, name) {
  try {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    return text.length > 20000 ? '' : text.replace(/^\s*#.*$/gm, ''); // lines starting with # are notes
  } catch { return ''; }
}

const scriptSrc = (text) => cleanUrl((/<script[^>]*\ssrc\s*=\s*["']([^"']+)["']/i.exec(text) || [])[1]);
const firstUrl = (text) => cleanUrl((/(?:https?:)?\/\/[^\s"'<>]+/i.exec(text) || [])[0]);

function parseBanner(text) {
  const key = (/['"]key['"]\s*:\s*['"]([A-Za-z0-9]+)['"]/.exec(text) || [])[1] || '';
  const src = scriptSrc(text);
  return KEY_RE.test(key) && src ? { key, src } : null;
}

function parseNative(text) {
  const src = scriptSrc(text);
  const id = (/id\s*=\s*["'](container-[A-Za-z0-9]+)["']/.exec(text) || [])[1] || '';
  return src && CONTAINER_RE.test(id) ? { src, containerId: id } : null;
}

function parseAdsTxt(text) {
  const ok = /^[a-z0-9.-]+\s*,\s*[A-Za-z0-9_-]+\s*,\s*(DIRECT|RESELLER)(\s*,\s*[a-f0-9]+)?$/i;
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  return lines.filter((l) => ok.test(l)).join('\n');
}

/** Reads the /adsterra folder. Returns a frozen description of what is configured. */
function loadAdsterra(dir) {
  const out = { banners: {}, native: null, socialBar: '', popunder: '', smartlink: '', adsTxt: '' };
  if (!dir) return out;

  for (const size of BANNER_SIZES) {
    const b = parseBanner(readSnippet(dir, `banner-${size}.txt`));
    if (b) out.banners[size] = b;
  }
  out.native = parseNative(readSnippet(dir, 'native-banner.txt'));
  out.socialBar = scriptSrc(readSnippet(dir, 'social-bar.txt'));
  out.popunder = scriptSrc(readSnippet(dir, 'popunder.txt'));
  out.smartlink = firstUrl(readSnippet(dir, 'smartlink.txt'));
  try { out.adsTxt = parseAdsTxt(fs.readFileSync(path.join(dir, 'ads.txt'), 'utf8')); } catch { /* optional */ }
  return out;
}

const hasAds = (c) => Boolean(Object.keys(c.banners).length || c.native || c.socialBar || c.popunder || c.smartlink);

/** What the browser is told (see public/js/ads.js). */
function publicConfig(c) {
  return {
    enabled: hasAds(c),
    banners: Object.keys(c.banners),
    native: Boolean(c.native),
    socialBar: c.socialBar,
    popunder: c.popunder,
    smartlink: c.smartlink,
  };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** HTML for /ad/<name>.html, or null when that unit is not configured. */
function framePage(c, name) {
  const head = '<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Advertisement</title>'
    + '<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style></head><body>';
  const tail = '</body></html>';

  if (name === 'native') {
    if (!c.native) return null;
    return `${head}<script async="async" data-cfasync="false" src="${esc(c.native.src)}"></script>`
      + `<div id="${esc(c.native.containerId)}"></div>${tail}`;
  }
  const m = /^(\d{2,3})x(\d{2,3})$/.exec(name);
  const b = m && c.banners[name];
  if (!b) return null;
  const opts = { key: b.key, format: 'iframe', height: Number(m[2]), width: Number(m[1]), params: {} };
  const json = JSON.stringify(opts).replace(/</g, '\\u003c');
  return `${head}<script>atOptions = ${json};</script><script src="${esc(b.src)}"></script>${tail}`;
}

/** Policy for the ad frames. They are sandboxed and hold no user data, so they may talk to ad networks. */
const FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https:",
  "style-src 'unsafe-inline' https:",
  "img-src https: data:",
  "font-src https: data:",
  "media-src https:",
  "connect-src https:",
  "frame-src https:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
  "object-src 'none'",
].join('; ');

module.exports = { loadAdsterra, publicConfig, framePage, hasAds, cleanUrl, parseAdsTxt, FRAME_CSP, BANNER_SIZES };
