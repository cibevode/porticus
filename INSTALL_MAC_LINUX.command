#!/bin/bash
# ============================================================
# IB Terminal - Porticus Capital
# Universal Installer
#
# WINDOWS:  Double-click INSTALL.bat instead
# MAC:      Double-click this file (opens in Terminal)
#           Or: chmod +x install.sh && ./install.sh
# LINUX:    chmod +x install.sh && ./install.sh
# ============================================================

# Make all scripts executable
chmod +x install.sh start_backend.sh start_frontend.sh 2>/dev/null

# Run the installer
./install.sh
