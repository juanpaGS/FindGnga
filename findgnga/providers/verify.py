"""Verificación y fiabilidad de las ofertas encontradas.

1. **Verificar en la tienda**: abre la página de las ofertas más baratas y lee el
   precio y el stock reales (JSON-LD/meta). Los comparadores a veces muestran
   precios de hace horas o productos ya agotados.
2. **Consenso**: si varias fuentes ven la misma tienda al mismo precio, sube la confianza.
3. **Alertas**: tienda desconocida, vendedor externo (marketplace) y precios
   sospechosamente baratos respecto al resto (posible error o estafa).
"""

from __future__ import annotations

import asyncio
import statistics
from typing import Any
from urllib.parse import urlparse

import httpx

from .. import shopcheck, storage
from ..pricing import live

UNVERIFIABLE_HOSTS = ("google.", "chollometro.com/ofertas", "chollometro.com/share")
MARKETPLACE_HINTS = ("aliexpress", "ebay", "marketplace", "vendido por terceros", "fulfilled")


def _verify_url(o: dict[str, Any]) -> str | None:
    url = o.get("shop_url") or o.get("url")
    if not url or not url.startswith("http"):
        return None
    if any(h in url for h in UNVERIFIABLE_HOSTS) and not o.get("shop_url"):
        return None
    return url


async def verify_offer(client: httpx.AsyncClient, o: dict[str, Any], sem: asyncio.Semaphore) -> dict[str, Any]:
    url = _verify_url(o)
    if not url:
        return {"status": "unverifiable", "note": "el enlace no es de la tienda"}
    async with sem:
        try:
            resp = await client.get(url, timeout=10)
            if resp.status_code >= 400:
                return {"status": "unverifiable", "note": f"la tienda respondió {resp.status_code}"}
            data = live.extract_price(resp.text)
        except Exception as exc:
            return {"status": "unverifiable", "note": type(exc).__name__}
    final_url = str(resp.url)
    if data.get("in_stock") is False:
        return {"status": "out_of_stock", "note": "agotado en la tienda", "final_url": final_url}
    price = data.get("price")
    if not price:
        return {"status": "unverifiable", "note": "la página no publica el precio", "final_url": final_url}
    if abs(price - o["price"]) <= max(1.0, o["price"] * 0.02):
        return {"status": "verified", "page_price": price, "final_url": final_url}
    return {"status": "price_changed", "page_price": price, "final_url": final_url,
            "note": f"en la tienda ahora cuesta {price:.2f} €"}


async def verify_top(client: httpx.AsyncClient, offers: list[dict[str, Any]], top: int) -> None:
    """Verifica en paralelo las ``top`` ofertas nuevas más baratas (modifica la lista)."""
    if top <= 0:
        return
    cands = [o for o in offers if o["condition"] == "new" and not o.get("trusted")][:top]
    sem = asyncio.Semaphore(4)
    results = await asyncio.gather(*(verify_offer(client, o, sem) for o in cands))
    for o, r in zip(cands, results):
        o["verification"] = r
        if r["status"] == "out_of_stock":
            o["in_stock"] = False
        elif r["status"] == "price_changed":
            o["listed_price"] = o["price"]
            o["price"] = r["page_price"]
        if r.get("final_url") and r["status"] in ("verified", "price_changed"):
            o["url"] = r["final_url"]
    for o in offers:
        if o.get("trusted"):
            o["verification"] = {"status": "verified", "note": "ficha vigilada"}


def merge_duplicates(offers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Une la misma tienda vista por varias fuentes (se queda con la más barata y anota quién la vio)."""
    groups: dict[tuple[str, str, bool], list[dict[str, Any]]] = {}
    for o in offers:
        groups.setdefault((o["store"], o["condition"], bool(o.get("bundle"))), []).append(o)
    merged = []
    for items in groups.values():
        items.sort(key=lambda x: x["price"])
        best = dict(items[0])
        agree = {x["provider"] for x in items if abs(x["price"] - best["price"]) <= max(2.0, best["price"] * 0.03)}
        best["seen_in"] = sorted(agree)
        best["alternatives"] = len(items) - 1
        merged.append(best)
    return merged


AGGREGATOR_HOSTS = ("google.", "chollometro.", "idealo.", "serpapi.")


def shop_risk(o: dict[str, Any], ref: float | None) -> dict[str, Any] | None:
    """Detector de tiendas falsas (sin internet) para tiendas que no están en la lista."""
    url = o.get("shop_url") or o.get("url") or ""
    host = (urlparse(url).hostname or "").lower()
    if not host or any(h in host for h in AGGREGATOR_HOSTS):
        return None
    return shopcheck.quick_check(url, o.get("store_name"), o.get("price"), ref)


def assess(offers: list[dict[str, Any]], ref: float | None = None) -> None:
    """Añade 'warnings', 'suspicious' y 'confidence' (0-100) a cada oferta.

    ``ref`` es el precio oficial/de referencia del producto (para el detector de estafas).
    """
    trust = {s["id"]: s.get("trust", 3) for s in storage.load_catalog("stores")}
    seen_prices = [o["price"] for o in offers if o["condition"] == "new" and o.get("in_stock") is not False]
    median = statistics.median(seen_prices) if len(seen_prices) >= 3 else None
    for o in offers:
        w: list[str] = []
        score = 40
        v = (o.get("verification") or {}).get("status")
        if v == "verified":
            score += 30
        elif v == "price_changed":
            score += 20
            w.append((o["verification"].get("note") or "precio cambiado") + f" (el comparador decía {o.get('listed_price', 0):.2f} €)")
        elif v == "out_of_stock":
            score -= 40
            w.append("Agotado en la tienda")
        score += min(20, 10 * (len(o.get("seen_in", [])) - 1))
        risk = None
        if o["store"].startswith("x-"):
            score -= 20
            risk = shop_risk(o, ref)
            if risk and risk["verdict"] != "ok":
                o["shop_risk"] = {k: risk[k] for k in ("risk", "verdict", "label", "domain")}
                bad = [s["title"] for s in risk["signals"] if s["level"] in ("danger", "warn")][:3]
                if risk["verdict"] == "scam":
                    score -= 40
                    w.append("🚩 Posible tienda falsa: " + "; ".join(bad))
                else:
                    w.append("Tienda dudosa: " + "; ".join(bad or ["no la conocemos"]))
            else:
                w.append("Tienda que no está en tu lista: mira opiniones y condiciones antes de comprar")
        else:
            score += 2 * trust.get(o["store"], 3)
        host = (urlparse(o.get("url") or "").hostname or "").lower()
        if o.get("marketplace") or any(h in host or h in (o.get("store_name") or "").lower() for h in MARKETPLACE_HINTS):
            score -= 10
            o["marketplace"] = True
            w.append("Vendedor externo (marketplace): revisa quién vende y la garantía")
        o["suspicious"] = bool(median and o["condition"] == "new" and o["price"] < 0.75 * median)
        if risk and risk["verdict"] == "scam":
            o["suspicious"] = True
        elif o["suspicious"]:
            score -= 30
            w.append(f"Mucho más barato que el resto (mediana {median:.0f} €): puede ser un error o una estafa")
        o["warnings"] = w
        o["confidence"] = max(0, min(100, score))
