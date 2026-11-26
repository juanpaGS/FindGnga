from findgnga import storage
from findgnga.scoring.monitors import evaluate, ppi
from findgnga.search import search_monitors

MAC = {"id": "mac", "kind": "mac_laptop", "model_line": "pro", "screen_in": 14, "chip_gen": 6,
       "chip_tier": "pro", "ram_gb": 32}
PS5 = {"id": "ps5", "kind": "ps5", "edition": "standard"}


def mon(mid):
    return next(m for m in storage.load_catalog("monitors") if m["id"] == mid)


def test_ppi_5k_27():
    assert round(ppi(mon("samsung-viewfinity-s9"))) == 218


def test_mac_prefers_retina_density_and_single_cable():
    five_k = evaluate(mon("samsung-viewfinity-s9"), [MAC], ["programming"])
    qhd = evaluate(mon("dell-g2724d"), [MAC], ["programming"])
    assert five_k["compat"] > 95
    assert five_k["compat"] - qhd["compat"] > 30


def test_ps5_without_hdmi_is_dealbreaker():
    r = evaluate(mon("samsung-viewfinity-s9"), [PS5], ["gaming_casual"])
    assert r["dealbreaker"] and r["fit"] <= 35


def test_ps5_ultrawide_is_dealbreaker():
    assert evaluate(mon("samsung-odyssey-g9-g95c"), [PS5], [])["dealbreaker"]


def test_ps5_hdmi21_4k120_beats_hdmi20():
    good = evaluate(mon("lg-27gr93u"), [PS5], ["gaming_casual"])
    meh = evaluate(mon("lg-27up850n"), [PS5], ["gaming_casual"])
    assert good["compat"] == 100 and meh["compat"] < 75


def test_mac_plus_ps5_recommends_monitor_with_usbc_and_hdmi21():
    r = search_monitors({"devices": [MAC, PS5], "uses": ["programming", "gaming_casual"],
                         "budget_monitor": 700, "priority": 0.5})
    top = r["results"][0]["product"]
    assert top["usb_c_video"] and top["usb_c_pd_w"] >= 60 and top["hdmi_21"] >= 1
    assert "recommended" in r["results"][0]["badges"]


def test_budget_filters_expensive_monitors():
    r = search_monitors({"devices": [MAC], "uses": [], "budget_monitor": 400})
    assert all(it["pricing"]["final_price"] <= 440 for it in r["results"])
    assert any(it["status"] == "over_budget" for it in r["others"])


def test_cheap_mediocre_does_not_win_balanced_search():
    r = search_monitors({"devices": [MAC], "uses": ["programming"], "budget_monitor": 700, "priority": 0.5})
    assert r["results"][0]["product"]["id"] != "lg-27us500"
