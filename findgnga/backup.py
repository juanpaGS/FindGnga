"""Copia de seguridad de tus datos (perfil, ajustes, precios, histórico, cupones)
para llevarlos a otro ordenador. data/user no se sube a git a propósito."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from . import storage

FILES = ("profile", "settings", "offers", "price_history", "promos")
FORMAT = 1


def export(include_key: bool = False) -> dict[str, Any]:
    data = {name: storage.read_user(name, None) for name in FILES}
    if data.get("settings") and not include_key:
        data["settings"] = {k: v for k, v in data["settings"].items() if k != "serpapi_key"}
    return {"app": "findgnga", "format": FORMAT, "exported_at": datetime.now().isoformat(timespec="seconds"),
            "data": {k: v for k, v in data.items() if v is not None}}


def restore(payload: dict[str, Any]) -> list[str]:
    if payload.get("app") != "findgnga" or not isinstance(payload.get("data"), dict):
        raise ValueError("No es una copia de seguridad de FindGnga")
    if payload.get("format", 0) > FORMAT:
        raise ValueError("La copia es de una versión más nueva de FindGnga: actualiza (git pull)")
    restored = []
    for name in FILES:
        if name in payload["data"]:
            value = payload["data"][name]
            if name == "settings":  # conserva la API key local si la copia no trae una
                local = storage.read_user("settings", {})
                if "serpapi_key" not in value and local.get("serpapi_key"):
                    value = {**value, "serpapi_key": local["serpapi_key"]}
            storage.write_user(name, value)
            restored.append(name)
    return restored
