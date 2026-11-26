# FindGnga — contexto para Claude

Buscador local de gangas tecnológicas en España (v0.3). Foco actual: **PS5 y monitores**
para Black Friday. El usuario aprende el ecosistema Claude: añadir "ficha" breve al usar
una herramienta por primera vez en el proyecto (ver preferencias del usuario).

## Stack y arranque
- Python ≥3.10 + FastAPI (`findgnga/`), web sin build (`web/`: index.html, app.js, styles.css).
- `./run.sh` (macOS/Linux) · `run.bat` (Windows) → http://127.0.0.1:8000
- Tests: `.venv/bin/python -m pytest -q` (45 tests). CI: `.github/workflows/tests.yml`.
- CLI: `python -m findgnga.cli refresh|diagnose|doctor|export|import`.

## Mapa del código
- `scoring/monitors.py` calidad + compatibilidad (Mac: ppi/USB-C/W; PS5: HDMI 2.1/4K120/VRR).
- `search.py` ranking (índice calidad/precio = (fit-50)²/precio) y búsqueda PS5 vs PVP.
- `providers/engine.py` búsqueda automática multi-fuente → filtra modelo/accesorios/precio,
  une duplicados, `verify.py` comprueba precio/stock en la tienda y puntúa fiabilidad.
  Fuentes: serpapi (Google Shopping, Amazon, eBay; requiere key), chollometro, idealo, stores, watched.
- `shopcheck.py` detector de tiendas falsas (dominio, precio, pago, IBAN, RDAP); lo usa `verify.assess` y la pestaña 🛡️.
- `predict.py` + `data/events.json` predicción de bajadas y plan de ahorro.
- `pricing/core.py` precio final = precio + envío − cupón; ofertas caducan (3 días).
- Datos de usuario en `data/user/` (gitignored): profile, settings (API key), offers, price_history, promos.

## Estado / pendiente
- Desde el contenedor cloud NO hay red a tiendas: los lectores beta (chollometro/idealo/stores)
  no se han probado con HTML real. Pedir al usuario `cli diagnose` y sus snapshots para afinarlos.
- Siguiente paso: el usuario configura la API key de SerpApi en ⚙️ Ajustes y prueba en su Mac.
- PVP PS5 España (abr 2026): Digital 599,99 · Standard 649,99 · Pro 899,99.

## Convenciones
- Responder en español. Rama de trabajo: `claude/ecstatic-mccarthy-loj8uv`.
- No inventar precios ni códigos promocionales; marcar lo orientativo como tal.
