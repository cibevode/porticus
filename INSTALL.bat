@echo off
setlocal enabledelayedexpansion

echo.
echo ============================================================
echo   IB Terminal - Porticus Capital
echo   Full Installation + Configuration
echo ============================================================
echo.

:: ─── Step 1: Find Python ──────────────────────────────────
echo [1/6] Checking Python...

python --version >nul 2>&1
if errorlevel 1 (
    py --version >nul 2>&1
    if errorlevel 1 (
        echo.
        echo   ERROR: Python not found in PATH.
        echo.
        echo   Python IS installed but Windows can't find it.
        echo   Fix: Open Settings ^> Apps ^> Manage App Execution Aliases
        echo         Turn OFF "App Installer" entries for python.exe and python3.exe
        echo   Then re-run this installer.
        echo.
        echo   OR: Reinstall Python from python.org and CHECK
        echo       "Add Python to PATH" during installation.
        echo.
        pause
        exit /b 1
    )
    :: 'py' works but 'python' doesn't — set alias
    set PYTHON=py
    echo   Found: & py --version
) else (
    set PYTHON=python
    echo   Found: & python --version
)
echo.

:: ─── Step 2: Fix execution policy for PowerShell ──────────
echo [2/6] Setting execution policy...
powershell -Command "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force" >nul 2>&1
echo   Done.
echo.

:: ─── Step 3: Create virtual environment ───────────────────
echo [3/6] Creating virtual environment...
if not exist "venv" (
    %PYTHON% -m venv venv
    if errorlevel 1 (
        echo   ERROR: Failed to create virtual environment.
        echo   Try: %PYTHON% -m pip install --upgrade pip
        pause
        exit /b 1
    )
    echo   Created.
) else (
    echo   Already exists, skipping.
)
echo.

:: ─── Step 4: Install Python dependencies ──────────────────
echo [4/6] Installing Python dependencies...
call venv\Scripts\activate.bat
python -m pip install --upgrade pip >nul 2>&1
pip install fastapi uvicorn[standard] ib_async websockets pydantic
if errorlevel 1 (
    echo.
    echo   ERROR: pip install failed.
    echo   Check your internet connection and try again.
    pause
    exit /b 1
)
echo.

:: ─── Step 6: Done ─────────────────────────────────────────
echo [5/5] Checking Node.js (for frontend)...
node --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo   Node.js not found. The backend will work without it,
    echo   but you need Node.js for the React frontend.
    echo.
    echo   Download from: https://nodejs.org (LTS version)
    echo   Install it, then run START_FRONTEND.bat later.
    echo.
    set NODEOK=0
) else (
    echo   Found: & node --version
    set NODEOK=1
)

echo.
echo ============================================================
echo   INSTALLATION COMPLETE
echo ============================================================
echo.
echo   TO RUN:
echo.
echo   1. Make sure IB Gateway is running
echo      (Enable API: Configure ^> Settings ^> API)
echo.
echo   2. Double-click START.bat
echo      (starts everything - backend + frontend)
echo      (first run takes 1-2 minutes to set up React)
echo.
echo   3. Configure your accounts in the GUI:
echo      Go to the ACCOUNTS tab to set your ports
echo      and connection details. Changes save automatically.
echo.
echo   TIP: Start with paper trading (port 4002) to test safely.
echo.
echo ============================================================
pause
