#!/usr/bin/env bash
# Arranca FindGnga en http://127.0.0.1:8000 (macOS / Linux).
# La primera vez crea el entorno (.venv) e instala dependencias; después sólo
# reinstala si cambia requirements.txt.
set -euo pipefail
cd "$(dirname "$0")"

PY=""
for cand in python3.13 python3.12 python3.11 python3.10 python3 python; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
    PY="$cand"; break
  fi
done
if [ -z "$PY" ]; then
  echo "❌ Necesitas Python 3.10 o superior. Instálalo desde https://www.python.org/downloads/ (o 'brew install python')." >&2
  exit 1
fi

if [ ! -x .venv/bin/python ] || ! .venv/bin/python -c 'import sys' 2>/dev/null; then
  echo "→ Creando entorno con $($PY --version)…"
  rm -rf .venv
  "$PY" -m venv .venv
fi

STAMP=.venv/.requirements.sha
HASH=$( (command -v shasum >/dev/null && shasum requirements.txt || sha1sum requirements.txt) | cut -d' ' -f1)
if [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$HASH" ]; then
  echo "→ Instalando dependencias…"
  .venv/bin/python -m pip install -q --upgrade pip
  .venv/bin/python -m pip install -q -r requirements.txt
  echo "$HASH" > "$STAMP"
fi

PORT="${PORT:-8000}"
echo "✅ FindGnga en http://127.0.0.1:$PORT  (Ctrl+C para parar)"
if command -v open >/dev/null 2>&1 && [ -z "${NO_BROWSER:-}" ]; then (sleep 2 && open "http://127.0.0.1:$PORT") & fi
exec .venv/bin/python -m uvicorn findgnga.main:app --host 127.0.0.1 --port "$PORT" "$@"
