"""Alternativas a SerpApi: caché de búsquedas, aviso de plan agotado y lector directo de PcComponentes."""

import asyncio
import json
from pathlib import Path

import httpx

from findgnga import storage
from findgnga.providers import pccomponentes, serpapi
from findgnga.providers.base import matcher
from findgnga.providers.engine import find_product

FIX = Path(__file__).parent / "fixtures"


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_pccomponentes_json_with_real_response():
    items = pccomponentes.parse(json.loads((FIX / "real_pccomponentes_search.json").read_text()))
    assert len(items) >= 10
    first = items[0]
    assert first["price"] == 159.99 and first["old_price"] == 199.99 and first["shipping"] == 0
    assert first["url"].startswith("https://www.pccomponentes.com/") and first["in_stock"] is True
    assert any(i["marketplace"] and "vende" in i["store_name"] for i in items)   # marketplace marcado


def test_keyboards_with_foreign_layout_are_rejected():
    product, _ = find_product("acc-logitech-mx-keys-s")
    check = matcher(product, reject_accessories=False)
    assert check("Logitech MX Keys S Teclado Inalámbrico Perfil Bajo Grafito")[0]
    assert not check("Teclado Logitech MX Keys S inalámbrico de tijera Layout US con retroiluminación")[0]
    assert not check("Logitech MX Keys S Teclado Bluetooth QWERTY Portugués Grafito")[0]


def test_serpapi_cache_saves_queries():
    calls = []

    def handler(req):
        calls.append(req)
        return httpx.Response(200, json={"shopping_results": [{"title": "PS5", "extracted_price": 499, "source": "X"}]})

    async def run():
        async with _client(handler) as c:
            a = await serpapi.search(c, "ps5 slim", "KEY1")
            b = await serpapi.search(c, "ps5 slim", "KEY2")   # misma búsqueda (la key no cuenta)
            await serpapi.search(c, "ps5 pro", "KEY1")
            return a, b
    a, b = asyncio.run(run())
    assert a == b and len(calls) == 2
    u = serpapi.usage()
    assert u["used"] == 2 and u["saved"] == 1
    assert "KEY1" not in json.dumps(storage.read_user("serpapi_cache", {}))   # la key no se guarda


def test_serpapi_quota_out_is_detected():
    def handler(req):
        return httpx.Response(429, json={"error": "Your account has run out of searches."})

    async def run():
        async with _client(handler) as c:
            try:
                await serpapi.search(c, "ps5", "K")
            except serpapi.QuotaError as e:
                return str(e)
    assert "búsquedas" in asyncio.run(run())
    assert serpapi.usage()["quota_out"]
