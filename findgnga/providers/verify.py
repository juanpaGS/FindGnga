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
import re
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


REMOVED_RE = re.compile(r"ya no est[aá] disponible|producto no disponible|art[ií]culo no disponible|no se ha encontrado|"
                        r"no hemos encontrado|p[aá]gina no encontrada|este anuncio ya no|ha sido vendido|art[ií]culo vendido|"
                        r"descatalogado|page not found", re.I)
# Agotado aunque la página no lo diga en sus datos estructurados (Magento "stock unavailable",
# WooCommerce "stock out-of-stock", botón "Avísame cuando/disponibilidad"). "Avísame bajada de precio" no cuenta.
OUT_OF_STOCK_RE = re.compile(r'class="[^"]*\bstock (?:unavailable|out-of-stock)\b|>\s*(?:no est[aá] disponible|temporalmente agotado|'
                             r'sin stock|fuera de stock)\s*<|av[ií]same (?:cuando|disponibilidad|si vuelve|cuando est[eé])', re.I)
HOME_PATHS = {"", "es", "es-es", "es_es", "home", "index.html", "es/home", "inicio"}


def is_homepage_redirect(original: str, final: str) -> bool:
    """La tienda redirige una ficha que ya no existe a su portada (típico de Carrefour, MediaMarkt…)."""
    op = urlparse(original).path.strip("/").lower()
    fp = urlparse(final).path.strip("/").lower()
    return len(op) > 3 and fp in HOME_PATHS


async def verify_offer(client: httpx.AsyncClient, o: dict[str, Any], sem: asyncio.Semaphore) -> dict[str, Any]:
    url = _verify_url(o)
    if not url:
        return {"status": "unverifiable", "note": "el enlace es de Google, no de la tienda"}
    async with sem:
        try:
            resp = await client.get(url, timeout=10, follow_redirects=True)
        except Exception as exc:
            return {"status": "unverifiable", "note": type(exc).__name__}
    final_url = str(resp.url)
    if resp.status_code in (404, 410):
        return {"status": "gone", "note": f"el enlace ya no existe (la tienda responde {resp.status_code})"}
    if resp.status_code >= 400:
        return {"status": "unverifiable", "note": f"la tienda respondió {resp.status_code}"}
    if is_homepage_redirect(url, final_url):
        return {"status": "gone", "note": "la tienda redirige a su portada: la oferta ya no existe"}
    res = _read_page(o, resp.text, final_url)
    if str(o.get("store", "")).startswith("x-"):
        # Tienda desconocida: ya tenemos su página, así que se analiza con el detector de tiendas falsas
        res["shop_signals"] = (shopcheck.text_signals(shopcheck.html_to_text(resp.text), o.get("store_name"), full_page=True)
                               + shopcheck.page_signals(resp.text, final_url))
    return res


def _read_page(o: dict[str, Any], page: str, final_url: str) -> dict[str, Any]:
    data = live.extract_price(page)
    if data.get("in_stock") is None and OUT_OF_STOCK_RE.search(page[:400_000]):
        data["in_stock"] = False
    if data.get("in_stock") is False:
        return {"status": "out_of_stock", "note": "agotado en la tienda", "final_url": final_url}
    price = data.get("price")
    if not price:
        if REMOVED_RE.search(page[:300_000]):
            return {"status": "gone", "note": "la página dice que el producto ya no está disponible"}
        return {"status": "unverifiable", "note": "la página no publica el precio", "final_url": final_url}
    if abs(price - o["price"]) <= max(1.0, o["price"] * 0.02):
        return {"status": "verified", "page_price": price, "final_url": final_url}
    return {"status": "price_changed", "page_price": price, "final_url": final_url,
            "note": f"en la tienda ahora cuesta {price:.2f} €"}


async def verify_top(client: httpx.AsyncClient, offers: list[dict[str, Any]], top: int) -> None:
    """Abre la ficha de las ``top`` ofertas nuevas más baratas y comprueba precio, stock y enlace.

    Si en esa tanda ninguna queda confirmada (todas caducadas, agotadas o sin datos), revisa otra
    tanda igual, para intentar dar siempre al menos un precio comprobado con enlace para comprar.
    """
    if top <= 0:
        return
    pending = [o for o in offers if o["condition"] == "new" and not o.get("trusted") and o.get("in_stock") is not False]
    sem = asyncio.Semaphore(4)
    for _ in range(2):
        batch, pending = pending[:top], pending[top:]
        if not batch:
            break
        results = await asyncio.gather(*(verify_offer(client, o, sem) for o in batch))
        for o, r in zip(batch, results):
            o["verification"] = r
            if r["status"] in ("out_of_stock", "gone"):
                o["in_stock"] = False
                o["dead_link"] = r["status"] == "gone"
            elif r["status"] == "price_changed":
                o["listed_price"] = o["price"]
                o["price"] = r["page_price"]
            if r.get("final_url") and r["status"] in ("verified", "price_changed"):
                o["url"] = r["final_url"]
        # Basta con una tienda conocida confirmada: una desconocida "confirmada" puede ser una tienda falsa
        if any(r["status"] in ("verified", "price_changed") and not str(o.get("store", "")).startswith("x-")
               for o, r in zip(batch, results)):
            break
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
    """Detector de tiendas falsas (sin internet) para tiendas que no están en la lista.

    Usa la dirección, el precio y, si se verificó la oferta, lo que se vio en su página.
    Con un enlace de Google (no sabemos el dominio de la tienda) sólo se juzga el precio.
    """
    url = o.get("shop_url") or o.get("url") or ""
    host = (urlparse(url).hostname or "").lower()
    if not host or any(h in host for h in AGGREGATOR_HOSTS):
        sig = shopcheck.price_signals(o.get("price"), ref)
        if not any(s["level"] in ("danger", "warn") for s in sig):
            return None
        sig.append(shopcheck._sig("unknown_store", "info", 15, "Tienda que FindGnga no conoce",
                                  "El enlace es de Google: no se ha podido ver la web de la tienda."))
        return {**shopcheck.verdict(sig), "domain": None}
    return shopcheck.quick_check(url, o.get("store_name"), o.get("price"), ref,
                                 extra=(o.get("verification") or {}).get("shop_signals"))


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
        elif v == "gone":
            score -= 50
            w.append("Enlace caducado: " + (o["verification"].get("note") or "la oferta ya no existe"))
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
        strong = risk and any(x["level"] == "danger" or x["id"] in ("price_low", "price_too_low") for x in risk["signals"])
        if risk and (risk["verdict"] == "scam" or (risk["verdict"] == "doubtful" and strong)):
            o["suspicious"] = True
        elif o["suspicious"]:
            score -= 30
            w.append(f"Mucho más barato que el resto (mediana {median:.0f} €): puede ser un error o una estafa")
        o["warnings"] = w
        o["confidence"] = max(0, min(100, score))
