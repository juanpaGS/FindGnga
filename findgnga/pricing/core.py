"""Precio final = precio + envío − mejor cupón aplicable."""

from __future__ import annotations

from datetime import date
from typing import Any


def shipping_cost(store: dict[str, Any] | None, price: float, override: float | None = None) -> float:
    if override is not None:
        return float(override)
    if not store:
        return 0.0
    rule = store.get("shipping", {})
    free_over = rule.get("free_over", 0) or 0
    if free_over and price >= free_over:
        return 0.0
    return float(rule.get("cost", 0) or 0)


def promo_applies(promo: dict[str, Any], store_id: str, product: dict[str, Any], price: float,
                  today: date | None = None) -> bool:
    today = today or date.today()
    if not promo.get("active", True):
        return False
    if promo.get("store") and promo["store"] != store_id:
        return False
    if promo.get("expires"):
        try:
            if date.fromisoformat(promo["expires"]) < today:
                return False
        except ValueError:
            pass
    if promo.get("min_spend") and price < float(promo["min_spend"]):
        return False
    if promo.get("product_ids") and product.get("id") not in promo["product_ids"]:
        return False
    if promo.get("categories") and product.get("category") not in promo["categories"]:
        return False
    return True


def promo_discount(promo: dict[str, Any], price: float) -> float:
    value = float(promo.get("value", 0))
    if promo.get("type") == "percent":
        disc = price * value / 100
    else:
        disc = value
    if promo.get("max_discount"):
        disc = min(disc, float(promo["max_discount"]))
    return round(min(disc, price), 2)


def best_promo(promos: list[dict[str, Any]], store_id: str, product: dict[str, Any], price: float,
               today: date | None = None) -> tuple[dict[str, Any] | None, float]:
    best, best_disc = None, 0.0
    for p in promos:
        if promo_applies(p, store_id, product, price, today):
            d = promo_discount(p, price)
            if d > best_disc:
                best, best_disc = p, d
    return best, best_disc


def price_offer(offer: dict[str, Any], product: dict[str, Any], stores: dict[str, dict[str, Any]],
                promos: list[dict[str, Any]], today: date | None = None) -> dict[str, Any]:
    price = float(offer["price"])
    store = stores.get(offer.get("store", ""))
    ship = shipping_cost(store, price, offer.get("shipping"))
    promo, disc = best_promo(promos, offer.get("store", ""), product, price, today)
    return {
        **offer,
        "store_name": store["name"] if store else offer.get("store", "?"),
        "shipping_cost": ship,
        "promo_code": promo.get("code") if promo else None,
        "promo_discount": disc,
        "final_price": round(price + ship - disc, 2),
    }


def best_price(product: dict[str, Any], offers: list[dict[str, Any]], stores: dict[str, dict[str, Any]],
               promos: list[dict[str, Any]], today: date | None = None) -> dict[str, Any]:
    """Devuelve las ofertas calculadas y la mejor. Si no hay ninguna, estima con ref_price."""
    mine = [o for o in offers if o.get("product_id") == product["id"] and o.get("in_stock", True)]
    priced = sorted((price_offer(o, product, stores, promos, today) for o in mine), key=lambda o: o["final_price"])
    if priced:
        best = priced[0]
        return {"final_price": best["final_price"], "estimated": False, "best": best, "offers": priced}
    return {"final_price": float(product["ref_price"]), "estimated": True, "best": None, "offers": []}
