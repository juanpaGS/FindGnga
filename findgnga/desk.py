"""Mi escritorio: los dispositivos que tienes y los accesorios que les sacan partido.

- ``identify`` / ``suggest`` (en ``devices.py``): del modelo escrito a la ficha completa.
- ``desk_devices``: convierte el escritorio en dispositivos del perfil, para que la búsqueda
  de monitores y PS5 se adapte a lo que tienes.
- ``recommend``: lo que te falta (elegido por compatibilidad con TODOS tus dispositivos,
  calidad y precio), mejoras de lo que ya tienes que cuestan menos de lo que pagaste,
  cables y hubs, monitores que caben y accesorios de PS5.

Las reglas son orientativas (p. ej. cuántas pantallas admite cada Mac) y la calidad es una
puntuación orientativa de FindGnga: cada recomendación explica el porqué para poder comprobarlo.
"""

from __future__ import annotations

import math
from datetime import date
from typing import Any, Callable

from . import devices, search, storage
from .scoring.monitors import evaluate

ITEM_TYPES = ("monitor", "laptop", "desktop", "ps5", "keyboard", "mouse", "phone", "tablet", "light", "mousepad",
              "headset", "webcam", "hub", "speakers", "arm")
GOOD_PRICE = 0.90   # «buen precio» = al menos un 10 % por debajo del precio de referencia
UPGRADE_GAIN = 8    # una mejora tiene que sacar al menos 8 puntos de calidad a lo que tienes
TYPE_NAME = {"monitor": "monitor", "laptop": "portátil", "desktop": "ordenador", "ps5": "PS5", "keyboard": "teclado",
             "mouse": "ratón", "phone": "móvil", "tablet": "tablet", "light": "luz de monitor", "mousepad": "alfombrilla",
             "headset": "cascos", "webcam": "webcam", "hub": "hub", "speakers": "altavoces", "arm": "brazo de monitor"}

identify = devices.identify
suggest = devices.suggest


# ------------------------------------------------------------------ escritorio ↔ perfil

def read_desk() -> dict[str, Any]:
    return storage.read_user("desk", {"items": [], "style": {}})


def desk_devices(desk: dict[str, Any]) -> list[dict[str, Any]]:
    """Dispositivos del perfil (los que usa la puntuación de monitores) a partir del escritorio."""
    out = []
    for it in desk.get("items", []):
        s, t = it.get("specs") or {}, it.get("type")
        base = {"id": "desk-" + it["id"], "label": it.get("model") or None}
        if t in ("laptop", "desktop") and s.get("platform") == "mac":
            out.append({**base, "kind": "mac_laptop" if t == "laptop" else "mac_desktop",
                        "model_line": s.get("model_line"), "screen_in": s.get("screen_in"),
                        "chip_gen": s.get("chip_gen"), "chip_tier": s.get("chip_tier") or "base", "ram_gb": s.get("ram_gb")})
        elif t == "laptop":
            ports = s.get("ports") or {}
            out.append({**base, "kind": "windows_laptop", "gpu_tier": s.get("gpu_tier") or "integrated",
                        "usb_c_dp": bool(ports.get("usb_c")), "usb_c_charging": bool(ports.get("usb_c"))})
        elif t == "desktop":
            out.append({**base, "kind": "desktop_pc", "gpu_tier": s.get("gpu_tier") or "mid"})
        elif t == "ps5":
            out.append({**base, "kind": "ps5", "edition": s.get("edition") or "standard"})
    return out


def sync_profile(desk: dict[str, Any]) -> dict[str, Any]:
    """Sustituye en el perfil los dispositivos que venían del escritorio (los añadidos a mano se quedan)."""
    profile = storage.read_user("profile", {"devices": [], "uses": [], "priority": 0.5})
    imported = {it["id"][1:] for it in desk.get("items", []) if str(it.get("id", "")).startswith("p")}
    manual = [d for d in profile.get("devices", []) if not str(d.get("id", "")).startswith("desk-") and d.get("id") not in imported]
    profile["devices"] = manual + desk_devices(desk)
    storage.write_user("profile", profile)
    return profile


# ------------------------------------------------------------------ contexto del escritorio

def max_external_displays(it: dict[str, Any]) -> tuple[int, str]:
    """Pantallas externas que admite un ordenador (orientativo, según Apple / lo habitual en PC)."""
    s, t = it.get("specs") or {}, it.get("type")
    if s.get("platform") != "mac":
        return (s.get("max_displays") or 4, "un PC de sobremesa con gráfica suele admitir 3-4 monitores") if t == "desktop" else \
               (s.get("max_displays") or 3, "un portátil Windows suele admitir 2-3 monitores (con dock o hub)")
    gen, tier = s.get("chip_gen") or 0, s.get("chip_tier") or "base"
    chip = f"M{gen or '?'}{devices.TIER_NAME.get(tier, '')}"
    if s.get("max_displays"):
        n = s["max_displays"]
        note = f" ({s['displays_note']})" if s.get("displays_note") else ""
        return n, f"el {'MacBook ' + (s.get('model_line') or '').title() if t == 'laptop' else 'Mac'} con {chip} admite " \
                  f"{n} pantalla{'s' if n > 1 else ''} externa{'s' if n > 1 else ''}{note}"
    spec = devices.mac_laptop_specs(s.get("model_line") or "pro", s.get("screen_in") or 14, gen or 4, tier) if t == "laptop" \
        else devices.mac_desktop_specs(s.get("model_line") or "mini", gen or 4, tier)
    return max_external_displays({**it, "specs": {**s, "max_displays": spec["max_displays"],
                                                  "displays_note": spec.get("displays_note", "")}})


class Ctx:
    def __init__(self, desk: dict[str, Any]):
        self.items = desk.get("items", [])
        self.by = {t: [i for i in self.items if i.get("type") == t] for t in ITEM_TYPES}
        self.computers = self.by["laptop"] + self.by["desktop"]
        self.monitors, self.ps5, self.phones, self.tablets = self.by["monitor"], self.by["ps5"], self.by["phone"], self.by["tablet"]
        self.macs = [c for c in self.computers if self.s(c).get("platform") == "mac"]
        self.pcs = [c for c in self.computers if self.s(c).get("platform") != "mac"]
        profile = storage.read_user("profile", {"devices": [], "uses": [], "priority": 0.5})
        self.profile = profile
        self.uses = profile.get("uses") or []
        self.gaming_pc = any(self.s(c).get("gpu_tier") == "high" for c in self.pcs) or \
            (bool(self.pcs) and any(u.startswith("gaming") for u in self.uses))
        self.gaming = bool(self.ps5) or self.gaming_pc or any(u.startswith("gaming") for u in self.uses)
        self.work = any(u in ("programming", "office", "photo_video") for u in self.uses) or bool(self.computers and not self.gaming_pc)

    @staticmethod
    def s(it: dict[str, Any]) -> dict[str, Any]:
        return it.get("specs") or {}

    @staticmethod
    def name(it: dict[str, Any]) -> str:
        return it.get("model") or TYPE_NAME.get(it.get("type", ""), "")

    def has_bt(self, h: dict[str, Any]) -> bool:
        s = self.s(h)
        if h["type"] in ("phone", "tablet") or s.get("platform") == "mac":
            return True
        return bool(s.get("bt", h["type"] == "laptop"))

    def usb_a(self, h: dict[str, Any]) -> bool:
        return bool((self.s(h).get("ports") or {}).get("usb_a"))


Compat = tuple[float, list[str], list[str]]  # (0-100, a favor, en contra)


def _conn(a: dict[str, Any], h: dict[str, Any], ctx: Ctx) -> str | None:
    """Cómo se conecta un teclado/ratón a un equipo (o None si no se puede)."""
    if a.get("bt") and ctx.has_bt(h):
        return "Bluetooth"
    if h["type"] in ("laptop", "desktop") and a.get("receiver"):
        return f"receptor {a['receiver'].title()}" + ("" if ctx.usb_a(h) else " con adaptador USB-C")
    if h["type"] in ("laptop", "desktop") and not a.get("wireless", True):
        return "cable" + ("" if ctx.usb_a(h) or a.get("usb_c") else " con adaptador")
    return None


def _input_compat(a: dict[str, Any], ctx: Ctx, keyboard: bool) -> Compat:
    hosts = ctx.computers + ctx.tablets
    if not hosts:
        return 0, [], ["No tienes ordenador ni tablet en la mesa"]
    score, pros, cons = 100.0, [], []
    for h in hosts:
        conn = _conn(a, h, ctx)
        if not conn:
            score -= 40
            cons.append(f"{ctx.name(h)}: no se puede conectar" + (" (no tiene Bluetooth)" if a.get("bt") else ""))
            continue
        if "adaptador" in conn:
            score -= 5
        pros.append(f"{ctx.name(h)} ({conn})")
        mac = ctx.s(h).get("platform") == "mac" or ctx.s(h).get("os") == "ios"
        if keyboard and mac and a.get("layout") == "win":
            score -= 15
            cons.append(f"Teclas de Windows: en {ctx.name(h)} las teclas ⌘/⌥ cambian de sitio")
        if keyboard and not mac and a.get("layout") == "mac":
            score -= 30
            cons.append(f"Teclado de Mac: en {ctx.name(h)} (Windows) faltan teclas")
    n = len(hosts)
    multi = a.get("multi") or 1
    if n >= 2:
        if multi >= n:
            pros.append(f"Cambia entre tus {n} equipos con un botón")
        else:
            score -= 15 * (min(n, 3) - multi)
            cons.append(f"Sólo se empareja con {multi} equipo{'s' if multi > 1 else ''} a la vez (tienes {n})")
    if keyboard:
        if a.get("touch_id") and any(m["type"] == "desktop" for m in ctx.macs):
            pros.append("Touch ID en tu Mac de sobremesa")
        if ctx.gaming_pc and a.get("mechanical"):
            score += 5
            pros.append("Mecánico: más preciso para jugar")
        if a.get("backlit"):
            pros.append("Retroiluminado")
    else:
        if ctx.gaming_pc and a.get("gaming"):
            score += 5
            pros.append("Baja latencia para jugar en el PC")
        elif a.get("gaming") and not ctx.gaming_pc:
            score -= 12
            cons.append("Pensado para juegos de PC: para trabajar hay ratones más cómodos")
        if ctx.work and a.get("ergonomic"):
            score += 4
            pros.append("Ergonómico para muchas horas")
    return max(0.0, min(100.0, score)), pros, cons


def compat_keyboard(a: dict[str, Any], ctx: Ctx) -> Compat:
    return _input_compat(a, ctx, True)


def compat_mouse(a: dict[str, Any], ctx: Ctx) -> Compat:
    return _input_compat(a, ctx, False)


def compat_headset(a: dict[str, Any], ctx: Ctx) -> Compat:
    hosts = ctx.ps5 + ctx.computers + ctx.phones + ctx.tablets
    if not hosts:
        return 0, [], ["Nada a lo que conectarlos"]
    score, pros, cons = 100.0, [], []
    for h in hosts:
        n = ctx.name(h)
        if h["type"] == "ps5":
            if a.get("ps5_wireless"):
                pros.append(f"{n} (inalámbricos)")
            elif a.get("ps5_wired") or a.get("wired"):
                score -= 8
                pros.append(f"{n} (con cable al mando)")
            else:
                score -= 35
                cons.append(f"{n}: la PS5 no admite cascos Bluetooth")
        elif h["type"] in ("phone", "tablet"):
            if a.get("bt"):
                pros.append(f"{n} (Bluetooth)")
            elif a.get("wired") and ctx.s(h).get("os") == "android":
                score -= 10
                pros.append(f"{n} (con cable USB-C/adaptador)")
            else:
                score -= 15
                cons.append(f"{n}: sin Bluetooth y sin jack en el móvil")
        else:
            conn = "Bluetooth" if a.get("bt") and ctx.has_bt(h) else "receptor USB" if a.get("dongle") else \
                "cable" if a.get("wired") else None
            if conn:
                pros.append(f"{n} ({conn})")
            else:
                score -= 30
                cons.append(f"{n}: no se puede conectar")
    if ctx.ps5 and (ctx.phones or ctx.computers) and a.get("dongle") and a.get("bt"):
        score += 5
        pros.append("Juegas y a la vez oyes el móvil (receptor + Bluetooth)")
    if a.get("apple_switch") and ctx.macs and any(ctx.s(p).get("os") == "ios" for p in ctx.phones):
        pros.append("Pasan solos del iPhone al Mac")
    if a.get("multipoint") and len([h for h in hosts if h["type"] != "ps5"]) >= 2:
        pros.append("Conectados a dos dispositivos a la vez")
    if ctx.work and a.get("anc"):
        score += 4
        pros.append("Cancelación de ruido para concentrarte")
    if ctx.gaming and a.get("form") == "in_ear":
        score -= 5
    return max(0.0, min(100.0, score)), pros, cons


def compat_light(a: dict[str, Any], ctx: Ctx) -> Compat:
    if not ctx.monitors:
        return 0, [], ["Necesitas un monitor donde apoyarla"]
    score, pros, cons = 100.0, [], []
    for m in ctx.monitors:
        if ctx.s(m).get("curved") and not a.get("curved_ok"):
            score -= 50
            cons.append(f"{ctx.name(m)} es curvo: esta lámpara es para pantallas planas")
        else:
            pros.append(f"Encima de {ctx.name(m)}")
    if a.get("remote"):
        pros.append("Mando para el brillo y el color")
    if a.get("auto_dim"):
        pros.append("Ajusta el brillo sola")
    return max(0.0, score), pros, cons


def compat_hub(a: dict[str, Any], ctx: Ctx) -> Compat:
    laptops = ctx.by["laptop"]
    if not laptops:
        return 0, [], ["Es para portátiles"]
    score, pros, cons = 100.0, [], []
    for c in laptops:
        s = ctx.s(c)
        if a.get("kind") == "dock" and not (s.get("ports") or {}).get("thunderbolt"):
            score -= 60
            cons.append(f"{ctx.name(c)} no tiene Thunderbolt: el dock iría muy limitado")
            continue
        pros.append(ctx.name(c))
        need = s.get("charge_w") or 0
        if a.get("pd_w") and need and a["pd_w"] < need:
            score -= 5
            cons.append(f"Carga a {a['pd_w']} W ({ctx.name(c)} admite {need} W): algo más lento")
    four_k = [m for m in ctx.monitors if (ctx.s(m).get("res_w") or 0) >= 3840]
    if four_k and a.get("kind") == "hub":
        if a.get("hdmi_4k60"):
            pros.append(f"4K a 60 Hz en {ctx.name(four_k[0])}")
        else:
            score -= 30
            cons.append("Sólo 4K a 30 Hz: se nota a tirones")
    if len(ctx.monitors) >= 2 and ctx.macs and a.get("kind") == "hub":
        cons.append("macOS no extiende 2 monitores por un hub HDMI: duplica la imagen (usa un dock Thunderbolt)")
        score -= 15
    return max(0.0, score), pros, cons


def compat_charger(a: dict[str, Any], ctx: Ctx) -> Compat:
    laptops = [c for c in ctx.by["laptop"]]
    need = max([ctx.s(c).get("charge_w") or 65 for c in laptops] or [20])
    score, pros, cons = 100.0, [], []
    if a.get("max_w", 0) >= need:
        pros.append(f"Suficiente para {ctx.name(laptops[0])} ({need} W)" if laptops else "Carga rápida del móvil")
    else:
        score -= 25
        cons.append(f"{ctx.name(laptops[0])} carga hasta {need} W: con {a['max_w']} W irá más lento")
    if ctx.phones and a.get("ports", 1) >= 2:
        pros.append("Además carga el móvil a la vez")
    return score, pros, cons


def compat_arm(a: dict[str, Any], ctx: Ctx) -> Compat:
    mons = ctx.monitors
    if not mons:
        return 0, [], ["Necesitas un monitor"]
    score, pros, cons = 100.0, [], []
    biggest = max(ctx.s(m).get("size_in") or 27 for m in mons)
    if biggest > a.get("max_in", 32):
        score -= 60
        cons.append(f"Tu monitor de {biggest}\" es demasiado grande (hasta {a.get('max_in')}\")")
    else:
        pros.append(f"Sujeta tu monitor de {biggest}\"")
    if len(mons) >= 2 and not a.get("dual"):
        score -= 25
        cons.append("Sólo sujeta una pantalla (tienes 2)")
    if len(mons) == 1 and a.get("dual"):
        score -= 20
        cons.append("Es doble y sólo tienes 1 monitor")
    if len(mons) >= 2 and a.get("dual"):
        pros.append("Tus 2 monitores a la misma altura")
    return max(0.0, score), pros, cons


def compat_webcam(a: dict[str, Any], ctx: Ctx) -> Compat:
    hosts = [c for c in ctx.computers if not ctx.s(c).get("camera")]
    if not hosts:
        return 0, [], ["Tus ordenadores ya tienen cámara"]
    score, pros, cons = 100.0, [], []
    for h in hosts:
        if a.get("usb") == "usb_a" and not ctx.usb_a(h):
            score -= 10
            cons.append(f"{ctx.name(h)} no tiene USB-A: necesitas adaptador")
        else:
            pros.append(f"{ctx.name(h)} (no trae cámara)")
    return max(0.0, score), pros, cons


def compat_speakers(a: dict[str, Any], ctx: Ctx) -> Compat:
    pros = [ctx.name(c) for c in ctx.computers]
    if a.get("bt") and ctx.phones:
        pros.append("Música del móvil por Bluetooth")
    return 100.0, pros, []


def compat_mousepad(a: dict[str, Any], ctx: Ctx) -> Compat:
    pros = []
    if (a.get("w_cm") or 0) >= 80:
        pros.append("Caben el teclado y el ratón")
    return 100.0, pros, []


COMPAT: dict[str, Callable[[dict[str, Any], Ctx], Compat]] = {
    "keyboard": compat_keyboard, "mouse": compat_mouse, "headset": compat_headset, "light": compat_light,
    "hub": compat_hub, "charger": compat_charger, "arm": compat_arm, "webcam": compat_webcam,
    "speakers": compat_speakers, "mousepad": compat_mousepad,
}


# ------------------------------------------------------------------ recomendaciones

def _priced(product: dict[str, Any], today: date | None) -> dict[str, Any]:
    pricing = search._priced(product, "accessory", today)
    ref = float(product["ref_price"])
    pricing["good_price"] = bool(not pricing["estimated"] and pricing["final_price"] <= ref * GOOD_PRICE)
    return pricing


SECTIONS = [
    ("missing", "🧩", "Lo que te falta", "Elegido para que funcione con todos tus dispositivos, con buena calidad y buen precio."),
    ("upgrades", "⭐", "Mejoras que compensan", "Mejor que lo que ya tienes y por menos de lo que pagaste (o de su precio de referencia)."),
    ("connect", "🔌", "Para conectarlo todo", "Hubs, docks, cables y cargadores para tus dispositivos."),
    ("monitors", "🖥️", "Más monitores compatibles", "Pantallas que puedes añadir y que encajan con lo que tienes."),
    ("extras", "🪑", "Extras útiles", "Soportes, carga del móvil, almacenamiento y ergonomía."),
    ("ps5", "🎮", "Para tu PS5", "Accesorios oficiales y mejoras de la consola."),
]

PLACE_TYPE = {"light": "light", "mousepad": "mousepad", "keyboard": "keyboard", "mouse": "mouse", "headset": "headset",
              "webcam": "webcam", "hub": "hub", "speakers": "speakers", "arm": "arm"}


class Recs:
    def __init__(self, ctx: Ctx, today: date | None):
        self.ctx, self.today = ctx, today
        self.acc = storage.load_catalog("accessories")
        self.by_id = {a["id"]: a for a in self.acc}
        self.out: dict[str, list[dict[str, Any]]] = {k: [] for k, *_ in SECTIONS}
        self.seen: set[str] = set()
        self._prices: dict[str, dict[str, Any]] = {}

    def pricing(self, p: dict[str, Any]) -> dict[str, Any]:
        if p["id"] not in self._prices:
            self._prices[p["id"]] = _priced(p, self.today)
        return self._prices[p["id"]]

    def rec(self, p: dict[str, Any], reason: str, for_items: list[dict[str, Any]] | None = None, prio: int = 2,
            compat: Compat | None = None) -> dict[str, Any]:
        c = compat or (COMPAT[p["kind"]](p.get("specs", {}), self.ctx) if p["kind"] in COMPAT else None)
        return {"product": p, "reason": reason, "priority": prio, "pricing": self.pricing(p),
                "for": [i["id"] for i in (for_items or [])], "links": search.store_links(p["search_query"]),
                "placeable": p["kind"] in PLACE_TYPE, "place_type": PLACE_TYPE.get(p["kind"]),
                "quality": p.get("quality"), "badges": [],
                "compat": {"score": round(c[0]), "pros": c[1], "cons": c[2]} if c else None}

    def add(self, section: str, acc_id: str, reason: str, for_items: list[dict[str, Any]] | None = None, prio: int = 2) -> None:
        if acc_id in self.seen or acc_id not in self.by_id:
            return
        self.seen.add(acc_id)
        self.out[section].append(self.rec(self.by_id[acc_id], reason, for_items, prio))

    def ranked(self, kind: str, exclude: set[str] = frozenset()) -> list[dict[str, Any]]:
        """Candidatos de un tipo ordenados por compatibilidad y calidad, penalizando lo que es caro para su tipo."""
        cands = []
        for p in self.acc:
            if p["kind"] != kind or p["id"] in exclude:
                continue
            c = COMPAT[kind](p.get("specs", {}), self.ctx)
            price = self.pricing(p)["final_price"] or p["ref_price"]
            cands.append({"p": p, "compat": c, "price": price, "value": (p.get("quality") or 50) / max(price, 1)})
        prices = sorted(c["price"] for c in cands)
        median = prices[len(prices) // 2] if prices else 1
        for c in cands:
            # mitad compatibilidad, mitad calidad; lo que pase de la mediana de precio de su tipo resta
            c["score"] = 0.5 * c["compat"][0] + 0.5 * (c["p"].get("quality") or 50) - \
                10 * max(0.0, math.log2(c["price"] / max(median, 1)))
        return sorted(cands, key=lambda c: -c["score"])

    def best_of(self, kind: str, why: str, for_items: list[dict[str, Any]], prio: int = 2, n: int = 2) -> None:
        """Lo mejor de un tipo que te falta: la opción más completa y, si es otra, la más barata que cumple."""
        cands = [c for c in self.ranked(kind) if c["compat"][0] >= 60]
        if not cands:
            return
        picks = [(cands[0], "🏆 Mejor opción para tu escritorio")]
        cheap = sorted([c for c in cands[1:] if c["compat"][0] >= 75 and (c["p"].get("quality") or 0) >= 65],
                       key=lambda c: c["price"])
        if cheap and cheap[0]["price"] < cands[0]["price"] * 0.8 and n >= 2:
            picks.append((cheap[0], "💶 La más barata que cumple"))
        elif len(cands) > 1 and n >= 2:
            picks.append((cands[1], "🥈 Alternativa"))
        for c, badge in picks:
            if c["p"]["id"] in self.seen:
                continue
            self.seen.add(c["p"]["id"])
            r = self.rec(c["p"], why, for_items, prio, c["compat"])
            r["badges"].append(badge)
            self.out["missing"].append(r)


def recommend(desk: dict[str, Any] | None = None, today: date | None = None) -> dict[str, Any]:
    desk = desk if desk is not None else read_desk()
    ctx = Ctx(desk)
    R = Recs(ctx, today)
    by, computers, monitors, ps5 = ctx.by, ctx.computers, ctx.monitors, ctx.ps5
    notes: list[str] = []
    s = ctx.s

    # --- lo que te falta (elegido por compatibilidad con todo lo demás)
    hosts_txt = ", ".join(ctx.name(h) for h in computers + ctx.tablets)
    if computers and not by["keyboard"]:
        R.best_of("keyboard", f"No tienes teclado en la mesa. Elegido para {hosts_txt}.", computers + ctx.tablets, 1)
    if computers and not by["mouse"]:
        R.best_of("mouse", f"No tienes ratón en la mesa. Elegido para {hosts_txt}.", computers + ctx.tablets, 1)
    if not by["headset"] and (computers or ps5):
        R.best_of("headset", "No tienes cascos. Elegidos para " + ", ".join(ctx.name(h) for h in ps5 + computers + ctx.phones) + ".",
                  ps5 + computers + ctx.phones, 2)
    if monitors and not by["light"]:
        R.best_of("light", "Ilumina la mesa sin reflejos en la pantalla y cansa menos la vista.", monitors, 2)
    if monitors and not by["arm"]:
        R.best_of("arm", "Pantalla a la altura de los ojos y la mesa libre.", monitors, 3, n=1)
    if not by["mousepad"] and (by["keyboard"] or by["mouse"] or computers):
        R.best_of("mousepad", "Teclado y ratón sobre la misma superficie y la mesa protegida.", by["keyboard"] + by["mouse"], 3, n=1)
    no_cam = [c for c in computers if not s(c).get("camera")]
    if no_cam and not by["webcam"]:
        R.best_of("webcam", f"{ctx.name(no_cam[0])} no tiene cámara: para videollamadas.", no_cam, 2)
        if ctx.macs and any(s(p).get("continuity_camera") for p in ctx.phones):
            R.add("missing", "acc-magsafe-mount-mac", "Alternativa barata: tu iPhone como webcam del Mac (Cámara de Continuidad).",
                  ctx.phones + ctx.macs, 2)
    desktops_no_audio = [c for c in by["desktop"] if not s(c).get("speakers") or s(c).get("platform") != "mac"]
    if desktops_no_audio and not by["speakers"] and s(desktops_no_audio[0]).get("model_line") != "imac":
        R.best_of("speakers", f"{ctx.name(desktops_no_audio[0])}: sonido de verdad sin ponerte los cascos.", desktops_no_audio, 3, n=1)

    # --- conectar
    mon_usbc = [m for m in monitors if s(m).get("usb_c")]
    mon_hdmi21 = [m for m in monitors if s(m).get("hdmi21")]
    mon_dp = [m for m in monitors if s(m).get("dp")]
    owns_hub = bool(by["hub"])
    for c in computers:
        ports = s(c).get("ports") or {}
        name = ctx.name(c)
        if c["type"] == "laptop" and ports.get("usb_c") and not ports.get("hdmi") and not owns_hub:
            cands = [x for x in R.ranked("hub") if x["p"]["id"] == "acc-hub-usbc-hdmi"]
            if cands and cands[0]["compat"][0] >= 50:
                R.add("connect", "acc-hub-usbc-hdmi", f"{name} sólo tiene USB-C: con un hub conectas un monitor por HDMI, "
                      "memorias USB y el cargador a la vez.", [c], 3 if mon_usbc else 1)
        if c["type"] == "laptop" and ports.get("thunderbolt") and len(monitors) >= 2 and \
                not any(s(h).get("kind") == "dock" for h in by["hub"]):
            R.add("connect", "acc-dock-thunderbolt4", f"Tienes {len(monitors)} monitores: con un dock Thunderbolt conectas "
                  f"{name} con un solo cable (pantallas, carga y USB).", [c], 2)
        if mon_usbc and ports.get("usb_c"):
            pd = max(s(m).get("usb_c_pd_w") or 0 for m in mon_usbc)
            need = s(c).get("charge_w") or 0
            slow = f" Ojo: el monitor da {pd} W y {name} admite {need} W, cargará algo más lento." if pd and need and pd < need else ""
            R.add("connect", "acc-cable-usbc-tb4", f"Tu monitor tiene USB-C: un solo cable lleva imagen y "
                  f"{'carga (' + str(pd) + ' W)' if pd else 'datos'} a {name}.{slow}", [c] + mon_usbc, 1)
        if c["type"] == "laptop" and ports.get("usb_c") and mon_dp and not mon_usbc and not ports.get("hdmi"):
            R.add("connect", "acc-cable-usbc-dp", f"Para conectar {name} directo a la entrada DisplayPort del monitor.", [c], 2)
        if c["type"] == "desktop" and s(c).get("platform") != "mac" and \
                any((s(m).get("refresh_hz") or 60) >= 120 and s(m).get("dp") for m in monitors):
            R.add("connect", "acc-cable-dp14", "Tu monitor va a 120 Hz o más: por DisplayPort 1.4 sacas todos los Hz con "
                  "G-Sync/FreeSync desde el PC.", [c], 2)
    if ps5 and mon_hdmi21:
        R.add("connect", "acc-cable-hdmi21", "Tu monitor tiene HDMI 2.1: con un cable Ultra High Speed la PS5 va a 4K/120 Hz "
              "con VRR (el de la caja es corto).", ps5 + mon_hdmi21, 2)
    usb_c_phones = [p for p in ctx.phones if s(p).get("connector") == "usb_c"]
    if by["laptop"] or usb_c_phones:
        need = max([s(c).get("charge_w") or 65 for c in by["laptop"]] or [20])
        best = "acc-charger-gan100" if need > 70 else "acc-charger-gan65"
        R.add("connect", best, f"Un cargador GaN carga {'el portátil y ' if by['laptop'] else ''}el móvil a la vez con un solo enchufe.",
              by["laptop"] + ctx.phones, 3)

    # --- monitores: cuántos más caben y cuáles encajan
    owned_ids = {m.get("catalog_id") for m in monitors if m.get("catalog_id")}
    room = None
    if computers:
        limits = [(max_external_displays(c), c) for c in computers]
        (limit, why), main = max(limits, key=lambda x: x[0][0])
        room = limit - len(monitors)
        if room <= 0:
            notes.append(f"Ya tienes {len(monitors)} monitor(es) y {why}: no se recomiendan más pantallas para "
                         f"{ctx.name(main)} (orientativo).")
        else:
            notes.append(f"Puedes añadir {room} monitor(es) más: {why} (orientativo).")
    monitor_recs: list[dict[str, Any]] = []
    devs = desk_devices(desk)
    if devs or monitors:
        profile = ctx.profile
        ranked = search.search_monitors({**profile, "devices": devs}, uses=profile.get("uses") or None, today=today)
        candidates = [r for r in ranked["results"] if r["product"]["id"] not in owned_ids]
        if room is None or room > 0:
            for r in candidates[:3]:
                monitor_recs.append({**r, "reason": "Compatible con " + (", ".join(d["label"] or d["kind"] for d in devs)
                                                                        or "tu escritorio"), "section": "monitors"})
        # Mejora de tu monitor: mejor nota y más barato de lo que pagaste
        cat_mons = {x["id"]: x for x in storage.load_catalog("monitors")}
        for m in monitors:
            cat = cat_mons.get(m.get("catalog_id"))
            if not cat:
                continue
            mine = evaluate(cat, devs, profile.get("uses") or [], profile.get("size_pref"))["fit"]
            budget, src = (m.get("paid"), "pagaste") if m.get("paid") else (cat.get("ref_price"), "es su precio de referencia (orientativo)")
            better = [r for r in candidates if r["eval"]["fit"] >= mine + UPGRADE_GAIN and r["pricing"]["final_price"] <= budget]
            for r in better[:2]:
                monitor_recs.append({**r, "section": "upgrades",
                                     "reason": f"Encaja mejor con tus dispositivos que tu {ctx.name(m)} "
                                               f"({r['eval']['fit']:.0f} frente a {mine:.0f} de 100) y cuesta "
                                               f"{r['pricing']['final_price']:.0f} €, menos de los {budget:.0f} € que {src}."})
            if not better and m.get("paid"):
                notes.append(f"Tu {ctx.name(m)} está bien: no hay un monitor claramente mejor por menos de los {budget:.0f} € que pagaste.")
            if not better and not m.get("paid"):
                notes.append(f"Pon cuánto pagaste por {ctx.name(m)} (✏️ en Mi escritorio) para buscar monitores mejores que cuesten menos.")

    # --- mejoras de lo que ya tienes: mejor calidad y más barato que lo que pagaste
    for it in ctx.items:
        kind = it.get("type")
        if kind not in COMPAT or kind in ("charger",):
            continue
        entry = devices.by_id(it.get("catalog_id"))
        owned_q = (entry or {}).get("quality")
        name = ctx.name(it)
        if owned_q is None:
            if it.get("model"):
                notes.append(f"No reconocemos el modelo de {name}: elígelo de la lista al editarlo para ver mejoras.")
            continue
        budget, src = (it.get("paid"), "pagaste") if it.get("paid") else ((entry or {}).get("ref_price"), "cuesta el tuyo (orientativo)")
        if not budget:
            notes.append(f"Pon cuánto pagaste por {name} (✏️ en Mi escritorio) para ver mejoras que compensen.")
            continue
        mine_c = COMPAT[kind](it.get("specs") or {}, ctx)[0]

        def better_than_mine(c: dict[str, Any]) -> str | None:
            q = c["p"].get("quality") or 0
            if q >= owned_q + UPGRADE_GAIN and c["compat"][0] >= mine_c - 5:
                return f"más calidad ({q} frente a {owned_q} de 100, orientativo)"
            if c["compat"][0] >= mine_c + 20 and q >= owned_q - 2:
                return f"funciona con más de tus dispositivos (compatibilidad {c['compat'][0]:.0f} frente a {mine_c:.0f})"
            return None

        better = [(c, why) for c in R.ranked(kind, {it.get("catalog_id") or ""})
                  if (why := better_than_mine(c)) and c["price"] <= budget]
        if not better:
            notes.append(f"Tu {name} está bien: no hay nada claramente mejor por menos de los {budget:.0f} € que {src}.")
        for c, why in better[:2]:
            if c["p"]["id"] in R.seen:
                continue
            R.seen.add(c["p"]["id"])
            r = R.rec(c["p"], f"Mejora tu {name}: {why} y cuesta {c['price']:.0f} €, menos de los {budget:.0f} € que {src}.",
                      [it], 2, c["compat"])
            r["badges"].append("⬆️ Mejora")
            R.out["upgrades"].append(r)

    # --- extras
    if len(monitors) and by["laptop"]:
        R.add("extras", "acc-laptop-stand", "Con el portátil elevado, su pantalla queda a la altura del monitor.", by["laptop"], 3)
    for p in ctx.phones:
        ps = s(p)
        if ps.get("magsafe") or ps.get("qi2"):
            R.add("extras", "acc-wireless-charger-3in1", f"Tu {ctx.name(p)} tiene {'MagSafe' if ps.get('magsafe') else 'Qi2'}: "
                  "carga sin cables junto al reloj y los auriculares.", [p], 3)
        elif ps.get("qi"):
            R.add("extras", "acc-qi-charger-stand", f"Tu {ctx.name(p)} carga sin cables: de pie en la mesa ves las notificaciones.", [p], 3)
        else:
            R.add("extras", "acc-phone-stand", "El móvil a la vista para notificaciones y videollamadas.", [p], 3)
    small = [c for c in ctx.macs if (s(c).get("storage_gb") or 9999) <= 512]
    if small:
        R.add("extras", "acc-ssd-samsung-t7", f"{ctx.name(small[0])} tiene {s(small[0])['storage_gb']} GB: un SSD externo para "
              "Time Machine, fotos y proyectos.", small, 2)

    # --- PS5
    for p in ps5:
        ed = s(p).get("edition")
        if ed in ("digital", "pro"):
            R.add("ps5", "acc-ps5-disc-drive", f"Tu PS5 {'Digital' if ed == 'digital' else 'Pro'} no tiene lector: con la unidad "
                  "oficial puedes jugar con discos (más baratos de segunda mano).", [p], 2)
        R.add("ps5", "acc-dualsense", "Segundo mando para jugar a dobles.", [p], 3)
        R.add("ps5", "acc-dualsense-charger", "Carga los mandos sin ocupar los USB de la consola.", [p], 3)
        storage_gb = s(p).get("storage_gb") or 1000
        R.add("ps5", "acc-ssd-ps5-2tb", f"Tu PS5 trae {storage_gb / 1000:g} TB y los juegos ocupan 50-150 GB: con 2 TB más dejas "
              "de borrar juegos.", [p], 2 if storage_gb < 2000 else 3)

    # --- lo que hoy tiene buen precio también va a mejoras
    for sec in ("missing", "connect", "extras", "ps5"):
        for r in R.out[sec]:
            if r["pricing"]["good_price"] and "💸 Buen precio ahora" not in r["badges"]:
                r["badges"].append("💸 Buen precio ahora")

    if ps5 and monitors and not mon_hdmi21:
        where = ("Mira «Mejoras que compensan»." if any(m["section"] == "upgrades" for m in monitor_recs) else
                 "Mira «Más monitores compatibles»." if monitor_recs else "Busca uno con HDMI 2.1 en 🖥️ Monitores.")
        notes.append("Tus monitores no tienen HDMI 2.1: la PS5 irá como mucho a 60 Hz en 4K. " + where)

    for key in ("connect", "extras", "ps5", "upgrades"):
        R.out[key].sort(key=lambda r: (r["priority"], r["pricing"]["final_price"]))
    sections = []
    for key, icon, title, desc in SECTIONS:
        mons = [m for m in monitor_recs if m["section"] == key]
        if R.out[key] or mons:
            sections.append({"id": key, "icon": icon, "title": title, "desc": desc, "items": R.out[key], "monitors": mons})
    return {"sections": sections, "notes": list(dict.fromkeys(notes)),
            "count": sum(len(x["items"]) + len(x["monitors"]) for x in sections), "empty": not ctx.items}
