"""Rebuy: reacondicionados con garantía. Su página de búsqueda llega ya renderizada (sin JS),
cada producto va en un bloque ``<ry-product>`` con título, precio («1015,99 €») y enlace ``/i,ID/...``.

Todo lo que vende Rebuy es de segunda mano revisado, así que se marca ``condition = used``.
"""

from __future__ import annotations

import html as _html
import re
from typing import Any
from urllib.parse import quote_plus

import httpx

from .base import fetch_html

SEARCH = "https://www.rebuy.es/comprar/search?q={q}"
BASE = "https://www.rebuy.es"
_CARD = re.compile(r"<ry-product\b(.*?)</ry-product>", re.S)
_TITLE = re.compile(r'class="title[^"]*"[^>]*>(.*?)</div>', re.S)
_HREF = re.compile(r'href="(/i,\d+/[^"]+)"')
_PRICE = re.compile(r"(?<![\d.,])(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})(?:&nbsp;|\s)*€")


def _num(txt: str) -> float:
    return float(txt.replace(".", "").replace(",", "."))


def parse(page: str) -> list[dict[str, Any]]:
    out = []
    for card in _CARD.findall(page):
        t, h, p = _TITLE.search(card), _HREF.search(card), _PRICE.findall(card)
        if not (t and h and p):
            continue
        title = _html.unescape(re.sub(r"<[^>]+>", " ", t.group(1)))
        title = re.sub(r"\s+", " ", title).strip()
        prices = [_num(x) for x in p]
        out.append({
            "title": title, "price": min(prices),
            "old_price": max(prices) if max(prices) > min(prices) else None,
            "url": BASE + _html.unescape(h.group(1)),
            "store_name": "Rebuy (reacondicionado)", "store_id": "rebuy",
            "condition": "used", "marketplace": False,
            "in_stock": "no disponible" not in card.lower() and "agotado" not in card.lower(),
            "direct": True,
        })
    return out


async def search(client: httpx.AsyncClient, query: str) -> list[dict[str, Any]]:
    return parse(await fetch_html(client, SEARCH.format(q=quote_plus(query))))
