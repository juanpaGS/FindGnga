"""Puntuación de monitores: calidad intrínseca + compatibilidad con los dispositivos del usuario.

Todas las puntuaciones van de 0 a 100. Cada regla deja un "motivo" legible
(pro / contra / aviso / info) para que la recomendación se pueda explicar.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

Monitor = dict[str, Any]
Device = dict[str, Any]


@dataclass
class Reason:
    kind: str  # "pro" | "con" | "warn" | "info"
    text: str

    def as_dict(self) -> dict[str, str]:
        return {"kind": self.kind, "text": self.text}


@dataclass
class Compat:
    device_id: str
    device_label: str
    score: float
    reasons: list[Reason] = field(default_factory=list)
    dealbreaker: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "device_id": self.device_id,
            "device_label": self.device_label,
            "score": round(self.score),
            "dealbreaker": self.dealbreaker,
            "reasons": [r.as_dict() for r in self.reasons],
        }


# ---------------------------------------------------------------------------
# Calidad intrínseca
# ---------------------------------------------------------------------------

PANEL_COLOR = {"oled": 95, "miniled_ips": 88, "ips_black": 85, "ips": 80, "miniled_va": 78, "va": 65, "tn": 45}
PANEL_CONTRAST = {"oled": 100, "miniled_ips": 85, "miniled_va": 88, "va": 70, "ips_black": 60, "ips": 45, "tn": 35}
HDR_SCORE = {"none": 15, "hdr10": 20, "hdr400": 40, "hdr500": 55, "hdr600": 65, "hdr1000": 85, "trueblack400": 92}
HDR_LABEL = {"none": "sin HDR", "hdr10": "HDR10 básico", "hdr400": "HDR400", "hdr500": "HDR500",
             "hdr600": "HDR600", "hdr1000": "HDR1000", "trueblack400": "HDR True Black 400"}
PANEL_LABEL = {"oled": "OLED", "miniled_ips": "Mini-LED IPS", "miniled_va": "Mini-LED VA", "ips_black": "IPS Black",
               "ips": "IPS", "va": "VA", "tn": "TN"}

# Peso de cada sub-puntuación según el uso.
USE_WEIGHTS: dict[str, dict[str, float]] = {
    "office":             {"sharpness": 3.0, "color": 1.0, "hdr": 0.5, "motion": 0.5, "ergonomics": 2.0},
    "programming":        {"sharpness": 3.0, "color": 0.5, "hdr": 0.5, "motion": 1.0, "ergonomics": 2.0},
    "photo_video":        {"sharpness": 2.0, "color": 3.0, "hdr": 2.0, "motion": 0.5, "ergonomics": 1.0},
    "gaming_competitive": {"sharpness": 0.5, "color": 1.0, "hdr": 1.0, "motion": 3.0, "ergonomics": 1.0},
    "gaming_casual":      {"sharpness": 1.0, "color": 1.5, "hdr": 2.0, "motion": 2.0, "ergonomics": 1.0},
    "movies":             {"sharpness": 1.0, "color": 2.0, "hdr": 3.0, "motion": 0.5, "ergonomics": 0.5},
}
BALANCED = {"sharpness": 1.0, "color": 1.0, "hdr": 1.0, "motion": 1.0, "ergonomics": 1.0}


def ppi(m: Monitor) -> float:
    return math.hypot(m["res_w"], m["res_h"]) / m["size_in"]


def _interp(x: float, points: list[tuple[float, float]]) -> float:
    """Interpolación lineal por tramos (points ordenados por x)."""
    if x <= points[0][0]:
        return points[0][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return points[-1][1]


def subscores(m: Monitor) -> dict[str, float]:
    sharp = _interp(ppi(m), [(80, 30), (92, 45), (110, 60), (140, 75), (163, 86), (200, 97), (218, 100)])
    gamut = m.get("dci_p3") or 70  # 0 = no publicado: asumimos ~sRGB
    color = 0.6 * PANEL_COLOR.get(m["panel"], 70) + 0.4 * min(gamut, 100)
    hdr = 0.5 * HDR_SCORE.get(m["hdr"], 15) + 0.5 * PANEL_CONTRAST.get(m["panel"], 45)
    motion = _interp(m["refresh_hz"], [(60, 30), (75, 40), (100, 55), (120, 65), (144, 75), (165, 81), (240, 95)])
    if m["panel"] == "oled":
        motion = min(100, motion + 5)
    ergo = 40 + 35 * bool(m.get("height_adjust")) + 15 * bool(m.get("kvm")) + 10 * bool(m.get("speakers"))
    return {"sharpness": sharp, "color": color, "hdr": hdr, "motion": motion, "ergonomics": float(ergo)}


def quality_score(m: Monitor, uses: list[str] | None) -> float:
    subs = subscores(m)
    weights: dict[str, float] = {}
    for use in uses or []:
        for k, w in USE_WEIGHTS.get(use, {}).items():
            weights[k] = weights.get(k, 0) + w
    if not weights:
        weights = BALANCED
    total = sum(weights.values())
    return sum(subs[k] * w for k, w in weights.items()) / total


def quality_reasons(m: Monitor) -> list[Reason]:
    out = [Reason("info", f"{m['size_in']}\" {m['res_w']}×{m['res_h']} ({ppi(m):.0f} ppi), "
                          f"{PANEL_LABEL.get(m['panel'], m['panel'])}, {m['refresh_hz']} Hz, {HDR_LABEL.get(m['hdr'], m['hdr'])}")]
    if m["panel"] == "oled":
        out.append(Reason("pro", "OLED: negros perfectos y respuesta instantánea"))
    elif m["panel"].startswith("miniled"):
        out.append(Reason("pro", "Mini-LED: HDR con mucho brillo y buen contraste"))
    if (m.get("dci_p3") or 0) >= 95:
        out.append(Reason("pro", f"Color amplio ({m['dci_p3']}% DCI-P3)"))
    if not m.get("height_adjust"):
        out.append(Reason("con", "La base no regula en altura"))
    return out


# ---------------------------------------------------------------------------
# Compatibilidad por tipo de dispositivo
# ---------------------------------------------------------------------------

def _has_hdmi(m: Monitor) -> bool:
    return (m.get("hdmi_21", 0) + m.get("hdmi_20", 0)) > 0


def _is_4k_or_more(m: Monitor) -> bool:
    return m["res_h"] >= 2160


def device_label(d: Device) -> str:
    if d.get("label"):
        return d["label"]
    return {
        "mac_laptop": "Mac portátil", "mac_desktop": "Mac de sobremesa", "windows_laptop": "Portátil",
        "desktop_pc": "PC de sobremesa", "ps5": "PS5", "xbox": "Xbox Series X|S", "switch": "Nintendo Switch",
    }.get(d.get("kind", ""), "Dispositivo")


def mac_hdmi_21(d: Device) -> bool:
    """¿El HDMI del Mac es 2.1? (MacBook Pro M2 Pro/Max en adelante y M3+; Mac mini/Studio M2 Pro+)."""
    if d.get("kind") == "mac_laptop" and d.get("model_line") == "air":
        return False
    gen = int(d.get("chip_gen") or 1)
    tier = d.get("chip_tier", "base")
    return gen >= 3 or (gen == 2 and tier in ("pro", "max", "ultra"))


def compat_mac(m: Monitor, d: Device) -> Compat:
    c = Compat(d.get("id", ""), device_label(d), 0)
    density = ppi(m)
    # 1) Nitidez en macOS: el escalado de macOS brilla a ~218 ppi (2x) y se ve "blando" a ~110 ppi (1x).
    if density >= 200:
        sharp = 100
        c.reasons.append(Reason("pro", "Densidad tipo Retina (~218 ppi): texto tan nítido como en la pantalla del Mac"))
    elif density >= 150:
        sharp = 82
        c.reasons.append(Reason("pro", "4K en 27\": muy nítido en macOS usando el escalado 'parece 2560×1440'"))
    elif density >= 130:
        sharp = 68
        c.reasons.append(Reason("info", "4K en 31-32\": nítido, aunque menos que un 5K/6K en macOS"))
    elif density >= 100:
        sharp = 50
        c.reasons.append(Reason("con", "~110 ppi: en macOS el texto se ve notablemente menos nítido que en tu portátil"))
    else:
        sharp = 30
        c.reasons.append(Reason("con", "Baja densidad: macOS se ve borroso a esta resolución"))

    # 2) Conexión y carga
    needs_w = 96 if (d.get("screen_in") or 14) >= 16 else 70
    if d.get("kind") == "mac_desktop":
        needs_w = 0
    pd = m.get("usb_c_pd_w", 0) if m.get("usb_c_video") else 0
    if m.get("usb_c_video"):
        if needs_w == 0:
            conn = 100
            c.reasons.append(Reason("pro", "Se conecta por USB-C/Thunderbolt con un solo cable"))
        elif pd >= needs_w or pd >= 90:
            conn = 100
            c.reasons.append(Reason("pro", f"Un solo cable USB-C: imagen + carga a {pd} W"))
        elif pd >= 60:
            conn = 82 if needs_w <= 70 else 68
            c.reasons.append(Reason("warn", f"Carga a {pd} W: suficiente en uso normal, se queda corta a plena carga"))
        else:
            conn = 62
            c.reasons.append(Reason("con", f"El USB-C da imagen pero apenas carga ({pd} W): necesitarás el cargador"))
        if m.get("thunderbolt"):
            conn = min(100, conn + 5)
            c.reasons.append(Reason("pro", "Thunderbolt: hub de alta velocidad para periféricos"))
    elif _has_hdmi(m):
        if d.get("kind") == "mac_laptop" and d.get("model_line") == "air":
            conn = 40
            c.reasons.append(Reason("con", "Sin USB-C: tu MacBook Air necesitará un adaptador USB-C→HDMI y el cargador aparte"))
        else:
            conn = 55
            c.reasons.append(Reason("con", "Sin USB-C: irá por HDMI y tendrás que enchufar el cargador aparte"))
            if not mac_hdmi_21(d) and _is_4k_or_more(m) and m["refresh_hz"] > 60:
                c.reasons.append(Reason("warn", "El HDMI de tu Mac es 2.0: por HDMI se quedará en 4K 60 Hz"))
    else:
        conn = 20
        c.reasons.append(Reason("con", "Conexión poco práctica con un Mac (sólo DisplayPort)"))

    # 3) Fluidez: ProMotion en el portátil hace que 120 Hz se note
    bonus = 0
    if m["refresh_hz"] >= 120 and (m.get("usb_c_video") or mac_hdmi_21(d)):
        bonus = 5
        c.reasons.append(Reason("pro", f"{m['refresh_hz']} Hz: tan fluido como el ProMotion de tu MacBook"))

    gen, tier, ram = d.get("chip_gen"), d.get("chip_tier", "base"), d.get("ram_gb")
    if gen:
        chip = f"M{gen}{'' if tier == 'base' else ' ' + tier.capitalize()}"
        if gen <= 2 and tier == "base":
            c.reasons.append(Reason("info", f"Tu {chip} sólo admite 1 monitor externo"))
        elif ram:
            c.reasons.append(Reason("info", f"Tu {chip} con {ram} GB mueve sin problema esta resolución"))

    c.score = min(100, 0.55 * sharp + 0.45 * conn + bonus)
    return c


def compat_console(m: Monitor, d: Device) -> Compat:
    """PS5 y Xbox Series: 16:9, 4K 120 Hz y VRR sólo por HDMI 2.1."""
    c = Compat(d.get("id", ""), device_label(d), 0)
    name = "la PS5" if d.get("kind") == "ps5" else "la consola"
    if not _has_hdmi(m):
        c.dealbreaker = True
        c.reasons.append(Reason("con", f"Sin HDMI: {name} no se puede conectar"))
        return c
    if m.get("aspect", "16:9") != "16:9":
        c.dealbreaker = True
        c.score = 30
        c.reasons.append(Reason("con", f"Formato {m['aspect']}: {name} no lo usa y verás bandas negras"))
        return c

    hdmi21 = m.get("hdmi_21", 0) > 0
    hz = m["refresh_hz"]
    if _is_4k_or_more(m) and m["res_w"] <= 3840:
        if hdmi21 and hz >= 120:
            base = 100
            c.reasons.append(Reason("pro", f"4K a 120 Hz con HDMI 2.1: lo máximo que da {name}"))
        elif hdmi21:
            base = 72
            c.reasons.append(Reason("warn", "4K pero a 60 Hz: los modos de 120 FPS no se aprovechan"))
        else:
            base = 65
            c.reasons.append(Reason("warn", "4K sólo a 60 Hz (HDMI 2.0)"))
    elif m["res_h"] >= 2160:  # 5K/6K: la consola envía 4K y el monitor escala
        base = 60
        c.reasons.append(Reason("warn", f"{name.capitalize()} enviará 4K y el monitor lo escalará; máximo 60 Hz"))
    elif m["res_h"] >= 1440:
        if hdmi21 and hz >= 120:
            base = 82
            c.reasons.append(Reason("info", "1440p a 120 Hz (no hay 4K nativo, pero va muy fluido)"))
        elif hz >= 120:
            base = 66
            c.reasons.append(Reason("warn", "1440p por HDMI 2.0: 120 Hz depende del monitor y no hay VRR"))
        else:
            base = 62
    else:
        base = 55
        c.reasons.append(Reason("con", "1080p: se desaprovecha la consola"))

    if m.get("vrr_hdmi") and hdmi21:
        base += 8
        c.reasons.append(Reason("pro", "VRR por HDMI 2.1: menos tirones y tearing"))
    elif hz > 60:
        c.reasons.append(Reason("warn", "Sin VRR por HDMI para consola"))

    if m["hdr"] in ("hdr600", "hdr1000", "trueblack400"):
        base += 6
        c.reasons.append(Reason("pro", f"{HDR_LABEL[m['hdr']]}: el HDR de los juegos sí se nota"))
    elif m["hdr"] in ("hdr400", "hdr10", "none"):
        c.reasons.append(Reason("info", "HDR flojo: en consola apenas se nota"))

    if m.get("speakers"):
        c.reasons.append(Reason("info", "Altavoces integrados para el sonido de la consola"))
    elif m.get("audio_out"):
        c.reasons.append(Reason("info", "Sin altavoces: usa la salida de audio del monitor o auriculares en el mando"))

    if d.get("kind") == "ps5" and d.get("edition") == "pro" and base >= 100:
        c.reasons.append(Reason("pro", "Saca todo el partido a la PS5 Pro"))
    c.score = min(100, base)
    return c


def compat_switch(m: Monitor, d: Device) -> Compat:
    c = Compat(d.get("id", ""), device_label(d), 0)
    if not _has_hdmi(m):
        c.dealbreaker = True
        c.reasons.append(Reason("con", "Sin HDMI: la Switch no se puede conectar"))
        return c
    c.score = 85
    c.reasons.append(Reason("info", "La Switch funciona por HDMI; el monitor escalará su imagen"))
    return c


GPU_LABEL = {"integrated": "gráfica integrada", "mid": "gráfica media", "high": "gráfica potente"}


def compat_pc(m: Monitor, d: Device, uses: list[str]) -> Compat:
    c = Compat(d.get("id", ""), device_label(d), 0)
    laptop = d.get("kind") == "windows_laptop"
    if laptop and d.get("usb_c_dp") and m.get("usb_c_video"):
        conn = 100 if (not d.get("usb_c_charging") or m.get("usb_c_pd_w", 0) >= 65) else 90
        c.reasons.append(Reason("pro", "Conexión USB-C directa" + (" con carga" if m.get("usb_c_pd_w", 0) >= 65 and d.get("usb_c_charging") else "")))
    elif not laptop and m.get("displayport"):
        conn = 100
        c.reasons.append(Reason("pro", "DisplayPort: la mejor conexión para PC"))
    elif _has_hdmi(m):
        conn = 85 if m.get("hdmi_21") else 75
        c.reasons.append(Reason("info", "Conexión por HDMI"))
    elif m.get("usb_c_video"):
        conn = 40
        c.reasons.append(Reason("con", "Sólo USB-C: comprueba que tu equipo saca vídeo por USB-C"))
    else:
        conn = 60

    gpu = d.get("gpu_tier", "integrated")
    gaming = any(u.startswith("gaming") for u in uses)
    if gaming and gpu == "high":
        perf = 100 if m["refresh_hz"] >= 144 else 70
    elif gaming and gpu == "mid":
        if m["res_h"] >= 2160 and m["refresh_hz"] >= 144:
            perf = 75
            c.reasons.append(Reason("warn", "Tu gráfica media no llegará a 4K con muchos FPS: bajarás calidad"))
        elif m["res_h"] == 1440 and m["refresh_hz"] >= 144:
            perf = 100
            c.reasons.append(Reason("pro", "1440p alta tasa: punto dulce para tu gráfica"))
        else:
            perf = 80
    elif gaming:
        perf = 70
        c.reasons.append(Reason("info", f"Con {GPU_LABEL.get(gpu, gpu)} los juegos exigentes no aprovecharán los Hz altos"))
    else:
        perf = 90
    c.score = 0.6 * conn + 0.4 * perf
    return c


def device_compat(m: Monitor, d: Device, uses: list[str]) -> Compat:
    kind = d.get("kind")
    if kind in ("mac_laptop", "mac_desktop"):
        return compat_mac(m, d)
    if kind in ("ps5", "xbox"):
        return compat_console(m, d)
    if kind == "switch":
        return compat_switch(m, d)
    return compat_pc(m, d, uses)


# ---------------------------------------------------------------------------
# Puntuación global para un conjunto de dispositivos objetivo
# ---------------------------------------------------------------------------

SIZE_PREF = {"24": (23, 25), "27": (26.5, 28.5), "32": (31, 34), "large": (34, 60)}


def evaluate(m: Monitor, devices: list[Device], uses: list[str], size_pref: str | None = None) -> dict[str, Any]:
    quality = quality_score(m, uses)
    compats = [device_compat(m, d, uses) for d in devices]
    reasons = quality_reasons(m)

    if compats:
        compat = sum(x.score for x in compats) / len(compats)
    else:
        compat = 75.0  # sin dispositivos: neutro
    dealbreaker = any(x.dealbreaker for x in compats)

    # Varios dispositivos a la vez: ¿hay entradas suficientes?
    hdmi_devices = [d for d in devices if d.get("kind") in ("ps5", "xbox", "switch")]
    usbc_devices = [d for d in devices if d.get("kind") in ("mac_laptop", "mac_desktop")]
    hdmi_ports = m.get("hdmi_21", 0) + m.get("hdmi_20", 0)
    if len(devices) >= 2 and not dealbreaker:
        if len(hdmi_devices) > hdmi_ports:
            compat -= 8
            reasons.append(Reason("warn", "No hay HDMI para todos tus dispositivos: tendrás que cambiar cables"))
        if hdmi_devices and usbc_devices and m.get("usb_c_video") and hdmi_ports:
            compat = min(100, compat + 4)
            reasons.append(Reason("pro", "Cada dispositivo en su entrada (USB-C + HDMI): cambias desde el menú sin tocar cables"))
        computers = [d for d in devices if d.get("kind") in ("mac_laptop", "mac_desktop", "windows_laptop", "desktop_pc")]
        if len(computers) >= 2 and m.get("kvm"):
            compat = min(100, compat + 4)
            reasons.append(Reason("pro", "KVM: un teclado y ratón para tus dos ordenadores"))

    fit = 0.5 * quality + 0.5 * compat
    if size_pref and size_pref in SIZE_PREF:
        lo, hi = SIZE_PREF[size_pref]
        if not (lo <= m["size_in"] <= hi):
            fit -= 8
            reasons.append(Reason("warn", f"Tamaño ({m['size_in']}\") distinto del que prefieres"))
    if dealbreaker:
        fit = min(fit, 35)

    return {
        "quality": round(quality, 1),
        "compat": round(compat, 1),
        "fit": round(max(0, fit), 1),
        "dealbreaker": dealbreaker,
        "subscores": {k: round(v) for k, v in subscores(m).items()},
        "reasons": [r.as_dict() for r in reasons],
        "devices": [x.as_dict() for x in compats],
    }
