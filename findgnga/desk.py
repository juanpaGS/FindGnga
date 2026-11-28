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


KIND_LABELS: dict[str, tuple[str, str]] = {
    "keyboard": ("⌨️", "Teclados"), "mouse": ("🖱️", "Ratones"), "headset": ("🎧", "Cascos"), "light": ("💡", "Lámparas de monitor"),
    "webcam": ("📷", "Webcams"), "hub": ("🔌", "Hubs y docks"), "charger": ("🔋", "Cargadores"), "cable": ("🧵", "Cables"),
    "arm": ("🦾", "Brazos de monitor"), "stand": ("📐", "Soportes de portátil"), "mousepad": ("🟫", "Alfombrillas"),
    "speakers": ("🔊", "Altavoces"), "storage": ("💾", "Almacenamiento"), "phone_acc": ("📱", "Para el móvil"),
    "ps5_acc": ("🎮", "Para la PS5"),
}


def _browse(self: "Recs") -> list[dict[str, Any]]:
    """Todo el catálogo agrupado por tipo, cada producto con su compatibilidad con TU escritorio, para comparar de un vistazo."""
    owned = {i.get("catalog_id") for i in self.ctx.items if i.get("catalog_id")}
    groups = []
    for kind, (icon, label) in KIND_LABELS.items():
        prods = [p for p in self.acc if p["kind"] == kind]
        if not prods:
            continue
        items = []
        for p in prods:
            r = self.rec(p, p.get("notes", ""))
            r["owned"] = p["id"] in owned
            r["recommended"] = p["id"] in self.seen
            items.append(r)
        # compatibles primero, luego calidad por euro (orientativo)
        items.sort(key=lambda r: (r["owned"], -(r["compat"]["score"] if r["compat"] else 80),
                                  -(r["quality"] or 50) / max(r["pricing"]["final_price"] or r["product"]["ref_price"], 1) * 100))
        fits = [r for r in items if not r["compat"] or r["compat"]["score"] >= 60]
        groups.append({"kind": kind, "icon": icon, "label": label, "items": items, "count": len(items), "fits": len(fits),
                       "from_price": min((r["pricing"]["final_price"] or r["product"]["ref_price"]) for r in items)})
    return groups


Recs.browse = _browse  # type: ignore[attr-defined]


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
    return {"sections": sections, "notes": list(dict.fromkeys(notes)), "browse": R.browse(),
            "count": sum(len(x["items"]) + len(x["monitors"]) for x in sections), "empty": not ctx.items}


# ------------------------------------------------------------------ la mesa: medidas reales (v0.6)
#
# Todo en centímetros. Origen = centro del tablero principal; x hacia la derecha, z hacia ti.
# Una mesa en L añade un «retorno» en un lado que sale hacia ti (return_w × return_d desde el borde
# trasero). Las posiciones de los objetos (`pos`) se guardan en metros, como las usa el 3D.

TABLE_SHAPES = ("rect", "l_left", "l_right")
TABLE_LEGS = ("four", "a_frame", "t_frame", "standing", "trestle", "drawers")
TABLE_MATERIALS = ("oak", "walnut", "white", "black", "bamboo", "gray", "glass")
LEG_COLORS = ("black", "white", "silver")
TABLE_LIMITS = {"width_cm": (60.0, 300.0), "depth_cm": (40.0, 120.0), "height_cm": (55.0, 130.0), "top_cm": (1.0, 8.0),
                "corner_cm": (0.0, 30.0), "return_w_cm": (30.0, 120.0), "return_d_cm": (60.0, 220.0)}
TABLE_DEFAULT: dict[str, Any] = {"preset": "custom", "width_cm": 160.0, "depth_cm": 70.0, "height_cm": 74.0, "top_cm": 2.5,
                                 "shape": "rect", "corner_cm": 0.0, "return_w_cm": 60.0, "return_d_cm": 120.0,
                                 "legs": "four", "material": "oak", "leg_color": "black"}
SIDE_ES = {"front": "por delante", "back": "por detrás", "left": "por la izquierda", "right": "por la derecha"}
TOL = 0.5   # cm: menos que esto no se avisa (redondeos)


def normalize_table(table: dict[str, Any] | None, style: dict[str, Any] | None = None) -> dict[str, Any]:
    """Mesa con valores válidos y coherentes. Sin `table` (escritorios de antes) se deduce del estilo."""
    t = dict(TABLE_DEFAULT)
    style = style or {}
    if not table:
        try:
            if float(style.get("width") or 0) > 0:
                t["width_cm"] = float(style["width"]) * 100
            if float(style.get("depth") or 0) > 0:
                t["depth_cm"] = float(style["depth"]) * 100
        except (TypeError, ValueError):
            pass
        if style.get("desk") in TABLE_MATERIALS:
            t["material"] = style["desk"]
        if style.get("legs") in LEG_COLORS:
            t["leg_color"] = style["legs"]
    else:
        t.update({k: v for k, v in table.items() if k in TABLE_DEFAULT and v is not None})
    for k, (lo, hi) in TABLE_LIMITS.items():
        try:
            v = float(t[k])
        except (TypeError, ValueError):
            v = float(TABLE_DEFAULT[k])
        t[k] = round(min(hi, max(lo, v)), 1)
    for k, allowed in (("shape", TABLE_SHAPES), ("legs", TABLE_LEGS), ("material", TABLE_MATERIALS), ("leg_color", LEG_COLORS)):
        if t[k] not in allowed:
            t[k] = TABLE_DEFAULT[k]
    t["preset"] = str(t.get("preset") or "custom")[:60]
    t["corner_cm"] = round(max(0.0, min(t["corner_cm"], min(t["width_cm"], t["depth_cm"]) / 2 - 1)), 1)
    if t["shape"] != "rect":
        t["return_d_cm"] = max(t["return_d_cm"], t["depth_cm"] + 10)
        t["return_w_cm"] = min(t["return_w_cm"], t["width_cm"] - 20)
    return t


def presets() -> list[dict[str, Any]]:
    """Mesas reales habituales (medidas orientativas si llevan approx)."""
    out = []
    for p in devices.desk_presets():
        t = normalize_table({k: v for k, v in p.items() if k in TABLE_DEFAULT})
        t["preset"] = p["id"]
        out.append({"id": p["id"], "name": p["name"], "approx": bool(p.get("approx")), "table": t})
    return out


def table_rects(t: dict[str, Any]) -> list[tuple[float, float, float, float]]:
    """Rectángulos (x0, z0, x1, z1) que forman el tablero."""
    W, D = t["width_cm"], t["depth_cm"]
    rects = [(-W / 2, -D / 2, W / 2, D / 2)]
    rw, rd = t["return_w_cm"], t["return_d_cm"]
    if t["shape"] == "l_right":
        rects.append((W / 2 - rw, -D / 2, W / 2, -D / 2 + rd))
    elif t["shape"] == "l_left":
        rects.append((-W / 2, -D / 2, -W / 2 + rw, -D / 2 + rd))
    return rects


def table_corners(t: dict[str, Any]) -> list[tuple[float, float, int, int]]:
    """Esquinas exteriores (x, z, sentido x, sentido z): las que se redondean con `corner_cm`."""
    W, D, rw, rd = t["width_cm"], t["depth_cm"], t["return_w_cm"], t["return_d_cm"]
    back = [(-W / 2, -D / 2, -1, -1), (W / 2, -D / 2, 1, -1)]
    if t["shape"] == "l_right":
        return back + [(-W / 2, D / 2, -1, 1), (W / 2, -D / 2 + rd, 1, 1), (W / 2 - rw, -D / 2 + rd, -1, 1)]
    if t["shape"] == "l_left":
        return back + [(W / 2, D / 2, 1, 1), (-W / 2, -D / 2 + rd, -1, 1), (-W / 2 + rw, -D / 2 + rd, 1, 1)]
    return back + [(-W / 2, D / 2, -1, 1), (W / 2, D / 2, 1, 1)]


def on_table(t: dict[str, Any], x: float, z: float) -> bool:
    if not any(x0 - 1e-6 <= x <= x1 + 1e-6 and z0 - 1e-6 <= z <= z1 + 1e-6 for x0, z0, x1, z1 in table_rects(t)):
        return False
    r = t.get("corner_cm") or 0
    if r > 0:
        for cx, cz, sx, sz in table_corners(t):
            ox, oz = cx - sx * r, cz - sz * r            # centro del redondeo
            if (x - ox) * sx > 0 and (z - oz) * sz > 0 and math.hypot(x - ox, z - oz) > r + 1e-6:
                return False
    return True


def outside(t: dict[str, Any], x: float, z: float) -> tuple[float, str]:
    """Cuánto (cm) queda un punto fuera del tablero y por qué lado."""
    if on_table(t, x, z):
        return 0.0, ""
    best = (1e9, "")
    for x0, z0, x1, z1 in table_rects(t):
        dx = x0 - x if x < x0 else x - x1 if x > x1 else 0.0
        dz = z0 - z if z < z0 else z - z1 if z > z1 else 0.0
        dist = math.hypot(dx, dz)
        side = ("left" if x < x0 else "right") if dx >= dz else ("back" if z < z0 else "front")
        if dist < best[0]:
            best = (dist, side)
    if best[0] < TOL:   # dentro de los rectángulos pero en la parte redondeada de una esquina
        r = t.get("corner_cm") or 0
        for cx, cz, sx, sz in table_corners(t):
            ox, oz = cx - sx * r, cz - sz * r
            if (x - ox) * sx > 0 and (z - oz) * sz > 0:
                return math.hypot(x - ox, z - oz) - r, ("front" if sz > 0 else "back")
    return best


class Part:
    """Huella de (una parte de) un objeto: rectángulo girado en planta + franja de altura."""
    __slots__ = ("id", "name", "kind", "cx", "cz", "w", "d", "rot", "y0", "y1")

    def __init__(self, id_: str, name: str, kind: str, cx: float, cz: float, w: float, d: float, rot: float,
                 y0: float, y1: float):
        self.id, self.name, self.kind = id_, name, kind
        self.cx, self.cz, self.w, self.d, self.rot, self.y0, self.y1 = cx, cz, w, d, rot, y0, y1

    def corners(self) -> list[tuple[float, float]]:
        c, s = math.cos(self.rot), math.sin(self.rot)
        out = []
        for lx, lz in ((-self.w / 2, -self.d / 2), (self.w / 2, -self.d / 2), (self.w / 2, self.d / 2), (-self.w / 2, self.d / 2)):
            # igual que rotation.y de Three.js: x' = x cos + z sin, z' = -x sin + z cos
            out.append((self.cx + lx * c + lz * s, self.cz - lx * s + lz * c))
        return out

    def samples(self, n: int = 4) -> list[tuple[float, float]]:
        cs = self.corners()
        pts = []
        for i in range(4):
            (ax, az), (bx, bz) = cs[i], cs[(i + 1) % 4]
            pts += [(ax + (bx - ax) * k / n, az + (bz - az) * k / n) for k in range(n)]
        return pts


def _local(it_rot: float, ox: float, oz: float) -> tuple[float, float]:
    c, s = math.cos(it_rot), math.sin(it_rot)
    return ox * c + oz * s, -ox * s + oz * c


def held_map(items: list[dict[str, Any]]) -> dict[str, str]:
    """Qué monitores cuelgan de un brazo (en orden: un brazo doble se lleva dos). Igual que en el 3D."""
    mons = [i for i in items if i.get("type") == "monitor"]
    held: dict[str, str] = {}
    k = 0
    for a in (i for i in items if i.get("type") == "arm"):
        n = 2 if (a.get("specs") or {}).get("dual") else 1
        for m in mons[k:k + n]:
            held[m["id"]] = a["id"]
        k += n
    return held


def item_dims(it: dict[str, Any]) -> dict[str, Any]:
    auto = devices.dims(it.get("type", ""), it.get("specs") or {}, it.get("catalog_id"))
    return devices.resolve_dims(auto, it.get("dims"))


LID_TILT = math.radians(20)   # tapa del portátil abierta a 110°
HELD_LIFT = 17.0              # cm de la mesa al borde inferior de una pantalla en brazo


def parts_for(it: dict[str, Any], dm: dict[str, Any], held: bool, has_host: bool) -> list[Part]:
    """Partes de un objeto colocado (pos en metros → cm). Mismas reglas que el dibujo 3D."""
    t, p = it.get("type"), it.get("pos") or {}
    if not p or t is None:
        return []
    x, z, rot = float(p.get("x", 0)) * 100, float(p.get("z", 0)) * 100, float(p.get("rot", 0))
    name = it.get("model") or TYPE_NAME.get(t, t)
    w, d, h = float(dm.get("w", 20)), float(dm.get("d", 20)), float(dm.get("h", 5))
    P = lambda kind, ox, oz, pw, pd, y0, y1: Part(it["id"], name, kind, x + _local(rot, ox, oz)[0], z + _local(rot, ox, oz)[1],
                                                  pw, pd, rot, y0, y1)
    if t in ("light", "webcam") and has_host:
        return []                                       # van encima de la pantalla
    if t == "desktop" and dm.get("floor"):
        return [P("floor", 0, 0, w, d, 0, h)]
    if t == "monitor" or (t == "desktop" and "panel_h" in dm):
        body_t, sag = float(dm.get("body_t", 5)), float(dm.get("sagitta", 0))
        depth = body_t + sag
        lift = HELD_LIFT if held else float(dm.get("lift", 10))
        top = lift + float(dm.get("panel_h", h)) + float(dm.get("bezel", 0.8)) + float(dm.get("chin", 1.5))
        if held:
            return [P("panel", 0, 0, w, depth, lift, top)]
        off = max(0.0, (d - depth) * 0.25)
        pz = -d / 2 + off + depth / 2
        return [P("foot", 0, 0, float(dm.get("stand_w", w * 0.4)), float(dm.get("stand_d", d)), 0, lift),
                P("panel", 0, pz, w, depth, lift, top)]
    if t == "laptop":
        lid = float(dm.get("panel_h", d * 0.85)) + 1.5
        back = lid * math.sin(LID_TILT)
        return [P("foot", 0, 0, w, d, 0, h), P("panel", 0, -d / 2 - back / 2, w, back, h, h + lid * math.cos(LID_TILT))]
    if t == "ps5":
        if it.get("orient") == "horizontal":
            return [P("foot", 0, 0, h, d, 0, w)]
        return [P("foot", 0, 0, w, d, 0, h)]
    if t == "speakers":
        span = float(it.get("span") or 0.45) * 100
        return [Part(it["id"], name, "foot", x + _local(rot, sx * span, 0)[0], z + _local(rot, sx * span, 0)[1], w, d,
                     rot - sx * 0.28, 0, h) for sx in (-1, 1)]
    if t == "mousepad":
        return [P("flat", 0, 0, w, d, 0, h)]
    if t == "headset" and dm.get("w", 0) > 10:          # cascos de diadema en su soporte
        return [P("foot", 0, 0, 12, 12, 0, h + 8)]
    if t == "tablet":
        return [P("foot", 0, 0, w, min(15.0, d), 0, d)]
    if t == "arm":
        return [P("clamp", 0, 0, w, d, 0, h)]
    return [P("foot", 0, 0, w, d, 0, h)]


def _sat(a: Part, b: Part) -> float:
    """Solape en planta de dos rectángulos girados: lo que habría que separarlos (cm); 0 si no se tocan."""
    ca, cb = a.corners(), b.corners()
    depth = 1e9
    for poly in (ca, cb):
        for i in range(2):
            (x0, z0), (x1, z1) = poly[i], poly[i + 1]
            ax, az = x1 - x0, z1 - z0
            n = math.hypot(ax, az) or 1
            ax, az = ax / n, az / n
            pa = [px * ax + pz * az for px, pz in ca]
            pb = [px * ax + pz * az for px, pz in cb]
            ov = min(max(pa), max(pb)) - max(min(pa), min(pb))
            if ov <= 0:
                return 0.0
            depth = min(depth, ov)
    return depth


def fit_report(desk: dict[str, Any]) -> dict[str, Any]:
    """¿Cabe todo? Avisos de lo que sobresale del borde, lo que se solapa y lo que no cabe en la mesa."""
    t = normalize_table(desk.get("table"), desk.get("style"))
    items = desk.get("items") or []
    held = held_map(items)
    has_host = any(i.get("type") in ("monitor", "laptop") or
                   (i.get("type") == "desktop" and (i.get("specs") or {}).get("model_line") == "imac") for i in items)
    issues: list[dict[str, Any]] = []
    parts: list[Part] = []
    dims_by: dict[str, dict[str, Any]] = {}
    unplaced = []
    for it in items:
        dm = dims_by[it["id"]] = item_dims(it)
        ps = parts_for(it, dm, it["id"] in held, has_host)
        if not ps and not it.get("pos"):
            unplaced.append(it["id"])
        parts += ps
    W, D = t["width_cm"], t["depth_cm"]
    max_w = W
    max_d = max(D, t["return_d_cm"] if t["shape"] != "rect" else D)
    name = {i["id"]: i.get("model") or TYPE_NAME.get(i.get("type", ""), "") for i in items}

    # --- no cabe en la mesa de ninguna manera
    for it in items:
        dm = dims_by[it["id"]]
        if it.get("type") in ("light", "webcam", "arm") or dm.get("floor") or it["id"] in held:
            continue
        w, d = float(dm.get("w", 0)), float(dm.get("d", 0))
        if it.get("type") == "ps5" and it.get("orient") == "horizontal":
            w = float(dm.get("h", w))
        if min(w, d) > min(max_w, max_d) or max(w, d) > max(max_w, max_d):
            issues.append({"kind": "too_big", "severity": "bad", "ids": [it["id"]], "cm": round(max(w - max_w, d - max_d), 1),
                           "text": f"{name[it['id']]} ({w:.0f} × {d:.0f} cm) no cabe en una mesa de {W:.0f} × {D:.0f} cm."})

    # --- sobresale por el borde (lo que se apoya en la mesa)
    for p in parts:
        if p.kind not in ("foot", "flat"):
            continue
        worst, side = 0.0, ""
        for px, pz in p.samples():
            dist, sd = outside(t, px, pz)
            if dist > worst:
                worst, side = dist, sd
        if worst > TOL:
            frac = worst / max(1.0, min(p.w, p.d))
            issues.append({"kind": "overhang", "severity": "bad" if frac > 0.33 else "warn", "ids": [p.id], "cm": round(worst, 1),
                           "side": side, "text": f"{p.name} sobresale {worst:.0f} cm {SIDE_ES.get(side, '')} de la mesa."})

    # --- se solapan (en planta y a la misma altura)
    seen: dict[tuple[str, str], dict[str, Any]] = {}
    solid = [p for p in parts if p.kind not in ("flat", "floor")]
    for i, a in enumerate(solid):
        for b in solid[i + 1:]:
            if a.id == b.id:
                continue
            if min(a.y1, b.y1) - max(a.y0, b.y0) <= 0.2:
                continue                                  # a distinta altura (p. ej. teclado bajo la pantalla)
            depth = _sat(a, b)
            if depth <= TOL:
                continue
            key = tuple(sorted((a.id, b.id)))
            if key in seen and seen[key]["cm"] >= depth:
                continue
            panel = "panel" in (a.kind, b.kind)
            txt = (f"{a.name} y {b.name} se solapan {depth:.0f} cm." if not panel else
                   f"{(b if a.kind == 'panel' else a).name} choca con la pantalla de {(a if a.kind == 'panel' else b).name} "
                   f"({depth:.0f} cm).")
            seen[key] = {"kind": "overlap", "severity": "bad" if depth > 3 else "warn", "ids": list(key), "cm": round(depth, 1),
                         "text": txt}
    issues += seen.values()

    # --- los monitores juntos
    mons = [i for i in items if i.get("type") == "monitor"]
    if len(mons) >= 2:
        total = sum(float(dims_by[m["id"]].get("w", 0)) for m in mons)
        if total > W:
            issues.append({"kind": "too_big", "severity": "bad", "ids": [m["id"] for m in mons], "cm": round(total - W, 1),
                           "text": f"Tus {len(mons)} monitores miden {total:.0f} cm de ancho y la mesa {W:.0f} cm."})

    # --- brazos de pinza
    for a in (i for i in items if i.get("type") == "arm"):
        dm = dims_by[a["id"]]
        cmax = float(dm.get("clamp_max") or 8.5)
        if t["top_cm"] > cmax:
            issues.append({"kind": "clamp", "severity": "bad", "ids": [a["id"]], "cm": round(t["top_cm"] - cmax, 1),
                           "text": f"La pinza de {name[a['id']]} abre hasta {cmax:g} cm y el tablero mide {t['top_cm']:g} cm."})
        if t["material"] == "glass":
            issues.append({"kind": "clamp", "severity": "warn", "ids": [a["id"]], "cm": 0,
                           "text": "Un brazo de pinza en una mesa de cristal puede romperla: usa un refuerzo o pie de apoyo."})

    area = sum((x1 - x0) * (z1 - z0) for x0, z0, x1, z1 in table_rects(t))
    if t["shape"] != "rect":
        area -= t["return_w_cm"] * D   # el retorno empieza en el borde trasero: esa parte ya cuenta en el tablero
    used = sum(p.w * p.d for p in parts if p.kind in ("foot", "clamp"))
    order = {"bad": 0, "warn": 1}
    issues.sort(key=lambda x: (order.get(x["severity"], 2), -x.get("cm", 0)))
    return {"ok": not issues, "issues": issues, "table": t, "area_cm2": round(area), "used_pct": round(min(100.0, 100 * used / max(area, 1))),
            "unplaced": unplaced}


def desk_view(desk: dict[str, Any]) -> dict[str, Any]:
    """El escritorio guardado + mesa normalizada + medidas automáticas de cada objeto (para el 3D)."""
    out = {**desk, "table": normalize_table(desk.get("table"), desk.get("style"))}
    out["items"] = [{**it, "dims_auto": devices.dims(it.get("type", ""), it.get("specs") or {}, it.get("catalog_id"))}
                    for it in desk.get("items", [])]
    return out
