"""PcComponentes: su buscador devuelve JSON (el mismo que usa su web), con precio, stock, envío y vendedor.

Si el JSON falla, ``stores`` vuelve al lector genérico de la página de búsqueda.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

API = "https://www.pccomponentes.com/api/articles/search?query={q}"
BASE = "https://www.pccomponentes.com/"


def parse(data: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for a in data.get("articles") or []:
        price = a.get("promotionalPrice") or a.get("originalPrice")
        slug = a.get("slug")
        if not price or not slug:
            continue
        seller = a.get("sellerName") or "PcComponentes"
        own = bool(a.get("isPCC")) or seller.lower() == "pccomponentes"
        old = a.get("originalPrice")
        stock = a.get("stock")
        delivery = a.get("delivery") or {}
        out.append({
            "title": a.get("name") or a.get("singleName") or "",
            "price": float(price),
            "old_price": float(old) if old and float(old) > float(price) else None,
            "url": BASE + slug,
            "store_name": "PcComponentes" if own else f"PcComponentes (vende {seller})",
            "store_id": "pccomponentes",
            "marketplace": not own,
            "shipping": float(a["shippingCost"]) if a.get("shippingCost") is not None else None,
            "in_stock": None if stock is None and not delivery else bool(stock) or delivery.get("availabilityCode") == 1,
            "condition": "used" if "reacondicionado" in (a.get("name") or "").lower() else "new",
            "rating": a.get("ratingAvg"),
            "image": ((a.get("images") or {}).get("medium") or {}).get("path"),
            "direct": True,
        })
    return out


async def search(client: httpx.AsyncClient, query: str) -> list[dict[str, Any]]:
    resp = await client.get(API.format(q=quote(query)), headers={"Accept": "application/json"})
    if resp.status_code in (403, 429, 503):
        raise PermissionError(f"bloqueado por la web (HTTP {resp.status_code})")
    resp.raise_for_status()
    return parse(resp.json())
