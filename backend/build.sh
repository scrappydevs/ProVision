#!/bin/bash
set -e

echo "==> Installing Python dependencies..."
pip install -r requirements.txt

echo "==> Setting up PO Token server for YouTube bot bypass..."
# Clone into the project directory (persists across build -> deploy on Render)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
POT_DIR="$SCRIPT_DIR/pot-server"

if [ -d "$POT_DIR/server/build/main.js" ]; then
    echo "==> PO Token server already built, skipping..."
else
    echo "==> Cloning PO Token server..."
    rm -rf "$POT_DIR"
    git clone --single-branch --branch 1.2.2 \
        https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git "$POT_DIR" || {
        echo "WARNING: Failed to clone PO Token server (non-fatal)"
        exit 0
    }
    cd "$POT_DIR/server"
    echo "==> Installing Node.js dependencies..."
    npm install
    echo "==> Compiling TypeScript..."
    npx tsc
    echo "==> PO Token server built at $POT_DIR/server/build/main.js"
    ls -la build/main.js 2>/dev/null || echo "WARNING: main.js not found after tsc"
fi

echo "==> Build complete"
