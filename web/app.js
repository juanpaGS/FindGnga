/* FindGnga – interfaz (JS sin dependencias) */
"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const app = $("#app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (n) => n == null ? "—" : n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });

/* ------------------------------------------------------------------ movimiento, avisos y accesibilidad
   API común (también la usan desk-view.js y desk3d.js): window.FG = { motion, reducedMotion, toast, announce,
   skeleton, reveal, theme, tween }. Las duraciones/curvas coinciden con los tokens CSS --dur-* / --ease-*. */

const SPRING_LINEAR = "linear(0, 0.081, 0.257, 0.458, 0.642, 0.791, 0.9, 0.971, 1.013, 1.033, 1.038, 1.036, 1.029, 1.021, 1.014, 1.008, 1.004, 1.001, 1, 0.999, 1)";
const MOTION = {
  dur: { fast: 120, base: 200, slow: 320, slower: 480 },
  ease: { standard: "cubic-bezier(.2, 0, 0, 1)", decel: "cubic-bezier(.05, .7, .1, 1)", accel: "cubic-bezier(.3, 0, .8, .15)",
    spring: window.CSS?.supports?.("transition-timing-function", "linear(0, 1)") ? SPRING_LINEAR : "cubic-bezier(.34, 1.3, .64, 1)" },
};
const reduceMQ = matchMedia("(prefers-reduced-motion: reduce)");
const reducedMotion = () => reduceMQ.matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const noLetters = (s) => !/[\p{L}\p{N}]/u.test(s || "");

const announceTimers = {};
/** Lee un mensaje con el lector de pantalla (región viva persistente; assertive sólo para errores). */
function announce(msg, { assertive = false } = {}) {
  const id = assertive ? "sr-alert" : "sr-status";
  const el = document.getElementById(id);
  if (!el || !msg) return;
  msg = String(msg).replace(LEAD_EMO, "");
  el.textContent = "";
  clearTimeout(announceTimers[id]);
  announceTimers[id] = setTimeout(() => { el.textContent = msg; }, 80);  // vaciar y rellenar: repite mensajes iguales
}

/** Aviso flotante («✓ Guardado»). type: ok | error | info. Devuelve una función para cerrarlo. */
function toast(msg, { type = "ok", timeout } = {}) {
  const text = String(msg ?? "").replace(/^\s*[✓✔]️?\s*/u, "");
  announce(text, { assertive: type === "error" });
  const host = document.getElementById("toasts");
  if (!host || !text) return () => {};
  const same = [...host.children].find((t) => !t.classList.contains("out") && t.dataset.msg === `${type}:${text}`);
  if (same?._restart) { same._restart(); return same._close; }  // el mismo aviso otra vez: se alarga, no se apila
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.dataset.msg = `${type}:${text}`;
  el.innerHTML = `<span class="t-icon">${type === "error" ? "!" : type === "info" ? "i" : "✓"}</span><span class="t-msg"></span>`;
  el.querySelector(".t-msg").textContent = text;
  host.append(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  let remaining = timeout ?? (type === "error" ? 6000 : 3200), started = 0, timer = 0, closed = false;
  const close = () => {
    if (closed) return; closed = true; clearTimeout(timer);
    el.classList.add("out");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), MOTION.dur.base + 150);
  };
  const arm = () => { started = Date.now(); timer = setTimeout(close, remaining); };
  el.addEventListener("mouseenter", () => { clearTimeout(timer); remaining = Math.max(800, remaining - (Date.now() - started)); });
  el.addEventListener("mouseleave", arm);
  el._close = close;
  el._restart = () => { clearTimeout(timer); remaining = timeout ?? (type === "error" ? 6000 : 3200); arm(); };
  arm();
  return close;
}

/** Esqueleto de carga. kind: cards | lines | table | view. Al sustituirlo por contenido, éste aparece con un fundido. */
function skeleton(kind = "cards", { n = 3, label = "Cargando…" } = {}) {
  const hint = label ? `<div class="skel-hint"><span class="spinner" aria-hidden="true"></span><span>${esc(label)}</span></div>` : "";
  const rep = (k, f) => Array.from({ length: k }, (_, i) => f(i)).join("");
  let body;
  if (kind === "lines") body = rep(n, (i) => `<div class="skel skel-line ${i % 3 === 2 ? "short" : ""}"></div>`);
  else if (kind === "table") body = rep(n, () => `<div class="skel-row"><div class="skel skel-line" style="width:30%"></div><div class="skel skel-line" style="width:40%"></div><div class="skel skel-line" style="width:14%"></div></div>`);
  else body = rep(n, () => `<div class="skel-card"><div class="skel-row"><div class="skel skel-title"></div><div class="skel skel-price"></div></div>
      <div class="skel skel-chip"></div><div class="skel-bars"><div class="skel skel-bar"></div><div class="skel skel-bar"></div><div class="skel skel-bar"></div></div>
      <div class="skel skel-line"></div><div class="skel skel-line short"></div></div>`);
  return `<div class="skeleton" aria-busy="true" ${kind === "view" ? "data-view-skel" : ""}>${hint}${kind === "view" ? `<div class="skel skel-title" style="height:26px;width:38%"></div><div class="skel skel-line"></div>` + rep(2, () => `<div class="skel-card"><div class="skel skel-title"></div><div class="skel skel-line"></div><div class="skel skel-line short"></div></div>`) : body}</div>`;
}

/** Animación de entrada de los hijos de `el` una sola vez (no se repite en los re-render). */
function reveal(el) {
  if (!el || el === app) return;
  el.classList.remove("reveal"); void el.offsetWidth; el.classList.add("reveal");
  clearTimeout(el._revealT);
  el._revealT = setTimeout(() => el.classList.remove("reveal"), MOTION.dur.slower + 400);
}

/* --- interpolación de precios y barras al cambiar (sin re-animar todo) */
const parseEur = (t) => {
  const m = String(t || "").replace(/\s/g, "").match(/-?\d[\d.]*(,\d+)?/);
  return m ? parseFloat(m[0].replace(/\./g, "").replace(",", ".")) : null;
};
function tweenNumber(textNode, from, to, { dur = MOTION.dur.slower, format = eur } = {}) {
  if (reducedMotion() || document.hidden || from == null || to == null || Math.abs(from - to) < 0.5) return;
  const final = textNode.data, t0 = performance.now();
  setTimeout(() => { if (textNode.data !== final) textNode.data = final; }, dur + 150);  // por si rAF se pausa
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  textNode.data = format(from);
  const step = (now) => {
    if (!textNode.isConnected) return;
    const k = Math.min(1, (now - t0) / dur);
    textNode.data = k < 1 ? format(from + (to - from) * ease(k)) : final;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
const TWEEN_SEL = ".price .final, .bestline .big-num, .bar .fill";
function tweenKey(el, ctx) {
  const near = (sel) => el.closest(sel) || ctx?.closest?.(sel);
  const out = near("[data-live-out]");
  const art = near("article, .result");
  const pid = out?.getAttribute("data-live-out") || art?.querySelector("[data-live]")?.dataset.live || art?.dataset.pid;
  if (!pid) return null;
  if (el.matches(".bar .fill")) return `${pid}:bar:${el.closest(".bar")?.querySelector(".lbl span")?.textContent}`;
  return `${pid}:${out ? "best" : "final"}:${el.className}`;
}
const firstText = (el) => [...el.childNodes].find((n) => n.nodeType === 3 && n.data.trim());
function readTweenable(el) {
  if (el.matches(".bar .fill")) return parseFloat(el.style.width) || 0;
  return parseEur(firstText(el)?.data);
}

/* --- mejoras automáticas de accesibilidad para todo lo que se pinta en #app (también desk-view.js) */
const EMO = "(?:\\p{Extended_Pictographic}|\\p{Regional_Indicator})(?:\\uFE0F|\\uFE0E|\\p{Emoji_Modifier}|\\u200D\\p{Extended_Pictographic})*";
const LEAD_EMO = new RegExp(`^\\s*(?:${EMO}\\s*)+`, "u");
const TRAIL_EMO = new RegExp(`(?:\\s*${EMO})+\\s*$`, "u");
const SKIP_TEXT = "script, style, option, textarea, code, .code, .desk3d, [aria-hidden='true'], .sr-only, svg, canvas, select";
const PRESSABLE = "button.chip, button.card-opt, button.type-btn, button.swatch";

function syncPressed(el) {
  if (el.matches?.(PRESSABLE)) {
    const v = String(el.classList.contains("sel"));
    if (el.getAttribute("aria-pressed") !== v) el.setAttribute("aria-pressed", v);
  }
}
function hideEmoji(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const todo = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!/\p{Extended_Pictographic}/u.test(n.data)) continue;
    const p = n.parentElement;
    if (!p || p.closest(SKIP_TEXT)) continue;
    todo.push(n);
  }
  for (const n of todo) {
    const p = n.parentElement;
    if (noLetters(n.data)) {               // nodo sólo con emoji: decorativo si el elemento tiene otro nombre
      const host = p.closest("button, a, summary, label, [title]") || p;
      const other = host.textContent.replace(n.data, "");
      const name = host.getAttribute("aria-label") || host.getAttribute("title");
      if (noLetters(other) && !name) continue;  // es lo único que hay: lo deja para que se lea
      if (noLetters(other) && name && !host.hasAttribute("aria-label") && host.matches("button, a")) host.setAttribute("aria-label", name);
      if (p.childNodes.length === 1 && p !== host) { p.setAttribute("aria-hidden", "true"); continue; }
      wrap(n, 0, n.data.length); continue;
    }
    const tail = n.data.match(TRAIL_EMO);
    if (tail) wrap(n, n.data.length - tail[0].length, n.data.length);
    const lead = n.data.match(LEAD_EMO);
    if (lead) wrap(n, 0, lead[0].length);
  }
  function wrap(node, a, b) {
    const span = document.createElement("span");
    span.setAttribute("aria-hidden", "true");
    const mid = a > 0 ? node.splitText(a) : node;
    if (b - a < mid.data.length) mid.splitText(b - a);
    mid.replaceWith(span); span.append(mid);
  }
}
function enhance(root) {
  if (!root || root.nodeType !== 1 || root.closest?.(".desk3d")) return;
  const all = (sel) => [root, ...root.querySelectorAll(sel)].filter((e) => e.matches?.(sel));
  all(PRESSABLE).forEach(syncPressed);
  all("button:not([aria-label])[title]").forEach((b) => { if (noLetters(b.textContent)) b.setAttribute("aria-label", b.title); });
  all("th:not([scope])").forEach((th) => {
    const tr = th.parentElement;
    th.setAttribute("scope", tr?.parentElement?.tagName === "THEAD" || tr?.rowIndex === 0 ? "col" : "row");
  });
  all("a[target='_blank']:not([data-ext])").forEach((a) => {
    a.dataset.ext = "1";
    a.insertAdjacentHTML("beforeend", `<span class="sr-only"> (se abre en otra pestaña)</span>`);
  });
  all("input[type='range']:not([aria-valuetext])").forEach((r) => {
    if (r.dataset.unit === "eur") r.setAttribute("aria-valuetext", eur(+r.value));
  });
  hideEmoji(root);
}

const revealPending = new Set();
const mo = new MutationObserver((records) => {
  const before = new Map();
  const added = [];
  for (const r of records) {
    if (r.target.closest?.(".desk3d")) continue;
    if (r.type === "attributes") { syncPressed(r.target); continue; }
    r.removedNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      [n, ...n.querySelectorAll(TWEEN_SEL)].filter((e) => e.matches(TWEEN_SEL)).forEach((e) => {
        const k = tweenKey(e, r.target); if (k) before.set(k, readTweenable(e));
      });
      const isSkel = n.matches(".skeleton:not([data-view-skel])") || n.querySelector(":scope > .skeleton:not([data-view-skel])");
      const isPlaceholder = n.matches("p.muted") && /…\s*$/.test(n.textContent);
      if (isSkel || isPlaceholder) revealPending.add(r.target);
    });
    r.addedNodes.forEach((n) => n.nodeType === 1 && added.push([n, r.target]));
  }
  for (const [n, ctx] of added) {
    if (!n.isConnected) continue;
    enhance(n);
    if (!before.size || reducedMotion() || document.hidden) continue;
    [n, ...n.querySelectorAll(TWEEN_SEL)].filter((e) => e.matches(TWEEN_SEL)).forEach((e) => {
      const k = tweenKey(e, ctx);
      if (!k || !before.has(k)) return;
      const from = before.get(k), to = readTweenable(e);
      if (e.matches(".bar .fill")) {
        if (!to || Math.abs(from - to) < 0.5) return;
        e.animate([{ transform: `scaleX(${Math.max(0, from / to)})` }, { transform: "none" }],
          { duration: MOTION.dur.slower, easing: MOTION.ease.standard });
      } else { const t = firstText(e); if (t) tweenNumber(t, from, to); }
    });
  }
  revealPending.forEach((el) => { if (el.isConnected) reveal(el); });
  revealPending.clear();
  mo.takeRecords();  // descarta los cambios hechos aquí mismo (envolver emoji, aria-pressed…)
});
mo.observe(app, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

/* --- <details>: si el navegador no anima ::details-content, un fundido al abrir */
const detailsAnimated = !!window.CSS?.supports?.("selector(::details-content)");
document.addEventListener("click", (e) => {
  const s = e.target.closest?.("summary");
  const d = s?.parentElement;
  if (detailsAnimated || !d || d.tagName !== "DETAILS" || d.open || reducedMotion()) return;
  d.classList.add("anim-open");
  setTimeout(() => d.classList.remove("anim-open"), MOTION.dur.slow + 100);
});

/* --- tema: auto / claro / oscuro (data-theme en <html>, guardado en localStorage) */
const THEME_KEY = "findgnga-theme";
const darkMQ = matchMedia("(prefers-color-scheme: dark)");
function themePref() {
  try { const t = localStorage.getItem(THEME_KEY); return t === "light" || t === "dark" ? t : "auto"; } catch { return "auto"; }
}
function resolvedTheme() {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : (darkMQ.matches ? "dark" : "light");
}
function setTheme(pref, { animate = true } = {}) {
  const html = document.documentElement;
  try { pref === "auto" ? localStorage.removeItem(THEME_KEY) : localStorage.setItem(THEME_KEY, pref); } catch { /* sin almacenamiento: sólo esta sesión */ }
  const apply = () => {
    if (pref === "auto") delete html.dataset.theme; else html.dataset.theme = pref;
    window.dispatchEvent(new CustomEvent("findgnga:theme", { detail: { pref, theme: resolvedTheme() } }));
  };
  if (animate && document.startViewTransition && !document.hidden) {
    html.classList.add("theme-vt");
    const vt = document.startViewTransition(apply);
    vt.ready.catch(() => {}); vt.updateCallbackDone.catch(() => {});
    vt.finished.catch(() => {}).finally(() => html.classList.remove("theme-vt"));
  } else apply();
}
darkMQ.addEventListener?.("change", () => {
  if (themePref() === "auto") window.dispatchEvent(new CustomEvent("findgnga:theme", { detail: { pref: "auto", theme: resolvedTheme() } }));
});
document.addEventListener("visibilitychange", () => document.documentElement.classList.toggle("is-hidden", document.hidden));

window.FG = { motion: MOTION, reducedMotion, toast, announce, skeleton, reveal, tween: tweenNumber,
  theme: { get: themePref, resolved: resolvedTheme, set: setTheme } };

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

/* ------------------------------------------------------------------ vistas */

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
const PROVIDER_NAMES = { serpapi: "Google Shopping", serpapi_amazon: "Amazon.es", serpapi_ebay: "eBay", serpapi_idealo: "Idealo (Google)", chollometro: "Chollometro", idealo: "Idealo", stores: "tienda", watched: "URL vigilada", index: "Índice propio (precios recordados)" };
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
  return `<div class="scroll-x"><table><caption class="sr-only">Precios vigentes por tienda</caption>
    <thead><tr><th scope="col">Tienda</th><th scope="col" class="num">Precio</th><th scope="col" class="num">Envío</th><th scope="col" class="num">Cupón</th><th scope="col" class="num">Total</th><th scope="col">Fuente</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
    <tbody>${pricing.offers.map((o) => `<tr class="${o.suspicious ? "sus" : ""}"><td>${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener nofollow">${esc(o.store_name)} ↗</a>` : esc(o.store_name)}
        ${o.from_index ? ` <span class="badge b-est" title="La tienda no respondió hoy; es el último precio que vimos">🕘 Visto el ${esc(String(o.seen_at || "").slice(0, 10).split("-").reverse().join("/"))}</span>` : ""}${o.match_conf != null && o.match_conf < 70 ? ` <span class="badge b-warn" title="El título no coincide del todo con el modelo buscado">🔎 Coincidencia ${o.match_conf} %</span>` : ""}${o.inflated ? ` <span class="badge b-warn" title="Por encima de lo normal">📈 Inflado ×${o.inflated.toFixed(1)}</span>` : ""}${o.suspicious ? ` <span class="badge b-bad" title="${esc((o.warnings || []).join(" · "))}">🚩 Sospechosa</span>` : ""}${o.code ? ` <span class="code">${esc(o.code)}</span>` : ""}${verifBadge(o)}${(o.warnings || []).length ? ` <span title="${esc(o.warnings.join(" · "))}"><span aria-hidden="true">⚠️</span><span class="sr-only">Avisos: ${esc(o.warnings.join(" · "))}</span></span>` : ""}</td>
      <td class="num">${eur(o.price)}</td><td class="num">${eur(o.shipping_cost)}</td>
      <td class="num">${o.promo_code ? `−${eur(o.promo_discount)}` : "—"}</td><td class="num"><b>${eur(o.final_price)}</b></td>
      <td class="small muted">${sourceLabel(o.source)} · ${ago(o.checked_at)}</td>
      <td><button type="button" class="ghost small" data-del-offer="${esc(o.id)}" title="Borrar este precio" aria-label="Borrar precio de ${esc(o.store_name)}"><span aria-hidden="true">🗑️</span></button></td></tr>`).join("")}</tbody></table></div>`;
}

function linksRow(links) {
  return `<div class="links">${links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener" title="${esc(l.tip)}">${esc(l.name)} ↗</a>`).join("")}</div>`;
}

function productActions(product, name) {
  const pid = esc(product.id);
  const live = state.live[product.id];
  const pred = state.pred[product.id];
  return `<div class="actions">
    <button type="button" class="ghost" data-target="${pid}" data-name="${esc(name)}">🔔 Alerta de precio</button>
    <button type="button" class="ghost" data-offer="${pid}" data-name="${esc(name)}">➕ Precio a mano</button>
    <button type="button" class="secondary" data-predict="${pid}">📈 ¿Comprar ya o esperar?</button>
    <button type="button" class="primary" data-live="${pid}">🔎 Buscar precio ahora</button></div>
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
  if (r.loading) return `<div class="live">${skeleton("table", { n: 4, label: "Buscando en todas las fuentes y verificando en las tiendas…" })}</div>`;
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
    ${rows.length ? `<div class="scroll-x"><table><caption class="sr-only">Ofertas encontradas, de la más barata a la más cara</caption>
      <thead><tr><th scope="col">Tienda</th><th scope="col">Producto</th><th scope="col" class="num">Total</th><th scope="col"><span class="sr-only">Comprar</span></th></tr></thead><tbody>
      ${rows.map((o) => `<tr class="${o.in_stock === false ? "dim" : ""} ${o.suspicious ? "sus" : ""}"><td><b>${esc(o.store_name)}</b><div>${confBadge(o)}</div></td>
        <td class="small">${esc(o.title)}
          ${o.condition === "used" ? `<span class="badge b-est">Usado/reacond.</span>` : ""}${o.bundle ? `<span class="badge b-q">Pack</span>` : ""}
          ${verifBadge(o)}${o.code ? ` código <span class="code">${esc(o.code)}</span>` : ""}
          <div class="muted">${eur(o.price)}${oldPrice(o)} ${o.shipping_cost ? "+ " + eur(o.shipping_cost) + " envío" : "· envío gratis*"}${o.promo_code ? " − cupón " + esc(o.promo_code) : ""}
            · vía ${(o.seen_in?.length ? o.seen_in : [o.provider]).map((x) => PROVIDER_NAMES[x] || x).join(", ")}</div>
          ${(o.warnings || []).map((w) => `<div class="warnline">⚠️ ${esc(w)}</div>`).join("")}</td>
        <td class="num"><b>${eur(o.final_price)}</b></td>
        <td>${buyButton(o)}
          ${o.store.startsWith("x-") ? `<button type="button" class="ghost small" data-shopcheck="${esc(JSON.stringify({ url: o.shop_url || o.url, store_name: o.store_name, price: o.price, product_id: r.product_id }))}" title="¿Es fiable esta tienda?">🛡️ Comprobar</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted small">* Envío estimado con las reglas de la tienda cuando la fuente no lo indica. Confirma siempre el total en el carrito.</p>`
    : `<p class="muted">No se encontraron ofertas válidas. ${Object.values(r.providers).every((s) => !s.ok) ? "Ninguna fuente respondió: revisa <a href=\"#settings\" data-go=\"settings\">Ajustes → Diagnóstico</a>." : "Prueba más tarde o usa los enlaces de tiendas."}</p>`}
  </div>`;
}

const LEVEL = { buy: ["✅", "v-good"], wait: ["⏳", "v-meh"], neutral: ["🤔", ""], unknown: ["❔", ""] };

function renderPrediction(p) {
  if (p.loading) return `<div class="live">${skeleton("lines", { n: 4, label: "Calculando la mejor fecha de compra…" })}</div>`;
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
      Ya tengo <input type="number" min="0" step="10" value="${p.plan.already_saved}" data-saved="${esc(p.product_id)}" aria-label="Dinero ya ahorrado, en euros" style="width:110px;display:inline-block"> €
      → ahorra <b>${eur(p.plan.per_week)}/semana</b> durante ${p.plan.weeks} semanas.</div>` : ""}
    <details><summary>¿Por qué?</summary><ul class="reasons">${p.reasons.map((r) => `<li class="r-info">${esc(r)}</li>`).join("")}</ul>
      <p class="small muted">Estimación basada en campañas de años anteriores y en tu histórico de precios (cada búsqueda lo alimenta). No es una garantía.</p></details>
  </div>`;
}

function monitorCard(it, hero = false) {
  const m = it.product, e = it.eval;
  const name = `${m.brand} ${m.model}`;
  return `<article class="result ${hero ? "hero" : ""}" data-pid="${esc(m.id)}" aria-label="${esc(name)}">
    <div class="result-head">
      <div><div>${it.badges.map((b) => `<span class="badge ${BADGES[b][1]}">${BADGES[b][0]}</span>`).join("")}</div>
        <div class="title">${esc(name)}</div><div class="muted small">${esc(m.notes || "")}</div></div>
      ${priceBlock(it.pricing)}
    </div>
    <div class="bars">${bar("Calidad", e.quality)}${bar("Compatibilidad", e.compat)}${bar("Nota global", e.fit)}
      ${bar("Calidad/precio", Math.min(100, it.value_index * 2.5))}</div>
    ${reasonsList(e.reasons)}
    ${e.devices.map((d) => `<details ${hero ? "open" : ""}><summary>🔌 Con tu ${esc(d.device_label)}: ${d.score}/100${d.dealbreaker ? ` <span aria-hidden="true">⛔</span><span class="sr-only">(no es compatible)</span>` : ""}</summary>${reasonsList(d.reasons)}</details>`).join("")}
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
      <div role="group" aria-labelledby="devs-lbl"><span class="lbl"><b id="devs-lbl">¿Qué vas a conectar?</b></span><div class="chips" id="devs">${p.devices.map((d) =>
        `<button type="button" class="chip ${q.device_ids.includes(d.id) ? "sel" : ""}" aria-pressed="${q.device_ids.includes(d.id)}" data-id="${esc(d.id)}">${esc(deviceLabelFor(d))}</button>`).join("") || `<span class="muted">Sin dispositivos: <a href="#desk" id="towiz">añádelos en Mi escritorio</a></span>`}</div></div>
      <div><label for="budget"><b>Presupuesto: <span class="big-num" id="bv">${eur(q.budget)}</span></b></label>
        <input type="range" id="budget" min="150" max="1800" step="25" value="${q.budget}" data-unit="eur" aria-valuetext="${eur(q.budget)}"></div>
      <div><label for="prio"><b>Prioridad</b></label><input type="range" id="prio" min="0" max="1" step="0.1" value="${q.priority}" aria-valuetext="${prioText(q.priority)}" aria-describedby="prio-hint">
        <div class="range-labels" id="prio-hint"><span>💸 Precio</span><span>💎 Calidad</span></div></div>
    </div>
    ${keyBanner()}
    <div class="actions" style="justify-content:flex-start"><button type="button" class="primary" id="liveTop">🔎 Buscar precios reales del top 5</button></div>
    <div id="results" aria-busy="true">${skeleton("cards", { n: 3, label: "Buscando los monitores que mejor encajan…" })}</div>`;
  bindResultActions(app, () => {});
  let lastIds = [], reqSeq = 0, annT = 0;
  $("#liveTop").onclick = (e) => runLiveAll(lastIds.slice(0, 5), $("#results"), load, e.target);
  app.querySelectorAll("#devs .chip").forEach((b) => b.onclick = () => {
    const id = b.dataset.id;
    q.device_ids = q.device_ids.includes(id) ? q.device_ids.filter((x) => x !== id) : [...q.device_ids, id];
    b.classList.toggle("sel"); b.setAttribute("aria-pressed", String(b.classList.contains("sel"))); load();
  });
  $("#towiz") && ($("#towiz").onclick = (e) => { e.preventDefault(); go("desk"); });
  let t;
  $("#budget").oninput = (e) => { q.budget = +e.target.value; $("#bv").textContent = eur(q.budget); clearTimeout(t); t = setTimeout(load, 250); };
  $("#prio").oninput = (e) => { q.priority = +e.target.value; e.target.setAttribute("aria-valuetext", prioText(q.priority)); clearTimeout(t); t = setTimeout(load, 250); };

  async function load() {
    const out = $("#results");
    const mine = ++reqSeq;              // si llegan respuestas desordenadas (arrastrar el deslizador), gana la última
    out.setAttribute("aria-busy", "true");
    try {
      const r = await api("/api/search/monitors", { method: "POST", body: q });
      if (mine !== reqSeq || !out.isConnected) return;
      lastIds = r.results.map((x) => x.product.id);
      out.innerHTML = renderMonitorResults(r);
      bindResultActions(out, load);
      clearTimeout(annT);
      annT = setTimeout(() => announce(r.results.length
        ? `${r.results.length} ${r.results.length === 1 ? "monitor encaja" : "monitores encajan"} con ${eur(q.budget)} de presupuesto`
        : "Ningún monitor encaja con este presupuesto"), 700);
    } catch (e) { if (mine === reqSeq) out.innerHTML = `<p class="error" role="alert">Error: ${esc(e.message)}</p>`; }
    finally { if (mine === reqSeq) out.removeAttribute("aria-busy"); }
  }
  load();
}

const prioText = (v) => v <= 0.2 ? "Prima el precio" : v >= 0.8 ? "Prima la calidad" : v === 0.5 ? "Equilibrado entre precio y calidad"
  : `${Math.round((1 - v) * 100)} % precio, ${Math.round(v * 100)} % calidad`;

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
      <button type="button" class="primary" id="liveAll">🔎 Buscar PS5 ahora en todas las tiendas</button>
      <label class="chip sel inline"><input type="checkbox" id="incl" ${state.ps5Incl !== false ? "checked" : ""}> Monitor que sirva también para mis otros dispositivos</label></div>
    <div id="results" aria-busy="true">${skeleton("cards", { n: 3, label: "Buscando consolas y monitores…" })}</div>`;
  bindResultActions(app, () => {});
  $("#liveAll").onclick = (e) => runLiveAll(state.catalog.consoles.map((c) => c.id), $("#results"), load, e.target);
  $("#incl").onchange = (e) => { state.ps5Incl = e.target.checked; load(); };
  async function load() {
    const out = $("#results");
    out.setAttribute("aria-busy", "true");
    try {
      const r = await api(`/api/search/ps5?include_devices=${state.ps5Incl !== false}`);
      if (!out.isConnected) return;
      const budget = state.profile?.budget_console;
      out.innerHTML = `<h2>Consolas</h2>${r.consoles.map((c) => consoleCard(c, budget)).join("")}
        <h2>🖥️ Monitor ideal para tu PS5</h2>
        <p class="muted">Para PS5 lo clave es <b>HDMI 2.1</b> (4K a 120 Hz y VRR). Top 3:</p>
        ${renderMonitorResults(r.monitors, 3)}
        <p><a href="#monitors" id="allmon">Ver todos los monitores →</a></p>`;
      $("#allmon").onclick = (e) => { e.preventDefault(); go("monitors"); };
      bindResultActions(out, load);
    } catch (e) { out.innerHTML = `<p class="error" role="alert">Error: ${esc(e.message)}</p>`; }
    finally { out.removeAttribute("aria-busy"); }
  }
  load();
}

function consoleCard(c, budget) {
  const p = c.product, v = c.verdict;
  const over = budget && c.pricing.final_price > budget;
  return `<article class="result" data-pid="${esc(p.id)}" aria-label="${esc(p.name)}">
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
    try { await api(`/api/offers/${b.dataset.delOffer}`, { method: "DELETE" }); toast("Precio borrado"); }
    catch (e) { toast("No se pudo borrar: " + e.message, { type: "error" }); }
    reload();
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
    if (price != null && !(price > 0)) { toast("Escribe un precio válido en euros", { type: "error" }); return; }
    try {
      const r = await api(`/api/targets/${b.dataset.target}`, { method: "PUT", body: { price } });
      state.settings.targets = r.targets;
      toast(price == null ? "Alerta de precio quitada" : `Te avisaremos por debajo de ${eur(price)}`);
    } catch (e) { toast("No se pudo guardar la alerta: " + e.message, { type: "error" }); }
    reload();
  });
}

function outFor(root, attr, pid) {
  return [...root.querySelectorAll(`[${attr}]`)].find((x) => x.getAttribute(attr) === pid);
}

async function runLive(pid, root, reload, { quiet = false } = {}) {
  state.live[pid] = { loading: true };
  const out = outFor(root, "data-live-out", pid);
  const btn = root.querySelector(`[data-live="${CSS.escape(pid)}"]`);
  if (out) { out.innerHTML = renderLive(state.live[pid]); out.setAttribute("aria-busy", "true"); }
  if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
  if (!quiet) announce("Buscando precios en todas las fuentes…");
  try { state.live[pid] = await api(`/api/live/${pid}?force=true`, { method: "POST" }); }
  catch (e) { state.live[pid] = { error: e.message }; }
  const r = state.live[pid];
  if (!quiet) {
    if (r.error) toast("La búsqueda falló: " + r.error, { type: "error" });
    else announce(r.listings?.length ? `${r.listings.length} ofertas válidas. Mejor precio: ${eur(r.best?.final_price)}${r.best ? " en " + r.best.store_name : ""}` : "No se encontraron ofertas válidas");
  }
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
  btn.disabled = true; btn.setAttribute("aria-busy", "true");
  announce(`Buscando precios de ${ids.length} productos…`);
  let found = 0;
  for (let i = 0; i < ids.length; i++) {
    btn.textContent = `🔎 Buscando ${i + 1}/${ids.length}…`;
    await runLive(ids[i], root, reload, { quiet: true });
    if (state.live[ids[i]]?.listings?.length) found++;
  }
  btn.disabled = false; btn.removeAttribute("aria-busy"); btn.textContent = "🔎 Buscar de nuevo";
  await reload();
  toast(`Búsqueda terminada: ${found} de ${ids.length} productos con ofertas`, { type: found ? "ok" : "info" });
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
  // Al cerrar, el foco vuelve al botón que abrió el diálogo (o a su equivalente si la lista se ha vuelto a pintar)
  const opener = document.activeElement;
  dlg.onclose = () => {
    const target = opener?.isConnected ? opener : app.querySelector(`[data-offer="${CSS.escape(productId)}"]`);
    target?.focus({ preventScroll: true });
  };
  const done = async (msg) => { toast(msg); await reload(); dlg.close(); };
  $("#offer-live").onclick = async () => {
    const url = form.url.value.trim();
    if (!url) { $("#offer-error").textContent = "Pega la URL del producto"; return; }
    $("#offer-live").disabled = true; $("#offer-error").textContent = "Comprobando…";
    try {
      const r = await api("/api/offers/check", { method: "POST", body: { product_id: productId, store: form.store.value, url } });
      await done(r?.extracted?.price ? `Precio comprobado: ${eur(r.extracted.price)}` : "Precio comprobado y guardado");
    } catch (e) { $("#offer-error").textContent = e.message; }
    finally { $("#offer-live").disabled = false; }
  };
  $("#offer-save").onclick = async () => {
    const price = parseFloat(form.price.value);
    if (!(price > 0)) { $("#offer-error").textContent = "Escribe el precio"; return; }
    try {
      await api("/api/offers", { method: "POST", body: { product_id: productId, store: form.store.value, price,
        shipping: form.shipping.value === "" ? null : parseFloat(form.shipping.value), url: form.url.value.trim() || null } });
      await done("Precio guardado");
    } catch (e) { $("#offer-error").textContent = e.message; }
  };
  dlg.showModal();
  form.url.focus();
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
        <div><button class="primary">Guardar código</button> <span class="error" id="perr" aria-live="polite"></span></div>
      </form></div>
    <h2>Tus códigos</h2>
    ${promos.length ? `<div class="scroll-x"><table><caption class="sr-only">Tus códigos de descuento</caption>
      <thead><tr><th scope="col">Código</th><th scope="col">Tienda</th><th scope="col">Descuento</th><th scope="col">Condiciones</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead><tbody>${promos.map((p) => `<tr>
      <td><span class="code">${esc(p.code)}</span></td><td>${esc(stores.find((s) => s.id === p.store)?.name || "Cualquiera")}</td>
      <td>${p.type === "percent" ? p.value + " %" : eur(p.value)}</td>
      <td class="small">${[p.min_spend ? "mín. " + eur(p.min_spend) : "", p.max_discount ? "máx. " + eur(p.max_discount) : "", p.expires ? "hasta " + p.expires : "", (p.categories || []).join(", ")].filter(Boolean).join(" · ") || "—"}</td>
      <td>${p.id ? `<button type="button" class="ghost small" data-del="${esc(p.id)}" title="Borrar código" aria-label="Borrar el código ${esc(p.code)}"><span aria-hidden="true">🗑️</span></button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Aún no tienes códigos.</p>`}
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
      toast(`Código ${f.code.value.trim()} guardado`);
      await viewPromos();
      app.querySelector("#pf [name='code']")?.focus();
    } catch (err) { $("#perr").textContent = err.message; }
  };
  app.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    try { await api(`/api/promos/${b.dataset.del}`, { method: "DELETE" }); toast("Código borrado"); }
    catch (e) { toast("No se pudo borrar: " + e.message, { type: "error" }); }
    await viewPromos();
    focusHeading();
  });
}

/* ------------------------------------------------------------------ ¿es fiable? */

const SIG_ICON = { danger: "🚩", warn: "⚠️", info: "ℹ️", ok: "✅" };
const SIG_TEXT = { danger: "Peligro", warn: "Atención", info: "Información", ok: "Correcto" };

function renderShopCheck(r) {
  const cls = { scam: "sc-scam", doubtful: "sc-doubt", ok: "sc-ok" }[r.verdict];
  return `<div class="panel sc ${cls}">
    <div class="sc-head"><span class="sc-label">${esc(r.label)}</span>
      <span class="small">riesgo <b>${r.risk}</b>/100 · ${esc(r.domain || "")}${r.online ? "" : " · sin comprobar en línea"}</span></div>
    <div class="meter" role="meter" aria-label="Riesgo" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${r.risk}" aria-valuetext="${r.risk} de 100"><div style="width:${r.risk}%"></div></div>
    <ul class="sigs">${r.signals.map((s) => `<li class="sig-${s.level}"><span aria-hidden="true">${SIG_ICON[s.level]}</span><div><span class="sr-only">${SIG_TEXT[s.level] || ""}: </span><b>${esc(s.title)}</b>
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
      <div><button class="primary">🛡️ Comprobar</button> <span class="error" id="scerr" aria-live="polite"></span></div>
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
    btn.disabled = true; btn.setAttribute("aria-busy", "true"); $("#scerr").textContent = "";
    out.innerHTML = skeleton("lines", { n: 5, label: "Comprobando la tienda…" });
    announce("Comprobando la tienda…");
    try {
      const r = await api("/api/shopcheck", { method: "POST", body: { url: f.url.value.trim(), store_name: f.store_name.value.trim() || null,
        price: f.price.value ? parseFloat(f.price.value) : null, product_id: f.product_id.value || null,
        text: f.text.value, online: f.online.checked } });
      out.innerHTML = renderShopCheck(r);
      out.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
      announce(`${r.label}. Riesgo ${r.risk} de 100.`);
    } catch (err) { out.innerHTML = ""; $("#scerr").textContent = err.message; }
    btn.disabled = false; btn.removeAttribute("aria-busy");
  };
  if (pre.url) f.requestSubmit();
}

/* ------------------------------------------------------------------ cuándo comprar */

async function viewWhen() {
  app.innerHTML = `<h1>📈 ¿Cuándo comprar?</h1>
    <p class="muted">Estimamos cuándo y cuánto bajará cada producto con el calendario de campañas en España, la tendencia de su categoría y tu histórico de precios (que crece cada vez que buscas). Úsalo para decidir si comprar ya o ahorrar para la próxima bajada.</p>
    <div id="preds" aria-busy="true">${skeleton("cards", { n: 3, label: "Calculando cuándo bajarán los precios…" })}</div>
    <h2>🗓️ Calendario de rebajas</h2><div id="cal"></div>`;
  const out = $("#preds");
  const [cal, mon] = await Promise.all([api("/api/calendar"), api("/api/search/monitors", { method: "POST", body: {} })]);
  const items = [...state.catalog.consoles.map((c) => ({ id: c.id, name: c.name })),
    ...mon.results.slice(0, 3).map((m) => ({ id: m.product.id, name: `${m.product.brand} ${m.product.model}` }))];
  const preds = await Promise.all(items.map((it) => api(`/api/predict/${it.id}`).catch((e) => ({ error: e.message }))));
  preds.forEach((p, i) => { state.pred[items[i].id] = p; });
  if (!out.isConnected) return;
  out.innerHTML = items.map((it, i) => `<article class="result" data-pid="${esc(it.id)}" aria-label="${esc(it.name)}"><h2 class="title" style="margin:0">${esc(it.name)}</h2>
    ${preds[i].current_price == null ? `<p class="small muted">Sin precio actual: la predicción usa el precio de referencia. <button type="button" class="ghost small" data-live="${esc(it.id)}">🔎 Buscar precio ahora</button></p><div data-live-out="${esc(it.id)}"></div>` : ""}
    <div data-predict-out="${esc(it.id)}">${renderPrediction(preds[i])}</div></article>`).join("");
  out.removeAttribute("aria-busy");
  bindResultActions(out, viewWhen);
  const today = new Date().toISOString().slice(0, 10);
  $("#cal").innerHTML = `<div class="scroll-x"><table><caption class="sr-only">Calendario de rebajas y descuentos típicos</caption>
    <thead><tr><th scope="col">Campaña</th><th scope="col">Fechas</th><th scope="col" class="num">Monitores</th><th scope="col" class="num">Consolas</th></tr></thead><tbody>
    ${cal.events.filter((e) => e.end >= today).map((e) => `<tr><td>${esc(e.name)}</td><td class="small">${e.start} → ${e.end}</td>
      <td class="num">${pct(e.discount.monitor)}</td><td class="num">${pct(e.discount.console)}</td></tr>`).join("")}
    ${cal.unscheduled.map((e) => `<tr><td>${esc(e.name)}</td><td class="small">sin fecha fija</td><td class="num">${pct(e.discount.monitor)}</td><td class="num">${pct(e.discount.console)}</td></tr>`).join("")}
    </tbody></table></div><p class="small muted">Descuentos típicos de años anteriores. Puedes ajustarlos en <code>data/events.json</code>.</p>`;
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
  const p = state.profile || {};
  const uses = new Set(p.uses || []);
  app.innerHTML = `<h1>⚙️ Ajustes</h1>
    <div class="panel"><h3>🎯 Tus gustos</h3>
      <p class="small muted">Tus dispositivos salen de 🪑 Mi escritorio. Aquí ajustas para qué usas la pantalla y cuánto quieres gastar; cambia la nota de los monitores y el «buen precio».</p>
      <div class="chips" id="pf-uses" role="group" aria-label="Para qué usas la pantalla">${USES.map(([v, l]) => `<button type="button" class="chip ${uses.has(v) ? "sel" : ""}" aria-pressed="${uses.has(v)}" data-v="${v}">${l}</button>`).join("")}</div>
      <div class="controls">
        <div><label for="pf-bm"><b>Presupuesto monitor: <span class="big-num" id="pf-bmv">${eur(p.budget_monitor || 500)}</span></b></label>
          <input type="range" id="pf-bm" min="150" max="1800" step="25" value="${p.budget_monitor || 500}" data-unit="eur" aria-valuetext="${eur(p.budget_monitor || 500)}"></div>
        <div><label for="pf-bc"><b>Presupuesto PS5: <span class="big-num" id="pf-bcv">${eur(p.budget_console || 650)}</span></b></label>
          <input type="range" id="pf-bc" min="350" max="1000" step="10" value="${p.budget_console || 650}" data-unit="eur" aria-valuetext="${eur(p.budget_console || 650)}"></div>
      </div>
    </div>
    <div class="panel"><h3>🔑 Google Shopping (recomendado)</h3>
      <p class="small">Es como funcionan los comparadores: una sola consulta trae precio, tienda, envío y enlace de casi todas las tiendas españolas.
      Crea una cuenta gratuita en <a href="https://serpapi.com" target="_blank" rel="noopener">serpapi.com</a> y pega tu API key (el plan gratis da para buscar tus productos varias veces al día).
      Se guarda sólo en tu ordenador (<code>data/user/settings.json</code>).</p>
      <label for="key" class="sr-only">API key de SerpApi</label>
      <div class="row"><input type="text" id="key" autocomplete="off" spellcheck="false" placeholder="${st.serpapi_key_set ? "Guardada (" + esc(st.serpapi_key_hint) + ") – escribe otra para cambiarla" : "Pega aquí tu API key"}">
        <div><button type="button" class="primary" id="saveKey">Guardar</button> ${st.serpapi_key_set ? `<button type="button" class="ghost" id="delKey">Quitar</button>` : ""}</div></div></div>
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
      </div><p class="error" id="serr" aria-live="polite"></p></div>
    <div class="panel" style="margin-top:12px"><h3>🩺 Diagnóstico</h3>
      <p class="small muted">Prueba cada fuente con «PS5 Slim Digital» sin guardar nada y guarda el HTML recibido en <code>data/user/snapshots/</code> para poder afinar los lectores.</p>
      <button type="button" class="secondary" id="diag">Ejecutar diagnóstico</button><div id="diagOut"></div></div>
    <div class="panel" style="margin-top:12px"><h3>💻 ¿Funciona en este ordenador?</h3>
      <p class="small muted">Revisa Python, dependencias, carpeta de datos, conexión con cada fuente y tu API key.</p>
      <button type="button" class="secondary" id="doctor">Comprobar instalación</button><div id="docOut"></div></div>
    <div class="panel" style="margin-top:12px"><h3>📦 Llevar mis datos a otro ordenador</h3>
      <p class="small muted">Tu perfil, ajustes, precios, histórico y cupones viven en <code>data/user/</code>, que no se sube a GitHub. Descarga una copia y restáurala en el otro ordenador.</p>
      <div class="actions" style="justify-content:flex-start">
        <label class="small"><input type="checkbox" id="withKey"> incluir API key</label>
        <button type="button" class="secondary" id="export">⬇️ Descargar copia</button>
        <label class="secondary-btn">⬆️ Restaurar copia<input type="file" id="import" accept="application/json" class="sr-only"></label>
      </div><p class="small" id="bkOut" aria-live="polite"></p></div>`;

  let pfT;
  const pfSave = () => { clearTimeout(pfT); pfT = setTimeout(async () => {
    const body = { ...(state.profile || {}), uses: [...uses], budget_monitor: +$("#pf-bm").value, budget_console: +$("#pf-bc").value };
    try { state.profile = await api("/api/profile", { method: "PUT", body }); state.monQuery = null; toast("Gustos guardados"); }
    catch (e) { toast("No se pudo guardar: " + e.message, { type: "error" }); }
  }, 600); };
  document.querySelectorAll("#pf-uses .chip").forEach((b) => b.onclick = () => {
    uses.has(b.dataset.v) ? uses.delete(b.dataset.v) : uses.add(b.dataset.v);
    b.classList.toggle("sel"); b.setAttribute("aria-pressed", String(b.classList.contains("sel"))); pfSave(); });
  $("#pf-bm").oninput = (e) => { $("#pf-bmv").textContent = eur(+e.target.value); pfSave(); };
  $("#pf-bc").oninput = (e) => { $("#pf-bcv").textContent = eur(+e.target.value); pfSave(); };
  $("#vtop").onchange = (e) => save({ verify_top: Math.max(0, Math.min(20, +e.target.value || 0)) });
  $("#cacheh").onchange = (e) => save({ serpapi_cache_hours: Math.max(0, Math.min(72, +e.target.value || 0)) });
  $("#rlinks").onchange = (e) => save({ resolve_links: Math.max(0, Math.min(10, +e.target.value || 0)) });
  $("#doctor").onclick = async (e) => {
    e.target.disabled = true; $("#docOut").innerHTML = skeleton("lines", { n: 5, label: "Comprobando la instalación…" });
    try {
      const r = await api("/api/doctor");
      const ic = { ok: "✅", warn: "⚠️", error: "❌" };
      $("#docOut").innerHTML = `<p><b>${esc(r.summary)}</b></p><ul class="reasons">${r.checks.map((c) =>
        `<li style="padding-left:0">${ic[c.status]} <b>${esc(c.name)}</b>: ${esc(c.detail)}${c.fix ? `<div class="small muted">→ ${esc(c.fix)}</div>` : ""}</li>`).join("")}</ul>`;
      announce(r.summary);
    } catch (err) { $("#docOut").innerHTML = `<p class="error" role="alert">${esc(err.message)}</p>`; }
    e.target.disabled = false;
  };
  $("#export").onclick = async () => {
    const data = await api(`/api/backup?include_key=${$("#withKey").checked}`);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = `findgnga-copia-${data.exported_at.slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
    $("#bkOut").textContent = "Copia descargada" + ($("#withKey").checked ? " (incluye tu API key: guárdala en sitio seguro)" : "") + ".";
    toast("Copia descargada");
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
    try {
      state.settings = await api("/api/settings", { method: "PUT", body }); state.live = {};
      const c = $("#cost"); if (c) c.textContent = serpCost(state.settings);
      $("#serr").textContent = ""; toast("Ajustes guardados");
      return true;
    } catch (e) { $("#serr").textContent = e.message; toast("No se pudo guardar: " + e.message, { type: "error" }); return false; }
  };
  $("#saveKey").onclick = async () => {
    const k = $("#key").value.trim();
    if (!k) { $("#serr").textContent = "Pega primero la API key"; $("#key").focus(); return; }
    if (await save({ serpapi_key: k })) { await viewSettings(); $("#key")?.focus(); }
  };
  $("#delKey") && ($("#delKey").onclick = async () => { if (await save({ serpapi_key: "" })) { await viewSettings(); $("#key")?.focus(); } });
  app.querySelectorAll("[data-prov]").forEach((c) => c.onchange = () => save({ providers: { ...state.settings.providers, [c.dataset.prov]: c.checked } }));
  $("#age").onchange = (e) => save({ max_offer_age_days: +e.target.value || 3 });
  $("#used").onchange = (e) => save({ include_used: e.target.checked });
  $("#diag").onclick = async (e) => {
    e.target.disabled = true; $("#diagOut").innerHTML = skeleton("lines", { n: 6, label: "Probando fuentes… (hasta ~30 s)" });
    announce("Probando fuentes, puede tardar hasta 30 segundos");
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

const VIEWS = { profile: () => go("desk"), monitors: viewMonitors, ps5: viewPS5, shopcheck: viewShopCheck, when: viewWhen, promos: viewPromos, settings: viewSettings };
const VIEW_ORDER = ["desk", "accessories", "monitors", "ps5", "shopcheck", "when", "promos", "settings"];
const VIEW_TITLES = { desk: "Mi escritorio", accessories: "Accesorios", monitors: "Monitores", ps5: "PS5", shopcheck: "¿Es fiable esta tienda?",
  when: "Cuándo comprar", promos: "Cupones", settings: "Ajustes" };
let navSeq = 0;

/** Coloca la píldora bajo la pestaña activa (instant: sin transición, p. ej. dentro de una View Transition). */
function placePill({ instant = false } = {}) {
  const pill = $("#tabPill"), a = $("#tabs a[aria-current='page']");
  if (!pill) return;
  if (!a) { pill.classList.remove("ready"); return; }
  const jump = instant || !pill.classList.contains("ready");
  pill.classList.toggle("instant", jump);
  pill.style.transform = `translate(${a.offsetLeft}px, ${a.offsetTop}px)`;
  pill.style.width = `${a.offsetWidth}px`; pill.style.height = `${a.offsetHeight}px`;
  pill.classList.add("ready");
  if (jump) { void pill.offsetWidth; pill.classList.remove("instant"); }
}
function setActiveTab(view, opts) {
  document.querySelectorAll("#tabs a[data-view]").forEach((a) => {
    if (a.dataset.view === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  placePill(opts);
  // En móvil la barra se desplaza en horizontal: que la pestaña activa quede a la vista
  const nav = $("#tabs"), a = nav?.querySelector("[aria-current='page']");
  if (a && nav.scrollWidth > nav.clientWidth) {
    const l = a.offsetLeft - 8, r = a.offsetLeft + a.offsetWidth + 32;
    if (l < nav.scrollLeft || r > nav.scrollLeft + nav.clientWidth)
      nav.scrollTo({ left: Math.max(0, l - 24), behavior: reducedMotion() || opts?.instant ? "auto" : "smooth" });
  }
}
function waitFor(test, ms = 400) {
  return new Promise((resolve) => {
    if (test()) return resolve(true);
    const t0 = performance.now();
    const tick = () => test() ? resolve(true) : performance.now() - t0 > ms ? resolve(false) : setTimeout(tick, 16);
    setTimeout(tick, 16);
  });
}
function focusHeading() {
  const h = app.querySelector("h1");
  if (!h) { app.focus({ preventScroll: true }); return; }
  h.setAttribute("tabindex", "-1");
  h.focus({ preventScroll: true });
}

function go(view, { focus = true } = {}) {
  if (view === "profile" || !VIEWS[view]) view = "desk";
  const prev = state.view;
  if (state.desk3d) { state.desk3d.dispose(); state.desk3d = null; }
  const dir = prev && VIEW_ORDER.indexOf(view) < VIEW_ORDER.indexOf(prev) ? "back" : "forward";
  state.view = view;
  if (view === "monitors") state.monQuery = null;
  if (location.hash.slice(1) !== view) location.hash = view;
  const html = document.documentElement;
  html.dataset.view = view;
  html.dataset.navDir = dir;
  document.title = `${VIEW_TITLES[view] || "FindGnga"} · FindGnga`;
  const seq = ++navSeq;
  const useVT = !!document.startViewTransition && !!prev && !document.hidden;

  const update = async () => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    setActiveTab(view, { instant: useVT });
    delete app.dataset.enter;
    app.setAttribute("aria-busy", "true");
    app.innerHTML = skeleton("view", { label: "Cargando…" });
    let ret;
    try { ret = VIEWS[view](); } catch (e) { ret = Promise.reject(e); }
    Promise.resolve(ret).catch((e) => {
      if (seq === navSeq) app.innerHTML = `<h1>${esc(VIEW_TITLES[view] || "Error")}</h1><p class="error">No se pudo cargar: ${esc(e.message)}</p>`;
    }).finally(() => { if (seq === navSeq) app.removeAttribute("aria-busy"); });
    await waitFor(() => app.querySelector("h1"), 350);   // las vistas asíncronas pintan su título tras la primera petición
  };
  const after = () => {
    if (seq !== navSeq) return;
    if (focus && prev) focusHeading();
  };
  if (useVT) {
    const vt = document.startViewTransition(update);
    vt.ready.catch(() => {}); vt.finished.catch(() => {});
    vt.updateCallbackDone.then(after, after);
  } else {
    update().then(() => {
      if (seq !== navSeq) return;
      app.dataset.enter = prev ? dir : "up";
      clearTimeout(go._t);
      go._t = setTimeout(() => { if (seq === navSeq) delete app.dataset.enter; }, MOTION.dur.slower + 6 * 36 + 200);
      after();
    });
  }
}

document.querySelectorAll("#tabs a[data-view]").forEach((a) => a.addEventListener("click", (e) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;  // abrir en otra pestaña sigue funcionando
  e.preventDefault();
  if (a.dataset.view !== state.view) go(a.dataset.view);
  else focusHeading();
}));
$("#skip")?.addEventListener("click", (e) => { e.preventDefault(); focusHeading(); });
// La dirección (#monitors…) y los botones atrás/adelante del navegador también cambian de sección
window.addEventListener("hashchange", () => {
  const v = location.hash.slice(1);
  if (VIEWS[v] && v !== state.view) go(v);
});
// Píldora: recolocar al cambiar el tamaño de la barra (ventana, fuentes, zoom)
if (window.ResizeObserver) {
  new ResizeObserver(() => placePill({ instant: true })).observe($("#tabs"));
  const bar = $(".topbar");
  new ResizeObserver(() => document.documentElement.style.setProperty("--topbar-h", `${Math.round(bar.getBoundingClientRect().bottom)}px`)).observe(bar);
}
document.fonts?.ready.then(() => placePill({ instant: true }));
// Selector de tema
(function initTheme() {
  const pref = themePref();
  document.querySelectorAll("#themeSwitch input").forEach((r) => {
    r.checked = r.value === pref;
    r.addEventListener("change", () => { if (r.checked) setTheme(r.value); });
  });
})();
// Deslizadores en euros: texto para el lector de pantalla («450,00 €» en vez de «450»)
document.addEventListener("input", (e) => {
  const r = e.target;
  if (r.matches?.("input[type='range'][data-unit='eur']")) r.setAttribute("aria-valuetext", eur(+r.value));
});

(async function init() {
  app.innerHTML = skeleton("view", { label: "Conectando con FindGnga…" });
  try {
    [state.profile, state.catalog, state.settings] = await Promise.all([api("/api/profile"), api("/api/catalog"), api("/api/settings")]);
  } catch (e) {
    app.innerHTML = `<h1>FindGnga</h1><p class="error" role="alert">No se pudo conectar con el servidor: ${esc(e.message)}</p>`;
    return;
  }
  const hash = location.hash.slice(1);
  const free = ["settings", "desk", "accessories"];
  go(VIEWS[hash] && (state.profile.devices?.length || free.includes(hash)) ? hash : "desk");
})();
