# 🎯 FindGnga — buscador de gangas tecnológicas (España)

Primera versión centrada en **monitores** y **PS5** para el Black Friday.
No busca "el más barato" a secas: busca **el mejor equilibrio calidad/precio
para lo que tú ya tienes en casa**.

## Cómo funciona

1. **Encuesta de tu setup** (pestaña *Mi setup*): qué dispositivos tienes
   (MacBook con su chip y RAM, PC, PS5, Xbox, Switch…), para qué usarás el
   monitor, presupuesto, tamaño y si priorizas precio o calidad. Se guarda en
   `data/user/profile.json`.
2. **Monitores**: cada monitor recibe tres notas (0-100):
   - **Calidad** — nitidez (ppi), color, HDR/contraste, Hz y ergonomía,
     ponderadas según tus usos (programar pesa nitidez; jugar pesa Hz y HDR…).
   - **Compatibilidad** con cada dispositivo que vas a conectar, con motivos:
     - *Mac*: densidad ideal de macOS (~218 ppi = 5K 27"), un solo cable USB-C
       con carga suficiente (W), Thunderbolt, 120 Hz como ProMotion, HDMI 2.0/2.1 según chip.
     - *PS5/Xbox*: HDMI 2.1 para 4K 120 Hz, VRR, HDR real, formato 16:9 (ultrapanorámico = descartado).
     - *PC*: conexión y si tu gráfica aprovecha la resolución/Hz.
     - Varios dispositivos: ¿hay entradas para todos? (USB-C + HDMI, KVM…).
   - **Calidad/precio** — premia la calidad *por encima de un mínimo* dividida
     por el precio final, para que un monitor barato pero mediocre no gane.
   Badges: 🏆 Recomendado · 💎 Mejor calidad · 🔌 Más compatible · 💸 Más barato que merece la pena.
3. **PS5**: precio final de Digital / con lector / Pro contra el **PVP oficial
   en España** (599,99 / 649,99 / 899,99 € desde abril de 2026) con veredicto
   (chollazo, buen precio, rebaja pequeña, reventa) + el **monitor ideal para la
   PS5** que además sirva para tus otros dispositivos.
4. **Precio final = precio + envío − mejor cupón válido** (tienda, gasto
   mínimo, caducidad, categoría). Las reglas de envío están en `data/stores.json`.
5. **Precios reales**: en cada producto, *➕ Añadir / comprobar precio*:
   - **⚡ Comprobar en vivo**: pega la URL del producto; se lee el precio de los
     datos estructurados (JSON-LD / meta) de la página. Funciona en la mayoría de
     tiendas; si alguna bloquea peticiones automáticas, escríbelo a mano.
   - Se guarda un **histórico** y se muestra el mínimo visto.
6. **🔥 Chollos de la comunidad**: lee los feeds RSS de Chollometro y filtra por
   el producto (detecta precio, tienda y códigos en el texto).
7. **🏷️ Cupones**: guarda los códigos que encuentres; se aplican solos.

> ⚠️ Los precios del catálogo (`ref_price`) son **orientativos** y se marcan
> como "sin comprobar". El programa no inventa precios ni códigos: los reales
> entran al comprobarlos en vivo o al añadirlos.

## Arrancar

```bash
./run.sh
```

y abre <http://127.0.0.1:8000>. Requiere Python 3.10+.

Tests:

```bash
.venv/bin/python -m pytest -q
```

## Estructura

```
findgnga/
  main.py              API FastAPI + web estática
  search.py            ranking de monitores y PS5
  scoring/monitors.py  notas de calidad y compatibilidad (con motivos)
  pricing/core.py      envío + cupones → precio final
  pricing/live.py      lectura de precio desde la URL de la tienda
  pricing/deals.py     feeds de Chollometro
  storage.py           ficheros JSON
data/
  monitors.json        catálogo de monitores (fichas editables)
  consoles.json        PS5 y su PVP oficial
  stores.json          tiendas, envío, enlaces de búsqueda, trucos de cupones
  promos.json          cupones compartidos
  user/                tu perfil, precios y cupones (no se sube a git)
web/                   interfaz (HTML/CSS/JS sin dependencias)
```

## Próximos pasos posibles

- Alertas: comprobación programada de precios y aviso cuando bajen de un umbral.
- Más categorías (portátiles, SSD, auriculares…) reutilizando el mismo motor.
- Adaptadores específicos por tienda cuando la lectura genérica no baste.
