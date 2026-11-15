# Paano i-update ang BG Studio sa GitHub at Render

## A. Ilagay ang Adsterra codes

1. Sa Adsterra > Websites, i-click ang **GET CODE** ng bawat unit at i-copy ang code.
2. Sa GitHub repo mo, buksan ang folder `adsterra/` at ang tamang file (hal. `banner-728x90.txt`).
3. I-click ang pencil (Edit), i-paste ang code SA IBABA ng mga linyang may `#`, tapos **Commit changes**.
4. Ulitin sa ibang units. Walang laman = hindi lalabas ang ad na iyon. Basahin ang `adsterra/README.txt`.

## B. Paraan 1: Browser lang (walang install)

1. I-extract ang zip sa computer mo.
2. Sa github.com, buksan ang repo mo > **Add file > Upload files**.
3. I-drag ang LAHAT ng laman ng `bg-studio` folder (kasama ang `public`, `lib`, `adsterra`, `scripts`, `test`, `deploy`). Mag-o-overwrite ang lumang files.
4. I-delete sa repo ang `public/compress-image-to-100kb.html` at `public/resize-image.html` (buksan ang file > tatlong tuldok > Delete file). May redirect na papunta sa home.
5. Mag-type ng message (hal. "BG Studio v2") > **Commit changes**.

## C. Paraan 2: Git

```bash
cd bg-studio                 # folder na may .git
# ilagay ang bagong files (palitan ang luma), tapos:
git rm -f public/compress-image-to-100kb.html public/resize-image.html
git add -A
git commit -m "BG Studio v2: AI remover, converter, Adsterra"
git push
```

## D. Render

- **May Blueprint ka na (render.yaml):** awtomatiko. Pag-push mo, magde-deploy ang Render. Tingnan sa Render > Events at hintayin ang **Live**.
- **Wala pa:** Render > New > Blueprint > piliin ang repo > Apply. Ilagay ang `SITE_URL` (hal. `https://bg-studio.onrender.com`).
- Kung hindi nag-deploy: ang service > **Manual Deploy > Deploy latest commit**.
- Bawat pagpalit ng ad code sa GitHub, magre-redeploy ulit nang kusa.

## E. Test pagkatapos mag-Live

1. Mag-upload ng picture ng tao, AI mode, **Remove background**. Sa unang beses magda-download ito ng ~26 MB model (normal); mabilis na pagkatapos.
2. Subukan ang Solid color sa logo/pirma, at ang Convert & download.
3. Buksan ang `iyong-site/ads-config.json`: `"enabled": true` = may nabasang ad code.
4. Kung walang lumalabas na ad: minsan inaabot ng ilang oras ang bagong Adsterra units, at hinaharang ito ng ad-blocker.

## F. Paalala

- Free plan ng Render: natutulog ang site pag walang bisita (30-60 seg bago gumising).
- Ang Social Bar at Popunder ay tumatakbo sa mismong page, kaya lumuluwag ang security policy. Ang banners/native ay nasa sandboxed frame. Mas maganda sa bisita ang banners + smartlink lang.
- Local: `npm test`, `npm start`, buksan ang http://127.0.0.1:3000
