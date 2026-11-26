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

const state = { profile: null, catalog: null, view: null, live: {}, pred: {}, settings: null };

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

const SOURCE_LABEL = { live: "⚡ comprobado", manual: "✍️ añadido a mano" };
function sourceLabel(src) {
  if (!src) return "";
  if (src.startsWith("auto:")) return "🤖 " + (PROVIDER_NAMES[src.slice(5)] || src.slice(5));
  return SOURCE_LABEL[src] || src;
}
const PROVIDER_NAMES = { serpapi: "Google Shopping", serpapi_amazon: "Amazon.es", serpapi_ebay: "eBay", serpapi_idealo: "Idealo (Google)", chollometro: "Chollometro", idealo: "Idealo", stores: "tienda", watched: "URL vigilada" };
function ago(iso) {
  if (!iso) return "";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  if (min < 1440) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} d`;
}

function priceBlock(pricing) {
  const target = pricing.target ? `<div class="small muted">🔔 Objetivo: ${eur(pricing.target)}</div>` : "";
  if (pricing.estimated) {
    const stale = pricing.stale?.length ? `<div class="small muted">${pricing.stale.length} precio(s) caducado(s) o sin stock</div>` : "";
    return `<div class="price"><div class="final muted-price">${eur(pricing.final_price)}</div>
      <span class="badge b-est">⚠️ No es un precio encontrado</span>
      <div class="small muted" style="max-width:240px">Es el precio de referencia${state.catalog?.consoles?.some((c) => c.ref_price === pricing.final_price) ? " (PVP oficial)" : ""}. Pulsa 🔎 Buscar precio ahora para ver el mercado real.</div>${stale}${target}</div>`;
  }
  const b = pricing.best;
  const extra = [b.shipping_cost ? `+ ${eur(b.shipping_cost)} envío` : "envío gratis",
    b.promo_code ? `− ${eur(b.promo_discount)} con <span class="code">${esc(b.promo_code)}</span>` : "",
    b.code && !b.promo_code ? `código <span class="code">${esc(b.code)}</span>` : ""].filter(Boolean).join(" · ");
  const hist = pricing.history && pricing.history.points > 1 ? `<div class="small muted">Mínimo visto: ${eur(pricing.history.min_price)}</div>` : "";
  return `<div class="price">${pricing.alert ? `<span class="badge b-rec">🔔 ¡Por debajo de tu objetivo!</span>` : ""}
    <div class="final">${eur(pricing.final_price)}</div>
    <div class="small">en <b>${esc(b.store_name)}</b> (${eur(b.price)} ${extra})</div>
    <span class="badge b-live">${sourceLabel(b.source)} · ${ago(b.checked_at)}</span>${verifBadge(b)}${confBadge(b)}${hist}${target}
    ${b.url ? `<div><a class="go" href="${esc(b.url)}" target="_blank" rel="noopener">Ir a la tienda ↗</a></div>` : ""}</div>`;
}

function offersTable(pricing) {
  if (!pricing.offers.length) return `<p class="muted small">Sin precios vigentes. Pulsa 🔎 Buscar precio ahora.</p>`;
  return `<div class="scroll-x"><table><tr><th>Tienda</th><th class="num">Precio</th><th class="num">Envío</th><th class="num">Cupón</th><th class="num">Total</th><th>Fuente</th><th></th></tr>
    ${pricing.offers.map((o) => `<tr class="${o.suspicious ? "sus" : ""}"><td>${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener nofollow">${esc(o.store_name)} ↗</a>` : esc(o.store_name)}
        ${o.inflated ? ` <span class="badge b-warn" title="Por encima de lo normal">📈 Inflado ×${o.inflated.toFixed(1)}</span>` : ""}${o.suspicious ? ` <span class="badge b-bad" title="${esc((o.warnings || []).join(" · "))}">🚩 Sospechosa</span>` : ""}${o.code ? ` <span class="code">${esc(o.code)}</span>` : ""}${verifBadge(o)}${(o.warnings || []).length ? ` <span title="${esc(o.warnings.join(" · "))}">⚠️</span>` : ""}</td>
      <td class="num">${eur(o.price)}</td><td class="num">${eur(o.shipping_cost)}</td>
      <td class="num">${o.promo_code ? `−${eur(o.promo_discount)}` : "—"}</td><td class="num"><b>${eur(o.final_price)}</b></td>
      <td class="small muted">${sourceLabel(o.source)} · ${ago(o.checked_at)}</td>
      <td><button class="ghost small" data-del-offer="${esc(o.id)}" title="Borrar">🗑️</button></td></tr>`).join("")}</table></div>`;
}

function linksRow(links) {
  return `<div class="links">${links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener" title="${esc(l.tip)}">${esc(l.name)} ↗</a>`).join("")}</div>`;
}

function productActions(product, name) {
  const pid = esc(product.id);
  const live = state.live[product.id];
  const pred = state.pred[product.id];
  return `<div class="actions">
    <button class="ghost" data-target="${pid}" data-name="${esc(name)}">🔔 Alerta de precio</button>
    <button class="ghost" data-offer="${pid}" data-name="${esc(name)}">➕ Precio a mano</button>
    <button class="secondary" data-predict="${pid}">📈 ¿Comprar ya o esperar?</button>
    <button class="primary" data-live="${pid}">🔎 Buscar precio ahora</button></div>
    <div data-live-out="${pid}">${live ? renderLive(live) : ""}</div>
    <div data-predict-out="${pid}">${pred ? renderPrediction(pred) : ""}</div>`;
}

function shortErr(e) {
  const t = String(e || "error").replace(/^\w+(Error|Exception): /, "");
  if (/403|bloquead/i.test(t)) return "bloqueado por la web";
  if (/proxy|ConnectError|getaddrinfo|timed? ?out|Timeout/i.test(t)) return "sin conexión";
  return t.length > 38 ? t.slice(0, 36) + "…" : t;
}

function providerLine(providers) {
  return Object.entries(providers).map(([k, st]) => {
    const n = PROVIDER_NAMES[k] || k;
    if (st.skipped) return `<span class="pv off" title="${esc(st.error)}">${n}: sin configurar</span>`;
    return st.ok ? `<span class="pv ok">${n}: ${st.accepted ?? 0}</span>`
      : `<span class="pv err" title="${esc(st.error)}">${n}: ${esc(shortErr(st.error))}</span>`;
  }).join("");
}

const VERIF = {
  verified: ["✔ verificado en la tienda", "b-live"], price_changed: ["⚠ precio actualizado en la tienda", "b-cheap"],
  out_of_stock: ["Agotado en la tienda", "b-est"], unverifiable: ["sin verificar", "b-est"],
  gone: ["✖ enlace caducado", "b-est"],
};

function verifBadge(o) {
  const st = o.verification?.status || o.verified;
  if (!st) return "";
  const [label, cls] = VERIF[st] || VERIF.unverifiable;
  return `<span class="badge ${cls}" title="${esc(o.verification?.note || "")}">${label}</span>`;
}

function confBadge(o) {
  if (o.confidence == null) return "";
  const c = o.confidence, cls = c >= 70 ? "b-live" : c >= 45 ? "b-cheap" : "b-est";
  return `<span class="badge ${cls}" title="Fiabilidad de la oferta: verificación, nº de fuentes, tienda conocida">fiabilidad ${c}</span>`;
}

function coverageLine(cv) {
  if (!cv) return "";
  const lvl = { alta: "v-good", media: "v-meh", baja: "v-bad" }[cv.level] || "";
  return `<div class="small">Cobertura <b class="${lvl}">${cv.level}</b>: ${cv.sources_ok}/${cv.sources_total} fuentes respondieron ·
    ${cv.stores} ${cv.stores === 1 ? "tienda" : "tiendas"} con stock · ${cv.verified} ${cv.verified === 1 ? "oferta verificada" : "ofertas verificadas"} en la propia tienda
    ${cv.level === "baja" ? ` — <b>puede haber precios más bajos que no vemos</b>; activa más fuentes en <a href="#settings" data-go="settings">Ajustes</a>.` : ""}</div>`;
}

const isConfirmed = (o) => ["verified", "price_changed"].includes(o.verification?.status || o.verified);
const isGoogle = (u) => /\/\/[^/]*google\./.test(u || "");
const oldPrice = (o) => o.old_price && o.old_price > o.price ? ` <s class="muted">${eur(o.old_price)}</s> <span class="badge b-cheap">−${Math.round((1 - o.price / o.old_price) * 100)} %</span>` : "";

function buyButton(o) {
  if (o.dead_link) return `<span class="muted small">Ya no existe</span>`;
  if (o.in_stock === false) return `<span class="muted small">Agotado</span>`;
  // Una tienda falsa también "confirma" su precio: nunca botón de compra si la oferta es sospechosa
  if (o.suspicious) return `<a class="go ghosty" href="${esc(o.url)}" target="_blank" rel="noopener nofollow" title="Posible tienda falsa o precio sospechoso: no compres sin comprobarla">⚠️ Sospechosa ↗</a>`;
  if (isConfirmed(o)) return `<a class="go buy" href="${esc(o.url)}" target="_blank" rel="noopener" title="Precio y stock comprobados ahora en la tienda">🛒 Comprar ya</a>`;
  if (isGoogle(o.url)) return `<a class="go ghosty" href="${esc(o.url)}" target="_blank" rel="noopener" title="Enlace a Google Shopping: desde ahí eliges tienda">Ver en Google ↗</a>`;
  return `<a class="go ghosty" href="${esc(o.url)}" target="_blank" rel="noopener" title="No se pudo comprobar en la tienda: revisa precio y stock">Ir (sin comprobar) ↗</a>`;
}

function bestLine(r) {
  const b = r.best;
  if (!b) return "";
  const cu = r.cheaper_unconfirmed;
  return `<div class="bestline ${r.best_confirmed ? "ok" : ""}">
    <div>${r.best_confirmed ? "✅ <b>Mejor precio comprobado ahora</b>" : "🔎 <b>Mejor precio encontrado</b> <span class=\"small muted\">(no se pudo comprobar en la tienda)</span>"}
      <div class="big-num">${eur(b.final_price)}${oldPrice(b)}</div>
      <div class="small">${esc(b.store_name)} · ${esc(b.title || "")}${b.shipping_cost ? ` · incluye ${eur(b.shipping_cost)} de envío` : ""}</div></div>
    <div>${buyButton(b)}</div>
    ${cu ? `<div class="small muted full">Hay una más barata sin comprobar: ${eur(cu.final_price)} en ${esc(cu.store_name)}. Revisa que siga en pie antes de fiarte.</div>` : ""}
  </div>`;
}

function renderLive(r) {
  if (r.loading) return `<div class="live"><span class="muted">🔎 Buscando en todas las fuentes y verificando en las tiendas…</span></div>`;
  if (r.error) return `<div class="live"><span class="error">${esc(r.error)}</span></div>`;
  const rows = r.listings.slice(0, 15);
  const sus = r.cheapest_suspicious;
  return `<div class="live">
    <div class="live-head"><b>Ofertas encontradas ${ago(r.searched_at)}</b>${r.cached ? ` <span class="muted small">(caché)</span>` : ""}
      <span class="muted small">· ${r.listings.length} válidas, ${r.rejected_count} descartadas (accesorios, otros modelos, precios raros)</span></div>
    ${bestLine(r)}
    ${coverageLine(r.coverage)}
    ${r.dead_links ? `<div class="small muted">🧹 ${r.dead_links} ${r.dead_links === 1 ? "enlace caducado descartado" : "enlaces caducados descartados"} (la tienda ya no tiene esa oferta).</div>` : ""}
    ${(r.references || []).length ? `<div class="small">📊 ${r.references.map((x) => `${esc(x.source)}: desde <b>${eur(x.price)}</b> <a href="${esc(x.url)}" target="_blank" rel="noopener">ver ↗</a>`).join(" · ")} <span class="muted">(referencia del comparador)</span></div>` : ""}
    <div class="pvs">${providerLine(r.providers)}</div>
    ${sus ? `<div class="notice">🕵️ La oferta más barata (${eur(sus.final_price)} en ${esc(sus.store_name)}) parece sospechosa y no la usamos como mejor precio: ${esc((sus.warnings || []).join(" · "))}</div>` : ""}
    ${rows.length ? `<div class="scroll-x"><table><tr><th>Tienda</th><th>Producto</th><th class="num">Total</th><th></th></tr>
      ${rows.map((o) => `<tr class="${o.in_stock === false ? "dim" : ""} ${o.suspicious ? "sus" : ""}"><td><b>${esc(o.store_name)}</b><div>${confBadge(o)}</div></td>
        <td class="small">${esc(o.title)}
          ${o.condition === "used" ? `<span class="badge b-est">Usado/reacond.</span>` : ""}${o.bundle ? `<span class="badge b-q">Pack</span>` : ""}
          ${verifBadge(o)}${o.code ? ` código <span class="code">${esc(o.code)}</span>` : ""}
          <div class="muted">${eur(o.price)}${oldPrice(o)} ${o.shipping_cost ? "+ " + eur(o.shipping_cost) + " envío" : "· envío gratis*"}${o.promo_code ? " − cupón " + esc(o.promo_code) : ""}
            · vía ${(o.seen_in?.length ? o.seen_in : [o.provider]).map((x) => PROVIDER_NAMES[x] || x).join(", ")}</div>
          ${(o.warnings || []).map((w) => `<div class="warnline">⚠️ ${esc(w)}</div>`).join("")}</td>
        <td class="num"><b>${eur(o.final_price)}</b></td>
        <td>${buyButton(o)}
          ${o.store.startsWith("x-") ? `<button class="ghost small" data-shopcheck="${esc(JSON.stringify({ url: o.shop_url || o.url, store_name: o.store_name, price: o.price, product_id: r.product_id }))}" title="¿Es fiable esta tienda?">🛡️ Comprobar</button>` : ""}</td></tr>`).join("")}</table></div>
      <p class="muted small">* Envío estimado con las reglas de la tienda cuando la fuente no lo indica. Confirma siempre el total en el carrito.</p>`
    : `<p class="muted">No se encontraron ofertas válidas. ${Object.values(r.providers).every((s) => !s.ok) ? "Ninguna fuente respondió: revisa <a href=\"#settings\" data-go=\"settings\">Ajustes → Diagnóstico</a>." : "Prueba más tarde o usa los enlaces de tiendas."}</p>`}
  </div>`;
}

const LEVEL = { buy: ["✅", "v-good"], wait: ["⏳", "v-meh"], neutral: ["🤔", ""], unknown: ["❔", ""] };

function renderPrediction(p) {
  if (p.loading) return `<div class="live"><span class="muted">Calculando…</span></div>`;
  if (p.error) return `<div class="live"><span class="error">${esc(p.error)}</span></div>`;
  const [icon, cls] = LEVEL[p.level] || LEVEL.neutral;
  const max = Math.max(p.normal_price, p.current_price || 0) * 1.02;
  const min = Math.min(...p.timeline.map((e) => e.expected_low), p.current_price || Infinity) * 0.97;
  const pos = (v) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  const nd = p.next_drop;
  return `<div class="live pred">
    <div class="verdict ${cls}" style="font-size:17px">${icon} ${esc(p.verdict)}</div>
    <div class="small muted">Confianza ${esc(p.confidence)} · precio normal ${eur(p.normal_price)} (${esc(p.normal_source)})
      ${p.percentile != null ? ` · el precio actual es más bajo que el ${100 - p.percentile}% de tu histórico` : ""}</div>
    ${nd ? `<p>📉 <b>Próxima bajada probable:</b> ${esc(nd.name)} (${nd.start}${nd.days_until ? `, en ${nd.days_until} días` : ""}) → ${eur(nd.expected_low)}–${eur(nd.expected_high)} (−${nd.discount_pct[0]}–${nd.discount_pct[1]} %)</p>` : ""}
    <div class="timeline">
      ${p.current_price ? `<div class="tl-row"><span class="tl-name"><b>Hoy</b></span><span class="tl-track"><span class="tl-dot" style="left:${pos(p.current_price)}%"></span></span><span class="tl-val">${eur(p.current_price)}</span></div>` : ""}
      ${p.timeline.map((e) => `<div class="tl-row ${e.active ? "act" : ""}"><span class="tl-name">${esc(e.name)}<br><span class="muted small">${e.start}${e.active ? " · ¡ahora!" : ""}</span></span>
        <span class="tl-track"><span class="tl-range" style="left:${pos(e.expected_low)}%;width:${Math.max(2, pos(e.expected_high) - pos(e.expected_low))}%;opacity:${0.35 + e.reliability * 0.65}"></span></span>
        <span class="tl-val">${eur(e.expected_low)}–${eur(e.expected_high)}</span></div>`).join("")}
    </div>
    ${p.plan ? `<div class="plan">🐷 <b>${p.plan.mode === "wait" ? "Plan de ahorro" : "Si hoy no te llega el dinero"}</b>:
      ${p.plan.mode === "wait" ? "" : "la siguiente oportunidad parecida es "}${esc(p.plan.event)} (${p.plan.date}), precio esperado ≈ ${eur(p.plan.target_price)}.
      Ya tengo <input type="number" min="0" step="10" value="${p.plan.already_saved}" data-saved="${esc(p.product_id)}" style="width:110px;display:inline-block"> €
      → ahorra <b>${eur(p.plan.per_week)}/semana</b> durante ${p.plan.weeks} semanas.</div>` : ""}
    <details><summary>¿Por qué?</summary><ul class="reasons">${p.reasons.map((r) => `<li class="r-info">${esc(r)}</li>`).join("")}</ul>
      <p class="small muted">Estimación basada en campañas de años anteriores y en tu histórico de precios (cada búsqueda lo alimenta). No es una garantía.</p></details>
  </div>`;
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
    <details><summary>🛒 Precios vigentes por tienda (${it.pricing.offers.length})</summary>${offersTable(it.pricing)}${linksRow(it.links)}</details>
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
    ${keyBanner()}
    <div class="actions" style="justify-content:flex-start"><button class="primary" id="liveTop">🔎 Buscar precios reales del top 5</button></div>
    <div id="results"><p class="muted">Buscando…</p></div>`;
  bindResultActions(app, () => {});
  let lastIds = [];
  $("#liveTop").onclick = (e) => runLiveAll(lastIds.slice(0, 5), $("#results"), load, e.target);
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
      lastIds = r.results.map((x) => x.product.id);
      out.innerHTML = renderMonitorResults(r);
      bindResultActions(out, load);
    } catch (e) { out.innerHTML = `<p class="error">Error: ${esc(e.message)}</p>`; }
  }
  load();
}

function renderMonitorResults(r, limit) {
  const list = limit ? r.results.slice(0, limit) : r.results;
  const anyEstimated = r.results.some((x) => x.pricing.estimated);
  return `${anyEstimated ? `<div class="notice">💡 Los precios marcados como <b>orientativos</b> son de referencia. Pulsa <b>🔎 Buscar precio ahora</b> para traer las ofertas reales de hoy con su enlace (con envío y cupón).</div>` : ""}
    ${list.length ? list.map((it, i) => monitorCard(it, i === 0)).join("") : `<p>No hay monitores que encajen. Prueba a subir el presupuesto.</p>`}
    ${!limit && r.others.length ? `<details><summary>Ver ${r.others.length} descartados (fuera de presupuesto o poco compatibles)</summary>
      ${r.others.map((it) => `<div class="result"><b>${esc(it.product.brand + " " + it.product.model)}</b> — ${eur(it.pricing.final_price)}
        · ${it.status === "over_budget" ? "fuera de presupuesto" : "poco compatible / calidad baja"} · nota ${Math.round(it.eval.fit)}
        ${reasonsList(it.eval.reasons.filter((x) => x.kind === "con" || x.kind === "warn").concat(it.eval.devices.flatMap((d) => d.reasons.filter((x) => x.kind === "con"))))}</div>`).join("")}</details>` : ""}`;
}

async function viewPS5() {
  app.innerHTML = `<h1>🎮 PS5 al mejor precio</h1>
    <p class="muted">Comparamos el precio final (con envío y cupones) contra el PVP oficial de Sony en España para decirte si de verdad es una ganga.</p>
    ${keyBanner()}
    <div class="actions" style="justify-content:flex-start">
      <button class="primary" id="liveAll">🔎 Buscar PS5 ahora en todas las tiendas</button>
      <label class="chip sel"><input type="checkbox" id="incl" ${state.ps5Incl !== false ? "checked" : ""}> Monitor que sirva también para mis otros dispositivos</label></div>
    <div id="results"><p class="muted">Buscando…</p></div>`;
  bindResultActions(app, () => {});
  $("#liveAll").onclick = (e) => runLiveAll(state.catalog.consoles.map((c) => c.id), $("#results"), load, e.target);
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
      ${v ? `<div class="verdict v-${v.level}">${v.discount_pct > 0 ? "−" + v.discount_pct + "% · " : ""}${esc(v.label)}</div>` : `<div class="muted small">Aún sin precios actuales: pulsa 🔎 Buscar precio ahora.</div>`}
      ${over ? `<div class="small" style="color:var(--warn)">⚠️ Por encima de tu presupuesto (${eur(budget)})</div>` : ""}
    </div>${priceBlock(c.pricing)}</div>
    <details><summary>🛒 Precios vigentes por tienda (${c.pricing.offers.length})</summary>${offersTable(c.pricing)}${linksRow(c.links)}</details>
    ${productActions(p, p.name)}
  </article>`;
}

/* ------------------------------------------------------------------ acciones */

function bindResultActions(root, reload) {
  root.querySelectorAll("[data-offer]").forEach((b) => b.onclick = () => openOfferDialog(b.dataset.offer, b.dataset.name, reload));
  root.querySelectorAll("[data-del-offer]").forEach((b) => b.onclick = async () => {
    await api(`/api/offers/${b.dataset.delOffer}`, { method: "DELETE" }); reload();
  });
  root.querySelectorAll("[data-live]").forEach((b) => b.onclick = () => runLive(b.dataset.live, root, reload));
  root.querySelectorAll("[data-predict]").forEach((b) => b.onclick = () => runPredict(b.dataset.predict, root));
  root.querySelectorAll("[data-saved]").forEach((inp) => inp.onchange = () => runPredict(inp.dataset.saved, root, +inp.value || 0));
  root.querySelectorAll("[data-go]").forEach((a) => a.onclick = (e) => { e.preventDefault(); go(a.dataset.go); });
  root.querySelectorAll("[data-shopcheck]").forEach((b) => b.onclick = () => { state.shopPrefill = JSON.parse(b.dataset.shopcheck); go("shopcheck"); });
  root.querySelectorAll("[data-target]").forEach((b) => b.onclick = async () => {
    const cur = state.settings?.targets?.[b.dataset.target];
    const v = prompt(`Avísame cuando «${b.dataset.name}» baje de (€). Vacío para quitar la alerta:`, cur ?? "");
    if (v === null) return;
    const price = v.trim() === "" ? null : parseFloat(v.replace(",", "."));
    const r = await api(`/api/targets/${b.dataset.target}`, { method: "PUT", body: { price } });
    state.settings.targets = r.targets; reload();
  });
}

function outFor(root, attr, pid) {
  return [...root.querySelectorAll(`[${attr}]`)].find((x) => x.getAttribute(attr) === pid);
}

async function runLive(pid, root, reload, { quiet = false } = {}) {
  state.live[pid] = { loading: true };
  const out = outFor(root, "data-live-out", pid);
  if (out) out.innerHTML = renderLive(state.live[pid]);
  try { state.live[pid] = await api(`/api/live/${pid}?force=true`, { method: "POST" }); }
  catch (e) { state.live[pid] = { error: e.message }; }
  if (!quiet) await reload();
}

async function runPredict(pid, root, saved = 0) {
  state.pred[pid] = { loading: true };
  const out = outFor(root, "data-predict-out", pid);
  if (out) out.innerHTML = renderPrediction(state.pred[pid]);
  try { state.pred[pid] = await api(`/api/predict/${pid}?saved=${saved}`); }
  catch (e) { state.pred[pid] = { error: e.message }; }
  const o2 = outFor(root, "data-predict-out", pid);
  if (o2) { o2.innerHTML = renderPrediction(state.pred[pid]); bindResultActions(o2, () => {}); }
}

async function runLiveAll(ids, root, reload, btn) {
  btn.disabled = true;
  for (let i = 0; i < ids.length; i++) {
    btn.textContent = `🔎 Buscando ${i + 1}/${ids.length}…`;
    await runLive(ids[i], root, reload, { quiet: true });
  }
  btn.disabled = false; btn.textContent = "🔎 Buscar de nuevo";
  await reload();
}

function keyBanner() {
  return state.settings && !state.settings.serpapi_key_set
    ? `<div class="notice">⚙️ Para precios reales de casi todas las tiendas españolas con enlace directo, activa <b>Google Shopping</b> en <a href="#settings" data-go="settings">Ajustes</a> (API gratuita). Sin ella se usan Chollometro, Idealo y las tiendas directamente, que a veces bloquean.</div>` : "";
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

/* ------------------------------------------------------------------ ¿es fiable? */

const SIG_ICON = { danger: "🚩", warn: "⚠️", info: "ℹ️", ok: "✅" };

function renderShopCheck(r) {
  const cls = { scam: "sc-scam", doubtful: "sc-doubt", ok: "sc-ok" }[r.verdict];
  return `<div class="panel sc ${cls}">
    <div class="sc-head"><span class="sc-label">${esc(r.label)}</span>
      <span class="small">riesgo <b>${r.risk}</b>/100 · ${esc(r.domain || "")}${r.online ? "" : " · sin comprobar en línea"}</span></div>
    <div class="meter"><div style="width:${r.risk}%"></div></div>
    <ul class="sigs">${r.signals.map((s) => `<li class="sig-${s.level}"><span>${SIG_ICON[s.level]}</span><div><b>${esc(s.title)}</b>
      ${s.detail ? `<div class="small muted">${esc(s.detail)}</div>` : ""}</div></li>`).join("")}</ul>
    ${(r.notes || []).length ? `<p class="small muted">No se pudo comprobar: ${esc(r.notes.join(" · "))}</p>` : ""}
    <h3>Qué hacer</h3><ul>${r.advice.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
  </div>`;
}

function viewShopCheck() {
  const pre = state.shopPrefill || {};
  state.shopPrefill = null;
  const products = [...state.catalog.consoles, ...state.catalog.monitors];
  app.innerHTML = `<h1>🛡️ ¿Es fiable esta tienda?</h1>
    <p class="muted">Antes de pagar en una web que no conoces, pégala aquí. Revisamos la dirección, el precio, la forma de pago
      y la antigüedad del dominio: las tiendas falsas aparecen cada Black Friday con precios imposibles y piden transferencia.</p>
    <form id="scf" class="panel scform">
      <label>Dirección de la web <input name="url" type="text" required placeholder="https://tienda-ejemplo.com/producto" value="${esc(pre.url || "")}"></label>
      <div class="row">
        <label>Nombre que dice tener la tienda <input name="store_name" type="text" placeholder="opcional" value="${esc(pre.store_name || "")}"></label>
        <label>Precio (€) <input name="price" type="number" step="0.01" min="0" value="${pre.price ?? ""}"></label>
      </div>
      <label>Producto <select name="product_id"><option value="">— (para comparar con su precio oficial)</option>
        ${products.map((p) => `<option value="${esc(p.id)}" ${p.id === pre.product_id ? "selected" : ""}>${esc(p.name || (p.brand + " " + p.model))}</option>`).join("")}</select></label>
      <label>Texto de la página de pago <span class="muted small">(opcional, lo más útil: en la página del pago pulsa ⌘A y ⌘C y pégalo aquí; se analiza en tu ordenador)</span>
        <textarea name="text" rows="5" placeholder="Transferencia SEPA · Beneficiario … · IBAN …"></textarea></label>
      <label class="inline"><input type="checkbox" name="online" checked> Comprobar en internet (antigüedad del dominio y la propia web)</label>
      <div><button class="primary">🛡️ Comprobar</button> <span class="error" id="scerr"></span></div>
    </form>
    <div id="scout"></div>
    <details class="panel"><summary><b>Señales típicas de una tienda falsa</b></summary><ul class="small">
      <li>Precio muy por debajo del oficial en un producto que nunca baja tanto (consolas, móviles, GPUs).</li>
      <li>Sólo deja pagar por transferencia o Bizum, a nombre de una persona o con IBAN de otro país.</li>
      <li>El nombre de la tienda no aparece en la dirección web; idiomas mezclados; dominio creado hace semanas.</li>
      <li>Sin CIF, sin dirección física, contacto con Gmail/Hotmail, prisas («referencia obligatoria», «quedan 2»).</li>
    </ul></details>`;
  const f = $("#scf");
  f.onsubmit = async (e) => {
    e.preventDefault();
    const out = $("#scout"), btn = f.querySelector("button.primary");
    btn.disabled = true; $("#scerr").textContent = "";
    out.innerHTML = `<p class="muted">Comprobando…</p>`;
    try {
      const r = await api("/api/shopcheck", { method: "POST", body: { url: f.url.value.trim(), store_name: f.store_name.value.trim() || null,
        price: f.price.value ? parseFloat(f.price.value) : null, product_id: f.product_id.value || null,
        text: f.text.value, online: f.online.checked } });
      out.innerHTML = renderShopCheck(r);
      out.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) { out.innerHTML = ""; $("#scerr").textContent = err.message; }
    btn.disabled = false;
  };
  if (pre.url) f.requestSubmit();
}

/* ------------------------------------------------------------------ cuándo comprar */

async function viewWhen() {
  app.innerHTML = `<h1>📈 ¿Cuándo comprar?</h1>
    <p class="muted">Estimamos cuándo y cuánto bajará cada producto con el calendario de campañas en España, la tendencia de su categoría y tu histórico de precios (que crece cada vez que buscas). Úsalo para decidir si comprar ya o ahorrar para la próxima bajada.</p>
    <div id="preds"><p class="muted">Calculando…</p></div>
    <h2>🗓️ Calendario de rebajas</h2><div id="cal"></div>`;
  const out = $("#preds");
  const [cal, mon] = await Promise.all([api("/api/calendar"), api("/api/search/monitors", { method: "POST", body: {} })]);
  const items = [...state.catalog.consoles.map((c) => ({ id: c.id, name: c.name })),
    ...mon.results.slice(0, 3).map((m) => ({ id: m.product.id, name: `${m.product.brand} ${m.product.model}` }))];
  const preds = await Promise.all(items.map((it) => api(`/api/predict/${it.id}`).catch((e) => ({ error: e.message }))));
  preds.forEach((p, i) => { state.pred[items[i].id] = p; });
  out.innerHTML = items.map((it, i) => `<article class="result"><div class="title">${esc(it.name)}</div>
    ${preds[i].current_price == null ? `<p class="small muted">Sin precio actual: la predicción usa el precio de referencia. <button class="ghost small" data-live="${esc(it.id)}">🔎 Buscar precio ahora</button></p><div data-live-out="${esc(it.id)}"></div>` : ""}
    <div data-predict-out="${esc(it.id)}">${renderPrediction(preds[i])}</div></article>`).join("");
  bindResultActions(out, viewWhen);
  const today = new Date().toISOString().slice(0, 10);
  $("#cal").innerHTML = `<div class="scroll-x"><table><tr><th>Campaña</th><th>Fechas</th><th class="num">Monitores</th><th class="num">Consolas</th></tr>
    ${cal.events.filter((e) => e.end >= today).map((e) => `<tr><td>${esc(e.name)}</td><td class="small">${e.start} → ${e.end}</td>
      <td class="num">${pct(e.discount.monitor)}</td><td class="num">${pct(e.discount.console)}</td></tr>`).join("")}
    ${cal.unscheduled.map((e) => `<tr><td>${esc(e.name)}</td><td class="small">sin fecha fija</td><td class="num">${pct(e.discount.monitor)}</td><td class="num">${pct(e.discount.console)}</td></tr>`).join("")}
    </table></div><p class="small muted">Descuentos típicos de años anteriores. Puedes ajustarlos en <code>data/events.json</code>.</p>`;
}
const pct = (r) => r && r[1] > 0 ? `${Math.round(r[0] * 100)}–${Math.round(r[1] * 100)} %` : "—";

/* ------------------------------------------------------------------ ajustes */

function serpCost(st) {
  if (!st.serpapi_key_set) return 0;
  const p = st.providers || {};
  return ["serpapi", "serpapi_amazon", "serpapi_ebay", "serpapi_idealo"].filter((k) => p[k]).length
    + (p.serpapi ? (st.resolve_links ?? 3) : 0);
}

async function viewSettings() {
  const st = state.settings = await api("/api/settings");
  app.innerHTML = `<h1>⚙️ Ajustes de búsqueda</h1>
    <div class="panel"><h3>🔑 Google Shopping (recomendado)</h3>
      <p class="small">Es como funcionan los comparadores: una sola consulta trae precio, tienda, envío y enlace de casi todas las tiendas españolas.
      Crea una cuenta gratuita en <a href="https://serpapi.com" target="_blank" rel="noopener">serpapi.com</a> y pega tu API key (el plan gratis da para buscar tus productos varias veces al día).
      Se guarda sólo en tu ordenador (<code>data/user/settings.json</code>).</p>
      <div class="row"><input type="text" id="key" placeholder="${st.serpapi_key_set ? "Guardada (" + esc(st.serpapi_key_hint) + ") – escribe otra para cambiarla" : "Pega aquí tu API key"}">
        <div><button class="primary" id="saveKey">Guardar</button> ${st.serpapi_key_set ? `<button class="ghost" id="delKey">Quitar</button>` : ""}</div></div></div>
    <div class="panel" style="margin-top:12px"><h3>Fuentes</h3>
      ${st.provider_info.map((p) => `<label class="src"><input type="checkbox" data-prov="${p.id}" ${st.providers[p.id] ? "checked" : ""}>
        <b>${esc(p.name)}</b>${p.beta ? ` <span class="badge b-est">beta</span>` : ""}<br><span class="small muted">${esc(p.desc)}</span></label>`).join("")}
      <div class="row" style="margin-top:10px">
        <label>Los precios caducan a los <input type="number" id="age" min="1" max="60" value="${st.max_offer_age_days}" style="width:80px;display:inline-block"> días</label>
        <label><input type="checkbox" id="used" ${st.include_used ? "checked" : ""}> Contar reacondicionados/segunda mano en el mejor precio</label>
        <label>Verificar en la propia tienda las <input type="number" id="vtop" min="0" max="20" value="${st.verify_top ?? 6}" style="width:70px;display:inline-block"> ofertas más baratas (0 = no)</label>
        <label>Enlaces directos: abrir la ficha de los <input type="number" id="rlinks" min="0" max="10" value="${st.resolve_links ?? 3}" style="width:70px;display:inline-block"> productos más baratos de Google Shopping (1 búsqueda de SerpApi cada uno; 0 = no)</label>
        <label>Reutilizar búsquedas de SerpApi durante <input type="number" id="cacheh" min="0" max="72" value="${st.serpapi_cache_hours ?? 12}" style="width:70px;display:inline-block"> horas (0 = nunca; «Buscar precio ahora» usa como mucho 1 h)</label>
        <p class="small muted">Cada clic en «Buscar precio ahora» gasta unas <b id="cost">${serpCost(st)}</b> búsquedas de SerpApi.
          ${st.serpapi_usage ? `Este mes: <b>${st.serpapi_usage.used}</b> gastadas y <b>${st.serpapi_usage.saved}</b> ahorradas gracias a la caché.` : ""}</p>
        ${st.serpapi_usage?.quota_out ? `<div class="notice">⚠️ Se han acabado las búsquedas de SerpApi de este mes. FindGnga sigue buscando en PcComponentes, MediaMarkt, Chollometro y tus URLs vigiladas.</div>` : ""}
      </div><p class="error" id="serr"></p></div>
    <div class="panel" style="margin-top:12px"><h3>🩺 Diagnóstico</h3>
      <p class="small muted">Prueba cada fuente con «PS5 Slim Digital» sin guardar nada y guarda el HTML recibido en <code>data/user/snapshots/</code> para poder afinar los lectores.</p>
      <button class="secondary" id="diag">Ejecutar diagnóstico</button><div id="diagOut"></div></div>
    <div class="panel" style="margin-top:12px"><h3>💻 ¿Funciona en este ordenador?</h3>
      <p class="small muted">Revisa Python, dependencias, carpeta de datos, conexión con cada fuente y tu API key.</p>
      <button class="secondary" id="doctor">Comprobar instalación</button><div id="docOut"></div></div>
    <div class="panel" style="margin-top:12px"><h3>📦 Llevar mis datos a otro ordenador</h3>
      <p class="small muted">Tu perfil, ajustes, precios, histórico y cupones viven en <code>data/user/</code>, que no se sube a GitHub. Descarga una copia y restáurala en el otro ordenador.</p>
      <div class="actions" style="justify-content:flex-start">
        <label class="small"><input type="checkbox" id="withKey"> incluir API key</label>
        <button class="secondary" id="export">⬇️ Descargar copia</button>
        <label class="secondary-btn">⬆️ Restaurar copia<input type="file" id="import" accept="application/json" hidden></label>
      </div><p class="small" id="bkOut"></p></div>`;
  $("#vtop").onchange = (e) => save({ verify_top: Math.max(0, Math.min(20, +e.target.value || 0)) });
  $("#cacheh").onchange = (e) => save({ serpapi_cache_hours: Math.max(0, Math.min(72, +e.target.value || 0)) });
  $("#rlinks").onchange = (e) => save({ resolve_links: Math.max(0, Math.min(10, +e.target.value || 0)) });
  $("#doctor").onclick = async (e) => {
    e.target.disabled = true; $("#docOut").innerHTML = `<p class="muted">Comprobando…</p>`;
    try {
      const r = await api("/api/doctor");
      const ic = { ok: "✅", warn: "⚠️", error: "❌" };
      $("#docOut").innerHTML = `<p><b>${esc(r.summary)}</b></p><ul class="reasons">${r.checks.map((c) =>
        `<li style="padding-left:0">${ic[c.status]} <b>${esc(c.name)}</b>: ${esc(c.detail)}${c.fix ? `<div class="small muted">→ ${esc(c.fix)}</div>` : ""}</li>`).join("")}</ul>`;
    } catch (err) { $("#docOut").innerHTML = `<p class="error">${esc(err.message)}</p>`; }
    e.target.disabled = false;
  };
  $("#export").onclick = async () => {
    const data = await api(`/api/backup?include_key=${$("#withKey").checked}`);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = `findgnga-copia-${data.exported_at.slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
    $("#bkOut").textContent = "Copia descargada" + ($("#withKey").checked ? " (incluye tu API key: guárdala en sitio seguro)" : "") + ".";
  };
  $("#import").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const r = await api("/api/backup", { method: "POST", body: JSON.parse(await f.text()) });
      $("#bkOut").textContent = "Restaurado: " + r.restored.join(", ") + ". Recargando…";
      setTimeout(() => location.reload(), 800);
    } catch (err) { $("#bkOut").textContent = "Error: " + err.message; }
  };
  const save = async (body) => {
    try { state.settings = await api("/api/settings", { method: "PUT", body }); state.live = {}; const c = $("#cost"); if (c) c.textContent = serpCost(state.settings); }
    catch (e) { $("#serr").textContent = e.message; }
  };
  $("#saveKey").onclick = async () => { const k = $("#key").value.trim(); if (k) { await save({ serpapi_key: k }); viewSettings(); } };
  $("#delKey") && ($("#delKey").onclick = async () => { await save({ serpapi_key: "" }); viewSettings(); });
  app.querySelectorAll("[data-prov]").forEach((c) => c.onchange = () => save({ providers: { ...state.settings.providers, [c.dataset.prov]: c.checked } }));
  $("#age").onchange = (e) => save({ max_offer_age_days: +e.target.value || 3 });
  $("#used").onchange = (e) => save({ include_used: e.target.checked });
  $("#diag").onclick = async (e) => {
    e.target.disabled = true; $("#diagOut").innerHTML = `<p class="muted">Probando fuentes… (hasta ~30 s)</p>`;
    try {
      const r = await api("/api/diagnose?snapshots=true");
      $("#diagOut").innerHTML = `<div class="pvs">${providerLine(r.providers)}</div>
        <ul class="small">${Object.entries(r.providers).map(([k, v]) => `<li><b>${PROVIDER_NAMES[k] || k}</b>: ${v.ok ? `${v.raw} en bruto → ${v.accepted ?? 0} válidos${v.ms != null ? ` (${v.ms} ms)` : ""}` : esc(v.error)}
          ${v.detail ? `<ul>${Object.entries(v.detail).map(([s2, d]) => `<li>${esc(s2)}: ${esc(d)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul>
        ${renderLive(r)}<p class="small muted">HTML guardado en ${esc(r.snapshot_dir || "")}</p>`;
    } catch (err) { $("#diagOut").innerHTML = `<p class="error">${esc(err.message)}</p>`; }
    e.target.disabled = false;
  };
}

/* ------------------------------------------------------------------ router */

const VIEWS = { profile: viewProfile, monitors: viewMonitors, ps5: viewPS5, shopcheck: viewShopCheck, when: viewWhen, promos: viewPromos, settings: viewSettings };

function go(view) {
  if (state.desk3d) { state.desk3d.dispose(); state.desk3d = null; }
  state.view = view;
  if (view === "monitors") state.monQuery = null;
  location.hash = view;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  window.scrollTo(0, 0);
  const app = document.getElementById("app");
  const render = () => { app.classList.remove("view-in"); VIEWS[view](); void app.offsetWidth; app.classList.add("view-in"); };
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (document.startViewTransition && !calm && !document.hidden) document.startViewTransition(render).ready.catch(() => {}); else render();
}

document.querySelectorAll("#tabs button").forEach((b) => b.onclick = () => go(b.dataset.view));
// La dirección (#monitors…) y los botones atrás/adelante del navegador también cambian de sección
window.addEventListener("hashchange", () => {
  const v = location.hash.slice(1);
  if (VIEWS[v] && v !== state.view) go(v);
});

(async function init() {
  try {
    [state.profile, state.catalog, state.settings] = await Promise.all([api("/api/profile"), api("/api/catalog"), api("/api/settings")]);
  } catch (e) {
    app.innerHTML = `<p class="error">No se pudo conectar con el servidor: ${esc(e.message)}</p>`;
    return;
  }
  const hash = location.hash.slice(1);
  const free = ["settings", "desk", "accessories"];
  go(VIEWS[hash] && (state.profile.devices?.length || free.includes(hash)) ? hash : "desk");
})();
