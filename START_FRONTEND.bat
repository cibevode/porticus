@echo off
echo ========================================
echo IB Terminal - Porticus Capital
echo Starting Frontend...
echo ========================================
echo.

:: Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed.
    echo.
    echo Download from: https://nodejs.org
    echo Get the LTS version. Install it, then re-run this.
    echo.
    pause
    exit /b 1
)

echo Found Node.js:
node --version
echo.

:: Create React app if it doesn't exist
if not exist "frontend" (
    echo Setting up React frontend for the first time...
    echo This takes 1-2 minutes...
    echo.
    npx create-react-app frontend
    
    :: Install extra dependencies
    cd frontend
    npm install recharts lucide-react lodash
    cd ..
    
    echo.
    echo React app created.
)

:: Copy the latest GUI into the React app
echo Copying latest GUI...
if exist frontend\src\App.js del frontend\src\App.js
if exist frontend\src\App.jsx del frontend\src\App.jsx
copy /Y ib-terminal.jsx frontend\src\App.js >nul

:: Copy .env if it exists
if exist .env copy /Y .env frontend\.env >nul

:: Copy sound files
if exist public\sounds (
    if not exist frontend\public\sounds mkdir frontend\public\sounds
    xcopy /Y /Q public\sounds\* frontend\public\sounds\ >nul 2>&1
)

:: Add proxy to package.json if not already there
findstr /C:"proxy" frontend\package.json >nul 2>&1
if errorlevel 1 (
    echo Adding backend proxy setting...
    powershell -Command "(Get-Content frontend\package.json) -replace '\"private\": true,', '\"private\": true, \"proxy\": \"http://localhost:8000\",' | Set-Content frontend\package.json"
)

:: Start
echo.
echo ========================================
echo Frontend starting on http://localhost:3000
echo.
echo Make sure the backend is running first!
echo (Double-click START_BACKEND.bat)
echo.
echo Press Ctrl+C to stop.
echo ========================================
echo.

cd frontend
npm start

pause
