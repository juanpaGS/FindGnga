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

const STYLE_OPTS = {
  desk: [["oak", "Roble"], ["walnut", "Nogal"], ["white", "Blanco"], ["black", "Negro"], ["bamboo", "Bambú"], ["gray", "Gris"]],
  legs: [["black", "Negras"], ["white", "Blancas"], ["silver", "Plata"]],
  width: [[0, "Automático"], [1.2, "120 cm"], [1.4, "140 cm"], [1.6, "160 cm"], [1.8, "180 cm"], [2.0, "200 cm"], [2.4, "240 cm"]],
  depth: [[0.6, "60 cm"], [0.7, "70 cm"], [0.75, "75 cm"], [0.8, "80 cm"]],
  floor: [["wood", "Parqué"], ["concrete", "Cemento"], ["carpet", "Moqueta"], ["tiles", "Baldosa"]],
  light: [["day", "Día"], ["evening", "Atardecer"], ["night", "Noche"]],
  wallpaper: [["sunset", "Atardecer"], ["ocean", "Océano"], ["forest", "Bosque"], ["aurora", "Aurora"], ["mono", "Liso"]],
};
const DECOR = [["plant", "🪴 Planta"], ["mug", "☕ Taza"], ["books", "📚 Libros"], ["lamp", "🛋️ Lámpara"], ["frame", "🖼️ Cuadro"], ["window", "🪟 Ventana"]];
const DEFAULT_STYLE = { desk: "oak", legs: "black", width: 0, depth: 0.7, wall: "#e9e4dc", floor: "wood", light: "day",
  wallpaper: "sunset", decor: ["plant", "mug"], rgb: false };

/* Espera a que cargue el módulo 3D (se carga aparte, como módulo ES) */
function desk3dReady() {
  if (window.Desk3D) return Promise.resolve(window.Desk3D);
  return new Promise((ok) => window.addEventListener("desk3d-ready", () => ok(window.Desk3D), { once: true }));
}

async function saveDesk() {
  const r = await api("/api/desk", { method: "PUT", body: { items: state.deskItems, style: state.deskStyle || {} } });
  state.profile = r.profile;
  state.accessories = null; // hay que recalcular las recomendaciones
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
  const opt = (k) => STYLE_OPTS[k].map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
  app.innerHTML = `<h1>🪑 Mi escritorio</h1>
    <p class="muted">Añade lo que tienes en la mesa: escribe el modelo y elige de la lista para rellenar su ficha completa.
      FindGnga adapta la búsqueda (monitores, PS5 y <a href="#accessories" data-go="accessories">accesorios compatibles</a>) a tu escritorio.</p>
    <div class="desk-layout">
      <div>
        <div class="desk3d" id="desk3d"><div class="desk3d-empty" id="deskEmpty">Tu escritorio está vacío.<br>Empieza añadiendo tu monitor u ordenador →</div>
          <div class="desk3d-help small">Arrastra un objeto para moverlo · Q/E o ⟲⟳ lo giran · arrastra en vacío (o con Mayús) para girar la vista</div></div>
        <div class="desk-toolbar">
          <button class="ghost small" id="rotL" title="Girar a la izquierda (Q)">⟲ Girar</button>
          <button class="ghost small" id="rotR" title="Girar a la derecha (E)">⟳ Girar</button>
          <button class="ghost small" id="relayout" title="Volver a colocar todo automáticamente">↺ Recolocar todo</button>
          <button class="ghost small" id="snap">📸 Guardar imagen</button>
          <span class="small muted" id="selName"></span>
        </div>
        <details class="panel style-panel" id="stylePanel"><summary>🎨 Personalizar el escritorio</summary>
          <div class="style-grid">
            <label class="small">Mesa<select data-style="desk">${opt("desk")}</select></label>
            <label class="small">Patas<select data-style="legs">${opt("legs")}</select></label>
            <label class="small">Ancho<select data-style="width">${opt("width")}</select></label>
            <label class="small">Fondo<select data-style="depth">${opt("depth")}</select></label>
            <label class="small">Suelo<select data-style="floor">${opt("floor")}</select></label>
            <label class="small">Luz<select data-style="light">${opt("light")}</select></label>
            <label class="small">Fondo de pantalla<select data-style="wallpaper">${opt("wallpaper")}</select></label>
            <label class="small">Pared<input type="color" data-style="wall"></label>
          </div>
          <div class="spec-checks">${DECOR.map(([v, t]) => `<label class="inline small"><input type="checkbox" data-decor="${v}"> ${t}</label>`).join("")}
            <label class="inline small"><input type="checkbox" data-style="rgb"> 🌈 Luces RGB</label></div>
          <div class="actions" style="justify-content:flex-start"><button class="ghost small" id="styleReset">Restablecer estilo</button></div>
        </details>
      </div>
      <aside class="panel desk-side">
        <h3>➕ Añadir al escritorio</h3>
        <div class="type-grid" id="types">${DESK_TYPES.map((t) => `<button class="type-btn" data-type="${t.type}"><span>${t.emoji}</span>${esc(t.name)}</button>`).join("")}</div>
        <form id="addForm" class="add-form" hidden>
          <label class="small"><b id="addTitle"></b> · ¿qué modelo es?
            <div class="ac-wrap"><input type="text" id="addModel" autocomplete="off" maxlength="120" role="combobox" aria-expanded="false" aria-controls="acList">
              <ul class="ac-list" id="acList" role="listbox" hidden></ul></div></label>
          <div class="guess small" id="guess"></div>
          <div id="sheet"></div>
          <div class="spec-grid">
            <label class="small">¿Cuánto pagaste? (€)<input type="number" min="0" step="1" id="addPaid" placeholder="opcional"></label>
            <label class="small" id="colorLbl">Color<select id="addColor"><option value="">—</option>${Object.entries(COLORS).map(([k, [n]]) => `<option value="${k}">${n}</option>`).join("")}</select></label>
          </div>
          <div class="swatches" id="swatches"></div>
          <p class="small muted" style="margin:2px 0 6px">Con el precio pagado, «Mejoras que compensan» sólo te enseña cosas mejores que cuesten menos.</p>
          <details id="manual"><summary class="small">✏️ Ajustar la ficha a mano</summary><div id="specBox"></div></details>
          <div class="actions"><button type="button" class="ghost" id="addCancel">Cancelar</button><button class="primary" id="addOk">Añadir</button></div>
        </form>
        <h3 style="margin-top:16px">🧾 En tu mesa <span class="muted small" id="count"></span></h3>
        <ul class="desk-list" id="deskList"></ul>
        <div class="actions" id="deskCtas"></div>
      </aside>
    </div>`;
  bindResultActions(app, () => {});
  try {
    const d = await api("/api/desk");
    state.deskItems = d.items || [];
    state.deskStyle = { ...DEFAULT_STYLE, ...(d.style || {}) };
  } catch (e) { app.insertAdjacentHTML("beforeend", `<p class="error">${esc(e.message)}</p>`); return; }

  let adding = null, editing = null, timer = 0, acTimer = 0, last = null, acItems = [], acIdx = -1, selected = null, moveTimer = 0;
  const D3 = await desk3dReady();
  if (state.view !== "desk") return;
  state.desk3d = D3.mount($("#desk3d"), {
    onSelect: (id) => { select(id); if (id) document.querySelector(`[data-item="${id}"]`)?.scrollIntoView({ block: "nearest" }); },
    onMove: (id, pos) => {
      const it = state.deskItems.find((i) => i.id === id);
      if (!it) return;
      it.pos = pos;
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => saveDesk().catch(() => {}), 500);
    },
  });
  state.desk3d.setStyle?.(state.deskStyle);

  function select(id) {
    selected = id || null;
    document.querySelectorAll("#deskList li").forEach((li) => li.classList.toggle("sel", li.dataset.item === id));
    const it = state.deskItems.find((i) => i.id === id);
    $("#selName").textContent = it ? `Seleccionado: ${it.model || typeInfo(it.type).name}` : "Haz clic en un objeto para moverlo o girarlo";
  }

  /* --- estilo */
  function paintStyle() {
    const st = state.deskStyle;
    document.querySelectorAll("[data-style]").forEach((el) => {
      const v = st[el.dataset.style];
      if (el.type === "checkbox") el.checked = !!v; else el.value = String(v ?? "");
    });
    document.querySelectorAll("[data-decor]").forEach((el) => { el.checked = (st.decor || []).includes(el.dataset.decor); });
  }
  let styleTimer = 0;
  function styleChanged() {
    const st = { ...state.deskStyle };
    document.querySelectorAll("[data-style]").forEach((el) => {
      const k = el.dataset.style;
      st[k] = el.type === "checkbox" ? el.checked : ["width", "depth"].includes(k) ? +el.value : el.value;
    });
    st.decor = [...document.querySelectorAll("[data-decor]:checked")].map((el) => el.dataset.decor);
    state.deskStyle = st;
    state.desk3d.setStyle?.(st);
    clearTimeout(styleTimer);
    styleTimer = setTimeout(() => saveDesk().catch(() => {}), 400);
  }
  paintStyle();
  $("#stylePanel").querySelectorAll("select,input").forEach((el) => el.addEventListener(el.type === "color" ? "input" : "change", styleChanged));
  $("#styleReset").onclick = () => { state.deskStyle = { ...DEFAULT_STYLE }; paintStyle(); styleChanged(); };

  /* --- barra 3D */
  const rot = (d) => { if (selected) state.desk3d.rotate?.(selected, d); };
  $("#rotL").onclick = () => rot(Math.PI / 12);
  $("#rotR").onclick = () => rot(-Math.PI / 12);
  $("#relayout").onclick = async () => { state.deskItems.forEach((i) => { delete i.pos; }); await persist(); };
  $("#snap").onclick = () => {
    const url = state.desk3d.snapshot?.();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url; a.download = "mi-escritorio.png"; a.click();
  };
  select(null);

  function renderList() {
    const items = state.deskItems;
    $("#deskEmpty").hidden = items.length > 0;
    $("#count").textContent = items.length ? `(${items.length})` : "";
    $("#deskList").innerHTML = items.length ? items.map((it) => `<li data-item="${esc(it.id)}">
        <span class="em">${typeInfo(it.type).emoji}</span>
        <div><b>${esc(it.model || typeInfo(it.type).name)}</b><div class="small muted">${esc(summary(it))}</div>
          ${it.paid ? `<div class="small muted">Pagado: ${eur(it.paid)}</div>` : ""}</div>
        <button class="ghost small" data-edit="${esc(it.id)}" title="Editar">✏️</button>
        <button class="ghost small" data-del="${esc(it.id)}" title="Quitar">🗑️</button></li>`).join("")
      : `<li class="plain muted small">Aún nada. Elige arriba qué quieres añadir.</li>
         ${fromProfile().length ? `<li class="plain"><button class="secondary small" id="importProfile">📥 Poner en la mesa lo de «Mi setup» (${fromProfile().length})</button></li>` : ""}`;
    $("#deskCtas").innerHTML = items.length ? `<button class="primary" data-go="accessories">🧩 Ver accesorios compatibles</button>
      ${items.some((i) => ["laptop", "desktop", "ps5"].includes(i.type)) ? `<button class="secondary" data-go="monitors">🖥️ Monitores para mi escritorio</button>` : ""}` : "";
    $("#deskList").querySelectorAll("li[data-item]").forEach((li) => li.onclick = (e) => {
      if (e.target.closest("button")) return;
      state.desk3d.select(li.dataset.item); select(li.dataset.item);
    });
    $("#deskList").querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      state.deskItems = state.deskItems.filter((i) => i.id !== b.dataset.del);
      await persist();
    });
    $("#deskList").querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => {
      const it = state.deskItems.find((i) => i.id === b.dataset.edit);
      openForm(it.type, it);
    });
    const imp = $("#importProfile");
    if (imp) imp.onclick = async () => { state.deskItems = fromProfile(); await persist(); };
    $("#deskCtas").querySelectorAll("[data-go]").forEach((a) => a.onclick = () => go(a.dataset.go));
    state.desk3d.update(items);
  }

  async function persist() {
    renderList();
    try { await saveDesk(); } catch (e) { alert("No se pudo guardar: " + e.message); }
  }

  /* --- formulario con autocompletado */
  function showResult(r) {
    last = r;
    $("#guess").innerHTML = r.guess ? `🔍 Entendido: <b>${esc(r.guess)}</b>${r.quality ? ` <span class="badge b-rec">Calidad ${r.quality}/100</span>` : ""}` : "";
    $("#sheet").innerHTML = sheetHtml(r);
    $("#specBox").innerHTML = specFields(adding, r.specs || {});
    if (r.specs?.color && !$("#addColor").value) { $("#addColor").value = r.specs.color; paintSwatches(); }
  }

  function paintSwatches() {
    const opts = last?.colors;
    const cur = $("#addColor").value;
    const keys = (opts && opts.length ? opts : ["black", "white", "space_gray", "silver", "blue"]).filter((k) => COLORS[k]);
    $("#swatches").innerHTML = COLORABLE.includes(adding) ? keys.map((k) => `<button type="button" class="swatch ${k === cur ? "sel" : ""}"
      data-color="${k}" title="${esc(COLORS[k][0])}" style="background:${COLORS[k][1]}"></button>`).join("") : "";
    $("#swatches").querySelectorAll("[data-color]").forEach((b) => b.onclick = () => { $("#addColor").value = b.dataset.color; paintSwatches(); });
  }

  function openForm(type, item = null) {
    adding = type; editing = item; last = item ? { specs: item.specs || {}, catalog_id: item.catalog_id } : null;
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

  function closeAc() { $("#acList").hidden = true; $("#addModel").setAttribute("aria-expanded", "false"); acIdx = -1; }
  async function suggest() {
    const q = $("#addModel").value.trim();
    if (q.length < 2) { closeAc(); return; }
    try {
      const r = await api(`/api/desk/suggest?type=${encodeURIComponent(adding)}&q=${encodeURIComponent(q)}`);
      acItems = r.items || [];
    } catch { acItems = []; }
    if (!acItems.length) { closeAc(); return; }
    acIdx = -1;
    $("#acList").innerHTML = acItems.map((s, i) => `<li role="option" data-i="${i}" class="${s.source === "parsed" ? "parsed" : ""}">
      <b>${esc(s.name)}</b>${s.exact ? ` <span class="badge b-cheap">✔</span>` : ""}${s.source === "parsed" ? ` <span class="small muted">(deducido)</span>` : ""}
      <div class="small muted">${esc(s.brief || "")}</div></li>`).join("");
    $("#acList").hidden = false;
    $("#addModel").setAttribute("aria-expanded", "true");
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
  function hl() { $("#acList").querySelectorAll("li").forEach((li, i) => li.classList.toggle("on", i === acIdx)); }

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
    else if (e.key === "Escape") closeAc();
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
    if (editing) Object.assign(editing, fields);
    else state.deskItems.push({ id: uid(), type: adding, ...fields });
    $("#addForm").hidden = true;
    document.querySelectorAll(".type-btn").forEach((b) => b.classList.remove("sel"));
    await persist();
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
    <div id="accOut"><p class="muted">Calculando…</p></div>`;
  bindResultActions(app, () => {});
  async function load() {
    const out = $("#accOut");
    try {
      if (!state.deskItems || !state.deskStyle) {
        const d = await api("/api/desk");
        state.deskItems = d.items || []; state.deskStyle = d.style || {};
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
        state.deskItems.push({ id: uid(), type, model: p.name, specs: ident.specs, catalog_id: ident.catalog_id || p.id });
        await saveDesk();
        go("desk");
      });
      bindResultActions(out, load);
    } catch (e) { out.innerHTML = `<p class="error">Error: ${esc(e.message)}</p>`; }
  }
  load();
}

VIEWS.desk = viewDesk;
VIEWS.accessories = viewAccessories;
