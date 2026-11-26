/* FindGnga – escritorio virtual en 3D (Three.js r160, sin build).
 *
 * Cada dispositivo se dibuja con proporciones reales a partir de sus datos
 * (pulgadas y formato del monitor, tamaño del portátil, edición de la PS5…).
 * Unidades: metros. x a la derecha, z hacia el usuario, y hacia arriba.
 *
 *   const d = Desk3D.mount(container, { onSelect, onHover, onMove });
 *   d.update(items)   items: [{id, type, model, specs, color, pos:{x,z,rot}}]
 *   d.setStyle(style) mesa, patas, suelo, pared, luz, fondo de pantalla, decoración, RGB
 *   d.select(id) · d.preview(item) · d.rotate(id, rad) · d.snapshot() · d.dispose()
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/RoomEnvironment.js";

const DESK_H = 0.75, DESK_T = 0.035;
const V3 = THREE.Vector3;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round3 = (v) => Math.round(v * 1000) / 1000;

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

const RATIO = { "16:9": 16 / 9, "16:10": 1.6, "21:9": 21 / 9, "32:9": 32 / 9, "3:2": 1.5 };

/* ------------------------------------------------------------------ modelos */

function monitor(it, ctx = {}) {
  const s = it.specs || {};
  const ratio = RATIO[s.aspect] || 16 / 9;
  const diag = (+s.size_in || 27) * 0.0254;
  const h = diag / Math.sqrt(1 + ratio * ratio), w = h * ratio;
  const g = new THREE.Group();
  const apple = /studio display|pro display/i.test(it.model || "");
  const body = bodyMat(it, apple ? 0xc9ccd1 : 0x17181b, apple ? { metalness: 0.75, roughness: 0.28 } : { roughness: 0.42, metalness: 0.15 });
  const standM = apple || hexOf(it) ? body : M.space;
  const held = !!ctx.held;
  const lift = DESK_H + (held ? 0.17 : (s.size_in >= 40 ? 0.1 : 0.13));
  const cy = lift + h / 2;
  const curved = !!s.curved || s.aspect === "32:9";
  let backZ, topZ = 0;
  if (curved) {
    const R = s.aspect === "32:9" ? 1.0 : 1.5, theta = w / R;
    body.side = THREE.DoubleSide;
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.014, R + 0.014, h + 0.016, 64, 1, true, Math.PI - theta / 2 - 0.008, theta + 0.016), body);
    shell.castShadow = true;
    const scr = new THREE.Mesh(new THREE.CylinderGeometry(R, R, h, 64, 1, true, Math.PI - theta / 2, theta), screenMat(ctx.wallpaper, it.model, ratio));
    scr.material.side = THREE.BackSide;
    scr.material.map.wrapS = THREE.RepeatWrapping; scr.material.map.repeat.x = -1;  // por dentro se vería al revés
    for (const m of [shell, scr]) { m.position.set(0, cy, R - 0.02); g.add(m); }
    g.add(at(box(w * 0.32, h * 0.6, 0.05, body, 0.018), 0, cy - h * 0.05, -0.05));
    backZ = -0.075; topZ = -0.02;
  } else {
    g.add(at(box(w + 0.008, h + 0.02, 0.012, body, 0.003), 0, cy - 0.006, 0));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screenMat(ctx.wallpaper, it.model, ratio));
    g.add(at(scr, 0, cy, 0.0062));
    g.add(at(box(w * 0.8, h * 0.76, 0.03, body, 0.012), 0, cy - h * 0.04, -0.02));
    if (apple) g.add(at(new THREE.Mesh(new THREE.CircleGeometry(0.018, 24), M.silver), 0, cy, -0.0352)).rotation.y = Math.PI;
    backZ = -0.035;
  }
  if (held) g.add(at(box(0.1, 0.1, 0.012, M.dark, 0.003), 0, cy, backZ - 0.006));
  else {
    const neckH = cy - DESK_H;
    const neck = at(box(apple ? 0.12 : 0.055, neckH, apple ? 0.012 : 0.024, standM, 0.008), 0, DESK_H + neckH / 2, backZ - 0.025);
    neck.rotation.x = apple ? -0.18 : -0.06; g.add(neck);
    if ((s.refresh_hz || 60) >= 144 && !apple) {
      for (const sx of [-1, 1]) { const leg = at(box(0.03, 0.012, 0.23, standM, 0.005), sx * 0.075, DESK_H + 0.006, backZ + 0.02); leg.rotation.y = sx * 0.6; g.add(leg); }
    } else g.add(at(box(apple ? 0.16 : clamp(w * 0.4, 0.2, 0.3), 0.01, 0.2, standM, 0.005), 0, DESK_H + 0.005, backZ + 0.03));
  }
  g.userData.size = { w: w + 0.02, d: 0.24, top: lift + h + 0.01, topZ, cy, h, backZ, screenW: w };
  return g;
}

function laptop(it, ctx = {}) {
  const s = it.specs || {};
  const mac = s.platform === "mac";
  const inch = +s.screen_in || (mac ? 14 : 15);
  const w = inch * 0.0254 * 0.86, d = w * 0.69, sh = w * 0.62;
  const def = mac ? (s.model_line === "air" ? 0xc9ccd1 : 0x6b6e73) : 0x2c2e33;
  const body = bodyMat(it, def, mac ? { metalness: 0.72, roughness: 0.3 } : { roughness: 0.5, metalness: 0.2 });
  const g = new THREE.Group();
  g.add(at(box(w, 0.015, d, body, 0.006), 0, DESK_H + 0.0075, 0));
  g.add(at(box(w * 0.88, 0.0012, d * 0.42, M.black), 0, DESK_H + 0.0152, -d * 0.1));
  const cols = 14, kw = (w * 0.86) / cols, rows = 6, kd = (d * 0.4) / rows;
  const keys = new THREE.InstancedMesh(new THREE.BoxGeometry(kw * 0.82, 0.0012, kd * 0.78), M.key, rows * cols);
  const m4 = new THREE.Matrix4(); let i = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
    keys.setMatrixAt(i++, m4.makeTranslation(-w * 0.43 + kw * (c + 0.5), DESK_H + 0.0162, -d * 0.1 - d * 0.2 + kd * (r + 0.5)));
  g.add(keys);
  g.add(at(box(w * 0.42, 0.0008, d * 0.3, mat(0x8b8e94, { roughness: 0.3, metalness: 0.3 })), 0, DESK_H + 0.0153, d * 0.27));
  const hinge = new THREE.Group(); hinge.position.set(0, DESK_H + 0.015, -d / 2); g.add(hinge);
  hinge.add(at(box(w, sh, 0.006, body, 0.004), 0, sh / 2, -0.003));
  hinge.add(at(new THREE.Mesh(new THREE.PlaneGeometry(w * 0.985, sh * 0.975), M.black), 0, sh / 2, 0.0003));
  hinge.add(at(new THREE.Mesh(new THREE.PlaneGeometry(w * 0.95, sh * 0.9), screenMat(ctx.wallpaper, it.model, w / sh)), 0, sh / 2 + sh * 0.02, 0.0006));
  if (mac) { const logo = new THREE.Mesh(new THREE.CircleGeometry(0.012, 24), mat(0xe6e8eb, { metalness: 0.9, roughness: 0.15 })); logo.rotation.y = Math.PI; hinge.add(at(logo, 0, sh / 2, -0.0062)); }
  const a = 0.32; hinge.rotation.x = -a;
  g.userData.size = { w, d, top: DESK_H + 0.015 + sh * Math.cos(a), topZ: -d / 2 - sh * Math.sin(a), screenW: w * 0.95 };
  return g;
}

function computer(it, ctx = {}) {
  const s = it.specs || {};
  const g = new THREE.Group();
  if (s.platform === "mac") {
    if (s.model_line === "imac") {
      const ratio = 16 / 9, diag = 24 * 0.0254, h = diag / Math.sqrt(1 + ratio * ratio), w = h * ratio;
      const body = bodyMat(it, 0x9fc0e6, { roughness: 0.32, metalness: 0.4 });
      const cy = DESK_H + 0.2 + h / 2;
      g.add(at(box(w + 0.03, h + 0.09, 0.012, body, 0.006), 0, cy - 0.03, 0));
      g.add(at(new THREE.Mesh(new THREE.PlaneGeometry(w + 0.024, h + 0.024), M.white), 0, cy, 0.0062));
      g.add(at(new THREE.Mesh(new THREE.PlaneGeometry(w, h), screenMat(ctx.wallpaper, it.model, ratio)), 0, cy, 0.0064));
      const blade = at(box(0.14, 0.26, 0.012, body, 0.004), 0, DESK_H + 0.13, -0.06); blade.rotation.x = -0.2; g.add(blade);
      g.add(at(box(0.15, 0.008, 0.16, body, 0.003), 0, DESK_H + 0.004, -0.04));
      g.userData.size = { w: w + 0.03, d: 0.18, top: cy + h / 2 + 0.012, topZ: 0, screenW: w };
      return g;
    }
    const studio = s.model_line === "studio", small = !studio && (s.chip_gen || 4) >= 4;
    const w = studio || !small ? 0.197 : 0.127, h = studio ? 0.095 : small ? 0.05 : 0.036;
    const body = bodyMat(it, 0xc9ccd1, { metalness: 0.75, roughness: 0.28 });
    g.add(at(box(w, h, w, body, studio ? 0.02 : 0.014), 0, DESK_H + h / 2, 0));
    g.add(at(box(0.004, 0.004, 0.001, M.whiteLed), -w / 2 + 0.02, DESK_H + 0.012, w / 2 + 0.001));
    if (studio || small) for (const x of [0.012, 0.03]) g.add(at(box(0.009, 0.004, 0.001, M.black), x, DESK_H + 0.016, w / 2 + 0.0005));
    g.userData.size = { w, d: w, top: DESK_H + h };
    return g;
  }
  // Torre de PC (en el suelo, al lado de la mesa), con cristal lateral y luz RGB
  const W = 0.21, H = 0.46, D = 0.44;
  const body = bodyMat(it, 0x141518, { roughness: 0.35, metalness: 0.3 });
  g.add(at(box(W, H, D, body, 0.01), 0, H / 2, 0));
  g.add(at(box(0.004, H * 0.86, D * 0.9, M.glass), -W / 2 - 0.002, H / 2, 0));
  const fanCol = [0xff5a1f, 0x7b5cff, 0x2ad1ff];
  fanCol.forEach((c, i) => {
    const fan = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.006, 8, 32), new THREE.MeshBasicMaterial({ color: c }));
    fan.rotation.y = Math.PI / 2; fan.position.set(-W / 2 + 0.012, 0.1 + i * 0.13, D / 2 - 0.08); fan.userData.rgb = i; g.add(fan);
  });
  const gpu = at(box(0.004, 0.04, D * 0.6, M.dark), -W / 2 + 0.03, H * 0.42, -0.02); g.add(gpu);
  const strip = at(box(0.003, 0.004, D * 0.6, new THREE.MeshBasicMaterial({ color: 0x7b5cff })), -W / 2 + 0.028, H * 0.42 - 0.022, -0.02); strip.userData.rgb = 3; g.add(strip);
  const glow = new THREE.PointLight(0xff6a2a, 0.6, 0.9); glow.position.set(-W / 2 - 0.1, H / 2, 0); glow.userData.kind = "pcglow"; g.add(glow);
  g.add(at(box(0.012, 0.012, 0.002, M.blueLed), 0.05, H - 0.04, D / 2 + 0.001));
  g.userData.size = { w: W, d: D, top: H, floor: true };
  return g;
}

function ps5(it) {
  const s = it.specs || {};
  const ed = s.edition || "standard";
  const model = s.model || (ed === "pro" ? "pro" : "slim");
  const dims = model === "fat" ? { H: 0.39, W: ed === "digital" ? 0.092 : 0.104, D: 0.26 }
    : model === "pro" ? { H: 0.388, W: 0.089, D: 0.216 } : { H: 0.358, W: ed === "digital" ? 0.08 : 0.096, D: 0.216 };
  const { H, W, D } = dims;
  const cover = bodyMat(it, 0xf3f3f1, { roughness: 0.38 });
  const g = new THREE.Group();
  const y0 = DESK_H + 0.012;
  g.add(at(box(W * 0.5, H * 0.95, D * 0.93, M.black, 0.01), 0, y0 + H * 0.475, 0));
  for (const sx of [-1, 1]) {
    if (model === "fat") {
      const p = at(box(W * 0.24, H * 1.03, D * 1.02, cover, 0.03), sx * W * 0.38, y0 + H * 0.5, 0); p.rotation.z = sx * 0.03; g.add(p);
    } else {
      const lowH = H * 0.76;
      g.add(at(box(W * 0.24, lowH, D, cover, 0.022), sx * W * 0.38, y0 + lowH / 2, 0));
      const gloss = cover.clone(); gloss.roughness = 0.08;
      g.add(at(box(W * 0.24, H - lowH - 0.003, D, gloss, 0.02), sx * W * 0.38, y0 + lowH + (H - lowH) / 2 + 0.0015, 0));
    }
    g.add(at(box(0.003, H * 0.7, D * 0.5, M.blueLed), sx * W * 0.255, y0 + H * 0.5, D * 0.2));
  }
  if (model === "pro") g.add(at(box(W * 1.02, 0.012, D * 1.01, M.black), 0, y0 + H * 0.5, 0));
  if (ed !== "digital") g.add(at(box(0.002, 0.004, D * 0.55, M.black), W * 0.5 + 0.0005, y0 + H * 0.2, 0));
  g.add(at(cyl(W * 0.9, W * 0.9, 0.012, M.black, 32), 0, DESK_H + 0.006, 0));
  g.userData.size = { w: W, d: D, top: y0 + H };
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

function keyboard(it) {
  const s = it.specs || {};
  const mech = !!s.mechanical;
  const size = s.size || (mech ? "tkl" : "full");
  const rows = kbRows(size);
  const u = 0.019, hasF = size !== "60";
  const units = Math.max(...rows.map((r) => r.reduce((a, b) => a + Math.abs(b), 0)));
  const w = units * u + 0.018, d = rows.length * u + (hasF ? u * 0.25 : 0) + 0.018;
  const baseH = mech ? 0.026 : 0.011, keyH = mech ? 0.009 : 0.0035;
  const base = bodyMat(it, mech ? 0x2a2c31 : 0x34363c, { roughness: 0.45, metalness: mech ? 0.2 : 0.35 });
  const light = isLightHex(base.color.getHex());
  const keyM = mat(light ? 0xf0f0f2 : mech ? 0xdcdde0 : 0x26272b, { roughness: 0.55 });
  if (s.backlit) { keyM.emissive = new THREE.Color(0xffffff); keyM.emissiveIntensity = 0; keyM.userData.backlit = true; }
  if (mech && !hexOf(it)) keyM.color.set(0xdcdde0);
  const g = new THREE.Group();
  const b = at(box(w, baseH, d, base, mech ? 0.006 : 0.004), 0, DESK_H + baseH / 2, 0);
  if (mech) b.rotation.x = 0.03;
  g.add(b);
  const total = rows.reduce((a, r) => a + r.filter((x) => x > 0).length, 0);
  const keys = new THREE.InstancedMesh(new RoundedBoxGeometry(u - 0.0035, keyH, u - 0.0035, 2, Math.min(0.002, keyH * 0.45)), keyM, total);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(); let i = 0;
  rows.forEach((r, ri) => {
    let x = -units * u / 2;
    const z = -d / 2 + 0.009 + u * (ri + 0.5) + (hasF && ri > 0 ? u * 0.25 : 0);
    for (const k of r) {
      const kw = Math.abs(k) * u;
      if (k > 0) m4.compose(new V3(x + kw / 2, DESK_H + baseH + keyH / 2 + (mech ? (z + d / 2) * 0.03 : 0), z), q, new V3((kw - 0.0035) / (u - 0.0035), 1, 1)), keys.setMatrixAt(i++, m4);
      x += kw;
    }
  });
  keys.castShadow = true; g.add(keys);
  g.userData.size = { w, d, top: DESK_H + baseH + keyH };
  return g;
}

function mouse(it) {
  const s = it.specs || {};
  const g = new THREE.Group();
  const body = bodyMat(it, 0x2c2e33, { roughness: 0.45, metalness: 0.15 });
  const sph = (sx, sy, sz, m = body) => { const o = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), m); o.scale.set(sx, sy, sz); o.castShadow = true; return o; };
  if (s.vertical) {
    const m = sph(0.026, 0.045, 0.06); m.rotation.z = -0.45; g.add(at(m, 0, DESK_H + 0.028, 0));
    g.add(at(sph(0.006, 0.01, 0.012, M.silver), 0.02, DESK_H + 0.055, -0.02));
    g.userData.size = { w: 0.08, d: 0.12, top: DESK_H + 0.075 };
    return g;
  }
  const big = !!s.ergonomic;
  const m = sph(big ? 0.038 : 0.031, big ? 0.026 : 0.02, big ? 0.064 : 0.058);
  if (big) m.rotation.z = -0.12;
  g.add(at(m, 0, DESK_H + 0.006, 0));
  g.add(at(box(0.0015, 0.004, 0.035, M.black), 0, DESK_H + (big ? 0.03 : 0.025), -0.03));
  const wheel = cyl(0.007, 0.007, 0.005, M.silver, 16); wheel.rotation.z = Math.PI / 2; g.add(at(wheel, 0, DESK_H + (big ? 0.03 : 0.025), -0.022));
  if (big) {
    g.add(at(sph(0.014, 0.008, 0.03), -0.035, DESK_H + 0.012, 0.01));
    const tw = cyl(0.008, 0.008, 0.004, M.silver, 16); tw.rotation.x = Math.PI / 2; g.add(at(tw, -0.036, DESK_H + 0.024, -0.004));
  }
  if (s.gaming) g.add(at(box(0.012, 0.002, 0.012, M.blueLed), 0, DESK_H + 0.026, 0.02)).children;
  g.userData.size = { w: big ? 0.085 : 0.07, d: 0.13, top: DESK_H + 0.035 };
  return g;
}

function phone(it, ctx = {}) {
  const s = it.specs || {};
  const g = new THREE.Group();
  const ios = s.os === "ios";
  const body = bodyMat(it, ios ? 0x55585e : 0x16171a, { metalness: 0.6, roughness: 0.3 });
  g.add(at(box(0.0715, 0.008, 0.147, body, 0.01), 0, DESK_H + 0.004, 0));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.141), screenMat(ctx.wallpaper, "", 0.066 / 0.141));
  scr.rotation.x = -Math.PI / 2; g.add(at(scr, 0, DESK_H + 0.0083, 0));
  const cam = ios ? new THREE.Mesh(new THREE.CapsuleGeometry(0.0035, 0.012, 4, 12), M.black) : new THREE.Mesh(new THREE.CircleGeometry(0.0028, 16), M.black);
  if (ios) { cam.rotation.set(-Math.PI / 2, 0, Math.PI / 2); cam.scale.y = 0.4; } else cam.rotation.x = -Math.PI / 2;
  g.add(at(cam, 0, DESK_H + 0.0086, -0.064));
  g.add(at(box(0.026, 0.004, 0.026, body, 0.006), -0.018, DESK_H - 0.0005, -0.052));  // módulo de cámaras trasero
  g.userData.size = { w: 0.1, d: 0.16, top: DESK_H + 0.01 };
  return g;
}

function tablet(it, ctx = {}) {
  const s = it.specs || {};
  const ratio = 1.43, diag = (+s.size_in || 11) * 0.0254;
  const h = diag / Math.sqrt(1 + ratio * ratio), w = h * ratio;
  const body = bodyMat(it, s.os === "android" ? 0x2c2e33 : 0x6b6e73, { metalness: 0.65, roughness: 0.3 });
  const g = new THREE.Group();
  g.add(at(box(w * 0.5, 0.006, 0.12, M.silver, 0.003), 0, DESK_H + 0.003, 0));
  const sup = at(box(w * 0.4, 0.13, 0.006, M.silver, 0.002), 0, DESK_H + 0.06, -0.035); sup.rotation.x = -0.35; g.add(sup);
  const tilt = new THREE.Group(); tilt.position.set(0, DESK_H + 0.01, 0.02); tilt.rotation.x = -0.3; g.add(tilt);
  tilt.add(at(box(w, h, 0.006, body, 0.008), 0, h / 2, 0));
  tilt.add(at(new THREE.Mesh(new THREE.PlaneGeometry(w - 0.004, h - 0.004), M.black), 0, h / 2, 0.0031));
  tilt.add(at(new THREE.Mesh(new THREE.PlaneGeometry(w - 0.02, h - 0.02), screenMat(ctx.wallpaper, it.model, ratio)), 0, h / 2, 0.0033));
  tilt.add(at(new THREE.Mesh(new THREE.CircleGeometry(0.0018, 12), M.lens), 0, h - 0.005, 0.0034));
  g.userData.size = { w, d: 0.15, top: DESK_H + 0.01 + h * Math.cos(0.3) };
  return g;
}

function hub(it) {
  const s = it.specs || {};
  const g = new THREE.Group();
  const body = bodyMat(it, 0x6b6e73, { metalness: 0.7, roughness: 0.3 });
  if (s.kind === "dock") {
    g.add(at(box(0.043, 0.14, 0.131, body, 0.008), 0, DESK_H + 0.07, 0));
    for (let k = 0; k < 4; k++) g.add(at(box(0.009, 0.004, 0.002, M.black), 0, DESK_H + 0.03 + k * 0.016, 0.0661));
    g.add(at(box(0.004, 0.004, 0.002, M.whiteLed), 0, DESK_H + 0.12, 0.0661));
    g.userData.size = { w: 0.05, d: 0.14, top: DESK_H + 0.14 };
  } else {
    g.add(at(box(0.115, 0.014, 0.045, body, 0.006), 0, DESK_H + 0.007, 0));
    for (let k = 0; k < 4; k++) g.add(at(box(0.0015, 0.005, 0.009, M.black), 0.0576, DESK_H + 0.007, -0.016 + k * 0.011));
    const curve = new THREE.CatmullRomCurve3([new V3(-0.058, DESK_H + 0.007, 0), new V3(-0.09, DESK_H + 0.004, 0.01), new V3(-0.12, DESK_H + 0.003, -0.03)]);
    const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.003, 8), M.dark); cable.castShadow = true; g.add(cable);
    g.userData.size = { w: 0.16, d: 0.06, top: DESK_H + 0.015 };
  }
  return g;
}

function mousepad(it) {
  const s = it.specs || {};
  const w = clamp((+s.w_cm || 90) / 100, 0.2, 1.4), d = clamp((+s.d_cm || 40) / 100, 0.18, 0.7);
  const g = new THREE.Group();
  const top = bodyMat(it, 0x34363b, { roughness: 0.95 });
  const p = at(box(w, 0.003, d, top, 0.0014), 0, DESK_H + 0.0015, 0); p.castShadow = false; g.add(p);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.002, 0.0026, d + 0.002), mat(isLightHex(top.color.getHex()) ? 0x9a9a9a : 0x55575c, { roughness: 0.9 }));
  edge.position.y = DESK_H + 0.0013; edge.receiveShadow = true; g.add(edge);
  g.userData.size = { w, d, top: DESK_H + 0.003, flat: true };
  return g;
}

function headset(it) {
  const s = it.specs || {};
  const g = new THREE.Group();
  const body = bodyMat(it, 0x16171a, { roughness: 0.4, metalness: 0.15 });
  if (s.form === "in_ear") {
    const c = bodyMat(it, 0xf6f6f4, { roughness: 0.2 });
    g.add(at(box(0.06, 0.022, 0.046, c, 0.01), 0, DESK_H + 0.011, 0));
    g.add(at(box(0.061, 0.0008, 0.047, M.dark), 0, DESK_H + 0.016, 0));
    g.add(at(box(0.003, 0.003, 0.001, M.whiteLed), 0, DESK_H + 0.01, 0.0232));
    g.userData.size = { w: 0.07, d: 0.06, top: DESK_H + 0.024 };
    return g;
  }
  g.add(at(cyl(0.055, 0.06, 0.012, M.dark, 32), 0, DESK_H + 0.006, 0));
  g.add(at(cyl(0.007, 0.007, 0.245, M.space, 12), 0, DESK_H + 0.13, 0));
  const top = DESK_H + 0.255;
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.012, 12, 40, Math.PI), body); band.position.y = top - 0.088 + 0.012; band.castShadow = true; g.add(band);
  const pad = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 8, 32, Math.PI * 0.7), mat(0x3a3c42, { roughness: 0.9 }));
  pad.position.y = band.position.y; pad.rotation.z = Math.PI * 0.15; g.add(pad);
  for (const sx of [-1, 1]) {
    const cup = cyl(0.045, 0.045, 0.034, body, 28); cup.rotation.z = Math.PI / 2; g.add(at(cup, sx * 0.088, top - 0.12, 0));
    const cush = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.013, 10, 24), mat(0x2b2c30, { roughness: 0.95 }));
    cush.rotation.y = Math.PI / 2; g.add(at(cush, sx * 0.07, top - 0.12, 0));
    g.add(at(box(0.008, 0.05, 0.012, M.space, 0.003), sx * 0.09, top - 0.075, 0));
  }
  g.userData.size = { w: 0.22, d: 0.11, top: top + 0.012 };
  return g;
}

function speakers(it, ctx = {}) {
  const span = ctx.span || 0.45;
  const g = new THREE.Group();
  const body = bodyMat(it, 0x1c1d20, { roughness: 0.6 });
  for (const sx of [-1, 1]) {
    const s = new THREE.Group(); s.position.set(sx * span, 0, 0); s.rotation.y = -sx * 0.28; g.add(s);
    s.add(at(box(0.1, 0.17, 0.12, body, 0.008), 0, DESK_H + 0.085, 0));
    const woof = cyl(0.036, 0.03, 0.006, M.dark, 28); woof.rotation.x = Math.PI / 2; s.add(at(woof, 0, DESK_H + 0.06, 0.061));
    const tw = cyl(0.013, 0.01, 0.005, M.space, 20); tw.rotation.x = Math.PI / 2; s.add(at(tw, 0, DESK_H + 0.13, 0.061));
  }
  g.userData.size = { w: span * 2 + 0.12, d: 0.13, top: DESK_H + 0.17 };
  return g;
}

function arm(it) {
  const g = new THREE.Group();
  const body = bodyMat(it, 0x1d1e21, { metalness: 0.5, roughness: 0.35 });
  g.add(at(box(0.07, 0.012, 0.08, body, 0.004), 0, DESK_H + 0.006, 0.0));
  g.add(at(box(0.07, 0.1, 0.012, body, 0.003), 0, DESK_H - 0.04, -0.04));
  g.add(at(box(0.07, 0.012, 0.08, body, 0.004), 0, DESK_H - 0.085, 0.0));
  g.add(at(cyl(0.018, 0.018, 0.44, body, 20), 0, DESK_H + 0.22, 0));
  g.add(at(cyl(0.022, 0.022, 0.02, M.space, 20), 0, DESK_H + 0.44, 0));
  g.userData.size = { w: 0.08, d: 0.09, top: DESK_H + 0.45, poleTop: DESK_H + 0.42, body };
  return g;
}

function lightbar(it, ctx = {}) {
  const g = new THREE.Group();
  const host = ctx.host;
  const w = host ? Math.min(0.5, (host.screenW || host.w || 0.6) * 0.75) : 0.45;
  const top = host ? host.top : DESK_H + 0.01, z0 = host ? host.topZ || 0 : 0, x0 = ctx.shift || 0;
  const body = bodyMat(it, 0x55585e, { metalness: 0.7, roughness: 0.3 });
  const bar = cyl(0.013, 0.013, w, body, 20); bar.rotation.z = Math.PI / 2; g.add(at(bar, x0, top + 0.02, z0 + 0.03));
  const led = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.95, 0.008), new THREE.MeshBasicMaterial({ color: 0xfff1d6 }));
  led.rotation.x = Math.PI / 2; g.add(at(led, x0, top + 0.0068, z0 + 0.035));
  if (host) g.add(at(box(0.035, 0.03, 0.05, M.black, 0.004), x0, top + 0.005, z0));
  const spot = new THREE.SpotLight(0xffe7c4, 5, 1.5, 0.85, 0.6, 1.2);
  spot.position.set(x0, top + 0.01, z0 + 0.05); spot.target.position.set(x0, DESK_H, z0 + 0.4);
  spot.userData.kind = "bar";
  g.add(spot, spot.target);
  g.userData.size = { w, d: 0.06, top: top + 0.04 };
  return g;
}

function webcam(it, ctx = {}) {
  const g = new THREE.Group();
  const host = ctx.host;
  const top = host ? host.top : DESK_H, z0 = host ? host.topZ || 0 : 0, x0 = ctx.shift || 0;
  const body = bodyMat(it, 0x16171a, { roughness: 0.35 });
  const y = host ? top + 0.017 : DESK_H + 0.12;
  g.add(at(box(0.09, 0.03, 0.03, body, 0.012), x0, y, z0 + 0.012));
  const lens = cyl(0.009, 0.009, 0.003, M.lens, 20); lens.rotation.x = Math.PI / 2; g.add(at(lens, x0, y, z0 + 0.028));
  g.add(at(box(0.003, 0.003, 0.001, M.whiteLed), x0 + 0.025, y + 0.006, z0 + 0.0275));
  if (host) {
    g.add(at(box(0.03, 0.004, 0.06, M.dark, 0.0015), x0, top + 0.002, z0 - 0.02));
    g.add(at(box(0.03, 0.04, 0.004, M.dark, 0.0015), x0, top - 0.018, z0 - 0.05));
  } else {
    for (const a of [0, 2.1, 4.2]) g.add(rod(new V3(x0, y - 0.015, z0 + 0.01), new V3(x0 + Math.sin(a) * 0.05, DESK_H, z0 + 0.01 + Math.cos(a) * 0.05), 0.003, M.dark));
  }
  g.userData.size = { w: 0.1, d: 0.06, top: y + 0.015 };
  return g;
}

const BUILD = { monitor, laptop, desktop: computer, ps5, keyboard, mouse, phone, tablet, hub, mousepad, headset, speakers, arm, light: lightbar, webcam };
const FOLLOW = new Set(["light", "webcam"]);
const LATE = new Set(["light", "webcam", "speakers", "arm"]);
const SCREENS = new Set(["monitor", "laptop", "desktop", "phone", "tablet"]);

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

function layout(items, objects, st, held) {
  const D = st.depth;
  const by = (t) => items.filter((i) => i.type === t);
  const sz = (id, def) => objects.get(id)?.userData.size || def;
  const backZ = -D / 2 + 0.175, frontZ = D / 2 - 0.215;
  const mons = by("monitor");
  const mw = mons.map((m) => sz(m.id, { w: 0.6 }).w);
  const gap = 0.025;
  const total = mw.reduce((a, b) => a + b, 0) + Math.max(0, mons.length - 1) * gap;
  const hasSpk = by("speakers").length > 0;
  const pos = new Map();
  let x = -total / 2;
  mons.forEach((m, i) => {
    pos.set(m.id, [x + mw[i] / 2, backZ + (held.has(m.id) ? 0.05 : 0), mons.length > 1 ? (i - (mons.length - 1) / 2) * -0.18 : 0]);
    x += mw[i] + gap;
  });
  const spkPad = hasSpk && mons.length ? 0.15 : 0;
  let lx = mons.length ? -total / 2 - 0.08 - spkPad : 0.18;
  by("laptop").forEach((l) => {
    const w = sz(l.id, { w: 0.32 }).w;
    if (mons.length) { pos.set(l.id, [lx - w / 2, -0.02 + (D - 0.75) / 2, 0.35]); lx -= w + 0.08; }
    else { pos.set(l.id, [lx - w / 2, -0.04, 0]); lx -= w + 0.1; }
  });
  by("tablet").forEach((t) => { const w = sz(t.id, { w: 0.26 }).w; pos.set(t.id, [lx - w / 2, backZ + 0.1, 0.4]); lx -= w + 0.06; });
  let rx = Math.max(total / 2 + 0.1 + spkPad, 0.35);
  by("ps5").forEach((p) => { pos.set(p.id, [rx + 0.06, backZ - 0.02, 0]); rx += 0.16; });
  const floors = [];
  by("desktop").forEach((d) => {
    const s = sz(d.id, { w: 0.2 });
    if (s.floor) floors.push(d);
    else { pos.set(d.id, [rx + s.w / 2, backZ + (s.screenW ? 0.02 : 0.02), 0]); rx += s.w + 0.06; }
  });
  by("hub").forEach((h) => { const s = sz(h.id, { w: 0.14 }); pos.set(h.id, [rx + s.w / 2, backZ + 0.06, 0]); rx += s.w + 0.05; });
  const leftExt = -lx + 0.05, rightExt = rx + 0.05;
  const width = st.width > 0 ? clamp(st.width, 1, 2.6) : Math.max(1.6, 2 * Math.max(leftExt, rightExt, total / 2 + spkPad + 0.12));
  floors.forEach((d, i) => pos.set(d.id, [width / 2 + 0.16 + i * 0.26, 0.02, 0]));
  const kbs = by("keyboard");
  kbs.forEach((k, i) => pos.set(k.id, [-0.04 + i * 0.05, frontZ + i * 0.12, 0]));
  const kbW = kbs.length ? sz(kbs[0].id, { w: 0.43 }).w : 0.3;
  by("mouse").forEach((m, i) => pos.set(m.id, [-0.04 + kbW / 2 + 0.1 + i * 0.1, frontZ + 0.02, 0]));
  by("mousepad").forEach((m) => pos.set(m.id, [0.04 + (kbs.length ? 0.03 : 0), frontZ, 0]));
  by("phone").forEach((p, i) => pos.set(p.id, [-width / 2 + 0.16 + i * 0.12, frontZ + 0.04, 0.35]));
  by("headset").forEach((h, i) => pos.set(h.id, [width / 2 - 0.13 - i * 0.22, frontZ - 0.04, -0.3]));
  by("speakers").forEach((s) => pos.set(s.id, [0, backZ + 0.03, 0]));
  by("arm").forEach((a) => {
    const hx = mons.filter((m) => held.get(m.id) === a.id).map((m) => pos.get(m.id)[0]);
    pos.set(a.id, [hx.length ? hx.reduce((p, c) => p + c, 0) / hx.length : 0, -D / 2 + 0.045, 0]);
  });
  return { width, pos, span: mons.length ? total / 2 + 0.09 : 0.42, backZ };
}

/* ------------------------------------------------------------------ luz */

const MODES = {
  day: { hemi: [0xffffff, 0xd9d2c5, 0.6], sun: [0xfff3e3, 1.7, [1.6, 3.2, 2.2]], env: 0.55, exp: 1.05, screen: 0.8, bar: 3.5, lamp: 0, glow: 0, rgbA: 0.35 },
  evening: { hemi: [0xffd9b0, 0x5a4a40, 0.32], sun: [0xff9a4a, 1.25, [-2.6, 1.25, 1.2]], env: 0.3, exp: 1.0, screen: 0.95, bar: 6, lamp: 2.5, glow: 0.25, rgbA: 0.6 },
  night: { hemi: [0x8090c0, 0x101018, 0.07], sun: [0x8fa8ff, 0.12, [-1.5, 3, 1.5]], env: 0.08, exp: 1.15, screen: 1.15, bar: 9, lamp: 4, glow: 0.8, rgbA: 0.95 },
};
const DEFAULT_STYLE = { desk: "oak", legs: "black", width: 0, depth: 0.75, wall: null, floor: "wood", light: "day", wallpaper: "sunset", decor: [], rgb: false };

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

/* ------------------------------------------------------------------ escena */

export function mount(container, { onSelect, onHover, onMove } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (e) {
    container.innerHTML = `<div class="desk3d-fallback">Tu navegador no puede mostrar 3D (WebGL desactivado). La lista de la derecha funciona igual.</div>`;
    return { update() {}, setStyle() {}, select() {}, preview() {}, rotate() {}, snapshot() { return null; }, dispose() {} };
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  const tip = document.createElement("div"); tip.className = "desk3d-tip"; container.appendChild(tip);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.environment = envTex;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 30);
  const CAM0 = new V3(0.15, 1.75, 1.85), TARGET0 = new V3(0, DESK_H + 0.18, -0.05);
  camera.position.copy(CAM0);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(TARGET0);
  controls.enableDamping = !reduceMotion; controls.dampingFactor = 0.08;
  controls.minDistance = 0.6; controls.maxDistance = 4.6; controls.maxPolarAngle = Math.PI * 0.49; controls.enablePan = true;
  let userMoved = false;
  controls.addEventListener("start", () => { userMoved = true; });

  const dark = matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light";
  const hemi = new THREE.HemisphereLight(0xffffff, 0xd9d2c5, 0.6); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e3, 1.7);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -2.2, right: 2.2, top: 2.2, bottom: -2.2, near: 0.3, far: 9 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  const screenGlow = new THREE.PointLight(0x9fb8ff, 0, 1.6, 1.5); scene.add(screenGlow);

  let st = { ...DEFAULT_STYLE };
  let deskObj = null, deskKey = "", roomObj = null, roomKey = "", deskWidth = 1.6;
  let decorObj = null, rgbObj = null, rgbMats = [];
  const objects = new Map(), keys = new Map(), manual = new Map(), spawn = new Map();
  let current = [], held = new Map(), selected = null, ghost = null, ring = null, lastBackZ = -0.2;

  /* --- mesa, suelo y pared */
  function setDesk(width) {
    const key = JSON.stringify([round3(width), st.depth, st.desk, st.legs]);
    if (key === deskKey) return;
    if (deskObj) { scene.remove(deskObj); disposeObj(deskObj); }
    const D = st.depth, g = new THREE.Group();
    const kind = DESKS[st.desk] ? st.desk : "oak";
    const topM = DESKS[kind].wood ? new THREE.MeshStandardMaterial({ map: woodTex(kind), roughness: 0.62, metalness: 0 })
      : mat(DESKS[kind].base, { roughness: kind === "black" ? 0.45 : 0.6 });
    g.add(at(box(width, DESK_T, D, topM, 0.008), 0, DESK_H - DESK_T / 2, 0));
    const [lc, lm] = LEGS[st.legs] || LEGS.black;
    const legM = mat(lc, { metalness: lm, roughness: 0.35 });
    for (const sx of [-1, 1]) {
      g.add(at(box(0.05, DESK_H - DESK_T, 0.05, legM, 0.006), sx * (width / 2 - 0.08), (DESK_H - DESK_T) / 2, 0));
      g.add(at(box(0.06, 0.025, D - 0.08, legM, 0.006), sx * (width / 2 - 0.08), 0.0125, 0));
      g.add(at(box(0.05, 0.04, D - 0.12, legM, 0.006), sx * (width / 2 - 0.08), DESK_H - DESK_T - 0.02, 0));
    }
    g.add(at(box(width - 0.2, 0.05, 0.03, legM), 0, DESK_H - 0.08, -D / 2 + 0.12));
    g.add(at(box(Math.min(1, width * 0.5), 0.03, 0.1, legM, 0.004), 0, DESK_H - DESK_T - 0.04, -D / 2 + 0.09));
    deskObj = g; deskKey = key; deskWidth = width; scene.add(g);
    fitCamera();
  }
  /* Encuadre automático: que quepa la mesa entera (también en vertical, en el móvil) */
  function fitCamera() {
    if (userMoved) return;
    const base = CAM0.distanceTo(TARGET0);
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const need = (deskWidth / 2 + 0.12) / (half * Math.max(camera.aspect, 0.3));
    const f = clamp(Math.max(1, need / base, (st.depth + 0.85) / 1.6), 1, controls.maxDistance / base);
    camera.position.copy(TARGET0).add(CAM0.clone().sub(TARGET0).multiplyScalar(f));
    controls.target.copy(TARGET0);
  }
  function wallZ() { return -st.depth / 2 - 0.275; }
  function setRoom() {
    const key = JSON.stringify([st.floor, st.wall, st.depth, dark]);
    if (key === roomKey) return;
    if (roomObj) { scene.remove(roomObj); disposeObj(roomObj); }
    const g = new THREE.Group();
    const fdraw = FLOORS[st.floor] || FLOORS.wood;
    const ftex = canvasTex(512, 512, fdraw, [8, 8]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ map: ftex, roughness: st.floor === "tiles" ? 0.35 : 0.85,
      color: dark ? 0x9a9a9a : 0xffffff }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
    const wc = st.wall && /^#?[0-9a-f]{6}$/i.test(st.wall) ? parseInt(st.wall.replace("#", ""), 16) : (dark ? 0x2b2b2f : 0xf1ede6);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(12, 5), mat(wc, { roughness: 1 }));
    wall.position.set(0, 2.5, wallZ()); wall.receiveShadow = true; g.add(wall);
    g.add(at(box(12, 0.08, 0.015, mat(isLightHex(wc) ? 0xffffff : 0x1e1e21, { roughness: 0.6 })), 0, 0.04, wallZ() + 0.008));
    roomObj = g; roomKey = key; scene.add(g);
    scene.background = new THREE.Color(wc).multiplyScalar(0.85);
  }

  /* --- RGB */
  function setRGB() {
    if (rgbObj) { scene.remove(rgbObj); disposeObj(rgbObj); rgbObj = null; }
    rgbMats = [];
    if (!st.rgb) return;
    const g = new THREE.Group();
    const strip = new THREE.MeshBasicMaterial({ color: 0x7b5cff });
    g.add(at(new THREE.Mesh(new THREE.BoxGeometry(deskWidth - 0.1, 0.006, 0.006), strip), 0, DESK_H - DESK_T - 0.004, -st.depth / 2 + 0.015));
    g.add(at(new THREE.Mesh(new THREE.BoxGeometry(deskWidth - 0.1, 0.006, 0.006), strip), 0, DESK_H - DESK_T - 0.004, st.depth / 2 - 0.02));
    const glowTex = canvasTex(256, 128, (c, W, H) => {
      const r = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = r; c.fillRect(0, 0, W, H);
    });
    const wallGlow = new THREE.MeshBasicMaterial({ map: glowTex, color: 0x7b5cff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
    g.add(at(new THREE.Mesh(new THREE.PlaneGeometry(Math.min(deskWidth + 0.4, 2.6), 0.9), wallGlow), 0, DESK_H + 0.42, wallZ() + 0.01));
    const pl = new THREE.PointLight(0x7b5cff, 0.8, 1.6, 1.6); pl.position.set(0, DESK_H + 0.3, wallZ() + 0.2); g.add(pl);
    rgbMats = [strip, wallGlow, pl];
    rgbObj = g; scene.add(g);
  }

  /* --- decoración en huecos libres */
  function itemRects(floorToo) {
    const out = [];
    for (const [id, g] of objects) {
      const fl = !!g.userData.size?.floor;
      if (fl !== floorToo) continue;
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
    const g = new THREE.Group(), W = deskWidth, D = st.depth;
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
    for (const k of ["plant", "lamp", "books", "mug"]) {
      if (!want.has(k)) continue;
      const spot = spots[k].find(([x, z]) => Math.abs(x) < W / 2 - 0.03 && free(rects, x, z, rad[k]));
      if (spot) {
        const o = make[k](); o.position.set(spot[0], DESK_H, spot[1]); o.rotation.y = k === "lamp" && spot[0] > 0 ? Math.PI : k === "books" ? 0.2 : 0;
        g.add(o); rects.push([spot[0] - rad[k], spot[0] + rad[k], spot[1] - rad[k], spot[1] + rad[k]]);
      } else if (k === "plant") {
        const fr = itemRects(true);
        const fs = [[-W / 2 - 0.32, -D / 2 + 0.12], [W / 2 + 0.32, -D / 2 + 0.12], [-W / 2 - 0.32, 0.3]].find(([x, z]) => free(fr, x, z, 0.2));
        if (fs) { const o = plant(3.2); o.position.set(fs[0], 0, fs[1]); g.add(o); }
      }
    }
    if (want.has("plant") && W > 1.5) {  // una planta grande en el suelo, siempre que haya hueco
      const fr = itemRects(true);
      const fs = [[-W / 2 - 0.34, -D / 2 + 0.12], [W / 2 + 0.34, -D / 2 + 0.12]].find(([x, z]) => free(fr, x, z, 0.22));
      if (fs && !g.children.some((o) => o.position.y === 0)) { const o = plant(3.2); o.position.set(fs[0], 0, fs[1]); g.add(o); }
    }
    const wz = wallZ() + 0.012;
    if (want.has("frame")) { const f = frame(); f.position.set(want.has("window") ? -W * 0.28 : -W * 0.18, 1.6, wz); g.add(f); }
    if (want.has("window")) { const w = windowDecor(st.light); w.position.set(want.has("frame") ? W * 0.3 : W * 0.24, 1.62, wz + 0.02); g.add(w); }
    g.traverse((o) => { o.userData.decor = true; });
    decorObj = g; scene.add(g);
  }

  /* --- objetos */
  function hostOf(items) {
    const m = items.find((i) => i.type === "monitor") || items.find((i) => i.type === "laptop");
    return m ? objects.get(m.id) : null;
  }
  function build(it, ctx) {
    const g = (BUILD[it.type] || (() => new THREE.Group()))(it, ctx);
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
      if (it.type === "webcam" && hasLight && ctx.host) ctx.shift = Math.min(0.5, (ctx.host.screenW || ctx.host.w || 0.6) * 0.75) / 2 + 0.005;
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
        const tWorld = mo.localToWorld(new V3(0, s.cy, s.backZ - 0.012));
        const t = g.worldToLocal(tWorld.clone());
        const p0 = new V3(0, g.userData.size.poleTop - i * 0.035, 0);
        const elbow = new V3((p0.x + t.x) * 0.55, (p0.y + t.y) / 2 + 0.03, p0.z + (t.z - p0.z) * 0.3);
        links.add(rod(p0, elbow, 0.012, body), rod(elbow, t, 0.011, body));
        for (const p of [elbow, t]) links.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), M.space), p.x, p.y, p.z));
      });
      links.traverse((o) => { o.userData.itemId = a.id; });
    }
  }
  function clampPos(g, x, z) {
    const s = g.userData.size || { w: 0.2, d: 0.2 }, D = st.depth;
    if (s.floor) return [clamp(x, -deskWidth / 2 - 0.9, deskWidth / 2 + 0.9), clamp(z, -D / 2 + 0.25, D / 2 + 0.5)];
    const mx = Math.max(0, deskWidth / 2 - Math.min(s.w, deskWidth) * 0.35), mz = Math.max(0, D / 2 - Math.min(s.d || 0.2, D) * 0.35);
    return [clamp(x, -mx, mx), clamp(z, -mz, mz)];
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
      const key = JSON.stringify([it.type, it.model, it.specs, it.color, ctx]);
      if (keys.get(it.id) === key) return;
      const isNew = !objects.has(it.id);
      if (!isNew) { const old = objects.get(it.id); scene.remove(old); disposeObj(old); }
      const g = build(it, ctx);
      objects.set(it.id, g); keys.set(it.id, key); scene.add(g);
      if (isNew && !reduceMotion && !LATE.has(it.type)) spawn.set(it.id, performance.now());
    };
    for (const it of current) if (!LATE.has(it.type)) rebuild(it, ctxFor(it, current));
    let L = layout(current, objects, st, held);
    for (const it of current) if (it.type === "speakers" || it.type === "arm") rebuild(it, ctxFor(it, current, { span: round3(L.span) }));
    // la disposición final, ya con todo construido, y después los que van encima del monitor
    L = layout(current, objects, st, held);
    lastBackZ = L.backZ;
    setDesk(L.width);
    for (const it of current) {
      if (FOLLOW.has(it.type)) continue;
      const g = objects.get(it.id); if (!g) continue;
      const m = manual.get(it.id), p = L.pos.get(it.id);
      if (m) { const [x, z] = clampPos(g, m.x, m.z); g.position.set(x, g.position.y, z); g.rotation.y = m.rot; }
      else if (p) { g.position.set(p[0], g.position.y, p[1]); g.rotation.y = p[2] || 0; }
    }
    for (const it of current) if (FOLLOW.has(it.type)) rebuild(it, ctxFor(it, current));
    placeFollowers();
    updateArms();
    setRGB(); setDecor();
    applyMode();
    if (selected && !ids.has(selected)) select(null); else if (selected) select(selected);
  }

  function setStyle(style) {
    st = { ...DEFAULT_STYLE, ...(style || {}) };
    st.depth = clamp(+st.depth || 0.75, 0.55, 0.9);
    st.width = +st.width || 0;
    setRoom();
    deskKey = deskKey + "!";  // fuerza a reconstruir la mesa (color/patas/tamaño)
    update(current);
  }

  /* intensidades según la luz elegida (también para objetos recién creados) */
  function applyMode() {
    const m = MODES[st.light] || MODES.day;
    hemi.color.set(m.hemi[0]); hemi.groundColor.set(dark && st.light === "day" ? 0x55524c : m.hemi[1]); hemi.intensity = m.hemi[2];
    sun.color.set(m.sun[0]); sun.intensity = m.sun[1]; sun.position.set(...m.sun[2]);
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
        if (mt.isMeshStandardMaterial) mt.envMapIntensity = m.env;
      }
    });
    if (rgbMats[1]) rgbMats[1].opacity = m.rgbA;
    if (rgbMats[2]) rgbMats[2].intensity = st.light === "day" ? 0.4 : 1.2;
  }

  function bounds(g) { return new THREE.Box3().setFromObject(g); }
  function select(id) {
    selected = id;
    if (ring) { scene.remove(ring); disposeObj(ring); ring = null; }
    const g = id && objects.get(id);
    if (!g) return;
    const b = bounds(g), size = b.getSize(new V3()), c = b.getCenter(new V3());
    const r = clamp(Math.max(size.x, size.z) * 0.62 + 0.03, 0.06, 1.6);
    ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.012, 56), new THREE.MeshBasicMaterial({ color: 0xff7a33, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(c.x, (g.userData.size?.floor ? 0 : DESK_H) + 0.004, c.z);
    scene.add(ring);
  }

  /* Vista previa translúcida de un accesorio recomendado */
  function preview(it) {
    if (ghost) { scene.remove(ghost); disposeObj(ghost); ghost = null; }
    if (!it) return;
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
      const { pos } = layout(all, new Map([...objects, [it.id, ghost]]), st, heldMap(all));
      const p = pos.get(it.id); if (p) { ghost.position.set(p[0], 0, p[1]); ghost.rotation.y = p[2] || 0; }
    }
    scene.add(ghost);
  }

  function commitMove(id, g) {
    const p = { x: round3(g.position.x), z: round3(g.position.z), rot: round3(g.rotation.y) };
    manual.set(id, p);
    const it = current.find((i) => i.id === id); if (it) it.pos = p;
    onMove?.(id, p);
  }
  function rotate(id, delta) {
    const g = objects.get(id), it = current.find((i) => i.id === id);
    if (!g || !it || FOLLOW.has(it.type)) return;
    g.rotation.y = round3(g.rotation.y + delta);
    placeFollowers(); updateArms(); if (selected === id) select(id);
    commitMove(id, g); setDecor(); applyMode();
  }

  /* ratón: seleccionar, arrastrar para mover y etiqueta al pasar por encima */
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(), plane = new THREE.Plane(new V3(0, 1, 0), -DESK_H);
  function setRay(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
  }
  function pick(ev) {
    setRay(ev);
    const hit = ray.intersectObjects([...objects.values()], true).find((h) => h.object.userData.itemId && h.object.visible);
    return hit ? hit.object.userData.itemId : null;
  }
  function planeHit(ev, y) {
    setRay(ev); plane.constant = -y;
    return ray.ray.intersectPlane(plane, new V3());
  }
  let down = null, drag = null;
  const onDown = (e) => {
    if (e.target !== renderer.domElement) return;
    down = [e.clientX, e.clientY];
    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
    const id = pick(e); if (!id) return;
    const it = current.find((i) => i.id === id);
    if (!it || FOLLOW.has(it.type) || (it.type === "mousepad" && selected !== id)) return;
    const g = objects.get(id);
    const y = g.userData.size?.floor ? 0 : DESK_H;
    const hit = planeHit(e, y); if (!hit) return;
    drag = { id, g, y, off: new V3(g.position.x - hit.x, 0, g.position.z - hit.z), moved: false, x0: e.clientX, y0: e.clientY, pid: e.pointerId };
    controls.enabled = false;
  };
  container.addEventListener("pointerdown", onDown, true);  // antes que OrbitControls
  const onMoveEv = (e) => {
    if (drag) {
      if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) {
        drag.moved = true; try { renderer.domElement.setPointerCapture(drag.pid); } catch (_) {}
        tip.classList.remove("on"); renderer.domElement.style.cursor = "grabbing";
      }
      if (drag.moved) {
        const hit = planeHit(e, drag.y);
        if (hit) {
          const [x, z] = clampPos(drag.g, hit.x + drag.off.x, hit.z + drag.off.z);
          drag.g.position.x = x; drag.g.position.z = z;
          placeFollowers(); updateArms();
          if (ring && selected === drag.id) { const c = bounds(drag.g).getCenter(new V3()); ring.position.x = c.x; ring.position.z = c.z; }
        }
      }
      return;
    }
    const id = pick(e);
    renderer.domElement.style.cursor = id ? (current.find((i) => i.id === id && !FOLLOW.has(i.type)) ? "move" : "pointer") : "grab";
    const it = id && current.find((i) => i.id === id);
    if (it) {
      const r = container.getBoundingClientRect();
      tip.textContent = it.model || it.type; tip.style.left = `${e.clientX - r.left + 12}px`; tip.style.top = `${e.clientY - r.top + 12}px`;
      tip.classList.add("on");
    } else tip.classList.remove("on");
    onHover?.(id);
  };
  renderer.domElement.addEventListener("pointermove", onMoveEv);
  const onUp = (e) => {
    const d = drag; drag = null;
    controls.enabled = true;
    if (d) {
      try { renderer.domElement.releasePointerCapture(d.pid); } catch (_) {}
      if (d.moved) {
        renderer.domElement.style.cursor = "move";
        commitMove(d.id, d.g); setDecor(); applyMode();
        if (selected !== d.id) { select(d.id); onSelect?.(d.id); } else select(d.id);
        down = null;
        return;
      }
    }
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    down = null;
    const id = pick(e); select(id); onSelect?.(id);
  };
  renderer.domElement.addEventListener("pointerup", onUp);
  renderer.domElement.addEventListener("pointercancel", () => { drag = null; controls.enabled = true; });
  renderer.domElement.addEventListener("pointerleave", () => tip.classList.remove("on"));
  const onKey = (e) => {
    if (!selected || !container.isConnected) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const step = Math.PI / 12;
    if (e.key === "q" || e.key === "Q" || e.key === "[") { rotate(selected, step); e.preventDefault(); }
    else if (e.key === "e" || e.key === "E" || e.key === "]") { rotate(selected, -step); e.preventDefault(); }
  };
  window.addEventListener("keydown", onKey);

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.fov = w / h < 1 ? 55 : 38; camera.updateProjectionMatrix();
    fitCamera();
  }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  let raf = 0, alive = true;
  const rgbColor = new THREE.Color();
  function loop(t) {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    if (spawn.size) {
      for (const [id, t0] of spawn) {
        const g = objects.get(id); if (!g) { spawn.delete(id); continue; }
        const k = Math.min(1, (t - t0) / 450), e = 1 - Math.pow(1 - k, 3);
        g.scale.setScalar(0.6 + 0.4 * e); g.position.y = (1 - e) * 0.15;
        if (k >= 1) { g.scale.setScalar(1); g.position.y = 0; spawn.delete(id); }
      }
      placeFollowers(); updateArms();  // brazos y luz siguen al monitor mientras aparece
    }
    if (rgbMats.length && !reduceMotion) {
      rgbColor.setHSL((t / 9000) % 1, 0.85, 0.55);
      rgbMats[0].color.copy(rgbColor); rgbMats[1].color.copy(rgbColor); rgbMats[2].color.copy(rgbColor);
    }
    if (ring) ring.material.opacity = reduceMotion ? 0.85 : 0.55 + 0.35 * Math.sin(t / 300);
    controls.update();
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);
  setRoom(); setDesk(1.6); applyMode();

  return {
    update, setStyle, select, preview, rotate,
    snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL("image/png"); },
    dispose() {
      alive = false; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      container.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      scene.traverse((o) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose(); m.emissiveMap?.dispose?.(); m.dispose(); }); });
      Object.values(M).forEach((m) => m.dispose());
      envTex.dispose(); pmrem.dispose();
      renderer.dispose(); renderer.domElement.remove(); tip.remove();
    },
  };
}

window.Desk3D = { mount, NAMED_COLORS, WALLPAPERS: Object.keys(WALLPAPERS), DESKS: Object.keys(DESKS), FLOORS: Object.keys(FLOORS) };
window.dispatchEvent(new Event("desk3d-ready"));
