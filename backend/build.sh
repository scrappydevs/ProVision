#!/bin/bash
set -e

echo "==> Installing Python dependencies..."
pip install -r requirements.txt

echo "==> Setting up PO Token server for YouTube bot bypass..."
# Clone the bgutil PO token provider (Node.js server)
POT_DIR="$HOME/bgutil-ytdlp-pot-provider"
if [ -d "$POT_DIR" ]; then
    echo "==> PO Token server already exists, updating..."
    cd "$POT_DIR" && git fetch && git checkout 1.2.2 2>/dev/null || true
    cd server && npm install && npx tsc
else
    echo "==> Cloning PO Token server..."
    git clone --single-branch --branch 1.2.2 \
        https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git "$POT_DIR" || {
        echo "WARNING: Failed to clone PO Token server (non-fatal)"
        exit 0
    }
    cd "$POT_DIR/server"
    npm install && npx tsc
fi

echo "==> Build complete"
