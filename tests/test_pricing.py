from datetime import date
from pathlib import Path

from findgnga.pricing.core import best_price, shipping_cost
from findgnga.pricing.deals import matches, parse_feed
from findgnga.pricing.live import extract_price, parse_price

FIX = Path(__file__).parent / "fixtures"
STORES = {"mm": {"id": "mm", "name": "MM", "shipping": {"cost": 4.99, "free_over": 49}},
          "amz": {"id": "amz", "name": "AMZ", "shipping": {"cost": 0, "free_over": 0}}}
PRODUCT = {"id": "ps5-pro", "ref_price": 899.99, "category": "console"}


def test_parse_price_formats():
    assert parse_price("1.299,00 €") == 1299.0
    assert parse_price("1,299.50") == 1299.5
    assert parse_price("449,9") == 449.9
    assert parse_price("1.049") == 1049.0
    assert parse_price(349) == 349.0
    assert parse_price("") is None


def test_shipping_rules():
    assert shipping_cost(STORES["mm"], 30) == 4.99
    assert shipping_cost(STORES["mm"], 300) == 0
    assert shipping_cost(STORES["mm"], 300, override=9.5) == 9.5


def test_best_price_applies_shipping_and_best_valid_promo():
    offers = [{"id": "1", "product_id": "ps5-pro", "store": "mm", "price": 800},
              {"id": "2", "product_id": "ps5-pro", "store": "amz", "price": 790}]
    promos = [{"store": "mm", "code": "MM10", "type": "percent", "value": 10, "max_discount": 50},
              {"store": "amz", "code": "OLD", "type": "fixed", "value": 100, "expires": "2020-01-01"},
              {"store": "mm", "code": "BIG", "type": "fixed", "value": 200, "min_spend": 1000}]
    r = best_price(PRODUCT, offers, STORES, promos, today=date(2026, 11, 27))
    assert not r["estimated"]
    assert r["best"]["store"] == "mm" and r["best"]["promo_code"] == "MM10"
    assert r["final_price"] == 750.0


def test_best_price_falls_back_to_reference():
    r = best_price(PRODUCT, [], STORES, [])
    assert r["estimated"] and r["final_price"] == 899.99


def test_extract_price_jsonld():
    d = extract_price((FIX / "product_jsonld.html").read_text(encoding="utf-8"))
    assert d["price"] == 329.9 and d["in_stock"] is True and d["method"] == "json-ld"
    assert d["title"] == "LG 27UP850N-W"


def test_extract_price_meta_fallback():
    d = extract_price((FIX / "product_meta.html").read_text(encoding="utf-8"))
    assert d["price"] == 1049.95 and d["method"].startswith("meta")


def test_parse_feed_and_filter():
    items = parse_feed((FIX / "feed.xml").read_text(encoding="utf-8"))
    assert len(items) == 3
    ps5 = items[0]
    assert ps5["price"] == 449.0 and ps5["merchant"] == "MediaMarkt" and ps5["code"] == "BLACK25"
    assert items[1]["price"] == 329.99
    assert [i["title"] for i in items if matches(i, "ps5 slim")] == [ps5["title"]]
