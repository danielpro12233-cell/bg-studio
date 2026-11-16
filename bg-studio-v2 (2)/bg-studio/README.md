# BG Studio

A privacy-first image tool that runs in the browser. Two jobs only:

- **Remove background**: **AI** (MODNet portrait matting via Transformers.js, loaded on demand, ~26 MB cached) or **Solid color** (gradient-aware region growing with edge matting and halo removal).
- **Convert**: PNG, JPG, WebP, AVIF, with quality and a fill color for transparent areas.

v2 removes resize and target-size compression. Images are never uploaded; only the AI model files are downloaded.

**Ads (Adsterra):** paste codes into `adsterra/*.txt` (see `adsterra/README.txt`). Banners/native run in sandboxed frames; Social Bar/Popunder run in the page and widen the CSP only for their own host.

**Licences:** MODNet and Transformers.js are Apache-2.0 (credited in the footer).

See `UPDATE-GUIDE.md` for GitHub + Render steps.

## Run it

Requires Node.js 18+ (no `npm install` needed, zero dependencies).

```bash
npm start            # http://127.0.0.1:3000
npm test             # server security tests + background-removal tests
```

Environment variables: `PORT`, `HOST` (default `127.0.0.1`), `TRUST_PROXY=1`, `BEHIND_HTTPS=1`, `RATE_LIMIT_MAX` (requests/min/IP, default 120), `SITE_URL`.

## Deploy

**Docker**

```bash
docker build -t bg-studio .
docker run -d --name bg-studio -p 127.0.0.1:3000:3000 --read-only --cap-drop ALL \
  --security-opt no-new-privileges -e TRUST_PROXY=1 -e BEHIND_HTTPS=1 bg-studio
```

**HTTPS (required in production):** put it behind a TLS terminator. `deploy/Caddyfile` is a ready example with automatic Let's Encrypt certificates. With `BEHIND_HTTPS=1` the server also sends HSTS and `upgrade-insecure-requests`.

## Your own domain name and getting found on Google

1. **Pick a domain.** Domains cannot contain spaces, so "BG Studio" becomes something like `bgstudio.com`, `bg-studio.ph` or `dapagbgremover.com`. Buy it from a registrar (Namecheap, GoDaddy, Cloudflare, or a `.ph` registrar). Check availability there; short names are often taken.
2. **Host the app** on a server that runs Node (a small VPS, Render, Railway, Fly.io, etc.) using `npm start` or the Dockerfile.
3. **Point DNS** at it: an `A` record to your server's IP (or a `CNAME` to your host's address), for both `yourdomain.com` and `www`. Use `deploy/Caddyfile` for automatic HTTPS.
4. **Set `SITE_URL`** so robots.txt and sitemap.xml use your real address:

   ```bash
   SITE_URL=https://yourdomain.com TRUST_PROXY=1 BEHIND_HTTPS=1 npm start
   ```

5. **Register with Google:** open Google Search Console, add your domain, verify ownership (a DNS TXT record), then submit `https://yourdomain.com/sitemap.xml`. Do the same in Bing Webmaster Tools.

Already built in for search engines:

- **7 landing pages**, one per thing people search for: `/` (background remover), `make-background-transparent`, `remove-white-background`, `remove-background-from-signature`, `compress-image-to-100kb`, `resize-image`, `png-to-jpg`. Each has its own title, meta description, single `<h1>`, how-to steps, tips, FAQ, internal links and the full working tool (the PNG to JPG and compress pages preselect JPEG).
- A Tagalog section on the home page ("Paano alisin ang background ng picture?") for Filipino searches.
- With `SITE_URL` set: canonical links, Open Graph / Twitter cards (`og-image.png`), `BreadcrumbList`, and an automatic `sitemap.xml` listing every page. `WebApplication` and `FAQPage` structured data are always present.
- Speed (a ranking factor): gzip, ETag / 304 revalidation, no third-party requests, no layout shift.

**Editing the pages:** the HTML files in `public/` (except `privacy.html`) are generated. Change the text in `scripts/build-pages.js`, then run `npm run build:pages`. To add a new landing page, add an entry to `PAGES` in that file and rebuild; it appears in the nav, footer, related links and sitemap automatically.

**Important:** set `SITE_URL` in production. Without it the canonical, Open Graph and breadcrumb lines are left out on purpose (a wrong or relative URL is worse than none).

Nobody can guarantee a #1 ranking. New sites usually take weeks to appear and longer to rank for competitive searches like "background remover". What helps most: a domain/name that includes your main keyword, more useful pages (for example "remove background from signature", "compress image to 100KB", "convert PNG to JPG"), fast loading, links from other sites, and sharing it on social media.

## Turn on Google AdSense (optional, off by default)

Ads are **disabled** until you provide your own AdSense publisher ID, so the site keeps its strictest security policy by default.

1. Create an AdSense account at adsense.google.com and add your site's domain. AdSense needs a real public domain (it does not work on `localhost`) and reviews the site before showing ads, which can take days.
2. Copy your publisher ID (looks like `ca-pub-1234567890123456`). Optionally create a display ad unit and copy its slot ID (digits only).
3. Start the server with the ID:

   ```bash
   # Windows (Command Prompt)
   set ADSENSE_CLIENT=ca-pub-1234567890123456
   set ADSENSE_SLOT=1234567890
   npm start

   # Linux / macOS / Docker
   ADSENSE_CLIENT=ca-pub-1234567890123456 ADSENSE_SLOT=1234567890 npm start
   docker run ... -e ADSENSE_CLIENT=ca-pub-1234567890123456 -e ADSENSE_SLOT=1234567890 bg-studio
   ```

What happens automatically when it is enabled:

- The security policy is widened **only** for Google's ad domains (no `unsafe-inline`, no wildcards) and the referrer policy becomes `strict-origin-when-cross-origin`.
- `/ads.txt` is served with the line AdSense requires.
- With a slot ID, a responsive ad unit replaces the "Your ad could be here" box. Without a slot ID, the box is hidden and Google Auto ads place ads for you (turn Auto ads on in your AdSense account).
- `privacy.html` (already included) discloses Google's cookies, which AdSense requires. Add your own contact email to it.

Notes: invalid IDs are ignored and ads stay off. Never click your own ads. AdSense may reject sites with very little content, so consider adding a short how-to / FAQ page. Ad networks load third-party code and set cookies, so the "no third-party code" guarantee only holds while ads are off. If ads show up blank, open the browser console: a "Refused to load" message names any extra Google domain that needs to be added to `GOOGLE_ADS` in `server.js`. This could not be tested against live Google ads in the build environment.

## Change the GCash number

Edit `public/index.html`, section "Support & advertise" (two places: the visible number and the `data-copy` attribute on the Copy button). The tests check for the current number, so update `test/server.test.js` too.

## Security design

| Area | What is done |
| --- | --- |
| No uploads | Files are decoded and processed client-side only (Canvas + Web Worker). |
| XSS | Strict CSP: `default-src 'none'; script-src 'self'; style-src 'self'` with **no** inline scripts/styles, no `eval`. No `innerHTML`; user data is only written with `textContent`. |
| Malicious files | Magic-byte sniffing (not just file extension), 25 MB and 40 MP limits, SVG rejected, download names sanitised. |
| Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY`. |
| Server | GET/HEAD only, path-traversal and dotfile blocking, symlink-escape check, extension allow-list, 8 KB header cap, request timeouts, per-IP rate limit, graceful error handling. |
| Headers | CSP, nosniff, Referrer-Policy `no-referrer`, Permissions-Policy (camera/mic/geo off), COOP, CORP, HSTS (HTTPS mode). |
| Supply chain | Zero npm dependencies, no CDN scripts, no external fonts. |
| Container | Non-root user, read-only filesystem friendly, healthcheck. |

## Honest limitations

- No website can be guaranteed "100% flawless". This one is built to minimise attack surface and is covered by automated tests, but keep Node.js updated, always serve over HTTPS and re-test after any change.
- Background removal is **colour-based**, not AI. It is excellent for studio shots, product photos, logos, signatures and solid backgrounds, but will not cut out a person from a busy street. An AI model (e.g. a segmentation model served from your own domain) can be added later; keep the CSP `script-src 'self'` and host model files yourself.
- AdSense needs third-party script/frame permissions that necessarily weaken the policy. That is why it is opt-in and limited to Google's exact domains. Keep it off if you want the strictest posture; GCash sponsorship needs no third-party code.
- Anyone who sees your GCash number can send you money, and can also look up the registered name when sending. Only publish a number you are comfortable making public.
