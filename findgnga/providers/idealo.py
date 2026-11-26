"""Idealo.es (comparador). Experimental: lee los datos estructurados de su búsqueda
y, si encuentra la ficha del producto, la lista de ofertas por tienda."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import quote_plus

import httpx

from .base import fetch_html
from .extract import extract_listings

BASE = "https://www.idealo.es"
OFFER_LINK = re.compile(r'href="(/precios/\d+/[^"#?]+\.html)"')


async def search(client: httpx.AsyncClient, query: str) -> list[dict[str, Any]]:
    html = await fetch_html(client, f"{BASE}/resultados.html?q={quote_plus(query)}")
    items = extract_listings(html, BASE)
    # Si la búsqueda enlaza a fichas de producto, la primera tiene las ofertas por tienda
    m = OFFER_LINK.search(html)
    if m:
        try:
            page = await fetch_html(client, BASE + m.group(1))
            items += [{**x, "via_idealo": True} for x in extract_listings(page, BASE)]
        except Exception:
            pass
    for it in items:
        it.setdefault("store_name", it.pop("seller", None) or "idealo")
    return items
