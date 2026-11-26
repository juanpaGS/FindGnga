"""Tests con fragmentos REALES recortados (descargados en un Mac con red el 26/11/2026).

Sirven para que los lectores no se rompan sin darnos cuenta cuando se tocan con datos simulados.
"""

import asyncio
import json
from datetime import date
from pathlib import Path

from findgnga import shopcheck
from findgnga.providers import chollometro, engine, serpapi, verify
from findgnga.providers.base import matcher

FIX = Path(__file__).parent / "fixtures"
TODAY = date(2026, 11, 26)
HOMEGEARES = "https://homegeares.es/producto/consola-sony-ps5-slim-digital-edition-825-gb-ssd-4k-2-mandos-dualsense-chasis-e-blanco/"


def read(name):
    return (FIX / name).read_text(encoding="utf-8")


def test_chollometro_real_page_reports_expired_deals():
    stats = {}
    items = chollometro.parse_search(read("real_chollometro_expired.html"), stats)
    assert items == []
    assert stats == {"threads": 3, "expired": 3}


def test_fake_shop_with_same_discount_everywhere_is_flagged():
    page = read("real_homegeares_ps5.html")
    ids = {s["id"] for s in shopcheck.page_signals(page, HOMEGEARES, TODAY)}
    assert {"uniform_discount", "recent_site", "schema_domain"} <= ids
    extra = shopcheck.page_signals(page, HOMEGEARES, TODAY) + shopcheck.text_signals(
        shopcheck.html_to_text(page), "homegeares.es", full_page=True)
    r = shopcheck.quick_check(HOMEGEARES, "homegeares.es", 451.50, 599.99, extra=extra)
    assert r["verdict"] == "scam"


def test_page_signals_ignore_brand_organization_and_mixed_discounts():
    page = ('{"@type":"Product","brand":{"@type":"Organization","name":"Sony","url":"https://www.sony.es"}}'
            + "".join(f"<span>-{d}%</span>" for d in (10, 15, 20, 5, 30, 12)))
    assert shopcheck.page_signals(page, "https://tienda-real.es/ps5", TODAY) == []


def test_verify_unknown_store_page_feeds_the_scam_detector():
    page = read("real_homegeares_ps5.html")
    offer = {"store": "x-homegearses", "store_name": "homegeares.es", "price": 451.5, "url": HOMEGEARES,
             "condition": "new", "provider": "serpapi"}

    def handler(request):
        import httpx
        return httpx.Response(200, text=page)

    async def go():
        import httpx
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await verify.verify_offer(c, offer, asyncio.Semaphore(1))
    res = asyncio.run(go())
    assert res["status"] == "verified"
    assert "uniform_discount" in {s["id"] for s in res["shop_signals"]}
    offer["verification"] = res
    verify.assess([offer], ref=599.99)
    assert offer["suspicious"] and any("tienda falsa" in w for w in offer["warnings"])


def test_eci_soldout_jsonld_is_out_of_stock():
    res = verify._read_page({"price": 649.9}, read("real_eci_soldout.html"), "https://www.elcorteingles.es/x/")
    assert res["status"] == "out_of_stock"


def test_real_shopping_results_have_no_direct_link_and_need_resolving():
    items = serpapi.parse(json.loads(read("real_serpapi_shopping.json")))
    assert items and all(not it["direct"] and it["immersive_token"] for it in items)


def test_modded_console_is_rejected():
    product, _ = engine.find_product("ps5-slim-digital")
    ok, why = matcher(product, reject_accessories=False)(
        "Modded PS5 Slim Digital | Jailbreak Homebrew Enabler 1 TB / 825 GB")
    assert not ok and "modificada" in why


def test_unknown_shop_behind_google_link_is_suspicious_when_too_cheap():
    o = {"store": "x-camiestagel", "store_name": "Cami Estagel", "price": 449.99, "condition": "new",
         "url": "https://www.google.es/search?ibp=oshop&q=PS5", "provider": "serpapi"}
    verify.assess([o], ref=649.99)
    assert o["suspicious"]


def test_idealo_reference_kept_above_band_but_bundles_dropped():
    product, cat = engine.find_product("ps5-slim-digital")
    refs = serpapi.parse_idealo(json.loads(read("real_serpapi_idealo.json")))
    accepted, rejected = engine.filter_listings(product, cat, [{**r, "provider": "serpapi_idealo"} for r in refs], {})
    assert [a["url"].split("/")[4] for a in accepted] == ["203554857"]
    assert accepted[0]["price"] > 1000  # real: sólo vendedores de marketplace por encima del PVP
    assert any("pack" in r["reason"] for r in rejected)


def test_css_percentages_are_not_discounts():
    # Real (CeX/webuy.com): el CSS de la página está lleno de translate(-50%)
    page = "<style>.a{transform:translate(-50%,-50%)}" * 8 + "</style><p>Vendemos 572,99 €</p>"
    assert shopcheck.page_signals(page, "https://ic.webuy.com/product-detail/?id=X", TODAY) == []


def test_cex_and_realcash_are_second_hand():
    from findgnga.providers.base import is_second_hand_site
    assert is_second_hand_site("CeX", "https://ic.webuy.com/product-detail/?id=SPS5D825GBW001")
    assert is_second_hand_site("Tienda de segunda mano RealCash", "https://www.google.es/search?ibp=oshop")
    assert not is_second_hand_site("El Corte Inglés", "https://www.elcorteingles.es/videojuegos/A1/")


def test_verify_keeps_going_when_only_unknown_shops_are_confirmed():
    import httpx
    page = ('<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":"%s",'
            '"availability":"https://schema.org/InStock"}}</script>')
    offers = [{"store": "x-fake", "store_name": "fake", "price": 451.5, "url": "https://fake.es/p/ps5", "condition": "new"},
              {"store": "pccomponentes", "store_name": "PcComponentes", "price": 599.0,
               "url": "https://www.pccomponentes.com/ps5", "condition": "new"}]

    def handler(request):
        return httpx.Response(200, text=page % ("451.50" if "fake" in str(request.url) else "599.00"))

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            await verify.verify_top(c, offers, 1)
    asyncio.run(go())
    assert [o["verification"]["status"] for o in offers] == ["verified", "verified"]


def test_resolve_skips_likely_fake_shops_first(monkeypatch):
    product, cat = engine.find_product("ps5-slim-digital")
    accepted = [{"provider": "serpapi", "immersive_token": t, "condition": "new", "price": p, "store": s, "title": "PS5"}
                for t, p, s in (("fake", 349.99, "x-camiestagel"), ("ok1", 599.99, "x-ardistel"), ("ok2", 649.9, "elcorteingles"))]
    asked = []

    async def fake_resolve(client, token, key, title=""):
        asked.append(token)
        return []
    monkeypatch.setattr(serpapi, "resolve", fake_resolve)
    asyncio.run(engine.resolve_direct_links(product, cat, accepted, [], {}, {"resolve_links": 2, "serpapi_key": "k"}))
    assert asked == ["ok1", "ok2"]


def test_idealo_title_without_price_suffix():
    data = {"organic_results": [{"link": "https://www.idealo.es/precios/203515743/sony-playstation-5-slim-ps5-slim.html",
                                 "title": "Sony PlayStation 5 Slim (PS5 Slim) desde 1.148,97 €",
                                 "rich_snippet": {"top": {"detected_extensions": {"price": 1148.97}}}}]}
    assert serpapi.parse_idealo(data)[0]["title"] == "Sony PlayStation 5 Slim (PS5 Slim)"


def test_magento_unavailable_without_jsonld_is_out_of_stock():
    # Real: iokool.com publica el precio (meta product:price) pero no el stock; la ficha dice "No está disponible"
    res = verify._read_page({"price": 599.99}, read("real_iokool_unavailable.html"), "https://iokool.com/x")
    assert res["status"] == "out_of_stock"


def test_price_alert_button_alone_is_not_out_of_stock():
    page = ('<meta property="product:price:amount" content="599.99"/>'
            '<span class="label">Avísame bajada precio</span><p class="stock in-stock">Disponible</p>')
    assert verify._read_page({"price": 599.99}, page, "https://tienda.es/x")["status"] == "verified"


def test_suspicious_offer_is_never_the_best_price():
    from findgnga.pricing.core import best_price
    product = {"id": "ps5-slim-standard", "category": "console", "ref_price": 649.99, "msrp": 649.99}
    offers = [{"product_id": "ps5-slim-standard", "store": "x-homegearses", "store_name": "homegeares.es", "price": 451.5,
               "shipping": 0, "in_stock": True, "condition": "new", "suspicious": True, "verified": "verified",
               "checked_at": "2026-11-26T19:50:00", "source": "auto:serpapi"}]
    r = best_price(product, offers, {}, [])
    assert r["best"] is None and r["estimated"] and len(r["offers"]) == 1
