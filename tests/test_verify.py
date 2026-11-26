import asyncio

import httpx

from findgnga.providers import serpapi, verify

PAGE = """<html><head><script type="application/ld+json">{"@type":"Product","name":"PS5","offers":
{"@type":"Offer","price":"%s","availability":"https://schema.org/%s"}}</script></head></html>"""


def fake_client(routes):
    def handler(req: httpx.Request):
        price, stock, status = routes.get(str(req.url), ("0", "InStock", 404))
        return httpx.Response(status, text=PAGE % (price, stock))
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def offer(store, price, url, provider="serpapi", condition="new"):
    return {"store": store, "store_name": store, "price": price, "url": url, "provider": provider,
            "condition": condition, "final_price": price}


def test_verify_marks_verified_changed_and_out_of_stock():
    offers = [offer("mediamarkt", 449, "https://mm.es/a"), offer("amazon", 459, "https://amz.es/b"),
              offer("fnac", 470, "https://fnac.es/c"), offer("x-google", 480, "https://www.google.com/shopping/x")]
    routes = {"https://mm.es/a": ("449.00", "InStock", 200), "https://amz.es/b": ("489.00", "InStock", 200),
              "https://fnac.es/c": ("470.00", "OutOfStock", 200)}

    async def run():
        async with fake_client(routes) as c:
            await verify.verify_top(c, offers, 6)
    asyncio.run(run())
    st = {o["store"]: o["verification"]["status"] for o in offers}
    assert st == {"mediamarkt": "verified", "amazon": "price_changed", "fnac": "out_of_stock", "x-google": "unverifiable"}
    amazon = offers[1]
    assert amazon["price"] == 489.0 and amazon["listed_price"] == 459
    assert offers[2]["in_stock"] is False


def test_merge_and_assess_flags_suspicious_and_unknown_store():
    offers = [offer("mediamarkt", 449, "u1"), offer("mediamarkt", 450, "u2", provider="idealo"),
              offer("amazon", 455, "u3"), offer("pccomponentes", 452, "u4"),
              offer("x-tiendarara", 250, "u5")]
    merged = verify.merge_duplicates(offers)
    mm = next(o for o in merged if o["store"] == "mediamarkt")
    assert mm["seen_in"] == ["idealo", "serpapi"] and mm["price"] == 449
    for o in merged:
        o["final_price"] = o["price"]
    verify.assess(merged)
    rare = next(o for o in merged if o["store"] == "x-tiendarara")
    assert rare["suspicious"] and rare["confidence"] < 20 and len(rare["warnings"]) == 2
    assert mm["confidence"] > next(o for o in merged if o["store"] == "amazon")["confidence"]


def test_serpapi_amazon_and_ebay_parsers():
    amz = serpapi.parse_amazon({"organic_results": [
        {"title": "PS5 Slim Digital", "extracted_price": 449.0, "link_clean": "https://www.amazon.es/dp/X"},
        {"title": "Patrocinado", "extracted_price": 1, "sponsored": True}]})
    assert len(amz) == 1 and amz[0]["store_id"] == "amazon"
    eb = serpapi.parse_ebay({"organic_results": [
        {"title": "PS5 Slim", "price": {"raw": "399,00 EUR", "extracted": 399.0}, "condition": "De segunda mano",
         "link": "https://www.ebay.es/itm/1", "shipping": "Envío gratis"}]})
    assert eb[0]["condition"] == "used" and eb[0]["shipping"] == 0 and eb[0]["marketplace"]
