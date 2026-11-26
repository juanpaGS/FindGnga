"""Búsquedas: ranking de monitores y de PS5 según el perfil del usuario."""

from __future__ import annotations

from datetime import date
from typing import Any
from urllib.parse import quote_plus

from . import settings as settings_mod
from . import storage
from .pricing.core import best_price
from .scoring.monitors import evaluate

MIN_FIT = 60  # por debajo: calidad/compatibilidad insuficiente
QUALITY_FLOOR = 50  # el índice calidad/precio sólo premia la calidad por encima de este suelo
BUDGET_TOLERANCE = 1.10  # hasta un 10 % por encima del presupuesto se muestra con aviso


def stores_by_id() -> dict[str, dict[str, Any]]:
    return {s["id"]: s for s in storage.load_catalog("stores")}


def store_links(query: str) -> list[dict[str, str]]:
    raw = storage.load_catalog_raw("stores")
    q = quote_plus(query)
    links = [{"store": s["id"], "name": s["name"], "url": s["search_url"].replace("{q}", q),
              "tip": s.get("promo_tip", "")} for s in raw["items"]]
    links += [{"store": "", "name": a["name"], "url": a["url"].replace("{q}", q), "tip": ""}
              for a in raw.get("aggregators", [])]
    return links


def user_offers() -> list[dict[str, Any]]:
    return storage.read_user("offers", [])


def user_promos() -> list[dict[str, Any]]:
    return storage.load_catalog("promos") + storage.read_user("promos", [])


def _price_history(product_id: str) -> dict[str, Any] | None:
    hist = [h for h in storage.read_user("price_history", []) if h["product_id"] == product_id]
    if not hist:
        return None
    low = min(hist, key=lambda h: h["price"])
    return {"min_price": low["price"], "min_store": low["store"], "min_date": low["date"], "points": len(hist)}


def _priced(product: dict[str, Any], category: str, today: date | None) -> dict[str, Any]:
    prod = {**product, "category": category}
    cfg = settings_mod.get()
    pricing = best_price(prod, user_offers(), stores_by_id(), user_promos(), today,
                         max_age_days=cfg["max_offer_age_days"], include_used=cfg["include_used"])
    target = cfg.get("targets", {}).get(product["id"])
    pricing["target"] = target
    pricing["alert"] = bool(target and not pricing["estimated"] and pricing["final_price"] <= float(target))
    pricing["history"] = _price_history(product["id"])
    return pricing


def select_devices(profile: dict[str, Any], device_ids: list[str] | None) -> list[dict[str, Any]]:
    devices = profile.get("devices", [])
    if device_ids is None:
        return devices
    return [d for d in devices if d.get("id") in device_ids]


def rank(items: list[dict[str, Any]], priority: float, budget: float | None) -> dict[str, Any]:
    """priority: 0 = sólo importa el precio, 1 = sólo importa la calidad."""
    for it in items:
        price = it["pricing"]["final_price"]
        # Calidad "útil" (por encima del suelo) al cuadrado / precio: un monitor barato pero
        # mediocre no gana a uno algo más caro y claramente mejor.
        excess = max(0.0, it["eval"]["fit"] - QUALITY_FLOOR)
        it["value_index"] = round(excess ** 2 / price * 10, 2) if price else 0
        if it["eval"]["fit"] < MIN_FIT or it["eval"]["dealbreaker"]:
            it["status"] = "discarded"
        elif budget and price > budget * BUDGET_TOLERANCE:
            it["status"] = "over_budget"
        else:
            it["status"] = "ok"

    ok = [it for it in items if it["status"] == "ok"]
    best_value = max((it["value_index"] for it in ok), default=1) or 1
    for it in items:
        value_norm = it["value_index"] / best_value * 100
        score = priority * it["eval"]["fit"] + (1 - priority) * min(value_norm, 100)
        if budget and it["pricing"]["final_price"] > budget and it["status"] == "ok":
            score -= 8
            it["eval"]["reasons"].append({"kind": "warn", "text": "Un poco por encima de tu presupuesto"})
        it["rank_score"] = round(score, 1)
        it["badges"] = []

    ok.sort(key=lambda it: it["rank_score"], reverse=True)
    if ok:
        ok[0]["badges"].append("recommended")
        max(ok, key=lambda it: it["eval"]["fit"])["badges"].append("best_quality")
        max(ok, key=lambda it: it["eval"]["compat"])["badges"].append("most_compatible")
        decent = [it for it in ok if it["eval"]["fit"] >= 70]
        if decent:
            min(decent, key=lambda it: it["pricing"]["final_price"])["badges"].append("cheapest_decent")

    rest = sorted((it for it in items if it["status"] != "ok"), key=lambda it: it["rank_score"], reverse=True)
    return {"results": ok, "others": rest}


def search_monitors(profile: dict[str, Any], device_ids: list[str] | None = None, uses: list[str] | None = None,
                    budget: float | None = None, priority: float | None = None,
                    today: date | None = None) -> dict[str, Any]:
    devices = select_devices(profile, device_ids)
    uses = uses if uses is not None else profile.get("uses", [])
    budget = budget if budget is not None else profile.get("budget_monitor")
    priority = priority if priority is not None else profile.get("priority", 0.5)
    items = []
    for m in storage.load_catalog("monitors"):
        items.append({
            "product": m,
            "eval": evaluate(m, devices, uses, profile.get("size_pref")),
            "pricing": _priced(m, "monitor", today),
            "links": store_links(m["search_query"]),
        })
    out = rank(items, float(priority), budget)
    out["devices"] = devices
    out["uses"] = uses
    out["budget"] = budget
    return out


def ps5_verdict(price: float, msrp: float) -> dict[str, Any]:
    pct = round((msrp - price) / msrp * 100, 1)
    if pct >= 15:
        label, level = "Chollazo: muy por debajo del PVP", "great"
    elif pct >= 8:
        label, level = "Buen precio de Black Friday", "good"
    elif pct > 0:
        label, level = "Rebaja pequeña: espera si no tienes prisa", "meh"
    elif pct == 0:
        label, level = "Precio oficial (PVP)", "neutral"
    else:
        label, level = "Por encima del PVP: evita reventas", "bad"
    return {"discount_pct": pct, "label": label, "level": level}


def search_ps5(profile: dict[str, Any], include_devices: bool = True, today: date | None = None) -> dict[str, Any]:
    consoles = []
    for c in storage.load_catalog("consoles"):
        pricing = _priced(c, "console", today)
        consoles.append({
            "product": c,
            "pricing": pricing,
            "verdict": ps5_verdict(pricing["final_price"], c["msrp"]) if not pricing["estimated"] else None,
            "links": store_links(c["search_query"]),
        })
    consoles.sort(key=lambda x: x["pricing"]["final_price"])

    # Monitor ideal para PS5 (+ el resto de dispositivos del perfil si se pide)
    owned_ps5 = [d for d in profile.get("devices", []) if d.get("kind") == "ps5"]
    ps5_device = owned_ps5[0] if owned_ps5 else {"id": "_ps5", "kind": "ps5", "label": "PS5", "edition": "standard"}
    others = [d for d in profile.get("devices", []) if d.get("kind") != "ps5"] if include_devices else []
    temp_profile = {**profile, "devices": [ps5_device] + others}
    uses = sorted(set(profile.get("uses", [])) | {"gaming_casual"})
    monitors = search_monitors(temp_profile, uses=uses, today=today)
    return {"consoles": consoles, "monitors": monitors}
