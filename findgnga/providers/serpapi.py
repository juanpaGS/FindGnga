"""Google Shopping España vía SerpApi (https://serpapi.com): la fuente más fiable.

Requiere una API key (tiene plan gratuito limitado). Devuelve ofertas de casi
todas las tiendas españolas con precio, tienda, envío y enlace.
"""

from __future__ import annotations

from typing import Any

import httpx

from .base import parse_shipping

ENDPOINT = "https://serpapi.com/search.json"


def parse(data: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for r in (data.get("shopping_results") or []) + (data.get("inline_shopping_results") or []):
        price = r.get("extracted_price")
        if price is None:
            continue
        out.append({
            "title": r.get("title", ""),
            "price": float(price),
            "url": r.get("link") or r.get("product_link"),
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


async def account(client: httpx.AsyncClient, api_key: str) -> dict[str, Any]:
    """Estado de la cuenta (búsquedas restantes)."""
    resp = await client.get("https://serpapi.com/account.json", params={"api_key": api_key})
    if resp.status_code == 401:
        raise PermissionError("API key de SerpApi no válida")
    resp.raise_for_status()
    return resp.json()
