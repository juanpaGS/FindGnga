/* FindGnga – interfaz (JS sin dependencias) */
"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const app = $("#app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (n) => n == null ? "—" : n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail ? (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail)) : res.statusText);
  return data;
}

const state = { profile: null, catalog: null, view: null };

/* ------------------------------------------------------------------ opciones */

const DEVICE_KINDS = [
  { kind: "mac_laptop", emoji: "💻", name: "MacBook" },
  { kind: "mac_desktop", emoji: "🖥️", name: "Mac mini / Studio / iMac" },
  { kind: "windows_laptop", emoji: "🧳", name: "Portátil Windows" },
  { kind: "desktop_pc", emoji: "🗄️", name: "PC sobremesa" },
  { kind: "ps5", emoji: "🎮", name: "PS5" },
  { kind: "xbox", emoji: "🟩", name: "Xbox Series" },
  { kind: "switch", emoji: "🕹️", name: "Nintendo Switch" },
];
const USES = [
  ["programming", "👩‍💻 Programar"], ["office", "📊 Ofimática / estudiar"], ["photo_video", "🎨 Foto y vídeo"],
  ["gaming_casual", "🍿 Jugar tranquilo"], ["gaming_competitive", "⚡ Gaming competitivo"], ["movies", "🎬 Pelis y series"],
];
const SIZES = [["", "Me da igual"], ["24", "24\""], ["27", "27\""], ["32", "32\""], ["large", "Enorme / ultrapanorámico"]];
const BADGES = { recommended: ["🏆 Recomendado", "b-rec"], best_quality: ["💎 Mejor calidad", "b-q"],
  most_compatible: ["🔌 Más compatible", "b-c"], cheapest_decent: ["💸 Más barato que merece la pena", "b-cheap"] };

function deviceTitle(d) {
  if (d.label) return d.label;
  if (d.kind === "mac_laptop") {
    const line = d.model_line === "air" ? "MacBook Air" : "MacBook Pro";
    const tier = d.chip_tier && d.chip_tier !== "base" ? " " + d.chip_tier[0].toUpperCase() + d.chip_tier.slice(1) : "";
    return `${line}${d.screen_in ? " " + d.screen_in + "\"" : ""} M${d.chip_gen || "?"}${tier}${d.ram_gb ? " · " + d.ram_gb + " GB" : ""}`;
  }
  if (d.kind === "ps5") return { digital: "PS5 Digital", standard: "PS5 con lector", pro: "PS5 Pro" }[d.edition] || "PS5";
  return DEVICE_KINDS.find((k) => k.kind === d.kind)?.name || d.kind;
}

/* ------------------------------------------------------------------ encuesta */

function newDevice(kind) {
  const id = Math.random().toString(36).slice(2, 10);
  const base = { id, kind };
  if (kind === "mac_laptop") Object.assign(base, { model_line: "pro", screen_in: 14, chip_gen: 6, chip_tier: "pro", ram_gb: 32 });
  if (kind === "mac_desktop") Object.assign(base, { model_line: "mini", chip_gen: 4, chip_tier: "base", ram_gb: 16 });
  if (kind === "windows_laptop") Object.assign(base, { gpu_tier: "integrated", usb_c_dp: true, usb_c_charging: true });
  if (kind === "desktop_pc") Object.assign(base, { gpu_tier: "mid" });
  if (kind === "ps5") Object.assign(base, { edition: "standard" });
  return base;
}

function wizard(existing) {
  const defaults = { name: "", devices: [], uses: [], budget_monitor: 500, budget_console: 650, size_pref: "",
    priority: 0.5, wants: ["monitor", "ps5"] };
  const draft = Object.assign(defaults, existing ? structuredClone(existing) : {});
  for (const k of ["budget_monitor", "budget_console", "name"]) if (draft[k] == null) draft[k] = defaults[k];
  if (!draft.wants?.length) draft.wants = ["monitor", "ps5"];
  let i = 0, shown = -1;

  const steps = () => {
    const s = [stepHello, stepDevices];
    draft.devices.forEach((d) => { if (DETAIL[d.kind]) s.push((el) => DETAIL[d.kind](el, d)); });
    s.push(stepUses, stepWants, stepPrefs, stepDone);
    return s;
  };

  function render() {
    const all = steps();
    i = Math.min(i, all.length - 1);
    app.innerHTML = `<div class="wizard"><div class="progress"><div style="width:${((i + 1) / all.length) * 100}%"></div></div>
      <div class="step ${i !== shown ? "anim" : ""}" id="step"></div>
      <div class="wiz-nav">
        <button class="ghost" id="back" ${i === 0 ? "disabled" : ""}>← Atrás</button>
        ${i < all.length - 1 ? `<button class="primary" id="next">Siguiente →</button>` : ""}
      </div></div>`;
    all[i]($("#step"));
    shown = i;
    $("#back").onclick = () => { i--; render(); };
    const next = $("#next");
    if (next) next.onclick = () => { i++; render(); };
  }

  function chips(el, options, isSel, onToggle) {
    el.innerHTML = options.map(([v, label]) => `<button class="chip ${isSel(v) ? "sel" : ""}" data-v="${esc(v)}">${label}</button>`).join("");
    el.querySelectorAll(".chip").forEach((b) => b.onclick = () => { onToggle(b.dataset.v); render(); });
  }

  function stepHello(el) {
    el.innerHTML = `<div class="emoji">👋</div><h1>¡Vamos a por las gangas!</h1>
      <p class="muted">Cuatro preguntas rápidas sobre tu setup y te digo qué comprar este Black Friday (y a qué precio merece la pena).</p>
      <div class="field"><span class="lbl">¿Cómo te llamo?</span><input type="text" id="name" placeholder="Opcional" value="${esc(draft.name || "")}"></div>`;
    $("#name").oninput = (e) => draft.name = e.target.value;
  }

  function stepDevices(el) {
    el.innerHTML = `<div class="emoji">🏠</div><h1>¿Qué tienes ya en casa?</h1>
      <p class="muted">Marca todo lo que quieras conectar al monitor. Así busco uno que sirva para todo.</p>
      <div class="cards">${DEVICE_KINDS.map((k) => {
        const n = draft.devices.filter((d) => d.kind === k.kind).length;
        return `<button class="card-opt ${n ? "sel" : ""}" data-k="${k.kind}"><span class="big">${k.emoji}</span>${k.name}${n ? " ✓" : ""}</button>`;
      }).join("")}</div>`;
    el.querySelectorAll(".card-opt").forEach((b) => b.onclick = () => {
      const k = b.dataset.k;
      const idx = draft.devices.findIndex((d) => d.kind === k);
      if (idx >= 0) draft.devices.splice(idx, 1); else draft.devices.push(newDevice(k));
      render();
    });
  }

  const DETAIL = {
    mac_laptop(el, d) {
      el.innerHTML = `<div class="emoji">💻</div><h1>Cuéntame de tu MacBook</h1>
        <div class="field"><span class="lbl">Modelo</span><div class="chips" id="line"></div></div>
        <div class="field"><span class="lbl">Pantalla</span><div class="chips" id="screen"></div></div>
        <div class="field"><span class="lbl">Chip</span><div class="chips" id="gen"></div><div class="chips" id="tier"></div></div>
        <div class="field"><span class="lbl">Memoria (RAM)</span><div class="chips" id="ram"></div></div>`;
      chips($("#line"), [["pro", "MacBook Pro"], ["air", "MacBook Air"]], (v) => d.model_line === v, (v) => d.model_line = v);
      chips($("#screen"), [13, 14, 15, 16].map((s) => [String(s), s + "\""]), (v) => String(d.screen_in) === v, (v) => d.screen_in = +v);
      chips($("#gen"), [1, 2, 3, 4, 5, 6].map((g) => [String(g), "M" + g]), (v) => String(d.chip_gen) === v, (v) => d.chip_gen = +v);
      chips($("#tier"), [["base", "Normal"], ["pro", "Pro"], ["max", "Max"]], (v) => d.chip_tier === v, (v) => d.chip_tier = v);
      chips($("#ram"), [8, 16, 18, 24, 32, 36, 48, 64, 128].map((r) => [String(r), r + " GB"]), (v) => String(d.ram_gb) === v, (v) => d.ram_gb = +v);
    },
    mac_desktop(el, d) {
      el.innerHTML = `<div class="emoji">🖥️</div><h1>Tu Mac de sobremesa</h1>
        <div class="field"><span class="lbl">Modelo</span><div class="chips" id="line"></div></div>
        <div class="field"><span class="lbl">Chip</span><div class="chips" id="gen"></div><div class="chips" id="tier"></div></div>`;
      chips($("#line"), [["mini", "Mac mini"], ["studio", "Mac Studio"], ["imac", "iMac"]], (v) => d.model_line === v, (v) => d.model_line = v);
      chips($("#gen"), [1, 2, 3, 4, 5, 6].map((g) => [String(g), "M" + g]), (v) => String(d.chip_gen) === v, (v) => d.chip_gen = +v);
      chips($("#tier"), [["base", "Normal"], ["pro", "Pro"], ["max", "Max"], ["ultra", "Ultra"]], (v) => d.chip_tier === v, (v) => d.chip_tier = v);
    },
    windows_laptop(el, d) {
      el.innerHTML = `<div class="emoji">🧳</div><h1>Tu portátil</h1>
        <div class="field"><span class="lbl">Gráfica</span><div class="chips" id="gpu"></div></div>
        <div class="field"><span class="lbl">¿Tiene USB-C con salida de vídeo?</span><div class="chips" id="usbc"></div></div>
        <div class="field"><span class="lbl">¿Se carga por USB-C?</span><div class="chips" id="chg"></div></div>`;
      gpuChips($("#gpu"), d);
      chips($("#usbc"), [["1", "Sí"], ["0", "No / no lo sé"]], (v) => !!d.usb_c_dp === (v === "1"), (v) => d.usb_c_dp = v === "1");
      chips($("#chg"), [["1", "Sí"], ["0", "No"]], (v) => !!d.usb_c_charging === (v === "1"), (v) => d.usb_c_charging = v === "1");
    },
    desktop_pc(el, d) {
      el.innerHTML = `<div class="emoji">🗄️</div><h1>Tu PC</h1>
        <div class="field"><span class="lbl">Gráfica</span><div class="chips" id="gpu"></div></div>`;
      gpuChips($("#gpu"), d);
    },
    ps5(el, d) {
      el.innerHTML = `<div class="emoji">🎮</div><h1>¿Qué PS5 tienes?</h1>
        <div class="chips" id="ed"></div>`;
      chips($("#ed"), [["digital", "Digital"], ["standard", "Con lector"], ["pro", "PS5 Pro"]], (v) => d.edition === v, (v) => d.edition = v);
    },
  };

  function gpuChips(el, d) {
    chips(el, [["integrated", "Integrada"], ["mid", "Media (RTX 4060/5060, RX 7600…)"], ["high", "Potente (RTX 4080/5080…)"]],
      (v) => d.gpu_tier === v, (v) => d.gpu_tier = v);
  }

  function stepUses(el) {
    el.innerHTML = `<div class="emoji">🎯</div><h1>¿Para qué vas a usar el monitor?</h1>
      <p class="muted">Elige todo lo que aplique: cambia lo que más pesa en la nota (nitidez, color, Hz, HDR…).</p><div class="chips" id="uses"></div>`;
    chips($("#uses"), USES, (v) => draft.uses.includes(v), (v) => {
      draft.uses = draft.uses.includes(v) ? draft.uses.filter((u) => u !== v) : [...draft.uses, v];
    });
  }

  function stepWants(el) {
    el.innerHTML = `<div class="emoji">🛍️</div><h1>¿Qué buscas este Black Friday?</h1>
      <div class="chips" id="wants"></div>
      <div class="field" id="bm"><span class="lbl">Presupuesto máximo monitor: <span class="big-num" id="bmv"></span></span>
        <input type="range" min="150" max="1800" step="25" id="bmr" value="${draft.budget_monitor || 500}"></div>
      <div class="field" id="bc"><span class="lbl">Presupuesto máximo PS5: <span class="big-num" id="bcv"></span></span>
        <input type="range" min="350" max="1000" step="10" id="bcr" value="${draft.budget_console || 650}"></div>`;
    chips($("#wants"), [["monitor", "🖥️ Un monitor"], ["ps5", "🎮 Una PS5"]], (v) => draft.wants.includes(v), (v) => {
      draft.wants = draft.wants.includes(v) ? draft.wants.filter((w) => w !== v) : [...draft.wants, v];
    });
    $("#bm").hidden = !draft.wants.includes("monitor");
    $("#bc").hidden = !draft.wants.includes("ps5");
    const upd = () => { $("#bmv").textContent = eur(+$("#bmr").value); $("#bcv").textContent = eur(+$("#bcr").value); };
    $("#bmr").oninput = (e) => { draft.budget_monitor = +e.target.value; upd(); };
    $("#bcr").oninput = (e) => { draft.budget_console = +e.target.value; upd(); };
    upd();
  }

  function stepPrefs(el) {
    el.innerHTML = `<div class="emoji">⚖️</div><h1>Últimos detalles</h1>
      <div class="field"><span class="lbl">Tamaño que prefieres</span><div class="chips" id="size"></div></div>
      <div class="field"><span class="lbl">¿Qué pesa más para ti?</span>
        <input type="range" min="0" max="1" step="0.1" id="prio" value="${draft.priority}">
        <div class="range-labels"><span>💸 Lo más barato</span><span>⚖️ Equilibrio</span><span>💎 La mejor calidad</span></div></div>`;
    chips($("#size"), SIZES, (v) => (draft.size_pref || "") === v, (v) => draft.size_pref = v || null);
    $("#prio").oninput = (e) => draft.priority = +e.target.value;
  }

  function stepDone(el) {
    el.innerHTML = `<div class="emoji">🎉</div><h1>${draft.name ? esc(draft.name) + ", ¡listo!" : "¡Listo!"}</h1>
      <p>Tu setup: ${draft.devices.length ? draft.devices.map((d) => `<b>${esc(deviceTitle(d))}</b>`).join(", ") : "<i>sin dispositivos</i>"}.</p>
      <p class="error" id="save-err"></p>
      <div class="actions" style="justify-content:flex-start">
        ${draft.wants.includes("monitor") || !draft.wants.length ? `<button class="primary" id="go-mon">🖥️ Buscar monitor</button>` : ""}
        ${draft.wants.includes("ps5") ? `<button class="primary" id="go-ps5">🎮 Buscar PS5</button>` : ""}
      </div>`;
    const save = async (view) => {
      try { state.profile = await api("/api/profile", { method: "PUT", body: draft }); go(view); }
      catch (e) { $("#save-err").textContent = "No se pudo guardar: " + e.message; }
    };
    $("#go-mon") && ($("#go-mon").onclick = () => save("monitors"));
    $("#go-ps5") && ($("#go-ps5").onclick = () => save("ps5"));
  }

  render();
}

/* ------------------------------------------------------------------ vistas */

function viewProfile() {
  const p = state.profile;
  if (!p || !p.devices?.length) return wizard(p);
  app.innerHTML = `<h1>🧑‍💻 ${p.name ? esc(p.name) + ", este es tu setup" : "Tu setup"}</h1>
    <div class="panel">
      <ul>${p.devices.map((d) => `<li><b>${esc(deviceTitle(d))}</b></li>`).join("")}</ul>
      <p class="muted">Usos: ${p.uses.map((u) => USES.find((x) => x[0] === u)?.[1] || u).join(" · ") || "—"}<br>
      Presupuesto monitor: ${eur(p.budget_monitor)} · PS5: ${eur(p.budget_console)}</p>
      <div class="actions" style="justify-content:flex-start">
        <button class="secondary" id="edit">✏️ Editar respuestas</button>
        <button class="primary" id="mon">🖥️ Buscar monitor</button>
        <button class="primary" id="ps5">🎮 Buscar PS5</button>
      </div>
    </div>`;
  $("#edit").onclick = () => wizard(p);
  $("#mon").onclick = () => go("monitors");
  $("#ps5").onclick = () => go("ps5");
}

function bar(label, value) {
  return `<div class="bar"><div class="lbl"><span>${label}</span><b>${Math.round(value)}</b></div>
    <div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, value))}%"></div></div></div>`;
}

function reasonsList(reasons) {
  return `<ul class="reasons">${reasons.map((r) => `<li class="r-${r.kind}">${esc(r.text)}</li>`).join("")}</ul>`;
}

function priceBlock(pricing) {
  if (pricing.estimated) {
    return `<div class="price"><div class="final">${eur(pricing.final_price)}</div>
      <span class="badge b-est">Precio orientativo · sin comprobar</span></div>`;
  }
  const b = pricing.best;
  const extra = [b.shipping_cost ? `+ ${eur(b.shipping_cost)} envío` : "envío gratis",
    b.promo_code ? `− ${eur(b.promo_discount)} con <span class="code">${esc(b.promo_code)}</span>` : ""].filter(Boolean).join(" · ");
  const hist = pricing.history && pricing.history.points > 1 ? `<div class="small muted">Mínimo visto: ${eur(pricing.history.min_price)}</div>` : "";
  return `<div class="price"><div class="final">${eur(pricing.final_price)}</div>
    <div class="small">en <b>${esc(b.store_name)}</b> (${eur(b.price)} ${extra})</div>
    <span class="badge b-live">${b.source === "live" ? "⚡ comprobado" : "✍️ añadido"} ${esc((b.checked_at || "").slice(0, 16).replace("T", " "))}</span>${hist}</div>`;
}

function offersTable(pricing) {
  if (!pricing.offers.length) return "";
  return `<table><tr><th>Tienda</th><th class="num">Precio</th><th class="num">Envío</th><th class="num">Cupón</th><th class="num">Total</th><th></th></tr>
    ${pricing.offers.map((o) => `<tr><td>${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.store_name)}</a>` : esc(o.store_name)}</td>
      <td class="num">${eur(o.price)}</td><td class="num">${eur(o.shipping_cost)}</td>
      <td class="num">${o.promo_code ? `−${eur(o.promo_discount)}` : "—"}</td><td class="num"><b>${eur(o.final_price)}</b></td>
      <td><button class="ghost small" data-del-offer="${esc(o.id)}" title="Borrar">🗑️</button></td></tr>`).join("")}</table>`;
}

function linksRow(links) {
  return `<div class="links">${links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener" title="${esc(l.tip)}">${esc(l.name)} ↗</a>`).join("")}</div>`;
}

function productActions(product, name) {
  return `<div class="actions">
    <button class="ghost" data-deals="${esc(product.search_query)}">🔥 Chollos de la comunidad</button>
    <button class="secondary" data-offer="${esc(product.id)}" data-name="${esc(name)}">➕ Añadir / comprobar precio</button></div>
    <div class="deals" data-deals-out="${esc(product.search_query)}"></div>`;
}

function monitorCard(it, hero = false) {
  const m = it.product, e = it.eval;
  const name = `${m.brand} ${m.model}`;
  return `<article class="result ${hero ? "hero" : ""}">
    <div class="result-head">
      <div><div>${it.badges.map((b) => `<span class="badge ${BADGES[b][1]}">${BADGES[b][0]}</span>`).join("")}</div>
        <div class="title">${esc(name)}</div><div class="muted small">${esc(m.notes || "")}</div></div>
      ${priceBlock(it.pricing)}
    </div>
    <div class="bars">${bar("Calidad", e.quality)}${bar("Compatibilidad", e.compat)}${bar("Nota global", e.fit)}
      ${bar("Calidad/precio", Math.min(100, it.value_index * 2.5))}</div>
    ${reasonsList(e.reasons)}
    ${e.devices.map((d) => `<details ${hero ? "open" : ""}><summary>🔌 Con tu ${esc(d.device_label)}: ${d.score}/100${d.dealbreaker ? " ⛔" : ""}</summary>${reasonsList(d.reasons)}</details>`).join("")}
    <details><summary>🛒 Precios y tiendas (${it.pricing.offers.length} comprobados)</summary>${offersTable(it.pricing)}${linksRow(it.links)}</details>
    ${productActions(m, name)}
  </article>`;
}

function deviceLabelFor(d) { return deviceTitle(d); }

async function viewMonitors() {
  const p = state.profile || { devices: [], uses: [] };
  const q = state.monQuery || (state.monQuery = { device_ids: p.devices.map((d) => d.id), budget: p.budget_monitor || 500, priority: p.priority ?? 0.5 });
  app.innerHTML = `<h1>🖥️ Monitores para ti</h1>
    <p class="muted">Puntuamos calidad (según tus usos) y compatibilidad (según lo que vas a conectar). El precio final incluye envío y el mejor cupón que tengas guardado.</p>
    <div class="panel controls">
      <div><span class="lbl"><b>¿Qué vas a conectar?</b></span><div class="chips" id="devs">${p.devices.map((d) =>
        `<button class="chip ${q.device_ids.includes(d.id) ? "sel" : ""}" data-id="${esc(d.id)}">${esc(deviceLabelFor(d))}</button>`).join("") || `<span class="muted">Sin dispositivos: <a href="#" id="towiz">rellena tu setup</a></span>`}</div></div>
      <div><b>Presupuesto: <span class="big-num" id="bv">${eur(q.budget)}</span></b><input type="range" id="budget" min="150" max="1800" step="25" value="${q.budget}"></div>
      <div><b>Prioridad</b><input type="range" id="prio" min="0" max="1" step="0.1" value="${q.priority}">
        <div class="range-labels"><span>💸 Precio</span><span>💎 Calidad</span></div></div>
    </div>
    <div id="results"><p class="muted">Buscando…</p></div>`;
  app.querySelectorAll("#devs .chip").forEach((b) => b.onclick = () => {
    const id = b.dataset.id;
    q.device_ids = q.device_ids.includes(id) ? q.device_ids.filter((x) => x !== id) : [...q.device_ids, id];
    b.classList.toggle("sel"); load();
  });
  $("#towiz") && ($("#towiz").onclick = (e) => { e.preventDefault(); go("profile"); });
  let t;
  $("#budget").oninput = (e) => { q.budget = +e.target.value; $("#bv").textContent = eur(q.budget); clearTimeout(t); t = setTimeout(load, 250); };
  $("#prio").oninput = (e) => { q.priority = +e.target.value; clearTimeout(t); t = setTimeout(load, 250); };

  async function load() {
    const out = $("#results");
    try {
      const r = await api("/api/search/monitors", { method: "POST", body: q });
      out.innerHTML = renderMonitorResults(r);
      bindResultActions(out, load);
    } catch (e) { out.innerHTML = `<p class="error">Error: ${esc(e.message)}</p>`; }
  }
  load();
}

function renderMonitorResults(r, limit) {
  const list = limit ? r.results.slice(0, limit) : r.results;
  const anyEstimated = r.results.some((x) => x.pricing.estimated);
  return `${anyEstimated ? `<div class="notice">💡 Los precios marcados como <b>orientativos</b> son de referencia. Pulsa <b>➕ Añadir / comprobar precio</b> con la URL de la tienda para usar el precio real de hoy (con envío y cupón).</div>` : ""}
    ${list.length ? list.map((it, i) => monitorCard(it, i === 0)).join("") : `<p>No hay monitores que encajen. Prueba a subir el presupuesto.</p>`}
    ${!limit && r.others.length ? `<details><summary>Ver ${r.others.length} descartados (fuera de presupuesto o poco compatibles)</summary>
      ${r.others.map((it) => `<div class="result"><b>${esc(it.product.brand + " " + it.product.model)}</b> — ${eur(it.pricing.final_price)}
        · ${it.status === "over_budget" ? "fuera de presupuesto" : "poco compatible / calidad baja"} · nota ${Math.round(it.eval.fit)}
        ${reasonsList(it.eval.reasons.filter((x) => x.kind === "con" || x.kind === "warn").concat(it.eval.devices.flatMap((d) => d.reasons.filter((x) => x.kind === "con"))))}</div>`).join("")}</details>` : ""}`;
}

async function viewPS5() {
  app.innerHTML = `<h1>🎮 PS5 al mejor precio</h1>
    <p class="muted">Comparamos el precio final (con envío y cupones) contra el PVP oficial de Sony en España para decirte si de verdad es una ganga.</p>
    <label class="chip sel" style="display:inline-block"><input type="checkbox" id="incl" ${state.ps5Incl !== false ? "checked" : ""}> Recomendar monitor que sirva también para mis otros dispositivos</label>
    <div id="results"><p class="muted">Buscando…</p></div>`;
  $("#incl").onchange = (e) => { state.ps5Incl = e.target.checked; load(); };
  async function load() {
    const out = $("#results");
    try {
      const r = await api(`/api/search/ps5?include_devices=${state.ps5Incl !== false}`);
      const budget = state.profile?.budget_console;
      out.innerHTML = `<h2>Consolas</h2>${r.consoles.map((c) => consoleCard(c, budget)).join("")}
        <h2>🖥️ Monitor ideal para tu PS5</h2>
        <p class="muted">Para PS5 lo clave es <b>HDMI 2.1</b> (4K a 120 Hz y VRR). Top 3:</p>
        ${renderMonitorResults(r.monitors, 3)}
        <p><a href="#" id="allmon">Ver todos los monitores →</a></p>`;
      $("#allmon").onclick = (e) => { e.preventDefault(); go("monitors"); };
      bindResultActions(out, load);
    } catch (e) { out.innerHTML = `<p class="error">Error: ${esc(e.message)}</p>`; }
  }
  load();
}

function consoleCard(c, budget) {
  const p = c.product, v = c.verdict;
  const over = budget && c.pricing.final_price > budget;
  return `<article class="result">
    <div class="result-head"><div><div class="title">${esc(p.name)}</div>
      <div class="muted small">PVP oficial: ${eur(p.msrp)} · ${esc(p.notes)}</div>
      ${v ? `<div class="verdict v-${v.level}">${v.discount_pct > 0 ? "−" + v.discount_pct + "% · " : ""}${esc(v.label)}</div>` : `<div class="muted small">Aún sin precios comprobados: añade uno para saber si es ganga.</div>`}
      ${over ? `<div class="small" style="color:var(--warn)">⚠️ Por encima de tu presupuesto (${eur(budget)})</div>` : ""}
    </div>${priceBlock(c.pricing)}</div>
    <details><summary>🛒 Precios y tiendas (${c.pricing.offers.length} comprobados)</summary>${offersTable(c.pricing)}${linksRow(c.links)}</details>
    ${productActions(p, p.name)}
  </article>`;
}

/* ------------------------------------------------------------------ acciones */

function bindResultActions(root, reload) {
  root.querySelectorAll("[data-offer]").forEach((b) => b.onclick = () => openOfferDialog(b.dataset.offer, b.dataset.name, reload));
  root.querySelectorAll("[data-del-offer]").forEach((b) => b.onclick = async () => {
    await api(`/api/offers/${b.dataset.delOffer}`, { method: "DELETE" }); reload();
  });
  root.querySelectorAll("[data-deals]").forEach((b) => b.onclick = async () => {
    const q = b.dataset.deals;
    const out = [...root.querySelectorAll("[data-deals-out]")].find((x) => x.dataset.dealsOut === q);
    out.innerHTML = `<span class="muted">Buscando en Chollometro…</span>`;
    try {
      const r = await api(`/api/deals?q=${encodeURIComponent(q)}`);
      const link = `https://www.chollometro.com/search?q=${encodeURIComponent(q)}`;
      out.innerHTML = r.items.length
        ? `<ul>${r.items.slice(0, 8).map((d) => `<li><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a>
            ${d.price ? ` · <b>${eur(d.price)}</b>` : ""}${d.merchant ? ` · ${esc(d.merchant)}` : ""}${d.code ? ` · código <span class="code">${esc(d.code)}</span>` : ""}</li>`).join("")}</ul>`
        : `<span class="muted">Ningún chollo reciente en los feeds${r.errors.length ? " (no se pudo leer Chollometro)" : ""}. <a href="${link}" target="_blank" rel="noopener">Buscar en Chollometro ↗</a></span>`;
    } catch (e) { out.innerHTML = `<span class="error">${esc(e.message)}</span>`; }
  });
}

function openOfferDialog(productId, name, reload) {
  const dlg = $("#offer-dialog"), form = $("#offer-form");
  form.reset();
  $("#offer-error").textContent = "";
  $("#offer-product").textContent = name;
  $("#offer-store").innerHTML = state.catalog.stores.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  const done = () => { dlg.close(); reload(); };
  $("#offer-live").onclick = async () => {
    const url = form.url.value.trim();
    if (!url) { $("#offer-error").textContent = "Pega la URL del producto"; return; }
    $("#offer-live").disabled = true; $("#offer-error").textContent = "Comprobando…";
    try {
      await api("/api/offers/check", { method: "POST", body: { product_id: productId, store: form.store.value, url } });
      done();
    } catch (e) { $("#offer-error").textContent = e.message; }
    finally { $("#offer-live").disabled = false; }
  };
  $("#offer-save").onclick = async () => {
    const price = parseFloat(form.price.value);
    if (!(price > 0)) { $("#offer-error").textContent = "Escribe el precio"; return; }
    try {
      await api("/api/offers", { method: "POST", body: { product_id: productId, store: form.store.value, price,
        shipping: form.shipping.value === "" ? null : parseFloat(form.shipping.value), url: form.url.value.trim() || null } });
      done();
    } catch (e) { $("#offer-error").textContent = e.message; }
  };
  dlg.showModal();
}

async function viewPromos() {
  const promos = await api("/api/promos");
  const stores = state.catalog.stores;
  app.innerHTML = `<h1>🏷️ Cupones y códigos</h1>
    <p class="muted">Guarda aquí los códigos que encuentres (Chollometro, newsletters, la propia tienda). Se aplican solos al calcular el precio final si cumplen tienda, gasto mínimo y caducidad.</p>
    <div class="panel"><h3>Añadir código</h3>
      <form id="pf" class="controls">
        <label>Tienda <select name="store"><option value="">Cualquiera</option>${stores.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select></label>
        <label>Código <input name="code" type="text" required placeholder="BLACK10"></label>
        <label>Tipo <select name="type"><option value="percent">% descuento</option><option value="fixed">€ descuento</option></select></label>
        <label>Valor <input name="value" type="number" step="0.01" min="0" required></label>
        <label>Gasto mínimo (€) <input name="min_spend" type="number" step="0.01" min="0"></label>
        <label>Descuento máximo (€) <input name="max_discount" type="number" step="0.01" min="0"></label>
        <label>Caduca <input name="expires" type="date"></label>
        <label>Aplica a <select name="cat"><option value="">Todo</option><option value="monitor">Monitores</option><option value="console">Consolas</option></select></label>
        <div><button class="primary">Guardar código</button> <span class="error" id="perr"></span></div>
      </form></div>
    <h2>Tus códigos</h2>
    ${promos.length ? `<table><tr><th>Código</th><th>Tienda</th><th>Descuento</th><th>Condiciones</th><th></th></tr>${promos.map((p) => `<tr>
      <td><span class="code">${esc(p.code)}</span></td><td>${esc(stores.find((s) => s.id === p.store)?.name || "Cualquiera")}</td>
      <td>${p.type === "percent" ? p.value + " %" : eur(p.value)}</td>
      <td class="small">${[p.min_spend ? "mín. " + eur(p.min_spend) : "", p.max_discount ? "máx. " + eur(p.max_discount) : "", p.expires ? "hasta " + p.expires : "", (p.categories || []).join(", ")].filter(Boolean).join(" · ") || "—"}</td>
      <td>${p.id ? `<button class="ghost" data-del="${esc(p.id)}">🗑️</button>` : ""}</td></tr>`).join("")}</table>` : `<p class="muted">Aún no tienes códigos.</p>`}
    <h2>Dónde buscar códigos</h2>
    <ul>${stores.map((s) => `<li><b>${esc(s.name)}:</b> ${esc(s.promo_tip)}</li>`).join("")}
      <li><b>Chollometro:</b> la comunidad publica y vota códigos de casi todas las tiendas españolas. <a href="https://www.chollometro.com/cupones" target="_blank" rel="noopener">Ver cupones ↗</a></li></ul>`;
  $("#pf").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const num = (v) => v === "" ? null : parseFloat(v);
    try {
      await api("/api/promos", { method: "POST", body: { store: f.store.value || null, code: f.code.value.trim(), type: f.type.value,
        value: parseFloat(f.value.value), min_spend: num(f.min_spend.value), max_discount: num(f.max_discount.value),
        expires: f.expires.value || null, categories: f.cat.value ? [f.cat.value] : [] } });
      viewPromos();
    } catch (err) { $("#perr").textContent = err.message; }
  };
  app.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => { await api(`/api/promos/${b.dataset.del}`, { method: "DELETE" }); viewPromos(); });
}

/* ------------------------------------------------------------------ router */

const VIEWS = { profile: viewProfile, monitors: viewMonitors, ps5: viewPS5, promos: viewPromos };

function go(view) {
  state.view = view;
  if (view === "monitors") state.monQuery = null;
  location.hash = view;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  window.scrollTo(0, 0);
  VIEWS[view]();
}

document.querySelectorAll("#tabs button").forEach((b) => b.onclick = () => go(b.dataset.view));

(async function init() {
  try {
    [state.profile, state.catalog] = await Promise.all([api("/api/profile"), api("/api/catalog")]);
  } catch (e) {
    app.innerHTML = `<p class="error">No se pudo conectar con el servidor: ${esc(e.message)}</p>`;
    return;
  }
  const hash = location.hash.slice(1);
  go(VIEWS[hash] && state.profile.devices?.length ? hash : "profile");
})();
