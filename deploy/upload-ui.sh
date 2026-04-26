#!/bin/bash
# Build the React UI locally and rsync to the EC2 server.
# Server has only 1GB RAM and OOMs running `max build` itself.
#
# Usage: bash deploy/upload-ui.sh

set -e

KEY="/Users/vgopiraja/Documents/LuckyNavi/Honeydaalu-key.pem"
HOST="3.109.167.163"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "→ building UI locally"
cd "$REPO_ROOT"
NODE_OPTIONS=--max-old-space-size=4096 npm run build

echo "→ rsyncing dist/ to server"
rsync -az --delete -e "ssh -i $KEY" "$REPO_ROOT/dist/" "ubuntu@$HOST:/tmp/tradeselect-dist/"

echo "→ moving into place + restarting"
ssh -i "$KEY" ubuntu@$HOST '
  sudo rm -rf /opt/tradeselect/app/dist
  sudo mv /tmp/tradeselect-dist /opt/tradeselect/app/dist
  sudo chown -R tradeselect:tradeselect /opt/tradeselect/app/dist
  sudo systemctl restart tradeselect
  sleep 3
  systemctl is-active tradeselect
'
echo "✅ UI uploaded"
