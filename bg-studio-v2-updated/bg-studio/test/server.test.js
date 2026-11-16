'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createServer } = require('../server');

function listen(options) {
  return new Promise((resolve) => {
    const server = createServer(options);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function request(port, p, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: raw.toString('utf8'), raw });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('serves index with all security headers', async () => {
  const { server, port } = await listen({ adsDir: adsDirWith({}) });
  try {
    const r = await request(port, '/');
    assert.equal(r.status, 200);
    assert.match(r.body, /BG Studio/);
    assert.match(r.headers['content-security-policy'], /default-src 'none'/);
    assert.match(r.headers['content-security-policy'], /script-src 'self'/);
    assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.ok(!/unsafe-inline|(?<!wasm-)unsafe-eval/.test(r.headers['content-security-policy']));
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.equal(r.headers['cross-origin-opener-policy'], 'same-origin');
    assert.equal(r.headers['x-powered-by'], undefined);
  } finally { server.close(); }
});

test('path traversal and sensitive files are never served', async () => {
  const { server, port } = await listen();
  try {
    const attempts = [
      '/../server.js', '/%2e%2e/server.js', '/..%2fserver.js', '/%2e%2e%2fpackage.json',
      '/js/../../package.json', '/..\\server.js', '/%00', '/.git/config', '/.env',
      '/js/%2e%2e/%2e%2e/server.js', '//etc/passwd', '/server.js', '/package.json', '/test/server.test.js',
    ];
    for (const p of attempts) {
      const r = await request(port, p);
      assert.notEqual(r.status, 200, `${p} must not return 200`);
      assert.ok(!r.body.includes('createServer'), `${p} must not leak server source`);
    }
  } finally { server.close(); }
});

test('only GET and HEAD are allowed', async () => {
  const { server, port } = await listen();
  try {
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const r = await request(port, '/', m);
      assert.equal(r.status, 405, m);
      assert.equal(r.headers.allow, 'GET, HEAD');
    }
    const head = await request(port, '/', 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
  } finally { server.close(); }
});

test('overlong URLs are rejected', async () => {
  const { server, port } = await listen();
  try {
    const r = await request(port, `/${'a'.repeat(3000)}`);
    assert.equal(r.status, 400);
  } finally { server.close(); }
});

test('rate limiting kicks in', async () => {
  const { server, port } = await listen({ rateLimitMax: 5, rateLimitWindowMs: 60000 });
  try {
    const statuses = [];
    for (let i = 0; i < 8; i++) statuses.push((await request(port, '/healthz')).status);
    assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
    assert.equal(statuses[5], 429);
    const r = await request(port, '/healthz');
    assert.ok(r.headers['retry-after']);
  } finally { server.close(); }
});

test('HTTPS mode adds HSTS and upgrade-insecure-requests', async () => {
  const { server, port } = await listen({ httpsMode: true });
  try {
    const r = await request(port, '/');
    assert.match(r.headers['strict-transport-security'], /max-age=31536000/);
    assert.match(r.headers['content-security-policy'], /upgrade-insecure-requests/);
  } finally { server.close(); }
});

// ---- Adsterra ------------------------------------------------------------------------------

function adsDirWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgs-ads-'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

const BANNER_728 = `<script type="text/javascript">
  atOptions = {'key' : 'abcdef0123456789abcdef0123456789', 'format' : 'iframe', 'height' : 90, 'width' : 728, 'params' : {}};
</script>
<script type="text/javascript" src="//www.highperformanceformat.com/abcdef0123456789abcdef0123456789/invoke.js"></script>`;

test('ads are off by default: strict CSP, nothing from ad networks, no ads.txt, no ad frames', async () => {
  const { server, port } = await listen({ adsDir: adsDirWith({}) });
  try {
    const page = await request(port, '/');
    const csp = page.headers['content-security-policy'];
    assert.ok(!/adsterra|profitable|highperformance/i.test(csp));
    assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net 'wasm-unsafe-eval'/);
    assert.ok(!/frame-src/.test(csp), 'no frames are allowed without ads');
    assert.ok(!/style-src[^;]*unsafe-inline/.test(csp));
    assert.ok(!/http-equiv="Content-Security-Policy"/i.test(page.body), 'no duplicate meta CSP');
    assert.equal(page.headers['referrer-policy'], 'no-referrer');

    const cfg = JSON.parse((await request(port, '/ads-config.json')).body);
    assert.equal(cfg.enabled, false);
    assert.equal((await request(port, '/ads.txt')).status, 404);
    assert.equal((await request(port, '/ad/728x90.html')).status, 404);
    assert.equal((await request(port, '/ad/native.html')).status, 404);
  } finally { server.close(); }
});

test('AI mode: CSP allows only the pinned model/runtime hosts', async () => {
  const { server, port } = await listen({ adsDir: adsDirWith({}) });
  try {
    const csp = (await request(port, '/')).headers['content-security-policy'];
    assert.match(csp, /connect-src 'self' https:\/\/cdn\.jsdelivr\.net https:\/\/huggingface\.co/);
    assert.match(csp, /worker-src 'self' blob:/);
    assert.ok(!/script-src[^;]*\s(https:|\*)(\s|;|$)/.test(csp), 'no wildcard script sources');
    const ai = await request(port, '/js/ai.js');
    assert.match(ai.body, /transformers@3\.8\.0/, 'library version is pinned');
  } finally { server.close(); }
});

test('banner ads: served from a sandboxed frame page with its own policy; main CSP only gains frame-src self', async () => {
  const dir = adsDirWith({ 'banner-728x90.txt': `# note\n${BANNER_728}\n` });
  const { server, port } = await listen({ adsDir: dir });
  try {
    const csp = (await request(port, '/')).headers['content-security-policy'];
    assert.match(csp, /frame-src 'self'(;|$)/);
    assert.ok(!/highperformanceformat/.test(csp), 'banner hosts are not added to the main page policy');
    assert.ok(!/style-src[^;]*unsafe-inline/.test(csp));

    const cfg = JSON.parse((await request(port, '/ads-config.json')).body);
    assert.deepEqual(cfg.banners, ['728x90']);
    assert.equal(cfg.enabled, true);

    const frame = await request(port, '/ad/728x90.html');
    assert.equal(frame.status, 200);
    assert.match(frame.body, /atOptions = \{"key":"abcdef0123456789abcdef0123456789","format":"iframe","height":90,"width":728/);
    assert.match(frame.body, /src="https:\/\/www\.highperformanceformat\.com\/abcdef0123456789abcdef0123456789\/invoke\.js"/);
    assert.equal(frame.headers['x-frame-options'], 'SAMEORIGIN');
    assert.match(frame.headers['content-security-policy'], /frame-ancestors 'self'/);
    assert.equal((await request(port, '/ad/300x250.html')).status, 404, 'unconfigured sizes are 404');
  } finally { server.close(); }
});

test('social bar and popunder widen the main policy only for their own host', async () => {
  const dir = adsDirWith({
    'social-bar.txt': `<script type='text/javascript' src='//pl99.profitablecpmrate.com/aa/bb/cc/aabbcc.js'></script>`,
    'popunder.txt': `<script type='text/javascript' src='//pl98.profitablecpmrate.com/dd/ee/ff/ddeeff.js'></script>`,
    'smartlink.txt': 'https://www.profitablecpmrate.com/abc123?key=zzz',
  });
  const { server, port } = await listen({ adsDir: dir });
  try {
    const csp = (await request(port, '/')).headers['content-security-policy'];
    assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net 'wasm-unsafe-eval' https:\/\/pl99\.profitablecpmrate\.com https:\/\/pl98\.profitablecpmrate\.com/);
    assert.match(csp, /style-src 'self' 'unsafe-inline'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.ok(!/script-src[^;]*\s(https:|\*)(\s|;|$)/.test(csp), 'script sources stay explicit hosts');
    const cfg = JSON.parse((await request(port, '/ads-config.json')).body);
    assert.equal(cfg.socialBar, 'https://pl99.profitablecpmrate.com/aa/bb/cc/aabbcc.js');
    assert.equal(cfg.smartlink, 'https://www.profitablecpmrate.com/abc123?key=zzz');
    assert.equal((await request(port, '/')).headers['referrer-policy'], 'strict-origin-when-cross-origin');
  } finally { server.close(); }
});

test('native banner and ads.txt are built from validated values', async () => {
  const dir = adsDirWith({
    'native-banner.txt': `<script async="async" data-cfasync="false" src="//pl1.example-ads.com/0123abcd/invoke.js"></script>\n<div id="container-0123abcdef4567"></div>`,
    'ads.txt': '# comment\nadsterra.com, 1234567, DIRECT, abcdef123456\nnot a valid line <script>\n',
  });
  const { server, port } = await listen({ adsDir: dir });
  try {
    const native = await request(port, '/ad/native.html');
    assert.equal(native.status, 200);
    assert.match(native.body, /id="container-0123abcdef4567"/);
    const txt = await request(port, '/ads.txt');
    assert.equal(txt.status, 200);
    assert.equal(txt.body, 'adsterra.com, 1234567, DIRECT, abcdef123456\n');
  } finally { server.close(); }
});

test('malformed or hostile ad snippets are rejected and nothing is injected', async () => {
  const dir = adsDirWith({
    'banner-728x90.txt': `atOptions = {'key' : 'abc', 'format':'iframe'};\n<script src="https://x.com/a.js"></script>`,                 // key too short
    'banner-468x60.txt': `atOptions = {'key' : 'abcdef0123456789abcdef', 'format':'iframe'};\n<script src="javascript:alert(1)"></script>`, // bad scheme
    'banner-320x50.txt': `atOptions = {'key' : 'ab"><script>alert(1)</script>', 'format':'iframe'};\n<script src="https://x.example.com/a.js"></script>`, // key with markup
    'social-bar.txt': `<script src="http://insecure.example.com/x.js"></script>`,                                                       // http
    'popunder.txt': `<script src="https://user:pw@example.com/x.js"></script>`,                                                       // credentials
    'smartlink.txt': 'javascript:alert(1)',
    'native-banner.txt': `<script src="https://a.example.com/x.js"></script><div id="container-<img src=x>"></div>`,
  });
  const { server, port } = await listen({ adsDir: dir });
  try {
    const cfg = JSON.parse((await request(port, '/ads-config.json')).body);
    assert.deepEqual(cfg, { enabled: false, banners: [], native: false, socialBar: '', popunder: '', smartlink: '' });
    const csp = (await request(port, '/')).headers['content-security-policy'];
    assert.ok(!/example\.com|evil/.test(csp));
    for (const p of ['/ad/728x90.html', '/ad/468x60.html', '/ad/320x50.html', '/ad/native.html']) {
      assert.equal((await request(port, p)).status, 404, p);
    }
  } finally { server.close(); }
});

test('quote-breaking payload in a script URL cannot add attributes to the ad frame', async () => {
  const dir = adsDirWith({
    'banner-320x50.txt': `atOptions = {'key' : 'abcdef0123456789abcdef', 'format':'iframe'};\n<script src='https://ads.example.com/x.js" onerror="alert(1)'></script>`,
  });
  const { server, port } = await listen({ adsDir: dir });
  try {
    const frame = await request(port, '/ad/320x50.html');
    assert.equal(frame.status, 200);
    assert.ok(!/onerror|alert/.test(frame.body), 'payload is dropped, only a clean https URL is used');
    assert.match(frame.body, /src="https:\/\/ads\.example\.com\/x\.js"/);
  } finally { server.close(); }
});

test('removed pages (compress / resize) redirect to the home page', async () => {
  const { server, port } = await listen();
  try {
    for (const p of ['/compress-image-to-100kb.html', '/resize-image.html']) {
      const r = await request(port, p);
      assert.equal(r.status, 301, p);
      assert.equal(r.headers.location, '/');
    }
  } finally { server.close(); }
});

test('v2 product: only background removal + converter, with ad slots and a logo', async () => {
  const { server, port } = await listen();
  try {
    const r = await request(port, '/');
    assert.ok(!/id="width"|id="height"|id="target"|data-scale/.test(r.body), 'no resize / target-size controls');
    assert.match(r.body, /name="engine"/);
    assert.match(r.body, /id="btn-download"/);
    assert.match(r.body, /<img class="logo" src="favicon\.svg"/);
    for (const size of ['728x90', '320x50', '300x250', '468x60', 'native']) {
      assert.match(r.body, new RegExp(`data-ad="${size}" hidden`), `${size} slot starts hidden`);
    }
    assert.match(r.body, /data-smartlink[^>]*hidden/);
    for (const js of ['bgcore.js', 'ai.js', 'app.js', 'ads.js']) assert.match(r.body, new RegExp(`js/${js}`));
  } finally { server.close(); }
});

test('SEO: robots.txt and sitemap.xml use SITE_URL when valid', async () => {
  const { server, port } = await listen({ siteUrl: 'https://bgstudio.example.com/' });
  try {
    const robots = await request(port, '/robots.txt');
    assert.equal(robots.status, 200);
    assert.match(robots.body, /Sitemap: https:\/\/bgstudio\.example\.com\/sitemap\.xml/);
    const map = await request(port, '/sitemap.xml');
    assert.equal(map.status, 200);
    assert.match(map.headers['content-type'], /application\/xml/);
    assert.match(map.body, /<loc>https:\/\/bgstudio\.example\.com\/<\/loc>/);
    assert.match(map.body, /<loc>https:\/\/bgstudio\.example\.com\/privacy\.html<\/loc>/);
    // every landing page is listed, and nothing else
    const listed = [...map.body.matchAll(/<loc>https:\/\/bgstudio\.example\.com([^<]*)<\/loc>/g)].map((m) => m[1]);
    const expected = fs.readdirSync(path.join(__dirname, '..', 'public'))
      .filter((f) => f.endsWith('.html')).map((f) => (f === 'index.html' ? '/' : `/${f}`)).sort();
    assert.deepEqual([...listed].sort(), expected);
    assert.ok(listed.length >= 8, 'index + landing pages + privacy');
  } finally { server.close(); }
});

test('SEO: invalid or unsafe SITE_URL is ignored', async () => {
  for (const bad of ['http://example.com', 'https://exa mple.com', 'https://x.com/<script>', 'javascript:alert(1)', 'https://localhost', '']) {
    const { server, port } = await listen({ siteUrl: bad });
    try {
      assert.equal((await request(port, '/sitemap.xml')).status, 404, bad);
      const robots = await request(port, '/robots.txt');
      assert.ok(!/Sitemap:/.test(robots.body), bad);
    } finally { server.close(); }
  }
});

test('SEO: page has title, description, structured data and visible how-to content', async () => {
  const { server, port } = await listen();
  try {
    const r = await request(port, '/');
    assert.match(r.body, /<title>[^<]*Background Remover[^<]*<\/title>/);
    assert.match(r.body, /<meta name="description" content="[^"]{80,}/);
    assert.match(r.body, /application\/ld\+json/);
    assert.match(r.body, /How do I remove the background from an image\?/);
  } finally { server.close(); }
});

test('privacy policy page is served', async () => {
  const { server, port } = await listen();
  try {
    const r = await request(port, '/privacy.html');
    assert.equal(r.status, 200);
    assert.match(r.body, /Privacy Policy/);
  } finally { server.close(); }
});

test('GCash support number is present on the page', async () => {
  const { server, port } = await listen();
  try {
    const r = await request(port, '/');
    assert.ok(r.body.includes('0991 143 2311'));
    assert.ok(r.body.includes('data-copy="09911432311"'));
  } finally { server.close(); }
});

const LANDING = [
  'make-background-transparent', 'remove-white-background', 'remove-background-from-signature',
  'png-to-jpg', 'jpg-to-png', 'webp-to-png',
];

test('SEO: every landing page has a unique title, description, h1, the full tool and a FAQ', async () => {
  const { server, port } = await listen();
  try {
    const titles = new Set();
    const descriptions = new Set();
    for (const slug of LANDING) {
      const r = await request(port, `/${slug}.html`);
      assert.equal(r.status, 200, slug);
      const title = (r.body.match(/<title>([^<]+)<\/title>/) || [])[1];
      const desc = (r.body.match(/<meta name="description" content="([^"]+)"/) || [])[1];
      assert.ok(title && title.length <= 70, `${slug} title length`);
      assert.ok(desc && desc.length >= 80 && desc.length <= 175, `${slug} description length (${desc && desc.length})`);
      titles.add(title);
      descriptions.add(desc);
      assert.equal((r.body.match(/<h1>/g) || []).length, 1, `${slug} has exactly one h1`);
      assert.match(r.body, /id="dropzone"/, `${slug} contains the tool`);
      assert.match(r.body, /id="btn-download"/, slug);
      assert.match(r.body, /FAQPage/, slug);
      assert.ok(r.body.includes('0991 143 2311'), `${slug} keeps the GCash number`);
      assert.ok(!/<script(?![^>]*(src=|type="application\/ld\+json"))[^>]*>/.test(r.body), `${slug} has no inline scripts (CSP)`);
      assert.ok(!/\sstyle="/.test(r.body), `${slug} has no inline styles (CSP)`);
    }
    assert.equal(titles.size, LANDING.length, 'titles are unique');
    assert.equal(descriptions.size, LANDING.length, 'descriptions are unique');
  } finally { server.close(); }
});

test('SEO: canonical, Open Graph and breadcrumbs use SITE_URL; nothing leaks without it', async () => {
  const withSite = await listen({ siteUrl: 'https://bgstudio.example.com' });
  try {
    const home = await request(withSite.port, '/');
    assert.match(home.body, /<link rel="canonical" href="https:\/\/bgstudio\.example\.com\/">/);
    assert.match(home.body, /<meta property="og:image" content="https:\/\/bgstudio\.example\.com\/og-image\.png">/);
    assert.match(home.body, /BreadcrumbList/);
    const sub = await request(withSite.port, '/png-to-jpg.html');
    assert.match(sub.body, /<link rel="canonical" href="https:\/\/bgstudio\.example\.com\/png-to-jpg\.html">/);
    assert.ok(!sub.body.includes('__SITE_URL__'));
    // the JSON-LD must stay valid JSON after substitution
    for (const m of sub.body.matchAll(/<script type="application\/ld\+json">([^]*?)<\/script>/g)) JSON.parse(m[1]);
  } finally { withSite.server.close(); }

  const noSite = await listen();
  try {
    for (const p of ['/', '/png-to-jpg.html', '/privacy.html']) {
      const r = await request(noSite.port, p);
      assert.ok(!r.body.includes('__SITE_URL__'), `${p} must not expose the placeholder`);
      assert.ok(!/rel="canonical"/.test(r.body), `${p} must not ship a canonical without SITE_URL`);
      for (const m of r.body.matchAll(/<script type="application\/ld\+json">([^]*?)<\/script>/g)) JSON.parse(m[1]);
    }
  } finally { noSite.server.close(); }
});

test('SEO: the index page keeps its Tagalog section and /index.html redirects to /', async () => {
  const { server, port } = await listen();
  try {
    const r = await request(port, '/');
    assert.match(r.body, /Paano alisin ang background ng picture\?/);
    assert.match(r.body, /lang="fil"/);
    const redirect = await request(port, '/index.html');
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.location, '/');
  } finally { server.close(); }
});

test('performance: gzip, ETag and 304 revalidation', async () => {
  const { server, port } = await listen();
  try {
    const plain = await request(port, '/css/style.css');
    assert.equal(plain.status, 200);
    assert.equal(plain.headers['content-encoding'], undefined);

    const gz = await request(port, '/css/style.css', 'GET', { 'Accept-Encoding': 'gzip' });
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.equal(gz.headers.vary, 'Accept-Encoding');
    assert.ok(gz.raw.length < plain.raw.length / 2, 'gzip is meaningfully smaller');
    assert.equal(zlib.gunzipSync(gz.raw).toString('utf8'), plain.body);
    assert.notEqual(gz.headers.etag, plain.headers.etag);

    for (const tag of [gz.headers.etag, plain.headers.etag, `W/${gz.headers.etag}`]) {
      const cond = await request(port, '/css/style.css', 'GET', { 'Accept-Encoding': 'gzip', 'If-None-Match': tag });
      assert.equal(cond.status, 304, tag);
      assert.equal(cond.raw.length, 0);
      assert.match(cond.headers['content-security-policy'], /default-src 'none'/);
    }
    const stale = await request(port, '/css/style.css', 'GET', { 'If-None-Match': '"nope"' });
    assert.equal(stale.status, 200);

    const head = await request(port, '/', 'HEAD', { 'Accept-Encoding': 'gzip' });
    assert.equal(head.status, 200);
    assert.equal(head.raw.length, 0);
    assert.ok(Number(head.headers['content-length']) > 0);
  } finally { server.close(); }
});

test('social/preview images are served as PNG', async () => {
  const { server, port } = await listen();
  try {
    for (const f of ['/og-image.png', '/apple-touch-icon.png']) {
      const r = await request(port, f);
      assert.equal(r.status, 200, f);
      assert.equal(r.headers['content-type'], 'image/png');
      assert.deepEqual([...r.raw.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    }
  } finally { server.close(); }
});
