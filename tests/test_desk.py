"""Mi escritorio: identificar modelos, sincronizar con el perfil y recomendar accesorios."""

import re

from fastapi.testclient import TestClient

from findgnga import desk, storage
from findgnga.main import app
from findgnga.providers import engine
from findgnga.providers.base import matcher, norm, price_band

client = TestClient(app)


def item(id_, type_, model):
    r = desk.identify(type_, model)
    return {"id": id_, "type": type_, "model": model, "specs": r["specs"], "catalog_id": r["catalog_id"]}


def test_identify_models():
    air = desk.identify("laptop", "MacBook Air M2 13 16GB")["specs"]
    assert air["platform"] == "mac" and air["chip_gen"] == 2 and air["model_line"] == "air"
    assert air["ports"]["usb_c"] and not air["ports"]["hdmi"]
    assert desk.identify("laptop", "MacBook Pro 14 M4 Pro")["specs"]["ports"]["hdmi"]
    assert desk.identify("monitor", "LG 27UP850N")["catalog_id"] == "lg-27up850n"
    assert desk.identify("monitor", "Samsung Odyssey G9")["catalog_id"] == "samsung-odyssey-g9-g95c"
    wide = desk.identify("monitor", "monitor xiaomi 34 ultrawide 144hz")
    assert wide["catalog_id"] is None and wide["specs"]["aspect"] == "21:9" and wide["specs"]["refresh_hz"] == 144
    assert {"os": "ios", "connector": "lightning", "magsafe": True}.items() <= desk.identify("phone", "iPhone 13")["specs"].items()
    assert desk.identify("phone", "iPhone 16 Pro")["specs"]["connector"] == "usb_c"
    assert desk.identify("ps5", "PS5 Slim Digital")["specs"]["edition"] == "digital"
    assert desk.identify("desktop", "PC RTX 4070")["specs"]["gpu_tier"] == "high"


def test_display_limits():
    assert desk.max_external_displays(item("a", "laptop", "MacBook Air M2"))[0] == 1
    assert desk.max_external_displays(item("a", "laptop", "MacBook Pro 14 M4 Pro"))[0] == 2
    assert desk.max_external_displays(item("a", "laptop", "MacBook Pro 16 M3 Max"))[0] == 4


def _recs(items):
    r = desk.recommend({"items": items})
    ids = {i["product"]["id"] for s in r["sections"] for i in s["items"]}
    return r, ids


def test_recommendations_follow_the_desk():
    r, ids = _recs([item("a", "laptop", "MacBook Air M2 13"), item("b", "monitor", "LG 27UP850N"),
                    item("c", "ps5", "PS5 Digital"), item("d", "phone", "iPhone 13")])
    assert "acc-cable-usbc-tb4" in ids          # monitor USB-C + Mac → un solo cable
    assert "acc-ps5-disc-drive" in ids          # PS5 Digital → lector
    assert "acc-wireless-charger-3in1" in ids   # iPhone con MagSafe
    assert "acc-ps-pulse-elite" in ids and "acc-screenbar-xiaomi" in ids
    assert "acc-cable-hdmi21" not in ids        # el monitor no tiene HDMI 2.1
    assert any("1 pantalla externa" in n for n in r["notes"])   # el Air M2 no admite más monitores
    assert not any(s["id"] == "monitors" and s["monitors"] for s in r["sections"])
    assert any("HDMI 2.1" in n for n in r["notes"])


def test_owned_items_are_not_recommended_again():
    _, ids = _recs([item("a", "laptop", "MacBook Pro 14 M4 Pro"), item("b", "monitor", "MSI MAG 274UPF"),
                    item("c", "ps5", "PS5 Pro"), item("d", "headset", "HyperX"), item("e", "light", "BenQ ScreenBar"),
                    item("f", "keyboard", "MX Keys"), item("g", "mouse", "MX Master"), item("h", "mousepad", "XXL")])
    assert not ids & {"acc-ps-pulse-elite", "acc-hyperx-cloud-iii", "acc-screenbar-xiaomi",
                      "acc-logitech-mx-keys-s", "acc-logitech-mx-master-3s", "acc-deskmat-xxl"}
    assert "acc-cable-hdmi21" in ids and "acc-ps5-disc-drive" in ids  # monitor HDMI 2.1 + PS5 Pro sin lector


def test_empty_desk():
    r = desk.recommend({"items": []})
    assert r["empty"] and r["sections"] == []


def test_api_desk_syncs_profile_devices():
    storage.write_user("profile", {"devices": [{"id": "x1", "kind": "ps5", "edition": "standard"},
                                               {"id": "keep", "kind": "switch"}], "uses": [], "priority": 0.5})
    items = [item("px1", "ps5", "PS5"), item("m1", "laptop", "MacBook Air M3")]
    res = client.put("/api/desk", json={"items": items})
    assert res.status_code == 200
    devs = res.json()["profile"]["devices"]
    assert [d["id"] for d in devs] == ["keep", "desk-px1", "desk-m1"]  # el importado no se duplica
    assert devs[2]["kind"] == "mac_laptop" and devs[2]["chip_gen"] == 3
    assert client.get("/api/desk").json()["items"][0]["type"] == "ps5"
    acc = client.get("/api/accessories").json()
    assert acc["count"] > 0
    assert client.put("/api/desk", json={"items": [{"type": "sofa"}]}).status_code == 422
    assert client.post("/api/desk/identify", json={"type": "phone", "model": "Pixel 8"}).json()["specs"]["os"] == "android"


def test_accessories_are_searchable_products():
    product, cat = engine.find_product("acc-cable-hdmi21")
    assert cat == "accessory"
    check = matcher(product, reject_accessories=False)
    assert check("UGREEN Cable HDMI 2.1 8K 60Hz 4K 120Hz 48Gbps 2m")[0]
    assert not check("Cable HDMI 2.0 4K 60Hz")[0]
    lo, hi = price_band(product, cat)
    assert lo < 10 < 25 < hi
    assert client.get("/api/catalog").json()["accessories"]


def test_accessory_catalog_is_valid():
    for a in storage.load_catalog("accessories"):
        assert a["id"].startswith("acc-") and a["ref_price"] > 0 and a["search_query"]
        for k in ("all", "none"):
            for pat in a["match"].get(k, []):
                re.compile(pat)
        # el nombre del producto debe pasar su propio filtro (si no, nunca se encontraría)
        assert matcher(a, reject_accessories=False)(a["name"])[0] or a["kind"] in ("hub", "cable", "mousepad", "arm", "stand", "phone_acc", "charger", "webcam", "storage", "speakers"), a["id"]


def test_dualsense_filter_skips_accessories_of_the_controller():
    product, _ = engine.find_product("acc-dualsense")
    check = matcher(product, reject_accessories=False)
    assert check("Mando inalámbrico DualSense PS5 Blanco")[0]
    assert not check("Estación de carga DualSense")[0]
    assert not check("Mando DualSense Edge")[0]
    assert norm("Cargador")
