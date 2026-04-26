#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# TradeSelect — runs on EC2 on every push to main (via GitHub Actions)
# ═══════════════════════════════════════════════════════════════════════

set -e

APP_DIR="/opt/tradeselect/app"
LOG="/var/log/tradeselect/deploy.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | sudo tee -a "$LOG" >/dev/null; echo "[$(date '+%H:%M:%S')] $1"; }

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

# Paper-mode: always restart on deploy. New code matters more than zero-
# downtime, since no real broker orders are at risk. (Switch to off-hours-
# only when this graduates to live trading.)
log "restarting tradeselect to load new code"
sudo systemctl restart tradeselect

sleep 3
if systemctl is-active --quiet tradeselect; then
    log "✅ tradeselect running"
else
    log "❌ tradeselect FAILED to start"
    exit 1
fi

log "═══ deploy complete ═══"
