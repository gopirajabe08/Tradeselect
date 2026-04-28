#!/bin/bash
# Push TradeSelect creds to /opt/ts-app/.env.local on EC2.
set -e

CREDS="/Users/vgopiraja/Documents/LuckyNavi/.tradeselect-creds"
KEY="/Users/vgopiraja/Documents/LuckyNavi/Honeydaalu-key.pem"
HOST="3.109.167.163"

if [ ! -f "$CREDS" ]; then
    echo "❌ creds file not found: $CREDS"
    exit 1
fi

# Generate SESSION_SECRET once and persist locally so existing sessions survive deploy.
if ! grep -q '^SESSION_SECRET=' "$CREDS"; then
    echo "SESSION_SECRET=$(openssl rand -hex 32)" >> "$CREDS"
fi

TMP=$(mktemp)
cat > "$TMP" << 'EOF'
NODE_ENV=production
PORT=2001
HOSTNAME=0.0.0.0
BROKER=paper
EOF
grep -vE "^#|^$" "$CREDS" >> "$TMP"

scp -i "$KEY" "$TMP" ubuntu@$HOST:/tmp/tsapp.env
ssh -i "$KEY" ubuntu@$HOST "sudo mv /tmp/tsapp.env /opt/ts-app/.env.local && sudo chown tsapp:tsapp /opt/ts-app/.env.local && sudo chmod 600 /opt/ts-app/.env.local && echo '✅ env updated'"

rm "$TMP"
