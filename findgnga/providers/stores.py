"""Búsqueda directa en las tiendas de data/stores.json (genérica: JSON-LD / JSON incrustado)."""

from __future__ import annotations

import asyncio
from typing import Any
from urllib.parse import quote_plus

import httpx

from .. import storage
from .base import fetch_html
from .extract import extract_listings

# Sólo JS o cubiertas por SerpApi. Game y Carrefour: su buscador se ejecuta en el navegador
# (game.es/buscar/... da 404 y carrefour.es/?q=... devuelve la portada sin productos).
SKIP = {"aliexpress", "coolmod", "backmarket", "ebay", "game", "carrefour"}


async def _one(client: httpx.AsyncClient, store: dict[str, Any], query: str) -> tuple[str, list[dict[str, Any]], str | None]:
    url = store["search_url"].replace("{q}", quote_plus(query))
    try:
        html = await fetch_html(client, url)
        items = extract_listings(html, url)
        for it in items:
            it["store_name"] = store["name"]
            it["store_id"] = store["id"]
        return store["id"], items, None
    except Exception as exc:
        return store["id"], [], f"{type(exc).__name__}: {exc}"


async def search(client: httpx.AsyncClient, query: str) -> tuple[list[dict[str, Any]], dict[str, str | None]]:
    stores = [s for s in storage.load_catalog("stores") if s["id"] not in SKIP]
    results = await asyncio.gather(*(_one(client, s, query) for s in stores))
    items: list[dict[str, Any]] = []
    status: dict[str, str | None] = {}
    for sid, its, err in results:
        items += its
        status[sid] = err if err else f"{len(its)} resultados"
    return items, status
