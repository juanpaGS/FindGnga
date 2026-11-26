"""Chollos de la comunidad (Chollometro) vía RSS.

Chollometro (red Pepper) publica feeds RSS de chollos. Se descargan y se
filtran por palabras clave. Si el feed cambia de URL, edítala en FEEDS o con
la variable de entorno ``FINDGNGA_DEAL_FEEDS`` (URLs separadas por comas).
"""

from __future__ import annotations

import os
import re
import time
import unicodedata
import xml.etree.ElementTree as ET
from typing import Any

import httpx

from .live import HEADERS, parse_price

FEEDS = ["https://www.chollometro.com/rss/hot", "https://www.chollometro.com/rss/nuevos"]
_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
CACHE_SECONDS = 600

CODE_RE = re.compile(r"(?:c[oó]digo|cup[oó]n|code)\s*[:\-]?\s*[\"'«]?([A-Z0-9][A-Z0-9_\-]{3,20})", re.I)
PRICE_RE = re.compile(r"(\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?€")


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return s.lower()


def parse_feed(xml_text: str) -> list[dict[str, Any]]:
    items = []
    root = ET.fromstring(xml_text)
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        desc = re.sub(r"<[^>]+>", " ", item.findtext("description") or "")
        price, merchant = None, None
        for child in item:
            tag = child.tag.split("}")[-1]
            if tag == "merchant":
                merchant = child.get("name")
                price = parse_price(child.get("price"))
        if price is None:
            m = PRICE_RE.search(title)
            price = parse_price(m.group(1)) if m else None
        code = CODE_RE.search(title + " " + desc)
        items.append({
            "title": title,
            "url": (item.findtext("link") or "").strip(),
            "published": item.findtext("pubDate"),
            "merchant": merchant,
            "price": price,
            "code": code.group(1) if code else None,
        })
    return items


def matches(item: dict[str, Any], query: str) -> bool:
    words = [w for w in _norm(query).split() if len(w) > 1]
    title = _norm(item["title"])
    return all(w in title for w in words)


async def fetch_deals(query: str) -> dict[str, Any]:
    feeds = [f for f in os.environ.get("FINDGNGA_DEAL_FEEDS", "").split(",") if f] or FEEDS
    all_items: list[dict[str, Any]] = []
    errors: list[str] = []
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=12) as client:
        for url in feeds:
            cached = _CACHE.get(url)
            if cached and time.time() - cached[0] < CACHE_SECONDS:
                all_items += cached[1]
                continue
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                parsed = parse_feed(resp.text)
                _CACHE[url] = (time.time(), parsed)
                all_items += parsed
            except Exception as exc:  # red caída, feed movido, XML roto...
                errors.append(f"{url}: {type(exc).__name__}")
    seen, out = set(), []
    for it in all_items:
        if it["url"] not in seen and matches(it, query):
            seen.add(it["url"])
            out.append(it)
    return {"items": out, "errors": errors}
