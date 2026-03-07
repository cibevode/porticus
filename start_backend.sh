#!/bin/bash

echo "============================================================"
echo "  IB Terminal - Porticus Capital"
echo "  Starting Backend Server..."
echo "============================================================"
echo ""

if [ ! -d "venv" ]; then
    echo "ERROR: Run ./install.sh first."
    exit 1
fi

source venv/bin/activate

echo "Backend starting on http://localhost:8000"
echo "API docs at http://localhost:8000/docs"
echo "WebSocket at ws://localhost:8000/ws"
echo ""
echo "Press Ctrl+C to stop."
echo "============================================================"
echo ""

python ib_backend.py
