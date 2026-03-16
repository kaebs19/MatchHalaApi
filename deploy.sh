#!/bin/bash
# MatchHala API Deploy Script
# Deploys latest code from GitHub to production server

set -e

SERVER="root@72.61.102.206"
REMOTE_PATH="/var/www/MatchHalaApi"

echo "=== MatchHala API Deployment ==="

echo "[1/5] Pulling latest code from GitHub..."
ssh $SERVER "cd $REMOTE_PATH/backend && git pull origin main"

echo "[2/5] Syncing files to server root..."
ssh $SERVER "cd $REMOTE_PATH && rsync -av --exclude='node_modules' --exclude='.env' --exclude='.git' --exclude='uploads' backend/ ./"

echo "[3/5] Syncing default uploads..."
ssh $SERVER "cd $REMOTE_PATH && mkdir -p uploads/defaults && cp -r backend/uploads/defaults/* uploads/defaults/ 2>/dev/null || true"

echo "[4/5] Installing dependencies..."
ssh $SERVER "cd $REMOTE_PATH && npm install --production"

echo "[5/5] Restarting PM2..."
ssh $SERVER "pm2 restart matchhala-api"

echo ""
echo "=== Deployment Complete ==="
ssh $SERVER "pm2 show matchhala-api | grep -E 'status|uptime|restarts'"
