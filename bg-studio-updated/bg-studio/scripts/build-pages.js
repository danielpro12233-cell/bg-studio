'use strict';

/**
 * Generates the static, crawlable pages in public/ (index.html + one landing page per search topic).
 * Zero dependencies:   node scripts/build-pages.js    (or: npm run build:pages)
 *
 * Why separate pages? People search for specific things ("remove white background",
 * "compress image to 100kb", "png to jpg"). A dedicated page with its own title, headline and
 * helpful text can rank for each of those searches, and every page contains the full working tool.
 *
 * "__SITE_URL__" placeholders (canonical, Open Graph, breadcrumbs) are filled in by server.js from the
 * SITE_URL environment variable; lines that need it are dropped when SITE_URL is not set.
 */

const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'public');
const SITE_NAME = 'BG Studio';
const AUTHOR = 'Daniel Mendoza Reyes';

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** JSON for a <script type="application/ld+json"> block, safe against "</script>" breakouts. */
const ld = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

// ---------------------------------------------------------------------------------------------
// Page content
// ---------------------------------------------------------------------------------------------

const PAGES = [
  {
    slug: 'index',
    nav: 'Background remover',
    title: 'Free Background Remover Online – No Upload | BG Studio',
    description: 'Remove image backgrounds free online. Make backgrounds transparent, compress to a target KB, resize and convert PNG, JPG, WebP & AVIF. Private: no upload.',
    h1: 'Free Background Remover Online',
    lead: 'Remove the background from a photo, logo or signature, then compress, resize and convert it. Everything runs in your browser, so your images never leave your device.',
    focus: 'remove',
    aboutTitle: 'Free background remover, image compressor, resizer & converter',
    intro: 'BG Studio is a free online image tool that runs entirely in your browser. Remove the background from a photo, make an image file smaller, change its width and height, and convert between PNG, JPG, WebP and AVIF, all without uploading anything.',
    stepsTitle: 'How do I remove the background from an image?',
    steps: [
      'Drop your image into the page, or click to browse (you can also paste a screenshot).',
      'Click Remove background. The tool detects the background color automatically. For better results, click Pick color and tap the background.',
      'Adjust tolerance and edge softness until the edges look clean, then download as PNG or WebP to keep the transparent background.',
    ],
    faq: [
      ['How do I make an image file smaller?', 'Choose WebP, AVIF or JPEG and lower the quality slider, or type a target size in KB and the tool finds the best quality for you. Reducing the width and height shrinks the file even more.'],
      ['Which image format should I choose?', 'PNG is lossless and supports transparency. JPEG gives small photos but has no transparency. WebP is smaller than both and keeps transparency. AVIF is usually the smallest, in browsers that support it.'],
      ['Are my images uploaded or stored?', 'No. Everything happens on your own device, so your photos stay private.'],
      ['Is BG Studio really free?', 'Yes. There is no signup, no watermark and no daily limit. The site is supported by optional donations and sponsorships.'],
      ['Does it use AI?', 'No. It detects the background color and removes matching pixels, which makes it very fast and completely private. It works best on plain or evenly lit backgrounds such as studio shots, logos, scans and signatures. It will not cut a person out of a busy scene.'],
      ['Does it work on my phone?', 'Yes. The layout adapts to phones and tablets, and you can pick photos straight from your gallery or paste a screenshot.'],
      ['Which image types can I use?', 'PNG, JPEG, WebP, GIF (first frame), BMP and AVIF, up to 25 MB.'],
    ],
    tagalog: {
      title: 'Paano alisin ang background ng picture? (Tagalog)',
      intro: 'Ang BG Studio ay libreng background remover na gumagana mismo sa browser mo. Hindi ina-upload ang mga larawan mo, kaya pribado ito.',
      steps: [
        'I-drop, i-paste, o piliin ang larawan mula sa gallery o computer mo.',
        'I-click ang Remove background. Kung mali ang kulay na natanggal, i-click ang Pick color at pindutin ang background.',
        'Ayusin ang Tolerance hanggang malinis ang gilid, tapos i-download bilang PNG o WebP para manatiling transparent.',
      ],
      outro: 'Puwede mo ring paliitin ang file size (compress), baguhin ang width at height, at i-convert ang PNG, JPG, WebP o AVIF. Pinakamaganda ito sa plain na background gaya ng ID photo, product photo, logo, at pirma.',
    },
  },
  {
    slug: 'make-background-transparent',
    nav: 'Transparent background',
    title: 'Make Image Background Transparent Online – Free | BG Studio',
    description: 'Make an image background transparent online for free. Remove a solid background and save a transparent PNG or WebP. Runs in your browser; no upload, no signup.',
    h1: 'Make an Image Background Transparent',
    lead: 'Turn a solid background into transparency and save it as a PNG or WebP, ready for logos, stickers, slides and online shops.',
    focus: 'remove',
    format: 'png',
    aboutTitle: 'Transparent PNG maker',
    intro: 'A transparent background lets your logo, product or graphic sit on any color or photo without a box around it. BG Studio does this by detecting the background color and making the matching pixels transparent. It is fastest on logos, icons, product photos and scans with a plain background.',
    stepsTitle: 'How to make a background transparent',
    steps: [
      'Drop in your image or paste a screenshot.',
      'Click Remove background. If the wrong color is removed, click Pick color and tap the background.',
      'Raise Tolerance if a halo of background color remains; lower it if parts of your subject disappear.',
      'Keep the format on PNG or WebP, leave Transparent areas on “Keep transparent”, then click Convert & download.',
    ],
    tipsTitle: 'Tips for clean edges',
    tips: [
      'JPEG cannot store transparency, so pick PNG or WebP.',
      'Edge softness of 1–3 gives smooth edges; Edge shrink trims a thin colored outline.',
      'Keep “Only remove areas connected to the image edges” on to protect same-colored areas inside your subject.',
    ],
    faq: [
      ['Which format keeps a transparent background?', 'PNG, WebP and AVIF keep transparency. JPEG does not: it fills transparent areas with a solid color.'],
      ['Can I make a photo of a person transparent?', 'BG Studio removes backgrounds by color, not with AI, so it works best on plain, evenly lit backgrounds. A busy street or a cluttered room will not cut out cleanly.'],
      ['Why are there leftover edges around my subject?', 'Increase Tolerance a little, add an Edge shrink of 1 or 2, then download again.'],
      ['Is it free and private?', 'Yes. It is free to use and your image is processed on your own device, never uploaded.'],
    ],
  },
  {
    slug: 'remove-white-background',
    nav: 'Remove white background',
    title: 'Remove White Background from Image – Free Online | BG Studio',
    description: 'Remove the white background from any image online for free. Get a transparent PNG in seconds with adjustable tolerance and soft edges. No upload, no signup.',
    h1: 'Remove White Background from an Image',
    lead: 'Erase a white or near-white background and keep your subject. Great for product photos, logos, documents and scans.',
    focus: 'remove',
    format: 'png',
    aboutTitle: 'White background remover',
    intro: 'White backgrounds are the easiest to remove because they are so uniform. BG Studio finds the white (or off-white) area that touches the edges of your picture and turns it transparent, while leaving the rest of the image untouched.',
    stepsTitle: 'How to remove a white background',
    steps: [
      'Add your image by dropping, pasting or browsing.',
      'Click Pick color and tap the white area, or just press Auto-detect.',
      'Tune Tolerance: higher removes off-white and light grey shadows, lower keeps them.',
      'Download as PNG or WebP to keep the transparency.',
    ],
    tipsTitle: 'Tips for white backgrounds',
    tips: [
      'Photos taken on white paper often have grey shading. Raise Tolerance to about 30–45 to clear it.',
      'If white parts of your subject (teeth, eyes, text) start disappearing, keep “Only remove areas connected to the image edges” on.',
      'To do the opposite and fill transparent areas with white, set Transparent areas to “Fill with color”.',
    ],
    faq: [
      ['Will it remove the white inside my subject too?', 'Not by default. With the edge option on, only white that is connected to the image borders is removed, so white inside the subject stays.'],
      ['What tolerance should I use?', 'Start at 22. Raise it for shadows and off-white backgrounds, and lower it when the subject itself is very light.'],
      ['Can I remove other colors, like green or blue?', 'Yes. Click Pick color and tap any solid background color.'],
      ['Is my image uploaded?', 'No. Everything runs in your browser, so your picture never leaves your device.'],
    ],
  },
  {
    slug: 'remove-background-from-signature',
    nav: 'Signature',
    title: 'Remove Background from Signature Online – Free | BG Studio',
    description: 'Remove the background from a signature photo or scan and save a transparent PNG for documents, PDFs and emails. Free, private, no upload.',
    h1: 'Remove the Background from a Signature',
    lead: 'Photograph or scan your signature on white paper, then turn the paper transparent so it can be placed on forms, PDFs and emails.',
    focus: 'remove',
    format: 'png',
    aboutTitle: 'Transparent signature maker',
    intro: 'A signature on plain paper is an ideal subject for BG Studio: dark ink on a light, even background. Because everything happens in your browser, your signature is never uploaded to a server.',
    stepsTitle: 'How to make a transparent signature',
    steps: [
      'Sign with a dark pen on plain white paper and take a bright, even photo (or scan it).',
      'Add the photo to BG Studio and click Remove background.',
      'If paper shadows remain, raise Tolerance. If thin strokes start to fade, lower it.',
      'Optional: set Width to around 600 px, choose PNG and click Convert & download.',
    ],
    tipsTitle: 'Tips for a clean signature',
    tips: [
      'Good lighting matters most. Avoid shadows across the paper.',
      'A thicker dark pen gives cleaner edges.',
      'Keep the file as PNG so the signature stays transparent when placed over a document.',
      'Only use your own signature, and keep the original file private.',
    ],
    faq: [
      ['Is my signature uploaded anywhere?', 'No. It is processed in your browser and never leaves your device, which matters for something this personal.'],
      ['What size should a signature image be?', 'Most forms work well with 400–800 px wide. Use Width & height to resize, or set a target KB to meet an upload limit.'],
      ['Why does my signature look jagged?', 'Use a higher-resolution photo and raise Edge softness to 2 or 3.'],
    ],
  },
  {
    slug: 'compress-image-to-100kb',
    nav: 'Compress image',
    title: 'Compress Image to 100KB, 200KB or Any Size – Free | BG Studio',
    description: 'Compress an image to 100KB, 200KB or any target size online for free. Set a max file size in KB and the tool tunes the quality for you. No upload, private.',
    h1: 'Compress an Image to a Target File Size',
    lead: 'Need a photo under 100 KB or 200 KB for a form, job application or ID upload? Type the size you need and BG Studio finds the best quality that fits.',
    focus: 'format',
    format: 'jpeg',
    aboutTitle: 'Image compressor with target size in KB',
    intro: 'Many websites reject files above a size limit. Instead of guessing the quality setting, enter a Target max size and BG Studio tests several quality levels and keeps the highest one that stays under your limit.',
    stepsTitle: 'How to compress an image to a specific size',
    steps: [
      'Add your image.',
      'Under Format & compression, choose JPEG (accepted almost everywhere) or WebP.',
      'Type your limit in Target max size (KB), for example 100.',
      'Click Convert & download. The result line shows the final size and the quality that was used.',
    ],
    tipsTitle: 'If the file is still too big',
    tips: [
      'Reduce Width & height. Fewer pixels shrink a file far more than lower quality does.',
      'JPEG and WebP can hit a size target; PNG cannot because it is lossless.',
      'Photos compress much better than screenshots with sharp text.',
    ],
    faq: [
      ['How does the target size work?', 'The tool tries several quality levels and picks the highest one that produces a file at or below your limit.'],
      ['Will compression ruin my image?', 'Lossy formats discard tiny details. At around 70–85% quality most photos still look sharp.'],
      ['What is the largest image I can load?', 'Up to 25 MB, 16,384 px per side and 40 megapixels.'],
      ['Are my photos uploaded?', 'No. Compression happens in your browser, so your files stay on your device.'],
    ],
  },
  {
    slug: 'resize-image',
    nav: 'Resize image',
    title: 'Resize Image Online – Change Width and Height in Pixels | BG Studio',
    description: 'Resize an image online for free. Set an exact width and height in pixels, keep the aspect ratio, or scale by 25–75%. Private: no upload, no signup.',
    h1: 'Resize an Image: Change Width and Height',
    lead: 'Set exact pixel dimensions or scale by a percentage, with the aspect ratio locked so nothing gets stretched.',
    focus: 'resize',
    aboutTitle: 'Image resizer in pixels',
    intro: 'Whether you need a profile picture, a thumbnail or a smaller file for email, resizing takes seconds. Type a width or height and the other side updates automatically to keep the proportions.',
    stepsTitle: 'How to resize an image',
    steps: [
      'Add your image. Its current size is filled in for you.',
      'Type a new Width or Height. With Keep aspect ratio on, the other value follows automatically.',
      'Or tap 25%, 50% or 75% for a quick scale-down.',
      'Pick a format and click Convert & download.',
    ],
    tipsTitle: 'Resizing tips',
    tips: [
      'Make images smaller rather than bigger: enlarging adds no detail and looks soft.',
      'Untick Keep aspect ratio only if you want to stretch or squash the picture on purpose.',
      'Resizing down is also the quickest way to reduce file size.',
    ],
    faq: [
      ['How do I resize without losing quality?', 'Shrink in one go and save as PNG, or as WebP/JPEG at around 85% quality. Large reductions are done in steps with high-quality smoothing to keep edges clean.'],
      ['What is the maximum size?', 'Up to 16,384 px per side and 40 megapixels.'],
      ['Can I also limit the file size in KB?', 'Yes. Set a Target max size under Format & compression.'],
      ['Is my image uploaded?', 'No. Resizing happens in your browser.'],
    ],
  },
  {
    slug: 'png-to-jpg',
    nav: 'PNG to JPG',
    title: 'PNG to JPG Converter – Free, Private, No Upload | BG Studio',
    description: 'Convert PNG to JPG online for free. Also convert JPG, WebP and AVIF, set quality and fill transparent areas with a color. Runs in your browser; no upload.',
    h1: 'Convert PNG to JPG (and WebP, AVIF)',
    lead: 'Change an image’s format in a couple of clicks. JPG is small and works everywhere; transparent areas become the color you choose.',
    focus: 'format',
    format: 'jpeg',
    aboutTitle: 'Image format converter',
    intro: 'Pick a file, choose the format you need and download. BG Studio converts between PNG, JPG, WebP and AVIF right in your browser, so nothing is uploaded and there is no waiting in a queue.',
    stepsTitle: 'How to convert PNG to JPG',
    steps: [
      'Add your PNG. JPG, WebP, GIF, BMP and AVIF files work too.',
      'In Format & compression, JPEG is already selected on this page. Choose another format if you prefer.',
      'Pick a Fill color for transparent areas (white by default) and set the quality.',
      'Click Convert & download.',
    ],
    tipsTitle: 'Choosing a format',
    tips: [
      'JPEG has no transparency, so transparent pixels are filled with a solid color.',
      'Use PNG for logos and screenshots, JPEG for photos, and WebP or AVIF for the smallest web images.',
      'AVIF is only offered if your browser can create it.',
    ],
    faq: [
      ['Why did my transparent background turn white?', 'JPEG cannot store transparency. Choose a different Fill color, or keep PNG or WebP to stay transparent.'],
      ['Is it JPG or JPEG?', 'They are the same format; only the file extension differs. BG Studio saves files as .jpg.'],
      ['Will converting reduce quality?', 'PNG to JPG is lossy. At 85–90% quality the difference is usually hard to see.'],
      ['Is my file uploaded?', 'No. Conversion happens in your browser and your image never leaves your device.'],
    ],
  },
];

// ---------------------------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------------------------

const href = (p) => (p.slug === 'index' ? './' : `${p.slug}.html`);
const urlPath = (p) => (p.slug === 'index' ? '/' : `/${p.slug}.html`);

const UPLOAD_ICON = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>';

function nav(current) {
  const links = PAGES.map((p) => {
    const cur = p.slug === current.slug ? ' aria-current="page"' : '';
    return `      <a href="${href(p)}"${cur}>${esc(p.nav)}</a>`;
  }).join('\n');
  return `    <nav class="tool-nav" aria-label="Image tools">\n${links}\n    </nav>`;
}

const TOOL = `  <main class="layout" id="tool">
    <section class="workspace" aria-label="Image workspace">
      <label class="dropzone" id="dropzone" for="file">
        <span class="dz-icon" aria-hidden="true">${UPLOAD_ICON}</span>
        <span class="dz-title">Drop an image here, paste it, or click to browse</span>
        <span class="dz-sub">PNG, JPEG, WebP, GIF, BMP or AVIF · up to 25&nbsp;MB</span>
      </label>
      <input type="file" id="file" class="visually-hidden" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif">

      <div class="stage-wrap" id="stage" hidden>
        <div class="progress" aria-hidden="true"></div>
        <div class="stage-toolbar">
          <span id="info" class="muted"></span>
          <span class="spacer"></span>
          <button type="button" class="btn small" id="btn-compare" title="Hold to see the original">Hold to compare</button>
          <button type="button" class="btn small" id="btn-change">Change image</button>
        </div>
        <div class="stage checker">
          <div class="canvas-holder">
            <canvas id="preview" aria-label="Image preview"></canvas>
            <canvas id="ghost" class="ghost" aria-hidden="true"></canvas>
          </div>
        </div>
      </div>

      <p id="status" class="status" role="status" aria-live="polite"></p>

      <aside class="ad-slot" id="ad-slot" aria-label="Advertisement">
        <span>Your ad could be here</span>
        <small>See “Support &amp; advertise” to get featured.</small>
      </aside>
    </section>

    <aside class="controls" aria-label="Tools">
      <fieldset class="card" data-card="remove">
        <legend>1 · Remove background</legend>
        <p class="hint">Works best on solid or evenly-lit backgrounds. Click “Pick color” and tap the background for precise results.</p>
        <div class="row">
          <button type="button" class="btn" id="btn-pick" aria-pressed="false" disabled>Pick color</button>
          <button type="button" class="btn" id="btn-auto" disabled>Auto-detect</button>
          <span class="swatch" id="swatch" hidden title="Background color being removed"></span>
        </div>
        <label class="field">
          <span>Tolerance <output id="tolerance-out">22</output></span>
          <input type="range" id="tolerance" min="0" max="100" value="22">
        </label>
        <label class="field">
          <span>Edge softness <output id="feather-out">1</output></span>
          <input type="range" id="feather" min="0" max="10" value="1">
        </label>
        <label class="field">
          <span>Edge shrink <output id="shrink-out">0</output></span>
          <input type="range" id="shrink" min="0" max="4" value="0">
        </label>
        <label class="check">
          <input type="checkbox" id="contiguous" checked>
          <span>Only remove areas connected to the image edges</span>
        </label>
        <div class="row">
          <button type="button" class="btn primary" id="btn-remove" disabled>Remove background</button>
          <button type="button" class="btn" id="btn-reset" disabled>Reset</button>
        </div>
      </fieldset>

      <fieldset class="card" data-card="resize">
        <legend>2 · Width &amp; height</legend>
        <div class="row two">
          <label class="field">
            <span>Width (px)</span>
            <input type="number" id="width" min="1" max="16384" step="1" inputmode="numeric" disabled>
          </label>
          <label class="field">
            <span>Height (px)</span>
            <input type="number" id="height" min="1" max="16384" step="1" inputmode="numeric" disabled>
          </label>
        </div>
        <label class="check">
          <input type="checkbox" id="lock" checked>
          <span>Keep aspect ratio</span>
        </label>
        <div class="row">
          <button type="button" class="btn small" data-scale="25" disabled>25%</button>
          <button type="button" class="btn small" data-scale="50" disabled>50%</button>
          <button type="button" class="btn small" data-scale="75" disabled>75%</button>
          <button type="button" class="btn small" data-scale="100" disabled>100%</button>
        </div>
      </fieldset>

      <fieldset class="card" data-card="format">
        <legend>3 · Format &amp; compression</legend>
        <label class="field">
          <span>Convert to</span>
          <select id="format">
            <option value="png">PNG (lossless, transparency)</option>
            <option value="jpeg">JPEG (small, no transparency)</option>
            <option value="webp" selected>WebP (small, transparency)</option>
            <option value="avif">AVIF (smallest, newer browsers)</option>
          </select>
        </label>
        <label class="field">
          <span>Quality <output id="quality-out">85%</output></span>
          <input type="range" id="quality" min="1" max="100" value="85">
        </label>
        <label class="field">
          <span>Target max size (KB) <small class="muted">optional</small></span>
          <input type="number" id="target" min="1" max="102400" step="1" inputmode="numeric" placeholder="e.g. 200">
        </label>
        <div class="row two">
          <label class="field">
            <span>Transparent areas</span>
            <select id="bgmode">
              <option value="keep">Keep transparent</option>
              <option value="fill">Fill with color</option>
            </select>
          </label>
          <label class="field">
            <span>Fill color</span>
            <input type="color" id="bgcolor" value="#ffffff">
          </label>
        </div>
        <button type="button" class="btn primary block" id="btn-download" disabled>Convert &amp; download</button>
        <p id="result" class="result" role="status" aria-live="polite"></p>
      </fieldset>

      <section class="card support" aria-labelledby="support-title">
        <h2 id="support-title">Support &amp; advertise</h2>
        <p>This tool is free. If it saved you time, you can support it, or sponsor / advertise on this site, via GCash.</p>
        <div class="gcash">
          <span class="gcash-label">GCash</span>
          <strong class="gcash-number" id="gcash-number">0991 143 2311</strong>
          <button type="button" class="btn small" id="btn-copy" data-copy="09911432311">Copy number</button>
        </div>
        <p class="muted small">Please double-check the number before sending. For advertising, include “AD” and your contact details in the GCash message.</p>
      </section>
    </aside>
  </main>`;

function faqBlock(page) {
  const items = page.faq.map(([q, a]) => `    <h3>${esc(q)}</h3>\n    <p>${esc(a)}</p>`).join('\n');
  return `  <section class="about reveal" aria-labelledby="faq-title">
    <h2 id="faq-title">Frequently asked questions</h2>
${items}
  </section>`;
}

function tagalogBlock(page) {
  const t = page.tagalog;
  if (!t) return '';
  const steps = t.steps.map((s) => `      <li>${esc(s)}</li>`).join('\n');
  return `
  <section class="about reveal" lang="fil" aria-labelledby="tl-title">
    <h2 id="tl-title">${esc(t.title)}</h2>
    <p>${esc(t.intro)}</p>
    <ol>
${steps}
    </ol>
    <p>${esc(t.outro)}</p>
  </section>
`;
}

function relatedBlock(page) {
  const links = PAGES.filter((p) => p.slug !== page.slug)
    .map((p) => `      <li><a href="${href(p)}">${esc(p.nav)}</a></li>`).join('\n');
  return `  <section class="about reveal" aria-labelledby="more-title">
    <h2 id="more-title">More free image tools</h2>
    <ul class="related">
${links}
    </ul>
  </section>`;
}

function aboutBlock(page) {
  const steps = page.steps.map((s) => `      <li>${esc(s)}</li>`).join('\n');
  const tips = page.tips
    ? `\n    <h3>${esc(page.tipsTitle || 'Tips')}</h3>\n    <ul>\n${page.tips.map((t) => `      <li>${esc(t)}</li>`).join('\n')}\n    </ul>`
    : '';
  return `  <section class="about" aria-labelledby="about-title">
    <h2 id="about-title">${esc(page.aboutTitle)}</h2>
    <p>${esc(page.intro)}</p>

    <h3>${esc(page.stepsTitle)}</h3>
    <ol>
${steps}
    </ol>${tips}
  </section>`;
}

function jsonLd(page) {
  const app = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: SITE_NAME,
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Any (web browser)',
    description: page.description,
    inLanguage: 'en',
    author: { '@type': 'Person', name: AUTHOR },
    browserRequirements: 'Requires JavaScript and a modern web browser',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'PHP' },
    featureList: [
      'Background remover',
      'Make backgrounds transparent',
      'Image compressor with target file size in KB',
      'Resize by width and height',
      'Convert PNG, JPEG, WebP and AVIF',
      'Private: images are never uploaded',
    ],
  };
  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: page.faq.map(([q, a]) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
  // Breadcrumbs need absolute URLs, so they live on one line that server.js fills in from SITE_URL.
  const crumbs = [{ '@type': 'ListItem', position: 1, name: SITE_NAME, item: '__SITE_URL__/' }];
  if (page.slug !== 'index') {
    crumbs.push({ '@type': 'ListItem', position: 2, name: page.nav, item: `__SITE_URL__${urlPath(page)}` });
  }
  const breadcrumb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs };

  return [
    `  <script type="application/ld+json">${ld(app)}</script>`,
    `  <script type="application/ld+json">${ld(faq)}</script>`,
    `  <script type="application/ld+json">${ld(breadcrumb)}</script>`,
  ].join('\n');
}

function render(page) {
  const isIndex = page.slug === 'index';
  const canonical = `__SITE_URL__${urlPath(page)}`;
  const bodyAttrs = [`data-focus="${page.focus}"`, page.format ? `data-format="${page.format}"` : ''].filter(Boolean).join(' ');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <!-- GENERATED by scripts/build-pages.js. Edit that file, then run: npm run build:pages -->
  <!-- The security policy is sent as an HTTP header by server.js. Do not duplicate it in a meta tag:
       a second policy would also be enforced and would block the optional ad scripts. -->
  <meta name="referrer" content="no-referrer">
  <title>${esc(page.title)}</title>
  <meta name="description" content="${esc(page.description)}">
  <meta name="author" content="${AUTHOR}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <meta name="theme-color" content="#5b5bf0">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:title" content="${esc(page.title)}">
  <meta property="og:description" content="${esc(page.description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="__SITE_URL__/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(page.title)}">
  <meta name="twitter:description" content="${esc(page.description)}">
  <meta name="twitter:image" content="__SITE_URL__/og-image.png">
${jsonLd(page)}
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="apple-touch-icon.png">
  <link rel="stylesheet" href="css/style.css">
  <script src="js/app.js" defer></script>
  <script src="js/ads.js" defer></script>
</head>
<body ${bodyAttrs}>
  <a class="skip" href="#tool">Skip to the tool</a>
  <header class="topbar">
    <a class="brand" href="./" aria-label="${SITE_NAME} home">
      <svg class="logo" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false">
        <rect width="32" height="32" rx="8" fill="currentColor" opacity=".15"/>
        <circle cx="16" cy="13" r="5" fill="currentColor"/>
        <path d="M6 27c1.5-5 5.5-8 10-8s8.500 3 10 8z" fill="currentColor"/>
      </svg>
      <span class="brand-name">${SITE_NAME}</span>
    </a>
    <p class="privacy-badge" title="All processing happens in your browser">🔒 Your images never leave your device</p>
${nav(page)}
  </header>

  <section class="hero">
    <h1>${esc(page.h1)}</h1>
    <p class="lead">${esc(page.lead)}</p>
  </section>

${TOOL}

${aboutBlock(page)}

${faqBlock(page)}
${isIndex ? tagalogBlock(page) : ''}
${relatedBlock(page)}

  <footer class="footer">
    <nav aria-label="Footer">
${PAGES.map((p) => `      <a href="${href(p)}">${esc(p.nav)}</a>`).join('\n')}
      <a href="privacy.html">Privacy policy</a>
    </nav>
    <p>Images are processed locally in your browser and are never uploaded. SVG files are intentionally not accepted for security reasons.</p>
    <p>Created by ${AUTHOR}.</p>
  </footer>
</body>
</html>
`;
}

for (const page of PAGES) {
  const file = path.join(OUT, `${page.slug}.html`);
  fs.writeFileSync(file, render(page));
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
