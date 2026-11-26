"""¿Es fiable esta tienda? Detector de tiendas falsas.

Ninguna señal por sí sola demuestra una estafa; el detector suma indicios:

* **Dirección web**: tienda conocida, dominio que imita a una marca (``amazon-ofertas.shop``),
  terminaciones de riesgo (.shop, .top…), palabras genéricas o en otro idioma, nombre de la
  tienda que no aparece en la dirección.
* **Precio**: muy por debajo del precio oficial o de referencia.
* **Página de pago** (texto que pega el usuario o HTML descargado): sólo transferencia,
  IBAN de otro país, cuenta a nombre de una persona, idiomas mezclados, prisas, sin datos legales.
* **En línea** (opcional): antigüedad del dominio (RDAP) y la propia página de la tienda.

El texto pegado se analiza en local; a internet sólo salen el dominio (consulta RDAP) y la
visita a la propia tienda.
"""

from __future__ import annotations

import html as html_mod
import re
import unicodedata
from datetime import date, datetime
from typing import Any
from urllib.parse import urlparse

import httpx

from . import storage

RISKY_TLDS = {"shop", "top", "xyz", "online", "store", "site", "buzz", "icu", "click", "live", "fun", "club", "sbs",
              "cfd", "bond", "vip", "life", "space", "website", "today", "rest", "lol", "monster", "beauty", "quest",
              "cyou", "best", "pro", "work", "biz"}
GENERIC_WORDS = ("outlet", "oferta", "descuento", "chollo", "liquidacion", "blackfriday", "black-friday", "promo",
                 "rebaja", "barato", "deal", "sale", "soldes", "garantie", "boutique", "livraison", "angebot",
                 "cheap", "discount", "clearance")
# Marcas que suelen suplantarse (no incluye palabras demasiado comunes como "game")
BRANDS = {"amazon": "Amazon", "pccomponentes": "PcComponentes", "mediamarkt": "MediaMarkt",
          "elcorteingles": "El Corte Inglés", "fnac": "Fnac", "carrefour": "Carrefour", "worten": "Worten",
          "coolmod": "Coolmod", "aliexpress": "AliExpress", "backmarket": "Back Market", "ebay": "eBay",
          "playstation": "PlayStation", "sony": "Sony", "nintendo": "Nintendo", "apple": "Apple"}
FOREIGN_WORDS = {
    "francés": ("paiement", "securise", "copier", "livraison", "panier", "commande", "virement", "valider",
                "beneficiaire", "gratuite"),
    "alemán": ("zahlung", "kasse", "uberweisung", "warenkorb", "bestellen", "versand", "kostenlos"),
    "inglés": ("checkout", "payment", "bank transfer", "shipping", "add to cart", "place order"),
}
SPANISH_WORDS = ("envio", "pago", "pedido", "carrito", "transferencia", "gratis", "datos", "realizado", "condiciones")
CARD_WORDS = ("tarjeta", "visa", "mastercard", "paypal", "apple pay", "google pay", "klarna", "contrareembolso",
              "contra reembolso", "aplazame", "carte bancaire")
TRANSFER_WORDS = ("transferencia", "sepa", "iban", "virement", "uberweisung", "bank transfer")
PRESSURE_RE = re.compile(r"referencia obligatoria|solo hoy|últimas unidades|ultimas unidades|quedan \d+|"
                         r"termina en|tiempo limitado|stock limitado|antes de que se agote", re.I)
IBAN_RE = re.compile(r"\b([A-Z]{2})(\d{2})[ ]?((?:[A-Z0-9]{4}[ ]?){2,7}[A-Z0-9]{1,4})\b")
COMPANY_RE = re.compile(r"\b(s\.?\s?l\.?u?|s\.?\s?a\.?u?|sociedad|gmbh|sas|sarl|ltd|llc|b\.?v\.?|srl|inc|limited|"
                        r"s\.?coop|ag|oy|ab)\b\.?", re.I)
BENEF_LABEL_RE = re.compile(r"benefici(?:ario|aire|ary)|titular(?: de la cuenta)?|a nombre de|empf[aä]nger", re.I)
NAME_AFTER_RE = re.compile(r"[\s:\-]*([^\n\r\t:\d|]{3,60})")
CIF_RE = re.compile(r"\b(?:CIF|NIF)\b|\b[ABCDEFGHJNPQRSUVW]-?\d{7}[0-9A-J]\b")
LEGAL_RE = re.compile(r"aviso legal|mentions l[ée]gales|impressum|condiciones generales|t[ée]rminos y condiciones", re.I)
FREE_MAIL_RE = re.compile(r"[\w.+-]+@(gmail|hotmail|outlook|yahoo|proton|protonmail|gmx|icloud)\.\w+", re.I)
SECOND_LEVEL = {"com", "org", "net", "co", "gob", "edu", "nom"}

LEVEL_ORDER = {"danger": 0, "warn": 1, "info": 2, "ok": 3}


# ------------------------------------------------------------------ utilidades

def _plain(text: str) -> str:
    """minúsculas y sin tildes, para comparar palabras."""
    text = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in text if not unicodedata.combining(c))


def _compact(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", _plain(text))


def registrable(host: str) -> str:
    parts = [p for p in host.lower().strip(".").split(".") if p]
    if len(parts) >= 3 and parts[-2] in SECOND_LEVEL and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def html_to_text(page: str) -> str:
    page = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", page)
    page = re.sub(r"(?i)<br\s*/?>|</(p|div|li|tr|td|th|h\d|label|span)>", "\n", page)
    text = html_mod.unescape(re.sub(r"<[^>]+>", " ", page))
    return re.sub(r"[ \t]+", " ", text)


def _known_domains() -> dict[str, str]:
    raw = storage.load_catalog_raw("stores")
    out = {}
    for s in raw["items"]:
        host = urlparse(s["search_url"].replace("{q}", "x")).hostname or ""
        out[registrable(host)] = s["name"]
    for d in raw.get("trusted_domains", {}).get("list", []):
        out.setdefault(registrable(d), d)
    return out


def _sig(sid: str, level: str, points: int, title: str, detail: str = "") -> dict[str, Any]:
    return {"id": sid, "level": level, "points": points, "title": title, "detail": detail}


# ------------------------------------------------------------------ señales

def domain_signals(url: str, store_name: str | None = None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Señales que sólo dependen de la dirección web (no usan internet)."""
    parsed = urlparse(url if "//" in url else "https://" + url)
    host = (parsed.hostname or "").lower()
    reg = registrable(host)
    label = reg.split(".")[0]
    tld = reg.rsplit(".", 1)[-1]
    info = {"host": host, "domain": reg, "known": None}
    sig: list[dict[str, Any]] = []
    if not host or "." not in host:
        return [_sig("bad_url", "danger", 30, "La dirección no es válida")], info
    known = _known_domains()
    if reg in known:
        info["known"] = known[reg]
        sig.append(_sig("known_store", "ok", -60, f"Tienda conocida: {known[reg]}",
                        "Es el dominio oficial. Si compras en un marketplace (Amazon, eBay…), mira también quién vende."))
        return sig, info
    clabel = _compact(label)
    for token, brand in BRANDS.items():
        if token in clabel:
            sig.append(_sig("lookalike", "danger", 40, f"Imita a {brand} pero no es su web oficial",
                            f"{reg} no es un dominio de {brand}. Es la táctica más común de las tiendas falsas."))
            break
    if parsed.scheme == "http":
        sig.append(_sig("no_https", "danger", 25, "La página no usa conexión segura (https)"))
    if tld in RISKY_TLDS:
        sig.append(_sig("risky_tld", "warn", 15, f"Terminación «.{tld}»",
                        "Barata y muy usada por webs de usar y tirar. Las grandes tiendas españolas usan .es o .com."))
    words = [w for w in GENERIC_WORDS if w.replace("-", "") in clabel]
    if words:
        sig.append(_sig("generic_domain", "warn", 12, "Nombre de dominio genérico",
                        f"Contiene «{', '.join(words)}»: típico de webs creadas para una campaña y luego desaparecer."))
    if re.search(r"\d", label) and re.search(r"[a-z]", label):
        sig.append(_sig("digits_domain", "info", 5, "El dominio mezcla letras y números", reg))
    if store_name:
        cname = _compact(store_name)
        tokens = [t for t in re.split(r"[^a-z0-9]+", _plain(store_name)) if len(t) >= 4]
        if cname and cname not in clabel and clabel not in cname and not any(t in clabel for t in tokens):
            sig.append(_sig("name_mismatch", "warn", 18, "El nombre de la tienda no coincide con la dirección",
                            f"La página dice «{store_name}» pero estás en {reg}. Las tiendas reales cobran en su propio dominio."))
    sig.append(_sig("unknown_store", "info", 15, "Tienda que FindGnga no conoce",
                    "No significa que sea falsa, pero no tenemos referencias de ella."))
    return sig, info


def price_signals(price: float | None, ref: float | None, ref_label: str = "precio oficial") -> list[dict[str, Any]]:
    if not price or not ref:
        return []
    ratio = price / ref
    off = round((1 - ratio) * 100)
    if ratio < 0.6:
        return [_sig("price_too_low", "danger", 35, f"Precio {off} % por debajo del {ref_label} ({ref:.2f} €)",
                     "Ninguna tienda seria vende tan por debajo de coste. Es el cebo típico de las tiendas falsas.")]
    if ratio < 0.75:
        return [_sig("price_low", "warn", 20, f"Precio {off} % por debajo del {ref_label} ({ref:.2f} €)",
                     "Posible, pero raro: compruébalo en otras tiendas antes de pagar.")]
    if ratio <= 1.05:
        return [_sig("price_plausible", "ok", 0, f"Precio razonable frente al {ref_label} ({ref:.2f} €)")]
    return []


def text_signals(text: str, store_name: str | None = None, full_page: bool = False) -> list[dict[str, Any]]:
    """Señales del contenido de la página (texto pegado del pago o HTML de la tienda)."""
    if not text or not text.strip():
        return []
    sig: list[dict[str, Any]] = []
    plain = _plain(text)
    ibans = [(m.group(1), m.group(0)) for m in IBAN_RE.finditer(text.upper()) if m.group(1).isalpha()]
    has_transfer = bool(ibans) or any(w in plain for w in TRANSFER_WORDS)
    has_card = any(w in plain for w in CARD_WORDS)
    if has_transfer and not has_card:
        sig.append(_sig("transfer_only", "danger", 25, "Sólo se puede pagar por transferencia",
                        "Una transferencia no se puede anular como un pago con tarjeta o PayPal. "
                        "Las tiendas falsas la exigen por eso."))
    elif has_transfer:
        sig.append(_sig("transfer_option", "info", 5, "Ofrece pago por transferencia",
                        "Paga con tarjeta o PayPal: te protegen si el pedido no llega."))
    elif has_card:
        sig.append(_sig("card_payment", "ok", -5, "Acepta tarjeta o PayPal"))
    foreign = sorted({cc for cc, _ in ibans if cc != "ES"})
    if foreign:
        sig.append(_sig("foreign_iban", "danger", 25, f"La cuenta bancaria es de otro país ({', '.join(foreign)})",
                        "Una tienda española no tiene motivo para cobrar en una cuenta extranjera."))
    elif ibans:
        sig.append(_sig("es_iban", "info", 5, "Cuenta bancaria española"))
    for m in BENEF_LABEL_RE.finditer(text):
        after = NAME_AFTER_RE.match(text, m.end())
        if not after:
            continue
        name = after.group(1).strip(" .,-")
        words = name.split()
        if not 2 <= len(words) <= 4 or COMPANY_RE.search(name) or not all(w[0].isupper() for w in words):
            continue
        if store_name and _compact(name) == _compact(store_name):
            continue
        sig.append(_sig("person_beneficiary", "danger", 22, "La cuenta está a nombre de una persona, no de una empresa",
                        f"Titular: «{name}». Las tiendas cobran a nombre de su sociedad (S.L., S.A.…)."
                        + (f" Ni siquiera coincide con «{store_name}»." if store_name else "")))
        break
    has_es = sum(w in plain for w in SPANISH_WORDS) >= 2
    for lang, cues in FOREIGN_WORDS.items():
        found = [w for w in cues if re.search(r"\b" + re.escape(w) + r"\b", plain)]
        if found and has_es:
            sig.append(_sig("language_mix", "warn", 15, f"Mezcla español con {lang}",
                            f"Aparece «{', '.join(found[:3])}». Suele ser una plantilla traducida a toda prisa."))
            break
    if PRESSURE_RE.search(text):
        sig.append(_sig("pressure", "info", 5, "Mensajes de urgencia", "Te meten prisa para que no lo pienses."))
    mail = FREE_MAIL_RE.search(text)
    if mail:
        sig.append(_sig("free_email", "warn", 10, "Contacto con correo gratuito", mail.group(0)))
    if full_page:
        if not CIF_RE.search(text) and not LEGAL_RE.search(text):
            sig.append(_sig("no_legal", "warn", 10, "No se ven datos legales (CIF, aviso legal)",
                            "En España toda tienda online debe identificar a su empresa."))
        elif CIF_RE.search(text):
            sig.append(_sig("has_cif", "ok", -5, "Muestra CIF/NIF de empresa", "Compruébalo en el registro mercantil si dudas."))
    return sig


# ------------------------------------------------------------------ en línea

async def domain_age_days(client: httpx.AsyncClient, domain: str, today: date | None = None) -> int | None:
    r = await client.get(f"https://rdap.org/domain/{domain}", timeout=10, follow_redirects=True)
    if r.status_code != 200:
        return None
    for ev in r.json().get("events", []):
        if ev.get("eventAction") == "registration" and ev.get("eventDate"):
            created = datetime.fromisoformat(ev["eventDate"].replace("Z", "+00:00")).date()
            return ((today or date.today()) - created).days
    return None


def age_signal(days: int | None) -> list[dict[str, Any]]:
    if days is None:
        return [_sig("age_unknown", "info", 0, "No se pudo saber la antigüedad del dominio")]
    if days < 90:
        return [_sig("domain_new", "danger", 30, f"El dominio se creó hace {days} días",
                     "Las tiendas falsas se crean para una campaña (Black Friday, lanzamientos) y desaparecen.")]
    if days < 365:
        return [_sig("domain_young", "warn", 15, f"El dominio tiene menos de un año ({days} días)")]
    return [_sig("domain_old", "ok", -10, f"El dominio existe desde hace {days // 365} año(s)")]


# ------------------------------------------------------------------ veredicto

ADVICE = {
    "scam": ["No pagues ni envíes más datos.",
             "Si ya has hecho la transferencia: llama a tu banco ahora y pide recuperarla (cuanto antes, más opciones).",
             "Denuncia en Policía Nacional o Guardia Civil y llama al 017 (INCIBE, gratuito).",
             "Desconfía de SMS o correos sobre «tu pedido»: suelen ser la segunda parte del engaño."],
    "doubtful": ["Paga sólo con tarjeta o PayPal (puedes reclamar si no llega). Nunca por transferencia ni Bizum.",
                 "Busca opiniones fuera de la propia web (Trustpilot, Chollometro, foros).",
                 "Compara el precio en tiendas conocidas con FindGnga antes de decidir."],
    "ok": ["No vemos señales de alarma.",
           "Aun así, paga con tarjeta o PayPal y revisa el total en el carrito."],
}
VERDICT = {"scam": "🚩 Probable estafa", "doubtful": "⚠️ Dudosa: ten cuidado", "ok": "✅ Sin señales de alarma"}


def verdict(signals: list[dict[str, Any]]) -> dict[str, Any]:
    risk = max(0, min(100, sum(s["points"] for s in signals)))
    dangers = sum(s["level"] == "danger" for s in signals)
    level = "scam" if risk >= 60 or dangers >= 2 else "doubtful" if risk >= 25 or dangers else "ok"
    signals.sort(key=lambda s: (LEVEL_ORDER[s["level"]], -s["points"]))
    return {"risk": risk, "verdict": level, "label": VERDICT[level], "advice": ADVICE[level], "signals": signals}


def reference_price(product_id: str | None) -> tuple[float | None, str]:
    if not product_id:
        return None, ""
    for name in ("consoles", "monitors"):
        for p in storage.load_catalog(name):
            if p["id"] == product_id:
                if p.get("msrp"):
                    return float(p["msrp"]), "precio oficial"
                return float(p["ref_price"]), "precio de referencia"
    return None, ""


def quick_check(url: str, store_name: str | None = None, price: float | None = None,
                ref: float | None = None, text: str = "") -> dict[str, Any]:
    """Comprobación sin internet (dirección, precio y texto pegado)."""
    sig, info = domain_signals(url, store_name)
    if not info["known"]:
        sig += price_signals(price, ref)
        sig += text_signals(text, store_name)
    return {**verdict(sig), **info, "online": False}


async def check(url: str, store_name: str | None = None, price: float | None = None, product_id: str | None = None,
                text: str = "", online: bool = True, client: httpx.AsyncClient | None = None,
                today: date | None = None) -> dict[str, Any]:
    ref, ref_label = reference_price(product_id)
    sig, info = domain_signals(url, store_name)
    if info["known"]:
        return {**verdict(sig), **info, "online": False, "ref_price": ref}
    sig += price_signals(price, ref, ref_label)
    sig += text_signals(text, store_name)
    notes: list[str] = []
    if online:
        from .providers.base import new_client
        own = client is None
        client = client or new_client(timeout=10)
        try:
            try:
                sig += age_signal(await domain_age_days(client, info["domain"], today))
            except Exception as exc:
                notes.append(f"antigüedad del dominio: {type(exc).__name__}")
            target = url if "//" in url else "https://" + url
            try:
                r = await client.get(target, timeout=10, follow_redirects=True)
                if r.status_code < 400:
                    page_text = html_to_text(r.text)
                    seen = {s["id"] for s in sig}
                    sig += [s for s in text_signals(page_text, store_name, full_page=True) if s["id"] not in seen]
                    m = re.search(r'<html[^>]*\blang="([a-z]{2})', r.text, re.I)
                    if m and m.group(1).lower() not in ("es", "ca", "gl", "eu") and "language_mix" not in seen:
                        sig.append(_sig("page_lang", "warn", 10, f"La web está declarada en otro idioma ({m.group(1)})"))
                else:
                    notes.append(f"la tienda respondió {r.status_code}")
            except Exception as exc:
                notes.append(f"no se pudo abrir la tienda: {type(exc).__name__}")
        finally:
            if own:
                await client.aclose()
    return {**verdict(sig), **info, "online": online, "notes": notes, "ref_price": ref}
