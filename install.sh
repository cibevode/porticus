#!/bin/bash

echo ""
echo "============================================================"
echo "  IB Terminal - Porticus Capital"
echo "  Full Installation + Configuration"
echo "  Linux / macOS"
echo "============================================================"
echo ""

# ─── Step 1: Find Python ──────────────────────────────────
echo "[1/6] Checking Python..."

PYTHON=""
if command -v python3 &> /dev/null; then
    PYTHON="python3"
elif command -v python &> /dev/null; then
    PYTHON="python"
fi

if [ -z "$PYTHON" ]; then
    echo ""
    echo "  ERROR: Python not found."
    echo ""
    echo "  Install Python 3.10+:"
    echo "    macOS:  brew install python3"
    echo "    Ubuntu: sudo apt install python3 python3-venv python3-pip"
    echo "    Fedora: sudo dnf install python3 python3-pip"
    echo ""
    exit 1
fi

echo "  Found: $($PYTHON --version)"
echo ""

# Check for venv module (Ubuntu sometimes needs it separately)
$PYTHON -m venv --help &> /dev/null
if [ $? -ne 0 ]; then
    echo "  Python venv module not found."
    echo "  Install it:"
    echo "    Ubuntu/Debian: sudo apt install python3-venv"
    echo ""
    exit 1
fi

# ─── Step 2: Create virtual environment ───────────────────
echo "[2/6] Creating virtual environment..."

if [ ! -d "venv" ]; then
    $PYTHON -m venv venv
    if [ $? -ne 0 ]; then
        echo "  ERROR: Failed to create virtual environment."
        exit 1
    fi
    echo "  Created."
else
    echo "  Already exists, skipping."
fi
echo ""

# ─── Step 3: Install Python dependencies ──────────────────
echo "[3/6] Installing Python dependencies..."

source venv/bin/activate
pip install --upgrade pip > /dev/null 2>&1
pip install fastapi "uvicorn[standard]" ib_async websockets pydantic

if [ $? -ne 0 ]; then
    echo ""
    echo "  ERROR: pip install failed."
    echo "  Check your internet connection and try again."
    exit 1
fi
echo ""

# ─── Step 4: Check Node.js ────────────────────────────────
echo "[4/5] Checking Node.js (for frontend)..."

NODEOK=0
if command -v node &> /dev/null; then
    echo "  Found: $(node --version)"
    NODEOK=1
else
    echo ""
    echo "  Node.js not found. Backend works without it,"
    echo "  but you need it for the React frontend."
    echo ""
    echo "  Install:"
    echo "    macOS:  brew install node"
    echo "    Ubuntu: sudo apt install nodejs npm"
    echo "    Or:     https://nodejs.org (LTS version)"
fi
echo ""

# ─── Step 5: Make start scripts executable ─────────────────
echo "[5/5] Setting up start scripts..."

chmod +x start_backend.sh start_frontend.sh start.sh 2>/dev/null
echo "  Done."
echo ""

echo ""
echo "============================================================"
echo "  INSTALLATION COMPLETE"
echo "============================================================"
echo ""
echo "  TO RUN:"
echo ""
echo "  1. Make sure IB Gateway is running"
echo "     (Enable API: Configure > Settings > API)"
echo ""
echo "  2. Run: ./start.sh"
echo "     (starts everything - backend + frontend)"
echo "     (first run takes 1-2 minutes to set up React)"
echo ""
echo "  3. Configure your accounts in the GUI:"
echo "     Go to the ACCOUNTS tab to set your ports"
echo "     and connection details. Changes save automatically."
echo ""
echo "  TIP: Start with paper trading (port 4002) to test safely."
echo ""
echo "============================================================"
