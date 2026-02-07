#!/bin/bash
# Start frontend with Infisical secrets injection

cd "$(dirname "$0")/../frontend"

if command -v infisical &> /dev/null; then
    echo "🔐 Starting frontend with Infisical secrets..."
    infisical run --env=dev -- pnpm dev
else
    echo "⚠️  Infisical CLI not found. Using local .env.local fallback..."
    echo "   Install Infisical: https://infisical.com/docs/cli/overview"
    pnpm dev
fi
