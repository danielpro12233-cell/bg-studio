# Gawing public ang BG Studio (Render)

Pagkatapos nito, may public link ka na na mabubuksan ng kahit sino, kahit patay ang laptop mo.

1. Gumawa ng libreng account sa https://github.com at mag-create ng bagong repository (hal. `bg-studio`).
2. I-upload ang LAHAT ng laman ng bg-studio folder (kasama ang `render.yaml`) sa repository.
   (Sa GitHub: Add file > Upload files. Huwag i-upload ang .zip mismo; i-extract muna.)
3. Gumawa ng libreng account sa https://render.com at piliin ang "Sign in with GitHub".
4. Sa Render: New > Blueprint > piliin ang repository mo > Apply.
5. Hihingin nito ang `SITE_URL`. Ilagay ang magiging link mo, halimbawa `https://bg-studio.onrender.com`
   (makikita mo ang eksaktong link sa dashboard pagkatapos mag-deploy; pwede mo itong baguhin sa Environment).
6. Maghintay ng ilang minuto hanggang "Live". Buksan ang link, ayun na ang site mo.

Kapag may domain ka na: Settings > Custom Domains > Add, sundin ang DNS na ipapakita, tapos palitan ang
`SITE_URL` ng bago mong domain (hal. `https://bgstudio.com`).

Tandaan: sa free plan, natutulog ang site kapag walang bumibisita at 30-60 segundo bago magising.
Para laging gising, i-upgrade sa bayad na plan.
