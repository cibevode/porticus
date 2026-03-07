@echo off
cd /d "%~dp0"

echo.
echo ========================================
echo IB Terminal - Porticus Capital
echo ========================================
echo.

:: Quick checks
if not exist "venv" (
    echo ERROR: Run INSTALL.bat first.
    pause
    exit /b 1
)
if not exist "ib_backend.py" (
    echo ERROR: ib_backend.py not found. Check your folder.
    pause
    exit /b 1
)
if not exist "ib-terminal.jsx" (
    echo ERROR: ib-terminal.jsx not found. Check your folder.
    pause
    exit /b 1
)

node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not installed. Get it from https://nodejs.org
    pause
    exit /b 1
)

:: Create React app if needed
if not exist "frontend\package.json" (
    echo Setting up React frontend for the first time...
    echo This takes 1-2 minutes...
    echo.
    call npx create-react-app frontend
    cd /d "%~dp0\frontend"
    call npm install recharts lucide-react lodash
    cd /d "%~dp0"
    echo.
)

:: Copy GUI
if exist "frontend\src\App.js" del "frontend\src\App.js"
copy /Y "ib-terminal.jsx" "frontend\src\App.js" >nul
if exist ".env" copy /Y ".env" "frontend\.env" >nul

:: Start BACKEND in its own visible window
echo Starting backend...
start "BACKEND - IB Terminal" cmd /k "cd /d "%~dp0" && venv\Scripts\activate.bat && echo. && echo BACKEND STARTING... && echo. && python ib_backend.py"

timeout /t 4 /nobreak >nul

:: Start FRONTEND in THIS window
echo Starting frontend...
echo.
echo Backend window should be open behind this one.
echo Browser will open to http://localhost:3000
echo.
cd /d "%~dp0\frontend"
npm start
