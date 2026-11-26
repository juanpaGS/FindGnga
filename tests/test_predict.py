from datetime import date, timedelta

from findgnga.predict import history_stats, predict
from findgnga.providers.engine import find_product

TODAY = date(2026, 11, 26)


def ps5():
    return find_product("ps5-slim-digital")[0]


def mon():
    return find_product("lg-27up850n")[0]


def test_black_friday_active_and_good_price_says_buy():
    r = predict(ps5(), "console", 509.99, [], today=TODAY)
    assert r["active_event"]["id"] == "black-friday-2026"
    assert r["level"] == "buy" and r["confidence"] == "baja"


def test_full_price_console_after_black_friday_says_wait():
    r = predict(ps5(), "console", 599.99, [], today=date(2026, 12, 10))
    assert r["level"] == "wait"
    assert r["best_future"] is not None and r["expected_saving"] > 10
    assert r["plan"]["per_week"] > 0


def test_resale_price_warns():
    r = predict(find_product("ps5-pro")[0], "console", 1200, [], today=TODAY)
    assert r["level"] == "wait" and "PVP" in r["verdict"]


def test_monitor_drifts_down_over_time():
    r = predict(mon(), "monitor", None, [], today=date(2027, 1, 1))
    later = [e for e in r["timeline"] if e["id"] == "black-friday-2027"][0]
    sooner = [e for e in r["timeline"] if e["id"] == "rebajas-invierno-2027"][0]
    assert r["level"] == "unknown"
    # misma lógica de descuento, pero la deriva baja el precio base con los meses
    assert later["expected_high"] < mon()["ref_price"] * (1 - 0.15)
    assert sooner["start"] < later["start"]


def test_history_gives_normal_price_trend_and_confidence():
    hist = [{"product_id": "x", "store": "a", "price": 400 - i, "date": (TODAY - timedelta(days=100 - i * 3)).isoformat()}
            for i in range(33)]
    st = history_stats(hist, TODAY)
    assert st["normal"] is not None and st["slope_per_day"] < 0
    r = predict(mon(), "monitor", 360, hist, today=TODAY)
    assert r["confidence"] == "alta" and r["percentile"] is not None
