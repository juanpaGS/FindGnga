"""Google Shopping España vía SerpApi (https://serpapi.com): la fuente más fiable.

Requiere una API key (tiene plan gratuito limitado). Devuelve ofertas de casi
todas las tiendas españolas con precio, tienda, envío y enlace.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

import httpx

from .base import parse_shipping

ENDPOINT = "https://serpapi.com/search.json"


def is_direct(url: str | None) -> bool:
    """¿Es un enlace a la ficha del producto en la tienda (no a Google ni a la portada)?"""
    if not url:
        return False
    u = urlparse(url)
    host = (u.hostname or "").lower()
    return bool(host) and "google." not in host and len(u.path.strip("/")) > 3


def parse(data: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for r in (data.get("shopping_results") or []) + (data.get("inline_shopping_results") or []):
        price = r.get("extracted_price")
        if price is None:
            continue
        link = r.get("link")
        out.append({
            "title": r.get("title", ""),
            "price": float(price),
            "url": link if is_direct(link) else (r.get("product_link") or link),
            "direct": is_direct(link),
            "immersive_token": r.get("immersive_product_page_token"),
            "google_url": r.get("product_link"),
            "store_name": r.get("source") or r.get("merchant"),
            "shipping": parse_shipping(r.get("delivery")),
            "in_stock": None,
            "condition": "used" if r.get("second_hand_condition") else None,
            "old_price": r.get("extracted_old_price"),
            "image": r.get("thumbnail"),
        })
    return out


async def search(client: httpx.AsyncClient, query: str, api_key: str) -> list[dict[str, Any]]:
    params = {"engine": "google_shopping", "q": query, "gl": "es", "hl": "es",
              "google_domain": "google.es", "location": "Spain", "api_key": api_key}
    resp = await client.get(ENDPOINT, params=params)
    if resp.status_code == 401:
        raise PermissionError("API key de SerpApi no válida")
    resp.raise_for_status()
    data = resp.json()
    if data.get("error"):
        if "hasn't returned any results" in data["error"]:
            return []
        raise RuntimeError(data["error"])
    return parse(data)


# ---------------------------------------------------------------- Amazon.es y eBay.es (misma API key)

def _num(v: Any) -> float | None:
    from ..pricing.live import parse_price
    if isinstance(v, dict):
        for k in ("extracted", "value", "raw"):
            if v.get(k) is not None:
                return _num(v[k])
        if isinstance(v.get("from"), dict):
            return _num(v["from"])
        return None
    return parse_price(v) if v is not None else None


def parse_amazon(data: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for r in data.get("organic_results") or []:
        price = r.get("extracted_price") if r.get("extracted_price") is not None else _num(r.get("price"))
        if not price or r.get("sponsored"):
            continue
        out.append({"title": r.get("title", ""), "price": float(price),
                    "url": r.get("link_clean") or r.get("link"), "store_name": "Amazon.es",
                    "store_id": "amazon", "in_stock": None,
                    "old_price": r.get("extracted_old_price"), "image": r.get("thumbnail")})
    return out


def parse_ebay(data: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for r in data.get("organic_results") or []:
        price = _num(r.get("price"))
        if not price:
            continue
        cond = str(r.get("condition") or "").lower()
        ship = r.get("shipping")
        shipping = parse_shipping(ship) if isinstance(ship, str) else _num(ship)
        out.append({"title": r.get("title", ""), "price": float(price), "url": r.get("link"),
                    "store_name": "eBay", "store_id": "ebay", "marketplace": True,
                    "condition": "new" if (not cond or "nuevo" in cond or "new" in cond) else "used",
                    "shipping": shipping, "in_stock": None})
    return out


async def _get(client: httpx.AsyncClient, params: dict[str, Any]) -> dict[str, Any]:
    resp = await client.get(ENDPOINT, params=params)
    if resp.status_code == 401:
        raise PermissionError("API key de SerpApi no válida")
    resp.raise_for_status()
    data = resp.json()
    if data.get("error") and "hasn't returned any results" not in data["error"]:
        raise RuntimeError(data["error"])
    return data


async def search_amazon(client: httpx.AsyncClient, query: str, api_key: str) -> list[dict[str, Any]]:
    data = await _get(client, {"engine": "amazon", "amazon_domain": "amazon.es", "k": query,
                               "language": "es_ES", "api_key": api_key})
    return parse_amazon(data)


async def search_ebay(client: httpx.AsyncClient, query: str, api_key: str) -> list[dict[str, Any]]:
    data = await _get(client, {"engine": "ebay", "ebay_domain": "ebay.es", "_nkw": query, "api_key": api_key})
    return parse_ebay(data)


# ---------------------------------------------------------------- enlaces directos (ficha del producto)

USED_HINTS = ("usado", "segunda mano", "reacondicionad", "second-hand", "used", "refurbished", "renewed")


def parse_immersive(data: dict[str, Any], fallback_title: str = "") -> list[dict[str, Any]]:
    """Tiendas que venden un producto de Google Shopping, con el enlace directo a su ficha."""
    pr = data.get("product_results") or {}
    title = pr.get("title") or fallback_title
    out = []
    for s in pr.get("stores") or data.get("stores") or []:
        price = s.get("extracted_price") if s.get("extracted_price") is not None else _num(s.get("price"))
        link = s.get("link")
        if not price or not is_direct(link):
            continue
        total = s.get("extracted_total") if s.get("extracted_total") is not None else _num(s.get("total"))
        extra = " ".join(str(x) for x in (s.get("details_and_offers") or []) + [s.get("shipping") or "", s.get("tag") or ""])
        shipping = round(float(total) - float(price), 2) if total and float(total) >= float(price) else parse_shipping(extra)
        old = s.get("extracted_original_price") if s.get("extracted_original_price") is not None else _num(s.get("original_price"))
        out.append({"title": title, "price": float(price), "url": link, "store_name": s.get("name"),
                    "shipping": shipping, "old_price": old, "in_stock": None, "direct": True, "resolved": True,
                    "condition": "used" if any(h in extra.lower() for h in USED_HINTS) else None})
    return out


async def resolve(client: httpx.AsyncClient, token: str, api_key: str, title: str = "") -> list[dict[str, Any]]:
    """Abre la ficha de producto de Google Shopping (1 búsqueda del plan) y devuelve las tiendas con enlace directo."""
    data = await _get(client, {"engine": "google_immersive_product", "page_token": token,
                               "gl": "es", "hl": "es", "api_key": api_key})
    return parse_immersive(data, title)


# ---------------------------------------------------------------- Idealo a través de Google

IDEALO_PRICE = re.compile(r"(?:desde|a partir de|precio[^0-9€]{0,20})\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s*€", re.I)
ANY_PRICE = re.compile(r"(\d{1,3}(?:\.\d{3})*,\d{2})\s*€")


def parse_idealo(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Resultados de Google sobre fichas de idealo.es: precio mínimo y enlace a Idealo (referencia)."""
    from ..pricing.live import parse_price
    out = []
    for r in data.get("organic_results") or []:
        link = r.get("link") or ""
        if "idealo.es" not in link:
            continue
        ext = ((r.get("rich_snippet") or {}).get("top") or {}).get("detected_extensions") or {}
        price = ext.get("price") or ext.get("price_from")
        if price is None:
            text = " ".join(str(x) for x in (r.get("title"), r.get("snippet"),
                                              *(((r.get("rich_snippet") or {}).get("top") or {}).get("extensions") or [])))
            m = IDEALO_PRICE.search(text) or ANY_PRICE.search(text)
            price = parse_price(m.group(1)) if m else None
        if not price:
            continue
        title = re.sub(r"\s*[|–][^|–]*idealo.*$", "", r.get("title", ""), flags=re.I)
        title = re.sub(r"\s+(desde|a partir de)\s+[\d.,]+\s*€.*$", "", title, flags=re.I)
        out.append({"title": title, "price": float(price),
                    "url": link, "store_name": "Idealo", "store_id": "idealo", "reference": True})
    return out


async def search_idealo(client: httpx.AsyncClient, query: str, api_key: str) -> list[dict[str, Any]]:
    data = await _get(client, {"engine": "google", "q": f"{query} site:idealo.es", "gl": "es", "hl": "es",
                               "google_domain": "google.es", "num": 10, "api_key": api_key})
    return parse_idealo(data)


async def account(client: httpx.AsyncClient, api_key: str) -> dict[str, Any]:
    """Estado de la cuenta (búsquedas restantes)."""
    resp = await client.get("https://serpapi.com/account.json", params={"api_key": api_key})
    if resp.status_code == 401:
        raise PermissionError("API key de SerpApi no válida")
    resp.raise_for_status()
    return resp.json()
