@echo off
REM Arranca FindGnga en http://127.0.0.1:8000 (Windows). Requiere Python 3.10+ (python.org, marca "Add to PATH").
setlocal
cd /d "%~dp0"
where py >nul 2>nul && (set "PY=py -3") || (set "PY=python")
%PY% -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" 2>nul
if errorlevel 1 (
  echo Necesitas Python 3.10 o superior: https://www.python.org/downloads/
  pause
  exit /b 1
)
if not exist .venv\Scripts\python.exe (
  echo Creando entorno...
  %PY% -m venv .venv || exit /b 1
)
if not exist .venv\.installed (
  echo Instalando dependencias...
  .venv\Scripts\python.exe -m pip install -q --upgrade pip
  .venv\Scripts\python.exe -m pip install -q -r requirements.txt || exit /b 1
  echo ok> .venv\.installed
)
if "%PORT%"=="" set PORT=8000
echo FindGnga en http://127.0.0.1:%PORT%  (Ctrl+C para parar)
start "" http://127.0.0.1:%PORT%
.venv\Scripts\python.exe -m uvicorn findgnga.main:app --host 127.0.0.1 --port %PORT%
