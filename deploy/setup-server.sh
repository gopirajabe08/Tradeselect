#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# TradeSelect — AWS EC2 server setup (run ONCE on existing LuckyNavi host)
# Co-exists with LuckyNavi:
#   - app dir:    /opt/tradeselect/  (LuckyNavi: /opt/honeydaalu/)
#   - app user:   tradeselect        (LuckyNavi: luckynavi)
#   - app port:   4001 internal      (LuckyNavi: 8001)
#   - nginx path: /tradeselect/      (LuckyNavi: /)
#   - systemd:    tradeselect.service
#
# Usage: ssh -i key.pem ubuntu@<elastic-ip> 'bash -s' < setup-server.sh
# ═══════════════════════════════════════════════════════════════════════

set -e

echo "═══ TradeSelect server setup ═══"

# ── App user (separate from luckynavi) ──
sudo useradd -m -s /bin/bash tradeselect 2>/dev/null || true
sudo mkdir -p /opt/tradeselect
sudo chown tradeselect:tradeselect /opt/tradeselect

# ── Node.js 20 (use existing if already installed by LuckyNavi setup) ──
if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# ── pnpm (TradeAuto uses pnpm via package-lock.json fallback to npm) ──
sudo npm install -g pnpm 2>/dev/null || true

# ── Clone repo ──
if [ ! -d /opt/tradeselect/app/.git ]; then
    sudo -u tradeselect git clone https://github.com/gopirajabe08/Tradeselect.git /opt/tradeselect/app
else
    sudo -u tradeselect git -C /opt/tradeselect/app pull origin main
fi

# ── Install deps ──
cd /opt/tradeselect/app
sudo -u tradeselect npm install --production=false

# ── .env placeholder (manually fill creds via update-env.sh) ──
if [ ! -f /opt/tradeselect/app/.env ]; then
    sudo tee /opt/tradeselect/app/.env > /dev/null << 'ENVEOF'
# TradeSelect runtime env — populated via deploy/update-env.sh
NODE_ENV=production
MOCK_PORT=4001
TRADEJINI_API_KEY=
TRADEJINI_CLIENT_ID=
TRADEJINI_PIN=
TRADEJINI_TOTP_SECRET=
TRADEJINI_REDIRECT_URI=https://3.109.167.163/tradeselect/api/tradejini/callback
TRADEJINI_MODE=individual

# Paper-only mode — DO NOT FLIP TO LIVE without specialist review (per memory)
TRADESELECT_MODE=paper
ENVEOF
    sudo chown tradeselect:tradeselect /opt/tradeselect/app/.env
    sudo chmod 600 /opt/tradeselect/app/.env
fi

# ── Logs ──
sudo mkdir -p /var/log/tradeselect
sudo chown tradeselect:tradeselect /var/log/tradeselect

sudo tee /etc/logrotate.d/tradeselect > /dev/null << 'EOF'
/var/log/tradeselect/*.log {
    daily
    rotate 30
    compress
    missingok
    notifempty
    copytruncate
}
EOF

# ── systemd unit ──
# Memory cap 350MB hard limit so it cannot starve LuckyNavi.
# Restart=always with throttle so a crashloop doesn't burn CPU.
sudo tee /etc/systemd/system/tradeselect.service > /dev/null << 'EOF'
[Unit]
Description=TradeSelect (TradeAuto) paper-trading platform
After=network.target

[Service]
Type=simple
User=tradeselect
Group=tradeselect
WorkingDirectory=/opt/tradeselect/app
EnvironmentFile=/opt/tradeselect/app/.env
ExecStart=/usr/bin/node tools/mock-api/server.mjs
Restart=always
RestartSec=10
StartLimitIntervalSec=60
StartLimitBurst=5
MemoryMax=350M
MemoryHigh=300M
StandardOutput=append:/var/log/tradeselect/app.log
StandardError=append:/var/log/tradeselect/app.log

[Install]
WantedBy=multi-user.target
EOF

# ── Nginx — SEPARATE config file on a SEPARATE port (does NOT touch LuckyNavi) ──
# LuckyNavi keeps owning ports 80/443.
# TradeSelect listens on 8080 (HTTP). HTTPS comes later when we add a domain.
sudo tee /etc/nginx/sites-available/tradeselect > /dev/null << 'EOF'
server {
    listen 8080;
    server_name _;

    # Block sensitive paths
    location ~ /\.env { deny all; return 404; }
    location ~ /\.git { deny all; return 404; }

    location / {
        proxy_pass http://127.0.0.1:4001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/tradeselect /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Open port 8080 in firewall
sudo ufw allow 8080/tcp 2>/dev/null || true

sudo systemctl daemon-reload
sudo systemctl enable tradeselect

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  TradeSelect setup COMPLETE — LuckyNavi UNTOUCHED"
echo "═══════════════════════════════════════════════════════"
echo "  Verify isolation:"
echo "    LuckyNavi nginx site: /etc/nginx/sites-available/honeydaalu  (NOT modified)"
echo "    TradeSelect nginx:    /etc/nginx/sites-available/tradeselect (new file)"
echo "    LuckyNavi service:    honeydaalu-backend (untouched)"
echo "    TradeSelect service:  tradeselect (new)"
echo ""
echo "  Access TradeSelect: http://3.109.167.163:8080/"
echo "  Access LuckyNavi:   http://3.109.167.163/    (unchanged)"
echo ""
echo "  Next: bash deploy/update-env.sh to push creds"
echo "  Then: sudo systemctl start tradeselect"
echo "  Logs: tail -f /var/log/tradeselect/app.log"
echo "═══════════════════════════════════════════════════════"
