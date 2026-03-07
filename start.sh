#!/bin/bash
echo "========================================"
echo "IB Terminal - Porticus Capital"
echo "========================================"
echo ""

if [ ! -d "venv" ]; then
    echo "First time? Run ./install.sh first."
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js not installed."
    echo "Install: brew install node (Mac) or sudo apt install nodejs npm (Linux)"
    exit 1
fi

# Create React app if first run
if [ ! -d "frontend" ]; then
    echo "First run — setting up React frontend..."
    echo "This takes 1-2 minutes..."
    echo ""
    npx create-react-app frontend
    cd frontend
    npm install recharts lucide-react lodash
    cd ..
    echo ""
    echo "React app created."
    echo ""
fi

# Copy latest GUI
rm -f frontend/src/App.js frontend/src/App.jsx
cp ib-terminal.jsx frontend/src/App.js
if [ -f ".env" ]; then cp .env frontend/.env; fi
if [ -d "public/sounds" ]; then
    mkdir -p frontend/public/sounds
    cp public/sounds/* frontend/public/sounds/ 2>/dev/null
fi

# Add proxy if not already there
if ! grep -q "proxy" frontend/package.json; then
    if [ "$(uname)" = "Darwin" ]; then
        sed -i '' 's/"private": true,/"private": true, "proxy": "http:\/\/localhost:8000",/' frontend/package.json
    else
        sed -i 's/"private": true,/"private": true, "proxy": "http:\/\/localhost:8000",/' frontend/package.json
    fi
fi

# Start backend in background
echo "Starting backend..."
source venv/bin/activate
python ib_backend.py &
BACKEND_PID=$!

sleep 3

# Start frontend
echo "Starting frontend..."
cd frontend
npm start

# Cleanup on exit
kill $BACKEND_PID 2>/dev/null
