#!/usr/bin/env bash
# Arranca FindGnga en http://127.0.0.1:8000 (crea el entorno la primera vez)
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
fi
exec .venv/bin/uvicorn findgnga.main:app --host 127.0.0.1 --port "${PORT:-8000}" "$@"
