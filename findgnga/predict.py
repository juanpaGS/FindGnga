"""Predicción de precio: ¿comprar ya o esperar? ¿cuánto y cuándo bajará?

No es una bola de cristal: combina tres señales y lo dice con su nivel de confianza.

1. **Calendario de campañas** (``data/events.json``): Black Friday, rebajas de enero,
   Prime Day, Days of Play… con el descuento típico de cada categoría.
2. **Tendencia del producto**: los monitores se abaratan ~1 %/mes; las consolas no
   (en 2025-2026 incluso subieron). Si hay histórico propio suficiente, se mezcla
   con la tendencia observada.
3. **Histórico de precios** guardado por la app (cada búsqueda lo alimenta):
   mínimo visto, percentil del precio actual y precio "normal" (mediana).
"""

from __future__ import annotations

import statistics
from datetime import date, datetime, timedelta
from typing import Any

from . import storage

HORIZON_DAYS = 365
MIN_HISTORY = 5


def _d(s: str) -> date:
    return date.fromisoformat(s[:10])


def history_stats(history: list[dict[str, Any]], today: date) -> dict[str, Any] | None:
    pts = sorted(((_d(h["date"]), float(h["price"])) for h in history), key=lambda x: x[0])
    if not pts:
        return None
    prices = [p for _, p in pts]
    stats: dict[str, Any] = {
        "points": len(pts), "min": min(prices), "max": max(prices),
        "first_date": pts[0][0].isoformat(), "last_date": pts[-1][0].isoformat(),
        "span_days": (pts[-1][0] - pts[0][0]).days,
    }
    # Precio "normal": mediana de los últimos 180 días sin contar las 2 últimas semanas
    window = [p for d, p in pts if today - timedelta(days=180) <= d <= today - timedelta(days=14)]
    stats["normal"] = statistics.median(window) if len(window) >= MIN_HISTORY else None
    # Tendencia (mínimos cuadrados, €/día) sobre los últimos 90 días
    recent = [(d, p) for d, p in pts if d >= today - timedelta(days=90)]
    if len(recent) >= MIN_HISTORY and (recent[-1][0] - recent[0][0]).days >= 21:
        xs = [(d - recent[0][0]).days for d, _ in recent]
        ys = [p for _, p in recent]
        mx, my = statistics.fmean(xs), statistics.fmean(ys)
        var = sum((x - mx) ** 2 for x in xs)
        stats["slope_per_day"] = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / var if var else 0.0
    else:
        stats["slope_per_day"] = None
    return stats


def percentile_of(value: float, history: list[dict[str, Any]]) -> float | None:
    prices = [float(h["price"]) for h in history]
    if len(prices) < MIN_HISTORY:
        return None
    return round(100 * sum(p <= value for p in prices) / len(prices))


def forecast_events(normal: float, category: str, drift: float, today: date,
                    events_cfg: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for ev in events_cfg["events"]:
        start, end = _d(ev["start"]), _d(ev["end"])
        if end < today or (start - today).days > HORIZON_DAYS:
            continue
        lo, hi = ev["discount"].get(category, [0, 0])
        if hi <= 0:
            continue
        months = max(0.0, (start - today).days / 30.4)
        base = normal * (1 + drift * months)
        out.append({
            "id": ev["id"], "name": ev["name"], "start": ev["start"], "end": ev["end"],
            "active": start <= today <= end, "days_until": max(0, (start - today).days),
            "discount_pct": [round(lo * 100), round(hi * 100)],
            "expected_low": round(base * (1 - hi), 2), "expected_high": round(base * (1 - lo), 2),
            "expected_mid": round(base * (1 - (lo + hi) / 2), 2),
            "reliability": ev.get("reliability", 0.5),
        })
    return out


def predict(product: dict[str, Any], category: str, current_price: float | None,
            history: list[dict[str, Any]], today: date | None = None, saved: float = 0.0,
            events_cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    today = today or date.today()
    events_cfg = events_cfg or storage.load_catalog_raw("events")
    stats = history_stats(history, today)
    reasons: list[str] = []

    # 1) Precio normal de referencia
    if stats and stats["normal"]:
        normal, normal_src = stats["normal"], "mediana de tu histórico (180 días)"
    elif category == "console" and product.get("msrp"):
        normal, normal_src = float(product["msrp"]), "PVP oficial"
    else:
        normal, normal_src = float(product["ref_price"]), "precio de calle habitual (orientativo)"

    # 2) Tendencia
    drift = float(events_cfg.get("drift_per_month", {}).get(category, 0.0))
    if stats and stats.get("slope_per_day") is not None and normal:
        observed = stats["slope_per_day"] * 30.4 / normal
        drift = max(-0.05, min(0.05, 0.5 * drift + 0.5 * observed))
        reasons.append(f"Tendencia observada en tu histórico: {observed * 100:+.1f} % al mes")

    # 3) Campañas
    timeline = forecast_events(normal, category, drift, today, events_cfg)
    active = next((e for e in timeline if e["active"]), None)
    future = [e for e in timeline if not e["active"] and e["reliability"] >= 0.6]
    next_drop = future[0] if future else None
    best_future = min(future, key=lambda e: e["expected_mid"]) if future else None
    # Entre las bajadas parecidas, preferimos la más cercana
    if best_future:
        close = [e for e in future if e["expected_mid"] <= best_future["expected_mid"] * 1.02]
        best_future = min(close, key=lambda e: e["days_until"])

    price = current_price if current_price is not None else None
    verdict, level = "", "neutral"
    expected_saving = 0.0

    if price is None:
        verdict, level = "Busca precios actuales para saber si comprar ya", "unknown"
    else:
        disc_now = 1 - price / normal if normal else 0
        reasons.append(f"Precio actual {disc_now * 100:+.0f} % respecto al normal ({normal:.0f} €, {normal_src})"
                       .replace("+-", "-"))
        threshold = max(10.0, 0.03 * price)
        if stats and price <= stats["min"] * 1.02 and stats["points"] >= MIN_HISTORY:
            reasons.append("Está en el mínimo de tu histórico")
        if active and active["reliability"] >= 0.6 and price <= active["expected_mid"]:
            verdict, level = f"Compra ahora: estamos en {active['name']} y el precio ya está en el rango típico de rebaja", "buy"
        elif best_future:
            expected_saving = round(price - best_future["expected_mid"], 2)
            when = f"{best_future['name']} ({_fmt(best_future['start'])})"
            if expected_saving <= threshold:
                verdict, level = f"Compra cuando quieras: no se espera una bajada clara antes de {when}", "buy"
            elif price > best_future["expected_high"]:
                verdict, level = (f"Espera a {when}: precio esperado {best_future['expected_low']:.0f}–"
                                  f"{best_future['expected_high']:.0f} € (ahorro ≈ {expected_saving:.0f} €)"), "wait"
            else:
                verdict, level = f"Buen precio; quizá ahorres ≈ {expected_saving:.0f} € esperando a {when}", "neutral"
        else:
            verdict, level = "Sin campañas fiables a la vista: compra si el precio te encaja", "buy"
        if category == "console" and product.get("msrp") and price > product["msrp"] * 1.05:
            verdict, level = "Por encima del PVP oficial: no compres a reventa, espera o busca otra tienda", "wait"

    for u in events_cfg.get("unscheduled", []):
        lo, hi = u["discount"].get(category, [0, 0])
        if hi > 0:
            reasons.append(f"Atento a «{u['name']}» ({round(lo * 100)}–{round(hi * 100)} %): {u['note']}")
    note = events_cfg.get("category_notes", {}).get(category)
    if note:
        reasons.append(note)

    # 4) Plan de ahorro hacia la próxima buena oportunidad
    plan = None
    target_event = best_future if level == "wait" else (best_future or next_drop)
    if target_event:
        target = target_event["expected_mid"]
        weeks = max(1, target_event["days_until"] // 7)
        plan = {
            # wait: ahorra para esa campaña · fallback: compra ya si puedes; si no, ésta es la siguiente
            "mode": "wait" if level == "wait" else "fallback",
            "target_price": round(target, 2), "event": target_event["name"], "date": target_event["start"],
            "weeks": weeks, "already_saved": saved,
            "per_week": round(max(0.0, target - saved) / weeks, 2),
        }

    points = stats["points"] if stats else 0
    confidence = "alta" if points >= 30 and stats and stats["span_days"] >= 90 else "media" if points >= MIN_HISTORY else "baja"
    return {
        "product_id": product["id"], "category": category,
        "current_price": price, "normal_price": round(normal, 2), "normal_source": normal_src,
        "drift_per_month_pct": round(drift * 100, 2),
        "verdict": verdict, "level": level, "expected_saving": expected_saving,
        "active_event": active, "next_drop": next_drop, "best_future": best_future,
        "timeline": timeline, "history": stats,
        "percentile": percentile_of(price, history) if price is not None else None,
        "reasons": reasons, "plan": plan, "confidence": confidence,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


def _fmt(iso: str) -> str:
    meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
    d = _d(iso)
    return f"{d.day} {meses[d.month - 1]} {d.year}"
