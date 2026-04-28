#!/bin/bash
# Build TradeSelect locally, rsync standalone bundle to /opt/ts-app/ on EC2.
# Does NOT touch /opt/tradeselect/ (TradeAuto).

set -e

KEY="/Users/vgopiraja/Documents/LuckyNavi/Honeydaalu-key.pem"
HOST="3.109.167.163"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$REPO_ROOT"

echo "→ building Next.js (standalone)"
NODE_OPTIONS=--max-old-space-size=4096 npm run build

# Standalone produces: .next/standalone/server.js + minimal node_modules
# Plus: .next/static/ (must be served alongside) and public/ (raw assets)
echo "→ assembling deploy bundle"
rm -rf /tmp/ts-deploy
mkdir -p /tmp/ts-deploy
cp -r .next/standalone/. /tmp/ts-deploy/
mkdir -p /tmp/ts-deploy/.next
cp -r .next/static /tmp/ts-deploy/.next/static
# public/ is optional — if no static assets, skip
[ -d public ] && cp -r public /tmp/ts-deploy/public || mkdir -p /tmp/ts-deploy/public

echo "→ rsyncing to /opt/ts-app/staging"
ssh -i "$KEY" ubuntu@$HOST "sudo -u tsapp mkdir -p /opt/ts-app/staging"
rsync -az --delete -e "ssh -i $KEY" --rsync-path="sudo -u tsapp rsync" /tmp/ts-deploy/ ubuntu@$HOST:/opt/ts-app/staging/

echo "→ atomic swap + restart"
ssh -i "$KEY" ubuntu@$HOST '
  set -e
  # Move staging contents into /opt/ts-app/ (preserving .env.local + .local-data/)
  cd /opt/ts-app
  # Clean only the build artefacts, NOT the runtime data dirs
  sudo rm -rf node_modules .next public server.js package.json
  # shopt -s dotglob so .next/ (the build artefacts) gets moved too
  shopt -s dotglob
  for f in /opt/ts-app/staging/*; do
    name=$(basename "$f")
    [ "$name" = ".local-data" ] && continue # never overwrite runtime data
    sudo mv "$f" /opt/ts-app/
  done
  shopt -u dotglob
  sudo chown -R tsapp:tsapp /opt/ts-app/.next /opt/ts-app/public /opt/ts-app/server.js /opt/ts-app/node_modules /opt/ts-app/package.json 2>/dev/null || true
  sudo rm -rf /opt/ts-app/staging

  sudo systemctl restart tsapp
  sleep 4
  systemctl is-active tsapp
'
echo "✅ TradeSelect deployed to /opt/ts-app/, service tsapp restarted"
