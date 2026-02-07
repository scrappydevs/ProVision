#!/bin/bash
# Start backend with Infisical secrets injection

cd "$(dirname "$0")/../backend"

if command -v infisical &> /dev/null; then
    echo "🔐 Starting backend with Infisical secrets..."
    infisical run --env=dev -- python3 run.py
else
    echo "⚠️  Infisical CLI not found. Using local .env fallback..."
    echo "   Install Infisical: https://infisical.com/docs/cli/overview"
    python3 run.py
fi
