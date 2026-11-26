"""Catálogo de modelos: autocompletado, ficha completa, compatibilidad y mejoras que cuestan menos de lo pagado."""

from fastapi.testclient import TestClient

from findgnga import desk, devices
from findgnga.main import app

client = TestClient(app)


def item(id_, type_, model, **kw):
    r = desk.identify(type_, model)
    return {"id": id_, "type": type_, "model": model, "specs": r["specs"], "catalog_id": r["catalog_id"], **kw}


def test_unknown_mac_is_filled_from_the_name():
    r = devices.identify("laptop", "macbook m6 pro 32 gb")
    s = r["specs"]
    assert r["source"] == "parsed" and r["name"] == 'MacBook Pro 14" M6 Pro'
    assert s["ram_gb"] == 32 and s["chip_gen"] == 6 and s["chip_tier"] == "pro"
    assert s["ports"]["thunderbolt"] and s["max_displays"] == 2 and s["charge_w"]
    assert any(k == "RAM" and v == "32 GB" for k, v in r["sheet"])


def test_known_models_and_extras():
    r = devices.identify("laptop", "macbook pro m4 pro 48gb negro espacial")
    assert r["catalog_id"] == "mac-mbpro-14-m4-pro" and r["specs"]["ram_gb"] == 48 and r["specs"]["color"] == "space_black"
    assert "space_black" in r["colors"]
    assert devices.identify("headset", "sony xm5")["catalog_id"] == "dev-sony-wh1000xm5"
    assert devices.identify("laptop", "mbp m3 max 16")["catalog_id"] == "mac-mbpro-16-m3-max"
    # elegido de la lista: manda el id aunque el texto sea otro
    assert devices.identify("keyboard", "lo que sea", "acc-logitech-mx-keys-s")["catalog_id"] == "acc-logitech-mx-keys-s"


def test_ambiguous_text_is_not_auto_identified():
    assert devices.identify("keyboard", "keychron")["catalog_id"] is None
    assert devices.identify("monitor", "lg 27")["catalog_id"] is None
    sug = devices.suggest("keyboard", "keychron")
    assert len(sug) >= 2 and not any(s["exact"] for s in sug)


def test_suggest_api():
    r = client.get("/api/desk/suggest", params={"type": "laptop", "q": "macbook air m3"}).json()["items"]
    assert r and r[0]["name"].startswith("MacBook Air") and "M3" in r[0]["name"]
    assert client.get("/api/desk/suggest", params={"type": "sofa", "q": "x"}).status_code == 422


def _section(r, sid):
    return next((s for s in r["sections"] if s["id"] == sid), {"items": [], "monitors": []})


def test_missing_keyboard_works_with_every_device():
    r = desk.recommend({"items": [item("a", "laptop", "MacBook Air M3"), item("b", "desktop", "PC RTX 4070"),
                                  item("c", "tablet", "iPad Air M2")]})
    kb = [i for i in _section(r, "missing")["items"] if i["product"]["kind"] == "keyboard"]
    assert kb and "🏆 Mejor opción para tu escritorio" in kb[0]["badges"]
    best = kb[0]
    assert best["compat"]["score"] >= 85 and best["quality"] >= 80
    assert (best["product"]["specs"].get("multi") or 1) >= 3        # Mac + PC + iPad con un botón
    assert best["product"]["specs"]["layout"] == "both"


def test_upgrades_only_when_cheaper_than_what_you_paid():
    base = [item("a", "laptop", "MacBook Pro 14 M4 Pro"), item("p", "ps5", "PS5 Slim")]
    cheap = desk.recommend({"items": base + [item("m", "mouse", "Logitech M185", paid=20)]})
    assert not _section(cheap, "upgrades")["items"]
    assert any("M185" in n and "20 €" in n for n in cheap["notes"])
    rich = desk.recommend({"items": base + [item("m", "mouse", "Logitech M185", paid=100)]})
    ups = _section(rich, "upgrades")["items"]
    assert ups and all(u["pricing"]["final_price"] <= 100 for u in ups)
    assert all(u["quality"] >= 48 for u in ups) and "⬆️ Mejora" in ups[0]["badges"]


def test_headset_compat_knows_ps5_has_no_bluetooth():
    ctx = desk.Ctx({"items": [item("p", "ps5", "PS5 Slim"), item("i", "phone", "iPhone 15")]})
    bt_only = {"bt": True, "wireless": True}
    score, _, cons = desk.compat_headset(bt_only, ctx)
    assert score < 70 and any("Bluetooth" in c for c in cons)
    assert desk.compat_headset({"bt": True, "dongle": True, "ps5_wireless": True}, ctx)[0] == 100


def test_desk_saves_paid_color_pos_and_style():
    items = [item("m1", "laptop", "MacBook Air M3", paid=999, color="#2e3642", pos={"x": 0.2, "z": 0.1, "rot": 0.5})]
    res = client.put("/api/desk", json={"items": items, "style": {"desk": "walnut", "rgb": True, "decor": ["plant"]}})
    assert res.status_code == 200
    d = client.get("/api/desk").json()
    assert d["items"][0]["paid"] == 999 and d["items"][0]["pos"]["rot"] == 0.5 and d["style"]["desk"] == "walnut"
    assert client.put("/api/desk", json={"items": [{"type": "mouse", "color": "rojo"}]}).status_code == 422
