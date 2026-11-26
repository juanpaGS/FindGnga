/* FindGnga – escritorio virtual en 3D (Three.js r160, sin build).
 *
 * Cada dispositivo se dibuja con proporciones reales a partir de sus datos
 * (pulgadas y formato del monitor, tamaño del portátil, edición de la PS5…).
 * Unidades: metros. La mesa mide 1,6 × 0,75 m y crece si no caben los monitores.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/RoundedBoxGeometry.js";

const DESK_H = 0.75, DESK_T = 0.035, DESK_D = 0.75;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...o });
const M = {
  wood: mat(0xc8a27a, { roughness: 0.7 }), leg: mat(0x2b2b2e, { metalness: 0.6, roughness: 0.35 }),
  black: mat(0x16171a, { roughness: 0.4 }), dark: mat(0x2c2e33, { roughness: 0.45, metalness: 0.2 }),
  silver: mat(0xc9ccd1, { metalness: 0.75, roughness: 0.28 }), space: mat(0x55585e, { metalness: 0.7, roughness: 0.3 }),
  white: mat(0xf2f2f0, { roughness: 0.35 }), key: mat(0x3a3c42), keyLight: mat(0xe9e9ec),
  felt: mat(0x34363b, { roughness: 0.95 }), glass: new THREE.MeshPhysicalMaterial({ color: 0x111318, roughness: 0.05, transmission: 0.2, transparent: true, opacity: 0.55 }),
};

function box(w, h, d, m, r = 0) {
  const g = r > 0 ? new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/* Pantalla con un fondo de color y el nombre del modelo */
function screenTexture(label, ratio, hue = 22) {
  const W = 512, H = Math.max(96, Math.round(W / ratio));
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 0, W, H);
  grd.addColorStop(0, `hsl(${hue} 85% 55%)`); grd.addColorStop(0.55, `hsl(${(hue + 300) % 360} 60% 38%)`); grd.addColorStop(1, `hsl(${(hue + 240) % 360} 55% 18%)`);
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(255,255,255,.9)"; g.font = `600 ${Math.round(H * 0.11)}px -apple-system, Segoe UI, sans-serif`;
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText((label || "").slice(0, 34), W / 2, H / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const screenMat = (label, ratio, hue) => new THREE.MeshStandardMaterial({ map: screenTexture(label, ratio, hue), emissive: 0xffffff,
  emissiveMap: null, emissiveIntensity: 0, roughness: 0.25 });
function glowScreen(label, ratio, hue) {
  const m = screenMat(label, ratio, hue); m.emissiveMap = m.map; m.emissiveIntensity = 0.85; return m;
}

const RATIO = { "16:9": 16 / 9, "16:10": 1.6, "21:9": 21 / 9, "32:9": 32 / 9, "3:2": 1.5 };

/* ------------------------------------------------------------------ modelos */

function monitor(it) {
  const s = it.specs || {};
  const ratio = RATIO[s.aspect] || 16 / 9;
  const diag = (s.size_in || 27) * 0.0254;
  const h = diag / Math.sqrt(1 + ratio * ratio), w = h * ratio;
  const g = new THREE.Group();
  const lift = DESK_H + 0.1 + (s.size_in >= 40 ? 0.02 : 0.06);
  const curved = s.curved || s.aspect === "32:9";
  if (curved) {
    const R = 1.0, theta = w / R;
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.012, R + 0.012, h + 0.02, 48, 1, true, Math.PI - theta / 2 - 0.01, theta + 0.02), M.black);
    shell.material = M.black.clone(); shell.material.side = THREE.DoubleSide; shell.castShadow = true;
    const scr = new THREE.Mesh(new THREE.CylinderGeometry(R, R, h, 48, 1, true, Math.PI - theta / 2, theta), glowScreen(it.model, ratio));
    scr.material.side = THREE.BackSide;
    scr.material.map.wrapS = THREE.RepeatWrapping; scr.material.map.repeat.x = -1;  // por dentro se vería al revés
    for (const m of [shell, scr]) { m.position.set(0, lift + h / 2, R - 0.02); g.add(m); }
  } else {
    const bez = box(w + 0.012, h + 0.012, 0.022, M.black, 0.004);
    bez.position.set(0, lift + h / 2, 0); g.add(bez);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glowScreen(it.model, ratio));
    scr.position.set(0, lift + h / 2, 0.0115); g.add(scr);
    const back = box(w * 0.55, h * 0.5, 0.03, M.dark, 0.01); back.position.set(0, lift + h * 0.45, -0.022); g.add(back);
  }
  const neck = box(0.05, lift - DESK_H + h * 0.35, 0.03, M.space, 0.008);
  neck.position.set(0, DESK_H + (lift - DESK_H + h * 0.35) / 2, -0.06); g.add(neck);
  const foot = box(Math.min(0.32, w * 0.45), 0.012, 0.2, M.space, 0.005); foot.position.set(0, DESK_H + 0.006, -0.03); g.add(foot);
  g.userData.size = { w: w + 0.02, d: 0.22, top: lift + h + 0.006 };
  return g;
}

function laptop(it) {
  const s = it.specs || {};
  const inch = s.screen_in || (s.platform === "mac" ? 14 : 15);
  const w = inch * 0.0254 * 0.86, d = w * 0.69, sh = w * 0.62;
  const body = s.platform === "mac" ? (s.model_line === "air" ? M.silver : M.space) : M.dark;
  const g = new THREE.Group();
  const base = box(w, 0.016, d, body, 0.006); base.position.y = DESK_H + 0.008; g.add(base);
  const deck = box(w * 0.9, 0.002, d * 0.42, M.key); deck.position.set(0, DESK_H + 0.017, -d * 0.12); g.add(deck);
  const pad = box(w * 0.4, 0.001, d * 0.3, mat(0x8b8e94, { roughness: 0.3 })); pad.position.set(0, DESK_H + 0.0165, d * 0.28); g.add(pad);
  const hinge = new THREE.Group(); hinge.position.set(0, DESK_H + 0.016, -d / 2); g.add(hinge);
  const lid = box(w, sh, 0.007, body, 0.004); lid.position.set(0, sh / 2, 0); hinge.add(lid);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.94, sh * 0.9), glowScreen(it.model, w / sh, 210));
  scr.position.set(0, sh / 2, 0.0036); hinge.add(scr);
  hinge.rotation.x = -0.32;
  g.userData.size = { w, d, top: DESK_H + sh };
  return g;
}

function computer(it) {
  const s = it.specs || {};
  const g = new THREE.Group();
  if (s.platform === "mac") {
    if (s.model_line === "imac") {
      const m = monitor({ ...it, specs: { size_in: 24, aspect: "16:9" } });
      const chin = box(0.55, 0.06, 0.02, mat(0x8fb7e0, { roughness: 0.3 }), 0.004); chin.position.set(0, DESK_H + 0.13, 0.002); m.add(chin);
      return m;
    }
    const big = s.model_line === "studio";
    const w = big ? 0.197 : 0.127, h = big ? 0.095 : 0.05;
    const b = box(w, h, w, M.silver, big ? 0.02 : 0.015); b.position.y = DESK_H + h / 2; g.add(b);
    const led = box(0.004, 0.004, 0.001, new THREE.MeshBasicMaterial({ color: 0xffffff })); led.position.set(-w / 2 + 0.02, DESK_H + 0.012, w / 2 + 0.001); g.add(led);
    g.userData.size = { w, d: w, top: DESK_H + h };
    return g;
  }
  // Torre de PC (en el suelo, al lado de la mesa), con cristal lateral y luz RGB
  const W = 0.21, H = 0.46, D = 0.44;
  const t = box(W, H, D, M.black, 0.01); t.position.y = H / 2; g.add(t);
  const glass = box(0.004, H * 0.86, D * 0.9, M.glass); glass.position.set(-W / 2 - 0.002, H / 2, 0); g.add(glass);
  const rgb = new THREE.MeshBasicMaterial({ color: 0xff5a1f });
  for (const [y, c] of [[0.12, 0xff5a1f], [0.3, 0x7b5cff]]) {
    const fan = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.006, 8, 32), new THREE.MeshBasicMaterial({ color: c }));
    fan.rotation.y = Math.PI / 2; fan.position.set(-W / 2 + 0.01, y + 0.05, D / 2 - 0.09); g.add(fan);
  }
  const strip = box(0.004, H * 0.8, 0.004, rgb); strip.position.set(-W / 2 + 0.01, H / 2, -D / 2 + 0.03); g.add(strip);
  const glow = new THREE.PointLight(0xff6a2a, 0.6, 0.8); glow.position.set(-W / 2 - 0.1, H / 2, 0); g.add(glow);
  g.userData.size = { w: W, d: D, top: H, floor: true };
  return g;
}

function ps5(it) {
  const ed = it.specs?.edition || "standard";
  const H = ed === "pro" ? 0.388 : 0.358, W = ed === "pro" ? 0.089 : 0.096, D = 0.216;
  const g = new THREE.Group();
  const core = box(W * 0.55, H * 0.94, D * 0.92, M.black, 0.01); core.position.y = DESK_H + 0.012 + H * 0.47; g.add(core);
  for (const side of [-1, 1]) {
    const p = box(W * 0.22, H, D, M.white, 0.025); p.position.set(side * W * 0.37, DESK_H + 0.012 + H / 2, 0); g.add(p);
  }
  if (ed === "pro") for (const y of [0.33, 0.66]) {
    const fin = box(W * 0.6, 0.004, D * 0.95, M.black); fin.position.set(0, DESK_H + H * y, 0); g.add(fin);
  }
  for (const sx of [-1, 1]) {  // la luz azul asoma entre el núcleo negro y las tapas blancas
    const light = box(0.003, H * 0.7, D * 0.5, new THREE.MeshBasicMaterial({ color: 0x4d8dff }));
    light.position.set(sx * W * 0.265, DESK_H + H * 0.5, D * 0.2); g.add(light);
  }
  const stand = box(W * 1.4, 0.012, D * 0.5, M.black, 0.004); stand.position.y = DESK_H + 0.006; g.add(stand);
  g.userData.size = { w: W, d: D, top: DESK_H + H };
  return g;
}

function keyboard(it) {
  const g = new THREE.Group();
  const w = 0.43, d = 0.135;
  const base = box(w, 0.018, d, M.dark, 0.006); base.position.y = DESK_H + 0.009; g.add(base);
  const geo = new RoundedBoxGeometry(0.0235, 0.008, 0.0235, 2, 0.003);
  const keys = new THREE.InstancedMesh(geo, it.specs?.mechanical ? M.keyLight : M.key, 15 * 5);
  const m4 = new THREE.Matrix4(); let i = 0;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 15; c++) {
    const wide = r === 4 && c >= 4 && c <= 10;
    if (r === 4 && c > 4 && c <= 10) { m4.makeScale(0, 0, 0); keys.setMatrixAt(i++, m4); continue; }
    m4.compose(new THREE.Vector3(-w / 2 + 0.022 + c * 0.0275 + (wide ? 0.0825 : 0), DESK_H + 0.022 + (it.specs?.mechanical ? 0.006 : 0), -d / 2 + 0.018 + r * 0.025),
      new THREE.Quaternion(), new THREE.Vector3(wide ? 7.2 : 1, 1, 1));
    keys.setMatrixAt(i++, m4);
  }
  keys.castShadow = true; g.add(keys);
  g.userData.size = { w, d, top: DESK_H + 0.03 };
  return g;
}

function mouse() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), M.dark); m.scale.set(0.034, 0.021, 0.06);
  m.position.y = DESK_H + 0.005; m.castShadow = true; g.add(m);
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.004, 12), M.silver);
  wheel.rotation.z = Math.PI / 2; wheel.position.set(0, DESK_H + 0.025, -0.02); g.add(wheel);
  g.userData.size = { w: 0.07, d: 0.12, top: DESK_H + 0.03 };
  return g;
}

function phone(it) {
  const g = new THREE.Group();
  const ios = it.specs?.os === "ios";
  const b = box(0.072, 0.008, 0.148, ios ? M.space : M.black, 0.01); b.position.y = DESK_H + 0.004; g.add(b);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.142), glowScreen("", 0.066 / 0.142, 260));
  scr.rotation.x = -Math.PI / 2; scr.position.y = DESK_H + 0.0085; g.add(scr);
  g.rotation.y = 0.35;
  g.userData.size = { w: 0.1, d: 0.16, top: DESK_H + 0.01 };
  return g;
}

function lightbar(it, host) {
  const g = new THREE.Group();
  const w = Math.min(0.5, (host?.userData.size?.w || 0.6) * 0.75);
  const top = host?.userData.size?.top || DESK_H + 0.5;
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, w, 20), M.space);
  bar.rotation.z = Math.PI / 2; bar.position.set(0, top + 0.02, 0.03); bar.castShadow = true; g.add(bar);
  const led = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.95, 0.008), new THREE.MeshBasicMaterial({ color: 0xfff1d6 }));
  led.rotation.x = Math.PI / 2; led.position.set(0, top + 0.0068, 0.035); g.add(led);
  const clip = box(0.035, 0.03, 0.05, M.black, 0.004); clip.position.set(0, top + 0.005, 0.0); g.add(clip);
  const spot = new THREE.SpotLight(0xffe7c4, 6, 1.4, 0.85, 0.6, 1.2);
  spot.position.set(0, top + 0.01, 0.05); spot.target.position.set(0, DESK_H, 0.38);
  spot.castShadow = true; spot.shadow.mapSize.set(512, 512);
  g.add(spot, spot.target);
  g.userData.size = { w, d: 0.06, top: top + 0.04 };
  return g;
}

function mousepad() {
  const g = new THREE.Group();
  const p = box(0.9, 0.003, 0.4, M.felt, 0.0015); p.position.y = DESK_H + 0.0015; p.castShadow = false; g.add(p);
  g.userData.size = { w: 0.9, d: 0.4, top: DESK_H + 0.003, flat: true };
  return g;
}

function headset() {
  const g = new THREE.Group();
  const stand = box(0.09, 0.012, 0.09, M.dark, 0.004); stand.position.y = DESK_H + 0.006; g.add(stand);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.24, 12), M.space); pole.position.y = DESK_H + 0.12; g.add(pole);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.011, 10, 32, Math.PI), M.black);
  band.position.y = DESK_H + 0.17; band.castShadow = true; g.add(band);
  for (const sx of [-1, 1]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.035, 24), M.dark);
    cup.rotation.z = Math.PI / 2; cup.position.set(sx * 0.085, DESK_H + 0.155, 0); cup.castShadow = true; g.add(cup);
  }
  g.userData.size = { w: 0.2, d: 0.1, top: DESK_H + 0.26 };
  return g;
}

const BUILD = { monitor, laptop, desktop: computer, ps5, keyboard, mouse, phone, mousepad, headset };

/* ------------------------------------------------------------------ escena */

function makeDesk(width) {
  const g = new THREE.Group();
  const top = box(width, DESK_T, DESK_D, M.wood, 0.01); top.position.y = DESK_H - DESK_T / 2; g.add(top);
  for (const sx of [-1, 1]) {
    const leg = box(0.05, DESK_H - DESK_T, 0.6, M.leg, 0.005); leg.position.set(sx * (width / 2 - 0.08), (DESK_H - DESK_T) / 2, 0); g.add(leg);
    const feet = box(0.06, 0.02, 0.68, M.leg, 0.005); feet.position.set(sx * (width / 2 - 0.08), 0.01, 0); g.add(feet);
  }
  const bar = box(width - 0.2, 0.05, 0.03, M.leg); bar.position.set(0, DESK_H - 0.08, -0.25); g.add(bar);
  return g;
}

function layout(items, objects) {
  const by = (t) => items.filter((i) => i.type === t);
  const mons = by("monitor");
  const mw = mons.map((m) => objects.get(m.id)?.userData.size.w || 0.6);
  const total = mw.reduce((a, b) => a + b, 0) + Math.max(0, mons.length - 1) * 0.025;
  const laptops = by("laptop");
  const lw = laptops.reduce((a, l) => a + (objects.get(l.id)?.userData.size.w || 0.32) + 0.08, 0);
  const width = Math.max(1.6, total + lw + 0.5);
  const pos = new Map();
  let x = -total / 2;
  mons.forEach((m, i) => { pos.set(m.id, [x + mw[i] / 2, -0.2, mons.length > 1 ? (i - (mons.length - 1) / 2) * -0.18 : 0]); x += mw[i] + 0.025; });
  let lx = mons.length ? -total / 2 - 0.08 : 0.18;
  laptops.forEach((l) => {
    const w = objects.get(l.id)?.userData.size.w || 0.32;
    if (mons.length) { pos.set(l.id, [lx - w / 2, -0.02, 0.35]); lx -= w + 0.08; }
    else { pos.set(l.id, [lx - w / 2 + (laptops.length > 1 ? 0 : 0.0), -0.04, 0]); lx -= w + 0.1; }
  });
  let rx = width / 2 - 0.14;
  by("ps5").forEach((p) => { pos.set(p.id, [rx, -0.22, -0.25]); rx -= 0.16; });
  by("desktop").forEach((d, i) => {
    const o = objects.get(d.id);
    if (o?.userData.size.floor) pos.set(d.id, [width / 2 + 0.16 + i * 0.26, 0.02, 0]);
    else { pos.set(d.id, [rx - 0.05, -0.2, 0]); rx -= 0.24; }
  });
  by("keyboard").forEach((k, i) => pos.set(k.id, [-0.04 + i * 0.05, 0.16 + i * 0.12, 0]));
  by("mouse").forEach((m, i) => pos.set(m.id, [0.3 + i * 0.1, 0.18, 0]));
  by("mousepad").forEach((m, i) => pos.set(m.id, [0.08, 0.16, 0]));
  by("phone").forEach((p, i) => pos.set(p.id, [-width / 2 + 0.2 + i * 0.12, 0.2, 0]));
  by("headset").forEach((h, i) => pos.set(h.id, [width / 2 - 0.13 - i * 0.22, 0.12, -0.3]));
  return { width, pos };
}

export function mount(container, { onSelect, onHover } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (e) {
    container.innerHTML = `<div class="desk3d-fallback">Tu navegador no puede mostrar 3D (WebGL desactivado). La lista de la derecha funciona igual.</div>`;
    return { update() {}, select() {}, preview() {}, dispose() {} };
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  const tip = document.createElement("div"); tip.className = "desk3d-tip"; container.appendChild(tip);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 30);
  camera.position.set(0.15, 1.75, 1.85);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, DESK_H + 0.18, -0.05);
  controls.enableDamping = !reduceMotion; controls.dampingFactor = 0.08;
  controls.minDistance = 0.7; controls.maxDistance = 4.2; controls.maxPolarAngle = Math.PI * 0.49; controls.enablePan = true;

  const dark = matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light";
  scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x2a2a2e : 0xd9d2c5, dark ? 0.8 : 0.9));
  const sun = new THREE.DirectionalLight(0xfff3e3, dark ? 1.1 : 1.7);
  sun.position.set(1.6, 3.2, 2.2); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.5, far: 8 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), mat(dark ? 0x2e2e31 : 0xe7e2d9, { roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(12, 5), mat(dark ? 0x29292c : 0xf4f1ec, { roughness: 1 }));
  wall.position.set(0, 2.5, -0.65); wall.receiveShadow = true; scene.add(wall);

  let deskObj = null, deskWidth = 0;
  const objects = new Map();   // id -> Group
  const keys = new Map();      // id -> clave para saber si hay que reconstruir
  let current = [];
  let selected = null, ghost = null, ring = null;
  const spawn = new Map();     // id -> t0 (animación de aparición)

  function setDesk(width) {
    if (deskObj && Math.abs(width - deskWidth) < 0.01) return;
    if (deskObj) scene.remove(deskObj);
    deskObj = makeDesk(width); deskWidth = width; scene.add(deskObj);
  }

  function build(it, hostFor) {
    const g = it.type === "light" ? lightbar(it, hostFor) : (BUILD[it.type] || (() => new THREE.Group()))(it);
    g.traverse((o) => { o.userData.itemId = it.id; });
    g.userData.itemId = it.id;
    return g;
  }

  function update(items) {
    current = items;
    const ids = new Set(items.map((i) => i.id));
    for (const [id, g] of objects) if (!ids.has(id)) { scene.remove(g); objects.delete(id); keys.delete(id); }
    const firstMon = items.find((i) => i.type === "monitor");
    // primero todo menos las lámparas (necesitan saber la altura del monitor)
    for (const pass of [0, 1]) for (const it of items) {
      if ((it.type === "light") !== (pass === 1)) continue;
      const key = JSON.stringify([it.type, it.model, it.specs, it.type === "light" ? (firstMon && keys.get(firstMon.id)) : 0]);
      if (keys.get(it.id) === key) continue;
      if (objects.has(it.id)) scene.remove(objects.get(it.id));
      const g = build(it, firstMon && objects.get(firstMon.id));
      objects.set(it.id, g); keys.set(it.id, key); scene.add(g);
      if (!reduceMotion && !spawn.has(it.id) && current.length) spawn.set(it.id, performance.now());
    }
    const { width, pos } = layout(items, objects);
    setDesk(width);
    for (const it of items) {
      const g = objects.get(it.id), p = pos.get(it.id);
      if (!g) continue;
      if (it.type === "light") {
        const host = firstMon && objects.get(firstMon.id);
        if (host) g.position.copy(host.position); g.rotation.y = host ? host.rotation.y : 0;
        continue;
      }
      if (p) { g.position.set(p[0], 0, p[1]); g.rotation.y = p[2] || 0; }
    }
    if (selected && !ids.has(selected)) select(null);
    else if (selected) select(selected);
  }

  function bounds(g) { return new THREE.Box3().setFromObject(g); }

  function select(id) {
    selected = id;
    if (ring) { scene.remove(ring); ring = null; }
    const g = id && objects.get(id);
    if (!g) return;
    const b = bounds(g), size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.z) * 0.62 + 0.03;
    ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.012, 48), new THREE.MeshBasicMaterial({ color: 0xff7a33, transparent: true, opacity: 0.9 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(c.x, (g.userData.size?.floor ? 0 : DESK_H) + 0.002, c.z);
    scene.add(ring);
  }

  /* Vista previa translúcida de un accesorio recomendado */
  function preview(it) {
    if (ghost) { scene.remove(ghost); ghost = null; }
    if (!it) return;
    const all = [...current, it];
    ghost = build(it, current.find((i) => i.type === "monitor") && objects.get(current.find((i) => i.type === "monitor").id));
    ghost.traverse((o) => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.5; o.castShadow = false; } });
    const { pos } = layout(all, new Map([...objects, [it.id, ghost]]));
    const p = pos.get(it.id);
    if (it.type === "light") { const host = objects.get(current.find((i) => i.type === "monitor")?.id); if (host) ghost.position.copy(host.position); }
    else if (p) ghost.position.set(p[0], 0, p[1]);
    scene.add(ghost);
  }

  /* ratón: seleccionar y etiqueta al pasar por encima */
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  function pick(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects([...objects.values()], true).find((h) => h.object.userData.itemId);
    return hit ? hit.object.userData.itemId : null;
  }
  let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const id = pick(e); select(id); onSelect?.(id);
  });
  renderer.domElement.addEventListener("pointermove", (e) => {
    const id = pick(e);
    renderer.domElement.style.cursor = id ? "pointer" : "grab";
    const it = id && current.find((i) => i.id === id);
    if (it) {
      const r = container.getBoundingClientRect();
      tip.textContent = it.model || it.type; tip.style.left = `${e.clientX - r.left + 12}px`; tip.style.top = `${e.clientY - r.top + 12}px`;
      tip.classList.add("on");
    } else tip.classList.remove("on");
    onHover?.(id);
  });
  renderer.domElement.addEventListener("pointerleave", () => tip.classList.remove("on"));

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.fov = w / h < 1 ? 55 : 38; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  let raf = 0, alive = true;
  function loop(t) {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    for (const [id, t0] of spawn) {
      const g = objects.get(id); if (!g) { spawn.delete(id); continue; }
      const k = Math.min(1, (t - t0) / 450), e = 1 - Math.pow(1 - k, 3);
      g.scale.setScalar(0.6 + 0.4 * e); g.position.y = (1 - e) * 0.15;
      if (k >= 1) { g.scale.setScalar(1); g.position.y = 0; spawn.delete(id); }
    }
    if (ring) ring.material.opacity = 0.55 + 0.35 * Math.sin(t / 300);
    controls.update();
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);
  setDesk(1.6);

  return {
    update, select, preview,
    dispose() {
      alive = false; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      scene.traverse((o) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose(); m.dispose(); }); });
      renderer.dispose(); renderer.domElement.remove(); tip.remove();
    },
  };
}

window.Desk3D = { mount };
window.dispatchEvent(new Event("desk3d-ready"));
