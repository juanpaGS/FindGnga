"""Mi escritorio v0.6: mesa con medidas reales, medidas de los productos y avisos de lo que no cabe."""

import math

from fastapi.testclient import TestClient

from findgnga import desk, devices
from findgnga.main import app

client = TestClient(app)


def item(id_, type_, model, x=None, z=None, rot=0.0, **extra):
    r = desk.identify(type_, model)
    it = {"id": id_, "type": type_, "model": model, "specs": r["specs"], "catalog_id": r["catalog_id"], **extra}
    if x is not None:
        it["pos"] = {"x": x, "z": z, "rot": rot}
    return it


# ------------------------------------------------------------------ la mesa

def test_table_defaults_and_clamping():
    t = desk.normalize_table({"width_cm": 900, "depth_cm": 10, "height_cm": 74, "shape": "triangle", "legs": "x"})
    assert t["width_cm"] == 300 and t["depth_cm"] == 40 and t["shape"] == "rect" and t["legs"] == "four"
    # el redondeo no puede pasar de la mitad del lado corto
    assert desk.normalize_table({"width_cm": 120, "depth_cm": 50, "corner_cm": 30})["corner_cm"] <= 24
    # en una L el retorno es más largo que el fondo y más estrecho que la mesa
    L = desk.normalize_table({"width_cm": 100, "depth_cm": 70, "shape": "l_right", "return_w_cm": 120, "return_d_cm": 60})
    assert L["return_d_cm"] >= 80 and L["return_w_cm"] <= 80


def test_table_migrates_old_style():
    t = desk.normalize_table(None, {"width": 1.8, "depth": 0.8, "desk": "walnut", "legs": "white"})
    assert (t["width_cm"], t["depth_cm"], t["material"], t["leg_color"]) == (180, 80, "walnut", "white")
    assert desk.normalize_table(None, {"width": 0})["width_cm"] == desk.TABLE_DEFAULT["width_cm"]


def test_table_validated_by_api():
    ok = client.put("/api/desk", json={"items": [], "table": {"width_cm": 140, "depth_cm": 70, "height_cm": 120,
                                                              "legs": "standing", "material": "glass"}})
    assert ok.status_code == 200 and ok.json()["table"]["legs"] == "standing"
    assert client.get("/api/desk").json()["table"]["width_cm"] == 140
    for bad in ({"width_cm": 20}, {"height_cm": 300}, {"shape": "round"}, {"material": "marble"}, {"top_cm": 0}):
        assert client.put("/api/desk", json={"items": [], "table": bad}).status_code == 422, bad


def test_presets():
    r = client.get("/api/desk/presets").json()
    ids = {p["id"]: p for p in r["items"]}
    assert ids["ikea-bekant-160x80"]["table"]["width_cm"] == 160 and ids["ikea-bekant-160x80"]["table"]["depth_cm"] == 80
    assert ids["flexispot-e7-140x70"]["table"]["legs"] == "standing"
    assert ids["ikea-bekant-corner-160x110"]["table"]["shape"] == "l_right"
    assert all(p["table"]["preset"] == p["id"] for p in r["items"])


def test_on_table_shapes():
    rect = desk.normalize_table({"width_cm": 140, "depth_cm": 70})
    assert desk.on_table(rect, 69, 34) and not desk.on_table(rect, 71, 0)
    rounded = desk.normalize_table({"width_cm": 140, "depth_cm": 70, "corner_cm": 10})
    assert desk.on_table(rounded, 65, 0) and not desk.on_table(rounded, 69.5, 34.5)
    L = desk.normalize_table({"width_cm": 160, "depth_cm": 60, "shape": "l_right", "return_w_cm": 60, "return_d_cm": 120})
    assert desk.on_table(L, 60, 80)          # en el retorno
    assert not desk.on_table(L, -60, 80)     # al otro lado no hay mesa
    dist, side = desk.outside(L, -60, 40)
    assert side == "front" and math.isclose(dist, 10)


# ------------------------------------------------------------------ medidas de los productos

def test_dims_from_catalog_and_tables():
    r = desk.identify("laptop", "MacBook Air M2 13")
    assert r["dims"]["w"] == 30.41 and r["dims"]["h"] == 1.13 and not r["dims"]["approx"]
    assert devices.dims("laptop", desk.identify("laptop", "MacBook Pro 16 M3 Max")["specs"])["d"] == 24.81
    assert devices.dims("desktop", desk.identify("desktop", "Mac mini M4")["specs"])["w"] == 12.7
    assert devices.dims("desktop", desk.identify("desktop", "Mac mini M2")["specs"])["w"] == 19.7
    ps5 = desk.identify("ps5", "PS5 Slim Digital")
    assert (ps5["dims"]["w"], ps5["dims"]["h"], ps5["dims"]["d"]) == (8.0, 35.8, 21.6)
    assert desk.identify("ps5", "PS5 Pro")["dims"]["h"] == 38.8
    assert desk.identify("mouse", "Logitech MX Master 3S")["dims"]["w"] == 8.4
    assert desk.identify("mousepad", "alfombrilla 90x40")["dims"]["w"] == 90


def test_monitor_dims_derived_from_diagonal():
    w, h = devices.panel_cm(27, 16 / 9)
    assert math.isclose(w, 59.77, abs_tol=0.05) and math.isclose(h, 33.62, abs_tol=0.05)
    studio = desk.identify("monitor", "Apple Studio Display")["dims"]
    assert studio["w"] == 62.3 and studio["h"] == 47.8 and studio["src"] == "fabricante"
    # sin ficha: panel por pulgadas y formato + marco típico, y se marca como orientativo
    wide = desk.identify("monitor", "monitor xiaomi 34 ultrawide 144hz")["dims"]
    assert wide["approx"] and wide["stand"] == "v" and 79 < wide["panel_w"] < 81
    g9 = desk.identify("monitor", "Samsung Odyssey G9")["dims"]
    assert g9["curve_r"] == 1000 and g9["sagitta"] > 10 and g9["w"] < g9["panel_w"]   # curvo: la cuerda es menor que el panel


def test_dims_override():
    auto = devices.dims("monitor", desk.identify("monitor", "Dell U2723QE")["specs"], "dell-u2723qe")
    mine = devices.resolve_dims(auto, {"w": 63, "h": 52})
    assert mine["w"] == 63 and mine["custom"] and mine["bezel"] > auto["bezel"] and mine["lift"] > auto["lift"]
    assert devices.resolve_dims(auto, {"w": 9999})["w"] == devices.DIM_RANGE[1]
    assert devices.resolve_dims(auto, None) == auto
    r = client.put("/api/desk", json={"items": [{"id": "k", "type": "keyboard", "model": "x", "dims": {"w": 30, "d": 11}}]})
    assert r.status_code == 200
    it = client.get("/api/desk").json()["items"][0]
    assert it["dims"]["w"] == 30 and "dims_auto" in it
    assert client.put("/api/desk", json={"items": [{"type": "mouse", "dims": {"w": -1}}]}).status_code == 422


# ------------------------------------------------------------------ ¿cabe?

def test_fit_ok_desk():
    d = {"table": {"width_cm": 160, "depth_cm": 80},
         "items": [item("m", "monitor", "LG 27UP850N", 0, -0.2), item("k", "keyboard", "Logitech MX Keys", 0, 0.2),
                   item("r", "mouse", "Logitech MX Master 3S", 0.32, 0.2), item("pad", "mousepad", "alfombrilla 90x40", 0.05, 0.2)]}
    rep = desk.fit_report(d)
    assert rep["ok"], rep["issues"]
    assert 0 < rep["used_pct"] < 50 and rep["area_cm2"] == 160 * 80


def test_fit_overhang_and_too_big():
    d = {"table": {"width_cm": 120, "depth_cm": 60},
         "items": [item("p", "ps5", "PS5 Slim Digital", 0.58, -0.1), item("g9", "monitor", "Samsung Odyssey G9", 0, -0.05)]}
    rep = desk.fit_report(d)
    over = [i for i in rep["issues"] if i["kind"] == "overhang" and i["ids"] == ["p"]]
    assert over and over[0]["side"] == "right" and 1.5 < over[0]["cm"] < 2.5
    # una mesa de 60 de fondo y un pie de casi 42: entra, pero si la mesa es más pequeña que el monitor, no cabe
    small = desk.fit_report({"table": {"width_cm": 100, "depth_cm": 60}, "items": [item("g9", "monitor", "Samsung Odyssey G9", 0, 0)]})
    assert any(i["kind"] == "too_big" for i in small["issues"])


def test_fit_overlap_and_heights():
    base = [item("m", "monitor", "Dell U2723QE", 0, -0.2)]
    # el teclado delante del pie no choca; encima del pie sí
    assert desk.fit_report({"items": base + [item("k", "keyboard", "Logitech MX Keys", 0, 0.2)]})["ok"]
    bad = desk.fit_report({"items": base + [item("k", "keyboard", "Logitech MX Keys", 0, -0.2)]})
    assert any(i["kind"] == "overlap" and set(i["ids"]) == {"m", "k"} for i in bad["issues"])
    # un altavoz bajo la pantalla choca con ella (es más alto que el hueco), una PS5 al lado no
    spk = desk.fit_report({"items": base + [item("s", "speakers", "Edifier R1280DB", 0, -0.2, span=0.25)]})
    assert any("pantalla" in i["text"] for i in spk["issues"])
    assert desk.fit_report({"items": base + [item("p", "ps5", "PS5 Slim", 0.5, -0.2)]})["ok"]
    # la alfombrilla no se solapa con nada (va debajo)
    assert desk.fit_report({"items": [item("k", "keyboard", "Logitech MX Keys", 0, 0.2),
                                      item("pad", "mousepad", "alfombrilla 90x40", 0, 0.12)]})["ok"]


def test_fit_rotation_and_horizontal_ps5():
    # girado 90°, el teclado de 43 cm pasa a ocupar 43 cm de fondo: en una mesa de 40 sobresale
    rot = desk.fit_report({"table": {"width_cm": 120, "depth_cm": 40},
                           "items": [item("k", "keyboard", "Logitech MX Keys", 0, 0, rot=math.pi / 2)]})
    assert any(i["kind"] == "overhang" for i in rot["issues"])
    lying = desk.fit_report({"table": {"width_cm": 120, "depth_cm": 60},
                             "items": [item("p", "ps5", "PS5 Slim", 0.45, 0, orient="horizontal")]})
    assert any(i["kind"] == "overhang" for i in lying["issues"])   # tumbada mide 35,8 cm de ancho
    assert desk.fit_report({"table": {"width_cm": 120, "depth_cm": 60}, "items": [item("p", "ps5", "PS5 Slim", 0.45, 0)]})["ok"]


def test_fit_arms_and_monitors_width():
    mons = [item("a", "monitor", "Dell U2723QE", -0.3, -0.2), item("b", "monitor", "LG 27UP850N", 0.3, -0.2)]
    rep = desk.fit_report({"table": {"width_cm": 110, "depth_cm": 70}, "items": mons})
    assert any(i["kind"] == "too_big" and len(i["ids"]) == 2 for i in rep["issues"])
    arm = item("arm", "arm", "Brazo Ergotron LX", 0, -0.3)
    assert desk.held_map(mons + [arm]) == {"a": "arm"}
    thick = desk.fit_report({"table": {"top_cm": 7}, "items": [arm]})
    assert any(i["kind"] == "clamp" and i["severity"] == "bad" for i in thick["issues"])
    glass = desk.fit_report({"table": {"material": "glass"}, "items": [arm]})
    assert any(i["kind"] == "clamp" and i["severity"] == "warn" for i in glass["issues"])


def test_fit_api():
    r = client.post("/api/desk/fit", json={"table": {"width_cm": 120, "depth_cm": 60},
                                           "items": [item("p", "ps5", "PS5 Slim Digital", 0.58, -0.1)]})
    assert r.status_code == 200 and r.json()["issues"][0]["kind"] == "overhang"
    assert client.post("/api/desk/fit", json={"items": [], "table": {"width_cm": 5}}).status_code == 422
