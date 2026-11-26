"""API web de FindGnga. Arranque: ``uvicorn findgnga.main:app --reload``."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import search, storage
from .pricing import deals, live

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
    return any(p["id"] == pid for name in ("monitors", "consoles") for p in storage.load_catalog(name))


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


app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")
