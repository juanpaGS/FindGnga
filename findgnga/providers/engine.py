"""Orquestador de la búsqueda automática de precios.

Para un producto lanza en paralelo todas las fuentes activas, se queda sólo con
los resultados que son *ese* producto (modelo correcto, sin accesorios, precio
razonable), calcula el precio final (envío + cupón) y guarda la mejor oferta de
cada tienda con su enlace directo. Las ofertas automáticas anteriores se
reemplazan, así lo agotado o lo que ha subido desaparece solo.
"""

from __future__ import annotations

import asyncio
import re
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from .. import settings as settings_mod
from .. import storage
from ..pricing import live
from ..pricing.core import price_offer
from . import chollometro, idealo, serpapi, stores, verify
from .base import condition_of, is_bundle, matcher, new_client, price_band, resolve_store

PROVIDERS = [
    {"id": "serpapi", "name": "Google Shopping (SerpApi)", "needs_key": True, "beta": False,
     "desc": "Precios de casi todas las tiendas españolas con enlace. La fuente más fiable; requiere API key gratuita."},
    {"id": "serpapi_amazon", "name": "Amazon.es (SerpApi)", "needs_key": True, "beta": False,
     "desc": "Resultados de Amazon.es con la misma API key (gasta una búsqueda más del plan)."},
    {"id": "serpapi_ebay", "name": "eBay.es (SerpApi)", "needs_key": True, "beta": False,
     "desc": "eBay España: mucho vendedor particular/reacondicionado. Misma API key."},
    {"id": "chollometro", "name": "Chollometro", "needs_key": False, "beta": True,
     "desc": "Chollos de la comunidad (incluye códigos promocionales)."},
    {"id": "idealo", "name": "Idealo", "needs_key": False, "beta": True,
     "desc": "Comparador de precios. Puede bloquear peticiones automáticas."},
    {"id": "stores", "name": "Tiendas directamente", "needs_key": False, "beta": True,
     "desc": "Busca en Amazon, PcComponentes, MediaMarkt… leyendo sus datos estructurados."},
    {"id": "watched", "name": "URLs vigiladas", "needs_key": False, "beta": False,
     "desc": "Vuelve a comprobar las fichas de producto que guardaste."},
]

CACHE_SECONDS = 20 * 60
_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def find_product(product_id: str) -> tuple[dict[str, Any], str] | None:
    for name, cat in (("monitors", "monitor"), ("consoles", "console")):
        for p in storage.load_catalog(name):
            if p["id"] == product_id:
                return p, cat
    return None


def _snapshot_hook(folder: Path):
    folder.mkdir(parents=True, exist_ok=True)

    async def hook(resp: httpx.Response) -> None:
        await resp.aread()
        name = re.sub(r"[^a-zA-Z0-9]+", "_", f"{resp.url.host}{resp.url.path}")[:80]
        (folder / f"{name}_{resp.status_code}.html").write_text(resp.text, encoding="utf-8", errors="ignore")
    return hook


async def _run_watched(client: httpx.AsyncClient, product_id: str) -> list[dict[str, Any]]:
    offers = [o for o in storage.read_user("offers", [])
              if o["product_id"] == product_id and o.get("url") and not str(o.get("source", "")).startswith("auto")]
    out = []
    for o in offers:
        try:
            resp = await client.get(o["url"])
            resp.raise_for_status()
            data = live.extract_price(resp.text)
        except Exception:
            continue
        if data.get("price"):
            out.append({"title": data.get("title") or "", "price": data["price"], "url": o["url"],
                        "store_id": o["store"], "in_stock": data.get("in_stock"), "trusted": True,
                        "shipping": o.get("shipping")})
    return out


async def _timed(name: str, coro) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    t0 = time.perf_counter()
    try:
        res = await coro
        extra = {}
        if isinstance(res, tuple):  # stores devuelve (items, estado por tienda)
            res, extra = res
        if extra and all(not str(v).endswith("resultados") for v in extra.values()):
            return name, res, {"ok": False, "raw": 0, "detail": extra, "error": "ninguna tienda respondió",
                               "ms": round((time.perf_counter() - t0) * 1000)}
        return name, res, {"ok": True, "raw": len(res), "detail": extra,
                           "ms": round((time.perf_counter() - t0) * 1000)}
    except Exception as exc:
        return name, [], {"ok": False, "raw": 0, "error": f"{type(exc).__name__}: {exc}",
                          "ms": round((time.perf_counter() - t0) * 1000)}


async def collect(product: dict[str, Any], cfg: dict[str, Any], snapshot_dir: Path | None = None,
                  only: list[str] | None = None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Lanza las fuentes y devuelve (listados en bruto con 'provider', estado por fuente)."""
    query = product["search_query"]
    enabled = {k for k, v in cfg["providers"].items() if v}
    if only:
        enabled &= set(only)
    hooks = {"response": [_snapshot_hook(snapshot_dir)]} if snapshot_dir else None
    status: dict[str, Any] = {}
    async with new_client() as client:
        if hooks:
            client.event_hooks = hooks
        tasks = []
        if "serpapi" in enabled and cfg.get("serpapi_key"):
            tasks.append(_timed("serpapi", serpapi.search(client, query, cfg["serpapi_key"])))
        for pid, fn in (("serpapi_amazon", serpapi.search_amazon), ("serpapi_ebay", serpapi.search_ebay)):
            if pid in enabled and cfg.get("serpapi_key"):
                tasks.append(_timed(pid, fn(client, query, cfg["serpapi_key"])))
        if not cfg.get("serpapi_key"):
            for pid in ("serpapi", "serpapi_amazon", "serpapi_ebay"):
                if pid in enabled:
                    status[pid] = {"ok": False, "raw": 0, "error": "Falta la API key (Ajustes)", "skipped": True}
        if "chollometro" in enabled:
            tasks.append(_timed("chollometro", chollometro.search(client, query)))
        if "idealo" in enabled:
            tasks.append(_timed("idealo", idealo.search(client, query)))
        if "stores" in enabled:
            tasks.append(_timed("stores", stores.search(client, query)))
        if "watched" in enabled:
            tasks.append(_timed("watched", _run_watched(client, product["id"])))
        results = await asyncio.gather(*tasks)
    listings = []
    for name, items, st in results:
        status[name] = st
        for it in items:
            listings.append({**it, "provider": name})
    return listings, status


def filter_listings(product: dict[str, Any], category: str, listings: list[dict[str, Any]],
                    status: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    check = matcher(product, reject_accessories=category == "monitor")
    lo, hi = price_band(product, category)
    accepted, rejected = [], []
    for it in listings:
        reason = ""
        if not it.get("price") or not it.get("url"):
            reason = "sin precio o enlace"
        elif not it.get("trusted"):
            ok, why = check(it.get("title", ""))
            if not ok:
                reason = why
            elif not lo <= it["price"] <= hi:
                reason = f"precio fuera de lo razonable ({it['price']:.0f} €)"
        if reason:
            rejected.append({**it, "reason": reason})
            continue
        sid = it.get("store_id")
        name = it.get("store_name")
        if not sid:
            sid, name = resolve_store(it.get("store_name"), it.get("url"))
        accepted.append({**it, "store": sid, "store_name": name or sid,
                         "bundle": category == "console" and is_bundle(it.get("title", "")),
                         "condition": it.get("condition") or condition_of(it.get("title", ""))})
    for name, st in status.items():
        st["accepted"] = sum(1 for a in accepted if a["provider"] == name)
    return accepted, rejected


def _price_all(product: dict[str, Any], category: str, accepted: list[dict[str, Any]]) -> list[dict[str, Any]]:
    from ..search import stores_by_id, user_promos
    prod = {**product, "category": category}
    sb, promos = stores_by_id(), user_promos()
    priced = [price_offer({**a, "product_id": product["id"]}, prod, sb, promos) for a in accepted]
    priced.sort(key=sort_key)
    return priced


def sort_key(o: dict[str, Any]) -> tuple:
    return (o.get("in_stock") is False, o["condition"] == "used", bool(o.get("suspicious")), o["final_price"])


def save(product_id: str, priced: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Guarda la mejor oferta por tienda (nueva) y reemplaza las automáticas anteriores."""
    now = datetime.now().isoformat(timespec="seconds")
    best: dict[tuple[str, str], dict[str, Any]] = {}
    for o in priced:
        key = (o["store"], o["condition"])
        if key not in best or o["final_price"] < best[key]["final_price"]:
            best[key] = o
    offers = storage.read_user("offers", [])
    watched_urls = {o["url"] for o in priced if o.get("trusted")}
    kept = []
    for o in offers:
        if o["product_id"] != product_id:
            kept.append(o)
        elif str(o.get("source", "")).startswith("auto"):
            continue  # se sustituyen por los resultados nuevos
        elif o.get("url") in watched_urls:
            fresh = next(p for p in priced if p.get("url") == o["url"])
            kept.append({**o, "price": fresh["price"], "in_stock": fresh.get("in_stock") is not False,
                         "checked_at": now, "source": "live"})
        else:
            kept.append(o)
    new = []
    for o in best.values():
        if o.get("trusted"):
            continue
        new.append({"id": uuid.uuid4().hex[:8], "product_id": product_id, "store": o["store"],
                    "store_name": o["store_name"], "price": o["price"], "shipping": o.get("shipping"),
                    "url": o["url"], "in_stock": o.get("in_stock") is not False, "condition": o["condition"],
                    "title": o.get("title"), "code": o.get("code"), "deal_url": o.get("deal_url"),
                    "source": f"auto:{o['provider']}", "checked_at": now,
                    "verified": (o.get("verification") or {}).get("status"), "confidence": o.get("confidence"),
                    "warnings": o.get("warnings", []), "seen_in": o.get("seen_in", []),
                    "suspicious": o.get("suspicious", False), "bundle": o.get("bundle", False)})
    storage.write_user("offers", kept + new)
    hist = storage.read_user("price_history", [])
    for o in best.values():
        if o["condition"] == "new" and o.get("in_stock") is not False:
            hist.append({"product_id": product_id, "store": o["store"], "price": o["price"], "date": now})
    storage.write_user("price_history", hist[-5000:])
    return new


async def live_search(product_id: str, force: bool = False, dry_run: bool = False,
                      snapshot_dir: Path | None = None, only: list[str] | None = None) -> dict[str, Any]:
    found = find_product(product_id)
    if not found:
        raise KeyError(product_id)
    product, category = found
    cached = _cache.get(product_id)
    if cached and not force and not dry_run and time.time() - cached[0] < CACHE_SECONDS:
        return {**cached[1], "cached": True}
    cfg = settings_mod.get()
    listings, status = await collect(product, cfg, snapshot_dir, only)
    accepted, rejected = filter_listings(product, category, listings, status)
    merged = verify.merge_duplicates(accepted)
    merged.sort(key=lambda o: (o["condition"] == "used", o["price"]))
    if cfg.get("verify_top", 0) > 0 and merged:
        async with new_client(timeout=12) as client:
            await verify.verify_top(client, merged, int(cfg["verify_top"]))
    priced = _price_all(product, category, merged)
    verify.assess(priced)
    priced.sort(key=sort_key)
    if not dry_run:
        save(product_id, priced)
    target = cfg.get("targets", {}).get(product_id)
    new_ok = [o for o in priced if o["condition"] == "new" and o.get("in_stock") is not False]
    best_new = next((o for o in new_ok if not o["suspicious"]), None)
    cheapest = min(new_ok, key=lambda o: o["final_price"], default=None)
    ok_sources = [k for k, v in status.items() if v.get("ok")]
    coverage = {
        "sources_ok": len(ok_sources), "sources_total": len(status),
        "sources": ok_sources,
        "stores": len({o["store"] for o in new_ok}),
        "verified": sum(1 for o in priced if (o.get("verification") or {}).get("status") == "verified"),
        "level": "alta" if len(ok_sources) >= 3 and len(new_ok) >= 4 else "media" if new_ok and len(ok_sources) >= 2 else "baja",
    }
    result = {
        "coverage": coverage,
        "cheapest_suspicious": cheapest if cheapest and cheapest is not best_new and cheapest["suspicious"] else None,
        "product_id": product_id, "query": product["search_query"],
        "searched_at": datetime.now().isoformat(timespec="seconds"),
        "listings": priced, "rejected": rejected[:40], "rejected_count": len(rejected),
        "providers": status, "best": best_new,
        "alert": bool(target and best_new and best_new["final_price"] <= float(target)),
        "target": target, "cached": False,
    }
    if not dry_run:
        _cache[product_id] = (time.time(), result)
    return result

