/* FindGnga – escritorio virtual en 3D (Three.js r160, sin build).
 *
 * Todo a escala real: la mesa sale de `table` (cm: ancho, fondo, alto, grosor, forma, patas, material)
 * y cada objeto de sus medidas reales (`dims_auto` del servidor + `dims` corregidas a mano, en cm).
 * Unidades en la escena: metros. x a la derecha, z hacia el usuario, y hacia arriba. El origen es el
 * centro del tablero principal; cada objeto tiene su huella centrada en (pos.x, pos.z), igual que
 * desk.parts_for en el servidor (que es quien dice si algo sobresale o choca: POST /api/desk/fit).
 *
 *   const d = Desk3D.mount(container, { onSelect, onHover, onMove, onMeasures, label, describedBy });
 *   d.setTable(table) · d.setStyle(style) · d.update(items)
 *   d.select(id) · d.focus(id) · d.rotate(id, rad) · d.nudge(id, dx, dz) · d.setPos(id, {x, z, rot})
 *   d.cameraPreset("iso"|"front"|"top"|"side") · d.toggleMeasures(on?) · d.markIssues(issues)
 *   d.describe() → [{id, pos, span, orient, auto}] · d.preview(item) · d.snapshot() · d.dispose()
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/RoomEnvironment.js";

/* Alto y grosor del tablero (m): cambian con la mesa; los modelos los leen al construirse */
let DESK_H = 0.74, DESK_T = 0.025;
const V3 = THREE.Vector3;
const reduceMQ = matchMedia("(prefers-reduced-motion: reduce)");
const reducedMotion = () => (window.FG?.reducedMotion ? window.FG.reducedMotion() : reduceMQ.matches);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round3 = (v) => Math.round(v * 1000) / 1000;
const cm = (v) => (+v || 0) / 100;
const wrapRot = (r) => { const t = Math.PI * 2; let a = ((r % t) + t) % t; if (a > Math.PI) a -= t; return a; };

/* ------------------------------------------------------------------ colores y materiales */

export const NAMED_COLORS = {
  silver: 0xc9ccd1, space_gray: 0x6b6e73, space_black: 0x2e2f33, midnight: 0x2c3340, starlight: 0xe3dccf,
  sky_blue: 0xb7cbe0, gold: 0xe3cfa6, black: 0x1a1b1e, white: 0xf2f2f0, graphite: 0x3d3f44, blue: 0x3b6fd6,
  pink: 0xf2b8c6, green: 0x5f9e6e, purple: 0x8a6fcf, red: 0xd2413a, orange: 0xf08a3c, yellow: 0xf2d16b,
};
const METALLIC = new Set(["silver", "space_gray", "space_black", "midnight", "starlight", "sky_blue", "gold", "graphite"]);

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...o });
const shared = (m) => { m.userData.shared = true; return m; };
const M = {
  black: shared(mat(0x16171a, { roughness: 0.4 })), dark: shared(mat(0x2c2e33, { roughness: 0.45, metalness: 0.2 })),
  silver: shared(mat(0xc9ccd1, { metalness: 0.75, roughness: 0.28 })), space: shared(mat(0x55585e, { metalness: 0.7, roughness: 0.3 })),
  white: shared(mat(0xf2f2f0, { roughness: 0.35 })), key: shared(mat(0x34363c, { roughness: 0.6 })),
  glass: shared(new THREE.MeshPhysicalMaterial({ color: 0x111318, roughness: 0.05, transmission: 0.2, transparent: true, opacity: 0.55 })),
  lens: shared(new THREE.MeshPhysicalMaterial({ color: 0x0a0c12, roughness: 0.05, metalness: 0.3, clearcoat: 1 })),
  blueLed: shared(new THREE.MeshBasicMaterial({ color: 0x4d8dff })), whiteLed: shared(new THREE.MeshBasicMaterial({ color: 0xffffff })),
  green: shared(mat(0x3f8f4e, { roughness: 0.7 })), soil: shared(mat(0x3a2a1e, { roughness: 1 })),
};

function hexOf(it) {
  if (typeof it.color === "string" && /^#?[0-9a-f]{6}$/i.test(it.color)) return { hex: parseInt(it.color.replace("#", ""), 16), metal: false };
  const n = it.specs?.color;
  if (n && NAMED_COLORS[n] != null) return { hex: NAMED_COLORS[n], metal: METALLIC.has(n) };
  return null;
}
/* Material del cuerpo: color propio del objeto (item.color / specs.color) o el de serie */
function bodyMat(it, def, o = {}) {
  const c = hexOf(it);
  if (!c) return mat(def, o);
  return mat(c.hex, c.metal ? { ...o, metalness: 0.7, roughness: 0.3 } : { ...o, metalness: Math.min(o.metalness ?? 0.05, 0.2) });
}
const isLightHex = (hex) => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.55; };

function box(w, h, d, m, r = 0) {
  const g = r > 0 ? new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w * 0.49, h * 0.49, d * 0.49)) : new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
function cyl(rt, rb, h, m, seg = 24) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
function rod(a, b, r, m) {
  const len = a.distanceTo(b);
  const mesh = cyl(r, r, len, m, 12);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new V3(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}
function at(mesh, x, y, z) { mesh.position.set(x, y, z); return mesh; }

/* Números pseudoaleatorios con semilla (texturas iguales en cada carga) */
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

/* ------------------------------------------------------------------ texturas */

const DESKS = {
  oak: { base: "#c9a173", line: "#8a6239", wood: true }, walnut: { base: "#6e4b33", line: "#3a2315", wood: true },
  bamboo: { base: "#d9c08e", line: "#a88a55", wood: true, bamboo: true },
  white: { base: "#eeeeea" }, black: { base: "#1f2023" }, gray: { base: "#8d8f93" },
};
const LEGS = { black: [0x2b2b2e, 0.6], white: [0xeeeeec, 0.2], silver: [0xbfc3c8, 0.85] };

function woodTex(kind) {
  const d = DESKS[kind] || DESKS.oak;
  return canvasTex(1024, 384, (g, W, H) => {
    g.fillStyle = d.base; g.fillRect(0, 0, W, H);
    const r = rng(kind.length * 977);
    for (let i = 0; i < 140; i++) {
      const y0 = r() * H, amp = 2 + r() * 7, f = 0.002 + r() * 0.006, ph = r() * 6;
      g.strokeStyle = d.line; g.globalAlpha = 0.04 + r() * 0.14; g.lineWidth = 0.6 + r() * 2.4;
      g.beginPath();
      for (let x = 0; x <= W; x += 16) g.lineTo(x, y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1) * amp * 0.3);
      g.stroke();
    }
    if (d.bamboo) { g.globalAlpha = 0.25; for (let x = 60; x < W; x += 170 + r() * 60) { g.fillStyle = d.line; g.fillRect(x, 0, 3, H); } }
    g.globalAlpha = 1;
  });
}

const FLOORS = {
  wood: (g, W, H) => {
    const r = rng(7), ph = H / 8;
    for (let row = 0; row < 8; row++) {
      let x = -r() * 256;
      while (x < W) {
        const len = 200 + r() * 180, l = 52 + r() * 14;
        g.fillStyle = `hsl(30 32% ${l}%)`; g.fillRect(x, row * ph, len, ph);
        g.globalAlpha = 0.12; g.strokeStyle = "#5a3b22";
        for (let k = 0; k < 6; k++) { g.beginPath(); const y = row * ph + r() * ph; g.moveTo(x, y); g.lineTo(x + len, y + (r() - 0.5) * 6); g.stroke(); }
        g.globalAlpha = 0.35; g.fillStyle = "#3d2a1a"; g.fillRect(x, row * ph, 2, ph); g.globalAlpha = 1;
        x += len;
      }
      g.fillStyle = "rgba(40,25,15,.35)"; g.fillRect(0, row * ph, W, 2);
    }
  },
  concrete: (g, W, H) => {
    g.fillStyle = "#a9a8a4"; g.fillRect(0, 0, W, H);
    const r = rng(3);
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${r() > 0.5 ? "255,255,255" : "40,40,40"},${r() * 0.07})`; g.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 3); }
  },
  carpet: (g, W, H) => {
    g.fillStyle = "#8b8378"; g.fillRect(0, 0, W, H);
    const r = rng(5);
    for (let i = 0; i < 16000; i++) { g.fillStyle = `rgba(${r() > 0.5 ? "255,250,240" : "30,25,20"},${r() * 0.1})`; g.fillRect(r() * W, r() * H, 1, 1 + r() * 2); }
  },
  tiles: (g, W, H) => {
    const r = rng(11);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { g.fillStyle = `hsl(40 8% ${80 + r() * 5}%)`; g.fillRect(i * W / 2, j * H / 2, W / 2, H / 2); }
    g.fillStyle = "#9a958c"; for (let k = 0; k <= 2; k++) { g.fillRect(k * W / 2 - 2, 0, 4, H); g.fillRect(0, k * H / 2 - 2, W, 4); }
  },
};

/* Fondo de pantalla de escritorio (gradiente + motivo + barra de menús + dock) */
const WALLPAPERS = {
  sunset: ["#ffb36b", "#e2557a", "#3b2a6b"], ocean: ["#7fe3ff", "#1f7fd1", "#0b2a5a"],
  forest: ["#d7eeb0", "#4f9a5c", "#14352a"], aurora: ["#0b1030", "#163a6b", "#070b1c"], mono: ["#4a4d55", "#26282d", "#131417"],
};
function wallpaperTex(name, label, ratio) {
  const cols = WALLPAPERS[name] || WALLPAPERS.sunset;
  const W = 768, H = clamp(Math.round(W / ratio), 180, 1100);
  return canvasTex(W, H, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, cols[0]); grd.addColorStop(0.55, cols[1]); grd.addColorStop(1, cols[2]);
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    const r = rng(name.length * 31);
    if (name === "sunset") {
      const s = g.createRadialGradient(W * 0.62, H * 0.6, 0, W * 0.62, H * 0.6, H * 0.3);
      s.addColorStop(0, "rgba(255,240,200,.95)"); s.addColorStop(1, "rgba(255,200,120,0)");
      g.fillStyle = s; g.fillRect(0, 0, W, H);
      for (const [y, a] of [[0.72, 0.55], [0.82, 0.8]]) { g.fillStyle = `rgba(40,20,60,${a})`; g.beginPath(); g.moveTo(0, H);
        for (let x = 0; x <= W; x += 24) g.lineTo(x, H * y + Math.sin(x * 0.01 + y * 9) * H * 0.05 + (r() - 0.5) * 6); g.lineTo(W, H); g.fill(); }
    } else if (name === "ocean") {
      for (let k = 0; k < 6; k++) { g.fillStyle = `rgba(255,255,255,${0.05 + k * 0.02})`; g.beginPath(); g.moveTo(0, H);
        for (let x = 0; x <= W; x += 16) g.lineTo(x, H * (0.5 + k * 0.08) + Math.sin(x * 0.012 + k) * H * 0.03); g.lineTo(W, H); g.fill(); }
    } else if (name === "forest") {
      for (const [y, c] of [[0.55, "rgba(70,130,80,.6)"], [0.68, "rgba(35,90,55,.8)"], [0.8, "rgba(15,50,35,.95)"]]) {
        g.fillStyle = c; g.beginPath(); g.moveTo(0, H);
        for (let x = 0; x <= W; x += 12) g.lineTo(x, H * y + Math.sin(x * 0.008 + y * 20) * H * 0.06 - Math.abs(Math.sin(x * 0.05)) * H * 0.03); g.lineTo(W, H); g.fill(); }
    } else if (name === "aurora") {
      for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.8})`; g.fillRect(r() * W, r() * H * 0.6, 1.5, 1.5); }
      for (const [c, off] of [["80,255,180", 0], ["90,180,255", 1.5], ["190,110,255", 3]]) {
        for (let x = 0; x < W; x += 3) {
          const y = H * (0.28 + 0.12 * Math.sin(x * 0.006 + off)), hh = H * (0.25 + 0.1 * Math.sin(x * 0.02 + off));
          const a = g.createLinearGradient(0, y - hh, 0, y); a.addColorStop(0, `rgba(${c},0)`); a.addColorStop(1, `rgba(${c},.16)`);
          g.fillStyle = a; g.fillRect(x, y - hh, 3, hh);
        }
      }
    } else {
      const s = g.createLinearGradient(0, 0, W, H); s.addColorStop(0, "rgba(255,255,255,.12)"); s.addColorStop(0.5, "rgba(255,255,255,0)");
      g.fillStyle = s; g.fillRect(0, 0, W, H);
    }
    g.fillStyle = "rgba(255,255,255,.2)"; g.fillRect(0, 0, W, Math.max(6, H * 0.03));
    const dw = W * 0.34, dh = Math.max(14, H * 0.075), dx = (W - dw) / 2, dy = H - dh - H * 0.02;
    g.fillStyle = "rgba(255,255,255,.22)"; g.beginPath(); g.roundRect(dx, dy, dw, dh, dh * 0.3); g.fill();
    const icons = ["#ff6b5a", "#ffc24b", "#5fd38d", "#4aa3ff", "#a27bff", "#ff7ad9", "#e9e9ef"];
    const isz = dh * 0.7, step = dw / icons.length;
    icons.forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.roundRect(dx + step * i + (step - isz) / 2, dy + (dh - isz) / 2, isz, isz, isz * 0.25); g.fill(); });
    if (label) {
      g.fillStyle = "rgba(255,255,255,.8)"; g.font = `600 ${Math.round(Math.max(10, H * 0.045))}px -apple-system, Segoe UI, sans-serif`;
      g.textBaseline = "top"; g.fillText(String(label).slice(0, 40), W * 0.03, Math.max(8, H * 0.05));
    }
  });
}
function screenMat(wallpaper, label, ratio) {
  const map = wallpaperTex(wallpaper, label, ratio);
  const m = new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.85, roughness: 0.25, metalness: 0 });
  m.userData.screen = true;
  return m;
}

/* ------------------------------------------------------------------ medidas reales (cm) */

const ASPECT = { "16:9": 16 / 9, "16:10": 1.6, "21:9": 64 / 27, "32:9": 32 / 9, "3:2": 1.5, "4:3": 4 / 3 };
function panelCm(diag, ratio) { const h = (diag * 2.54) / Math.sqrt(1 + ratio * ratio); return [h * ratio, h]; }

/* Medidas típicas si el servidor aún no ha mandado `dims_auto` (copia resumida de devices.dims) */
function fallbackDims(it) {
  const s = it.specs || {}, t = it.type;
  if (t === "monitor") {
    const ratio = s.res_w && s.res_h ? s.res_w / s.res_h : ASPECT[s.aspect] || 16 / 9;
    const [pw, ph] = panelCm(+s.size_in || 27, ratio);
    const curved = !!s.curved || s.aspect === "32:9";
    const R = curved ? (s.aspect === "32:9" ? 100 : s.aspect === "21:9" ? 180 : 150) : 0;
    let chord = pw, sag = 0;
    if (R) { const th = pw / R; chord = 2 * R * Math.sin(th / 2); sag = R * (1 - Math.cos(th / 2)); }
    const v = (s.refresh_hz || 60) >= 144 || curved, w = chord + 1.6;
    const sd = s.aspect === "32:9" ? 40 : v ? 23 : 20, bt = 4.5 + sag * 0.6;
    return { w, h: 10 + ph + 2.3, d: Math.max(sd, bt + sag), panel_w: pw, panel_h: ph, bezel: 0.8, chin: 1.5, lift: 10, body_t: bt,
      stand: v ? "v" : "plate", stand_w: v ? clamp(w * 0.4, 28, 45) : clamp(w * 0.38, 18, 28), stand_d: sd,
      ...(R ? { curve_r: R * 10, sagitta: sag } : {}), approx: true, src: "deducido" };
  }
  if (t === "laptop") {
    const inch = +s.screen_in || (s.platform === "mac" ? 14 : 15.6);
    const [pw, ph] = panelCm(inch, inch >= 15 ? 16 / 9 : 1.6);
    return { w: pw + 2.2, d: (pw + 2.2) * 0.69, h: 1.8, panel_w: pw, panel_h: ph, approx: true, src: "deducido" };
  }
  if (t === "desktop") {
    if (s.platform === "mac" && s.model_line === "imac") {
      const [pw, ph] = panelCm(23.5, 16 / 9);
      return { w: 54.7, h: 46.1, d: 14.7, panel_w: pw, panel_h: ph, bezel: 1.35, chin: 4.4, lift: 46.1 - ph - 5.75, body_t: 1.15,
        stand: "imac", stand_w: 13, stand_d: 14.7, src: "Apple" };
    }
    if (s.platform === "mac") return s.model_line === "studio" ? { w: 19.7, d: 19.7, h: 9.5 } : (s.chip_gen || 4) >= 4 ? { w: 12.7, d: 12.7, h: 5 } : { w: 19.7, d: 19.7, h: 3.6 };
    return { w: 21, h: 46, d: 45, floor: true, approx: true, src: "deducido" };
  }
  if (t === "ps5") {
    const m = s.model || (s.edition === "pro" ? "pro" : "slim"), dig = s.edition === "digital";
    return m === "fat" ? { w: dig ? 9.2 : 10.4, h: 39, d: 26 } : m === "pro" || s.edition === "pro" ? { w: 8.9, h: 38.8, d: 21.6 } : { w: dig ? 8 : 9.6, h: 35.8, d: 21.6 };
  }
  if (t === "keyboard") {
    const K = { full: [44, 14], tkl: [36, 13.5], 75: [32, 13], 60: [29.5, 10.5], compact: [28, 12] };
    const [w, d] = K[s.size || (s.mechanical ? "tkl" : "full")] || K.full;
    return { w, d, h: s.mechanical ? 4 : 2.4, approx: true, src: "deducido" };
  }
  if (t === "tablet") { const [pw, ph] = panelCm(+s.size_in || 11, 1.43); return { w: pw + 1.4, d: ph + 1.4, h: 0.6, approx: true, src: "deducido" }; }
  const T = {
    mouse: s.vertical ? [7, 10.8, 7.1] : s.trackpad ? [16, 11.5, 1.1] : s.ergonomic ? [8.4, 12.5, 5.1] : [6.5, 11.8, 3.9],
    phone: [7.1, 14.7, 0.8], headset: s.form === "in_ear" ? [6, 4.5, 2.2] : [17.5, 8.5, 20], light: [45, 9, 3], webcam: [9.4, 2.6, 2.9],
    hub: s.kind === "dock" ? [4.3, 13.1, 14] : [11.5, 4.5, 1.5], speakers: [10, 12, 17], arm: [7, 9, 45], mousepad: [+s.w_cm || 30, +s.d_cm || 25, 0.3],
  };
  const [w, d, h] = T[t] || [20, 20, 5];
  return { w, d, h, approx: true, src: "deducido" };
}

/* Medidas automáticas + las corregidas a mano (igual que devices.resolve_dims) */
export function dimsOf(it) {
  const out = { ...(it.dims_auto || fallbackDims(it)) };
  const o = {};
  for (const k of ["w", "h", "d"]) {
    const v = it.dims?.[k];
    if (v != null && v !== "" && Number.isFinite(+v) && +v > 0) o[k] = clamp(+v, 0.3, 320);
  }
  if (!Object.keys(o).length) return out;
  if (out.panel_h != null && out.lift != null) {           // monitor / iMac: el ancho cambia el marco, el alto el pie
    if (o.w != null) out.bezel = Math.max(0.2, (o.w - (out.panel_w ?? o.w)) / 2);
    if (o.h != null) out.lift = Math.max(0, o.h - out.panel_h - (out.bezel ?? 0.8) - (out.chin ?? 1.5));
    if (o.d != null) out.stand_d = o.d;
  }
  return Object.assign(out, o, { custom: true });
}

const LID_TILT = THREE.MathUtils.degToRad(20);   // tapa del portátil abierta a 110° (como desk.LID_TILT)
const HELD_LIFT = 0.17;                           // pantalla en un brazo: 17 cm sobre la mesa

/* ------------------------------------------------------------------ modelos (huella centrada en el origen) */

/* Pie del monitor con su forma real */
function monitorFoot(g, kind, sw, sd, zNeck, m) {
  if (kind === "v") {
    for (const sx of [-1, 1]) {
      const ax = 0, az = zNeck, bx = sx * sw / 2 * 0.92, bz = sd / 2 - 0.015, len = Math.hypot(bx - ax, bz - az);
      const leg = at(box(0.028, 0.012, len, m, 0.005), (ax + bx) / 2, DESK_H + 0.006, (az + bz) / 2);
      leg.rotation.y = Math.atan2(bx - ax, bz - az); g.add(leg);
    }
    return;
  }
  if (kind === "arc") {
    const r = sw / 2;
    const half = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.012, 40, 1, false, -Math.PI / 2, Math.PI), m);
    half.scale.z = sd / r; half.position.set(0, DESK_H + 0.006, -sd / 2); half.castShadow = half.receiveShadow = true;
    g.add(half); return;
  }
  if (kind === "round") { const r = Math.min(sw, sd) / 2; g.add(at(cyl(r, r, 0.01, m, 40), 0, DESK_H + 0.005, 0)); return; }
  const t = kind === "apple" || kind === "imac" ? 0.008 : 0.012;
  g.add(at(box(sw, t, sd, m, kind === "plate" ? 0.006 : 0.003), 0, DESK_H + t / 2, 0));
}

function monitor(it, ctx, dm) {
  const held = !!ctx.held, imac = dm.stand === "imac";
  const pw = cm(dm.panel_w ?? dm.w - 1.6), ph = cm(dm.panel_h ?? dm.h * 0.55);
  const bz = cm(dm.bezel ?? 0.8), chin = cm(dm.chin ?? 1.5), bt = Math.max(0.01, cm(dm.body_t ?? 5)), sag = cm(dm.sagitta || 0);
  const lift = held ? HELD_LIFT : cm(dm.lift ?? 10), depth = bt + sag, D = Math.max(cm(dm.d), depth);
  const pz = held ? 0 : -D / 2 + Math.max(0, (D - depth) * 0.25) + depth / 2;   // igual que desk.parts_for
  const front = pz + depth / 2, mid = front - sag, backZ = front - depth;
  const apple = dm.stand === "apple" || /studio display|pro display/i.test(it.model || "");
  const body = bodyMat(it, imac ? 0x9fc0e6 : apple ? 0xc9ccd1 : 0x17181b,
    imac ? { roughness: 0.32, metalness: 0.4 } : apple ? { metalness: 0.75, roughness: 0.28 } : { roughness: 0.42, metalness: 0.15 });
  const standM = apple || imac || hexOf(it) ? body : M.space;
  const fw = pw + 2 * bz, fh = ph + bz + chin, y0 = DESK_H + lift, cy = y0 + chin + ph / 2;
  const scrM = screenMat(ctx.wallpaper, it.model, pw / ph);
  const shell = Math.min(0.012, bt * 0.5);
  const g = new THREE.Group();
  if (sag > 0.002) {
    // curvo: la pantalla es un trozo de cilindro de radio curve_r con el eje del lado del usuario
    const R = (dm.curve_r || 1500) / 1000, th = pw / R, thF = fw / R, axis = mid + R;
    body.side = THREE.DoubleSide;
    const frameM = new THREE.Mesh(new THREE.CylinderGeometry(R + shell, R + shell, fh, 72, 1, true, Math.PI - thF / 2, thF), body);
    frameM.position.set(0, y0 + fh / 2, axis); frameM.castShadow = true; g.add(frameM);
    scrM.side = THREE.BackSide; scrM.map.wrapS = THREE.RepeatWrapping; scrM.map.repeat.x = -1;   // por dentro se vería al revés
    const scr = new THREE.Mesh(new THREE.CylinderGeometry(R, R, ph, 72, 1, true, Math.PI - th / 2, th), scrM);
    scr.position.set(0, cy, axis); g.add(scr);
    const hb = Math.max(0.02, bt - shell);
    g.add(at(box(Math.min(fw * 0.45, 0.5), fh * 0.62, hb, body, 0.015), 0, cy - ph * 0.04, mid - shell - hb / 2));
  } else {
    g.add(at(box(fw, fh, shell, body, 0.003), 0, y0 + fh / 2, front - shell / 2));
    if (imac) g.add(at(new THREE.Mesh(new THREE.PlaneGeometry(pw + 2 * bz - 0.004, ph + 2 * bz - 0.004), M.white), 0, cy, front + 0.0002));
    g.add(at(new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), scrM), 0, cy, front + 0.0004));
    const hb = bt - shell;
    if (hb > 0.003) g.add(at(box(fw * 0.78, fh * 0.7, hb, body, Math.min(0.012, hb * 0.45)), 0, cy - ph * 0.04, front - shell - hb / 2));
    if (apple || imac) g.add(at(new THREE.Mesh(new THREE.CircleGeometry(0.018, 24), M.silver), 0, cy, backZ - 0.0005)).rotation.y = Math.PI;
  }
  if (held) g.add(at(box(0.1, 0.1, 0.012, M.dark, 0.003), 0, cy, backZ - 0.006));
  else {
    const kind = dm.stand || "plate", sw = cm(dm.stand_w ?? dm.w * 0.4), sd = cm(dm.stand_d ?? dm.d);
    const zN = clamp(backZ - 0.012, -sd / 2 + 0.015, sd / 2 - 0.015);
    if (kind === "apple" || kind === "imac") {
      const a = new V3(0, DESK_H + 0.006, clamp(zN + sd * 0.45, -sd / 2, sd / 2 - 0.02)), b = new V3(0, cy - fh * 0.1, backZ - 0.004);
      const blade = box(Math.min(sw, 0.16) * 0.9, a.distanceTo(b), 0.012, standM, 0.004);
      blade.position.copy(a).add(b).multiplyScalar(0.5); blade.rotation.x = Math.atan2(b.z - a.z, b.y - a.y); g.add(blade);
    } else {
      const nh = cy - DESK_H;
      g.add(at(box(kind === "v" ? 0.05 : 0.06, nh, 0.025, standM, 0.008), 0, DESK_H + nh / 2, zN));
    }
    monitorFoot(g, kind, sw, sd, zN, standM);
  }
  g.userData.size = { w: cm(dm.w), d: held ? depth : D, top: y0 + fh, topZ: mid - bt / 2, frontZ: mid, cy, h: fh, backZ, screenW: pw };
  return g;
}

function laptop(it, ctx, dm) {
  const s = it.specs || {}, mac = s.platform === "mac";
  const w = cm(dm.w), d = cm(dm.d), t = Math.max(0.008, cm(dm.h));
  const baseT = t * 0.68, lidT = Math.max(0.003, t - baseT);
  const pw = Math.min(cm(dm.panel_w ?? dm.w * 0.9), w * 0.97), ph = cm(dm.panel_h ?? dm.d * 0.85), lidH = ph + 0.015;
  const def = mac ? (s.model_line === "air" ? 0xc9ccd1 : 0x6b6e73) : 0x2c2e33;
  const body = bodyMat(it, def, mac ? { metalness: 0.72, roughness: 0.3 } : { roughness: 0.5, metalness: 0.2 });
  const g = new THREE.Group(), top = DESK_H + baseT;
  g.add(at(box(w, baseT, d, body, Math.min(0.006, baseT * 0.45)), 0, DESK_H + baseT / 2, 0));
  g.add(at(box(w * 0.88, 0.0008, d * 0.42, M.black), 0, top + 0.0002, -d * 0.1));
  const cols = 14, kw = (w * 0.86) / cols, rows = 6, kd = (d * 0.4) / rows;
  const keys = new THREE.InstancedMesh(new THREE.BoxGeometry(kw * 0.82, 0.0012, kd * 0.78), M.key, rows * cols);
  const m4 = new THREE.Matrix4(); let i = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
    keys.setMatrixAt(i++, m4.makeTranslation(-w * 0.43 + kw * (c + 0.5), top + 0.0008, -d * 0.1 - d * 0.2 + kd * (r + 0.5)));
  g.add(keys);
  g.add(at(box(w * 0.42, 0.0008, d * 0.3, mat(0x8b8e94, { roughness: 0.3, metalness: 0.3 })), 0, top + 0.0003, d * 0.27));
  const hinge = new THREE.Group(); hinge.position.set(0, top, -d / 2 + lidT); g.add(hinge);
  hinge.add(at(box(w, lidH, lidT, body, Math.min(0.004, lidT * 0.45)), 0, lidH / 2, -lidT / 2));
  hinge.add(at(new THREE.Mesh(new THREE.PlaneGeometry(w * 0.985, lidH * 0.98), M.black), 0, lidH / 2, 0.0003));
  hinge.add(at(new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), screenMat(ctx.wallpaper, it.model, pw / ph)), 0, lidH / 2 + 0.003, 0.0006));
  if (mac) { const logo = new THREE.Mesh(new THREE.CircleGeometry(0.012, 24), mat(0xe6e8eb, { metalness: 0.9, roughness: 0.15 })); logo.rotation.y = Math.PI; hinge.add(at(logo, 0, lidH / 2, -lidT - 0.0005)); }
  hinge.rotation.x = -LID_TILT;
  const tz = -d / 2 + lidT - lidH * Math.sin(LID_TILT);
  g.userData.size = { w, d, top: top + lidH * Math.cos(LID_TILT), topZ: tz, frontZ: tz + 0.004, screenW: pw, cy: top + lidH * 0.5 * Math.cos(LID_TILT), backZ: tz };
  return g;
}

function computer(it, ctx, dm) {
  const s = it.specs || {};
  if (dm.stand === "imac" || (s.platform === "mac" && s.model_line === "imac")) return monitor(it, { ...ctx, held: false }, { ...dm, stand: "imac" });
  const g = new THREE.Group();
  const W = cm(dm.w), H = cm(dm.h), D = cm(dm.d);
  if (!dm.floor) {
    const body = bodyMat(it, 0xc9ccd1, { metalness: 0.75, roughness: 0.28 });
    g.add(at(box(W, H, D, body, Math.min(0.02, H * 0.3)), 0, DESK_H + H / 2, 0));
    g.add(at(box(0.004, 0.004, 0.001, M.whiteLed), -W / 2 + 0.02, DESK_H + Math.min(0.012, H * 0.3), D / 2 + 0.001));
    for (const x of [0.012, 0.03]) g.add(at(box(0.009, 0.004, 0.001, M.black), x, DESK_H + Math.min(0.016, H * 0.4), D / 2 + 0.0005));
    g.userData.size = { w: W, d: D, top: DESK_H + H };
    return g;
  }
  // Torre de PC en el suelo, con cristal lateral y luz RGB
  const body = bodyMat(it, 0x141518, { roughness: 0.35, metalness: 0.3 });
  g.add(at(box(W, H, D, body, 0.01), 0, H / 2, 0));
  g.add(at(box(0.004, H * 0.86, D * 0.9, M.glass), -W / 2 - 0.002, H / 2, 0));
  [0xff5a1f, 0x7b5cff, 0x2ad1ff].forEach((c, i) => {
    const fan = new THREE.Mesh(new THREE.TorusGeometry(Math.min(0.052, H * 0.11), 0.006, 8, 32), new THREE.MeshBasicMaterial({ color: c }));
    fan.rotation.y = Math.PI / 2; fan.position.set(-W / 2 + 0.012, H * (0.22 + i * 0.28), D / 2 - 0.08); g.add(fan);
  });
  g.add(at(box(0.004, 0.04, D * 0.6, M.dark), -W / 2 + 0.03, H * 0.42, -0.02));
  g.add(at(box(0.003, 0.004, D * 0.6, new THREE.MeshBasicMaterial({ color: 0x7b5cff })), -W / 2 + 0.028, H * 0.42 - 0.022, -0.02));
  const glow = new THREE.PointLight(0xff6a2a, 0.6, 0.9); glow.position.set(-W / 2 - 0.1, H / 2, 0); glow.userData.kind = "pcglow"; g.add(glow);
  g.add(at(box(0.012, 0.012, 0.002, M.blueLed), 0.05, H - 0.04, D / 2 + 0.001));
  g.userData.size = { w: W, d: D, top: H, floor: true };
  return g;
}

function ps5(it, ctx, dm) {
  const s = it.specs || {}, ed = s.edition || "standard", model = s.model || (ed === "pro" ? "pro" : "slim");
  const W = cm(dm.w), H = cm(dm.h), D = cm(dm.d), lying = it.orient === "horizontal";
  const cover = bodyMat(it, 0xf3f3f1, { roughness: 0.38 });
  const g = new THREE.Group(), c = new THREE.Group(); g.add(c);
  const y0 = lying ? 0 : 0.006;
  c.add(at(box(W * 0.5, H * 0.95, D * 0.93, M.black, 0.01), 0, y0 + H * 0.475, 0));
  for (const sx of [-1, 1]) {
    if (model === "fat") {
      const p = at(box(W * 0.24, H * 1.0, D * 1.0, cover, 0.03), sx * W * 0.38, y0 + H * 0.5, 0); p.rotation.z = sx * 0.03; c.add(p);
    } else {
      const lowH = H * 0.76;
      c.add(at(box(W * 0.24, lowH, D, cover, 0.022), sx * W * 0.38, y0 + lowH / 2, 0));
      const gloss = cover.clone(); gloss.roughness = 0.08;
      c.add(at(box(W * 0.24, H - lowH - 0.003, D, gloss, 0.02), sx * W * 0.38, y0 + lowH + (H - lowH) / 2 + 0.0015, 0));
    }
    c.add(at(box(0.003, H * 0.7, D * 0.5, M.blueLed), sx * W * 0.255, y0 + H * 0.5, D * 0.2));
  }
  if (model === "pro") c.add(at(box(W * 1.02, 0.012, D * 1.01, M.black), 0, y0 + H * 0.5, 0));
  if (ed !== "digital") c.add(at(box(0.002, 0.004, D * 0.55, M.black), W * 0.5 + 0.0005, y0 + H * 0.2, 0));
  if (lying) { c.rotation.z = Math.PI / 2; c.position.set(H / 2, DESK_H + W / 2, 0); }
  else { c.add(at(cyl(W * 0.9, W * 0.9, 0.006, M.black, 32), 0, 0.003, 0)); c.position.y = DESK_H; }
  g.userData.size = lying ? { w: H, d: D, top: DESK_H + W } : { w: W, d: D, top: DESK_H + y0 + H };
  return g;
}

/* Filas del teclado en unidades de tecla (negativo = hueco) */
function kbRows(size) {
  const ones = (n) => Array(n).fill(1);
  const F = [1, -1, ...ones(4), -0.5, ...ones(4), -0.5, ...ones(4)];
  const main = [[...ones(13), 2], [1.5, ...ones(12), 1.5], [1.75, ...ones(11), 2.25], [2.25, ...ones(10), 2.75], [1.25, 1.25, 1.25, 6.25, 1.25, 1.25, 1.25, 1.25]];
  let rows = size === "60" ? main : [F, ...main];
  if (size === "tkl" || size === "full") {
    const nav = [[1, 1, 1], [1, 1, 1], [1, 1, 1], [-3], [-1, 1, -1], [1, 1, 1]];
    rows = rows.map((r, i) => [...r, -0.5, ...nav[i]]);
    if (size === "full") {
      const pad = [[-4], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, -1], [1, 1, 1, 1], [2, 1, 1]];
      rows = rows.map((r, i) => [...r, -0.5, ...pad[i]]);
    }
  }
  if (size === "75") rows = rows.map((r) => [...r, -0.25, 1]);
  return rows;
}

function keyboard(it, ctx, dm) {
  const s = it.specs || {}, mech = !!s.mechanical, size = s.size || (mech ? "tkl" : "full");
  const rows = kbRows(size), hasF = size !== "60";
  const w = cm(dm.w), d = cm(dm.d), totalH = Math.max(0.008, cm(dm.h));
  const units = Math.max(...rows.map((r) => r.reduce((a, b) => a + Math.abs(b), 0)));
  const pad = Math.min(0.01, w * 0.03), ux = (w - 2 * pad) / units, uz = (d - 2 * pad) / (rows.length + (hasF ? 0.25 : 0));
  const gap = Math.min(ux, uz) * 0.18;
  const baseH = totalH * (mech ? 0.6 : 0.62), keyH = Math.max(0.002, totalH - baseH);
  const base = bodyMat(it, mech ? 0x2a2c31 : 0x34363c, { roughness: 0.45, metalness: mech ? 0.2 : 0.35 });
  const keyM = mat(isLightHex(base.color.getHex()) ? 0xf0f0f2 : mech ? 0xdcdde0 : 0x26272b, { roughness: 0.55 });
  if (s.backlit) { keyM.emissive = new THREE.Color(0xffffff); keyM.emissiveIntensity = 0; keyM.userData.backlit = true; }
  const g = new THREE.Group();
  const b = at(box(w, baseH, d, base, Math.min(mech ? 0.006 : 0.004, baseH * 0.45)), 0, DESK_H + baseH / 2, 0);
  if (mech) b.rotation.x = 0.03;
  g.add(b);
  const total = rows.reduce((a, r) => a + r.filter((x) => x > 0).length, 0);
  const keys = new THREE.InstancedMesh(new RoundedBoxGeometry(ux - gap, keyH, uz - gap, 2, Math.min(0.002, keyH * 0.45)), keyM, total);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(); let i = 0;
  rows.forEach((r, ri) => {
    let x = (-units * ux) / 2;
    const z = -d / 2 + pad + uz * (ri + 0.5) + (hasF && ri > 0 ? uz * 0.25 : 0);
    for (const k of r) {
      const kw = Math.abs(k) * ux;
      if (k > 0) { m4.compose(new V3(x + kw / 2, DESK_H + baseH + keyH / 2 - (mech ? z * 0.03 : 0), z), q, new V3((kw - gap) / (ux - gap), 1, 1)); keys.setMatrixAt(i++, m4); }
      x += kw;
    }
  });
  keys.castShadow = true; g.add(keys);
  g.userData.size = { w, d, top: DESK_H + totalH };
  return g;
}

function mouse(it, ctx, dm) {
  const s = it.specs || {}, w = cm(dm.w), d = cm(dm.d), h = Math.max(0.005, cm(dm.h));
  const g = new THREE.Group();
  g.userData.size = { w, d, top: DESK_H + h };
  if (s.trackpad) { g.add(at(box(w, h, d, bodyMat(it, 0xd6d7d9, { metalness: 0.6, roughness: 0.3 }), Math.min(0.004, h * 0.45)), 0, DESK_H + h / 2, 0)); return g; }
  const body = bodyMat(it, 0x2c2e33, { roughness: 0.45, metalness: 0.15 });
  const dome = (sx, sy, sz, m = body) => {   // media esfera: no asoma por debajo de una mesa de cristal
    const o = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), m);
    o.scale.set(sx, sy, sz); o.castShadow = true; return o;
  };
  g.add(at(dome(w / 2, h, d / 2), 0, DESK_H, 0));
  if (s.vertical) { g.add(at(dome(0.006, 0.01, 0.012, M.silver), w * 0.25, DESK_H + h * 0.7, -d * 0.15)); return g; }
  g.add(at(box(0.0015, 0.004, d * 0.28, M.black), 0, DESK_H + h * 0.95, -d * 0.24));
  const wr = Math.min(0.007, h * 0.2);
  const wheel = cyl(wr, wr, 0.005, M.silver, 16); wheel.rotation.z = Math.PI / 2; g.add(at(wheel, 0, DESK_H + h * 0.93, -d * 0.18));
  if (s.ergonomic) g.add(at(dome(w * 0.16, h * 0.35, d * 0.25), -w * 0.45, DESK_H, d * 0.05));
  if (s.gaming) g.add(at(box(0.012, 0.002, 0.012, M.blueLed), 0, DESK_H + h * 0.75, d * 0.3));
  return g;
}

function phone(it, ctx, dm) {
  const s = it.specs || {}, w = cm(dm.w), d = cm(dm.d), h = Math.max(0.005, cm(dm.h));
  const g = new THREE.Group(), ios = s.os === "ios";
  const body = bodyMat(it, ios ? 0x55585e : 0x16171a, { metalness: 0.6, roughness: 0.3 });
  g.add(at(box(w, h, d, body, Math.min(0.01, h * 0.49)), 0, DESK_H + h / 2, 0));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.005, d - 0.006), screenMat(ctx.wallpaper, "", (w - 0.005) / (d - 0.006)));
  scr.rotation.x = -Math.PI / 2; g.add(at(scr, 0, DESK_H + h + 0.0003, 0));
  const cam = ios ? new THREE.Mesh(new THREE.CapsuleGeometry(0.0035, 0.012, 4, 12), M.black) : new THREE.Mesh(new THREE.CircleGeometry(0.0028, 16), M.black);
  if (ios) { cam.rotation.set(-Math.PI / 2, 0, Math.PI / 2); cam.scale.y = 0.4; } else cam.rotation.x = -Math.PI / 2;
  g.add(at(cam, 0, DESK_H + h + 0.0006, -d / 2 + 0.009));
  g.userData.size = { w, d, top: DESK_H + h };
  return g;
}

function tablet(it, ctx, dm) {
  const s = it.specs || {}, w = cm(dm.w), th = cm(dm.d), t = Math.max(0.004, cm(dm.h)), fd = Math.min(0.15, th), tilt = 0.3;
  const body = bodyMat(it, s.os === "android" ? 0x2c2e33 : 0x6b6e73, { metalness: 0.65, roughness: 0.3 });
  const g = new THREE.Group();
  g.add(at(box(w * 0.5, 0.006, fd, M.silver, 0.003), 0, DESK_H + 0.003, 0));
  const sup = at(box(w * 0.4, th * 0.55, 0.006, M.silver, 0.002), 0, DESK_H + th * 0.25, -fd * 0.25); sup.rotation.x = -0.35; g.add(sup);
  const tg = new THREE.Group(); tg.position.set(0, DESK_H + 0.008, fd * 0.2); tg.rotation.x = -tilt; g.add(tg);
  tg.add(at(box(w, th, t, body, Math.min(0.008, t * 0.49)), 0, th / 2, 0));
  tg.add(at(new THREE.Mesh(new THREE.PlaneGeometry(w - 0.004, th - 0.004), M.black), 0, th / 2, t / 2 + 0.0002));
  tg.add(at(new THREE.Mesh(new THREE.PlaneGeometry(w - 0.02, th - 0.02), screenMat(ctx.wallpaper, it.model, (w - 0.02) / (th - 0.02))), 0, th / 2, t / 2 + 0.0004));
  g.userData.size = { w, d: fd, top: DESK_H + 0.008 + th * Math.cos(tilt) };
  return g;
}

function hub(it, ctx, dm) {
  const s = it.specs || {}, w = cm(dm.w), d = cm(dm.d), h = cm(dm.h);
  const g = new THREE.Group();
  const body = bodyMat(it, 0x6b6e73, { metalness: 0.7, roughness: 0.3 });
  g.add(at(box(w, h, d, body, Math.min(0.008, Math.min(w, h) * 0.4)), 0, DESK_H + h / 2, 0));
  if (s.kind === "dock") {
    for (let k = 0; k < 4; k++) g.add(at(box(Math.min(0.009, w * 0.4), 0.004, 0.002, M.black), 0, DESK_H + h * (0.2 + k * 0.12), d / 2 + 0.001));
    g.add(at(box(0.004, 0.004, 0.002, M.whiteLed), 0, DESK_H + h * 0.85, d / 2 + 0.001));
  } else {
    for (let k = 0; k < 4; k++) g.add(at(box(0.0015, Math.min(0.005, h * 0.5), 0.009, M.black), w / 2 + 0.0006, DESK_H + h / 2, -d * 0.35 + k * d * 0.24));
    const curve = new THREE.CatmullRomCurve3([new V3(-w / 2, DESK_H + h / 2, 0), new V3(-w / 2 - 0.03, DESK_H + 0.004, 0.01), new V3(-w / 2 - 0.06, DESK_H + 0.003, -0.03)]);
    const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.003, 8), M.dark); cable.castShadow = true; g.add(cable);
  }
  g.userData.size = { w, d, top: DESK_H + h };
  return g;
}

function mousepad(it, ctx, dm) {
  const w = cm(dm.w), d = cm(dm.d), h = Math.max(0.001, cm(dm.h));
  const g = new THREE.Group();
  const top = bodyMat(it, 0x34363b, { roughness: 0.95 });
  const p = at(box(w, h, d, top, Math.min(0.0014, h * 0.45)), 0, DESK_H + h / 2, 0); p.castShadow = false; g.add(p);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.002, h * 0.85, d + 0.002), mat(isLightHex(top.color.getHex()) ? 0x9a9a9a : 0x55575c, { roughness: 0.9 }));
  edge.position.y = DESK_H + h * 0.42; edge.receiveShadow = true; g.add(edge);
  g.userData.size = { w, d, top: DESK_H + h, flat: true };
  return g;
}

function headset(it, ctx, dm) {
  const s = it.specs || {}, w = cm(dm.w), d = cm(dm.d), h = cm(dm.h);
  const g = new THREE.Group();
  const body = bodyMat(it, 0x16171a, { roughness: 0.4, metalness: 0.15 });
  if (s.form === "in_ear" || w <= 0.1) {
    const c = bodyMat(it, 0xf6f6f4, { roughness: 0.2 });
    g.add(at(box(w, h, d, c, Math.min(0.01, h * 0.45)), 0, DESK_H + h / 2, 0));
    g.add(at(box(w + 0.001, 0.0008, d + 0.001, M.dark), 0, DESK_H + h * 0.72, 0));
    g.add(at(box(0.003, 0.003, 0.001, M.whiteLed), 0, DESK_H + h * 0.4, d / 2 + 0.0005));
    g.userData.size = { w, d, top: DESK_H + h };
    return g;
  }
  // de diadema, colgados en su soporte (huella 12 × 12 cm, como desk.parts_for)
  const top = DESK_H + h + 0.08, rb = w / 2 - 0.02, cr = Math.min(0.05, d / 2), cupY = top - h + cr;
  g.add(at(cyl(0.055, 0.06, 0.012, M.dark, 32), 0, DESK_H + 0.006, 0));
  g.add(at(cyl(0.007, 0.007, top - DESK_H - 0.02, M.space, 12), 0, DESK_H + (top - DESK_H - 0.02) / 2, 0));
  const bandY = top - rb - 0.012;
  const band = new THREE.Mesh(new THREE.TorusGeometry(rb, 0.012, 12, 40, Math.PI), body); band.position.y = bandY; band.castShadow = true; g.add(band);
  const pad = new THREE.Mesh(new THREE.TorusGeometry(rb - 0.013, 0.008, 8, 32, Math.PI * 0.7), mat(0x3a3c42, { roughness: 0.9 }));
  pad.position.y = bandY; pad.rotation.z = Math.PI * 0.15; g.add(pad);
  for (const sx of [-1, 1]) {
    const cup = cyl(cr, cr, 0.034, body, 28); cup.rotation.z = Math.PI / 2; g.add(at(cup, sx * rb, cupY, 0));
    const cush = new THREE.Mesh(new THREE.TorusGeometry(cr * 0.67, cr * 0.29, 10, 24), mat(0x2b2c30, { roughness: 0.95 }));
    cush.rotation.y = Math.PI / 2; g.add(at(cush, sx * (rb - 0.018), cupY, 0));
    const yoke = Math.max(0.01, bandY - cupY - cr * 0.5);
    g.add(at(box(0.008, yoke, 0.012, M.space, 0.003), sx * rb, cupY + cr * 0.5 + yoke / 2, 0));
  }
  g.userData.size = { w: 0.12, d: 0.12, top: top + 0.012 };
  return g;
}

function speakers(it, ctx, dm) {
  const span = ctx.span || 0.45, w = cm(dm.w), d = cm(dm.d), h = cm(dm.h);
  const g = new THREE.Group();
  const body = bodyMat(it, 0x1c1d20, { roughness: 0.6 });
  for (const sx of [-1, 1]) {
    const s = new THREE.Group(); s.position.set(sx * span, 0, 0); s.rotation.y = -sx * 0.28; g.add(s);
    s.add(at(box(w, h, d, body, 0.008), 0, DESK_H + h / 2, 0));
    const wr = Math.min(0.036, w * 0.36);
    const woof = cyl(wr, wr * 0.83, 0.006, M.dark, 28); woof.rotation.x = Math.PI / 2; s.add(at(woof, 0, DESK_H + h * 0.35, d / 2 + 0.001));
    const tr = Math.min(0.013, w * 0.13);
    const tw = cyl(tr, tr * 0.77, 0.005, M.space, 20); tw.rotation.x = Math.PI / 2; s.add(at(tw, 0, DESK_H + h * 0.76, d / 2 + 0.001));
  }
  g.userData.span = span;
  g.userData.size = { w: span * 2 + w, d, top: DESK_H + h };
  return g;
}

function arm(it, ctx, dm) {
  const w = cm(dm.w), d = cm(dm.d), h = cm(dm.h);
  const g = new THREE.Group();
  const body = bodyMat(it, 0x1d1e21, { metalness: 0.5, roughness: 0.35 });
  const under = DESK_H - DESK_T;   // la pinza abraza el tablero
  g.add(at(box(w, 0.012, d, body, 0.004), 0, DESK_H + 0.006, 0));
  g.add(at(box(w, DESK_T + 0.05, 0.012, body, 0.003), 0, under - 0.04 + (DESK_T + 0.05) / 2 - 0.006, -d / 2 - 0.006));
  g.add(at(box(w, 0.012, d, body, 0.004), 0, under - 0.04, 0));
  g.add(at(cyl(0.006, 0.006, 0.035, M.space, 12), 0, under - 0.02, d * 0.1));
  g.add(at(cyl(0.018, 0.018, h, body, 20), 0, DESK_H + h / 2, 0));
  g.add(at(cyl(0.022, 0.022, 0.02, M.space, 20), 0, DESK_H + h, 0));
  g.userData.size = { w, d, top: DESK_H + h, poleTop: DESK_H + h - 0.03, body };
  return g;
}

function lightbar(it, ctx, dm) {
  const g = new THREE.Group(), host = ctx.host;
  const w = cm(dm.w), x0 = ctx.shift || 0;
  const top = host ? host.top : DESK_H + 0.01, zc = host ? host.topZ ?? 0 : 0, zf = host ? host.frontZ ?? zc : 0;
  const body = bodyMat(it, 0x55585e, { metalness: 0.7, roughness: 0.3 });
  const bar = cyl(0.013, 0.013, w, body, 20); bar.rotation.z = Math.PI / 2; g.add(at(bar, x0, top + 0.02, zf + 0.01));
  const led = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.95, 0.008), new THREE.MeshBasicMaterial({ color: 0xfff1d6 }));
  led.rotation.x = Math.PI / 2; g.add(at(led, x0, top + 0.0068, zf + 0.015));
  if (host) g.add(at(box(0.035, 0.03, Math.max(0.03, zf - zc + 0.04), M.black, 0.004), x0, top + 0.005, (zc + zf) / 2));
  const spot = new THREE.SpotLight(0xffe7c4, 5, 1.5, 0.85, 0.6, 1.2);
  spot.position.set(x0, top + 0.01, zf + 0.03); spot.target.position.set(x0, DESK_H, zf + 0.4);
  spot.userData.kind = "bar";
  g.add(spot, spot.target);
  g.userData.size = { w, d: cm(dm.d), top: top + 0.04 };
  return g;
}

function webcam(it, ctx, dm) {
  const g = new THREE.Group(), host = ctx.host;
  const w = cm(dm.w), h = cm(dm.h), d = cm(dm.d), x0 = ctx.shift || 0;
  const top = host ? host.top : DESK_H, zc = host ? host.topZ ?? 0 : 0, zf = host ? host.frontZ ?? zc : 0;
  const body = bodyMat(it, 0x16171a, { roughness: 0.35 });
  const y = host ? top + h / 2 + 0.002 : DESK_H + 0.12;
  g.add(at(box(w, h, d, body, Math.min(0.012, h * 0.45)), x0, y, zf + d / 2 - 0.004));
  const lens = cyl(Math.min(0.009, h * 0.3), Math.min(0.009, h * 0.3), 0.003, M.lens, 20); lens.rotation.x = Math.PI / 2; g.add(at(lens, x0, y, zf + d - 0.003));
  g.add(at(box(0.003, 0.003, 0.001, M.whiteLed), x0 + w * 0.28, y + h * 0.2, zf + d - 0.0035));
  if (host) {
    g.add(at(box(0.03, 0.004, Math.max(0.04, zf - zc + 0.05), M.dark, 0.0015), x0, top + 0.002, zc));
    g.add(at(box(0.03, 0.04, 0.004, M.dark, 0.0015), x0, top - 0.018, zc - Math.max(0.02, zf - zc + 0.025)));
  } else {
    for (const a of [0, 2.1, 4.2]) g.add(rod(new V3(x0, y - h / 2, zf), new V3(x0 + Math.sin(a) * 0.05, DESK_H, zf + Math.cos(a) * 0.05), 0.003, M.dark));
  }
  g.userData.size = { w, d: host ? d : 0.1, top: y + h / 2 };
  return g;
}

const BUILD = { monitor, laptop, desktop: computer, ps5, keyboard, mouse, phone, tablet, hub, mousepad, headset, speakers, arm, light: lightbar, webcam };
const FOLLOW = new Set(["light", "webcam"]);
const LATE = new Set(["light", "webcam", "speakers", "arm"]);
const SCREENS = new Set(["monitor", "laptop", "desktop", "phone", "tablet"]);

/* ------------------------------------------------------------------ la mesa (medidas reales) */

export const TABLE_DEFAULT = { preset: "custom", width_cm: 160, depth_cm: 70, height_cm: 74, top_cm: 2.5, shape: "rect", corner_cm: 0,
  return_w_cm: 60, return_d_cm: 120, legs: "four", material: "oak", leg_color: "black" };
export const TABLE_LIMITS = { width_cm: [60, 300], depth_cm: [40, 120], height_cm: [55, 130], top_cm: [1, 8], corner_cm: [0, 30],
  return_w_cm: [30, 120], return_d_cm: [60, 220] };
const TABLE_ENUMS = { shape: ["rect", "l_left", "l_right"], legs: ["four", "a_frame", "t_frame", "standing", "trestle", "drawers"],
  material: ["oak", "walnut", "white", "black", "bamboo", "gray", "glass"], leg_color: ["black", "white", "silver"] };

/* Mesa con valores válidos y coherentes (igual que desk.normalize_table) */
export function normTable(t) {
  const o = { ...TABLE_DEFAULT, ...(t || {}) };
  for (const [k, [a, b]] of Object.entries(TABLE_LIMITS)) { const v = +o[k]; o[k] = Math.round(clamp(Number.isFinite(v) ? v : TABLE_DEFAULT[k], a, b) * 10) / 10; }
  for (const [k, opts] of Object.entries(TABLE_ENUMS)) if (!opts.includes(o[k])) o[k] = TABLE_DEFAULT[k];
  o.corner_cm = Math.max(0, Math.min(o.corner_cm, Math.min(o.width_cm, o.depth_cm) / 2 - 1));
  if (o.shape !== "rect") { o.return_d_cm = Math.max(o.return_d_cm, o.depth_cm + 10); o.return_w_cm = Math.min(o.return_w_cm, o.width_cm - 20); }
  return o;
}
/* Rectángulos del tablero en metros [x0, z0, x1, z1] (como desk.table_rects) */
function tableRects(t) {
  const W = cm(t.width_cm), D = cm(t.depth_cm), rw = cm(t.return_w_cm), rd = cm(t.return_d_cm);
  const r = [[-W / 2, -D / 2, W / 2, D / 2]];
  if (t.shape === "l_right") r.push([W / 2 - rw, -D / 2, W / 2, -D / 2 + rd]);
  if (t.shape === "l_left") r.push([-W / 2, -D / 2, -W / 2 + rw, -D / 2 + rd]);
  return r;
}
function tableBox(t) {
  const rs = tableRects(t);
  return { x0: Math.min(...rs.map((r) => r[0])), z0: Math.min(...rs.map((r) => r[1])), x1: Math.max(...rs.map((r) => r[2])), z1: Math.max(...rs.map((r) => r[3])) };
}
/* Contorno (en orden) con las esquinas exteriores que se redondean */
function tableOutline(t) {
  const W = cm(t.width_cm), D = cm(t.depth_cm), rw = cm(t.return_w_cm), rd = cm(t.return_d_cm);
  if (t.shape === "l_right") return [[-W / 2, -D / 2, 1], [W / 2, -D / 2, 1], [W / 2, -D / 2 + rd, 1], [W / 2 - rw, -D / 2 + rd, 1], [W / 2 - rw, D / 2, 0], [-W / 2, D / 2, 1]];
  if (t.shape === "l_left") return [[-W / 2, -D / 2, 1], [W / 2, -D / 2, 1], [W / 2, D / 2, 1], [-W / 2 + rw, D / 2, 0], [-W / 2 + rw, -D / 2 + rd, 1], [-W / 2, -D / 2 + rd, 1]];
  return [[-W / 2, -D / 2, 1], [W / 2, -D / 2, 1], [W / 2, D / 2, 1], [-W / 2, D / 2, 1]];
}
function tableShape(t) {
  const pts = tableOutline(t), r = cm(t.corner_cm), shape = new THREE.Shape(), n = pts.length;
  pts.forEach(([x, z, round], i) => {
    const [px, pz] = pts[(i + n - 1) % n], [nx, nz] = pts[(i + 1) % n];
    const lp = Math.hypot(px - x, pz - z), ln = Math.hypot(nx - x, nz - z);
    const rr = round ? Math.min(r, lp / 2, ln / 2) : 0;
    if (rr < 1e-4) { if (i) shape.lineTo(x, z); else shape.moveTo(x, z); return; }
    const ax = x + ((px - x) / lp) * rr, az = z + ((pz - z) / lp) * rr, bx = x + ((nx - x) / ln) * rr, bz = z + ((nz - z) / ln) * rr;
    const cx = ax + bx - x, cz = az + bz - z;
    if (i) shape.lineTo(ax, az); else shape.moveTo(ax, az);
    const a0 = Math.atan2(az - cz, ax - cx), a1 = Math.atan2(bz - cz, bx - cx);
    let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    shape.absarc(cx, cz, rr, a0, a1, da < 0);
  });
  shape.closePath();
  return shape;
}
function topMaterial(t) {
  if (t.material === "glass") {
    const m = new THREE.MeshPhysicalMaterial({ color: 0xeaf6f3, metalness: 0, roughness: 0.04, transmission: 0.92, thickness: DESK_T, ior: 1.5,
      attenuationColor: new THREE.Color(0x8fd3c6), attenuationDistance: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 });
    m.userData.glass = true;
    return m;
  }
  const kind = DESKS[t.material] ? t.material : "oak";
  if (DESKS[kind].wood) {
    const map = woodTex(kind); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(1 / 1.4, 1 / 0.52);
    return new THREE.MeshPhysicalMaterial({ map, roughness: 0.58, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.45 });
  }
  return new THREE.MeshPhysicalMaterial({ color: DESKS[kind].base, roughness: kind === "black" ? 0.42 : 0.55, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.5 });
}

/* Tablero (con su forma y esquinas) + patas del tipo elegido */
function tableObj(t) {
  const g = new THREE.Group();
  const W = cm(t.width_cm), D = cm(t.depth_cm), rw = cm(t.return_w_cm), rd = cm(t.return_d_cm), H = DESK_H - DESK_T;
  const bev = Math.min(0.002, DESK_T * 0.2);
  const geo = new THREE.ExtrudeGeometry(tableShape(t), { depth: Math.max(0.002, DESK_T - 2 * bev), bevelEnabled: true, bevelThickness: bev,
    bevelSize: bev, bevelSegments: 2, curveSegments: 18 });
  geo.rotateX(Math.PI / 2); geo.translate(0, -bev, 0);   // contorno en x/z, grosor hacia abajo desde y = 0
  const topM = topMaterial(t);
  const top = new THREE.Mesh(geo, topM); top.position.y = DESK_H; top.receiveShadow = true; top.castShadow = !topM.userData.glass;
  top.name = "tabletop"; g.add(top);

  const [lc, lm] = LEGS[t.leg_color] || LEGS.black;
  const legM = mat(lc, { metalness: lm, roughness: 0.35 });
  const bar = (a, b, w, d) => {
    const m = box(w, a.distanceTo(b), d, legM, Math.min(w, d) * 0.2);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new V3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  };
  const inset = 0.05, L = t.shape !== "rect", right = t.shape === "l_right";
  const cabinet = (x, z0, z1, sx) => {                   // cajonera tipo Alex
    const cw = 0.36, cd = Math.min(0.58, z1 - z0 - 0.02), xc = x - sx * (cw / 2 + 0.01 - inset), zc = z1 - 0.01 - cd / 2;
    g.add(at(box(cw, H, cd, legM, 0.004), xc, H / 2, zc));
    const n = 5, dh = (H - 0.02) / n;
    for (let k = 0; k < n; k++) {
      g.add(at(box(cw - 0.012, dh - 0.006, 0.006, legM, 0.002), xc, 0.01 + dh * (k + 0.5), zc + cd / 2 + 0.003));
      g.add(at(box(0.08, 0.008, 0.008, M.dark, 0.002), xc, 0.01 + dh * (k + 0.5) + dh * 0.25, zc + cd / 2 + 0.009));
    }
  };
  const side = (x, z0, z1, sx) => {
    const zc = (z0 + z1) / 2, za = z0 + inset, zb = z1 - inset, len = zb - za;
    switch (t.legs) {
      case "a_frame": {
        g.add(bar(new V3(x, 0, za), new V3(x, H, zc - 0.04), 0.035, 0.022), bar(new V3(x, 0, zb), new V3(x, H, zc + 0.04), 0.035, 0.022));
        g.add(at(box(0.03, 0.02, len - (len - 0.08) * 0.64, legM, 0.004), x, H * 0.32, zc));
        g.add(at(box(0.04, 0.025, len, legM, 0.004), x, H - 0.0125, zc));
        break;
      }
      case "t_frame": case "standing": {
        const st = t.legs === "standing";
        g.add(at(box(0.07, 0.03, len, legM, 0.006), x, 0.015, zc));
        if (st) {
          const low = H * 0.5, up = H - 0.03 - low + 0.05;
          g.add(at(box(0.075, low, 0.055, legM, 0.006), x, 0.03 + low / 2, zc));
          g.add(at(box(0.062, up, 0.044, legM, 0.005), x, 0.03 + low - 0.05 + up / 2, zc));
          for (const z of [za + 0.015, zb - 0.015]) g.add(at(box(0.075, 0.012, 0.03, M.black, 0.004), x, 0.006, z));
          g.add(at(box(0.09, 0.05, 0.08, legM, 0.006), x, H - 0.055, zc));   // motor
        } else g.add(at(box(0.06, H - 0.03, 0.04, legM, 0.006), x, 0.03 + (H - 0.03) / 2, zc));
        g.add(at(box(0.05, 0.03, len, legM, 0.005), x, H - 0.015, zc));
        break;
      }
      case "trestle": {
        const o = 0.06;
        g.add(bar(new V3(x + sx * o, 0, za), new V3(x, H - 0.03, zc - len * 0.28), 0.04, 0.03));
        g.add(bar(new V3(x + sx * o, 0, zb), new V3(x, H - 0.03, zc + len * 0.28), 0.04, 0.03));
        g.add(at(box(0.05, 0.03, len * 0.75, legM, 0.005), x, H - 0.015, zc));
        g.add(at(box(0.03, 0.025, len * 0.83, legM, 0.004), x + sx * o * 0.62, H * 0.38, zc));
        break;
      }
      case "drawers": {
        if (sx < 0 || W >= 1.3) { cabinet(x, z0, z1, sx); break; }
      }
      // falls through: con una mesa corta, la cajonera va a un lado y patas al otro
      default: {
        for (const z of [za, zb]) g.add(at(box(0.05, H, 0.05, legM, 0.006), x, H / 2, z));
        g.add(at(box(0.03, 0.06, Math.max(0.05, len - 0.05), legM, 0.004), x, H - 0.03, zc));
      }
    }
  };
  side(-W / 2 + inset, -D / 2, L && !right ? -D / 2 + rd : D / 2, -1);
  side(W / 2 - inset, -D / 2, L && right ? -D / 2 + rd : D / 2, 1);
  if (L) {   // pata extra bajo la esquina delantera interior del retorno
    const x = right ? W / 2 - rw + inset : -W / 2 + rw - inset, z = -D / 2 + rd - inset;
    if (t.legs === "standing" || t.legs === "t_frame") {
      g.add(at(box(0.07, 0.03, 0.4, legM, 0.006), x, 0.015, z - 0.15));
      g.add(at(box(0.06, H - 0.03, 0.045, legM, 0.006), x, 0.03 + (H - 0.03) / 2, z - 0.15));
    } else g.add(at(box(0.05, H, 0.05, legM, 0.006), x, H / 2, z));
  }
  // travesaño trasero entre los dos lados
  g.add(at(box(Math.max(0.1, W - 2 * inset - 0.06), 0.04, 0.025, legM, 0.004), 0, H - 0.04, -D / 2 + inset + 0.02));
  if (t.legs === "standing") {   // mando con display bajo el borde delantero
    const px = right && L ? W / 2 - rw - 0.12 : W / 2 - 0.3;
    g.add(at(box(0.13, 0.022, 0.05, M.black, 0.005), px, H - 0.011, D / 2 - 0.035));
    g.add(at(box(0.03, 0.008, 0.001, M.blueLed), px - 0.03, H - 0.011, D / 2 - 0.0095));
  }
  g.traverse((o) => { o.userData.table = true; });
  return g;
}

/* ------------------------------------------------------------------ decoración */

function plant(scale = 1) {
  const g = new THREE.Group();
  const pot = cyl(0.045 * scale, 0.034 * scale, 0.08 * scale, mat(0xd8cfc4, { roughness: 0.8 }), 24); pot.position.y = 0.04 * scale; g.add(pot);
  g.add(at(cyl(0.041 * scale, 0.041 * scale, 0.004, M.soil, 20), 0, 0.078 * scale, 0));
  const r = rng(Math.round(scale * 100));
  for (let i = 0; i < 9; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), M.green);
    const a = (i / 9) * Math.PI * 2 + r() * 0.4, tilt = 0.35 + r() * 0.45, len = (0.07 + r() * 0.04) * scale;
    leaf.scale.set(0.016 * scale, len, 0.006 * scale);
    leaf.position.set(Math.sin(a) * len * 0.55 * Math.sin(tilt), 0.08 * scale + len * Math.cos(tilt) * 0.9, Math.cos(a) * len * 0.55 * Math.sin(tilt));
    leaf.rotation.set(Math.cos(a) * tilt, 0, -Math.sin(a) * tilt); leaf.castShadow = true;
    g.add(leaf);
  }
  return g;
}
function mug() {
  const g = new THREE.Group();
  const m = mat(0xe07a4f, { roughness: 0.35 });
  g.add(at(cyl(0.04, 0.037, 0.095, m, 28), 0, 0.0475, 0));
  g.add(at(cyl(0.035, 0.035, 0.002, mat(0x3b2416, { roughness: 0.2 }), 24), 0, 0.085, 0));
  const h = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.007, 8, 16, Math.PI), m); h.rotation.z = -Math.PI / 2; h.position.set(0.04, 0.05, 0); h.castShadow = true; g.add(h);
  return g;
}
function books() {
  const g = new THREE.Group();
  [[0x2f5d8a, 0.03, 0.02], [0xb04a3c, 0.026, -0.12], [0xe0b64a, 0.022, 0.08]].reduce((y, [c, t, rot]) => {
    const b = at(box(0.21, t, 0.15, mat(c, { roughness: 0.8 }), 0.002), 0, y + t / 2, 0); b.rotation.y = rot; g.add(b);
    g.add(at(box(0.2, t * 0.8, 0.002, M.white), 0, y + t / 2, 0.075).rotateY(rot) && b);
    return y + t;
  }, 0);
  return g;
}
function lamp() {
  const g = new THREE.Group();
  const m = mat(0x2a2b2f, { metalness: 0.6, roughness: 0.35 });
  g.add(at(cyl(0.06, 0.065, 0.015, m, 28), 0, 0.0075, 0));
  const a = new V3(0, 0.015, 0), b = new V3(0.02, 0.27, -0.03), c = new V3(0.16, 0.33, 0.02);
  g.add(rod(a, b, 0.006, m), rod(b, c, 0.006, m));
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 24, 1, true), m); head.material.side = THREE.DoubleSide;
  head.position.copy(c).add(new V3(0.02, -0.03, 0)); head.rotation.z = 0.35; head.castShadow = true; g.add(head);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffd9a0, emissiveIntensity: 0 }));
  bulb.position.copy(head.position).add(new V3(0, -0.02, 0)); bulb.material.userData.lampBulb = true; g.add(bulb);
  const spot = new THREE.SpotLight(0xffd2a0, 0, 1.6, 0.9, 0.7, 1.3); spot.userData.kind = "lamp";
  spot.position.copy(bulb.position); spot.target.position.set(c.x + 0.1, 0, c.z + 0.1); g.add(spot, spot.target);
  return g;
}
function frame() {
  const g = new THREE.Group();
  g.add(at(box(0.52, 0.4, 0.02, mat(0x2a2522, { roughness: 0.6 }), 0.004), 0, 0, 0));
  const art = canvasTex(512, 390, (c, W, H) => {
    c.fillStyle = "#f3eee6"; c.fillRect(0, 0, W, H);
    const r = rng(42), cols = ["#e07a4f", "#2f5d8a", "#e0b64a", "#5f9e6e", "#1d1e22"];
    for (let i = 0; i < 7; i++) { c.fillStyle = cols[i % cols.length]; c.globalAlpha = 0.85; c.beginPath(); c.arc(60 + r() * (W - 120), 60 + r() * (H - 120), 25 + r() * 70, 0, Math.PI * 2); c.fill(); }
    c.globalAlpha = 1;
  });
  g.add(at(new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.34), new THREE.MeshStandardMaterial({ map: art, roughness: 0.8 })), 0, 0, 0.0105));
  return g;
}
const SKY = {
  day: ["#9fd3ff", "#e8f6ff"], evening: ["#ff8a4c", "#6a3d8a"], night: ["#0a1430", "#18264a"],
};
function windowDecor(mode) {
  const g = new THREE.Group();
  const fm = mat(0xf2f2ef, { roughness: 0.5 });
  g.add(at(box(0.98, 0.04, 0.05, fm), 0, 0.42, 0), at(box(0.98, 0.04, 0.05, fm), 0, -0.42, 0),
    at(box(0.04, 0.86, 0.05, fm), -0.47, 0, 0), at(box(0.04, 0.86, 0.05, fm), 0.47, 0, 0),
    at(box(0.025, 0.8, 0.03, fm), 0, 0, 0.005), at(box(1.06, 0.03, 0.12, fm), 0, -0.45, 0.05));
  const [a, b] = SKY[mode] || SKY.day;
  const tex = canvasTex(256, 220, (c, W, H) => {
    const grd = c.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, a); grd.addColorStop(1, b); c.fillStyle = grd; c.fillRect(0, 0, W, H);
    const r = rng(9);
    if (mode === "night") for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(255,255,255,${r()})`; c.fillRect(r() * W, r() * H * 0.8, 1.2, 1.2); }
    else if (mode === "day") for (let i = 0; i < 4; i++) { c.fillStyle = "rgba(255,255,255,.8)"; c.beginPath(); c.ellipse(r() * W, 30 + r() * 80, 30 + r() * 20, 10, 0, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = mode === "night" ? "rgba(10,12,25,.9)" : "rgba(60,70,90,.35)";
    for (let x = 0; x < W; x += 18 + r() * 14) { const bh = 30 + r() * 70; c.fillRect(x, H - bh, 14 + r() * 10, bh); }
  });
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.8), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: mode === "night" ? 0.5 : 1, roughness: 0.1 }));
  pane.position.z = -0.01; g.add(pane);
  return g;
}

/* ------------------------------------------------------------------ disposición automática */

function heldMap(items) {
  const mons = items.filter((i) => i.type === "monitor");
  const held = new Map(); let k = 0;
  for (const a of items.filter((i) => i.type === "arm")) {
    const n = a.specs?.dual ? 2 : 1;
    for (const m of mons.slice(k, k + n)) held.set(m.id, a.id);
    k += n;
  }
  return held;
}

/* Medio ancho y medio fondo de la huella girada */
function halfExt(s, rot) {
  const c = Math.abs(Math.cos(rot || 0)), n = Math.abs(Math.sin(rot || 0)), w = s.w || 0.2, d = s.d || 0.2;
  return [(w * c + d * n) / 2, (w * n + d * c) / 2];
}

/* Colocación inicial sobre la mesa real (en metros, huella centrada), sin salirse del tablero */
function layout(items, objects, T, held) {
  const W = cm(T.width_cm), D = cm(T.depth_cm);
  const by = (t) => items.filter((i) => i.type === t);
  const sz = (id, def) => objects.get(id)?.userData.size || def;
  const atBack = (d) => -D / 2 + d / 2 + 0.03;
  const mons = by("monitor");
  const mw = mons.map((m) => sz(m.id, { w: 0.6 }).w);
  const gap = 0.02, total = mw.reduce((a, b) => a + b, 0) + Math.max(0, mons.length - 1) * gap;
  const spk = by("speakers")[0], spkW = spk ? cm(dimsOf(spk).w) : 0;
  const pos = new Map();
  let x = -total / 2;
  mons.forEach((m, i) => {
    const s = sz(m.id, { w: 0.6, d: 0.2 });
    const rot = mons.length > 1 ? (i - (mons.length - 1) / 2) * -0.16 : 0;
    pos.set(m.id, [x + mw[i] / 2, held.has(m.id) ? -D / 2 + 0.16 : atBack(s.d), rot]);
    x += mw[i] + gap;
  });
  const spkPad = spk && mons.length ? spkW + 0.04 : 0;
  let lx = mons.length ? -total / 2 - 0.05 - spkPad : 0.1;
  let fx = -W / 2 + 0.03;   // delante a la izquierda, si al lado de los monitores no queda hueco
  by("laptop").forEach((l) => {
    const s = sz(l.id, { w: 0.32, d: 0.22 }), [hx, hz] = halfExt(s, 0.3);
    if (!mons.length) { pos.set(l.id, [lx - s.w / 2 + 0.1, atBack(s.d) + 0.1, 0]); lx -= s.w + 0.08; }
    else if (lx - 2 * hx >= -W / 2) { pos.set(l.id, [lx - hx, atBack(s.d) + 0.08, 0.3]); lx -= 2 * hx + 0.04; }
    else { pos.set(l.id, [fx + hx, D / 2 - hz - 0.04, 0.3]); fx += 2 * hx + 0.03; }
  });
  by("tablet").forEach((t) => { const s = sz(t.id, { w: 0.26, d: 0.15 }); pos.set(t.id, [lx - s.w / 2, atBack(s.d) + 0.05, 0.35]); lx -= s.w + 0.05; });
  let rx = Math.max(total / 2 + 0.04 + spkPad, mons.length ? 0 : 0.3);
  by("ps5").forEach((p) => { const s = sz(p.id, { w: 0.1, d: 0.22 }); pos.set(p.id, [rx + s.w / 2, atBack(s.d), 0]); rx += s.w + 0.04; });
  const floors = [];
  by("desktop").forEach((d) => {
    const s = sz(d.id, { w: 0.2, d: 0.2 });
    if (s.floor) floors.push(d);
    else { pos.set(d.id, [rx + s.w / 2, atBack(s.d), 0]); rx += s.w + 0.04; }
  });
  by("hub").forEach((h) => { const s = sz(h.id, { w: 0.12, d: 0.05 }); pos.set(h.id, [rx + s.w / 2, atBack(s.d) + 0.02, 0]); rx += s.w + 0.04; });
  const fs = T.shape === "l_right" ? -1 : 1;   // las torres, al lado sin retorno
  floors.forEach((d, i) => { const s = sz(d.id, { w: 0.21 }); pos.set(d.id, [fs * (W / 2 + 0.06 + s.w / 2 + i * (s.w + 0.05)), 0, 0]); });
  const kbs = by("keyboard");
  const kb0 = kbs.length ? sz(kbs[0].id, { w: 0.43, d: 0.14 }) : { w: 0.3, d: 0.14 };
  const kz = D / 2 - kb0.d / 2 - 0.08;
  kbs.forEach((k, i) => pos.set(k.id, [-0.04 + i * 0.05, kz - i * 0.16, 0]));
  const mice = by("mouse");
  mice.forEach((m, i) => pos.set(m.id, [-0.04 + kb0.w / 2 + 0.09 + i * 0.1, kz, 0]));
  by("mousepad").forEach((m) => {
    const s = sz(m.id, { w: 0.3, d: 0.25 });
    const mx = s.w > kb0.w ? -0.04 + (mice.length ? 0.06 : 0) : -0.04 + kb0.w / 2 + 0.09;
    pos.set(m.id, [mx, Math.min(kz, D / 2 - s.d / 2 - 0.02), 0]);
  });
  const mouseX = mice.length ? -0.04 + kb0.w / 2 + 0.09 + mice.length * 0.1 : -W / 2 + 0.06;
  by("phone").forEach((p, i) => pos.set(p.id, [(fx > -W / 2 + 0.03 ? Math.min(mouseX + 0.12, W / 2 - 0.3) : -W / 2 + 0.12) + i * 0.11, D / 2 - 0.13, 0.35]));
  by("headset").forEach((h, i) => pos.set(h.id, [W / 2 - 0.1 - i * 0.16, D / 2 - 0.12, -0.3]));
  const span = mons.length ? total / 2 + 0.02 + spkW / 2 : 0.4;
  by("speakers").forEach((s) => pos.set(s.id, [0, atBack(sz(s.id, { d: 0.12 }).d) + 0.02, 0]));
  by("arm").forEach((a) => {
    const hx = mons.filter((m) => held.get(m.id) === a.id).map((m) => pos.get(m.id)[0]);
    pos.set(a.id, [hx.length ? hx.reduce((p, c) => p + c, 0) / hx.length : 0, -D / 2 + sz(a.id, { d: 0.09 }).d / 2, 0]);
  });
  // que nada se salga del tablero principal (ni por las esquinas redondeadas)
  const rc = cm(T.corner_cm) * 0.3;
  for (const [id, p] of pos) {
    const s = sz(id, { w: 0.2, d: 0.2 });
    if (s.floor) continue;
    const [hx, hz] = halfExt(s, p[2]), mx = W / 2 - hx - rc, mz = D / 2 - hz - rc;
    p[0] = mx > 0 ? clamp(p[0], -mx, mx) : 0;
    p[1] = mz > 0 ? clamp(p[1], -mz, mz) : 0;
  }
  return { pos, span: Math.min(span, W / 2 - spkW / 2 - 0.01), backZ: -D / 2 + 0.12 };
}

/* ------------------------------------------------------------------ luz */

const MODES = {
  day: { hemi: [0xffffff, 0xd9d2c5, 0.6], sun: [0xfff3e3, 1.7, [1.6, 3.2, 2.2]], env: 0.55, exp: 1.05, screen: 0.8, bar: 3.5, lamp: 0, glow: 0, rgbA: 0.35 },
  evening: { hemi: [0xffd9b0, 0x5a4a40, 0.32], sun: [0xff9a4a, 1.25, [-2.6, 1.25, 1.2]], env: 0.3, exp: 1.0, screen: 0.95, bar: 6, lamp: 2.5, glow: 0.25, rgbA: 0.6 },
  night: { hemi: [0x8090c0, 0x101018, 0.07], sun: [0x8fa8ff, 0.12, [-1.5, 3, 1.5]], env: 0.08, exp: 1.15, screen: 1.15, bar: 9, lamp: 4, glow: 0.8, rgbA: 0.95 },
};
/* La mesa (medidas, patas, material) va aparte, en `table`; esto es solo el ambiente */
const DEFAULT_STYLE = { wall: null, floor: "wood", light: "day", wallpaper: "sunset", decor: [], rgb: false };

function disposeObj(root) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    if (o.material) [].concat(o.material).forEach((m) => {
      if (m.userData?.shared) return;
      for (const k of ["map", "emissiveMap", "alphaMap"]) m[k]?.dispose?.();
      m.dispose();
    });
    if (o.isLight) o.shadow?.map?.dispose?.();
  });
}

/* Marco plano alrededor de la huella (selección y avisos); no se puede pinchar */
function outlineMesh(w, d, t, color, opacity = 0.95) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 - t, -d / 2 - t); s.lineTo(w / 2 + t, -d / 2 - t); s.lineTo(w / 2 + t, d / 2 + t); s.lineTo(-w / 2 - t, d / 2 + t); s.closePath();
  const h = new THREE.Path();
  h.moveTo(-w / 2, -d / 2); h.lineTo(-w / 2, d / 2); h.lineTo(w / 2, d / 2); h.lineTo(w / 2, -d / 2); h.closePath();
  s.holes.push(h);
  const geo = new THREE.ShapeGeometry(s); geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2 }));
  m.raycast = () => {}; m.renderOrder = 3;
  return m;
}

const VIEWS = { iso: [0.1, 0.62, 1], front: [0, 0.2, 1], top: [0, 1, 0.0001], side: [1, 0.34, 0.1] };
const VIEW_NAMES = { iso: "vista en perspectiva", front: "vista de frente", top: "vista desde arriba", side: "vista lateral" };
const fmtCm = (m) => `${(Math.round(m * 1000) / 10).toLocaleString("es-ES")} cm`;
const say = (msg, o) => (window.FG?.announce || window.announce)?.(msg, o);
const isDarkTheme = () => (window.FG?.theme?.resolved ? window.FG.theme.resolved() === "dark"
  : matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light");
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/* ------------------------------------------------------------------ escena */

const KEYS_HELP = "Flechas: mover el objeto elegido (Mayús ×10, Alt 1 mm) · Q/E: girar · N: siguiente objeto · Intro: acercar · Esc: soltar · 1–4: cámara · M: medidas · +/−: zoom";

export function mount(container, { onSelect, onHover, onMove, onMeasures, nameOf, label, describedBy } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
  } catch (e) {
    container.innerHTML = `<div class="desk3d-fallback" role="note">Tu navegador no puede mostrar 3D (WebGL desactivado). La lista y los avisos de medidas funcionan igual.</div>`;
    const noop = () => {};
    return { update: noop, setStyle: noop, setTable: noop, select: noop, focus: noop, preview: noop, rotate: noop, nudge: noop, setPos: noop,
      cameraPreset: noop, zoomIn: noop, zoomOut: noop, toggleMeasures: () => false, markIssues: noop, describe: () => [], snapshot: () => null, dispose: noop, webgl: false };
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-roledescription", "vista 3D");
  canvas.setAttribute("aria-label", label || `Escritorio en 3D a escala real. ${KEYS_HELP}`);
  if (describedBy) canvas.setAttribute("aria-describedby", describedBy);
  container.appendChild(canvas);
  const tip = document.createElement("div"); tip.className = "desk3d-tip"; tip.setAttribute("aria-hidden", "true"); container.appendChild(tip);
  const overlay = document.createElement("div"); overlay.className = "d3-measures"; overlay.setAttribute("aria-hidden", "true"); container.appendChild(overlay);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.environment = envTex;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.03, 40);
  camera.position.set(0.15, 1.75, 1.85);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, DESK_H + 0.16, 0);
  controls.enableDamping = !reducedMotion(); controls.dampingFactor = 0.08;
  controls.minDistance = 0.25; controls.maxDistance = 4; controls.maxPolarAngle = Math.PI * 0.495; controls.enablePan = true;
  controls.zoomToCursor = true;
  controls.zoomSpeed = 2.4; controls.rotateSpeed = 0.9; controls.panSpeed = 1.1;
  let userMoved = false, view = "iso", tween = null;
  controls.addEventListener("start", () => { userMoved = true; tween = null; });

  let dark = isDarkTheme();
  const hemi = new THREE.HemisphereLight(0xffffff, 0xd9d2c5, 0.6); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e3, 1.7);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -2.2, right: 2.2, top: 2.2, bottom: -2.2, near: 0.3, far: 12 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  const screenGlow = new THREE.PointLight(0x9fb8ff, 0, 1.6, 1.5); scene.add(screenGlow);

  let st = { ...DEFAULT_STYLE }, T = normTable(null);
  let deskObj = null, deskKey = "", roomObj = null, roomKey = "";
  let decorObj = null, rgbObj = null, rgbMats = [];
  const objects = new Map(), keys = new Map(), manual = new Map(), spawn = new Map();
  let current = [], held = new Map(), selected = null, ghost = null, lastBackZ = -0.2, issueSev = new Map();
  let measuresOn = false, mLabels = [];
  const mGroup = new THREE.Group(); scene.add(mGroup);

  let needs = true, visible = true;
  const dirty = () => { needs = true; };
  controls.addEventListener("change", dirty);
  const itemOf = (id) => current.find((i) => i.id === id);
  const nameFor = (it) => (it ? (nameOf?.(it) || it.model || it.type) : "");
  const movable = (it) => it && !FOLLOW.has(it.type);

  /* --- mesa, suelo y pared */
  function setDesk() {
    const key = JSON.stringify(T);
    if (key === deskKey && deskObj) return;
    if (deskObj) { scene.remove(deskObj); disposeObj(deskObj); }
    deskObj = tableObj(T); deskKey = key; scene.add(deskObj);
    const b = tableBox(T), half = Math.max(b.x1 - b.x0, b.z1 - b.z0) / 2 + 1;
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
    sun.shadow.camera.updateProjectionMatrix();
  }
  const wallZ = () => tableBox(T).z0 - 0.1;
  /* Cuarto a la medida de la mesa: un rincón recogido (pared del fondo + laterales), no una nave enorme */
  const roomBox = () => {
    const b = tableBox(T);
    const halfX = Math.max(1.3, (b.x1 - b.x0) / 2 + 0.75);
    return { x0: (b.x0 + b.x1) / 2 - halfX, x1: (b.x0 + b.x1) / 2 + halfX, zb: wallZ(), zf: b.z1 + 1.25, h: 2.5 };
  };
  function setRoom() {
    const R = roomBox();
    const key = JSON.stringify([st.floor, st.wall, round3(R.x0), round3(R.x1), round3(R.zb), round3(R.zf), dark]);
    if (key === roomKey) return;
    if (roomObj) { scene.remove(roomObj); disposeObj(roomObj); }
    const g = new THREE.Group();
    const RW = R.x1 - R.x0, RD = R.zf - R.zb, cx = (R.x0 + R.x1) / 2, cz = (R.zb + R.zf) / 2;
    const fdraw = FLOORS[st.floor] || FLOORS.wood;
    const ftex = canvasTex(512, 512, fdraw, [Math.max(2, RW * 1.6), Math.max(2, RD * 1.6)]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(RW, RD), new THREE.MeshStandardMaterial({ map: ftex, roughness: st.floor === "tiles" ? 0.35 : 0.85,
      color: dark ? 0x9a9a9a : 0xffffff }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0, cz); floor.receiveShadow = true; g.add(floor);
    const wc = st.wall && /^#?[0-9a-f]{6}$/i.test(st.wall) ? parseInt(st.wall.replace("#", ""), 16) : (dark ? 0x2b2b2f : 0xf1ede6);
    const wallM = mat(wc, { roughness: 0.95 });
    const sideM = mat(new THREE.Color(wc).multiplyScalar(0.9).getHex(), { roughness: 0.95 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(RW, R.h), wallM);
    back.position.set(cx, R.h / 2, R.zb); back.receiveShadow = true; g.add(back);
    for (const sx of [-1, 1]) {   // paredes laterales: encierran el rincón
      const w = new THREE.Mesh(new THREE.PlaneGeometry(RD, R.h), sideM);
      w.rotation.y = -sx * Math.PI / 2; w.position.set(sx < 0 ? R.x0 : R.x1, R.h / 2, cz); w.receiveShadow = true; g.add(w);
    }
    const trim = mat(isLightHex(wc) ? 0xffffff : 0x1e1e21, { roughness: 0.6 });
    g.add(at(box(RW, 0.08, 0.015, trim), cx, 0.04, R.zb + 0.008));          // rodapiés
    for (const sx of [-1, 1]) g.add(at(box(0.015, 0.08, RD, trim), (sx < 0 ? R.x0 + 0.008 : R.x1 - 0.008), 0.04, cz));
    // alfombra bajo la silla: ancla visualmente el espacio de trabajo
    const b = tableBox(T);
    const rug = new THREE.Mesh(new RoundedBoxGeometry(Math.min(RW - 0.3, (b.x1 - b.x0) + 0.5), 0.008, 1.5, 2, 0.004),
      mat(dark ? 0x3a3936 : 0xd9d3c7, { roughness: 1 }));
    rug.position.set((b.x0 + b.x1) / 2, 0.004, b.z1 - 0.15); rug.receiveShadow = true; g.add(rug);
    roomObj = g; roomKey = key; scene.add(g);
    const bg = new THREE.Color(wc).multiplyScalar(dark ? 0.55 : 0.78);
    scene.background = bg;
    scene.fog = new THREE.Fog(bg, 3.2, 7);   // lo lejano se funde: la atención va a la mesa
  }

  /* --- cámara: vistas fijas con transición suave (sin animación si se pide menos movimiento) */
  function viewPose(name) {
    const b = tableBox(T), cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, bx = b.x1 - b.x0, bz = b.z1 - b.z0;
    const target = new V3(cx, DESK_H + (name === "top" ? 0 : 0.16), cz);
    const dir = new V3(...(VIEWS[name] || VIEWS.iso)).normalize();
    const vf = THREE.MathUtils.degToRad(camera.fov) / 2, hf = Math.atan(Math.tan(vf) * Math.max(camera.aspect, 0.3));
    const halfW = (name === "side" ? bz : bx) / 2 + (name === "top" ? 0.24 : 0.14);
    const halfH = name === "top" ? bz / 2 + 0.24 : name === "iso" ? Math.max(0.45, (bz / 2) * dir.y + 0.35) : 0.5;
    const depthOff = name === "top" ? 0 : name === "side" ? bx / 2 : bz / 2;
    const dist = clamp(Math.max(halfW / Math.tan(hf), halfH / Math.tan(vf)) + depthOff * 0.6, 0.8, 9);
    controls.maxDistance = clamp(dist * 1.5, 2.2, 4.5);
    return { pos: target.clone().addScaledVector(dir, dist), target };
  }
  function flyTo(pose, instant, dur = 650) {
    if (instant || reducedMotion()) {
      tween = null; camera.position.copy(pose.pos); controls.target.copy(pose.target); controls.update(); dirty(); return;
    }
    tween = { p0: camera.position.clone(), q0: controls.target.clone(), p1: pose.pos, q1: pose.target, s: performance.now(), dur };
  }
  function cameraPreset(name, { animate = true } = {}) {
    if (!VIEWS[name]) return;
    view = name; userMoved = false;
    flyTo(viewPose(name), !animate);
  }
  function fitCamera(animate = false) { if (!userMoved) flyTo(viewPose(view), !animate); }
  function focus(id) {
    const g = id && objects.get(id); if (!g) return;
    select(id);
    const b = new THREE.Box3().setFromObject(g), c = b.getCenter(new V3()), r = b.getSize(new V3()).length();
    const dir = camera.position.clone().sub(controls.target).normalize();
    if (dir.y < 0.25) { dir.y = 0.35; dir.normalize(); }
    userMoved = true;
    flyTo({ pos: c.clone().addScaledVector(dir, clamp(r * 1.8, 0.45, 2.5)), target: c });
  }

  /* --- RGB */
  function setRGB() {
    if (rgbObj) { scene.remove(rgbObj); disposeObj(rgbObj); rgbObj = null; }
    rgbMats = [];
    if (!st.rgb) return;
    const g = new THREE.Group(), W = cm(T.width_cm), D = cm(T.depth_cm);
    const strip = new THREE.MeshBasicMaterial({ color: 0x7b5cff });
    g.add(at(new THREE.Mesh(new THREE.BoxGeometry(W - 0.1, 0.006, 0.006), strip), 0, DESK_H - DESK_T - 0.004, -D / 2 + 0.015));
    g.add(at(new THREE.Mesh(new THREE.BoxGeometry(W - 0.1, 0.006, 0.006), strip), 0, DESK_H - DESK_T - 0.004, D / 2 - 0.02));
    const glowTex = canvasTex(256, 128, (c, w, h) => {
      const r = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = r; c.fillRect(0, 0, w, h);
    });
    const wallGlow = new THREE.MeshBasicMaterial({ map: glowTex, color: 0x7b5cff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
    g.add(at(new THREE.Mesh(new THREE.PlaneGeometry(Math.min(W + 0.4, 3), 0.9), wallGlow), 0, DESK_H + 0.42, wallZ() + 0.01));
    const pl = new THREE.PointLight(0x7b5cff, 0.8, 1.6, 1.6); pl.position.set(0, DESK_H + 0.3, wallZ() + 0.2); g.add(pl);
    rgbMats = [strip, wallGlow, pl];
    rgbObj = g; scene.add(g);
  }

  /* --- decoración en huecos libres */
  function itemRects(floorToo) {
    const out = [];
    for (const [, g] of objects) {
      if (!!g.userData.size?.floor !== floorToo) continue;
      const b = new THREE.Box3().setFromObject(g);
      out.push([b.min.x, b.max.x, b.min.z, b.max.z]);
    }
    return out;
  }
  const free = (rects, x, z, r) => rects.every(([a, b, c, d]) => !(x + r > a && x - r < b && z + r > c && z - r < d));
  function setDecor() {
    if (decorObj) { scene.remove(decorObj); disposeObj(decorObj); decorObj = null; }
    const want = new Set(Array.isArray(st.decor) ? st.decor : []);
    if (!want.size) return;
    const g = new THREE.Group(), W = cm(T.width_cm), D = cm(T.depth_cm);
    const rects = itemRects(false);
    const cx = W / 2 - 0.12, bz = -D / 2 + 0.11, fz = D / 2 - 0.11;
    const spots = {
      plant: [[-cx, bz], [cx, bz], [-cx + 0.22, bz], [cx - 0.22, bz], [-cx, fz], [cx, fz]],
      lamp: [[cx, bz], [-cx, bz], [cx - 0.24, bz], [-cx + 0.24, bz]],
      books: [[-cx + 0.05, bz + 0.02], [cx - 0.05, bz + 0.02], [-cx + 0.3, bz + 0.02], [cx - 0.3, bz + 0.02], [-cx + 0.05, fz - 0.02], [cx - 0.05, fz - 0.02]],
      mug: [[0.48, fz + 0.02], [cx, fz], [-cx, fz], [cx - 0.2, fz], [-cx + 0.2, fz], [cx, 0], [-cx, 0]],
    };
    const make = { plant: () => plant(1), lamp, books, mug };
    const rad = { plant: 0.08, lamp: 0.1, books: 0.13, mug: 0.05 };
    const floorSpots = () => { const s = T.shape === "l_right" ? -1 : 1; return [[s * (W / 2 + 0.34), -D / 2 + 0.12], [-s * (W / 2 + 0.34), -D / 2 + 0.12], [s * (W / 2 + 0.34), 0.3]]; };
    for (const k of ["plant", "lamp", "books", "mug"]) {
      if (!want.has(k)) continue;
      const spot = spots[k].find(([x, z]) => Math.abs(x) < W / 2 - 0.03 && Math.abs(z) < D / 2 - 0.03 && free(rects, x, z, rad[k]));
      if (spot) {
        const o = make[k](); o.position.set(spot[0], DESK_H, spot[1]); o.rotation.y = k === "lamp" && spot[0] > 0 ? Math.PI : k === "books" ? 0.2 : 0;
        g.add(o); rects.push([spot[0] - rad[k], spot[0] + rad[k], spot[1] - rad[k], spot[1] + rad[k]]);
      } else if (k === "plant") {
        const fr = itemRects(true), fs = floorSpots().find(([x, z]) => free(fr, x, z, 0.2));
        if (fs) { const o = plant(3.2); o.position.set(fs[0], 0, fs[1]); g.add(o); }
      }
    }
    if (want.has("plant") && W > 1.5 && !g.children.some((o) => o.position.y === 0)) {  // una planta grande en el suelo si hay hueco
      const fr = itemRects(true), fs = floorSpots().slice(0, 2).find(([x, z]) => free(fr, x, z, 0.22));
      if (fs) { const o = plant(3.2); o.position.set(fs[0], 0, fs[1]); g.add(o); }
    }
    const wz = wallZ() + 0.012, wy = Math.max(1.6, DESK_H + 0.85);
    if (want.has("frame")) { const f = frame(); f.position.set(want.has("window") ? -W * 0.28 : -W * 0.18, wy, wz); g.add(f); }
    if (want.has("window")) { const w = windowDecor(st.light); w.position.set(want.has("frame") ? W * 0.3 : W * 0.24, wy + 0.02, wz + 0.02); g.add(w); }
    g.traverse((o) => { o.userData.decor = true; });
    decorObj = g; scene.add(g);
  }

  /* --- objetos */
  function hostOf(items) {
    const m = items.find((i) => i.type === "monitor") || items.find((i) => i.type === "laptop");
    return m ? objects.get(m.id) : null;
  }
  function build(it, ctx) {
    const g = (BUILD[it.type] || (() => new THREE.Group()))(it, ctx, dimsOf(it));
    g.traverse((o) => { o.userData.itemId = it.id; });
    g.userData.itemId = it.id;
    g.userData.size = g.userData.size || { w: 0.2, d: 0.2, top: DESK_H + 0.05 };
    return g;
  }
  function ctxFor(it, items, extra = {}) {
    const ctx = { wallpaper: SCREENS.has(it.type) ? st.wallpaper : undefined };
    if (it.type === "monitor") ctx.held = held.has(it.id);
    if (FOLLOW.has(it.type)) {
      const h = hostOf(items);
      ctx.host = h ? { ...h.userData.size } : null;
      delete ctx.host?.body;
      const hasCam = items.some((i) => i.type === "webcam"), hasLight = items.some((i) => i.type === "light");
      if (it.type === "light" && hasCam && ctx.host) ctx.shift = -0.055;
      if (it.type === "webcam" && hasLight && ctx.host) ctx.shift = Math.min(cm(dimsOf(items.find((i) => i.type === "light")).w), ctx.host.screenW || ctx.host.w || 0.6) / 2 + 0.005;
    }
    if (it.type === "speakers") ctx.span = extra.span;
    return ctx;
  }
  function placeFollowers() {
    const host = hostOf(current);
    for (const it of current) {
      if (!FOLLOW.has(it.type)) continue;
      const g = objects.get(it.id); if (!g) continue;
      if (host) { g.position.set(host.position.x, host.position.y, host.position.z); g.rotation.y = host.rotation.y; g.visible = host.scale.x > 0.99; }
      else { g.position.set(0, g.position.y, lastBackZ); g.rotation.y = 0; }
    }
  }
  function updateArms() {
    for (const a of current.filter((i) => i.type === "arm")) {
      const g = objects.get(a.id); if (!g) continue;
      let links = g.getObjectByName("links");
      if (links) { g.remove(links); disposeObj(links); }
      links = new THREE.Group(); links.name = "links"; g.add(links);
      const body = g.userData.size.body || M.dark;
      g.updateMatrixWorld(true);
      const mons = current.filter((m) => m.type === "monitor" && held.get(m.id) === a.id);
      mons.forEach((m, i) => {
        const mo = objects.get(m.id); if (!mo) return;
        mo.updateMatrixWorld(true);
        const s = mo.userData.size;
        const t = g.worldToLocal(mo.localToWorld(new V3(0, s.cy, s.backZ - 0.012)));
        const p0 = new V3(0, g.userData.size.poleTop - i * 0.035, 0);
        const elbow = new V3((p0.x + t.x) * 0.55, (p0.y + t.y) / 2 + 0.03, p0.z + (t.z - p0.z) * 0.3);
        links.add(rod(p0, elbow, 0.012, body), rod(elbow, t, 0.011, body));
        for (const p of [elbow, t]) links.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), M.space), p.x, p.y, p.z));
      });
      links.traverse((o) => { o.userData.itemId = a.id; });
    }
  }
  /* Dentro de la mesa, pero dejando que sobresalga un poco (así se ve el aviso) */
  function clampPos(g, x, z, rot = g.rotation.y) {
    const s = g.userData.size || { w: 0.2, d: 0.2 }, b = tableBox(T);
    if (s.floor) return [clamp(x, b.x0 - 1.2, b.x1 + 1.2), clamp(z, b.z0 + 0.12, b.z1 + 0.8)];
    const [hx, hz] = halfExt(s, rot);
    const mx = Math.min(hx * 0.5, (b.x1 - b.x0) / 2), mz = Math.min(hz * 0.5, (b.z1 - b.z0) / 2);
    return [clamp(x, b.x0 + mx, b.x1 - mx), clamp(z, b.z0 + mz, b.z1 - mz)];
  }

  /* --- marcas: selección (color de acento) y avisos (ámbar / rojo) */
  function accent() {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      if (/^#[0-9a-f]{3,8}$/i.test(v) || /^rgba?\(/i.test(v)) return new THREE.Color().setStyle(v.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/i, "rgb($1,$2,$3)"));
    } catch (_) { /* color por defecto */ }
    return new THREE.Color(0xff7a33);
  }
  function applyMarks() {
    const acc = accent();
    for (const [id, g] of objects) {
      for (const n of ["mark-sel", "mark-issue"]) { const o = g.getObjectByName(n); if (o) { g.remove(o); disposeObj(o); } }
      const s = g.userData.size || {}, sev = issueSev.get(id);
      const y = s.floor ? 0.002 : s.flat ? s.top + 0.0008 : DESK_H + 0.0012;
      if (selected === id) { const m = outlineMesh(s.w || 0.2, s.d || 0.2, 0.006, acc); m.name = "mark-sel"; m.position.y = y; g.add(m); }
      if (sev) {
        const pad = selected === id ? 0.008 : 0;
        const m = outlineMesh((s.w || 0.2) + 2 * pad, (s.d || 0.2) + 2 * pad, 0.005, sev === "bad" ? 0xe5484d : 0xf5a524, 0.9);
        m.name = "mark-issue"; m.position.y = y + 0.0004; g.add(m);
      }
    }
    dirty();
  }
  function markIssues(list) {
    const rank = { bad: 2, warn: 1 };
    issueSev = new Map();
    for (const i of list || []) for (const id of i.ids || []) {
      const sev = i.severity === "bad" ? "bad" : "warn";
      if ((rank[issueSev.get(id)] || 0) < rank[sev]) issueSev.set(id, sev);
    }
    applyMarks();
  }

  /* --- medidas: mesa (ancho, fondo, alto, retorno) y huella + holguras del objeto elegido */
  function buildMeasures() {
    for (const c of [...mGroup.children]) { mGroup.remove(c); disposeObj(c); }
    overlay.textContent = ""; mLabels = [];
    if (!measuresOn) { dirty(); return; }
    const ok = [], bad = [];
    const seg = (arr, a, b) => { arr.push(a.x, a.y, a.z, b.x, b.y, b.z); };
    const tick = (arr, p, dx, dz) => seg(arr, new V3(p.x - dx, p.y, p.z - dz), new V3(p.x + dx, p.y, p.z + dz));
    const lbl = (p, text, cls = "") => {
      const el = document.createElement("span"); el.className = `d3-ml ${cls}`.trim(); el.textContent = text;
      overlay.appendChild(el); mLabels.push({ el, p: p.clone() });
    };
    const dim = (a, b, text, cls, arr = ok) => {   // línea con topes y su etiqueta en medio
      seg(arr, a, b);
      const dx = b.z - a.z, dz = a.x - b.x, l = Math.hypot(dx, dz) || 1;
      if (Math.abs(b.y - a.y) > 0.01 && l < 0.01) { tick(arr, a, 0.015, 0); tick(arr, b, 0.015, 0); }
      else { tick(arr, a, (dx / l) * 0.015, (dz / l) * 0.015); tick(arr, b, (dx / l) * 0.015, (dz / l) * 0.015); }
      lbl(a.clone().add(b).multiplyScalar(0.5), text, cls);
    };
    const y = DESK_H + 0.004, W = cm(T.width_cm), D = cm(T.depth_cm), rw = cm(T.return_w_cm), rd = cm(T.return_d_cm);
    const off = 0.05, R = T.shape === "l_right", Lf = T.shape === "l_left";
    dim(new V3(-W / 2, y, D / 2 + off), new V3(W / 2, y, D / 2 + off), `${fmtCm(W)} de ancho`, "tbl");
    const dx = R ? -W / 2 - off : W / 2 + off;
    dim(new V3(dx, y, -D / 2), new V3(dx, y, D / 2), `${fmtCm(D)} de fondo`, "tbl");
    const hx = R ? W / 2 + off : -W / 2 - off;
    dim(new V3(hx, 0, D / 2), new V3(hx, DESK_H, D / 2), `${fmtCm(DESK_H)} de alto`, "tbl");
    if (R || Lf) {
      const sx = R ? 1 : -1, xo = sx * (W / 2 + off), z1 = -D / 2 + rd;
      dim(new V3(xo, y, -D / 2), new V3(xo, y, z1), `retorno ${fmtCm(rd)}`, "tbl");
      dim(new V3(sx * (W / 2 - rw), y, z1 + off), new V3(sx * W / 2, y, z1 + off), fmtCm(rw), "tbl");
    }
    const g = selected && objects.get(selected), it = g && itemOf(selected);
    if (g && it && !g.userData.size?.floor) {
      const s = g.userData.size, dm = dimsOf(it), [ex, ez] = halfExt(s, g.rotation.y);
      const cx = g.position.x, cz = g.position.z, yy = DESK_H + 0.006;
      const r = tableRects(T).find((q) => cx >= q[0] && cx <= q[2] && cz >= q[1] && cz <= q[3]) || tableRects(T)[0];
      lbl(new V3(cx, (s.top || DESK_H) + 0.04, cz), `${fmtCm(cm(dm.w))} × ${fmtCm(cm(dm.d))} × ${fmtCm(cm(dm.h))}`.replace(/ cm ×/g, " ×"), "sel");
      const gaps = [
        [cx - ex - r[0], new V3(r[0], yy, cz), new V3(cx - ex, yy, cz)], [r[2] - (cx + ex), new V3(cx + ex, yy, cz), new V3(r[2], yy, cz)],
        [cz - ez - r[1], new V3(cx, yy, r[1]), new V3(cx, yy, cz - ez)], [r[3] - (cz + ez), new V3(cx, yy, cz + ez), new V3(cx, yy, r[3])],
      ];
      for (const [gp, a, b] of gaps) {
        if (Math.abs(gp) < 0.003) continue;
        if (gp < 0) dim(a, b, `sobresale ${fmtCm(-gp)}`, "bad", bad);
        else dim(a, b, fmtCm(gp), "gap");
      }
    }
    for (const [arr, color] of [[ok, accent()], [bad, new THREE.Color(0xe5484d)]]) {
      if (!arr.length) continue;
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      const ln = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
      ln.renderOrder = 999; ln.raycast = () => {}; mGroup.add(ln);
    }
    dirty();
  }
  const v = new V3();
  function placeLabels() {
    if (!mLabels.length) return;
    const w = container.clientWidth, h = container.clientHeight;
    for (const l of mLabels) {
      v.copy(l.p).project(camera);
      const off = v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2;
      l.el.style.display = off ? "none" : "";
      if (!off) l.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%)`;
    }
  }
  function toggleMeasures(on) {
    measuresOn = on == null ? !measuresOn : !!on;
    buildMeasures();
    return measuresOn;
  }

  function update(items) {
    current = (items || []).slice();
    const ids = new Set(current.map((i) => i.id));
    for (const [id, g] of objects) if (!ids.has(id)) { scene.remove(g); disposeObj(g); objects.delete(id); keys.delete(id); manual.delete(id); }
    for (const it of current) {
      const p = it.pos;
      if (p && Number.isFinite(+p.x) && Number.isFinite(+p.z)) manual.set(it.id, { x: +p.x, z: +p.z, rot: +p.rot || 0 });
      else manual.delete(it.id);
    }
    held = heldMap(current);
    const rebuild = (it, ctx) => {
      const key = JSON.stringify([it.type, it.model, it.specs, it.color, it.orient, dimsOf(it), ctx, DESK_H, DESK_T]);
      if (keys.get(it.id) === key) return;
      const isNew = !objects.has(it.id);
      if (!isNew) { const old = objects.get(it.id); scene.remove(old); disposeObj(old); }
      const g = build(it, ctx);
      objects.set(it.id, g); keys.set(it.id, key); scene.add(g);
      if (isNew && !reducedMotion() && !LATE.has(it.type)) spawn.set(it.id, performance.now());
    };
    for (const it of current) if (!LATE.has(it.type)) rebuild(it, ctxFor(it, current));
    let L = layout(current, objects, T, held);
    for (const it of current) if (it.type === "speakers" || it.type === "arm") rebuild(it, ctxFor(it, current, { span: round3(L.span) }));
    L = layout(current, objects, T, held);   // ya con todo construido; después, lo que va encima del monitor
    lastBackZ = L.backZ;
    setDesk();
    for (const it of current) {
      if (FOLLOW.has(it.type)) continue;
      const g = objects.get(it.id); if (!g) continue;
      const m = manual.get(it.id), p = L.pos.get(it.id);
      if (m) { g.rotation.y = wrapRot(m.rot); const [x, z] = clampPos(g, m.x, m.z, m.rot); g.position.set(x, g.position.y, z); }
      else if (p) { g.position.set(p[0], g.position.y, p[1]); g.rotation.y = p[2] || 0; }
    }
    for (const it of current) if (FOLLOW.has(it.type)) rebuild(it, ctxFor(it, current));
    placeFollowers();
    updateArms();
    setRGB(); setDecor();
    applyMode();
    if (selected && !ids.has(selected)) selected = null;
    applyMarks(); buildMeasures();
    dirty();
  }

  function setStyle(style) {
    const s = { ...(style || {}) };
    for (const k of ["desk", "legs", "width", "depth"]) delete s[k];   // ahora van en la mesa (setTable)
    st = { ...DEFAULT_STYLE, ...s };
    setRoom();
    update(current);
  }
  function setTable(t) {
    T = normTable(t);
    DESK_H = cm(T.height_cm); DESK_T = cm(T.top_cm);
    setRoom();
    update(current);
    fitCamera(true);
  }

  /* intensidades según la luz elegida (también para objetos recién creados) */
  function applyMode() {
    const m = MODES[st.light] || MODES.day;
    hemi.color.set(m.hemi[0]); hemi.groundColor.set(dark && st.light === "day" ? 0x55524c : m.hemi[1]); hemi.intensity = m.hemi[2];
    const b = tableBox(T), k = Math.max(1, (b.x1 - b.x0) / 1.6);
    sun.color.set(m.sun[0]); sun.intensity = m.sun[1]; sun.position.set(m.sun[2][0] * k, m.sun[2][1] * k, m.sun[2][2] * k);
    renderer.toneMappingExposure = m.exp;
    screenGlow.intensity = current.some((i) => SCREENS.has(i.type)) ? m.glow : 0;
    screenGlow.position.set(0, DESK_H + 0.35, lastBackZ + 0.3);
    scene.traverse((o) => {
      if (o.isLight && o.userData.kind === "bar") o.intensity = m.bar;
      if (o.isLight && o.userData.kind === "lamp") o.intensity = m.lamp;
      if (o.isLight && o.userData.kind === "pcglow") o.intensity = st.light === "day" ? 0.4 : 1.1;
      if (!o.material) return;
      for (const mt of [].concat(o.material)) {
        if (mt.userData?.screen) { mt.emissiveIntensity = m.screen; mt.envMapIntensity = 0.2; continue; }
        if (mt.userData?.backlit) mt.emissiveIntensity = st.light === "night" ? 0.45 : st.light === "evening" ? 0.15 : 0;
        if (mt.userData?.lampBulb) mt.emissiveIntensity = m.lamp ? 2 : 0;
        if (mt.isMeshStandardMaterial) mt.envMapIntensity = mt.userData?.glass ? Math.max(0.6, m.env) : m.env;
      }
    });
    if (rgbMats[1]) rgbMats[1].opacity = m.rgbA;
    if (rgbMats[2]) rgbMats[2].intensity = st.light === "day" ? 0.4 : 1.2;
    dirty();
  }
  const onTheme = () => { dark = isDarkTheme(); roomKey = ""; setRoom(); applyMode(); applyMarks(); buildMeasures(); };
  window.addEventListener("findgnga:theme", onTheme);

  function select(id) {
    selected = id && objects.has(id) ? id : null;
    applyMarks(); buildMeasures();
  }

  /* Vista previa translúcida de un accesorio recomendado */
  function preview(it) {
    if (ghost) { scene.remove(ghost); disposeObj(ghost); ghost = null; }
    if (!it) { dirty(); return; }
    const all = [...current, it];
    ghost = build(it, ctxFor(it, all, { span: 0.45 }));
    ghost.traverse((o) => {
      if (!o.material) return;
      o.material = [].concat(o.material).map((m) => { const c = m.clone(); c.userData = {}; c.transparent = true; c.opacity = 0.45; c.depthWrite = false; return c; });
      if (o.material.length === 1) o.material = o.material[0];
      o.castShadow = false;
      o.userData.itemId = null;
    });
    const host = hostOf(current);
    if (FOLLOW.has(it.type)) { if (host) { ghost.position.copy(host.position); ghost.rotation.y = host.rotation.y; } }
    else {
      const { pos } = layout(all, new Map([...objects, [it.id, ghost]]), T, heldMap(all));
      const p = pos.get(it.id); if (p) { ghost.position.set(p[0], 0, p[1]); ghost.rotation.y = p[2] || 0; }
    }
    scene.add(ghost); dirty();
  }

  function afterMove(id) { placeFollowers(); updateArms(); if (selected === id) buildMeasures(); dirty(); }
  function commitMove(id, g, notify = true) {
    g.rotation.y = wrapRot(g.rotation.y);   // el servidor admite ±7 rad: que no se acumulen vueltas
    const p = { x: round3(g.position.x), z: round3(g.position.z), rot: round3(g.rotation.y) };
    manual.set(id, p);
    const it = itemOf(id); if (it) it.pos = p;
    if (notify) onMove?.(id, p);
    return p;
  }
  function rotate(id, delta) {
    const g = objects.get(id), it = itemOf(id);
    if (!g || !movable(it)) return;
    g.rotation.y = round3(g.rotation.y + delta);
    const [x, z] = clampPos(g, g.position.x, g.position.z); g.position.x = x; g.position.z = z;
    afterMove(id); commitMove(id, g); setDecor(); applyMode();
  }
  function nudge(id, dx, dz) {
    const g = objects.get(id), it = itemOf(id);
    if (!g || !movable(it)) return null;
    const [x, z] = clampPos(g, g.position.x + dx, g.position.z + dz);
    g.position.x = x; g.position.z = z;
    afterMove(id);
    return commitMove(id, g);
  }
  function setPos(id, p) {
    const g = objects.get(id), it = itemOf(id);
    if (!g || !movable(it) || !p) return null;
    if (Number.isFinite(+p.rot)) g.rotation.y = +p.rot;
    const [x, z] = clampPos(g, Number.isFinite(+p.x) ? +p.x : g.position.x, Number.isFinite(+p.z) ? +p.z : g.position.z);
    g.position.x = x; g.position.z = z;
    afterMove(id); setDecor(); applyMode();
    return commitMove(id, g, false);
  }
  function describe() {
    return current.map((it) => {
      const g = objects.get(it.id);
      const pos = g ? { x: round3(g.position.x), z: round3(g.position.z), rot: round3(g.rotation.y) } : it.pos || null;
      return { id: it.id, pos, span: g?.userData.span ?? null, orient: it.orient || null, auto: !manual.has(it.id) };
    });
  }

  /* ratón: seleccionar, arrastrar para mover, doble clic para acercar y etiqueta al pasar por encima */
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(), plane = new THREE.Plane(new V3(0, 1, 0), -DESK_H);
  function setRay(ev) {
    const r = canvas.getBoundingClientRect();
    ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
  }
  function pick(ev) {
    setRay(ev);
    const hit = ray.intersectObjects([...objects.values()], true).find((h) => h.object.userData.itemId && h.object.visible);
    return hit ? hit.object.userData.itemId : null;
  }
  function planeHit(ev, y) { setRay(ev); plane.constant = -y; return ray.ray.intersectPlane(plane, new V3()); }
  let down = null, drag = null;
  const onDown = (e) => {
    if (e.target !== canvas) return;
    down = [e.clientX, e.clientY];
    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
    const id = pick(e); if (!id) return;
    const it = itemOf(id);
    if (!movable(it) || (it.type === "mousepad" && selected !== id)) return;
    const g = objects.get(id), y = g.userData.size?.floor ? 0 : DESK_H;
    const hit = planeHit(e, y); if (!hit) return;
    drag = { id, g, y, off: new V3(g.position.x - hit.x, 0, g.position.z - hit.z), moved: false, x0: e.clientX, y0: e.clientY, pid: e.pointerId };
    controls.enabled = false;
  };
  container.addEventListener("pointerdown", onDown, true);   // antes que OrbitControls
  const onPMove = (e) => {
    if (drag) {
      if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) {
        drag.moved = true; try { canvas.setPointerCapture(drag.pid); } catch (_) { /* sin captura */ }
        tip.classList.remove("on"); canvas.style.cursor = "grabbing";
      }
      if (drag.moved) {
        const hit = planeHit(e, drag.y);
        if (hit) {
          const [x, z] = clampPos(drag.g, hit.x + drag.off.x, hit.z + drag.off.z);
          drag.g.position.x = x; drag.g.position.z = z;
          afterMove(drag.id);
        }
      }
      return;
    }
    const id = pick(e), it = id && itemOf(id);
    canvas.style.cursor = id ? (movable(it) ? "move" : "pointer") : "grab";
    if (it) {
      const r = container.getBoundingClientRect();
      tip.textContent = nameFor(it); tip.style.left = `${e.clientX - r.left + 12}px`; tip.style.top = `${e.clientY - r.top + 12}px`;
      tip.classList.add("on");
    } else tip.classList.remove("on");
    onHover?.(id);
  };
  canvas.addEventListener("pointermove", onPMove);
  const onUp = (e) => {
    const d = drag; drag = null;
    controls.enabled = true;
    if (d) {
      try { canvas.releasePointerCapture(d.pid); } catch (_) { /* nada */ }
      if (d.moved) {
        canvas.style.cursor = "move";
        commitMove(d.id, d.g); setDecor(); applyMode();
        if (selected !== d.id) { select(d.id); onSelect?.(d.id); } else buildMeasures();
        down = null;
        return;
      }
    }
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    down = null;
    const id = pick(e); select(id); onSelect?.(selected);
  };
  canvas.addEventListener("pointerup", onUp);
  const onCancel = () => { drag = null; controls.enabled = true; };
  const onLeave = () => tip.classList.remove("on");
  const onDbl = (e) => { const id = pick(e); if (id) { focus(id); onSelect?.(id); } };
  canvas.addEventListener("pointercancel", onCancel);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("dblclick", onDbl);

  /* teclado: todo lo que se hace con el ratón */
  let sayT = 0;
  const sayPos = (id) => {
    clearTimeout(sayT);
    sayT = setTimeout(() => {
      const g = objects.get(id), it = itemOf(id); if (!g || !it) return;
      const deg = Math.round(THREE.MathUtils.radToDeg(g.rotation.y)) % 360;
      say(`${nameFor(it)}: ${fmtCm(g.position.x)} desde el centro, ${fmtCm(g.position.z)} hacia ti, giro ${deg}°`);
    }, 450);
  };
  function orbit(dAz, dPol) {
    const off = camera.position.clone().sub(controls.target), sph = new THREE.Spherical().setFromVector3(off);
    sph.theta += dAz; sph.phi = clamp(sph.phi + dPol, 0.05, controls.maxPolarAngle);
    camera.position.copy(controls.target).add(new V3().setFromSpherical(sph));
    userMoved = true; controls.update(); dirty();
  }
  function zoom(f) {
    const off = camera.position.clone().sub(controls.target);
    off.setLength(clamp(off.length() * f, controls.minDistance, controls.maxDistance));
    userMoved = true;
    flyTo({ pos: controls.target.clone().add(off), target: controls.target.clone() }, false, 220);
  }
  /* las flechas siguen a la cámara: ↑ aleja de ti en pantalla, → a la derecha de la pantalla */
  function screenAxes() {
    const f = controls.target.clone().sub(camera.position); f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    const fw = Math.abs(f.x) > Math.abs(f.z) ? new V3(Math.sign(f.x), 0, 0) : new V3(0, 0, Math.sign(f.z));
    return { fw, rt: new V3(-fw.z, 0, fw.x) };
  }
  function movableIds() { return current.filter(movable).map((i) => i.id).filter((id) => objects.has(id)); }
  const onCanvasKey = (e) => {
    if (e.altKey && e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (e.ctrlKey || e.metaKey) return;
    const it = selected && itemOf(selected), k = e.key;
    let done = true;
    if (k.startsWith("Arrow")) {
      if (movable(it)) {
        const step = e.altKey ? 0.001 : e.shiftKey ? 0.1 : 0.01, { fw, rt } = screenAxes();
        const dir = k === "ArrowUp" ? fw : k === "ArrowDown" ? fw.clone().negate() : k === "ArrowRight" ? rt : rt.clone().negate();
        nudge(selected, dir.x * step, dir.z * step); sayPos(selected);
      } else {
        const a = e.shiftKey ? 0.26 : 0.09;
        if (k === "ArrowLeft") orbit(-a, 0); else if (k === "ArrowRight") orbit(a, 0);
        else if (k === "ArrowUp") orbit(0, -a * 0.6); else orbit(0, a * 0.6);
      }
    } else if (/^[qQ[]$/.test(k) && movable(it)) { rotate(selected, e.shiftKey ? Math.PI / 36 : Math.PI / 12); sayPos(selected); }
    else if (/^[eE\]]$/.test(k) && movable(it)) { rotate(selected, e.shiftKey ? -Math.PI / 36 : -Math.PI / 12); sayPos(selected); }
    else if (k === "Escape" && selected) { select(null); onSelect?.(null); say("Ningún objeto elegido"); }
    else if (k === "n" || k === "N") {
      const ids = movableIds(); if (!ids.length) return;
      const n = ids.length, i = ids.indexOf(selected), next = ids[i < 0 ? (e.shiftKey ? n - 1 : 0) : (i + (e.shiftKey ? n - 1 : 1)) % n];
      select(next); onSelect?.(next); say(`Elegido: ${nameFor(itemOf(next))}`);
    } else if (k === "Enter" && selected) focus(selected);
    else if (k >= "1" && k <= "4") { const n = ["iso", "front", "top", "side"][+k - 1]; cameraPreset(n); say(VIEW_NAMES[n]); }
    else if (k === "m" || k === "M") { const on = toggleMeasures(); onMeasures?.(on); say(on ? "Medidas visibles" : "Medidas ocultas"); }
    else if (k === "+" || k === "=") zoom(0.72);
    else if (k === "-" || k === "_") zoom(1.4);
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); }
  };
  canvas.addEventListener("keydown", onCanvasKey);
  const onKey = (e) => {   // Q/E giran lo elegido aunque el foco esté en la lista
    if (e.defaultPrevented || !selected || !container.isConnected || e.target === canvas || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))) return;
    const step = Math.PI / 12;
    if (/^[qQ[]$/.test(e.key)) { rotate(selected, step); e.preventDefault(); }
    else if (/^[eE\]]$/.test(e.key)) { rotate(selected, -step); e.preventDefault(); }
  };
  window.addEventListener("keydown", onKey);

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.fov = w / h < 1 ? 55 : 38; camera.updateProjectionMatrix();
    fitCamera(false); dirty();
  }
  const ro = new ResizeObserver(resize); ro.observe(container);
  const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => { visible = es.some((x) => x.isIntersecting); if (visible) dirty(); }) : null;
  io?.observe(container);
  const onVis = () => { if (!document.hidden) dirty(); };
  document.addEventListener("visibilitychange", onVis);

  /* bucle: sólo se dibuja cuando algo cambia (cámara, objetos, animaciones) */
  let raf = 0, alive = true;
  const rgbColor = new THREE.Color();
  function render() { renderer.render(scene, camera); placeLabels(); }
  function loop(t) {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    if (!visible || document.hidden) return;
    let need = needs; needs = false;
    if (tween) {
      const k = Math.min(1, (t - tween.s) / tween.dur), e = easeInOut(Math.max(0, k));
      camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.q0, tween.q1, e);
      if (k >= 1) tween = null;
      need = true;
    }
    if (spawn.size) {
      for (const [id, t0] of spawn) {
        const g = objects.get(id); if (!g) { spawn.delete(id); continue; }
        const k = Math.min(1, Math.max(0, (t - t0) / 450)), e = 1 - Math.pow(1 - k, 3);
        g.scale.setScalar(0.6 + 0.4 * e); g.position.y = (1 - e) * 0.15;
        if (k >= 1) { g.scale.setScalar(1); g.position.y = 0; spawn.delete(id); }
      }
      placeFollowers(); updateArms();   // brazos y luz siguen al monitor mientras aparece
      need = true;
    }
    if (rgbMats.length && !reducedMotion()) {
      rgbColor.setHSL((t / 9000) % 1, 0.85, 0.55);
      rgbMats[0].color.copy(rgbColor); rgbMats[1].color.copy(rgbColor); rgbMats[2].color.copy(rgbColor);
      need = true;
    }
    if (controls.update()) need = true;
    if (need) render();
  }
  setRoom(); setDesk(); applyMode(); resize();
  raf = requestAnimationFrame(loop);
  render();   // primer fotograma ya, sin esperar al bucle

  return {
    webgl: true,
    update, setStyle, setTable, select, focus, preview, rotate, nudge, setPos, cameraPreset, toggleMeasures, markIssues, describe,
    zoomIn: () => zoom(0.72), zoomOut: () => zoom(1.4),
    get selected() { return selected; },
    get measures() { return measuresOn; },
    snapshot() { render(); return canvas.toDataURL("image/png"); },
    dispose() {
      alive = false; cancelAnimationFrame(raf); clearTimeout(sayT); ro.disconnect(); io?.disconnect(); controls.dispose();
      container.removeEventListener("pointerdown", onDown, true);
      canvas.removeEventListener("pointermove", onPMove); canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel); canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("dblclick", onDbl); canvas.removeEventListener("keydown", onCanvasKey);
      window.removeEventListener("keydown", onKey); window.removeEventListener("findgnga:theme", onTheme);
      document.removeEventListener("visibilitychange", onVis);
      disposeObj(scene);
      envTex.dispose(); pmrem.dispose();
      renderer.dispose(); canvas.remove(); tip.remove(); overlay.remove();
    },
  };
}

window.Desk3D = {
  mount, dimsOf, normTable, TABLE_DEFAULT, TABLE_LIMITS, TABLE_ENUMS, NAMED_COLORS, KEYS_HELP,
  WALLPAPERS: Object.keys(WALLPAPERS), DESKS: Object.keys(DESKS), FLOORS: Object.keys(FLOORS),
};
window.dispatchEvent(new Event("desk3d-ready"));
