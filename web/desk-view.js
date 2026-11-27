/* FindGnga – Mi escritorio (3D) y Accesorios compatibles.
 * Usa las utilidades de app.js ($, api, esc, eur, state, priceBlock…). */
"use strict";

const DESK_TYPES = [
  { type: "monitor", emoji: "🖥️", name: "Monitor", ph: "p. ej. LG 27UP850N, Dell U2723QE, Samsung Odyssey G9" },
  { type: "laptop", emoji: "💻", name: "Portátil", ph: "p. ej. MacBook Pro M4 Pro 24 GB, Lenovo Legion RTX 4060" },
  { type: "desktop", emoji: "🗄️", name: "Ordenador / PC", ph: "p. ej. Mac mini M4, PC con RTX 4070" },
  { type: "ps5", emoji: "🎮", name: "PS5", ph: "p. ej. PS5 Slim Digital, PS5 Pro" },
  { type: "keyboard", emoji: "⌨️", name: "Teclado", ph: "p. ej. Logitech MX Keys, Keychron K2" },
  { type: "mouse", emoji: "🖱️", name: "Ratón", ph: "p. ej. Logitech MX Master 3S" },
  { type: "phone", emoji: "📱", name: "Móvil", ph: "p. ej. iPhone 15 Pro, Pixel 9" },
  { type: "tablet", emoji: "📲", name: "Tablet", ph: "p. ej. iPad Air M2, Galaxy Tab S9" },
  { type: "headset", emoji: "🎧", name: "Cascos", ph: "p. ej. Sony WH-1000XM5, HyperX Cloud II" },
  { type: "light", emoji: "💡", name: "Luz de monitor", ph: "p. ej. BenQ ScreenBar, Xiaomi Light Bar" },
  { type: "mousepad", emoji: "🟫", name: "Alfombrilla", ph: "p. ej. alfombrilla XXL 90×40" },
  { type: "webcam", emoji: "📷", name: "Webcam", ph: "p. ej. Logitech C920, Insta360 Link" },
  { type: "hub", emoji: "🔌", name: "Hub / dock", ph: "p. ej. Anker 7 en 1, CalDigit TS3 Plus" },
  { type: "speakers", emoji: "🔊", name: "Altavoces", ph: "p. ej. Edifier R1280, Creative Pebble" },
  { type: "arm", emoji: "🦾", name: "Brazo de monitor", ph: "p. ej. Ergotron LX, brazo doble" },
];
const typeInfo = (t) => DESK_TYPES.find((x) => x.type === t) || { emoji: "📦", name: t };
const KIND_TO_TYPE = { light: "light", mousepad: "mousepad", keyboard: "keyboard", mouse: "mouse", headset: "headset",
  webcam: "webcam", hub: "hub", speakers: "speakers", arm: "arm" };
const uid = () => Math.random().toString(36).slice(2, 10);

/* Colores con nombre (los mismos que entiende el buscador) → color en 3D */
const COLORS = {
  space_black: ["Negro espacial", "#2b2b2e"], black: ["Negro", "#1d1d1f"], space_gray: ["Gris espacial", "#5f6166"],
  silver: ["Plata", "#d6d7d9"], white: ["Blanco", "#f2f2f0"], starlight: ["Blanco estrella", "#efe6d6"],
  midnight: ["Medianoche", "#2e3642"], gold: ["Oro", "#e3cfa6"], sky_blue: ["Azul cielo", "#b9cfe0"],
  blue: ["Azul", "#3d5a80"], green: ["Verde", "#7a9a7e"], pink: ["Rosa", "#eec5c8"], purple: ["Morado", "#b4a5c9"],
  red: ["Rojo", "#b8302b"], graphite: ["Grafito", "#3d3d40"],
};
const COLORABLE = ["laptop", "desktop", "keyboard", "mouse", "phone", "tablet", "headset", "mousepad", "speakers", "monitor"];

/* Ambiente del 3D (la mesa con sus medidas va aparte, en `table`) */
const STYLE_OPTS = {
  floor: [["wood", "Parqué"], ["concrete", "Cemento"], ["carpet", "Moqueta"], ["tiles", "Baldosa"]],
  light: [["day", "Día"], ["evening", "Atardecer"], ["night", "Noche"]],
  wallpaper: [["sunset", "Atardecer"], ["ocean", "Océano"], ["forest", "Bosque"], ["aurora", "Aurora"], ["mono", "Liso"]],
};
const DECOR = [["plant", "🪴 Planta"], ["mug", "☕ Taza"], ["books", "📚 Libros"], ["lamp", "🛋️ Lámpara"], ["frame", "🖼️ Cuadro"], ["window", "🪟 Ventana"]];
const DEFAULT_STYLE = { wall: "#e9e4dc", floor: "wood", light: "day", wallpaper: "sunset", decor: ["plant", "mug"], rgb: false };
const OLD_STYLE_KEYS = ["desk", "legs", "width", "depth"];   // antes la mesa iba en el estilo
const cleanStyle = (s) => { const o = { ...(s || {}) }; OLD_STYLE_KEYS.forEach((k) => delete o[k]); return o; };

/* La mesa: medidas reales en cm (el servidor las valida y las ajusta) */
const TABLE_NUM = [["width_cm", "Ancho", 1], ["depth_cm", "Fondo", 1], ["height_cm", "Alto", 0.5], ["top_cm", "Grosor del tablero", 0.1],
  ["corner_cm", "Esquinas redondeadas", 1]];
const TABLE_RET = [["return_w_cm", "Ancho del retorno", 1], ["return_d_cm", "Largo del retorno", 1]];
const TABLE_LIMITS_UI = { width_cm: [60, 300], depth_cm: [40, 120], height_cm: [55, 130], top_cm: [1, 8], corner_cm: [0, 30],
  return_w_cm: [30, 120], return_d_cm: [60, 220] };   // los mismos que desk.TABLE_LIMITS
function tableNum(k, t, step) {
  const [a, b] = (window.Desk3D?.TABLE_LIMITS || TABLE_LIMITS_UI)[k];
  return `<label class="small">${t} <span class="muted">(${a}–${b} cm)</span><input type="number" inputmode="decimal" data-table="${k}" min="${a}" max="${b}" step="${step}"></label>`;
}
const TABLE_SEL = {
  shape: ["Forma", [["rect", "Rectangular"], ["l_right", "En L, retorno a la derecha"], ["l_left", "En L, retorno a la izquierda"]]],
  legs: ["Patas", [["four", "Cuatro patas"], ["a_frame", "En A"], ["t_frame", "En T"], ["standing", "Elevable (con motor)"], ["trestle", "Caballete"], ["drawers", "Con cajonera"]]],
  material: ["Tablero", [["oak", "Roble"], ["walnut", "Nogal"], ["white", "Blanco"], ["black", "Negro"], ["bamboo", "Bambú"], ["gray", "Gris"], ["glass", "Cristal"]]],
  leg_color: ["Color de las patas", [["black", "Negras"], ["white", "Blancas"], ["silver", "Plata"]]],
};
const CAMS = [["iso", "Perspectiva", "1"], ["front", "Frente", "2"], ["top", "Arriba", "3"], ["side", "Lado", "4"]];
/* De dónde salen las medidas de un objeto */
const dimsSrc = (dm, it) => (it?.dims && Object.keys(it.dims).length ? "corregidas por ti"
  : dm.approx ? (dm.src === "deducido" ? "orientativas (deducidas de su tamaño)" : "orientativas")
  : `según ${dm.src === "fabricante" || !dm.src ? "el fabricante" : dm.src}`);
const notify = (msg, o) => (typeof toast === "function" ? toast(msg, o) : console.info(msg));
const tell = (msg, o) => { if (typeof announce === "function") announce(msg, o); };
const num1 = (v) => (Math.round(v * 10) / 10).toLocaleString("es-ES");

/* Sólo lo que el servidor guarda (dims_auto lo calcula él) */
const cleanItem = (it) => {
  const { dims_auto, ...rest } = it;   // eslint-disable-line no-unused-vars
  return rest;
};

/* Espera a que cargue el módulo 3D (se carga aparte, como módulo ES) */
function desk3dReady() {
  if (window.Desk3D) return Promise.resolve(window.Desk3D);
  return new Promise((ok) => window.addEventListener("desk3d-ready", () => ok(window.Desk3D), { once: true }));
}

async function saveDesk() {
  const body = { items: (state.deskItems || []).map(cleanItem), style: cleanStyle(state.deskStyle) };
  if (state.deskTable) body.table = state.deskTable;
  const r = await api("/api/desk", { method: "PUT", body });
  state.profile = r.profile;
  state.accessories = null; // hay que recalcular las recomendaciones
  // medidas automáticas recalculadas por el servidor (p. ej. tras cambiar la ficha)
  let changed = false;
  for (const it of r.items || []) {
    const mine = state.deskItems?.find((i) => i.id === it.id);
    if (mine && it.dims_auto && JSON.stringify(mine.dims_auto) !== JSON.stringify(it.dims_auto)) { mine.dims_auto = it.dims_auto; changed = true; }
  }
  if (changed && state.desk3d) state.desk3d.update(state.deskItems);
  return r;
}

/* ---------------------------------------------------------------- campos por tipo */

function specFields(type, s) {
  const chk = (k, label) => `<label class="inline small"><input type="checkbox" data-spec="${k}" ${s[k] ? "checked" : ""}> ${label}</label>`;
  const port = (k, label) => `<label class="inline small"><input type="checkbox" data-port="${k}" ${s.ports?.[k] ? "checked" : ""}> ${label}</label>`;
  const sel = (k, opts, label) => `<label class="small">${label}<select data-spec="${k}">${opts.map(([v, t]) =>
    `<option value="${v}" ${String(s[k] ?? "") === String(v) ? "selected" : ""}>${t}</option>`).join("")}</select></label>`;
  const num = (k, label, step = 1) => `<label class="small">${label}<input type="number" step="${step}" data-spec="${k}" value="${s[k] ?? ""}"></label>`;
  const grid = (...x) => `<div class="spec-grid">${x.join("")}</div>`;
  const checks = (...x) => `<div class="spec-checks">${x.join("")}</div>`;
  if (type === "monitor") return grid(num("size_in", "Pulgadas", 0.5), sel("aspect", [["16:9", "16:9 normal"], ["21:9", "21:9 ultrapanorámico"], ["32:9", "32:9 doble"], ["16:10", "16:10"]], "Formato"),
    num("refresh_hz", "Hz"), num("res_w", "Resolución (ancho)")) + checks(chk("usb_c", "USB-C con vídeo"), chk("hdmi21", "HDMI 2.1"), chk("dp", "DisplayPort"), chk("curved", "Curvo"));
  if (type === "laptop" || type === "desktop") {
    const mac = s.platform === "mac";
    return grid(sel("platform", [["mac", "Mac"], ["windows", "Windows / Linux"]], "Sistema"),
      mac ? sel("chip_gen", [1, 2, 3, 4, 5, 6, 7].map((n) => [n, "M" + n]), "Chip") + sel("chip_tier", [["base", "Normal"], ["pro", "Pro"], ["max", "Max"], ["ultra", "Ultra"]], "Versión")
        : sel("gpu_tier", [["integrated", "Gráfica integrada"], ["mid", "Gráfica media"], ["high", "Gráfica potente"]], "Gráfica"),
      mac && type === "laptop" ? sel("model_line", [["air", "Air"], ["pro", "Pro"]], "Modelo") + num("screen_in", "Pulgadas") : "",
      mac && type === "desktop" ? sel("model_line", [["mini", "Mac mini"], ["studio", "Mac Studio"], ["imac", "iMac"]], "Modelo") : "",
      num("ram_gb", "RAM (GB)"), num("storage_gb", "Almacenamiento (GB)"), num("max_displays", "Pantallas externas"), num("charge_w", "Carga (W)"))
      + checks(`<span class="small muted">Puertos:</span>`, port("usb_c", "USB-C"), port("thunderbolt", "Thunderbolt"), port("hdmi", "HDMI"), port("dp", "DisplayPort"), port("usb_a", "USB-A"))
      + checks(chk("camera", "Cámara"), chk("bt", "Bluetooth"));
  }
  if (type === "ps5") return grid(sel("edition", [["standard", "Con lector"], ["digital", "Digital"], ["pro", "Pro"]], "Edición"),
    sel("model", [["fat", "Original (2020)"], ["slim", "Slim"], ["pro", "Pro"]], "Modelo"), num("storage_gb", "Almacenamiento (GB)"));
  if (type === "phone" || type === "tablet") return grid(sel("os", [["ios", type === "phone" ? "iPhone" : "iPad"], ["android", "Android"]], "Sistema"),
    sel("connector", [["usb_c", "USB-C"], ["lightning", "Lightning"]], "Conector")) + checks(chk("magsafe", "MagSafe"), chk("qi2", "Qi2"), chk("qi", "Carga inalámbrica"));
  if (type === "keyboard") return grid(sel("layout", [["both", "Mac y Windows"], ["mac", "Mac"], ["win", "Windows"]], "Teclas"), num("multi", "Equipos a la vez"))
    + checks(chk("wireless", "Inalámbrico"), chk("bt", "Bluetooth"), chk("mechanical", "Mecánico"), chk("backlit", "Retroiluminado"));
  if (type === "mouse") return grid(num("multi", "Equipos a la vez")) + checks(chk("wireless", "Inalámbrico"), chk("bt", "Bluetooth"), chk("ergonomic", "Ergonómico"), chk("gaming", "Gaming"));
  if (type === "headset") return checks(chk("bt", "Bluetooth"), chk("dongle", "Receptor USB"), chk("ps5_wireless", "Inalámbricos en PS5"), chk("anc", "Cancelación de ruido"), chk("multipoint", "Multipunto"));
  if (type === "mousepad") return grid(num("w_cm", "Ancho (cm)"), num("d_cm", "Fondo (cm)"));
  if (type === "light") return checks(chk("curved_ok", "Vale para monitores curvos"));
  if (type === "hub") return grid(sel("kind", [["hub", "Hub USB-C"], ["dock", "Dock Thunderbolt"]], "Tipo"), num("pd_w", "Carga (W)")) + checks(chk("hdmi_4k60", "HDMI 4K a 60 Hz"));
  if (type === "arm") return grid(num("max_in", "Hasta (pulgadas)")) + checks(chk("dual", "Doble"));
  if (type === "speakers") return checks(chk("bt", "Bluetooth"));
  return checks(chk("wireless", "Inalámbrico"));
}

function readSpecs(root, base) {
  const s = JSON.parse(JSON.stringify(base || {}));
  root.querySelectorAll("[data-spec]").forEach((el) => {
    const k = el.dataset.spec;
    if (el.type === "checkbox") s[k] = el.checked;
    else if (el.type === "number") s[k] = el.value === "" ? null : +el.value;
    else s[k] = /^\d+$/.test(el.value) ? +el.value : el.value;
  });
  const ports = root.querySelectorAll("[data-port]");
  if (ports.length) { s.ports = { ...(s.ports || {}) }; ports.forEach((el) => { s.ports[el.dataset.port] = el.checked; }); }
  return s;
}

function sheetHtml(r) {
  if (!r || !r.sheet?.length) return "";
  return `<table class="spec-sheet">${r.sheet.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>
    ${(r.warnings || []).map((w) => `<div class="small warn-txt">⚠️ ${esc(w)}</div>`).join("")}`;
}

/* ---------------------------------------------------------------- vista: Mi escritorio */

async function viewDesk() {
  const opt = (pairs) => pairs.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
  app.innerHTML = `<h1>🪑 Mi escritorio</h1>
    <p class="muted">Pon tu mesa con sus medidas reales y añade lo que tienes encima: escribe el modelo y elige de la lista para rellenar su ficha
      (medidas incluidas). FindGnga te avisa si algo no cabe y adapta la búsqueda (monitores, PS5 y
      <a href="#accessories" data-go="accessories">accesorios compatibles</a>) a tu escritorio.</p>
    <div class="desk-layout">
      <div>
        <div class="desk3d" id="desk3d"><div class="desk3d-empty" id="deskEmpty">Tu escritorio está vacío.<br>Empieza añadiendo tu monitor u ordenador →</div>
          <div class="d3-zoomdock" role="group" aria-label="Zoom">
            <button class="d3-zbtn" id="zoomIn" title="Acercar (tecla +)" aria-label="Acercar">＋</button>
            <button class="d3-zbtn" id="zoomOut" title="Alejar (tecla −)" aria-label="Alejar">－</button>
            <button class="d3-zbtn" id="zoomFit" title="Encuadrar la mesa (tecla 1)" aria-label="Encuadrar la mesa">⤢</button>
          </div></div>
        <p class="sr-only" id="deskSummary"></p>
        <div class="d3-toolbar2">
          <div class="d3-group" role="group" aria-labelledby="g-view"><span class="d3-glabel" id="g-view">👁️ Vista</span>
            ${CAMS.map(([v, t, k]) => `<button class="ghost small" data-cam="${v}" aria-pressed="${v === "iso"}" title="${t} (tecla ${k})">${t} <kbd>${k}</kbd></button>`).join("")}</div>
          <div class="d3-group" role="group" aria-labelledby="g-zoom"><span class="d3-glabel" id="g-zoom">🔍 Zoom</span>
            <button class="ghost small" id="zoomIn2" title="Acercar (tecla +)">Acercar <kbd>+</kbd></button>
            <button class="ghost small" id="zoomOut2" title="Alejar (tecla −)">Alejar <kbd>−</kbd></button></div>
          <div class="d3-group" role="group" aria-labelledby="g-obj"><span class="d3-glabel" id="g-obj">✋ Objeto elegido: <b id="selName">ninguno</b></span>
            <button class="ghost small" id="rotL" title="Girar a la izquierda (Q)" aria-label="Girar el objeto elegido 15° a la izquierda">⟲ Girar <kbd>Q</kbd></button>
            <button class="ghost small" id="rotR" title="Girar a la derecha (E)" aria-label="Girar el objeto elegido 15° a la derecha">⟳ Girar <kbd>E</kbd></button></div>
          <div class="d3-group" role="group" aria-labelledby="g-tools"><span class="d3-glabel" id="g-tools">🧰 Herramientas</span>
            <button class="ghost small" id="measBtn" aria-pressed="false" title="Medidas (tecla M)">📏 Medidas <kbd>M</kbd></button>
            <button class="ghost small" id="relayout" title="Volver a colocar todo automáticamente">↺ Recolocar todo</button>
            <button class="ghost small" id="snap">📸 Guardar imagen</button></div>
        </div>
        <details class="d3-keys"><summary>⌨️ Cómo se usa (ratón y teclado)</summary>
          <ul class="small">
            <li><b>Ratón:</b> arrastra un objeto para moverlo · arrastra el fondo para girar la vista · rueda o pellizco para acercar/alejar · clic derecho y arrastra para desplazarte · doble clic en un objeto para acercarte.</li>
            <li><b>Teclado</b> (pulsa Tab hasta el 3D): flechas mueven el objeto (Mayús ×10, Alt 1 mm) · Q/E giran · N pasa al siguiente · Intro acerca · Esc suelta · 1–4 cámaras · M medidas · +/− zoom.</li>
            <li>También puedes elegir un objeto en la lista «En tu mesa» y moverlo con sus botones.</li>
          </ul></details>
        <div class="d3-fit" id="deskFit" aria-live="polite"></div>
        <section class="panel d3-selpanel" id="selPanel" hidden aria-labelledby="selTitle"></section>
        <details class="panel style-panel d3-table-panel" id="tablePanel" open><summary><span class="d3-step">1</span> 📐 Tu mesa <span class="muted small">— medidas reales, forma, patas y material</span></summary>
          <div class="style-grid">
            <label class="small d3-wide">Modelo de mesa<select id="tPreset"><option value="custom">A medida (escribe tus medidas)</option></select></label>
            ${TABLE_NUM.map(([k, t, step]) => tableNum(k, t, step)).join("")}
            ${Object.entries(TABLE_SEL).map(([k, [t, opts]]) => `<label class="small">${t}<select data-table="${k}">${opt(opts)}</select></label>`).join("")}
            <div class="d3-return style-grid d3-wide" id="tReturn">${TABLE_RET.map(([k, t, step]) => tableNum(k, t, step)).join("")}</div>
          </div>
          <p class="small muted" id="tNote"></p>
          <div class="actions" style="justify-content:flex-start"><button class="ghost small" id="tableReset">Restablecer mesa</button></div>
        </details>
        <details class="panel style-panel" id="stylePanel"><summary><span class="d3-step">3</span> 🎨 Ambiente <span class="muted small">— suelo, luz, pared y decoración</span></summary>
          <div class="style-grid">
            <label class="small">Suelo<select data-style="floor">${opt(STYLE_OPTS.floor)}</select></label>
            <label class="small">Luz<select data-style="light">${opt(STYLE_OPTS.light)}</select></label>
            <label class="small">Fondo de pantalla<select data-style="wallpaper">${opt(STYLE_OPTS.wallpaper)}</select></label>
            <label class="small">Pared<input type="color" data-style="wall"></label>
          </div>
          <div class="spec-checks">${DECOR.map(([v, t]) => `<label class="inline small"><input type="checkbox" data-decor="${v}"> ${t}</label>`).join("")}
            <label class="inline small"><input type="checkbox" data-style="rgb"> 🌈 Luces RGB</label></div>
          <div class="actions" style="justify-content:flex-start"><button class="ghost small" id="styleReset">Restablecer ambiente</button></div>
        </details>
      </div>
      <aside class="panel desk-side">
        <h3><span class="d3-step">2</span> ➕ Añade lo que tienes encima</h3>
        <p class="small muted" style="margin:0 0 8px">Elige el tipo y escribe el modelo: se rellenan sus medidas y puertos.</p>
        <div class="type-grid" id="types">${DESK_TYPES.map((t) => `<button class="type-btn" data-type="${t.type}"><span aria-hidden="true">${t.emoji}</span>${esc(t.name)}</button>`).join("")}</div>
        <form id="addForm" class="add-form" hidden>
          <label class="small" for="addModel"><b id="addTitle"></b> · ¿qué modelo es?</label>
            <div class="ac-wrap"><input type="text" id="addModel" autocomplete="off" maxlength="120" role="combobox" aria-expanded="false"
              aria-controls="acList" aria-autocomplete="list" aria-describedby="guess">
              <ul class="ac-list" id="acList" role="listbox" aria-label="Modelos que encajan" hidden></ul></div>
          <div class="guess small" id="guess" aria-live="polite"></div>
          <div id="sheet"></div>
          <div class="spec-grid">
            <label class="small">¿Cuánto pagaste? (€)<input type="number" min="0" step="1" id="addPaid" placeholder="opcional"></label>
            <label class="small" id="colorLbl">Color<select id="addColor"><option value="">—</option>${Object.entries(COLORS).map(([k, [n]]) => `<option value="${k}">${n}</option>`).join("")}</select></label>
          </div>
          <div class="swatches" id="swatches" role="group" aria-label="Colores"></div>
          <p class="small muted" style="margin:2px 0 6px">Con el precio pagado, «Mejoras que compensan» sólo te enseña cosas mejores que cuesten menos.</p>
          <details id="manual"><summary class="small">✏️ Ajustar la ficha a mano</summary><div id="specBox"></div></details>
          <div class="actions"><button type="button" class="ghost" id="addCancel">Cancelar</button><button class="primary" id="addOk">Añadir</button></div>
        </form>
        <h3 style="margin-top:16px" id="listTitle">🧾 En tu mesa <span class="muted small" id="count"></span></h3>
        <ul class="desk-list" id="deskList" aria-labelledby="listTitle"></ul>
        <div class="actions" id="deskCtas"></div>
      </aside>
    </div>`;
  bindResultActions(app, () => {});
  let D3;
  try {
    const [d, D] = await Promise.all([api("/api/desk"), desk3dReady()]);
    D3 = D;
    state.deskItems = d.items || [];
    state.deskStyle = { ...DEFAULT_STYLE, ...cleanStyle(d.style) };
    state.deskTable = D3.normTable(d.table);
  } catch (e) { app.insertAdjacentHTML("beforeend", `<p class="error">${esc(e.message)}</p>`); return; }
  if (state.view !== "desk") return;

  let adding = null, editing = null, timer = 0, acTimer = 0, last = null, acItems = [], acIdx = -1, selected = null;
  let saveTimer = 0, fitTimer = 0, fitSeq = 0, lastFit = null, lastIssueCount = -1, presets = [];
  const itemById = (id) => state.deskItems.find((i) => i.id === id);
  const nameOf = (it) => (it ? it.model || typeInfo(it.type).name : "");
  const later = (ms = 500) => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveDesk().catch((e) => notify(`No se pudo guardar: ${e.message}`, { type: "error" })), ms); };

  state.desk3d = D3.mount($("#desk3d"), {
    label: `Tu escritorio en 3D, a escala real. ${D3.KEYS_HELP}`,
    describedBy: "deskSummary",
    nameOf,
    onSelect: (id) => { select(id); if (id) document.querySelector(`[data-item="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" }); },
    onMove: (id, pos) => {
      const it = itemById(id); if (!it) return;
      it.pos = pos;
      if (id === selected) paintPos();
      later(); scheduleFit();
    },
    onMeasures: (on) => $("#measBtn").setAttribute("aria-pressed", String(on)),
  });
  state.desk3d.setTable(state.deskTable);
  state.desk3d.setStyle(state.deskStyle);

  function select(id) {
    selected = id && itemById(id) ? id : null;
    document.querySelectorAll("#deskList [data-item]").forEach((b) => {
      const on = b.dataset.item === selected;
      b.setAttribute("aria-pressed", String(on)); b.closest("li")?.classList.toggle("sel", on);
    });
    const it = itemById(selected);
    $("#selName").textContent = it ? nameOf(it) : "ninguno (haz clic en uno o elígelo en la lista)";
    $("#rotL").disabled = $("#rotR").disabled = !it || ["light", "webcam"].includes(it.type);
    paintSel();
  }

  /* --- el objeto elegido: medidas (con corrección a mano), posición exacta y colocación */
  function paintSel() {
    const box = $("#selPanel"), it = itemById(selected);
    box.hidden = !it;
    if (!it) { box.innerHTML = ""; return; }
    const auto = it.dims_auto || D3.dimsOf({ ...it, dims: null }), follows = ["light", "webcam"].includes(it.type);
    const dimIn = (k, t) => `<label class="small">${t} (cm)<input type="number" inputmode="decimal" min="0.3" max="320" step="0.1" data-dim="${k}"
      value="${it.dims?.[k] ?? ""}" placeholder="${num1(auto[k] ?? 0)}"></label>`;
    const posIn = (k, t, step, unit) => `<label class="small">${t} (${unit})<input type="number" inputmode="decimal" step="${step}" data-pos="${k}"></label>`;
    const nb = (dx, dz, sym, txt) => `<button type="button" class="ghost small" data-nudge="${dx},${dz}" aria-label="Mover 1 cm ${txt}" title="${txt} (Mayús: 10 cm)">${sym}</button>`;
    box.innerHTML = `<h3 id="selTitle"><span aria-hidden="true">${typeInfo(it.type).emoji}</span> ${esc(nameOf(it))}</h3>
      <p class="small" id="selDims"></p>
      <fieldset class="d3-fs"><legend class="small">Medidas reales (déjalo vacío para usar las de la ficha)</legend>
        <div class="spec-grid">${dimIn("w", "Ancho")}${dimIn("d", "Fondo")}${dimIn("h", "Alto")}</div>
        <button type="button" class="ghost small" id="dimReset" ${it.dims ? "" : "disabled"}>Usar medidas de la ficha</button></fieldset>
      ${it.type === "ps5" ? `<label class="small">Colocación<select id="ps5Orient"><option value="vertical">De pie</option>
        <option value="horizontal">Tumbada (ocupa ${num1(auto.h)} cm de ancho)</option></select></label>` : ""}
      ${follows ? `<p class="small muted">Va encima de la pantalla: se mueve con ella.</p>` : `<fieldset class="d3-fs"><legend class="small">Posición (desde el centro de la mesa)</legend>
        <div class="spec-grid">${posIn("x", "A la derecha", 0.5, "cm")}${posIn("z", "Hacia ti", 0.5, "cm")}${posIn("rot", "Giro", 5, "°")}</div>
        <div class="d3-nudge" role="group" aria-label="Mover el objeto">${nb(-1, 0, "←", "a la izquierda")}${nb(0, -1, "↑", "hacia el fondo")}${nb(0, 1, "↓", "hacia ti")}${nb(1, 0, "→", "a la derecha")}
          <button type="button" class="ghost small" id="selFocus">🔍 Acercar la cámara</button></div></fieldset>`}`;
    paintDims(); paintPos();
    if (it.type === "ps5") {
      $("#ps5Orient").value = it.orient || "vertical";
      $("#ps5Orient").onchange = (e) => { it.orient = e.target.value; state.desk3d.update(state.deskItems); paintDims(); later(300); scheduleFit(); };
    }
    box.querySelectorAll("[data-dim]").forEach((el) => el.onchange = () => {
      const d = {};
      box.querySelectorAll("[data-dim]").forEach((x) => { const v = parseFloat(String(x.value).replace(",", ".")); if (Number.isFinite(v) && v > 0) d[x.dataset.dim] = Math.min(320, Math.max(0.3, v)); });
      it.dims = Object.keys(d).length ? d : null;
      $("#dimReset").disabled = !it.dims;
      state.desk3d.update(state.deskItems); paintDims(); later(300); scheduleFit();
    });
    $("#dimReset").onclick = () => {
      it.dims = null; box.querySelectorAll("[data-dim]").forEach((x) => { x.value = ""; });
      $("#dimReset").disabled = true; state.desk3d.update(state.deskItems); paintDims(); later(300); scheduleFit();
      tell("Medidas de la ficha");
    };
    box.querySelectorAll("[data-pos]").forEach((el) => el.onchange = () => {
      const v = (k) => parseFloat(String(box.querySelector(`[data-pos="${k}"]`).value).replace(",", "."));
      const p = state.desk3d.setPos(it.id, { x: v("x") / 100, z: v("z") / 100, rot: (-v("rot") * Math.PI) / 180 });
      if (p) { it.pos = p; paintPos(true); later(); scheduleFit(); }
    });
    box.querySelectorAll("[data-nudge]").forEach((b) => b.onclick = (e) => {
      const [dx, dz] = b.dataset.nudge.split(",").map(Number), k = e.shiftKey ? 0.1 : 0.01;
      state.desk3d.nudge(it.id, dx * k, dz * k);
    });
    const f = $("#selFocus"); if (f) f.onclick = () => state.desk3d.focus(it.id);
  }
  function paintDims() {
    const it = itemById(selected), el = $("#selDims");
    if (!it || !el) return;
    const dm = D3.dimsOf(it), lying = it.type === "ps5" && it.orient === "horizontal";
    const [w, d, h] = lying ? [dm.h, dm.d, dm.w] : [dm.w, dm.d, dm.h];
    el.innerHTML = `Ocupa <b>${num1(w)} × ${num1(d)} cm</b> y mide ${num1(h)} cm de alto <span class="muted">(ancho × fondo; medidas ${esc(dimsSrc(dm, it))})</span>`;
  }
  /* skipFocused: no pisar lo que el usuario está escribiendo */
  function paintPos(skipFocused = true) {
    const box = $("#selPanel"), it = itemById(selected);
    if (!it || box.hidden) return;
    const p = state.desk3d.describe().find((x) => x.id === it.id)?.pos || it.pos;
    if (!p) return;
    const vals = { x: Math.round(p.x * 1000) / 10, z: Math.round(p.z * 1000) / 10, rot: Math.round((-p.rot * 180) / Math.PI) };
    box.querySelectorAll("[data-pos]").forEach((el) => {
      if (skipFocused && document.activeElement === el) return;
      el.value = String(vals[el.dataset.pos]);
    });
  }

  /* --- la mesa */
  function paintTable() {
    const t = state.deskTable;
    document.querySelectorAll("[data-table]").forEach((el) => { el.value = String(t[el.dataset.table] ?? ""); });
    $("#tPreset").value = presets.some((p) => p.id === t.preset) ? t.preset : "custom";
    $("#tReturn").hidden = t.shape === "rect";
    const p = presets.find((x) => x.id === t.preset);
    $("#tNote").textContent = p ? `${p.name}${p.approx ? " · medidas orientativas, compruébalas con las de tu mesa" : ""}.`
      : `Mesa de ${num1(t.width_cm)} × ${num1(t.depth_cm)} cm a ${num1(t.height_cm)} cm del suelo.`;
  }
  function applyTable(t, { save = true } = {}) {
    state.deskTable = D3.normTable(t);
    paintTable();
    state.desk3d.setTable(state.deskTable);
    if (save) later(400);
    scheduleFit();
  }
  function tableChanged() {
    const t = { ...state.deskTable, preset: "custom" };
    document.querySelectorAll("[data-table]").forEach((el) => {
      const k = el.dataset.table;
      t[k] = el.type === "number" ? parseFloat(String(el.value).replace(",", ".")) : el.value;
    });
    applyTable(t);
  }
  document.querySelectorAll("[data-table]").forEach((el) => el.addEventListener("change", tableChanged));
  $("#tPreset").onchange = (e) => {
    const p = presets.find((x) => x.id === e.target.value);
    if (p) { applyTable({ ...p.table }); tell(`Mesa: ${p.name}`); } else applyTable({ ...state.deskTable, preset: "custom" });
  };
  $("#tableReset").onclick = () => applyTable({ ...D3.TABLE_DEFAULT });
  paintTable();
  api("/api/desk/presets").then((r) => {
    presets = r.items || [];
    $("#tPreset").insertAdjacentHTML("beforeend", presets.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.approx ? " (aprox.)" : ""}</option>`).join(""));
    paintTable();
  }).catch(() => {});

  /* --- ambiente */
  function paintStyle() {
    const st = state.deskStyle;
    document.querySelectorAll("[data-style]").forEach((el) => {
      const v = st[el.dataset.style];
      if (el.type === "checkbox") el.checked = !!v; else el.value = String(v ?? "");
    });
    document.querySelectorAll("[data-decor]").forEach((el) => { el.checked = (st.decor || []).includes(el.dataset.decor); });
  }
  function styleChanged() {
    const st = { ...state.deskStyle };
    document.querySelectorAll("[data-style]").forEach((el) => { st[el.dataset.style] = el.type === "checkbox" ? el.checked : el.value; });
    st.decor = [...document.querySelectorAll("[data-decor]:checked")].map((el) => el.dataset.decor);
    state.deskStyle = st;
    state.desk3d.setStyle(st);
    later(400);
  }
  paintStyle();
  $("#stylePanel").querySelectorAll("select,input").forEach((el) => el.addEventListener(el.type === "color" ? "input" : "change", styleChanged));
  $("#styleReset").onclick = () => { state.deskStyle = { ...DEFAULT_STYLE }; paintStyle(); styleChanged(); };

  /* --- barra 3D */
  const rot = (d) => { if (selected) state.desk3d.rotate(selected, d); };
  $("#rotL").onclick = () => rot(Math.PI / 12);
  $("#rotR").onclick = () => rot(-Math.PI / 12);
  $("#relayout").onclick = async () => { state.deskItems.forEach((i) => { delete i.pos; }); await persist("Todo recolocado"); };
  document.querySelectorAll("[data-cam]").forEach((b) => b.onclick = () => {
    state.desk3d.cameraPreset(b.dataset.cam);
    document.querySelectorAll("[data-cam]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  });
  const zIn = () => state.desk3d.zoomIn?.(), zOut = () => state.desk3d.zoomOut?.();
  $("#zoomIn").onclick = zIn; $("#zoomIn2").onclick = zIn;
  $("#zoomOut").onclick = zOut; $("#zoomOut2").onclick = zOut;
  $("#zoomFit").onclick = () => { state.desk3d.cameraPreset("iso");
    document.querySelectorAll("[data-cam]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.cam === "iso"))); };
  $("#measBtn").onclick = () => { const on = state.desk3d.toggleMeasures(); $("#measBtn").setAttribute("aria-pressed", String(on)); };
  $("#snap").onclick = () => {
    const url = state.desk3d.snapshot?.();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url; a.download = "mi-escritorio.png"; a.click();
  };

  /* --- ¿cabe todo? El servidor lo comprueba con las posiciones reales del 3D */
  function scheduleFit(ms = 350) { clearTimeout(fitTimer); fitTimer = setTimeout(checkFit, ms); }
  async function checkFit() {
    const seq = ++fitSeq;
    const desc = new Map(state.desk3d.describe().map((d) => [d.id, d]));
    const items = state.deskItems.map((it) => {
      const d = desc.get(it.id) || {}, o = cleanItem(it);
      if (d.pos) o.pos = d.pos;
      if (d.span != null) o.span = Math.min(3, d.span);
      return o;
    });
    try {
      const r = await api("/api/desk/fit", { method: "POST", body: { items, table: state.deskTable } });
      if (seq !== fitSeq || state.view !== "desk") return;
      lastFit = r;
      state.desk3d.markIssues(r.issues);
      renderFit(r);
    } catch (e) { $("#deskFit").innerHTML = `<p class="small error">No se pudo comprobar si cabe todo: ${esc(e.message)}</p>`; }
    renderSummary();
  }
  function renderFit(r) {
    const n = r.issues.length, bad = r.issues.filter((i) => i.severity === "bad").length;
    const used = `${r.used_pct}% de la mesa ocupado`;
    $("#deskFit").innerHTML = !state.deskItems.length ? "" : n === 0
      ? `<p class="d3-fit-ok small">✅ Todo cabe en tu mesa · <span class="muted">${used}</span></p>`
      : `<p class="small d3-fit-head"><b>${bad ? "🚫" : "⚠️"} ${n === 1 ? "1 aviso" : `${n} avisos`}</b> · <span class="muted">${used}</span></p>
        <ul class="d3-issues">${r.issues.map((i) => `<li class="${i.severity === "bad" ? "bad" : "warn"}"><button type="button" class="linkish" data-focus="${esc(i.ids?.[0] || "")}">
          <span class="sr-only">${i.severity === "bad" ? "Problema:" : "Aviso:"}</span> ${esc(i.text)}</button></li>`).join("")}</ul>`;
    $("#deskFit").querySelectorAll("[data-focus]").forEach((b) => b.onclick = () => {
      const id = b.dataset.focus; if (!id) return;
      state.desk3d.focus(id); select(id);
    });
    if (n !== lastIssueCount && lastIssueCount >= 0) tell(n ? `${n === 1 ? "1 aviso" : `${n} avisos`} de medidas` : "Todo cabe en tu mesa");
    lastIssueCount = n;
  }
  /* Resumen en texto para lectores de pantalla (la descripción del lienzo 3D) */
  function renderSummary() {
    const t = state.deskTable, mat = TABLE_SEL.material[1].find(([v]) => v === t.material)?.[1] || t.material;
    const legs = TABLE_SEL.legs[1].find(([v]) => v === t.legs)?.[1] || t.legs;
    const where = (p) => !p ? "" : `${p.x < -0.15 ? "a la izquierda" : p.x > 0.15 ? "a la derecha" : "en el centro"}, ${p.z < -0.1 ? "al fondo" : p.z > 0.1 ? "delante" : "en medio"}`;
    const desc = new Map(state.desk3d.describe().map((d) => [d.id, d]));
    const items = state.deskItems.map((it) => `${nameOf(it)} (${where(desc.get(it.id)?.pos)})`);
    const issues = lastFit?.issues || [];
    $("#deskSummary").textContent = `Mesa ${t.shape === "rect" ? "rectangular" : "en L"} de ${num1(t.width_cm)} por ${num1(t.depth_cm)} cm y ${num1(t.height_cm)} cm de alto, `
      + `${mat.toLowerCase()}, ${legs.toLowerCase()}. ${items.length ? `Encima: ${items.join("; ")}.` : "Está vacía."} `
      + (issues.length ? `Avisos: ${issues.map((i) => i.text).join(" ")}` : items.length ? "Todo cabe." : "");
  }

  function renderList() {
    const items = state.deskItems;
    $("#deskEmpty").hidden = items.length > 0;
    $("#count").textContent = items.length ? `(${items.length})` : "";
    $("#deskList").innerHTML = items.length ? items.map((it) => `<li class="d3-li ${it.id === selected ? "sel" : ""}">
        <button type="button" class="d3-item" data-item="${esc(it.id)}" aria-pressed="${it.id === selected}">
          <span class="em" aria-hidden="true">${typeInfo(it.type).emoji}</span>
          <span><b>${esc(nameOf(it))}</b><span class="small muted d3-sub">${esc(summary(it))}</span>
          ${it.paid ? `<span class="small muted d3-sub">Pagado: ${eur(it.paid)}</span>` : ""}</span></button>
        <button class="ghost small" data-edit="${esc(it.id)}" title="Editar" aria-label="Editar ${esc(nameOf(it))}">✏️</button>
        <button class="ghost small" data-del="${esc(it.id)}" title="Quitar" aria-label="Quitar ${esc(nameOf(it))}">🗑️</button></li>`).join("")
      : `<li class="plain muted small">Aún nada. Elige arriba qué quieres añadir.</li>
         ${fromProfile().length ? `<li class="plain"><button class="secondary small" id="importProfile">📥 Poner en la mesa tus dispositivos guardados (${fromProfile().length})</button></li>` : ""}`;
    $("#deskCtas").innerHTML = items.length ? `<button class="primary" data-go="accessories">🧩 Ver accesorios compatibles</button>
      ${items.some((i) => ["laptop", "desktop", "ps5"].includes(i.type)) ? `<button class="secondary" data-go="monitors">🖥️ Monitores para mi escritorio</button>` : ""}` : "";
    $("#deskList").querySelectorAll("[data-item]").forEach((b) => b.onclick = () => {
      const id = b.dataset.item, again = selected === id;
      state.desk3d.select(again ? null : id); select(again ? null : id);
      if (!again) tell(`Elegido: ${nameOf(itemById(id))}`);
    });
    $("#deskList").querySelectorAll("[data-item]").forEach((b) => b.ondblclick = () => state.desk3d.focus(b.dataset.item));
    $("#deskList").querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      const it = itemById(b.dataset.del);
      state.deskItems = state.deskItems.filter((i) => i.id !== b.dataset.del);
      if (selected === b.dataset.del) select(null);
      await persist(`${nameOf(it)} quitado`);
    });
    $("#deskList").querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => openForm(itemById(b.dataset.edit).type, itemById(b.dataset.edit)));
    const imp = $("#importProfile");
    if (imp) imp.onclick = async () => { state.deskItems = fromProfile(); await persist("Dispositivos puestos en la mesa"); };
    $("#deskCtas").querySelectorAll("[data-go]").forEach((a) => a.onclick = () => go(a.dataset.go));
    state.desk3d.update(items);
    select(selected);
    scheduleFit(150);
  }

  async function persist(okMsg = "✓ Guardado") {
    renderList();
    clearTimeout(saveTimer);
    try { await saveDesk(); notify(okMsg.startsWith("✓") ? okMsg : `✓ ${okMsg}`); renderSummary(); }
    catch (e) { notify(`No se pudo guardar: ${e.message}`, { type: "error" }); }
  }

  /* --- formulario con autocompletado */
  function showResult(r) {
    last = r;
    const dm = r.dims;
    $("#guess").innerHTML = (r.guess ? `🔍 Entendido: <b>${esc(r.guess)}</b>${r.quality ? ` <span class="badge b-rec">Calidad ${r.quality}/100</span>` : ""}` : "")
      + (dm ? `<div class="small muted">📏 ${num1(dm.w)} × ${num1(dm.d)} × ${num1(dm.h)} cm (ancho × fondo × alto, ${esc(dimsSrc(dm))})</div>` : "");
    $("#sheet").innerHTML = sheetHtml(r);
    $("#specBox").innerHTML = specFields(adding, r.specs || {});
    if (r.specs?.color && !$("#addColor").value) { $("#addColor").value = r.specs.color; paintSwatches(); }
  }

  function paintSwatches() {
    const opts = last?.colors;
    const cur = $("#addColor").value;
    const keys = (opts && opts.length ? opts : ["black", "white", "space_gray", "silver", "blue"]).filter((k) => COLORS[k]);
    $("#swatches").innerHTML = COLORABLE.includes(adding) ? keys.map((k) => `<button type="button" class="swatch ${k === cur ? "sel" : ""}"
      data-color="${k}" title="${esc(COLORS[k][0])}" aria-label="${esc(COLORS[k][0])}" aria-pressed="${k === cur}" style="background:${COLORS[k][1]}"></button>`).join("") : "";
    $("#swatches").querySelectorAll("[data-color]").forEach((b) => b.onclick = () => { $("#addColor").value = b.dataset.color; paintSwatches(); });
  }

  function openForm(type, item = null) {
    adding = type; editing = item; last = item ? { specs: item.specs || {}, catalog_id: item.catalog_id, dims: item.dims_auto } : null;
    document.querySelectorAll(".type-btn").forEach((b) => b.classList.toggle("sel", b.dataset.type === type));
    const info = typeInfo(type);
    $("#addForm").hidden = false;
    $("#addTitle").textContent = `${info.emoji} ${info.name}`;
    $("#addOk").textContent = item ? "Guardar cambios" : "Añadir";
    const inp = $("#addModel");
    inp.placeholder = info.ph; inp.value = item?.model || "";
    $("#addPaid").value = item?.paid ?? "";
    $("#addColor").value = item?.specs?.color && COLORS[item.specs.color] ? item.specs.color : "";
    $("#colorLbl").hidden = !COLORABLE.includes(type);
    $("#guess").textContent = ""; $("#sheet").innerHTML = "";
    $("#specBox").innerHTML = specFields(type, item?.specs || {});
    closeAc();
    if (item) identify(item.catalog_id); else identify();
    paintSwatches();
    inp.focus();
  }

  async function identify(catalogId = null) {
    const model = $("#addModel").value.trim();
    try {
      const r = await api("/api/desk/identify", { method: "POST", body: { type: adding, model, catalog_id: catalogId } });
      if (editing && !catalogId && !r.catalog_id && model === editing.model) r.specs = { ...r.specs, ...editing.specs };
      showResult(r);
      paintSwatches();
    } catch (e) { $("#guess").textContent = e.message; }
  }

  function closeAc() {
    $("#acList").hidden = true; acIdx = -1;
    $("#addModel").setAttribute("aria-expanded", "false"); $("#addModel").removeAttribute("aria-activedescendant");
  }
  async function suggest() {
    const q = $("#addModel").value.trim();
    if (q.length < 2) { closeAc(); return; }
    try {
      const r = await api(`/api/desk/suggest?type=${encodeURIComponent(adding)}&q=${encodeURIComponent(q)}`);
      acItems = r.items || [];
    } catch { acItems = []; }
    if (!acItems.length) { closeAc(); return; }
    acIdx = -1;
    $("#acList").innerHTML = acItems.map((s, i) => `<li role="option" id="ac-opt-${i}" aria-selected="false" data-i="${i}" class="${s.source === "parsed" ? "parsed" : ""}">
      <b>${esc(s.name)}</b>${s.exact ? ` <span class="badge b-cheap">✔</span>` : ""}${s.source === "parsed" ? ` <span class="small muted">(deducido)</span>` : ""}
      <div class="small muted">${esc(s.brief || "")}</div></li>`).join("");
    $("#acList").hidden = false;
    $("#addModel").setAttribute("aria-expanded", "true"); $("#addModel").removeAttribute("aria-activedescendant");
    $("#acList").querySelectorAll("li").forEach((li) => li.onmousedown = (e) => { e.preventDefault(); pick(+li.dataset.i); });
  }
  function pick(i) {
    const s = acItems[i];
    if (!s) return;
    closeAc();
    clearTimeout(timer);
    // si lo elegido es del catálogo, nos quedamos con lo que el usuario escribió de RAM/color además del modelo
    const typed = $("#addModel").value;
    const extra = (typed.match(/\b\d{1,3}\s?gb\b|\b\d\s?tb\b/gi) || []).map((x) => x.replace(/\s/g, "").toUpperCase().replace(/(\d)(GB|TB)/, "$1 $2")).join(" ");
    $("#addModel").value = (s.name + " " + extra).trim();
    if (s.source === "catalog") identify(s.id); else identify();
  }
  function hl() {
    $("#acList").querySelectorAll("li").forEach((li, i) => { li.classList.toggle("on", i === acIdx); li.setAttribute("aria-selected", String(i === acIdx)); });
    const cur = acIdx >= 0 ? `ac-opt-${acIdx}` : "";
    if (cur) { $("#addModel").setAttribute("aria-activedescendant", cur); document.getElementById(cur)?.scrollIntoView({ block: "nearest" }); }
    else $("#addModel").removeAttribute("aria-activedescendant");
  }

  $("#types").querySelectorAll(".type-btn").forEach((b) => b.onclick = () => openForm(b.dataset.type));
  $("#addModel").oninput = () => {
    clearTimeout(timer); clearTimeout(acTimer);
    acTimer = setTimeout(suggest, 180);
    timer = setTimeout(() => identify(), 450);
  };
  $("#addModel").onkeydown = (e) => {
    if ($("#acList").hidden) return;
    if (e.key === "ArrowDown") { acIdx = Math.min(acItems.length - 1, acIdx + 1); hl(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { acIdx = Math.max(0, acIdx - 1); hl(); e.preventDefault(); }
    else if (e.key === "Enter" && acIdx >= 0) { pick(acIdx); e.preventDefault(); }
    else if (e.key === "Escape") { closeAc(); e.preventDefault(); }
  };
  $("#addModel").onblur = () => setTimeout(closeAc, 150);
  $("#addColor").onchange = paintSwatches;
  $("#addCancel").onclick = () => { $("#addForm").hidden = true; document.querySelectorAll(".type-btn").forEach((b) => b.classList.remove("sel")); };
  $("#addForm").onsubmit = async (e) => {
    e.preventDefault();
    clearTimeout(timer); clearTimeout(acTimer);
    if (!$("#acList").hidden && acIdx >= 0) return;
    const specs = readSpecs($("#specBox"), last?.specs || {});
    const color = $("#addColor").value;
    if (color) specs.color = color; else delete specs.color;
    const model = $("#addModel").value.trim() || typeInfo(adding).name;
    const paid = $("#addPaid").value === "" ? null : +$("#addPaid").value;
    const fields = { model, specs, catalog_id: last?.catalog_id || null, paid, color: color ? COLORS[color][1] : null };
    if (last?.dims) fields.dims_auto = last.dims;   // hasta que el servidor las recalcule al guardar
    let id;
    if (editing) { Object.assign(editing, fields); id = editing.id; }
    else { id = uid(); state.deskItems.push({ id, type: adding, ...fields }); }
    $("#addForm").hidden = true;
    document.querySelectorAll(".type-btn").forEach((b) => b.classList.remove("sel"));
    await persist(editing ? `${model} actualizado` : `${model} añadido a la mesa`);
    if (!editing) { state.desk3d.select(id); select(id); }
  };
  renderList();
}

/* Los dispositivos de «Mi setup» (encuesta) como objetos del escritorio */
function fromProfile() {
  return (state.profile?.devices || []).filter((d) => !String(d.id).startsWith("desk-")).map((d) => {
    const mac = d.kind.startsWith("mac");
    const base = { id: "p" + d.id, model: deviceTitle(d), catalog_id: null };
    if (d.kind === "mac_laptop" || d.kind === "windows_laptop") return { ...base, type: "laptop", specs: mac
      ? { platform: "mac", chip_gen: d.chip_gen, chip_tier: d.chip_tier, model_line: d.model_line, screen_in: d.screen_in, ram_gb: d.ram_gb,
          ports: { usb_c: true, thunderbolt: true, hdmi: d.model_line === "pro" && [14, 16].includes(+d.screen_in), dp: false, usb_a: false } }
      : { platform: "windows", gpu_tier: d.gpu_tier, ports: { usb_c: !!d.usb_c_dp, thunderbolt: false, hdmi: true, dp: false, usb_a: true } } };
    if (d.kind === "mac_desktop") return { ...base, type: "desktop", specs: { platform: "mac", chip_gen: d.chip_gen, chip_tier: d.chip_tier, model_line: d.model_line,
      ports: { usb_c: true, thunderbolt: true, hdmi: true, dp: false, usb_a: false } } };
    if (d.kind === "desktop_pc") return { ...base, type: "desktop", specs: { platform: "windows", gpu_tier: d.gpu_tier, ports: { usb_c: true, hdmi: true, dp: true, usb_a: true } } };
    if (d.kind === "ps5") return { ...base, type: "ps5", specs: { edition: d.edition } };
    return null;
  }).filter(Boolean);
}

function summary(it) {
  const s = it.specs || {};
  const col = s.color && COLORS[s.color] ? COLORS[s.color][0] : null;
  if (it.type === "monitor") return [s.size_in && `${s.size_in}"`, s.aspect && s.aspect !== "16:9" && s.aspect, s.refresh_hz && `${s.refresh_hz} Hz`,
    s.usb_c && "USB-C", s.hdmi21 && "HDMI 2.1", it.catalog_id && "✔ en el catálogo"].filter(Boolean).join(" · ");
  if (it.type === "laptop" || it.type === "desktop") {
    const p = Object.entries(s.ports || {}).filter(([k, v]) => v && ["usb_c", "thunderbolt", "hdmi", "dp", "usb_a"].includes(k))
      .map(([k]) => ({ usb_c: "USB-C", thunderbolt: "TB", hdmi: "HDMI", dp: "DP", usb_a: "USB-A" }[k]));
    return [s.platform === "mac" ? `M${s.chip_gen || "?"}${s.chip_tier && s.chip_tier !== "base" ? " " + s.chip_tier[0].toUpperCase() + s.chip_tier.slice(1) : ""}` : "Windows",
      s.ram_gb && `${s.ram_gb} GB`, s.storage_gb && (s.storage_gb >= 1000 ? `${s.storage_gb / 1000} TB` : `${s.storage_gb} GB SSD`), col, ...p].filter(Boolean).join(" · ");
  }
  if (it.type === "ps5") return [{ digital: "Digital (sin lector)", standard: "Con lector", pro: "Pro" }[s.edition], s.model && { fat: "Original", slim: "Slim", pro: "" }[s.model]].filter(Boolean).join(" · ");
  if (it.type === "phone" || it.type === "tablet") return [s.os === "ios" ? (it.type === "phone" ? "iPhone" : "iPad") : "Android",
    s.connector === "lightning" ? "Lightning" : "USB-C", s.magsafe && "MagSafe", s.qi2 && !s.magsafe && "Qi2", col].filter(Boolean).join(" · ");
  return [s.bt && "Bluetooth", s.receiver && "Receptor", s.ps5_wireless && "PS5", s.anc && "ANC", s.mechanical && "Mecánico",
    !s.bt && s.wireless && "Inalámbrico", col, it.catalog_id && "✔ en el catálogo"].filter(Boolean).join(" · ");
}

/* ---------------------------------------------------------------- vista: Accesorios */

function compatBlock(c) {
  if (!c) return "";
  const cls = c.score >= 85 ? "good" : c.score >= 60 ? "warn" : "bad";
  return `<div class="compat"><span class="compat-score ${cls}">Compatibilidad ${c.score}/100</span>
    ${c.pros.length ? `<ul class="pros">${c.pros.slice(0, 5).map((p) => `<li>✅ ${esc(p)}</li>`).join("")}</ul>` : ""}
    ${c.cons.length ? `<ul class="cons">${c.cons.slice(0, 4).map((p) => `<li>⚠️ ${esc(p)}</li>`).join("")}</ul>` : ""}</div>`;
}

function accessoryCard(r) {
  const p = r.product;
  const forNames = (r.for || []).map((id) => state.deskItems?.find((i) => i.id === id)?.model).filter(Boolean);
  const badges = [...(r.badges || [])];
  if (r.pricing.good_price && !badges.includes("💸 Buen precio ahora")) badges.push("💸 Buen precio ahora");
  return `<article class="result acc">
    <div class="result-head"><div>
      <div>${badges.map((b) => `<span class="badge ${b.startsWith("💸") || b.startsWith("💶") ? "b-cheap" : "b-rec"}">${esc(b)}</span>`).join("")}
        ${r.priority === 1 && !badges.length ? `<span class="badge b-rec">Muy recomendable</span>` : ""}
        ${r.quality ? `<span class="badge">Calidad ${r.quality}/100</span>` : ""}</div>
      <div class="title">${p.icon} ${esc(p.name)}</div>
      <p>${esc(r.reason)}</p>
      ${forNames.length ? `<div class="small muted">Para: ${forNames.map(esc).join(", ")}</div>` : ""}
      ${compatBlock(r.compat)}
      <div class="small muted">${esc(p.notes || "")}</div></div>
      ${priceBlock(r.pricing)}</div>
    ${r.placeable ? `<div class="actions" style="justify-content:flex-start"><button class="ghost small" data-place="${esc(p.id)}">🪑 Añadir a mi escritorio</button></div>` : ""}
    <details><summary>🛒 Precios por tienda (${r.pricing.offers.length})</summary>${offersTable(r.pricing)}${linksRow(r.links)}</details>
    ${productActions(p, p.name)}
  </article>`;
}

async function viewAccessories() {
  app.innerHTML = `<h1>🧩 Accesorios para tu escritorio</h1>
    <p class="muted">Según lo que tienes en <a href="#desk" data-go="desk">🪑 Mi escritorio</a>: lo que te falta (elegido para que funcione con
      todos tus dispositivos), mejoras que cuestan menos de lo que pagaste, cómo conectarlo todo y monitores que caben.
      La calidad es una puntuación <b>orientativa</b> y los precios sin buscar también: pulsa 🔎 para ver el precio real de hoy.</p>
    ${keyBanner()}
    <div id="accOut">${typeof skeleton === "function" ? skeleton("cards", { n: 3, label: "Calculando accesorios compatibles…" }) : `<p class="muted">Calculando…</p>`}</div>`;
  bindResultActions(app, () => {});
  async function load() {
    const out = $("#accOut");
    try {
      if (!state.deskItems || !state.deskStyle || !state.deskTable) {
        const d = await api("/api/desk");
        state.deskItems = d.items || []; state.deskStyle = cleanStyle(d.style); state.deskTable = d.table || null;
      }
      const r = await api("/api/accessories");
      if (r.empty) {
        out.innerHTML = `<div class="panel"><p>Tu escritorio está vacío: añade primero tus dispositivos y aquí verás lo que encaja con ellos.</p>
          <button class="primary" data-go="desk">🪑 Ir a Mi escritorio</button></div>`;
        bindResultActions(out, load); return;
      }
      const nav = r.sections.map((s) => `<a class="chip" href="#acc-${s.id}">${s.icon} ${esc(s.title)} (${s.items.length + s.monitors.length})</a>`).join("");
      const liveIds = r.sections.flatMap((s) => s.items.map((i) => i.product.id));
      out.innerHTML = `${r.notes.map((n) => `<div class="notice">ℹ️ ${esc(n)}</div>`).join("")}
        <div class="chips acc-nav">${nav}</div>
        <div class="actions" style="justify-content:flex-start"><button class="primary" id="accLiveAll">🔎 Buscar precio de todos (${liveIds.length})</button>
          <span class="small muted" style="align-self:center">Cada búsqueda gasta 1-4 consultas de SerpApi.</span></div>
        ${r.sections.map((s) => `<section id="acc-${s.id}"><h2>${s.icon} ${esc(s.title)}</h2><p class="muted small">${esc(s.desc)}</p>
          ${s.monitors.map((m) => `<div class="small acc-why">👉 ${esc(m.reason)}</div>${monitorCard(m)}`).join("")}
          ${s.items.map(accessoryCard).join("")}</section>`).join("")}`;
      $("#accLiveAll").onclick = (e) => runLiveAll([...new Set(liveIds)], out, load, e.target);
      out.querySelectorAll(".acc-nav a").forEach((a) => a.onclick = (e) => { e.preventDefault(); document.querySelector(a.getAttribute("href"))?.scrollIntoView({ behavior: "smooth" }); });
      out.querySelectorAll("[data-place]").forEach((b) => b.onclick = async () => {
        const p = state.catalog.accessories.find((a) => a.id === b.dataset.place);
        const type = KIND_TO_TYPE[p.kind];
        const ident = await api("/api/desk/identify", { method: "POST", body: { type, model: p.name, catalog_id: p.id } });
        state.deskItems.push({ id: uid(), type, model: p.name, specs: ident.specs, catalog_id: ident.catalog_id || p.id, ...(ident.dims ? { dims_auto: ident.dims } : {}) });
        try { await saveDesk(); notify(`✓ ${p.name} añadido a tu escritorio`); } catch (e) { notify(`No se pudo guardar: ${e.message}`, { type: "error" }); return; }
        go("desk");
      });
      bindResultActions(out, load);
    } catch (e) { out.innerHTML = `<p class="error">Error: ${esc(e.message)}</p>`; }
  }
  load();
}

VIEWS.desk = viewDesk;
VIEWS.accessories = viewAccessories;
