"""Línea de comandos.

    python -m findgnga.cli refresh            # busca precios de PS5 + tus monitores top y avisa de alertas
    python -m findgnga.cli refresh ps5-pro    # sólo esos productos
    python -m findgnga.cli diagnose           # prueba cada fuente y guarda el HTML en data/user/snapshots

Para tenerlo vigilado, prográmalo (p. ej. con cron cada 6 h):
    0 */6 * * * cd /ruta/FindGnga && .venv/bin/python -m findgnga.cli refresh >> data/user/refresh.log 2>&1
"""

from __future__ import annotations

import asyncio
import sys

from . import search, storage
from .providers import engine


def _default_products() -> list[str]:
    ids = [c["id"] for c in storage.load_catalog("consoles")]
    profile = storage.read_user("profile", {"devices": []})
    ranked = search.search_monitors(profile)
    ids += [it["product"]["id"] for it in ranked["results"][:5]]
    return ids


def _eur(x: float | None) -> str:
    return "—" if x is None else f"{x:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


async def refresh(ids: list[str]) -> int:
    alerts = 0
    for pid in ids:
        r = await engine.live_search(pid, force=True)
        best = r["best"]
        ok = [f"{k}:{v.get('accepted', 0)}" for k, v in r["providers"].items() if v.get("ok")]
        line = f"{pid:28} " + (f"{_eur(best['final_price'])} en {best['store_name']}  {best['url']}" if best else "sin resultados")
        print(line + f"   [{', '.join(ok) or 'ninguna fuente respondió'}]")
        if r["alert"]:
            alerts += 1
            print(f"   🔔 ALERTA: por debajo de tu objetivo ({_eur(r['target'])})")
    return alerts


async def diagnose(pid: str) -> None:
    folder = storage.user_dir() / "snapshots"
    r = await engine.live_search(pid, dry_run=True, snapshot_dir=folder)
    print(f"Diagnóstico para «{r['query']}»\n")
    for name, st in r["providers"].items():
        if st.get("ok"):
            print(f"  ✅ {name:12} {st['raw']:3} resultados en bruto, {st.get('accepted', 0)} válidos ({st['ms']} ms)")
            for store, detail in (st.get("detail") or {}).items():
                print(f"       · {store}: {detail}")
        else:
            print(f"  ❌ {name:12} {st.get('error')}")
    print(f"\nVálidos: {len(r['listings'])} · descartados: {r['rejected_count']}")
    for o in r["listings"][:10]:
        print(f"  {_eur(o['final_price']):>12}  {o['store_name']:20} {o['title'][:60]}")
    print(f"\nHTML guardado en {folder} (compártelo si quieres afinar un lector).")


def main(argv: list[str]) -> None:
    cmd = argv[0] if argv else "refresh"
    if cmd == "refresh":
        asyncio.run(refresh(argv[1:] or _default_products()))
    elif cmd == "diagnose":
        asyncio.run(diagnose(argv[1] if len(argv) > 1 else "ps5-slim-digital"))
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
