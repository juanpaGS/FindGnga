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
5. **🔎 Buscar precio ahora** (búsqueda automática, como Idealo/Chollometro):
   lanza en paralelo varias fuentes, se queda sólo con resultados que son *ese*
   producto (modelo exacto, sin accesorios ni otras versiones, precio razonable;
   en PS5 acepta packs y los marca) y te da cada oferta con **enlace directo**
   a la tienda. Fuentes (activables en *⚙️ Ajustes*):
   | Fuente | Clave | Estado |
   |---|---|---|
   | Google Shopping vía [SerpApi](https://serpapi.com) | API key gratuita | la más fiable y completa |
   | Amazon.es y eBay.es vía SerpApi | la misma key | estable (eBay desactivado por defecto) |
   | Chollometro (chollos + códigos) | no | beta |
   | Idealo | no | beta (puede bloquear) |
   | Tiendas directamente (Amazon, PcComponentes, MediaMarkt…) | no | beta (lee datos estructurados) |
   | URLs vigiladas (las que guardaste) | no | estable |

   Las ofertas automáticas se **reemplazan** en cada búsqueda y los precios
   **caducan** (3 días por defecto): lo agotado o lo que ha subido deja de contar solo.
   Cada búsqueda alimenta el **histórico**.
6. **📈 ¿Comprar ya o esperar?** (pestaña *Cuándo comprar* y en cada producto):
   predice **cuándo y cuánto** bajará combinando el calendario de campañas en
   España (`data/events.json`: Black Friday, rebajas de enero, Days of Play,
   Prime Day…), la tendencia de la categoría (monitores −~1 %/mes; consolas sin
   bajada natural) y tu histórico (precio normal, percentil, tendencia). Da un
   veredicto (comprar / esperar), la próxima bajada probable con su rango de
   precio, una línea temporal y un **plan de ahorro** (€/semana hasta la campaña).
   La confianza sube a medida que acumulas histórico.
7. **🔔 Alertas**: fija un precio objetivo por producto; la app (y el comando
   `refresh`) te avisa cuando una oferta lo cruza.
8. **Precios a mano**: en cada producto, *➕ Precio a mano*:
   - **⚡ Comprobar en vivo**: pega la URL del producto; se lee el precio de los
     datos estructurados (JSON-LD / meta) de la página. Funciona en la mayoría de
     tiendas; si alguna bloquea peticiones automáticas, escríbelo a mano.
   - Se guarda un **histórico** y se muestra el mínimo visto.
9. **🏷️ Cupones**: guarda los códigos que encuentres; se aplican solos.

> ⚠️ Los precios del catálogo (`ref_price`) son **orientativos** y se marcan
> como "sin comprobar". El programa no inventa precios ni códigos: los reales
> entran al comprobarlos en vivo o al añadirlos.

## Instalar y arrancar (en cualquier ordenador)

Sólo necesitas **Python 3.10 o superior** e internet.

**macOS / Linux**

```bash
git clone https://github.com/juanpaGS/FindGnga.git
cd FindGnga
./run.sh
```

**Windows**: instala Python desde python.org (marca *Add to PATH*), clona o
descarga el repositorio y haz doble clic en `run.bat`.

La primera vez crea su entorno (`.venv`) e instala las dependencias solo; luego
abre <http://127.0.0.1:8000>. Probado con un clon limpio en Python 3.11, 3.12 y
3.13, y GitHub Actions lo prueba en Linux, macOS y Windows (3.10 y 3.13).

**Qué NO viaja con el repositorio** (a propósito, es personal): tu perfil,
API key, precios, histórico y cupones (`data/user/`). Para llevarlos:
*⚙️ Ajustes → Descargar copia* en un ordenador y *Restaurar copia* en el otro
(o `python -m findgnga.cli export copia.json` / `import copia.json`).

**¿Funciona aquí?** *⚙️ Ajustes → Comprobar instalación* o:

```bash
.venv/bin/python -m findgnga.cli doctor
```

revisa Python, dependencias, datos, conexión con cada fuente y la API key, y
dice cómo arreglar lo que falle.

## ¿El precio que veo es el más barato del mercado?

- Si pone **"⚠️ No es un precio encontrado"**, es el precio de referencia
  (en PS5, el PVP oficial 599,99/649,99/899,99 €), **no** una oferta real:
  pulsa *🔎 Buscar precio ahora*.
- Tras buscar, la línea **Cobertura** te dice cuántas fuentes respondieron y
  cuántas tiendas se compararon. Con cobertura baja puede haber precios más
  bajos que no vemos; con SerpApi (Google Shopping + Amazon) la cobertura es
  parecida a la de un comparador.
- Cada oferta lleva **fiabilidad** (0-100): se **verifica en la página de la
  propia tienda** (precio y stock reales), suma si varias fuentes la ven igual y
  resta si la tienda es desconocida, es un marketplace o el precio es
  sospechosamente bajo respecto al resto (no se usa como "mejor precio").

### Activar Google Shopping (recomendado)

1. Crea una cuenta gratuita en <https://serpapi.com> y copia tu API key.
2. En la app: *⚙️ Ajustes → Google Shopping* → pega la key → *Guardar*
   (o exporta `SERPAPI_KEY=...` antes de `./run.sh`).

### Diagnóstico de fuentes

Las fuentes beta dependen del HTML de cada web. Para ver cuáles funcionan desde tu red:

```bash
.venv/bin/python -m findgnga.cli diagnose
```

(o *⚙️ Ajustes → Ejecutar diagnóstico*). Guarda el HTML recibido en
`data/user/snapshots/` para poder afinar los lectores.

### Vigilancia automática

```bash
.venv/bin/python -m findgnga.cli refresh
```

busca las PS5 y tus 5 mejores monitores y avisa de las alertas. Para que lo haga
solo cada 6 horas (cron en macOS/Linux):

```
0 */6 * * * cd /ruta/a/FindGnga && .venv/bin/python -m findgnga.cli refresh >> data/user/refresh.log 2>&1
```

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
  pricing/deals.py     feeds RSS de Chollometro
  providers/           búsqueda automática: engine (orquestador + filtros), serpapi,
                       chollometro, idealo, stores, extract (JSON-LD / JSON incrustado)
  predict.py           predicción de bajadas y plan de ahorro
  settings.py          ajustes (API key, fuentes, caducidad, alertas)
  providers/verify.py  verificación en la tienda, fiabilidad, duplicados
  doctor.py            comprobación de la instalación
  backup.py            copia de seguridad / restauración de data/user
  cli.py               refresh / diagnose / doctor / export / import
  storage.py           ficheros JSON
data/
  monitors.json        catálogo de monitores (fichas editables)
  consoles.json        PS5 y su PVP oficial
  stores.json          tiendas, envío, enlaces de búsqueda, trucos de cupones
  promos.json          cupones compartidos
  events.json          calendario de rebajas y descuentos típicos (editable)
  user/                tu perfil, precios y cupones (no se sube a git)
web/                   interfaz (HTML/CSS/JS sin dependencias)
```

## Próximos pasos posibles

- Notificaciones push/email de las alertas.
- Afinar los lectores beta con los HTML guardados por el diagnóstico.
- Más categorías (portátiles, SSD, auriculares…) reutilizando el mismo motor.
- Adaptadores específicos por tienda cuando la lectura genérica no baste.
