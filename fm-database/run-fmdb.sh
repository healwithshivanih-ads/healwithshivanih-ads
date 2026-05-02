#!/bin/bash
# Launch the FM Database web UI at http://localhost:8501
#
# This script is robust against the "streamlit module-cache stale import"
# class of failure: it kills any existing streamlit, clears Python bytecode
# caches, and starts fresh every time.
#
# Usage:  ./run-fmdb.sh
set -e
cd "$(dirname "$0")"

echo "→ killing any existing streamlit processes..."
pkill -9 -f "streamlit run" 2>/dev/null || true
pkill -9 -f "fmdb_ui" 2>/dev/null || true
sleep 1

echo "→ clearing Python bytecode caches..."
find . -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true

echo "→ checking port 8501..."
if lsof -i :8501 -t >/dev/null 2>&1; then
    echo "  port 8501 still in use; killing whatever's holding it..."
    lsof -i :8501 -t | xargs kill -9 2>/dev/null || true
    sleep 1
fi

echo "→ starting streamlit at http://localhost:8501"
echo ""
exec .venv/bin/streamlit run fmdb_ui/app.py \
    --server.headless true \
    --browser.gatherUsageStats false \
    --server.runOnSave false
