"""Utilidades comunes: descarga, normalización de títulos, emparejado de productos y tiendas."""

from __future__ import annotations

import re
import unicodedata
from typing import Any
from urllib.parse import urlparse

import httpx

from .. import storage
from ..pricing.live import HEADERS

TIMEOUT = 15.0

USED_RE = re.compile(r"\b(reacondicionad[oa]s?|segunda mano|usad[oa]|seminuev[oa]|renewed|como nuevo|outlet|grado [abc])\b")


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", text)).strip()


def compact(text: str) -> str:
    return norm(text).replace(" ", "")


async def fetch_html(client: httpx.AsyncClient, url: str) -> str:
    resp = await client.get(url)
    if resp.status_code in (403, 429, 503):
        raise PermissionError(f"bloqueado por la web (HTTP {resp.status_code})")
    resp.raise_for_status()
    return resp.text


def new_client(timeout: float = TIMEOUT) -> httpx.AsyncClient:
    return httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=timeout)


# ------------------------------------------------------------------ tiendas

def _store_index() -> list[tuple[str, str, str]]:
    out = []
    for s in storage.load_catalog("stores"):
        host = urlparse(s["search_url"].replace("{q}", "x")).hostname or ""
        domain = host.removeprefix("www.").removeprefix("es.")
        out.append((s["id"], compact(s["name"]), domain))
    return out


def resolve_store(name: str | None = None, url: str | None = None) -> tuple[str, str]:
    """Devuelve (store_id, nombre visible). Si no es una tienda conocida, crea un id a partir del nombre."""
    host = (urlparse(url).hostname or "") if url else ""
    cname = compact(name or "")
    for sid, sname, domain in _store_index():
        if (domain and domain in host) or (cname and (sname in cname or cname in sname)):
            return sid, next(s["name"] for s in storage.load_catalog("stores") if s["id"] == sid)
    label = name or host.removeprefix("www.") or "Tienda"
    return "x-" + (compact(label)[:30] or "tienda"), label


# ------------------------------------------------------------------ emparejado

ACCESSORY = (r"\b(mando|dualsense|funda|carcasa|soporte|cargador|cable|auriculares?|headset|portal|vr2|pegatina|skin|"
             r"vinilo|protector|base de carga|estacion de carga|unidad de disco|lector de discos|tarjeta regalo|"
             r"brazo|limpiador|ventilador|maleta|bolsa)\b")


# Consolas o productos modificados (jailbreak, chip…): sin garantía y a veces ilegales
MODDED_RE = re.compile(r"\b(modded|modificad[ao]s?|jailbreak|jailbroken|homebrew|chipead[ao]s?|flasheada?s?|hackead[ao]s?)\b")

BUNDLE_RE = re.compile(r"\b(pack|bundle|mandos?|juegos?|incluye|regalo)\b")


FOREIGN_LAYOUT = (r"\b(layout|qwerty|teclado|teclados) (us|uk|pt|fr|de|it|nor|sui|latam|nordic|ingles|portugues|frances|aleman|italiano)\b"
                  r"|\b(portugues|frances|aleman|italiano|azerty|qwertz|nordico|suizo)\b")


def is_bundle(title: str) -> bool:
    return bool(BUNDLE_RE.search(norm(title))) or "+" in (title or "")


def matcher(product: dict[str, Any], reject_accessories: bool = True):
    """Devuelve una función título -> (ok, motivo).

    En consolas los packs (consola + juego/mando) son válidos: lo que no sea la
    consola se descarta por precio (un mando cuesta mucho menos que una PS5).
    """
    rules = product.get("match") or {}
    codes = [compact(c) for c in product.get("codes", [])]
    all_re = [re.compile(p) for p in rules.get("all", [])]
    none_re = [re.compile(p) for p in rules.get("none", [])]
    if reject_accessories:
        none_re.append(re.compile(ACCESSORY))
    if product.get("kind") == "keyboard":  # en España queremos la distribución española
        none_re.append(re.compile(FOREIGN_LAYOUT))

    def check(title: str) -> tuple[bool, str]:
        n, c = norm(title), compact(title)
        if MODDED_RE.search(n):
            return False, "consola modificada (jailbreak)"
        if codes and not any(code in c for code in codes):
            return False, "no es el modelo"
        for r in all_re:
            if not r.search(n):
                return False, "no es el modelo"
        for r in none_re:
            if r.search(n):
                return False, "accesorio u otra versión"
        return True, ""
    return check


def price_band(product: dict[str, Any], category: str) -> tuple[float, float]:
    ref = float(product.get("msrp") or product["ref_price"])
    if category == "accessory":  # precios de referencia orientativos y productos genéricos: banda más ancha
        return ref * 0.35, ref * 2.2
    return (ref * 0.55, ref * 1.6) if category == "console" else (ref * 0.45, ref * 1.8)


SECOND_HAND_SITES = ("wallapop", "vinted", "milanuncios", "todocoleccion", "cashconverters", "cash converters",
                     "backmarket", "back market", "rebuy", "eurocash", "webuy.com", "cex", "realcash", "segunda mano")


def is_second_hand_site(store_name: str | None, url: str | None) -> bool:
    """Webs de segunda mano o reacondicionados: sus anuncios se venden y desaparecen enseguida."""
    host = (urlparse(url).hostname or "") if url else ""
    text = (host + " " + (store_name or "")).lower()
    return any(s in text for s in SECOND_HAND_SITES)


def condition_of(title: str) -> str:
    return "used" if USED_RE.search(norm(title)) else "new"


def parse_shipping(text: str | None) -> float | None:
    """'Envío gratis' -> 0 ; '+4,99 € de envío' -> 4.99 ; None si no se sabe."""
    if not text:
        return None
    t = norm(text)
    if "gratis" in t or "gratuito" in t or "free" in t:
        return 0.0
    m = re.search(r"(\d+(?:[.,]\d{1,2})?)", text)
    if m and ("envio" in t or "entrega" in t or "delivery" in t or "shipping" in t):
        return float(m.group(1).replace(",", "."))
    return None
