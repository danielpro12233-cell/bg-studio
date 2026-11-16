(() => {
  'use strict';

  // Optional Adsterra ads. Does nothing unless you pasted codes into the /adsterra folder (see
  // adsterra/README.txt). The server validates everything; the values are re-checked here too.
  // Banner and native ads live in sandboxed iframes (/ad/*.html) so ad code can never touch the tool.

  const slots = Array.from(document.querySelectorAll('.ad[data-ad]'));
  const smart = Array.from(document.querySelectorAll('[data-smartlink]'));
  if (!slots.length && !smart.length) return;

  const isHttps = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };

  function addScript(src) {
    if (!isHttps(src) || document.querySelector(`script[data-ad-script="${CSS.escape(src)}"]`)) return;
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.setAttribute('data-ad-script', src);
    s.setAttribute('data-cfasync', 'false');
    document.body.appendChild(s);
  }

  function addFrame(slot, name) {
    const m = /^(\d{2,3})x(\d{2,3})$/.exec(name);
    const f = document.createElement('iframe');
    f.src = `ad/${name}.html`;
    f.title = 'Advertisement';
    f.loading = 'lazy';
    f.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation');
    f.setAttribute('scrolling', 'no');
    f.setAttribute('frameborder', '0');
    if (m) { f.width = m[1]; f.height = m[2]; } else { f.width = '300'; f.height = '300'; f.className = 'ad-native'; }
    slot.appendChild(f);
    slot.hidden = false;
  }

  fetch('ads-config.json', { credentials: 'omit', cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((cfg) => {
      if (!cfg || cfg.enabled !== true) return;

      slots.forEach((slot) => {
        const name = slot.dataset.ad;
        const available = name === 'native' ? cfg.native === true : Array.isArray(cfg.banners) && cfg.banners.includes(name);
        // A slot hidden by CSS (e.g. the desktop banner on a phone) is skipped, so no wasted impression.
        slot.hidden = false;
        const visible = slot.offsetParent !== null;
        slot.hidden = true;
        if (available && visible) addFrame(slot, name);
      });

      smart.forEach((a) => {
        if (typeof cfg.smartlink === 'string' && isHttps(cfg.smartlink)) {
          a.href = cfg.smartlink;
          a.hidden = false;
        }
      });

      // These two must run in the page itself (they draw the bar / open the pop-under on click).
      if (typeof cfg.socialBar === 'string' && cfg.socialBar) addScript(cfg.socialBar);
      if (typeof cfg.popunder === 'string' && cfg.popunder) addScript(cfg.popunder);
    })
    .catch(() => { /* ads are optional; never break the tool */ });
})();
