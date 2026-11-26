import asyncio
from pathlib import Path

from findgnga import storage
from findgnga.providers import chollometro, engine, serpapi
from findgnga.providers.base import is_bundle, matcher, parse_shipping, resolve_store
from findgnga.providers.extract import extract_listings

FIX = Path(__file__).parent / "fixtures"


def product(pid):
    return engine.find_product(pid)[0]


def test_generic_extractor_reads_jsonld_and_next_data():
    items = extract_listings((FIX / "store_search.html").read_text(), "https://tienda.example/buscar")
    titles = {i["title"]: i for i in items}
    assert titles["Sony PlayStation 5 Slim Digital Edition 1TB"]["price"] == 449.0
    assert titles["Sony PlayStation 5 Slim Digital Edition 1TB"]["url"] == "https://tienda.example/sony-ps5-slim-digital"
    assert titles["PlayStation 5 Pro 2TB"]["price"] == 879.0
    assert titles["Sony PS5 Slim Standard con lector + EA FC 26"]["in_stock"] is False


def test_matchers_distinguish_ps5_versions():
    dig = matcher(product("ps5-slim-digital"), reject_accessories=False)
    std = matcher(product("ps5-slim-standard"), reject_accessories=False)
    pro = matcher(product("ps5-pro"), reject_accessories=False)
    assert dig("Sony PlayStation®5 Slim Edición Digital")[0]
    assert not dig("PS5 Pro Digital 2TB")[0]
    assert std("Consola PS5 Slim con lector Chasis D")[0]
    assert not std("PS5 Slim Digital")[0]
    assert pro("Sony PlayStation 5 Pro 2TB")[0] and not pro("PS5 Slim")[0]


def test_monitor_matcher_uses_model_code_and_rejects_accessories():
    m = matcher(product("lg-27up850n"))
    assert m("Monitor LG 27UP850N-W 27\" 4K IPS USB-C")[0]
    assert not m("LG 27UP650-W 4K")[0]
    assert not m("Soporte brazo para LG 27UP850N")[0]


def test_bundle_and_shipping_helpers():
    assert is_bundle("PS5 Slim + 2 mandos") and not is_bundle("PS5 Slim con lector")
    assert parse_shipping("Envío gratis") == 0 and parse_shipping("+4,99 € de envío") == 4.99
    assert parse_shipping("Llega mañana") is None


def test_resolve_store_by_name_and_domain():
    assert resolve_store("PcComponentes.com")[0] == "pccomponentes"
    assert resolve_store(None, "https://www.amazon.es/dp/B0X")[0] == "amazon"
    assert resolve_store("Tienda Rara SL")[0].startswith("x-")


def test_serpapi_parse():
    data = {"shopping_results": [
        {"title": "PS5 Slim Digital", "extracted_price": 449.0, "source": "MediaMarkt",
         "link": "https://www.mediamarkt.es/p/1", "delivery": "Envío gratis"},
        {"title": "PS5 Slim Digital", "extracted_price": 380.0, "source": "Back Market",
         "product_link": "https://google/x", "second_hand_condition": "usado"},
        {"title": "sin precio"}]}
    items = serpapi.parse(data)
    assert len(items) == 2 and items[0]["shipping"] == 0 and items[1]["condition"] == "used"


def test_chollometro_parse_skips_expired_and_free():
    items = chollometro.parse_search((FIX / "chollometro_search.html").read_text())
    assert len(items) == 1
    it = items[0]
    assert it["price"] == 429.99 and it["store_name"] == "MediaMarkt" and it["code"] == "BLACKPS5"
    assert it["shipping"] == 0.0


def test_live_search_filters_prices_and_saves(monkeypatch):
    raw = [
        {"provider": "serpapi", "title": "Sony PS5 Slim Digital 1TB", "price": 449.0,
         "url": "https://www.mediamarkt.es/p/1", "store_name": "MediaMarkt", "shipping": 0.0},
        {"provider": "serpapi", "title": "PS5 Slim Digital", "price": 459.0,
         "url": "https://www.amazon.es/dp/1", "store_name": "Amazon.es"},
        {"provider": "stores", "title": "Mando DualSense PS5 Digital edición", "price": 59.0,
         "url": "https://x/y", "store_name": "Fnac"},
        {"provider": "serpapi", "title": "PS5 Pro Digital", "price": 849.0, "url": "https://z", "store_name": "Fnac"},
        {"provider": "serpapi", "title": "PS5 Slim Digital reacondicionada", "price": 360.0,
         "url": "https://www.worten.es/r", "store_name": "Worten"},
    ]

    async def fake_collect(product, cfg, snapshot_dir=None, only=None):
        return [dict(r) for r in raw], {"serpapi": {"ok": True, "raw": 4}, "stores": {"ok": True, "raw": 1}}

    monkeypatch.setattr(engine, "collect", fake_collect)
    r = asyncio.run(engine.live_search("ps5-slim-digital", force=True))
    assert r["best"]["store"] == "mediamarkt" and r["best"]["final_price"] == 449.0
    assert r["rejected_count"] == 2
    used = [o for o in r["listings"] if o["condition"] == "used"]
    assert used and used[0]["store"] == "worten"
    offers = storage.read_user("offers", [])
    assert {o["store"] for o in offers} == {"mediamarkt", "amazon", "worten"}
    assert all(o["source"] == "auto:serpapi" for o in offers)
    # Una segunda búsqueda sin Amazon hace desaparecer la oferta de Amazon (agotada / retirada)
    raw.pop(1)
    asyncio.run(engine.live_search("ps5-slim-digital", force=True))
    assert "amazon" not in {o["store"] for o in storage.read_user("offers", [])}
    assert len(storage.read_user("price_history", [])) == 3
