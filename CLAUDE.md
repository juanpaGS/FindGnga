# FindGnga — contexto para Claude

Buscador local de gangas tecnológicas en España (v0.4). Foco actual: **PS5, monitores y accesorios**
para Black Friday, adaptados al escritorio del usuario. El usuario aprende el ecosistema Claude: añadir "ficha" breve al usar
una herramienta por primera vez en el proyecto (ver preferencias del usuario).

## Stack y arranque
- Python ≥3.10 + FastAPI (`findgnga/`), web sin build (`web/`: index.html, app.js, desk-view.js, desk3d.js, styles.css).
- 3D: Three.js r160 copiado en `web/vendor/three/` (import map en index.html; sin npm ni CDN).
- `./run.sh` (macOS/Linux) · `run.bat` (Windows) → http://127.0.0.1:8000
- Tests: `.venv/bin/python -m pytest -q` (76 tests). CI: `.github/workflows/tests.yml`.
- CLI: `python -m findgnga.cli refresh|diagnose|doctor|export|import`.

## Mapa del código
- `scoring/monitors.py` calidad + compatibilidad (Mac: ppi/USB-C/W; PS5: HDMI 2.1/4K120/VRR).
- `search.py` ranking (índice calidad/precio = (fit-50)²/precio) y búsqueda PS5 vs PVP.
- `providers/engine.py` búsqueda automática multi-fuente → filtra modelo/accesorios/precio,
  une duplicados, `verify.py` comprueba precio/stock en la tienda y puntúa fiabilidad.
  Fuentes: serpapi (Google Shopping, Amazon, eBay, Idealo vía Google = solo referencia; requiere key), chollometro,
  idealo (403), stores, watched. `resolve_direct_links` cambia enlaces de Google por la ficha de la tienda
  (google_immersive_product, `resolve_links` búsquedas/clic); `verify` marca enlaces caducados (`gone`).
- `shopcheck.py` detector de tiendas falsas (dominio, precio, pago, IBAN, RDAP); lo usa `verify.assess` y la pestaña 🛡️.
- `desk.py` Mi escritorio: `identify` (modelo → puertos/chip/pulgadas), `sync_profile` (el escritorio
  alimenta los dispositivos del perfil, ids `desk-*`), `recommend` (accesorios de `data/accessories.json`,
  monitores que caben según pantallas externas admitidas, mejoras y «buen precio» ≤ 90 % de ref_price).
  Los accesorios son productos buscables (`engine.find_product` categoría `accessory`, banda 0,35–2,2×ref).
  Web: pestañas 🪑 Mi escritorio (3D) y 🧩 Accesorios. ref_price de accesorios = ORIENTATIVO.
- `predict.py` + `data/events.json` predicción de bajadas y plan de ahorro.
- `pricing/core.py` precio final = precio + envío − cupón; ofertas caducan (3 días).
- Datos de usuario en `data/user/` (gitignored): profile, settings (API key), offers, price_history, promos, desk.

## Estado / pendiente
- Desde el contenedor cloud NO hay red a tiendas: los lectores beta (chollometro/idealo/stores)
  no se han probado con HTML real. Pedir al usuario `cli diagnose` y sus snapshots para afinarlos.
- Probado en el Mac (26 nov 2026) con HTML real (fixtures `tests/fixtures/real_*`): Google Shopping ya no da `link`
  (hay que resolver con immersive); Game/Carrefour sólo buscan con JS (en SKIP); Fnac/ECI/Worten/Idealo dan 403.
  Precio real PS5 Slim ≈1.080–1.230 € (marketplaces), fuera de la banda 0,55–1,6×PVP. Tiendas falsas vistas:
  homegeares.es, garantie2ans.com, laserie50.com (el detector las marca 🚩 y nunca son la "mejor").
- PVP PS5 España (abr 2026): Digital 599,99 · Standard 649,99 · Pro 899,99.

## Convenciones
- Responder en español. Rama de trabajo: `claude/ecstatic-mccarthy-loj8uv`.
- No inventar precios ni códigos promocionales; marcar lo orientativo como tal.
