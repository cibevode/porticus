#!/bin/bash

echo "============================================================"
echo "  IB Terminal - Porticus Capital"
echo "  Starting Frontend..."
echo "============================================================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js not installed."
    echo ""
    echo "Install:"
    echo "  macOS:  brew install node"
    echo "  Ubuntu: sudo apt install nodejs npm"
    echo "  Or:     https://nodejs.org"
    exit 1
fi

echo "Found Node.js: $(node --version)"
echo ""

# Create React app if doesn't exist
if [ ! -d "frontend" ]; then
    echo "Setting up React frontend for the first time..."
    echo "This takes 1-2 minutes..."
    echo ""
    npx create-react-app frontend

    # Install extra dependencies
    cd frontend
    npm install recharts lucide-react lodash
    cd ..

    echo ""
    echo "React app created."
fi

# Copy latest GUI
echo "Copying latest GUI..."
rm -f frontend/src/App.js frontend/src/App.jsx
cp ib-terminal.jsx frontend/src/App.js

# Copy .env if it exists
if [ -f ".env" ]; then
    cp .env frontend/.env
fi

# Copy sound files
if [ -d "public/sounds" ]; then
    mkdir -p frontend/public/sounds
    cp public/sounds/* frontend/public/sounds/ 2>/dev/null
fi

# Add proxy if not already there
if ! grep -q "proxy" frontend/package.json; then
    echo "Adding backend proxy setting..."
    if [ "$(uname)" = "Darwin" ]; then
        sed -i '' 's/"private": true,/"private": true, "proxy": "http:\/\/localhost:8000",/' frontend/package.json
    else
        sed -i 's/"private": true,/"private": true, "proxy": "http:\/\/localhost:8000",/' frontend/package.json
    fi
fi

echo ""
echo "============================================================"
echo "Frontend starting on http://localhost:3000"
echo ""
echo "Make sure the backend is running first!"
echo "(./start_backend.sh in another terminal)"
echo ""
echo "Press Ctrl+C to stop."
echo "============================================================"
echo ""

cd frontend
npm start
