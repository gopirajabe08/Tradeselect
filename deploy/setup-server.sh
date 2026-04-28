#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# TradeSelect — AWS EC2 PARALLEL setup (TradeAuto stays running on its own).
# Runs alongside TradeAuto + LuckyNavi on the same EC2 host.
#
#   TradeAuto:  /opt/tradeselect/  user=tradeselect  port 4001  nginx 8080
#   TradeSelect: /opt/ts-app/       user=tsapp        port 2001  nginx 8081
#   LuckyNavi:   /opt/honeydaalu/   user=luckynavi    port 8001  nginx 80/443
#
# Idempotent. Safe to re-run.
# ═══════════════════════════════════════════════════════════════════════

set -e

echo "═══ TradeSelect PARALLEL setup (Next.js standalone) ═══"

# ── App user (separate from luckynavi AND tradeselect) ──
sudo useradd -m -s /bin/bash tsapp 2>/dev/null || true
sudo mkdir -p /opt/ts-app
sudo chown tsapp:tsapp /opt/ts-app

# ── Node 20+ already present (TradeAuto installed it) ──

# ── Swap (helpful for Next.js builds and memory pressure) ──
if [ ! -f /swapfile ]; then
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

# ── App data dir (Next.js .local-data writes) ──
sudo -u tsapp mkdir -p /opt/ts-app/.local-data/paper

# ── .env.local placeholder ──
if [ ! -f /opt/ts-app/.env.local ]; then
    sudo tee /opt/ts-app/.env.local > /dev/null << 'ENVEOF'
NODE_ENV=production
PORT=2001
HOSTNAME=0.0.0.0
SESSION_SECRET=
BROKER=paper
TRADEJINI_API_KEY=
TRADEJINI_CLIENT_ID=
TRADEJINI_PIN=
TRADEJINI_TOTP_SECRET=
ENVEOF
    sudo chown tsapp:tsapp /opt/ts-app/.env.local
    sudo chmod 600 /opt/ts-app/.env.local
fi

# ── Logs ──
sudo mkdir -p /var/log/tsapp
sudo chown tsapp:tsapp /var/log/tsapp
sudo chmod 775 /var/log/tsapp

sudo tee /etc/logrotate.d/tsapp > /dev/null << 'EOF'
/var/log/tsapp/*.log {
    daily
    rotate 30
    compress
    missingok
    notifempty
    copytruncate
}
EOF

# ── systemd unit (Next.js standalone) — DIFFERENT NAME from tradeselect.service ──
sudo tee /etc/systemd/system/tsapp.service > /dev/null << 'EOF'
[Unit]
Description=TradeSelect (Next.js calls platform)
After=network.target

[Service]
Type=simple
User=tsapp
Group=tsapp
WorkingDirectory=/opt/ts-app
EnvironmentFile=/opt/ts-app/.env.local
Environment=NODE_ENV=production
Environment=PORT=2001
Environment=HOSTNAME=0.0.0.0
ExecStart=/usr/bin/node /opt/ts-app/server.js
Restart=always
RestartSec=10
StartLimitIntervalSec=60
StartLimitBurst=5
MemoryMax=600M
MemoryHigh=500M
StandardOutput=append:/var/log/tsapp/app.log
StandardError=append:/var/log/tsapp/app.log

[Install]
WantedBy=multi-user.target
EOF

# ── nginx (NEW site, listens on 8081 — TradeAuto keeps 8080) ──
sudo tee /etc/nginx/sites-available/tsapp > /dev/null << 'EOF'
server {
    listen 8081;
    server_name _;

    location ~ /\.env { deny all; return 404; }
    location ~ /\.git { deny all; return 404; }
    location ~ /\.local-data { deny all; return 404; }

    location / {
        proxy_pass http://127.0.0.1:2001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/tsapp /etc/nginx/sites-enabled/tsapp
# Verify config — if invalid, do NOT reload (could break TradeAuto's nginx site)
sudo nginx -t && sudo systemctl reload nginx

# Open firewall (UFW is inactive on this box; AWS SG is the active firewall)
sudo ufw allow 8081/tcp 2>/dev/null || true

sudo systemctl daemon-reload
sudo systemctl enable tsapp

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  TradeSelect setup COMPLETE — TradeAuto + LuckyNavi UNTOUCHED"
echo "═══════════════════════════════════════════════════════"
echo "  TradeAuto:    http://3.109.167.163:8080/  (port 4001 internal, untouched)"
echo "  TradeSelect:  http://3.109.167.163:8081/  (port 2001 internal, NEW)"
echo "  LuckyNavi:    http://3.109.167.163/       (port 80/443, untouched)"
echo ""
echo "  Open AWS Security Group port 8081 for your home IP."
echo "  Then from Mac:"
echo "    bash deploy/update-env.sh"
echo "    bash deploy/upload-app.sh"
echo "═══════════════════════════════════════════════════════"
