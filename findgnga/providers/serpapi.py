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
