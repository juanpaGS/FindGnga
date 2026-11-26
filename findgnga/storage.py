"""Persistencia en ficheros JSON.

- ``data/*.json``: catálogo semilla (versionado en git).
- ``data/user/*.json``: datos del usuario (perfil, precios comprobados, cupones),
  ignorados por git. Se puede cambiar la carpeta con ``FINDGNGA_USER_DIR``.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"


def user_dir() -> Path:
    path = Path(os.environ.get("FINDGNGA_USER_DIR", DATA_DIR / "user"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def load_catalog(name: str) -> list[dict[str, Any]]:
    """Lee la lista ``items`` de un fichero del catálogo (monitors, consoles, stores...)."""
    with open(DATA_DIR / f"{name}.json", encoding="utf-8") as fh:
        return json.load(fh)["items"]


def load_catalog_raw(name: str) -> dict[str, Any]:
    with open(DATA_DIR / f"{name}.json", encoding="utf-8") as fh:
        return json.load(fh)


def read_user(name: str, default: Any) -> Any:
    path = user_dir() / f"{name}.json"
    if not path.exists():
        return default
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return default


def write_user(name: str, value: Any) -> None:
    """Escritura atómica: se escribe en un temporal y se renombra."""
    target = user_dir() / f"{name}.json"
    fd, tmp = tempfile.mkstemp(dir=target.parent, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(value, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, target)
