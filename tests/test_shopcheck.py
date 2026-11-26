import asyncio
from datetime import date

import httpx
from fastapi.testclient import TestClient

from findgnga import shopcheck
from findgnga.main import app
from findgnga.providers import verify

# Texto de una página de pago falsa (datos de ejemplo, no reales)
FAKE_CHECKOUT = """Paiement sécurisé
Datos y envío  2 Pago
Transferencia SEPA
Datos bancarios facilitados · 1-3 días laborables
Realiza una transferencia bancaria inmediata a la cuenta indicada. Comprueba con atención el nombre del beneficiario para evitar cualquier rechazo de tu transferencia.
Datos bancarios del beneficiario
BENEFICIARIO\tAna Pérez Ruiz
IBAN\tDE02 1234 5678 9012 3456 78\tCopier
BIC / SWIFT\tABCDDEFFXXX\tCopier
REFERENCIA OBLIGATORIA HS-XXXX
Tu pedido · PlayStation 5 Slim · Envío Gratis · Total con IVA 349,99 €
He realizado la transferencia de 349,99 €"""


def ids(r):
    return {s["id"] for s in r["signals"]}


def run(coro):
    return asyncio.run(coro)


def test_fake_checkout_is_scam_offline():
    r = run(shopcheck.check("https://garantie-ejemplo2.com/checkout", "Casa Verdal", 349.99,
                            "ps5-slim-digital", FAKE_CHECKOUT, online=False))
    assert r["verdict"] == "scam" and r["risk"] >= 60
    assert {"price_too_low", "transfer_only", "foreign_iban", "person_beneficiary",
            "name_mismatch", "language_mix"} <= ids(r)
    benef = next(s for s in r["signals"] if s["id"] == "person_beneficiary")
    assert "Ana Pérez Ruiz" in benef["detail"]
    assert r["signals"][0]["level"] == "danger"


def test_known_store_is_ok():
    r = run(shopcheck.check("https://www.amazon.es/dp/B0TEST", "Amazon.es", 579, "ps5-slim-digital", online=False))
    assert r["verdict"] == "ok" and "known_store" in ids(r)
    r = run(shopcheck.check("https://store.playstation.com/es-es/", None, None, None, online=False))
    assert r["verdict"] == "ok"


def test_lookalike_domain():
    r = run(shopcheck.check("http://amazon-ofertas.shop/ps5", None, 299, "ps5-slim-digital", online=False))
    assert r["verdict"] == "scam"
    assert {"lookalike", "risky_tld", "no_https", "generic_domain"} <= ids(r)


def test_company_beneficiary_and_card_not_flagged():
    text = "Formas de pago: tarjeta, PayPal o transferencia. Beneficiario: Tiendas Ejemplo S.L. IBAN ES12 3456 7890 1234 5678 9012"
    r = run(shopcheck.check("https://tiendasejemplo.es", "Tiendas Ejemplo", 560, "ps5-slim-digital", text, online=False))
    assert "person_beneficiary" not in ids(r) and "transfer_only" not in ids(r) and "foreign_iban" not in ids(r)
    assert r["verdict"] != "scam"


def test_online_checks_domain_age_and_page():
    page = '<html lang="fr"><body>Paiement par virement uniquement. Contact: soporte.tienda@gmail.com</body></html>'

    def handler(req: httpx.Request):
        if req.url.host == "rdap.org":
            return httpx.Response(200, json={"events": [{"eventAction": "registration", "eventDate": "2026-11-10T08:00:00Z"}]})
        return httpx.Response(200, text=page)

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await shopcheck.check("https://nueva-tienda.com", None, None, None, client=c, today=date(2026, 11, 26))
    r = run(go())
    assert {"domain_new", "free_email", "no_legal", "page_lang", "transfer_only"} <= ids(r)
    assert next(s for s in r["signals"] if s["id"] == "domain_new")["title"].startswith("El dominio se creó hace 16 días")


def test_engine_assess_flags_fake_store():
    offers = [
        {"store": "amazon", "store_name": "Amazon.es", "price": 589, "url": "https://www.amazon.es/x", "provider": "serpapi",
         "condition": "new", "final_price": 589},
        {"store": "x-ps5outlet", "store_name": "PS5 Outlet", "price": 349, "url": "https://ps5-outlet.shop/p",
         "provider": "serpapi", "condition": "new", "final_price": 349},
        {"store": "x-google", "store_name": "Tienda X", "price": 580, "url": "https://www.google.com/shopping/x",
         "provider": "serpapi", "condition": "new", "final_price": 580},
    ]
    verify.assess(offers, ref=599.99)
    fake = offers[1]
    assert fake["suspicious"] and fake["shop_risk"]["verdict"] == "scam"
    assert any("tienda falsa" in w for w in fake["warnings"])
    assert "shop_risk" not in offers[2]  # enlace de comparador: no se juzga el dominio


def test_api_shopcheck():
    c = TestClient(app)
    r = c.post("/api/shopcheck", json={"url": "garantie-ejemplo2.com", "price": 349.99, "product_id": "ps5-slim-digital",
                                       "text": FAKE_CHECKOUT, "online": False})
    assert r.status_code == 200 and r.json()["verdict"] == "scam"
    assert c.post("/api/shopcheck", json={"url": ""}).status_code == 422
