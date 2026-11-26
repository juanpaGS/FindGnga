"""Mi escritorio: los dispositivos que tienes y los accesorios que les sacan partido.

- ``identify``: a partir del tipo y el modelo escrito ("MacBook Air M2 13", "LG 27UP850N",
  "iPhone 13") deduce sus características (puertos, chip, pulgadas…).
- ``desk_devices``: convierte el escritorio en dispositivos del perfil, para que la búsqueda
  de monitores y PS5 se adapte a lo que tienes.
- ``recommend``: accesorios compatibles (hubs, cables, cascos, lámparas…), monitores que
  puedes añadir y mejoras, con el mejor precio conocido de cada uno.

Las reglas son orientativas (p. ej. cuántas pantallas admite cada Mac): se explica el porqué
de cada recomendación para que el usuario pueda comprobarlo.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any

from . import search, storage
from .providers.base import compact, norm
from .scoring.monitors import evaluate

ITEM_TYPES = ("monitor", "laptop", "desktop", "ps5", "keyboard", "mouse", "phone", "light", "mousepad", "headset")
GOOD_PRICE = 0.90  # «buen precio» = al menos un 10 % por debajo del precio de referencia


# ------------------------------------------------------------------ identificar modelos

def _wireless(n: str) -> bool:
    return bool(re.search(r"\b(inalambric[oa]s?|wireless|bluetooth|lightspeed|bt)\b", n))


def _match_monitor(text: str) -> dict[str, Any] | None:
    """Busca el monitor en el catálogo por código ("27UP850N") o por marca + modelo."""
    c, n = compact(text), norm(text)
    best, best_score = None, 0.0
    for m in storage.load_catalog("monitors"):
        if any(len(code) >= 4 and compact(code) in c for code in m.get("codes", [])):
            return m
        if not re.search(rf"\b{re.escape(norm(m['brand']))}\b", n):
            continue
        words = [w for w in norm(m["model"]).split() if len(w) > 1 and not w.isdigit()]
        if not words:
            continue
        score = sum(1 for w in words if re.search(rf"\b{re.escape(w)}\b", n)) / len(words)
        if score > best_score:
            best, best_score = m, score
    return best if best_score >= 0.5 else None


def _mac(n: str, laptop: bool) -> dict[str, Any]:
    s: dict[str, Any] = {"platform": "mac"}
    chip = re.search(r"\bm([1-9])(?: (pro|max|ultra))?\b", n)
    s["chip_gen"] = int(chip.group(1)) if chip else None
    s["chip_tier"] = chip.group(2) if chip and chip.group(2) else "base"
    if laptop:
        s["model_line"] = "air" if "air" in n else "pro"
        inch = re.search(r"\b(13|14|15|16)\b", n)
        s["screen_in"] = int(inch.group(1)) if inch else None
        s["ports"] = {"usb_c": True, "thunderbolt": True, "hdmi": s["model_line"] == "pro" and (s["chip_gen"] or 0) >= 1
                      and s["screen_in"] in (14, 16), "dp": False, "usb_a": False}
    else:
        s["model_line"] = "studio" if "studio" in n else "imac" if "imac" in n else "mini"
        s["ports"] = {"usb_c": True, "thunderbolt": True, "hdmi": s["model_line"] != "imac", "dp": False,
                      "usb_a": s["model_line"] != "imac" and not (s["model_line"] == "mini" and (s["chip_gen"] or 0) >= 4)}
    ram = re.search(r"\b(8|16|18|24|32|36|48|64|96|128) ?gb\b", n)
    s["ram_gb"] = int(ram.group(1)) if ram else None
    return s


def _gpu_tier(n: str) -> str | None:
    g = re.search(r"\brtx ?(\d0)(\d0)\b", n)
    if g:
        return "high" if int(g.group(2)) >= 70 else "mid"
    g = re.search(r"\brx ?(\d)(\d)00", n)
    if g:
        return "high" if int(g.group(2)) >= 8 else "mid"
    return None


def identify(item_type: str, text: str) -> dict[str, Any]:
    """Devuelve {'specs': {...}, 'catalog_id': id|None, 'guess': texto de lo que se ha entendido}."""
    n = norm(text)
    specs: dict[str, Any] = {}
    catalog_id = None
    guess = []
    if item_type == "monitor":
        m = _match_monitor(text)
        if m:
            catalog_id = m["id"]
            specs = {"size_in": m["size_in"], "aspect": m.get("aspect", "16:9"), "res_w": m["res_w"], "res_h": m["res_h"],
                     "refresh_hz": m["refresh_hz"], "usb_c": bool(m.get("usb_c_video")), "usb_c_pd_w": m.get("usb_c_pd_w", 0),
                     "hdmi21": bool(m.get("hdmi_21")), "dp": bool(m.get("displayport")), "curved": False}
            guess.append(f"{m['brand']} {m['model']} (del catálogo)")
        else:
            size = re.search(r"\b(2[1-9]|3[0-9]|4[0-9])\b(?: ?(?:pulgadas|inch|in|\"))?", n)
            specs = {"size_in": int(size.group(1)) if size else 27,
                     "aspect": "32:9" if re.search(r"\b(32 9|super ?ultra|g9|49)\b", n) else
                               "21:9" if re.search(r"\b(21 9|ultrawide|ultrapanoramico|34)\b", n) else "16:9",
                     "res_w": 3840 if re.search(r"\b(4k|uhd|2160p?)\b", n) else 2560 if re.search(r"\b(qhd|1440p?|2k)\b", n) else 1920,
                     "refresh_hz": int(h.group(1)) if (h := re.search(r"\b(\d{2,3}) ?hz\b", n)) else 60,
                     "usb_c": bool(re.search(r"\busb ?c\b|\bthunderbolt\b", n)), "usb_c_pd_w": 0,
                     "hdmi21": bool(re.search(r"\bhdmi ?2 1\b", n)), "dp": True,
                     "curved": bool(re.search(r"\b(curvo|curved|odyssey g9)\b", n))}
            guess.append(f"Monitor de {specs['size_in']}\" (no está en el catálogo: revisa las entradas)")
    elif item_type in ("laptop", "desktop"):
        if re.search(r"\b(mac|macbook|imac|apple)\b", n):
            specs = _mac(n, item_type == "laptop")
            name = "MacBook " + specs["model_line"].title() if item_type == "laptop" else "Mac " + specs["model_line"]
            guess.append(f"{name}{' M' + str(specs['chip_gen']) if specs['chip_gen'] else ''}"
                         f"{' ' + specs['chip_tier'].title() if specs['chip_tier'] != 'base' else ''}")
        else:
            specs = {"platform": "windows", "gpu_tier": _gpu_tier(n) or ("integrated" if item_type == "laptop" else "mid"),
                     "ports": {"usb_c": True, "thunderbolt": bool(re.search(r"\b(thunderbolt|tb4|usb ?4)\b", n)),
                               "hdmi": True, "dp": item_type == "desktop", "usb_a": True}}
            guess.append(("Portátil" if item_type == "laptop" else "PC") + " Windows")
    elif item_type == "ps5":
        ed = "pro" if re.search(r"\bpro\b", n) else "digital" if re.search(r"\bdigital\b", n) else "standard"
        specs = {"edition": ed}
        guess.append({"pro": "PS5 Pro", "digital": "PS5 Digital (sin lector)", "standard": "PS5 con lector"}[ed])
    elif item_type == "phone":
        ip = re.search(r"\biphone ?(\d{1,2})", n)
        if ip or "iphone" in n:
            gen = int(ip.group(1)) if ip else 15
            specs = {"os": "ios", "connector": "usb_c" if gen >= 15 else "lightning", "magsafe": gen >= 12}
            guess.append(f"iPhone {gen}" + (" (USB-C)" if gen >= 15 else " (Lightning)"))
        else:
            specs = {"os": "android", "connector": "usb_c", "magsafe": False}
            guess.append("Móvil Android (USB-C)")
    else:
        specs = {"wireless": _wireless(n)}
        if item_type == "keyboard":
            specs["mechanical"] = bool(re.search(r"\b(mecanico|mechanical|keychron|switch)\b", n))
    return {"specs": specs, "catalog_id": catalog_id, "guess": "; ".join(guess)}


# ------------------------------------------------------------------ escritorio ↔ perfil

def read_desk() -> dict[str, Any]:
    return storage.read_user("desk", {"items": []})


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


# ------------------------------------------------------------------ recomendaciones

def max_external_displays(it: dict[str, Any]) -> tuple[int, str]:
    """Pantallas externas que admite un ordenador (orientativo, según Apple / lo habitual en PC)."""
    s, t = it.get("specs") or {}, it.get("type")
    if s.get("platform") != "mac":
        return (4, "un PC de sobremesa con gráfica suele admitir 3-4 monitores") if t == "desktop" else \
               (3, "un portátil Windows suele admitir 2-3 monitores (con dock o hub)")
    gen, tier = s.get("chip_gen") or 0, s.get("chip_tier") or "base"
    if t == "laptop":
        if tier == "max":
            return 4, "los MacBook Pro con chip Max admiten hasta 4 pantallas externas"
        if tier == "pro":
            return 2, "los MacBook Pro con chip Pro admiten 2 pantallas externas"
        if gen >= 4:
            return 2, f"los Mac con M{gen} admiten 2 pantallas externas"
        if gen == 3 and s.get("model_line") == "air":
            return 1, "el MacBook Air M3 admite 1 pantalla externa (2 con la tapa cerrada)"
        return 1, f"los Mac con chip M{gen or '1/2/3'} básico sólo admiten 1 pantalla externa"
    if tier in ("max", "ultra"):
        return 5, "los Mac Studio admiten 4-5 pantallas"
    if tier == "pro" or gen >= 4:
        return 3, "el Mac mini con M4 / M4 Pro admite 3 pantallas"
    return 2, "el Mac mini con M1/M2 admite 2 pantallas"


def _priced(product: dict[str, Any], today: date | None) -> dict[str, Any]:
    pricing = search._priced(product, "accessory", today)
    ref = float(product["ref_price"])
    pricing["good_price"] = bool(not pricing["estimated"] and pricing["final_price"] <= ref * GOOD_PRICE)
    return pricing


SECTIONS = [
    ("connect", "🔌", "Para conectarlo todo", "Hubs, docks, cables y cargadores para tus dispositivos."),
    ("monitors", "🖥️", "Más monitores compatibles", "Pantallas que puedes añadir y que encajan con lo que tienes."),
    ("desk", "🪑", "Escritorio y ergonomía", "Luz de monitor, alfombrilla, brazos, soportes, teclado y ratón."),
    ("audio", "🎧", "Audio", "Cascos que valen para tus dispositivos."),
    ("ps5", "🎮", "Para tu PS5", "Accesorios oficiales y mejoras de la consola."),
    ("upgrades", "⭐", "Mejoras recomendadas", "Cambios que mejoran tu setup de verdad."),
]


def recommend(desk: dict[str, Any] | None = None, today: date | None = None) -> dict[str, Any]:
    desk = desk if desk is not None else read_desk()
    items = desk.get("items", [])
    by = {t: [i for i in items if i.get("type") == t] for t in ITEM_TYPES}
    computers = by["laptop"] + by["desktop"]
    monitors, ps5 = by["monitor"], by["ps5"]
    acc = {a["id"]: a for a in storage.load_catalog("accessories")}
    recs: dict[str, list[dict[str, Any]]] = {k: [] for k, *_ in SECTIONS}
    seen: set[str] = set()
    notes: list[str] = []

    def add(section: str, acc_id: str, reason: str, for_items: list[dict[str, Any]] | None = None, prio: int = 2) -> None:
        if acc_id in seen or acc_id not in acc:
            return
        seen.add(acc_id)
        p = acc[acc_id]
        recs[section].append({"product": p, "reason": reason, "priority": prio, "pricing": _priced(p, today),
                              "for": [i["id"] for i in (for_items or [])], "links": search.store_links(p["search_query"]),
                              "placeable": p["kind"] in ("light", "mousepad", "keyboard", "mouse", "headset")})

    mon_usbc = [m for m in monitors if (m.get("specs") or {}).get("usb_c")]
    mon_hdmi21 = [m for m in monitors if (m.get("specs") or {}).get("hdmi21")]
    mon_dp = [m for m in monitors if (m.get("specs") or {}).get("dp")]

    # --- conectar
    for c in computers:
        ports = (c.get("specs") or {}).get("ports") or {}
        name = c.get("model") or "tu ordenador"
        if c["type"] == "laptop" and ports.get("usb_c") and not ports.get("hdmi"):
            add("connect", "acc-hub-usbc-hdmi", f"{name} sólo tiene USB-C: con un hub conectas un monitor por HDMI, "
                "memorias USB y el cargador a la vez.", [c], 3 if mon_usbc else 1)
        if c["type"] == "laptop" and ports.get("thunderbolt") and len(monitors) >= 2:
            add("connect", "acc-dock-thunderbolt4", f"Tienes {len(monitors)} monitores: con un dock Thunderbolt conectas "
                f"{name} con un solo cable (pantallas, carga y USB).", [c], 2)
        if mon_usbc and ports.get("usb_c"):
            pd = max((m.get("specs") or {}).get("usb_c_pd_w") or 0 for m in mon_usbc)
            add("connect", "acc-cable-usbc-tb4", f"Tu monitor tiene USB-C: un solo cable lleva imagen y "
                f"{'carga (' + str(pd) + ' W)' if pd else 'datos'} a {name}.", [c] + mon_usbc, 1)
        if c["type"] == "laptop" and ports.get("usb_c") and mon_dp and not mon_usbc and not ports.get("hdmi"):
            add("connect", "acc-cable-usbc-dp", f"Para conectar {name} directo a la entrada DisplayPort del monitor.", [c], 2)
        if c["type"] == "desktop" and (c.get("specs") or {}).get("platform") != "mac" and \
                any(((m.get("specs") or {}).get("refresh_hz") or 60) >= 120 and (m.get("specs") or {}).get("dp") for m in monitors):
            add("connect", "acc-cable-dp14", "Tu monitor va a 120 Hz o más: por DisplayPort 1.4 sacas todos los Hz con "
                "G-Sync/FreeSync desde el PC.", [c], 2)
    if ps5 and mon_hdmi21:
        add("connect", "acc-cable-hdmi21", "Tu monitor tiene HDMI 2.1: con un cable Ultra High Speed la PS5 va a 4K/120 Hz "
            "con VRR (el de la caja es corto).", ps5 + mon_hdmi21, 2)
    if by["laptop"] or any((p.get("specs") or {}).get("connector") == "usb_c" for p in by["phone"]):
        add("connect", "acc-charger-gan65", "Un cargador GaN de 65 W carga el portátil y el móvil a la vez con un solo enchufe.",
            by["laptop"] + by["phone"], 3)

    # --- monitores: cuántos más caben y cuáles encajan
    owned_ids = {m.get("catalog_id") for m in monitors if m.get("catalog_id")}
    room = None
    if computers:
        limits = [(max_external_displays(c), c) for c in computers]
        (limit, why), main = max(limits, key=lambda x: x[0][0])
        room = limit - len(monitors)
        if room <= 0:
            notes.append(f"Ya tienes {len(monitors)} monitor(es) y {why}: no se recomiendan más pantallas para "
                         f"{main.get('model') or 'tu ordenador'} (orientativo).")
        else:
            notes.append(f"Puedes añadir {room} monitor(es) más: {why} (orientativo).")
    monitor_recs: list[dict[str, Any]] = []
    devices = desk_devices(desk)
    if devices or monitors:
        profile = storage.read_user("profile", {"devices": [], "uses": [], "priority": 0.5})
        ranked = search.search_monitors({**profile, "devices": devices}, uses=profile.get("uses") or None, today=today)
        candidates = [r for r in ranked["results"] if r["product"]["id"] not in owned_ids]
        if room is None or room > 0:
            for r in candidates[:3]:
                monitor_recs.append({**r, "reason": "Compatible con " + (", ".join(d["label"] or d["kind"] for d in devices)
                                                                        or "tu escritorio"), "section": "monitors"})
        # Mejora: un monitor del catálogo claramente mejor que el que tienes
        for m in monitors:
            cat = next((x for x in storage.load_catalog("monitors") if x["id"] == m.get("catalog_id")), None)
            if not cat:
                continue
            mine = evaluate(cat, devices, profile.get("uses") or [], profile.get("size_pref"))["fit"]
            better = [r for r in candidates if r["eval"]["fit"] >= mine + 8]
            for r in better[:2]:
                monitor_recs.append({**r, "section": "upgrades",
                                     "reason": f"Encaja mejor con tus dispositivos que tu {m.get('model')} "
                                               f"({r['eval']['fit']:.0f} frente a {mine:.0f} de 100)."})

    # --- escritorio
    if monitors and not by["light"]:
        add("desk", "acc-screenbar-xiaomi", "Iluminas la mesa sin reflejos en la pantalla y cansas menos la vista.", monitors, 2)
        add("desk", "acc-screenbar-benq-halo", "La lámpara de monitor de referencia (también para monitores curvos).", monitors, 3)
    if not by["mousepad"] and (by["keyboard"] or by["mouse"] or computers):
        add("desk", "acc-deskmat-xxl", "Teclado y ratón sobre la misma superficie y la mesa protegida.", by["keyboard"] + by["mouse"], 3)
    if computers and not by["keyboard"]:
        add("desk", "acc-logitech-mx-keys-s", "Un teclado para varios ordenadores: cambias con una tecla"
            + (" entre tus " + str(len(computers)) + " equipos." if len(computers) > 1 else "."), computers, 2)
    if computers and not by["mouse"]:
        add("desk", "acc-logitech-mx-master-3s", "Ratón ergonómico para trabajar muchas horas (Mac y Windows).", computers, 2)
    if len(monitors) >= 2:
        add("desk", "acc-monitor-arm-dual", "Tus dos monitores a la misma altura y juntos, con la mesa libre.", monitors, 2)
    elif monitors:
        add("desk", "acc-monitor-arm", "Pantalla a la altura de los ojos y más espacio en la mesa.", monitors, 3)
    if by["laptop"] and monitors:
        add("desk", "acc-laptop-stand", "Con el portátil elevado, su pantalla queda a la altura del monitor.", by["laptop"], 3)
    for p in by["phone"]:
        if (p.get("specs") or {}).get("magsafe"):
            add("desk", "acc-wireless-charger-3in1", "Tu iPhone tiene MagSafe: carga sin cables junto al reloj y los auriculares.", [p], 3)
        else:
            add("desk", "acc-phone-stand", "El móvil a la vista para notificaciones y videollamadas.", [p], 3)

    # --- audio
    if not by["headset"]:
        if ps5:
            add("audio", "acc-ps-pulse-elite", "Audio 3D de PS5 y, a la vez, Bluetooth para el móvil.", ps5, 2)
        if computers or ps5:
            add("audio", "acc-hyperx-cloud-iii", "Con cable USB-C/USB-A/jack: los mismos cascos para "
                + " y ".join(filter(None, ["el ordenador" if computers else "", "la PS5" if ps5 else ""])) + ".",
                computers + ps5, 3)

    # --- PS5
    for p in ps5:
        ed = (p.get("specs") or {}).get("edition")
        if ed in ("digital", "pro"):
            add("ps5", "acc-ps5-disc-drive", f"Tu PS5 {'Digital' if ed == 'digital' else 'Pro'} no tiene lector: con la unidad "
                "oficial puedes jugar con discos (más baratos de segunda mano).", [p], 2)
        add("ps5", "acc-dualsense", "Segundo mando para jugar a dobles.", [p], 3)
        add("ps5", "acc-dualsense-charger", "Carga los mandos sin ocupar los USB de la consola.", [p], 3)
        add("ps5", "acc-ssd-ps5-2tb", "Los juegos de PS5 ocupan 50-150 GB: con 2 TB más dejas de borrar juegos.", [p], 2)

    # --- mejoras: lo que hoy tiene buen precio
    good = [r for sec in recs.values() for r in sec if r["pricing"]["good_price"]]
    for r in good:
        if r not in recs["upgrades"]:
            recs["upgrades"].append({**r, "reason": "💸 Buen precio ahora. " + r["reason"]})

    if ps5 and monitors and not mon_hdmi21:
        where = ("Mira las «Mejoras recomendadas»." if any(m["section"] == "upgrades" for m in monitor_recs) else
                 "Mira «Más monitores compatibles»." if monitor_recs else "Busca uno con HDMI 2.1 en 🖥️ Monitores.")
        notes.append("Tus monitores no tienen HDMI 2.1: la PS5 irá como mucho a 60 Hz en 4K. " + where)

    for sec in recs.values():
        sec.sort(key=lambda r: (r["priority"], r["pricing"]["final_price"]))
    sections = []
    for key, icon, title, desc in SECTIONS:
        mons = [m for m in monitor_recs if m["section"] == key]
        if recs[key] or mons:
            sections.append({"id": key, "icon": icon, "title": title, "desc": desc,
                             "items": recs[key], "monitors": mons})
    return {"sections": sections, "notes": notes, "count": sum(len(s["items"]) + len(s["monitors"]) for s in sections),
            "empty": not items}
