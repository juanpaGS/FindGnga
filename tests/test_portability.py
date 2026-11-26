import asyncio

from fastapi.testclient import TestClient

from findgnga import backup, doctor, storage
from findgnga.main import app


def test_doctor_local_checks_pass_on_fresh_install():
    r = asyncio.run(doctor.run(network=False))
    assert r["errors"] == 0
    assert {c["name"] for c in r["checks"]} >= {"Python", "Dependencias", "Carpeta de datos", "Catálogo (data/*.json)"}


def test_backup_roundtrip_without_key(tmp_path, monkeypatch):
    storage.write_user("profile", {"devices": [{"id": "m", "kind": "mac_laptop"}], "uses": []})
    storage.write_user("settings", {"serpapi_key": "secreto123456", "verify_top": 3})
    data = backup.export()
    assert "serpapi_key" not in data["data"]["settings"]
    assert "serpapi_key" in backup.export(include_key=True)["data"]["settings"]
    # "otro ordenador": carpeta vacía
    monkeypatch.setenv("FINDGNGA_USER_DIR", str(tmp_path / "otro"))
    assert set(backup.restore(data)) == {"profile", "settings"}
    assert storage.read_user("profile", {})["devices"][0]["kind"] == "mac_laptop"
    assert storage.read_user("settings", {})["verify_top"] == 3


def test_restore_rejects_foreign_file():
    client = TestClient(app)
    assert client.post("/api/backup", json={"hola": 1}).status_code == 400
    assert client.get("/api/doctor?network=false").json()["errors"] == 0
