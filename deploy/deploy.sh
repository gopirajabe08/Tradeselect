#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# TradeSelect — runs on EC2 on every push to main (via GitHub Actions)
# ═══════════════════════════════════════════════════════════════════════

set -e

APP_DIR="/opt/tradeselect/app"
LOG="/var/log/tradeselect/deploy.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"; }

log "═══ deploy started ═══"

cd "$APP_DIR"
sudo -u tradeselect git fetch origin main
sudo -u tradeselect git reset --hard origin/main
log "code @ $(git rev-parse --short HEAD)"

# install deps if package files changed
if git diff HEAD~1 --name-only | grep -qE "package(-lock)?\.json"; then
    log "deps changed — npm install"
    sudo -u tradeselect npm install --production=false --silent
else
    log "no dep change"
fi

# build frontend if src/ or .umirc.ts changed (or first time)
if git diff HEAD~1 --name-only | grep -qE "src/|.umirc\.ts" || [ ! -d "$APP_DIR/dist" ]; then
    log "frontend changed — building"
    sudo -u tradeselect npm run build --silent || log "build skipped (no build script)"
fi

# restart only outside market hours OR if not running
HOUR=$(TZ="Asia/Kolkata" date +%H)
MIN=$(TZ="Asia/Kolkata" date +%M)
IST="${HOUR}${MIN}"

if [ "$IST" -lt "0915" ] || [ "$IST" -gt "1545" ]; then
    log "off-hours — restarting"
    sudo systemctl restart tradeselect
elif ! systemctl is-active --quiet tradeselect; then
    log "service down — starting"
    sudo systemctl start tradeselect
else
    log "market hours and service running — skipping restart (will pick up on next off-hours deploy)"
fi

sleep 3
if systemctl is-active --quiet tradeselect; then
    log "✅ tradeselect running"
else
    log "❌ tradeselect FAILED to start"
    exit 1
fi

log "═══ deploy complete ═══"
