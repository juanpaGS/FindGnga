"""Extracción genérica de listados de producto desde HTML (JSON-LD y JSON incrustado).

Funciona con cualquier web que publique datos estructurados (schema.org) o
estado JSON (Next.js ``__NEXT_DATA__``, ``application/json``...). No depende de
clases CSS, que cambian a menudo.
"""

from __future__ import annotations

import json
import re
from html import unescape
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin

from ..pricing.live import parse_price

TITLE_KEYS = ("name", "title", "productName", "displayName", "product_name")
PRICE_KEYS = ("price", "salePrice", "finalPrice", "currentPrice", "sellingPrice", "priceValue",
              "promotionalPrice", "lowPrice", "offerPrice", "bestPrice", "minPrice", "amount")
URL_KEYS = ("url", "link", "href", "productUrl", "canonicalUrl", "seoUrl", "slug", "shareableLink")
STOCK_KEYS = ("availability", "inStock", "isAvailable", "available", "stock")


class _Scripts(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.blocks: list[tuple[str, str]] = []  # (tipo, contenido)
        self.attr_json: list[str] = []
        self._cur: str | None = None
        self._buf: list[str] = []

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "script":
            t = a.get("type", "").lower()
            if t == "application/ld+json":
                self._cur = "ld"
            elif t == "application/json" or a.get("id") == "__NEXT_DATA__":
                self._cur = "json"
            elif t in ("", "text/javascript"):
                self._cur = "js"
            else:
                self._cur = None
            self._buf = []
        for k, v in a.items():
            if k in ("data-vue3", "data-vue2", "data-props", "data-state") and v.lstrip().startswith("{"):
                self.attr_json.append(v)

    def handle_endtag(self, tag):
        if tag == "script" and self._cur:
            self.blocks.append((self._cur, "".join(self._buf)))
            self._cur = None

    def handle_data(self, data):
        if self._cur:
            self._buf.append(data)


ASSIGN_RE = re.compile(r"window\.__[A-Za-z0-9_]+__\s*=\s*(\{.*\})\s*;?\s*$", re.S)


def _loads(text: str) -> Any:
    try:
        return json.loads(text.strip())
    except (json.JSONDecodeError, ValueError):
        return None


def json_blobs(html: str) -> tuple[list[Any], list[Any]]:
    """(bloques JSON-LD, otros bloques JSON incrustados)."""
    p = _Scripts()
    p.feed(html)
    ld, other = [], []
    for kind, content in p.blocks:
        if kind == "ld":
            d = _loads(content)
            if d is not None:
                ld.append(d)
        elif kind == "json":
            d = _loads(content)
            if d is not None:
                other.append(d)
        elif kind == "js":
            m = ASSIGN_RE.search(content.strip())
            if m:
                d = _loads(m.group(1))
                if d is not None:
                    other.append(d)
    for raw in p.attr_json:
        d = _loads(unescape(raw))
        if d is not None:
            other.append(d)
    return ld, other


def walk(node: Any):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk(v)


def _price(v: Any) -> float | None:
    if isinstance(v, dict):
        for k in ("value", "amount", "current", "final", "sale", "price", "raw"):
            if k in v:
                return _price(v[k])
        return None
    if isinstance(v, bool):
        return None
    p = parse_price(v)
    return p if p and 1 <= p <= 100000 else None


def _first(d: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for k in keys:
        if k in d and d[k] not in (None, "", [], {}):
            return d[k]
    return None


def _stock(v: Any) -> bool | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v > 0
    s = str(v).lower()
    if "outofstock" in s or "soldout" in s or "discontinued" in s or "agotado" in s:
        return False
    if "instock" in s or "limitedavailability" in s or "preorder" in s or "disponible" in s:
        return True
    return None


def from_jsonld(ld: list[Any], base_url: str) -> list[dict[str, Any]]:
    out = []
    for doc in ld:
        for node in walk(doc):
            t = node.get("@type")
            types = {t} if isinstance(t, str) else set(t or [])
            if "Product" not in types:
                continue
            offers = node.get("offers")
            offer_list = offers if isinstance(offers, list) else [offers] if isinstance(offers, dict) else []
            for off in offer_list:
                price = _price(off.get("price") or off.get("lowPrice"))
                if not price:
                    continue
                url = off.get("url") or node.get("url")
                out.append({"title": node.get("name", ""), "price": price,
                            "url": urljoin(base_url, url) if url else None,
                            "in_stock": _stock(off.get("availability")),
                            "seller": (off.get("seller") or {}).get("name") if isinstance(off.get("seller"), dict) else None})
                break
    return out


def from_embedded(blobs: list[Any], base_url: str) -> list[dict[str, Any]]:
    out = []
    for blob in blobs:
        for node in walk(blob):
            title = _first(node, TITLE_KEYS)
            if not isinstance(title, str) or len(title) < 6:
                continue
            price = _price(_first(node, PRICE_KEYS))
            url = _first(node, URL_KEYS)
            if not price or not isinstance(url, str):
                continue
            out.append({"title": title, "price": price, "url": urljoin(base_url, url),
                        "in_stock": _stock(_first(node, STOCK_KEYS)), "seller": None})
    return out


def extract_listings(html: str, base_url: str) -> list[dict[str, Any]]:
    ld, other = json_blobs(html)
    seen, out = set(), []
    for item in from_jsonld(ld, base_url) + from_embedded(other, base_url):
        key = (item["url"], item["price"])
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out
