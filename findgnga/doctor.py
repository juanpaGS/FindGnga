"""Comprobación de la instalación: ¿funcionará FindGnga en este ordenador?

Revisa versión de Python, dependencias, carpeta de datos, catálogo, conexión a
cada fuente y la API key de SerpApi, y dice qué hacer si algo falla.
"""

from __future__ import annotations

import asyncio
import importlib
import json
import platform
import sys
from typing import Any

from . import settings as settings_mod
from . import storage

MIN_PY = (3, 10)
HOSTS = {
    "Google Shopping / Amazon / eBay (SerpApi)": "https://serpapi.com/",
    "Chollometro": "https://www.chollometro.com/",
    "Idealo": "https://www.idealo.es/",
    "Amazon.es": "https://www.amazon.es/",
    "PcComponentes": "https://www.pccomponentes.com/",
    "MediaMarkt": "https://www.mediamarkt.es/",
    "El Corte Inglés": "https://www.elcorteingles.es/",
    "RDAP (antigüedad de dominios, detector de estafas)": "https://rdap.org/",
}


def _check(name: str, ok: bool, detail: str, fix: str = "", level: str | None = None) -> dict[str, Any]:
    return {"name": name, "status": level or ("ok" if ok else "error"), "detail": detail, "fix": "" if ok else fix}


def local_checks() -> list[dict[str, Any]]:
    out = []
    v = sys.version_info
    out.append(_check("Python", v >= MIN_PY, f"{platform.python_version()} ({platform.system()} {platform.machine()})",
                      f"Instala Python {MIN_PY[0]}.{MIN_PY[1]} o superior desde python.org"))
    missing = []
    for mod in ("fastapi", "uvicorn", "httpx", "pydantic"):
        try:
            importlib.import_module(mod)
        except ImportError:
            missing.append(mod)
    out.append(_check("Dependencias", not missing, "todas instaladas" if not missing else "faltan: " + ", ".join(missing),
                      "Ejecuta ./run.sh (o run.bat en Windows), que las instala solo"))
    try:
        probe = storage.user_dir() / ".write_test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        out.append(_check("Carpeta de datos", True, str(storage.user_dir())))
    except OSError as exc:
        out.append(_check("Carpeta de datos", False, str(exc), "Revisa permisos o define FINDGNGA_USER_DIR"))
    bad = []
    for name in ("monitors", "consoles", "accessories", "stores", "promos", "events"):
        try:
            storage.load_catalog_raw(name)
        except (OSError, json.JSONDecodeError) as exc:
            bad.append(f"{name}: {exc}")
    out.append(_check("Catálogo (data/*.json)", not bad, "correcto" if not bad else "; ".join(bad),
                      "Restaura el fichero con git checkout data/"))
    profile = storage.read_user("profile", None)
    out.append(_check("Perfil", True, "guardado" if profile and profile.get("devices") else
                      "aún no has hecho la encuesta (normal en un ordenador nuevo; o importa tu copia de seguridad)",
                      level="ok" if profile and profile.get("devices") else "warn"))
    return out


async def network_checks() -> list[dict[str, Any]]:
    from .providers import serpapi
    from .providers.base import new_client

    out = []
    async with new_client(timeout=8) as client:
        async def probe(name: str, url: str) -> dict[str, Any]:
            try:
                r = await client.get(url)
                if r.status_code in (403, 429, 503):
                    return _check(name, False, f"responde {r.status_code}: bloquea peticiones automáticas",
                                  "Normal en algunas tiendas: usa SerpApi para cubrirlas", level="warn")
                return _check(name, True, f"accesible (HTTP {r.status_code})")
            except Exception as exc:
                return _check(name, False, f"sin conexión ({type(exc).__name__})",
                              "Comprueba internet, VPN, proxy o firewall")
        out += await asyncio.gather(*(probe(n, u) for n, u in HOSTS.items()))

        key = settings_mod.get().get("serpapi_key")
        if not key:
            out.append(_check("API key SerpApi", False, "no configurada",
                              "Crea una cuenta gratis en serpapi.com y pégala en Ajustes", level="warn"))
        else:
            try:
                acc = await serpapi.account(client, key)
                left = acc.get("total_searches_left", acc.get("plan_searches_left"))
                out.append(_check("API key SerpApi", True,
                                  f"válida · plan {acc.get('plan_name', '?')} · búsquedas restantes: {left if left is not None else '?'}"))
            except Exception as exc:
                out.append(_check("API key SerpApi", False, f"{type(exc).__name__}: {exc}",
                                  "Revisa la key en Ajustes"))
    return out


async def run(network: bool = True) -> dict[str, Any]:
    checks = local_checks() + (await network_checks() if network else [])
    errors = sum(c["status"] == "error" for c in checks)
    warns = sum(c["status"] == "warn" for c in checks)
    return {"checks": checks, "errors": errors, "warnings": warns,
            "summary": "Todo listo" if not errors and not warns else
                       f"{errors} error(es) y {warns} aviso(s)"}
