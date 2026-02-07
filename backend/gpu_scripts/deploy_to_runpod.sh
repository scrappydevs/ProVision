#!/bin/bash
# Deploy ProVision to RunPod
# This script uploads all necessary files to your RunPod GPU instance

set -e

# Configuration (update with your RunPod details)
SSH_HOST="${SSH_HOST:-216.81.248.127}"
SSH_PORT="${SSH_PORT:-15094}"
SSH_USER="${SSH_USER:-root}"
SSH_KEY="${SSH_KEY_FILE:-$HOME/.ssh/id_ed25519}"

echo "=== Deploying ProVision to RunPod ==="
echo "Host: $SSH_USER@$SSH_HOST:$SSH_PORT"

# Test connection
echo "Testing SSH connection..."
ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" "echo 'Connection successful'"

# Create directories
echo "Creating remote directories..."
ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" \
    "mkdir -p /workspace/provision/tracknet /workspace/provision/ttnet"

# Upload setup script
echo "Uploading setup script..."
scp -i "$SSH_KEY" -P "$SSH_PORT" \
    setup_runpod.sh \
    "$SSH_USER@$SSH_HOST:/workspace/provision/"

# Upload model server
echo "Uploading model server..."
scp -i "$SSH_KEY" -P "$SSH_PORT" \
    model_server.py \
    "$SSH_USER@$SSH_HOST:/workspace/provision/"

# Upload start server script
echo "Uploading start server script..."
scp -i "$SSH_KEY" -P "$SSH_PORT" \
    start_server.sh \
    "$SSH_USER@$SSH_HOST:/workspace/provision/"

# Upload TrackNet files
echo "Uploading TrackNet files..."
scp -i "$SSH_KEY" -P "$SSH_PORT" \
    tracknet/model.py tracknet/utils.py \
    "$SSH_USER@$SSH_HOST:/workspace/provision/tracknet/"

# Make scripts executable
echo "Making scripts executable..."
ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" \
    "chmod +x /workspace/provision/*.sh"

# Run setup script
echo ""
echo "=== Running setup script on RunPod ==="
echo "This will download model checkpoints and install dependencies..."
ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" \
    "bash /workspace/provision/setup_runpod.sh"

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "To start the model server:"
echo "  ssh -i $SSH_KEY -p $SSH_PORT $SSH_USER@$SSH_HOST"
echo "  nohup /workspace/provision/start_server.sh > /workspace/provision/server.log 2>&1 &"
echo ""
echo "To check server status:"
echo "  ssh -i $SSH_KEY -p $SSH_PORT $SSH_USER@$SSH_HOST 'curl http://localhost:8765/health'"
echo ""
echo "To view logs:"
echo "  ssh -i $SSH_KEY -p $SSH_PORT $SSH_USER@$SSH_HOST 'tail -f /workspace/provision/server.log'"

