/* FindGnga – Mi escritorio (3D) y Accesorios compatibles.
 * Usa las utilidades de app.js ($, api, esc, eur, state, priceBlock…). */
"use strict";

const DESK_TYPES = [
  { type: "monitor", emoji: "🖥️", name: "Monitor", ph: "p. ej. LG 27UP850N, Dell U2723QE, Samsung Odyssey G9" },
  { type: "laptop", emoji: "💻", name: "Portátil", ph: "p. ej. MacBook Air M2 13, Lenovo Legion RTX 4060" },
  { type: "desktop", emoji: "🗄️", name: "Ordenador / PC", ph: "p. ej. Mac mini M4, PC con RTX 4070" },
  { type: "ps5", emoji: "🎮", name: "PS5", ph: "p. ej. PS5 Slim Digital, PS5 Pro" },
  { type: "keyboard", emoji: "⌨️", name: "Teclado", ph: "p. ej. Logitech MX Keys, Keychron K2 inalámbrico" },
  { type: "mouse", emoji: "🖱️", name: "Ratón", ph: "p. ej. Logitech MX Master 3S" },
  { type: "phone", emoji: "📱", name: "Móvil", ph: "p. ej. iPhone 13, Pixel 8" },
  { type: "light", emoji: "💡", name: "Luz de monitor", ph: "p. ej. BenQ ScreenBar, Xiaomi Light Bar" },
  { type: "mousepad", emoji: "🟫", name: "Alfombrilla", ph: "p. ej. alfombrilla XXL 90×40" },
  { type: "headset", emoji: "🎧", name: "Cascos", ph: "p. ej. HyperX Cloud III, Sony WH-1000XM5" },
];
const typeInfo = (t) => DESK_TYPES.find((x) => x.type === t) || { emoji: "📦", name: t };
const KIND_TO_TYPE = { light: "light", mousepad: "mousepad", keyboard: "keyboard", mouse: "mouse", headset: "headset" };
const uid = () => Math.random().toString(36).slice(2, 10);

/* Espera a que cargue el módulo 3D (se carga aparte, como módulo ES) */
function desk3dReady() {
  if (window.Desk3D) return Promise.resolve(window.Desk3D);
  return new Promise((ok) => window.addEventListener("desk3d-ready", () => ok(window.Desk3D), { once: true }));
}

async function saveDesk() {
  const r = await api("/api/desk", { method: "PUT", body: { items: state.deskItems } });
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
  if (type === "monitor") return `<div class="spec-grid">${num("size_in", "Pulgadas", 0.5)}${sel("aspect", [["16:9", "16:9 normal"], ["21:9", "21:9 ultrapanorámico"], ["32:9", "32:9 doble"], ["16:10", "16:10"]], "Formato")}
    ${num("refresh_hz", "Hz")}</div><div class="spec-checks">${chk("usb_c", "USB-C con vídeo")}${chk("hdmi21", "HDMI 2.1")}${chk("dp", "DisplayPort")}${chk("curved", "Curvo")}</div>`;
  if (type === "laptop" || type === "desktop") {
    const mac = s.platform === "mac";
    return `<div class="spec-grid">${sel("platform", [["mac", "Mac"], ["windows", "Windows / Linux"]], "Sistema")}
      ${mac ? sel("chip_gen", [1, 2, 3, 4, 5, 6].map((n) => [n, "M" + n]), "Chip") + sel("chip_tier", [["base", "Normal"], ["pro", "Pro"], ["max", "Max"], ["ultra", "Ultra"]], "Versión")
        : sel("gpu_tier", [["integrated", "Gráfica integrada"], ["mid", "Gráfica media"], ["high", "Gráfica potente"]], "Gráfica")}
      ${mac && type === "laptop" ? sel("model_line", [["air", "Air"], ["pro", "Pro"]], "Modelo") + num("screen_in", "Pulgadas") : ""}
      ${mac && type === "desktop" ? sel("model_line", [["mini", "Mac mini"], ["studio", "Mac Studio"], ["imac", "iMac"]], "Modelo") : ""}</div>
      <div class="spec-checks"><span class="small muted">Puertos:</span>${port("usb_c", "USB-C")}${port("thunderbolt", "Thunderbolt")}${port("hdmi", "HDMI")}${port("dp", "DisplayPort")}${port("usb_a", "USB-A")}</div>`;
  }
  if (type === "ps5") return `<div class="spec-grid">${sel("edition", [["standard", "Con lector"], ["digital", "Digital"], ["pro", "Pro"]], "Edición")}</div>`;
  if (type === "phone") return `<div class="spec-grid">${sel("os", [["ios", "iPhone"], ["android", "Android"]], "Sistema")}
    ${sel("connector", [["usb_c", "USB-C"], ["lightning", "Lightning"]], "Conector")}</div><div class="spec-checks">${chk("magsafe", "MagSafe / Qi2")}</div>`;
  return `<div class="spec-checks">${chk("wireless", "Inalámbrico")}${type === "keyboard" ? chk("mechanical", "Mecánico") : ""}</div>`;
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
  if (ports.length) { s.ports = {}; ports.forEach((el) => { s.ports[el.dataset.port] = el.checked; }); }
  return s;
}

/* ---------------------------------------------------------------- vista: Mi escritorio */

async function viewDesk() {
  app.innerHTML = `<h1>🪑 Mi escritorio</h1>
    <p class="muted">Añade lo que tienes en la mesa. Cada cosa aparece en 3D con su tamaño real y FindGnga adapta la búsqueda
      (monitores, PS5 y <a href="#accessories" data-go="accessories">accesorios compatibles</a>) a tu escritorio.</p>
    <div class="desk-layout">
      <div class="desk3d" id="desk3d"><div class="desk3d-empty" id="deskEmpty">Tu escritorio está vacío.<br>Empieza añadiendo tu monitor u ordenador →</div>
        <div class="desk3d-help small">Arrastra para girar · rueda o pellizco para acercar · clic para elegir</div></div>
      <aside class="panel desk-side">
        <h3>➕ Añadir al escritorio</h3>
        <div class="type-grid" id="types">${DESK_TYPES.map((t) => `<button class="type-btn" data-type="${t.type}"><span>${t.emoji}</span>${esc(t.name)}</button>`).join("")}</div>
        <form id="addForm" class="add-form" hidden>
          <label class="small"><b id="addTitle"></b> · ¿qué modelo es?<input type="text" id="addModel" list="modelList" autocomplete="off" maxlength="120"></label>
          <datalist id="modelList"></datalist>
          <div class="guess small" id="guess"></div>
          <div id="specBox"></div>
          <div class="actions"><button type="button" class="ghost" id="addCancel">Cancelar</button><button class="primary" id="addOk">Añadir</button></div>
        </form>
        <h3 style="margin-top:16px">🧾 En tu mesa <span class="muted small" id="count"></span></h3>
        <ul class="desk-list" id="deskList"></ul>
        <div class="actions" id="deskCtas"></div>
      </aside>
    </div>`;
  bindResultActions(app, () => {});
  try { state.deskItems = (await api("/api/desk")).items || []; }
  catch (e) { app.insertAdjacentHTML("beforeend", `<p class="error">${esc(e.message)}</p>`); return; }

  let adding = null, editing = null, timer = 0, lastSpecs = {}, lastCatalog = null;
  const D3 = await desk3dReady();
  if (state.view !== "desk") return;
  state.desk3d = D3.mount($("#desk3d"), {
    onSelect: (id) => { highlight(id); if (id) document.querySelector(`[data-item="${id}"]`)?.scrollIntoView({ block: "nearest" }); },
  });

  function highlight(id) {
    document.querySelectorAll("#deskList li").forEach((li) => li.classList.toggle("sel", li.dataset.item === id));
  }

  function renderList() {
    const items = state.deskItems;
    $("#deskEmpty").hidden = items.length > 0;
    $("#count").textContent = items.length ? `(${items.length})` : "";
    $("#deskList").innerHTML = items.length ? items.map((it) => `<li data-item="${esc(it.id)}">
        <span class="em">${typeInfo(it.type).emoji}</span>
        <div><b>${esc(it.model || typeInfo(it.type).name)}</b><div class="small muted">${esc(summary(it))}</div></div>
        <button class="ghost small" data-edit="${esc(it.id)}" title="Editar">✏️</button>
        <button class="ghost small" data-del="${esc(it.id)}" title="Quitar">🗑️</button></li>`).join("")
      : `<li class="plain muted small">Aún nada. Elige arriba qué quieres añadir.</li>
         ${fromProfile().length ? `<li class="plain"><button class="secondary small" id="importProfile">📥 Poner en la mesa lo de «Mi setup» (${fromProfile().length})</button></li>` : ""}`;
    $("#deskCtas").innerHTML = items.length ? `<button class="primary" data-go="accessories">🧩 Ver accesorios compatibles</button>
      ${items.some((i) => ["laptop", "desktop", "ps5"].includes(i.type)) ? `<button class="secondary" data-go="monitors">🖥️ Monitores para mi escritorio</button>` : ""}` : "";
    $("#deskList").querySelectorAll("li[data-item]").forEach((li) => li.onclick = (e) => {
      if (e.target.closest("button")) return;
      state.desk3d.select(li.dataset.item); highlight(li.dataset.item);
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

  function openForm(type, item = null) {
    adding = type; editing = item;
    lastSpecs = item ? item.specs : {}; lastCatalog = item ? item.catalog_id : null;
    document.querySelectorAll(".type-btn").forEach((b) => b.classList.toggle("sel", b.dataset.type === type));
    const info = typeInfo(type);
    $("#addForm").hidden = false;
    $("#addTitle").textContent = `${info.emoji} ${info.name}`;
    $("#addOk").textContent = item ? "Guardar cambios" : "Añadir";
    const inp = $("#addModel");
    inp.placeholder = info.ph; inp.value = item?.model || "";
    $("#modelList").innerHTML = type === "monitor" ? state.catalog.monitors.map((m) => `<option value="${esc(m.brand + " " + m.model)}">`).join("") : "";
    $("#guess").textContent = "";
    $("#specBox").innerHTML = item ? specFields(type, item.specs || {}) : "";
    if (!item) identify();
    inp.focus();
  }

  async function identify() {
    const model = $("#addModel").value.trim();
    try {
      const r = await api("/api/desk/identify", { method: "POST", body: { type: adding, model } });
      lastSpecs = r.specs; lastCatalog = r.catalog_id;
      $("#guess").innerHTML = model && r.guess ? `🔍 Entendido: <b>${esc(r.guess)}</b>` : "";
      $("#specBox").innerHTML = specFields(adding, r.specs);
    } catch (e) { $("#guess").textContent = e.message; }
  }

  $("#types").querySelectorAll(".type-btn").forEach((b) => b.onclick = () => openForm(b.dataset.type));
  $("#addModel").oninput = () => { clearTimeout(timer); timer = setTimeout(identify, 350); };
  $("#addCancel").onclick = () => { $("#addForm").hidden = true; document.querySelectorAll(".type-btn").forEach((b) => b.classList.remove("sel")); };
  $("#addForm").onsubmit = async (e) => {
    e.preventDefault();
    clearTimeout(timer);
    const specs = readSpecs($("#specBox"), lastSpecs);
    const model = $("#addModel").value.trim() || typeInfo(adding).name;
    if (editing) Object.assign(editing, { model, specs, catalog_id: lastCatalog });
    else state.deskItems.push({ id: uid(), type: adding, model, specs, catalog_id: lastCatalog });
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
  if (it.type === "monitor") return [s.size_in && `${s.size_in}"`, s.aspect !== "16:9" && s.aspect, s.refresh_hz && `${s.refresh_hz} Hz`,
    s.usb_c && "USB-C", s.hdmi21 && "HDMI 2.1", it.catalog_id && "✔ en el catálogo"].filter(Boolean).join(" · ");
  if (it.type === "laptop" || it.type === "desktop") {
    const p = Object.entries(s.ports || {}).filter(([, v]) => v).map(([k]) => ({ usb_c: "USB-C", thunderbolt: "TB", hdmi: "HDMI", dp: "DP", usb_a: "USB-A" }[k]));
    return [s.platform === "mac" ? `Mac M${s.chip_gen || "?"}${s.chip_tier && s.chip_tier !== "base" ? " " + s.chip_tier : ""}` : "Windows", ...p].join(" · ");
  }
  if (it.type === "ps5") return { digital: "Digital (sin lector)", standard: "Con lector", pro: "Pro" }[s.edition] || "";
  if (it.type === "phone") return [s.os === "ios" ? "iPhone" : "Android", s.connector === "lightning" ? "Lightning" : "USB-C", s.magsafe && "MagSafe"].filter(Boolean).join(" · ");
  return s.wireless ? "Inalámbrico" : "";
}

/* ---------------------------------------------------------------- vista: Accesorios */

function accessoryCard(r) {
  const p = r.product;
  const forNames = (r.for || []).map((id) => state.deskItems?.find((i) => i.id === id)?.model).filter(Boolean);
  return `<article class="result acc">
    <div class="result-head"><div>
      <div>${r.pricing.good_price ? `<span class="badge b-cheap">💸 Buen precio ahora</span>` : ""}${r.priority === 1 ? `<span class="badge b-rec">Muy recomendable</span>` : ""}</div>
      <div class="title">${p.icon} ${esc(p.name)}</div>
      <p>${esc(r.reason)}</p>
      ${forNames.length ? `<div class="small muted">Para: ${forNames.map(esc).join(", ")}</div>` : ""}
      <div class="small muted">${esc(p.notes || "")}</div></div>
      ${priceBlock(r.pricing)}</div>
    ${r.placeable ? `<div class="actions" style="justify-content:flex-start"><button class="ghost small" data-place="${esc(p.id)}">🪑 Añadir a mi escritorio</button></div>` : ""}
    <details><summary>🛒 Precios por tienda (${r.pricing.offers.length})</summary>${offersTable(r.pricing)}${linksRow(r.links)}</details>
    ${productActions(p, p.name)}
  </article>`;
}

async function viewAccessories() {
  app.innerHTML = `<h1>🧩 Accesorios para tu escritorio</h1>
    <p class="muted">Según lo que tienes en <a href="#desk" data-go="desk">🪑 Mi escritorio</a>: lo que te falta para conectarlo todo,
      monitores que puedes añadir y mejoras. Los precios sin buscar son <b>orientativos</b>: pulsa 🔎 para ver el precio real de hoy.</p>
    ${keyBanner()}
    <div id="accOut"><p class="muted">Calculando…</p></div>`;
  bindResultActions(app, () => {});
  async function load() {
    const out = $("#accOut");
    try {
      if (!state.deskItems) state.deskItems = (await api("/api/desk")).items || [];
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
        const ident = await api("/api/desk/identify", { method: "POST", body: { type, model: p.name } });
        state.deskItems.push({ id: uid(), type, model: p.name, specs: ident.specs, catalog_id: null });
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
