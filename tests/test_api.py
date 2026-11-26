from fastapi.testclient import TestClient

from findgnga.main import app

client = TestClient(app)
PROFILE = {"name": "Juan", "uses": ["programming", "gaming_casual"], "budget_monitor": 700, "budget_console": 650,
           "devices": [{"id": "mac", "kind": "mac_laptop", "model_line": "pro", "screen_in": 14, "chip_gen": 6,
                        "chip_tier": "pro", "ram_gb": 32}]}


def test_index_and_static():
    assert client.get("/").status_code == 200
    assert client.get("/static/app.js").status_code == 200


def test_profile_roundtrip_and_monitor_search():
    assert client.put("/api/profile", json=PROFILE).status_code == 200
    assert client.get("/api/profile").json()["devices"][0]["ram_gb"] == 32
    r = client.post("/api/search/monitors", json={}).json()
    assert r["results"] and r["results"][0]["badges"]


def test_manual_offer_and_promo_flow_into_ps5_search():
    client.put("/api/profile", json=PROFILE)
    assert client.post("/api/offers", json={"product_id": "ps5-slim-digital", "store": "amazon",
                                            "price": 499.99}).status_code == 200
    client.post("/api/promos", json={"store": "amazon", "code": "TEST20", "type": "fixed", "value": 20})
    r = client.get("/api/search/ps5").json()
    digital = next(c for c in r["consoles"] if c["product"]["id"] == "ps5-slim-digital")
    assert digital["pricing"]["final_price"] == 479.99
    assert digital["verdict"]["level"] == "great"
    # El monitor para PS5 tiene que tener HDMI
    assert r["monitors"]["results"][0]["product"]["hdmi_21"] >= 1


def test_offer_for_unknown_product_rejected():
    assert client.post("/api/offers", json={"product_id": "nope", "store": "amazon", "price": 1}).status_code == 404
