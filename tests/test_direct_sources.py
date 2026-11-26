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


def test_inflated_prices_are_shown_and_tvs_are_not_consoles():
    from findgnga.providers.engine import filter_listings
    product, cat = find_product("ps5-slim-digital")
    ref = float(product.get("msrp") or product["ref_price"])
    rows = [{"title": "Consola PS5 Slim Digital Edition", "price": round(ref * 2, 2), "url": "https://www.mediamarkt.es/p1",
             "store_id": "mediamarkt", "store_name": "MediaMarkt"},
            {"title": "TV LG QNED 55 pulgadas 4K compatible PS5 Slim Digital", "price": round(ref * 2, 2), "url": "https://x.es/tv",
             "store_id": "pccomponentes", "store_name": "PcComponentes"},
            {"title": "Consola PS5 Slim Digital Edition", "price": ref * 5, "url": "https://x.es/caro"}]
    acc, rej = filter_listings(product, cat, rows, {})
    assert len(acc) == 1 and acc[0]["inflated"] >= 1.9
    assert {r["reason"].split(" (")[0] for r in rej} == {"no es una consola", "precio fuera de lo razonable"}
