"""Chollometro: chollos publicados y votados por la comunidad (con códigos).

Lee la página de búsqueda (los datos de cada chollo van como JSON en atributos
``data-vue3`` de la red Pepper) y, si no puede, los feeds RSS.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote_plus

import httpx

from ..pricing import deals
from .base import fetch_html
from .extract import json_blobs, walk

BASE = "https://www.chollometro.com"


def parse_search(html: str, stats: dict[str, int] | None = None) -> list[dict[str, Any]]:
    _, blobs = json_blobs(html)
    out, seen = [], set()
    stats = stats if stats is not None else {}
    stats.setdefault("threads", 0)
    stats.setdefault("expired", 0)
    for blob in blobs:
        for node in walk(blob):
            if "threadId" not in node or "title" not in node:
                continue
            tid = node["threadId"]
            if tid in seen:
                continue
            seen.add(tid)
            stats["threads"] += 1
            if node.get("isExpired") or node.get("isGone") or node.get("status") == "expired":
                stats["expired"] += 1
                continue
            price = node.get("price")
            if not isinstance(price, (int, float)) or price <= 0:
                continue
            merchant = node.get("merchant")
            store = merchant.get("merchantName") if isinstance(merchant, dict) else merchant
            url = node.get("shareableLink") or node.get("url") or f"{BASE}/ofertas/{node.get('titleSlug', 'oferta')}-{tid}"
            ship = node.get("shipping") if isinstance(node.get("shipping"), dict) else {}
            out.append({
                "title": node["title"], "price": float(price), "url": url,
                "deal_url": url, "shop_url": f"{BASE}/visit/thread/{tid}",
                "store_name": store, "in_stock": True,
                "shipping": 0.0 if ship.get("isFree") else ship.get("price"),
                "code": node.get("voucherCode") or None,
                "temperature": node.get("temperature"),
                "old_price": node.get("nextBestPrice"),
            })
    return out


async def search(client: httpx.AsyncClient, query: str) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Devuelve (chollos vigentes, detalle para el diagnóstico)."""
    search_error = None
    stats: dict[str, int] = {}
    try:
        html = await fetch_html(client, f"{BASE}/search?q={quote_plus(query)}")
        items = parse_search(html, stats)
        detail = {"búsqueda": f"{stats['threads']} chollos, {stats['expired']} caducados → {len(items)} resultados"}
        if items or stats["threads"]:
            return items, detail
    except Exception as exc:
        search_error = f"{type(exc).__name__}: {exc}"
    feed = await deals.fetch_deals(query)
    if search_error and feed["errors"] and not feed["items"]:
        raise RuntimeError(f"búsqueda: {search_error}; RSS: {'; '.join(feed['errors'])}")
    items = [{"title": d["title"], "price": d["price"], "url": d["url"], "deal_url": d["url"],
              "store_name": d["merchant"], "code": d["code"], "in_stock": True}
             for d in feed["items"] if d.get("price")]
    return items, {"rss": f"{len(items)} resultados"}
