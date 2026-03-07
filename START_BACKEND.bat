@echo off
echo ========================================
echo IB Terminal - Porticus Capital
echo Starting Backend Server...
echo ========================================
echo.

if not exist "venv" (
    echo ERROR: Run INSTALL.bat first.
    pause
    exit /b 1
)

call venv\Scripts\activate.bat

echo Backend starting on http://localhost:8000
echo API docs at http://localhost:8000/docs
echo WebSocket at ws://localhost:8000/ws
echo.
echo Press Ctrl+C to stop.
echo ========================================
echo.

python ib_backend.py

pause
