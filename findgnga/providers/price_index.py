"""Índice local de precios: «memoria» propia del buscador, sin depender de ninguna API.

Cada búsqueda guarda los anuncios válidos (tienda, título, precio, enlace, fecha) en
``data/user/price_index.json``. Si en la siguiente búsqueda una tienda falla, está bloqueada
o se acabó el plan de SerpApi, se recupera su último precio conocido marcado como
``from_index`` con la fecha en que se vio (nunca se presenta como precio actual).
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from .. import storage

FILE = "price_index"
MAX_PER_PRODUCT = 80
KEEP_DAYS = 21      # se borra lo más viejo
REUSE_DAYS = 10     # sólo se reutiliza lo visto en los últimos días
FIELDS = ("provider", "title", "price", "url", "store_id", "store_name", "condition", "shipping", "marketplace", "gtin")


def _now() -> datetime:
    return datetime.now()


def remember(product_id: str, accepted: list[dict[str, Any]]) -> int:
    """Guarda los anuncios aceptados (frescos, no de referencia ni del propio índice)."""
    fresh = [a for a in accepted if not a.get("from_index") and not a.get("reference") and a.get("url")]
    if not fresh:
        return 0
    idx = storage.read_user(FILE, {})
    rows = {r["url"]: r for r in idx.get(product_id, [])}
    stamp = _now().isoformat(timespec="seconds")
    for a in fresh:
        rows[a["url"]] = {**{k: a.get(k) for k in FIELDS}, "store_id": a.get("store_id") or a.get("store"), "seen_at": stamp}
    limit = (_now() - timedelta(days=KEEP_DAYS)).isoformat()
    kept = sorted((r for r in rows.values() if r.get("seen_at", "") >= limit), key=lambda r: r["seen_at"], reverse=True)
    idx[product_id] = kept[:MAX_PER_PRODUCT]
    storage.write_user(FILE, idx)
    return len(fresh)


def recall(product_id: str, skip_stores: set[str] | None = None,
           failed_sources: set[str] | None = None) -> list[dict[str, Any]]:
    """Últimos precios conocidos que hoy no se han podido ver.

    Sólo se recuperan anuncios cuya fuente ha fallado o se ha saltado hoy (``failed_sources``): si la fuente
    funcionó y el anuncio ya no sale, es que se agotó o lo retiraron, y no se resucita.
    ``skip_stores`` = tiendas que sí tienen precio fresco."""
    limit = (_now() - timedelta(days=REUSE_DAYS)).isoformat()
    out = []
    for r in storage.read_user(FILE, {}).get(product_id, []):
        if r.get("seen_at", "") < limit or (skip_stores and r.get("store_id") in skip_stores):
            continue
        if failed_sources is not None and r.get("provider") not in failed_sources:
            continue
        out.append({**{k: v for k, v in r.items() if v is not None}, "from_index": True, "direct": True})
    return out


def stats() -> dict[str, Any]:
    idx = storage.read_user(FILE, {})
    rows = [r for v in idx.values() for r in v]
    return {"products": len(idx), "listings": len(rows), "latest": max((r["seen_at"] for r in rows), default=None)}
