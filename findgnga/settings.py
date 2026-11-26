"""Ajustes del usuario (data/user/settings.json)."""

from __future__ import annotations

import os
from typing import Any

from . import storage

DEFAULTS: dict[str, Any] = {
    "serpapi_key": "",
    "providers": {"serpapi": True, "serpapi_amazon": True, "serpapi_ebay": False, "serpapi_idealo": True,
                  "chollometro": True,
                  "idealo": True, "stores": True, "watched": True},
    "verify_top": 6,  # ofertas más baratas que se comprueban en la propia tienda (0 = no verificar)
    "resolve_links": 3,  # productos de Google Shopping cuya ficha se abre para tener el enlace directo (1 búsqueda c/u)
    "max_offer_age_days": 3,
    "include_used": False,
    "targets": {},  # product_id -> precio objetivo (alerta)
}


def get() -> dict[str, Any]:
    data = storage.read_user("settings", {})
    out = {**DEFAULTS, **data, "providers": {**DEFAULTS["providers"], **data.get("providers", {})}}
    if not out["serpapi_key"] and os.environ.get("SERPAPI_KEY"):
        out["serpapi_key"] = os.environ["SERPAPI_KEY"]
    return out


def update(changes: dict[str, Any]) -> dict[str, Any]:
    current = storage.read_user("settings", {})
    current.update({k: v for k, v in changes.items() if k in DEFAULTS})
    storage.write_user("settings", current)
    return get()


def public(s: dict[str, Any]) -> dict[str, Any]:
    key = s.get("serpapi_key") or ""
    return {**s, "serpapi_key": "", "serpapi_key_set": bool(key),
            "serpapi_key_hint": ("…" + key[-4:]) if len(key) > 8 else ""}
