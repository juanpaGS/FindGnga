"""Fichas de modelos conocidos: autocompletado y relleno automático de «Mi escritorio».

- Los Mac se generan a partir de una tabla (línea, tamaño, chip) con las reglas de Apple
  (puertos, pantallas externas, carga). Lo que no está en la tabla (p. ej. un chip nuevo)
  se deduce del nombre con las reglas del modelo más parecido y se marca como «deducido».
- El resto sale de ``data/devices.json`` (móviles, PS5, teclados, ratones, cascos…), de los
  monitores del catálogo y de los accesorios que se pueden poner en la mesa.

``suggest`` puntúa los modelos según lo escrito (sirve con el nombre a medias) y ``identify``
devuelve la ficha completa, aplicando lo que el usuario haya escrito de más (RAM, disco, color).
"""

from __future__ import annotations

import copy
import math
import re
from functools import lru_cache
from typing import Any

from . import storage
from .providers.base import compact, norm

# ------------------------------------------------------------------ Mac (tabla + reglas)

# (línea, tamaños, generación del chip, versiones del chip, año, RAM posibles, colores)
MAC_LAPTOPS = [
    ("air", (13,), 1, ("base",), 2020, (8, 16), ("space_gray", "silver", "gold")),
    ("air", (13, 15), 2, ("base",), 2022, (8, 16, 24), ("midnight", "starlight", "space_gray", "silver")),
    ("air", (13, 15), 3, ("base",), 2024, (8, 16, 24), ("midnight", "starlight", "space_gray", "silver")),
    ("air", (13, 15), 4, ("base",), 2025, (16, 24, 32), ("sky_blue", "midnight", "starlight", "silver")),
    ("pro", (13,), 1, ("base",), 2020, (8, 16), ("space_gray", "silver")),
    ("pro", (13,), 2, ("base",), 2022, (8, 16, 24), ("space_gray", "silver")),
    ("pro", (14, 16), 1, ("pro", "max"), 2021, (16, 32, 64), ("space_gray", "silver")),
    ("pro", (14, 16), 2, ("pro", "max"), 2023, (16, 32, 64, 96), ("space_gray", "silver")),
    ("pro", (14,), 3, ("base",), 2023, (8, 16, 24), ("space_gray", "silver")),
    ("pro", (14, 16), 3, ("pro", "max"), 2023, (18, 36, 48, 64, 96, 128), ("space_black", "silver")),
    ("pro", (14,), 4, ("base",), 2024, (16, 24, 32), ("space_black", "silver")),
    ("pro", (14, 16), 4, ("pro", "max"), 2024, (24, 36, 48, 64, 128), ("space_black", "silver")),
    ("pro", (14,), 5, ("base",), 2025, (16, 24, 32), ("space_black", "silver")),
]
MAC_DESKTOPS = [
    ("mini", 1, ("base",), 2020, (8, 16)),
    ("mini", 2, ("base", "pro"), 2023, (8, 16, 24, 32)),
    ("mini", 4, ("base", "pro"), 2024, (16, 24, 32, 48, 64)),
    ("studio", 1, ("max", "ultra"), 2022, (32, 64, 128)),
    ("studio", 2, ("max", "ultra"), 2023, (32, 64, 96, 128, 192)),
    ("studio", 4, ("max",), 2025, (36, 48, 64, 128)),
    ("studio", 3, ("ultra",), 2025, (96, 256, 512)),
    ("imac", 1, ("base",), 2021, (8, 16)),
    ("imac", 3, ("base",), 2023, (8, 16, 24)),
    ("imac", 4, ("base",), 2024, (16, 24, 32)),
]
IMAC_COLORS = ("blue", "green", "pink", "silver", "yellow", "orange", "purple")
TIER_NAME = {"base": "", "pro": " Pro", "max": " Max", "ultra": " Ultra"}


def mac_laptop_specs(line: str, size: int | None, gen: int, tier: str) -> dict[str, Any]:
    """Puertos y límites de un MacBook según Apple (para chips futuros, como el más reciente)."""
    big = line == "pro" and size in (14, 16)
    tb_count = 3 if big and not (tier == "base" and gen == 3) else 2
    if tier in ("pro", "max"):
        tb_ver = 5 if gen >= 4 else 4
    else:
        tb_ver = 4 if gen >= 4 else 3
    if line == "air":
        displays, note = (1, "") if gen <= 2 else (2, "con la tapa cerrada") if gen == 3 else (2, "")
        charge = 30 if gen == 1 else 70 if size == 15 else 35
    elif not big:
        displays, note, charge = 1, "", 61 if gen == 1 else 67
    else:
        if tier == "max":
            displays = 4
        elif tier == "pro":
            displays = 2
        else:
            displays = 1 if gen == 3 else 2
        note = ""
        charge = 140 if size == 16 else 96 if tier in ("pro", "max") else 70
    return {
        "platform": "mac", "model_line": line, "screen_in": size, "chip_gen": gen, "chip_tier": tier,
        "ports": {"usb_c": True, "thunderbolt": True, "hdmi": big, "dp": False, "usb_a": False,
                  "sd": big, "magsafe": big or (line == "air" and gen >= 2), "jack": True},
        "usb_c_count": tb_count, "thunderbolt_ver": tb_ver, "hdmi_ver": ("2.1" if gen >= 2 else "2.0") if big else None,
        "max_displays": displays, "displays_note": note, "charge_w": charge,
        "camera": True, "bt": True,
    }


def mac_desktop_specs(line: str, gen: int, tier: str) -> dict[str, Any]:
    s: dict[str, Any] = {"platform": "mac", "model_line": line, "chip_gen": gen, "chip_tier": tier, "bt": True}
    if line == "imac":
        s.update(ports={"usb_c": True, "thunderbolt": True, "hdmi": False, "dp": False, "usb_a": False, "jack": True},
                 usb_c_count=2 if gen < 4 else 4, thunderbolt_ver=4 if gen >= 4 else 3, max_displays=2 if gen >= 4 else 1,
                 camera=True, speakers=True, screen_in=24, displays_note="")
    elif line == "mini":
        s.update(ports={"usb_c": True, "thunderbolt": True, "hdmi": True, "dp": False, "usb_a": gen < 4, "ethernet": True,
                        "jack": True},
                 usb_c_count=(5 if gen >= 4 else 4 if tier == "pro" else 2),
                 thunderbolt_ver=(5 if gen >= 4 and tier == "pro" else 4 if gen >= 2 and (tier == "pro" or gen >= 4) else 3),
                 hdmi_ver="2.1" if (gen >= 4 or tier == "pro") else "2.0",
                 max_displays=3 if (gen >= 4 or tier == "pro") else 2, camera=False, speakers=True, displays_note="")
    else:  # studio
        s.update(ports={"usb_c": True, "thunderbolt": True, "hdmi": True, "dp": False, "usb_a": True, "ethernet": True,
                        "sd": True, "jack": True},
                 usb_c_count=6, thunderbolt_ver=5 if gen >= 3 and (gen >= 4 or tier == "ultra") else 4,
                 hdmi_ver="2.1" if gen >= 2 else "2.0", max_displays=8 if tier == "ultra" and gen >= 2 else 5,
                 camera=False, speakers=True, displays_note="")
    return s


def _mac_entries() -> list[dict[str, Any]]:
    out = []
    for line, sizes, gen, tiers, year, rams, colors in MAC_LAPTOPS:
        for size in sizes:
            for tier in tiers:
                name = f"MacBook {line.title()} {size}\" M{gen}{TIER_NAME[tier]}"
                specs = mac_laptop_specs(line, size, gen, tier)
                specs.update(ram_options=list(rams), ram_gb=rams[0], colors=list(colors), color=colors[0])
                out.append({"id": f"mac-mb{line}-{size}-m{gen}{'' if tier == 'base' else '-' + tier}", "type": "laptop",
                            "name": name, "aliases": [f"mb{line[0]} {size} m{gen}{'' if tier == 'base' else ' ' + tier}"],
                            "year": year, "specs": specs})
    for line, gen, tiers, year, rams in MAC_DESKTOPS:
        for tier in tiers:
            label = {"mini": "Mac mini", "studio": "Mac Studio", "imac": "iMac 24\""}[line]
            specs = mac_desktop_specs(line, gen, tier)
            colors = IMAC_COLORS if line == "imac" else ("silver",)
            specs.update(ram_options=list(rams), ram_gb=rams[0], colors=list(colors), color=colors[0])
            out.append({"id": f"mac-{line}-m{gen}{'' if tier == 'base' else '-' + tier}", "type": "desktop",
                        "name": f"{label} M{gen}{TIER_NAME[tier]}", "aliases": [], "year": year, "specs": specs})
    return out


# ------------------------------------------------------------------ catálogo unificado

PLACEABLE = {"keyboard", "mouse", "headset", "light", "mousepad", "webcam", "hub", "arm", "speakers"}


def monitor_specs(m: dict[str, Any]) -> dict[str, Any]:
    return {"size_in": m["size_in"], "aspect": m.get("aspect", "16:9"), "res_w": m["res_w"], "res_h": m["res_h"],
            "refresh_hz": m["refresh_hz"], "panel": m.get("panel"), "hdr": m.get("hdr"),
            "usb_c": bool(m.get("usb_c_video")), "usb_c_pd_w": m.get("usb_c_pd_w", 0), "thunderbolt": bool(m.get("thunderbolt")),
            "hdmi21": bool(m.get("hdmi_21")), "dp": bool(m.get("displayport")), "kvm": bool(m.get("kvm")),
            "speakers": bool(m.get("speakers")), "height_adjust": bool(m.get("height_adjust")),
            "curved": m.get("aspect") == "32:9", "vesa": True}


@lru_cache(maxsize=1)
def _catalog() -> tuple[dict[str, Any], ...]:
    entries = _mac_entries() + storage.load_catalog("devices")
    for m in storage.load_catalog("monitors"):
        entries.append({"id": m["id"], "type": "monitor", "name": f"{m['brand']} {m['model']}", "aliases": m.get("codes", []),
                        "specs": monitor_specs(m), "ref_price": m.get("ref_price")})
    for a in storage.load_catalog("accessories"):
        if a["kind"] in PLACEABLE:
            entries.append({"id": a["id"], "type": a["kind"], "name": a["name"], "aliases": [], "quality": a.get("quality"),
                            "specs": a.get("specs", {}), "ref_price": a.get("ref_price")})
    return tuple(entries)


def entries(item_type: str | None = None) -> list[dict[str, Any]]:
    return [e for e in _catalog() if item_type is None or e["type"] == item_type]


def by_id(entry_id: str | None) -> dict[str, Any] | None:
    return next((e for e in _catalog() if e["id"] == entry_id), None) if entry_id else None


# ------------------------------------------------------------------ texto → tokens

STOP = {"de", "con", "el", "la", "los", "las", "y", "en", "para", "mi", "un", "una", "gb", "ram", "pulgadas", "inch",
        "tb", "ssd", "color", "apple", "modelo", "edicion", "edition", "the", "nuevo", "version", "gen", "generacion"}
DISC = re.compile(r"^(.*\d.*|pro|max|ultra|air|mini|slim|digital|plus|fe|lite|se|studio|imac|s|x|e)$")
COLOR_WORDS = [
    (r"negro espacial|space black", "space_black"), (r"gris espacial|space gr[ae]y", "space_gray"),
    (r"azul cielo|sky blue", "sky_blue"), (r"medianoche|midnight", "midnight"), (r"blanco estrella|starlight", "starlight"),
    (r"plata|plateado|silver", "silver"), (r"\boro\b|dorado|gold", "gold"), (r"grafito|graphite", "graphite"),
    (r"\bnegro\b|\bblack\b", "black"), (r"\bblanco\b|\bwhite\b", "white"), (r"\bazul\b|\bblue\b", "blue"),
    (r"\brosa\b|\bpink\b", "pink"), (r"\bverde\b|\bgreen\b", "green"), (r"morado|purple|lila", "purple"),
    (r"\brojo\b|\bred\b", "red"), (r"naranja|orange", "orange"), (r"amarillo|yellow", "yellow"),
]
RAM_VALUES = {8, 16, 18, 24, 32, 36, 48, 64, 96, 128, 192}


def extras(text: str) -> dict[str, Any]:
    """Lo que el usuario escribe además del modelo: RAM, disco y color."""
    n = norm(text)
    out: dict[str, Any] = {}
    for m in re.finditer(r"\b(\d{1,4}) ?(gb|tb)\b", n):
        val, unit = int(m.group(1)), m.group(2)
        if unit == "tb":
            out["storage_gb"] = val * 1000
        elif val in RAM_VALUES and "ram_gb" not in out and not re.search(rf"\b{val} ?gb (ssd|disco|almacenamiento)", n):
            out["ram_gb"] = val
        elif val in (128, 256, 512):
            out["storage_gb"] = val
    for pat, color in COLOR_WORDS:
        if re.search(pat, n):
            out["color"] = color
            break
    return out


def _strip(n: str) -> str:
    n = re.sub(r"\b\d{1,4} ?(gb|tb)\b", " ", n)
    for pat, _ in COLOR_WORDS:
        n = re.sub(pat, " ", n)
    return n


def tokens(text: str) -> list[str]:
    n = norm(text)
    n = re.sub(r"\bm(\d) (pro|max|ultra)\b", r"m\1\2", n)      # «m4 pro» = un solo chip
    n = re.sub(r"\b(\d{2})\"", r"\1", n)
    n = n.replace("playstation 5", "ps5").replace("macbook", "macbook ").replace("i phone", "iphone")
    out: list[str] = []
    for t in n.split():
        if t in STOP or t in out:
            continue
        out.append(t)
    return out


def _score(query: list[str], entry: dict[str, Any]) -> tuple[float, int]:
    best = (-9.0, 9)
    for alias in [entry["name"], *entry.get("aliases", [])]:
        a = set(tokens(alias))
        hit = conflict = 0
        for i, t in enumerate(query):
            last = i == len(query) - 1
            if t in a or (last and len(t) >= 2 and any(x.startswith(t) for x in a)) or \
                    (len(t) >= 3 and re.search(r"\d", t) and any(x.endswith(t) for x in a)):
                hit += 1
            elif DISC.match(t):
                conflict += 1
        extra = sum(1 for x in a if DISC.match(x) and x not in query)
        s = (hit - 1.5 * conflict - 0.12 * extra) / max(1, len(query))
        if (s, -conflict) > (best[0], -best[1]):
            best = (s, conflict)
    return best


def _brief(e: dict[str, Any]) -> str:
    s = e["specs"]
    t = e["type"]
    if t in ("laptop", "desktop") and s.get("platform") == "mac":
        bits = [f"{s.get('max_displays')} pantalla(s) ext.", "HDMI" if s.get("ports", {}).get("hdmi") else "sólo USB-C",
                f"RAM {'/'.join(map(str, s.get('ram_options', [])))} GB"]
        return " · ".join(bits)
    if t == "monitor":
        return f"{s['size_in']}\" {s['res_w']}×{s['res_h']} {s['refresh_hz']} Hz" + (" · USB-C" if s.get("usb_c") else "") + \
            (" · HDMI 2.1" if s.get("hdmi21") else "")
    bits = []
    for k, v in spec_sheet(t, s):
        if v == "No":
            continue
        bits.append(k if v == "Sí" else v)
        if len(bits) == 4:
            break
    return " · ".join(bits)


GENERIC = r"^(auriculares|cascos|teclado|raton|lampara de monitor|lampara|webcam|altavoces|alfombrilla|hub|dock|brazo)\s+"


def core_name(name: str) -> str:
    """Nombre sin la palabra genérica del principio («Auriculares Sony WH-1000XM5» → «sony wh 1000xm5»)."""
    return re.sub(GENERIC, "", norm(name)).strip()


def suggest(item_type: str, text: str, limit: int = 8) -> list[dict[str, Any]]:
    """Modelos que encajan con lo escrito, de mejor a peor (también con el nombre a medias)."""
    q = tokens(_strip(norm(text)))
    pool = entries(item_type)
    if not q:
        ranked = sorted(pool, key=lambda e: -(e.get("year") or 0))[:limit] if item_type not in ("laptop", "desktop") else []
        return [{"id": e["id"], "name": e["name"], "brief": _brief(e), "score": 0.0, "source": "catalog"} for e in ranked]
    scored = []
    for e in pool:
        s, conflict = _score(q, e)
        if s > 0.34 and conflict == 0 or s >= 0.6:
            scored.append((s, conflict, -(e.get("year") or 0), e))
    scored.sort(key=lambda x: (-x[0], x[1], x[2]))
    # el mismo producto puede estar en el catálogo de dispositivos y en el de accesorios: sale una vez
    seen: dict[str, int] = {}
    uniq = []
    for row in scored:
        key = core_name(row[3]["name"])
        if key in seen:
            if uniq[seen[key]][3]["id"].startswith("acc-") and not row[3]["id"].startswith("acc-"):
                uniq[seen[key]] = row
            continue
        seen[key] = len(uniq)
        uniq.append(row)
    scored = uniq
    out = [{"id": e["id"], "name": e["name"], "brief": _brief(e), "score": round(s, 2), "source": "catalog",
            "exact": False} for s, c, _, e in scored[:limit]]
    if scored and scored[0][0] >= 0.8 and scored[0][1] == 0:
        tied = [e for s, c, _, e in scored if s >= scored[0][0] - 0.05]
        # empate sólo por el tamaño (MacBook 14" / 16"): vale el primero
        same = len({re.sub(r'\b\d{2}" ', "", e["name"]) for e in tied}) == 1
        out[0]["exact"] = len(tied) == 1 or same
    if not any(o["exact"] or o["score"] >= 0.55 for o in out):
        parsed = parse(item_type, text)
        if parsed["name"] and len(norm(text)) >= 3:
            out.insert(0, {"id": None, "name": parsed["name"], "brief": "deducido de lo que has escrito: revisa la ficha",
                           "score": 0.0, "source": "parsed", "exact": False})
    return out[:limit]


# ------------------------------------------------------------------ texto libre → ficha

def _gpu(n: str) -> tuple[str | None, str | None]:
    g = re.search(r"\b(rtx|gtx) ?(\d{4})( ?ti| ?super)?\b", n)
    if g:
        num = int(g.group(2))
        tier = "high" if num % 100 >= 70 else "mid" if num % 100 >= 50 or g.group(1) == "rtx" else "integrated"
        return f"{g.group(1).upper()} {g.group(2)}{(g.group(3) or '').upper()}", tier
    g = re.search(r"\brx ?(\d{4})( ?xt| ?xtx)?\b", n)
    if g:
        return f"RX {g.group(1)}{(g.group(2) or '').upper()}", "high" if int(g.group(1)[1]) >= 8 else "mid"
    if re.search(r"\b(intel arc|iris|uhd|radeon graphics|integrada)\b", n):
        return None, "integrated"
    return None, None


def parse(item_type: str, text: str) -> dict[str, Any]:
    """Ficha deducida sólo del texto (cuando el modelo no está en la lista)."""
    n = norm(text)
    specs: dict[str, Any] = {}
    name = ""
    if item_type == "monitor":
        size = re.search(r"\b(2[1-9]|3[0-9]|4[0-9])\b", n)
        specs = {"size_in": int(size.group(1)) if size else 27,
                 "aspect": "32:9" if re.search(r"\b(32 9|super ?ultra|g9|49)\b", n) else
                           "21:9" if re.search(r"\b(21 9|ultrawide|ultrapanoramico|34)\b", n) else "16:9",
                 "res_w": 3840 if re.search(r"\b(4k|uhd|2160p?)\b", n) else 2560 if re.search(r"\b(qhd|1440p?|2k)\b", n) else 1920,
                 "refresh_hz": int(h.group(1)) if (h := re.search(r"\b(\d{2,3}) ?hz\b", n)) else 60,
                 "usb_c": bool(re.search(r"\busb ?c\b|\bthunderbolt\b", n)), "usb_c_pd_w": 0,
                 "hdmi21": bool(re.search(r"\bhdmi ?2 1\b", n)), "dp": True,
                 "curved": bool(re.search(r"\b(curvo|curved|odyssey g9)\b", n)), "vesa": True}
        specs["res_h"] = {3840: 2160, 2560: 1440}.get(specs["res_w"], 1080)
        if specs["aspect"] == "21:9":
            specs["res_w"], specs["res_h"] = (3440, 1440) if specs["res_w"] >= 2560 else (2560, 1080)
        if specs["aspect"] == "32:9":
            specs["res_w"], specs["res_h"] = 5120, 1440
        name = f"Monitor {specs['size_in']}\"" if n else ""
    elif item_type in ("laptop", "desktop") and re.search(r"\b(mac|macbook|imac|apple|mbp|mba|m\d)\b", n):
        chip = re.search(r"\bm([1-9])(?: ?(pro|max|ultra))?\b", n)
        gen = int(chip.group(1)) if chip else 4
        tier = chip.group(2) if chip and chip.group(2) else "base"
        if item_type == "laptop":
            line = "air" if re.search(r"\b(air|mba)\b", n) else "pro"
            inch = re.search(r"\b(13|14|15|16)\b", n)
            size = int(inch.group(1)) if inch else (13 if line == "air" else 14 if tier in ("base", "pro") else 16)
            if line == "air" and tier != "base":
                tier = "base"
            specs = mac_laptop_specs(line, size, gen, tier)
            name = f"MacBook {line.title()} {size}\" M{gen}{TIER_NAME[tier]}"
        else:
            line = "studio" if "studio" in n else "imac" if "imac" in n else "mini"
            specs = mac_desktop_specs(line, gen, tier)
            name = {"mini": "Mac mini", "studio": "Mac Studio", "imac": "iMac 24\""}[line] + f" M{gen}{TIER_NAME[tier]}"
    elif item_type in ("laptop", "desktop"):
        gpu, tier = _gpu(n)
        brand = next((b for b in ("lenovo", "asus", "msi", "hp", "dell", "acer", "razer", "samsung", "microsoft", "gigabyte",
                                  "alienware", "huawei", "xiaomi", "lg") if re.search(rf"\b{b}\b", n)), None)
        inch = re.search(r"\b(13|14|15|16|17|18)\b", n) if item_type == "laptop" else None
        specs = {"platform": "windows", "gpu": gpu, "gpu_tier": tier or ("integrated" if item_type == "laptop" else "mid"),
                 "brand": brand, "screen_in": int(inch.group(1)) if inch else None,
                 "ports": {"usb_c": True, "thunderbolt": bool(re.search(r"\b(thunderbolt|tb4|tb5|usb ?4)\b", n)),
                           "hdmi": True, "dp": item_type == "desktop", "usb_a": True, "jack": True},
                 "bt": item_type == "laptop" or bool(re.search(r"\b(bluetooth|wifi)\b", n)),
                 "camera": item_type == "laptop", "max_displays": 4 if item_type == "desktop" else 3}
        kind = "Portátil" if item_type == "laptop" else "PC"
        name = " ".join(filter(None, [kind, (brand or "").title() or "Windows", gpu and f"con {gpu}"]))
    elif item_type == "ps5":
        ed = "pro" if re.search(r"\bpro\b", n) else "digital" if re.search(r"\bdigital\b", n) else "standard"
        model = "pro" if ed == "pro" else "fat" if re.search(r"\b(fat|original|2020|cfi 1)\b", n) else "slim"
        specs = {"edition": ed, "model": model, "storage_gb": {"pro": 2000, "fat": 825}.get(model, 1000), "m2_slot": True,
                 "hdmi21": True}
        name = {"pro": "PS5 Pro", "digital": "PS5 Digital (sin lector)", "standard": "PS5 con lector"}[ed]
    elif item_type == "phone":
        ip = re.search(r"\biphone ?(\d{1,2})", n)
        if ip or "iphone" in n:
            gen = int(ip.group(1)) if ip else 15
            pro = bool(re.search(r"\bpro\b", n))
            specs = {"os": "ios", "connector": "usb_c" if gen >= 15 else "lightning", "magsafe": gen >= 12, "qi2": gen >= 13,
                     "qi": True, "usb3": gen >= 15 and pro, "continuity_camera": True}
            name = f"iPhone {gen}{' Pro' if pro else ''}"
        else:
            specs = {"os": "android", "connector": "usb_c", "magsafe": False, "qi": bool(re.search(r"\b(galaxy s|pixel)\b", n))}
            name = "Móvil Android" if n else ""
    elif item_type == "tablet":
        ios = bool(re.search(r"\bipad\b", n))
        specs = {"os": "ios" if ios else "android", "connector": "usb_c", "size_in": 11}
        name = "iPad" if ios else "Tablet Android" if n else ""
    else:
        specs = {"wireless": bool(re.search(r"\b(inalambric[oa]s?|wireless|bluetooth|lightspeed|bt)\b", n))}
        if item_type == "keyboard":
            specs.update(mechanical=bool(re.search(r"\b(mecanico|mechanical|keychron|switch)\b", n)),
                         bt=specs["wireless"], multi=1, layout="mac" if re.search(r"\b(mac|apple|magic)\b", n) else "both")
        elif item_type == "mouse":
            specs.update(bt=specs["wireless"], multi=1, ergonomic=bool(re.search(r"\b(ergonomic|vertical)\b", n)),
                         gaming=bool(re.search(r"\b(gaming|gamer)\b", n)))
        elif item_type == "headset":
            specs.update(bt=specs["wireless"], anc=bool(re.search(r"\b(anc|cancelacion|noise)\b", n)),
                         form="in_ear" if re.search(r"\b(airpods|buds|in ear|intrauditivo|tws)\b", n) else "over_ear")
        elif item_type == "mousepad":
            size = re.search(r"\b(\d{2,3}) ?x ?(\d{2,3})\b", n)
            specs = {"w_cm": int(size.group(1)) if size else (90 if "xxl" in n else 80 if "xl" in n else 30),
                     "d_cm": int(size.group(2)) if size else (40 if "xxl" in n else 30 if "xl" in n else 25)}
        elif item_type == "arm":
            specs = {"dual": bool(re.search(r"\b(doble|dual|2 monitores)\b", n)), "max_in": 32, "max_kg": 9}
        elif item_type == "hub":
            specs = {"kind": "dock" if re.search(r"\b(dock|thunderbolt|ts\d)\b", n) else "hub",
                     "hdmi": 1 if "hdmi" in n else 0, "hdmi_4k60": bool(re.search(r"\b60 ?hz\b", n))}
        name = text.strip()[:60]
    return {"specs": specs, "name": name}


def identify(item_type: str, text: str, catalog_id: str | None = None) -> dict[str, Any]:
    """Ficha completa del modelo: del catálogo si se reconoce (o se elige) y, si no, deducida del texto."""
    entry = by_id(catalog_id) if catalog_id else None
    if entry and entry["type"] != item_type:
        entry = None
    if entry is None and text.strip():
        top = [s for s in suggest(item_type, text, 3) if s["source"] == "catalog"]
        if top and top[0]["exact"]:
            entry = by_id(top[0]["id"])
    ext = extras(text)
    if entry:
        specs = copy.deepcopy(entry["specs"])
        source, name = "catalog", entry["name"]
    else:
        p = parse(item_type, text)
        specs, source, name = p["specs"], "parsed", p["name"]
    warn = []
    if "ram_gb" in ext and item_type in ("laptop", "desktop"):
        if specs.get("ram_options") and ext["ram_gb"] not in specs["ram_options"]:
            warn.append(f"Este modelo se vendía con {'/'.join(map(str, specs['ram_options']))} GB de RAM: revisa los {ext['ram_gb']} GB.")
        specs["ram_gb"] = ext["ram_gb"]
    if "storage_gb" in ext and item_type in ("laptop", "desktop", "phone", "tablet", "ps5"):
        specs["storage_gb"] = ext["storage_gb"]
    if "color" in ext:
        specs["color"] = ext["color"]
    guess = name + (" (de la lista de modelos)" if source == "catalog" else " (deducido del nombre: revisa los datos)" if name else "")
    return {"specs": specs, "catalog_id": entry["id"] if entry else None, "name": name, "source": source,
            "quality": (entry or {}).get("quality"), "guess": guess if text.strip() else "",
            "sheet": spec_sheet(item_type, specs), "warnings": warn,
            "colors": specs.get("colors") or (entry or {}).get("colors") or [],
            "dims": dims(item_type, specs, entry["id"] if entry else None)}


# ------------------------------------------------------------------ ficha legible

COLOR_ES = {"space_black": "Negro espacial", "space_gray": "Gris espacial", "silver": "Plata", "gold": "Oro",
            "midnight": "Medianoche", "starlight": "Blanco estrella", "sky_blue": "Azul cielo", "black": "Negro",
            "white": "Blanco", "graphite": "Grafito", "blue": "Azul", "pink": "Rosa", "green": "Verde", "purple": "Morado",
            "red": "Rojo", "orange": "Naranja", "yellow": "Amarillo"}


def _yes(v: Any) -> str:
    return "Sí" if v else "No"


def spec_sheet(item_type: str, s: dict[str, Any]) -> list[list[str]]:
    rows: list[tuple[str, Any]] = []
    p = s.get("ports") or {}
    if item_type in ("laptop", "desktop"):
        if s.get("platform") == "mac":
            rows += [("Chip", f"M{s.get('chip_gen') or '?'}{TIER_NAME.get(s.get('chip_tier') or 'base', '')}"),
                     ("RAM", s.get("ram_gb") and f"{s['ram_gb']} GB"),
                     ("Almacenamiento", s.get("storage_gb") and (f"{s['storage_gb'] // 1000} TB" if s["storage_gb"] >= 1000 else f"{s['storage_gb']} GB")),
                     ("Pantalla", s.get("screen_in") and f"{s['screen_in']}\"")]
        else:
            rows += [("Gráfica", s.get("gpu") or {"integrated": "integrada", "mid": "media", "high": "potente"}.get(s.get("gpu_tier"), "")),
                     ("RAM", s.get("ram_gb") and f"{s['ram_gb']} GB")]
        ports = [label for k, label in (("thunderbolt", f"Thunderbolt {s.get('thunderbolt_ver') or ''}".strip()), ("usb_c", "USB-C"),
                                        ("hdmi", f"HDMI {s.get('hdmi_ver') or ''}".strip()), ("dp", "DisplayPort"),
                                        ("usb_a", "USB-A"), ("sd", "SD"), ("magsafe", "MagSafe"), ("ethernet", "Ethernet"))
                 if p.get(k) and not (k == "usb_c" and p.get("thunderbolt"))]
        rows += [("Puertos", (f"{s['usb_c_count']}× " if s.get("usb_c_count") else "") + ", ".join(ports)),
                 ("Pantallas externas", s.get("max_displays") and f"hasta {s['max_displays']}" +
                  (f" ({s['displays_note']})" if s.get("displays_note") else "")),
                 ("Carga", s.get("charge_w") and f"{s['charge_w']} W por USB-C"),
                 ("Cámara", s.get("camera") is not None and _yes(s.get("camera")))]
    elif item_type == "monitor":
        rows += [("Tamaño", f"{s.get('size_in')}\" {s.get('aspect', '16:9')}" + (" curvo" if s.get("curved") else "")),
                 ("Resolución", s.get("res_w") and f"{s['res_w']}×{s.get('res_h') or ''}"), ("Frecuencia", s.get("refresh_hz") and f"{s['refresh_hz']} Hz"),
                 ("USB-C", s.get("usb_c") and ("Sí" + (f", carga {s['usb_c_pd_w']} W" if s.get("usb_c_pd_w") else ""))),
                 ("HDMI 2.1", _yes(s.get("hdmi21"))), ("DisplayPort", _yes(s.get("dp"))), ("KVM", s.get("kvm") and "Sí")]
    elif item_type == "ps5":
        rows += [("Edición", {"digital": "Digital (sin lector)", "standard": "Con lector", "pro": "Pro (sin lector)"}.get(s.get("edition"), "")),
                 ("Modelo", {"fat": "Original", "slim": "Slim", "pro": "Pro"}.get(s.get("model"), "")),
                 ("SSD", s.get("storage_gb") and (f"{s['storage_gb'] / 1000:g} TB" if s["storage_gb"] >= 1000 else f"{s['storage_gb']} GB")),
                 ("Ranura M.2", s.get("m2_slot") and "Sí"), ("HDMI 2.1", s.get("hdmi21") and "4K 120 Hz")]
    elif item_type in ("phone", "tablet"):
        rows += [("Sistema", "iOS" if s.get("os") == "ios" else "Android"),
                 ("Conector", {"usb_c": "USB-C", "lightning": "Lightning"}.get(s.get("connector"), "")),
                 ("MagSafe / Qi2", (s.get("magsafe") or s.get("qi2")) and ("MagSafe" if s.get("magsafe") else "Qi2")),
                 ("Carga inalámbrica", s.get("qi") is not None and _yes(s.get("qi"))),
                 ("USB 3 (rápido)", s.get("usb3") and "Sí"), ("Modo escritorio (DeX)", s.get("dex") and "Sí"),
                 ("Pantalla", item_type == "tablet" and s.get("size_in") and f"{s['size_in']}\"")]
    elif item_type == "keyboard":
        rows += [("Conexión", ", ".join(filter(None, ["Bluetooth" if s.get("bt") else "", (s.get("receiver") or "").title() and
                                                         f"receptor {s['receiver'].title()}", "cable" if not s.get("wireless") else ""]))),
                 ("Dispositivos", s.get("multi") and f"{s['multi']} a la vez"), ("Teclas", {"both": "Mac y Windows", "mac": "Mac", "win": "Windows"}.get(s.get("layout"), "")),
                 ("Tipo", "Mecánico" if s.get("mechanical") else "Membrana / tijera"), ("Retroiluminado", s.get("backlit") is not None and _yes(s.get("backlit"))),
                 ("Tamaño", {"full": "Completo", "tkl": "Sin numérico (TKL)", "75": "75 %", "60": "60 %", "compact": "Compacto"}.get(s.get("size"), "")),
                 ("Touch ID", s.get("touch_id") and "Sí")]
    elif item_type == "mouse":
        rows += [("Conexión", ", ".join(filter(None, ["Bluetooth" if s.get("bt") else "", (s.get("receiver") or "").title() and
                                                         f"receptor {s['receiver'].title()}", "cable" if not s.get("wireless") else ""]))),
                 ("Dispositivos", s.get("multi") and f"{s['multi']} a la vez"), ("Tipo", "Vertical" if s.get("vertical") else "Ergonómico" if s.get("ergonomic")
                                                                              else "Gaming" if s.get("gaming") else "Normal"),
                 ("Trackpad", s.get("trackpad") and "Sí")]
    elif item_type == "headset":
        rows += [("Conexión", ", ".join(filter(None, ["Bluetooth" if s.get("bt") else "", "receptor USB" if s.get("dongle") else "",
                                                         {"jack": "jack", "usb_jack": "USB y jack", "usb": "USB"}.get(s.get("wired") or "", "")]))),
                 ("PS5", "PS5 inalámbricos" if s.get("ps5_wireless") else "PS5 con cable" if s.get("ps5_wired") or s.get("wired") else "No"),
                 ("Cancelación de ruido", s.get("anc") is not None and _yes(s.get("anc"))), ("Multipunto", s.get("multipoint") and "Sí"),
                 ("Formato", {"in_ear": "Intrauditivos", "over_ear": "De diadema"}.get(s.get("form") or "", ""))]
    elif item_type == "light":
        rows += [("Monitores curvos", _yes(s.get("curved_ok"))), ("Mando", s.get("remote") is not None and _yes(s.get("remote"))),
                 ("Brillo automático", s.get("auto_dim") is not None and _yes(s.get("auto_dim")))]
    elif item_type == "mousepad":
        rows += [("Tamaño", s.get("w_cm") and f"{s['w_cm']} × {s.get('d_cm')} cm")]
    elif item_type == "hub":
        rows += [("Tipo", "Dock" if s.get("kind") == "dock" else "Hub"), ("HDMI", s.get("hdmi") and ("4K 60 Hz" if s.get("hdmi_4k60") else "Sí")),
                 ("Carga", s.get("pd_w") and f"{s['pd_w']} W"), ("Thunderbolt", s.get("thunderbolt") and f"{s['thunderbolt']}")]
    elif item_type == "arm":
        rows += [("Pantallas", "2" if s.get("dual") else "1"), ("Hasta", s.get("max_in") and f"{s['max_in']}\" / {s.get('max_kg')} kg")]
    elif item_type == "webcam":
        rows += [("Resolución", s.get("res")), ("Micrófono", s.get("mic") and "Sí")]
    elif item_type == "speakers":
        rows += [("Bluetooth", s.get("bt") is not None and _yes(s.get("bt")))]
    if s.get("color"):
        rows.append(("Color", COLOR_ES.get(s["color"], s["color"])))
    return [[k, str(v)] for k, v in rows if v not in (None, "", False)]


# ------------------------------------------------------------------ medidas reales (cm)
#
# Para dibujar «Mi escritorio» a escala. Prioridad: data/dimensions.json (por id del catálogo) →
# tablas de Apple (MacBook, Mac mini/Studio, iMac) → deducido de la ficha (pulgadas, formato…).
# w = ancho, d = fondo, h = alto, tal y como se apoya en la mesa. «approx» = orientativo.

ASPECTS = {"16:9": 16 / 9, "16:10": 1.6, "21:9": 64 / 27, "32:9": 32 / 9, "3:2": 1.5, "4:3": 4 / 3}

# MacBook (línea, pulgadas de la tabla, ¿chip M1?) → (ancho, fondo, grosor, pulgadas reales, formato de pantalla)
MAC_LAPTOP_DIMS = {
    ("air", 13, True): (30.41, 21.24, 1.61, 13.3, 1.6),
    ("air", 13, False): (30.41, 21.5, 1.13, 13.6, 2560 / 1664),
    ("air", 15, False): (34.04, 23.76, 1.15, 15.3, 2880 / 1864),
    ("pro", 13, None): (30.41, 21.24, 1.56, 13.3, 1.6),
    ("pro", 14, None): (31.26, 22.12, 1.55, 14.2, 3024 / 1964),
    ("pro", 16, None): (35.57, 24.81, 1.68, 16.2, 3456 / 2234),
}
KEYBOARD_DIMS = {  # tamaño → (ancho, fondo, alto de membrana, alto mecánico)
    "full": (44.0, 14.0, 2.4, 4.0), "tkl": (36.0, 13.5, 2.2, 4.0), "75": (32.0, 13.0, 2.0, 4.0),
    "60": (29.5, 10.5, 2.0, 4.0), "compact": (28.0, 12.0, 1.6, 3.5),
}
DIM_KEYS = ("w", "h", "d")
DIM_RANGE = (0.3, 320.0)   # cualquier medida de un objeto (cm)


@lru_cache(maxsize=1)
def _dims_file() -> dict[str, Any]:
    try:
        return storage.load_catalog_raw("dimensions")
    except (OSError, ValueError):
        return {"items": {}, "desks": []}


def desk_presets() -> list[dict[str, Any]]:
    return copy.deepcopy(_dims_file().get("desks", []))


def panel_cm(diag_in: float, ratio: float) -> tuple[float, float]:
    """Ancho y alto de la zona visible a partir de la diagonal (pulgadas) y el formato."""
    diag = float(diag_in) * 2.54
    h = diag / (1 + ratio * ratio) ** 0.5
    return round(h * ratio, 2), round(h, 2)


def _ratio(s: dict[str, Any]) -> float:
    if s.get("res_w") and s.get("res_h"):
        return float(s["res_w"]) / float(s["res_h"])
    return ASPECTS.get(s.get("aspect") or "16:9", 16 / 9)


def monitor_dims(s: dict[str, Any], base: dict[str, Any] | None = None) -> dict[str, Any]:
    """Medidas de un monitor: panel según diagonal y formato, marcos, pie y curvatura."""
    base = base or {}
    size = float(s.get("size_in") or 27)
    ratio = _ratio(s)
    pw, ph = panel_cm(size, ratio)
    aspect = s.get("aspect") or "16:9"
    curved = bool(s.get("curved")) or aspect == "32:9" or bool(base.get("curve_r"))
    curve_r = base.get("curve_r") or ((1000 if aspect == "32:9" else 1800 if aspect == "21:9" else 1500) if curved else None)
    bezel, chin = float(base.get("bezel", 0.8)), float(base.get("chin", 1.5))
    chord, sag = pw, 0.0
    if curve_r:
        r = curve_r / 10
        th = pw / r
        chord, sag = 2 * r * math.sin(th / 2), r * (1 - math.cos(th / 2))
    gaming = (s.get("refresh_hz") or 60) >= 144
    stand = base.get("stand") or ("v" if gaming or curved else "plate")
    w = float(base.get("w") or round(chord + 2 * bezel, 1))
    body_t = float(base.get("body_t") or round(4.5 + sag * 0.6, 1))
    stand_w = float(base.get("stand_w") or (min(45.0, max(28.0, w * 0.4)) if stand == "v" else min(28.0, max(18.0, w * 0.38))))
    stand_d = float(base.get("stand_d") or (40.0 if aspect == "32:9" else 23.0 if stand == "v" else 20.0))
    if base.get("h") and not base.get("lift"):
        lift = max(0.0, float(base["h"]) - ph - bezel - chin)
    else:
        lift = float(base.get("lift", 10.0))
    h = float(base.get("h") or round(lift + ph + bezel + chin, 1))
    d = float(base.get("d") or max(stand_d, body_t + sag))
    out = {"w": round(w, 1), "h": round(h, 1), "d": round(d, 1), "diag_in": size, "ratio": round(ratio, 4),
           "panel_w": pw, "panel_h": ph, "bezel": bezel, "chin": chin, "lift": round(lift, 1), "body_t": body_t,
           "stand": stand, "stand_w": stand_w, "stand_d": stand_d}
    if curve_r:
        out.update(curve_r=curve_r, sagitta=round(sag, 1))
    return out


def _mac_dims(item_type: str, s: dict[str, Any]) -> dict[str, Any] | None:
    line, gen = s.get("model_line"), s.get("chip_gen") or 4
    if item_type == "laptop" and line in ("air", "pro"):
        size = s.get("screen_in") or (13 if line == "air" else 14)
        size = min((13, 14, 15, 16), key=lambda x: abs(x - float(size)))
        key = (line, size, gen == 1) if line == "air" else (line, size, None)
        if key not in MAC_LAPTOP_DIMS:
            key = min(MAC_LAPTOP_DIMS, key=lambda k: (k[0] != line, abs(k[1] - size)))
        w, d, h, inch, ratio = MAC_LAPTOP_DIMS[key]
        pw, ph = panel_cm(inch, ratio)
        return {"w": w, "d": d, "h": h, "screen_in": inch, "ratio": round(ratio, 4), "panel_w": pw, "panel_h": ph,
                "src": "Apple"}
    if item_type == "desktop":
        if line == "imac":
            pw, ph = panel_cm(23.5, 16 / 9)
            return {"w": 54.7, "h": 46.1, "d": 14.7, "panel_w": pw, "panel_h": ph, "diag_in": 23.5, "ratio": round(16 / 9, 4),
                    "bezel": 1.35, "chin": 4.4, "lift": round(46.1 - ph - 1.35 - 4.4, 1), "body_t": 1.15,
                    "stand": "imac", "stand_w": 13.0, "stand_d": 14.7, "src": "Apple"}
        if line == "studio":
            return {"w": 19.7, "d": 19.7, "h": 9.5, "src": "Apple"}
        if line == "mini":
            return {"w": 12.7, "d": 12.7, "h": 5.0, "src": "Apple"} if gen >= 4 else {"w": 19.7, "d": 19.7, "h": 3.6, "src": "Apple"}
    return None


def _default_dims(item_type: str, s: dict[str, Any]) -> dict[str, Any]:
    """Medidas típicas cuando el modelo no está en el catálogo (orientativas)."""
    t = item_type
    if t == "laptop":
        inch = float(s.get("screen_in") or 15.6)
        pw, ph = panel_cm(inch, 16 / 9 if inch >= 15 else 1.6)
        thick = 2.6 if s.get("gpu_tier") == "high" else 2.0
        return {"w": round(pw + 2.2, 1), "d": round((pw + 2.2) * 0.69, 1), "h": thick, "screen_in": inch,
                "ratio": round(pw / ph, 4), "panel_w": pw, "panel_h": ph}
    if t == "desktop":
        return {"w": 21.0, "h": 46.0, "d": 45.0, "floor": True}
    if t == "ps5":
        model, ed = s.get("model") or ("pro" if s.get("edition") == "pro" else "slim"), s.get("edition") or "standard"
        if model == "fat":
            return {"w": 9.2 if ed == "digital" else 10.4, "h": 39.0, "d": 26.0}
        if model == "pro" or ed == "pro":
            return {"w": 8.9, "h": 38.8, "d": 21.6}
        return {"w": 8.0 if ed == "digital" else 9.6, "h": 35.8, "d": 21.6}
    if t == "keyboard":
        mech = bool(s.get("mechanical"))
        w, d, hm, hk = KEYBOARD_DIMS.get(s.get("size") or ("tkl" if mech else "full"), KEYBOARD_DIMS["full"])
        return {"w": w, "d": d, "h": hk if mech else hm}
    if t == "mouse":
        if s.get("vertical"):
            return {"w": 7.0, "d": 10.8, "h": 7.1}
        if s.get("trackpad"):
            return {"w": 16.0, "d": 11.5, "h": 1.1}
        return {"w": 8.4, "d": 12.5, "h": 5.1} if s.get("ergonomic") else {"w": 6.5, "d": 11.8, "h": 3.9}
    if t == "phone":
        return {"w": 7.1, "d": 14.7, "h": 0.8}
    if t == "tablet":
        pw, ph = panel_cm(float(s.get("size_in") or 11), 1.43)
        return {"w": round(pw + 1.4, 1), "d": round(ph + 1.4, 1), "h": 0.6}
    if t == "headset":
        return {"w": 6.0, "d": 4.5, "h": 2.2} if s.get("form") == "in_ear" else {"w": 17.5, "d": 8.5, "h": 20.0}
    if t == "light":
        return {"w": 45.0, "d": 9.0, "h": 3.0}
    if t == "webcam":
        return {"w": 9.4, "d": 2.6, "h": 2.9}
    if t == "hub":
        return {"w": 4.3, "d": 13.1, "h": 14.0} if s.get("kind") == "dock" else {"w": 11.5, "d": 4.5, "h": 1.5}
    if t == "speakers":
        return {"w": 10.0, "d": 12.0, "h": 17.0}
    if t == "arm":
        return {"w": 7.0, "d": 9.0, "h": 45.0, "clamp_min": 1.0, "clamp_max": 8.5}
    if t == "mousepad":
        return {"w": float(s.get("w_cm") or 30), "d": float(s.get("d_cm") or 25), "h": 0.3}
    if t == "monitor":
        return monitor_dims(s)
    return {"w": 20.0, "d": 20.0, "h": 5.0}


def dims(item_type: str, specs: dict[str, Any] | None = None, catalog_id: str | None = None) -> dict[str, Any]:
    """Medidas reales (cm) de un objeto del escritorio: catálogo, tablas de Apple o deducidas de su ficha."""
    s = specs or {}
    known = _dims_file().get("items", {}).get(catalog_id or "")
    if item_type == "monitor":
        out = monitor_dims(s, known)
        src = "fabricante" if known and not known.get("approx") else "orientativo"
        out.update(approx=src != "fabricante", src=src)
        return out
    if known:
        out = {**_default_dims(item_type, s), **copy.deepcopy(known)}
        out["approx"] = bool(known.get("approx"))
        out["src"] = known.get("src") or ("orientativo" if out["approx"] else "fabricante")
    elif s.get("platform") == "mac" and (mac := _mac_dims(item_type, s)):
        out = {**mac, "approx": False}
    else:
        out = {**_default_dims(item_type, s), "approx": True, "src": "deducido"}
    if item_type == "mousepad" and s.get("w_cm") and s.get("d_cm"):
        out.update(w=float(s["w_cm"]), d=float(s["d_cm"]))
    return out


def resolve_dims(auto: dict[str, Any], override: dict[str, Any] | None) -> dict[str, Any]:
    """Medidas automáticas + las que el usuario corrige a mano (ancho/fondo/alto en cm).

    En un monitor, el ancho cambia el marco, el alto la altura del pie y el fondo el pie
    (la pantalla sigue siendo la de sus pulgadas)."""
    out = dict(auto)
    o = {k: float(v) for k, v in (override or {}).items() if k in DIM_KEYS and v is not None}
    if not o:
        return out
    lo, hi = DIM_RANGE
    o = {k: min(hi, max(lo, v)) for k, v in o.items()}
    if "panel_h" in out and "lift" in out:   # monitor / iMac
        if "w" in o:
            out["bezel"] = round(max(0.2, (o["w"] - out.get("panel_w", o["w"])) / 2), 2)
        if "h" in o:
            out["lift"] = round(max(0.0, o["h"] - out["panel_h"] - out.get("bezel", 0.8) - out.get("chin", 1.5)), 1)
        if "d" in o:
            out["stand_d"] = o["d"]
    out.update(o)
    out["custom"] = True
    return out
