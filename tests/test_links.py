"""Enlaces directos de Google Shopping, enlaces caducados, segunda mano e Idealo vía Google."""

import asyncio

import httpx

from findgnga import storage
from findgnga.providers import engine, serpapi, verify

IMMERSIVE = {"product_results": {"title": "Sony PlayStation 5 Slim Digital 1 TB", "stores": [
    {"name": "Carrefour", "link": "https://www.carrefour.es/consola-ps5-slim-digital/VC4A-123/p",
     "price": "549,00 €", "extracted_price": 549.0, "original_price": "599,99 €", "extracted_original_price": 599.99,
     "total": "549,00 €", "extracted_total": 549.0, "details_and_offers": ["Envío gratuito"]},
    {"name": "MediaMarkt", "link": "https://www.mediamarkt.es/es/product/_ps5-slim-digital-1.html",
     "price": "559,00 €", "extracted_price": 559.0, "total": "563,99 €", "extracted_total": 563.99},
    {"name": "Google", "link": "https://www.google.com/shopping/x", "extracted_price": 1.0},
    {"name": "Wallapop", "link": "https://es.wallapop.com/item/ps5-digital-123", "extracted_price": 400.0,
     "details_and_offers": ["Segunda mano"]},
]}}


def test_parse_marks_google_links_as_not_direct():
    items = serpapi.parse({"shopping_results": [
        {"title": "PS5 Slim Digital", "extracted_price": 549.0, "source": "Carrefour",
         "product_link": "https://www.google.es/shopping/product/1", "immersive_product_page_token": "tok1"},
        {"title": "PS5 Slim Digital", "extracted_price": 559.0, "source": "Fnac",
         "link": "https://www.fnac.es/", "product_link": "https://www.google.es/shopping/product/2"},
        {"title": "PS5 Slim Digital", "extracted_price": 569.0, "source": "Worten",
         "link": "https://www.worten.es/productos/ps5-slim-digital-123"}]})
    assert [i["direct"] for i in items] == [False, False, True]
    assert items[0]["immersive_token"] == "tok1"
    assert items[1]["url"].startswith("https://www.google.es")  # la portada de Fnac no sirve: mejor Google
    assert items[2]["url"].startswith("https://www.worten.es/productos")


def test_parse_immersive_gives_direct_links_and_original_price():
    items = serpapi.parse_immersive(IMMERSIVE)
    names = [i["store_name"] for i in items]
    assert names == ["Carrefour", "MediaMarkt", "Wallapop"]  # el enlace de Google se descarta
    cf, mm, wp = items
    assert cf["old_price"] == 599.99 and cf["shipping"] == 0.0 and cf["direct"]
    assert mm["shipping"] == 4.99
    assert wp["condition"] == "used"


def test_live_search_replaces_google_link_with_direct_ones(monkeypatch):
    raw = [{"provider": "serpapi", "title": "PS5 Slim Digital", "price": 549.0, "store_name": "Carrefour",
            "url": "https://www.google.es/shopping/product/1", "direct": False, "immersive_token": "tok1"},
           {"provider": "serpapi", "title": "PS5 Slim Digital", "price": 579.0, "store_name": "Amazon.es",
            "url": "https://www.amazon.es/dp/B0X", "direct": True}]

    async def fake_collect(product, cfg, snapshot_dir=None, only=None):
        return [dict(r) for r in raw], {"serpapi": {"ok": True, "raw": 2}}

    calls = []

    async def fake_resolve(client, token, key, title=""):
        calls.append(token)
        return serpapi.parse_immersive(IMMERSIVE, title)

    monkeypatch.setattr(engine, "collect", fake_collect)
    monkeypatch.setattr(serpapi, "resolve", fake_resolve)
    storage.write_user("settings", {"verify_top": 0, "serpapi_key": "test", "resolve_links": 3})
    r = asyncio.run(engine.live_search("ps5-slim-digital", force=True, dry_run=True))
    assert calls == ["tok1"]
    urls = {o["store"]: o["url"] for o in r["listings"]}
    assert urls["carrefour"].endswith("/VC4A-123/p") and "google" not in urls["carrefour"]
    assert "mediamarkt" in urls
    wallapop = next(o for o in r["listings"] if "wallapop" in o["url"])
    assert wallapop["condition"] == "used" and wallapop["marketplace"]
    assert r["best"]["store"] == "carrefour" and r["best"]["old_price"] == 599.99
    assert r["providers"]["serpapi"]["resolved"] == 1


def _client(routes):
    def handler(req: httpx.Request):
        url = str(req.url)
        if url in routes:
            status, headers, body = routes[url]
            return httpx.Response(status, headers=headers, text=body)
        return httpx.Response(404, text="no")
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=True)


PAGE = ('<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":"%s",'
        '"availability":"https://schema.org/InStock"}}</script>')


def test_verify_detects_dead_links_and_checks_next_batch():
    def o(store, price, url):
        return {"store": store, "store_name": store, "price": price, "url": url, "condition": "new", "provider": "serpapi"}
    offers = [o("carrefour", 349, "https://www.carrefour.es/ps5/VC4A-1/p"),
              o("x-wallapop", 360, "https://es.wallapop.com/item/ps5-1"),
              o("fnac", 380, "https://www.fnac.es/ps5-slim/a1"),
              o("amazon", 549, "https://www.amazon.es/dp/B0X")]
    routes = {
        "https://www.carrefour.es/ps5/VC4A-1/p": (301, {"location": "https://www.carrefour.es/"}, ""),
        "https://www.carrefour.es/": (200, {}, "<html>Bienvenido a Carrefour</html>"),
        "https://es.wallapop.com/item/ps5-1": (200, {}, "<html>Este anuncio ya no está disponible</html>"),
        "https://www.fnac.es/ps5-slim/a1": (410, {}, ""),
        "https://www.amazon.es/dp/B0X": (200, {}, PAGE % "549.00"),
    }

    async def run():
        async with _client(routes) as c:
            await verify.verify_top(c, offers, 3)  # la 1.ª tanda (3) está toda caducada → revisa la siguiente
    asyncio.run(run())
    st = [x["verification"]["status"] for x in offers]
    assert st == ["gone", "gone", "gone", "verified"]
    assert all(x["in_stock"] is False and x["dead_link"] for x in offers[:3])
    assert "portada" in offers[0]["verification"]["note"]


def test_parse_idealo_reference():
    data = {"organic_results": [
        {"title": "Sony PlayStation 5 Slim Digital desde 529,00 € | Compara precios en idealo",
         "link": "https://www.idealo.es/precios/201234/sony-playstation-5-slim-digital.html", "snippet": "…"},
        {"title": "PS5 Slim Digital", "link": "https://www.idealo.es/precios/2/x.html",
         "rich_snippet": {"top": {"detected_extensions": {"price": 535.0}}}},
        {"title": "Otra web", "link": "https://www.otra.es/ps5", "snippet": "desde 100 €"}]}
    refs = serpapi.parse_idealo(data)
    assert [r["price"] for r in refs] == [529.0, 535.0]
    assert refs[0]["reference"] and refs[0]["title"] == "Sony PlayStation 5 Slim Digital desde 529,00 €"
