#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# Push local creds to EC2 .env — run from Mac
# Reads /Users/vgopiraja/Documents/LuckyNavi/.tradeselect-creds and
# scp's it to the server as /opt/tradeselect/app/.env
#
# Usage: bash deploy/update-env.sh
# ═══════════════════════════════════════════════════════════════════════

set -e

CREDS_FILE="/Users/vgopiraja/Documents/LuckyNavi/.tradeselect-creds"
KEY="/Users/vgopiraja/Documents/LuckyNavi/Honeydaalu-key.pem"
HOST="3.109.167.163"

if [ ! -f "$CREDS_FILE" ]; then
    echo "❌ creds file not found: $CREDS_FILE"
    exit 1
fi

# Build .env content combining server-side defaults + creds
TMP=$(mktemp)
cat > "$TMP" << 'ENVEOF'
NODE_ENV=production
MOCK_PORT=4001
TRADESELECT_MODE=paper
ENVEOF
grep -vE "^#|^$" "$CREDS_FILE" >> "$TMP"

scp -i "$KEY" -o StrictHostKeyChecking=accept-new "$TMP" ubuntu@$HOST:/tmp/tradeselect.env
ssh -i "$KEY" ubuntu@$HOST "sudo mv /tmp/tradeselect.env /opt/tradeselect/app/.env && sudo chown tradeselect:tradeselect /opt/tradeselect/app/.env && sudo chmod 600 /opt/tradeselect/app/.env && sudo systemctl restart tradeselect && sleep 2 && systemctl is-active tradeselect"

rm "$TMP"
echo "✅ .env updated, service restarted"
