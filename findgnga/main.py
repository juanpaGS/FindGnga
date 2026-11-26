"""API web de FindGnga. Arranque: ``uvicorn findgnga.main:app --reload``."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import backup as backup_mod
from . import doctor as doctor_mod
from . import predict as predict_mod
from . import desk as desk_mod
from . import search, shopcheck, storage
from . import settings as settings_mod
from .pricing import deals, live
from .providers import engine

app = FastAPI(title="FindGnga", description="Buscador de gangas de tecnología en España")
WEB_DIR = storage.ROOT / "web"


# ---------------------------------------------------------------- modelos

class Device(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    kind: Literal["mac_laptop", "mac_desktop", "windows_laptop", "desktop_pc", "ps5", "xbox", "switch"]
    label: str | None = None
    model_line: str | None = None  # mac: "pro" | "air" | "mini" | "studio" | "imac"
    screen_in: float | None = None
    chip_gen: int | None = None
    chip_tier: str | None = "base"
    ram_gb: int | None = None
    gpu_tier: str | None = None  # "integrated" | "mid" | "high"
    usb_c_dp: bool | None = None
    usb_c_charging: bool | None = None
    edition: str | None = None  # ps5: "digital" | "standard" | "pro"


class Profile(BaseModel):
    name: str | None = None
    devices: list[Device] = []
    uses: list[str] = []
    budget_monitor: float | None = None
    budget_console: float | None = None
    size_pref: str | None = None
    priority: float = Field(0.5, ge=0, le=1)
    wants: list[str] = []  # ps5 | monitor


class MonitorQuery(BaseModel):
    device_ids: list[str] | None = None
    uses: list[str] | None = None
    budget: float | None = None
    priority: float | None = Field(None, ge=0, le=1)


class Offer(BaseModel):
    product_id: str
    store: str
    price: float = Field(gt=0)
    shipping: float | None = None
    url: str | None = None
    in_stock: bool = True
    note: str | None = None


class LiveCheck(BaseModel):
    product_id: str
    store: str
    url: str


class Promo(BaseModel):
    store: str | None = None
    code: str
    type: Literal["percent", "fixed"] = "percent"
    value: float = Field(gt=0)
    min_spend: float | None = None
    max_discount: float | None = None
    expires: date | None = None
    categories: list[str] = []
    product_ids: list[str] = []
    note: str | None = None
    active: bool = True


# ---------------------------------------------------------------- helpers

def get_profile() -> dict[str, Any]:
    return storage.read_user("profile", {"devices": [], "uses": [], "priority": 0.5})


def _product_exists(pid: str) -> bool:
    return any(p["id"] == pid for name in ("monitors", "consoles", "accessories") for p in storage.load_catalog(name))


def _save_offer(data: dict[str, Any], source: str) -> dict[str, Any]:
    if not _product_exists(data["product_id"]):
        raise HTTPException(404, "Producto desconocido")
    offers = search.user_offers()
    # Una oferta por producto+tienda: la nueva sustituye a la anterior
    offers = [o for o in offers if not (o["product_id"] == data["product_id"] and o["store"] == data["store"])]
    now = datetime.now().isoformat(timespec="seconds")
    offer = {**data, "id": uuid.uuid4().hex[:8], "source": source, "checked_at": now}
    offers.append(offer)
    storage.write_user("offers", offers)
    hist = storage.read_user("price_history", [])
    hist.append({"product_id": data["product_id"], "store": data["store"], "price": data["price"], "date": now})
    storage.write_user("price_history", hist[-2000:])
    return offer


# ---------------------------------------------------------------- rutas

@app.get("/api/catalog")
def catalog() -> dict[str, Any]:
    return {
        "monitors": storage.load_catalog("monitors"),
        "consoles": storage.load_catalog("consoles"),
        "accessories": storage.load_catalog("accessories"),
        "stores": storage.load_catalog("stores"),
    }


@app.get("/api/profile")
def read_profile() -> dict[str, Any]:
    return get_profile()


@app.put("/api/profile")
def write_profile(profile: Profile) -> dict[str, Any]:
    data = profile.model_dump(mode="json")
    storage.write_user("profile", data)
    return data


@app.post("/api/search/monitors")
def api_search_monitors(q: MonitorQuery) -> dict[str, Any]:
    return search.search_monitors(get_profile(), q.device_ids, q.uses, q.budget, q.priority)


@app.get("/api/search/ps5")
def api_search_ps5(include_devices: bool = True) -> dict[str, Any]:
    return search.search_ps5(get_profile(), include_devices)


@app.get("/api/offers")
def list_offers() -> list[dict[str, Any]]:
    return search.user_offers()


@app.post("/api/offers")
def add_offer(offer: Offer) -> dict[str, Any]:
    return _save_offer(offer.model_dump(), "manual")


@app.delete("/api/offers/{offer_id}")
def delete_offer(offer_id: str) -> dict[str, bool]:
    offers = search.user_offers()
    storage.write_user("offers", [o for o in offers if o["id"] != offer_id])
    return {"ok": True}


@app.post("/api/offers/check")
async def check_offer(req: LiveCheck) -> dict[str, Any]:
    if not req.url.startswith(("http://", "https://")):
        raise HTTPException(400, "URL no válida")
    try:
        data = await live.fetch_price(req.url)
    except Exception as exc:
        raise HTTPException(502, f"No se pudo comprobar: {exc}") from exc
    offer = _save_offer({"product_id": req.product_id, "store": req.store, "price": data["price"],
                         "url": req.url, "in_stock": data["in_stock"] is not False,
                         "note": data.get("title")}, "live")
    return {"offer": offer, "extracted": data}


@app.get("/api/promos")
def list_promos() -> list[dict[str, Any]]:
    return search.user_promos()


@app.post("/api/promos")
def add_promo(promo: Promo) -> dict[str, Any]:
    promos = storage.read_user("promos", [])
    item = {**promo.model_dump(mode="json"), "id": uuid.uuid4().hex[:8]}
    promos.append(item)
    storage.write_user("promos", promos)
    return item


@app.delete("/api/promos/{promo_id}")
def delete_promo(promo_id: str) -> dict[str, bool]:
    promos = storage.read_user("promos", [])
    storage.write_user("promos", [p for p in promos if p.get("id") != promo_id])
    return {"ok": True}


@app.get("/api/deals")
async def api_deals(q: str) -> dict[str, Any]:
    return await deals.fetch_deals(q)


@app.get("/api/links")
def api_links(q: str) -> list[dict[str, str]]:
    return search.store_links(q)


class SettingsIn(BaseModel):
    serpapi_key: str | None = None  # None = no cambiar; "" = borrar
    providers: dict[str, bool] | None = None
    max_offer_age_days: float | None = Field(None, gt=0, le=60)
    include_used: bool | None = None
    verify_top: int | None = Field(None, ge=0, le=20)
    resolve_links: int | None = Field(None, ge=0, le=10)


class TargetIn(BaseModel):
    price: float | None = Field(None, gt=0)  # None = quitar alerta


@app.get("/api/settings")
def read_settings() -> dict[str, Any]:
    return {**settings_mod.public(settings_mod.get()), "provider_info": engine.PROVIDERS}


@app.put("/api/settings")
def write_settings(s: SettingsIn) -> dict[str, Any]:
    changes = {k: v for k, v in s.model_dump().items() if v is not None}
    return {**settings_mod.public(settings_mod.update(changes)), "provider_info": engine.PROVIDERS}


@app.put("/api/targets/{product_id}")
def set_target(product_id: str, t: TargetIn) -> dict[str, Any]:
    if not engine.find_product(product_id):
        raise HTTPException(404, "Producto desconocido")
    targets = dict(settings_mod.get().get("targets", {}))
    if t.price is None:
        targets.pop(product_id, None)
    else:
        targets[product_id] = t.price
    settings_mod.update({"targets": targets})
    return {"targets": targets}


@app.post("/api/live/{product_id}")
async def api_live(product_id: str, force: bool = False) -> dict[str, Any]:
    """Busca ahora el precio en todas las fuentes activas y guarda las mejores ofertas."""
    try:
        return await engine.live_search(product_id, force=force)
    except KeyError:
        raise HTTPException(404, "Producto desconocido") from None


@app.get("/api/diagnose")
async def api_diagnose(product_id: str = "ps5-slim-digital", snapshots: bool = False) -> dict[str, Any]:
    """Prueba todas las fuentes sin guardar nada (y opcionalmente guarda el HTML recibido)."""
    folder = storage.user_dir() / "snapshots" if snapshots else None
    try:
        r = await engine.live_search(product_id, dry_run=True, snapshot_dir=folder)
    except KeyError:
        raise HTTPException(404, "Producto desconocido") from None
    r["snapshot_dir"] = str(folder) if folder else None
    return r


@app.get("/api/predict/{product_id}")
def api_predict(product_id: str, saved: float = 0.0) -> dict[str, Any]:
    found = engine.find_product(product_id)
    if not found:
        raise HTTPException(404, "Producto desconocido")
    product, category = found
    pricing = search._priced(product, category, None)
    history = [h for h in storage.read_user("price_history", []) if h["product_id"] == product_id]
    current = None if pricing["estimated"] else pricing["final_price"]
    return predict_mod.predict(product, category, current, history, saved=saved)


@app.get("/api/doctor")
async def api_doctor(network: bool = True) -> dict[str, Any]:
    """Comprueba que la instalación y las fuentes funcionan en este ordenador."""
    return await doctor_mod.run(network)


@app.get("/api/backup")
def api_backup(include_key: bool = False) -> dict[str, Any]:
    return backup_mod.export(include_key)


@app.post("/api/backup")
def api_restore(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        restored = backup_mod.restore(payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    engine._cache.clear()
    return {"restored": restored}


class ShopCheckIn(BaseModel):
    url: str = Field(min_length=4, max_length=2000)
    store_name: str | None = Field(None, max_length=120)
    price: float | None = Field(None, gt=0)
    product_id: str | None = None
    text: str = Field("", max_length=50000)  # texto pegado de la página de pago (se analiza en local)
    online: bool = True


@app.post("/api/shopcheck")
async def api_shopcheck(req: ShopCheckIn) -> dict[str, Any]:
    """¿Es fiable esta tienda? Suma señales de dirección, precio, forma de pago y antigüedad del dominio."""
    return await shopcheck.check(req.url.strip(), (req.store_name or "").strip() or None, req.price,
                                 req.product_id, req.text, req.online)


class DeskItem(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8], max_length=40)
    type: Literal[desk_mod.ITEM_TYPES]  # type: ignore[valid-type]
    model: str | None = Field(None, max_length=120)
    catalog_id: str | None = Field(None, max_length=80)
    specs: dict[str, Any] = {}


class Desk(BaseModel):
    items: list[DeskItem] = Field([], max_length=40)


class IdentifyIn(BaseModel):
    type: Literal[desk_mod.ITEM_TYPES]  # type: ignore[valid-type]
    model: str = Field("", max_length=120)


@app.get("/api/desk")
def read_desk() -> dict[str, Any]:
    return desk_mod.read_desk()


@app.put("/api/desk")
def write_desk(desk: Desk) -> dict[str, Any]:
    """Guarda el escritorio y actualiza los dispositivos del perfil (la búsqueda se adapta a él)."""
    data = desk.model_dump(mode="json")
    storage.write_user("desk", data)
    profile = desk_mod.sync_profile(data)
    return {**data, "profile": profile}


@app.post("/api/desk/identify")
def identify_item(req: IdentifyIn) -> dict[str, Any]:
    return desk_mod.identify(req.type, req.model)


@app.get("/api/accessories")
def api_accessories() -> dict[str, Any]:
    """Accesorios, monitores y mejoras compatibles con tu escritorio, con el mejor precio conocido."""
    return desk_mod.recommend()


@app.get("/api/calendar")
def api_calendar() -> dict[str, Any]:
    return storage.load_catalog_raw("events")


app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")
