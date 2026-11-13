(() => {
  'use strict';

  // Optional Google AdSense loader. Does nothing unless the server was started with a valid
  // ADSENSE_CLIENT (see README). The IDs are re-validated here before anything is created.
  const slotEl = document.getElementById('ad-slot');
  if (!slotEl) return;

  fetch('ads-config.json', { credentials: 'omit', cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((cfg) => {
      if (!cfg || cfg.enabled !== true) return;
      const client = String(cfg.client || '');
      const slot = String(cfg.slot || '');
      if (!/^ca-pub-\d{10,20}$/.test(client)) return;

      const s = document.createElement('script');
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
      document.head.appendChild(s);

      if (/^\d{5,20}$/.test(slot)) {
        // Manual ad unit: replace the placeholder with a responsive AdSense unit.
        slotEl.textContent = '';
        const ins = document.createElement('ins');
        ins.className = 'adsbygoogle';
        ins.setAttribute('data-ad-client', client);
        ins.setAttribute('data-ad-slot', slot);
        ins.setAttribute('data-ad-format', 'auto');
        ins.setAttribute('data-full-width-responsive', 'true');
        slotEl.appendChild(ins);
        try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* ignore */ }
      } else {
        // No slot ID: Google Auto ads decide placement, so hide the placeholder box.
        slotEl.hidden = true;
      }
    })
    .catch(() => { /* ads are optional; never break the tool */ });
})();
