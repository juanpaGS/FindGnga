"""Comprobación de precio en vivo desde la URL de un producto.

La mayoría de tiendas españolas publican el precio en datos estructurados
(JSON-LD schema.org ``Product``/``Offer``) o en etiquetas ``meta``. Algunas
(p. ej. Amazon) bloquean a veces peticiones automáticas: en ese caso se
devuelve un error claro y el precio se puede introducir a mano.
"""

from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from typing import Any

import httpx

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"),
    "Accept-Language": "es-ES,es;q=0.9",
    "Accept": "text/html,application/xhtml+xml",
}


def parse_price(value: Any) -> float | None:
    """Convierte '1.299,00 €', '1299.00', 349 → float."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = re.sub(r"[^\d,.\-]", "", str(value))
    if not s:
        return None
    if "," in s and "." in s:
        # El separador que aparece el último es el decimal
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        head, _, tail = s.rpartition(",")
        s = head.replace(",", "") + "." + tail if len(tail) != 3 else s.replace(",", "")
    elif s.count(".") > 1 or (s.count(".") == 1 and len(s.split(".")[1]) == 3):
        s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return None


class _Collector(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.jsonld: list[str] = []
        self.meta: dict[str, str] = {}
        self.itemprop_price: str | None = None
        self.title: str | None = None
        self._in_jsonld = False
        self._in_title = False
        self._buf: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "script" and a.get("type", "").lower() == "application/ld+json":
            self._in_jsonld, self._buf = True, []
        elif tag == "meta":
            key = a.get("property") or a.get("name") or a.get("itemprop")
            if key and "content" in a:
                self.meta[key.lower()] = a["content"]
        elif tag == "title":
            self._in_title = True
        if a.get("itemprop") == "price" and self.itemprop_price is None:
            self.itemprop_price = a.get("content") or None

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._in_jsonld:
            self.jsonld.append("".join(self._buf))
            self._in_jsonld = False
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_jsonld:
            self._buf.append(data)
        elif self._in_title and self.title is None and data.strip():
            self.title = data.strip()


def _walk(node: Any):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def _types(node: dict[str, Any]) -> set[str]:
    t = node.get("@type", [])
    return {t} if isinstance(t, str) else set(t)


def extract_price(html: str) -> dict[str, Any]:
    """Extrae {price, currency, in_stock, title, method} de una página de producto."""
    col = _Collector()
    col.feed(html)
    result: dict[str, Any] = {"price": None, "currency": None, "in_stock": None, "title": col.title, "method": None}

    for raw in col.jsonld:
        try:
            data = json.loads(raw.strip())
        except json.JSONDecodeError:
            continue
        for node in _walk(data):
            types = _types(node)
            if "Product" in types and node.get("name") and not result.get("_name"):
                result["_name"] = node["name"]
            if types & {"Offer", "AggregateOffer"}:
                price = parse_price(node.get("price") or node.get("lowPrice"))
                if price is None and isinstance(node.get("priceSpecification"), dict):
                    price = parse_price(node["priceSpecification"].get("price"))
                if price:
                    result.update(price=price, currency=node.get("priceCurrency", "EUR"), method="json-ld")
                    avail = str(node.get("availability", ""))
                    if avail:
                        result["in_stock"] = "InStock" in avail or "LimitedAvailability" in avail
                    break
        if result["price"]:
            break

    if not result["price"]:
        for key in ("product:price:amount", "og:price:amount", "price"):
            if key in col.meta and parse_price(col.meta[key]):
                result.update(price=parse_price(col.meta[key]),
                              currency=col.meta.get("product:price:currency", "EUR"), method=f"meta:{key}")
                break
    if not result["price"] and col.itemprop_price:
        result.update(price=parse_price(col.itemprop_price), currency="EUR", method="itemprop")

    name = result.pop("_name", None)
    if name:
        result["title"] = name
    return result


async def fetch_price(url: str, timeout: float = 15.0) -> dict[str, Any]:
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=timeout) as client:
        resp = await client.get(url)
    if resp.status_code >= 400:
        raise RuntimeError(f"La tienda respondió {resp.status_code} (puede bloquear peticiones automáticas)")
    data = extract_price(resp.text)
    if not data["price"]:
        raise RuntimeError("No encontré el precio en la página: añádelo a mano")
    return data
