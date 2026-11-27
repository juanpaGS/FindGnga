from pathlib import Path

from findgnga.providers import price_index, rebuy
from findgnga.providers.engine import filter_listings, find_product, match_confidence

FIX = Path(__file__).parent / "fixtures"


def test_rebuy_reads_real_search_page():
    items = rebuy.parse((FIX / "real_rebuy_search.html").read_text())
    assert len(items) == 4
    assert all(i["condition"] == "used" and i["url"].startswith("https://www.rebuy.es/i,") for i in items)
    assert items[0]["price"] == 1015.99  # «1015,99 €»: no se queda sólo con «15,99»
    product, cat = find_product("ps5-slim-digital")
    acc, _ = filter_listings(product, cat, [{**i, "provider": "stores"} for i in items], {})
    assert {a["store"] for a in acc} == {"rebuy"} and all(a["condition"] == "used" for a in acc)
    assert all("digital" in a["title"].lower() for a in acc)


def test_console_accessories_are_rejected_even_at_console_price():
    product, cat = find_product("ps5-slim-standard")
    ref = float(product.get("msrp") or product["ref_price"])
    rows = [{"title": t, "price": ref, "url": f"https://x.es/{i}", "provider": "stores"} for i, t in enumerate([
        "Unidad de disco para PS5 Slim Digital", "Mando DualSense PS5 Slim edición coleccionista",
        "Consola PS5 Slim 1TB + mando extra"])]
    acc, rej = filter_listings(product, cat, rows, {})
    assert [a["title"] for a in acc] == ["Consola PS5 Slim 1TB + mando extra"]
    assert all(r["reason"].startswith("accesorio") for r in rej)


def test_match_confidence():
    product, _ = find_product("ps5-slim-digital")
    assert match_confidence(product, "Sony PlayStation PS5 Slim Digital Edition") == 100
    assert match_confidence(product, "PS5 Digital") < 100


def test_price_index_remembers_and_only_recalls_failed_sources():
    a = {"title": "PS5 Slim Digital", "price": 449.0, "url": "https://www.mediamarkt.es/p", "store": "mediamarkt",
         "store_name": "MediaMarkt", "condition": "new", "provider": "stores"}
    b = {**a, "url": "https://www.amazon.es/p", "store": "amazon", "store_name": "Amazon.es", "provider": "serpapi"}
    assert price_index.remember("ps5-slim-digital", [a, b, {**a, "url": "x", "from_index": True}]) == 2
    got = price_index.recall("ps5-slim-digital", skip_stores={"mediamarkt"}, failed_sources={"serpapi"})
    assert [g["store_id"] for g in got] == ["amazon"] and got[0]["from_index"] and got[0]["seen_at"]
    assert price_index.recall("ps5-slim-digital", failed_sources=set()) == []
    assert price_index.stats()["listings"] == 2
