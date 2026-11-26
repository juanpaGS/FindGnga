import pytest


@pytest.fixture(autouse=True)
def user_dir(tmp_path, monkeypatch):
    """Cada test usa una carpeta de usuario vacía (no toca data/user)."""
    monkeypatch.setenv("FINDGNGA_USER_DIR", str(tmp_path))
    return tmp_path
