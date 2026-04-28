#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# Install systemd timers that auto-start tsapp at 08:55 IST and auto-stop
# at 17:00 IST on NSE trading days (Mon–Fri minus holidays).
#
# Idempotent: safe to re-run. Disables existing timers before re-installing.
# Does NOT modify the existing tsapp.service unit, only adds sister units.
#
# Run from Mac:
#   bash deploy/install-schedule.sh
# ═══════════════════════════════════════════════════════════════════════

set -e

KEY="/Users/vgopiraja/Documents/LuckyNavi/Honeydaalu-key.pem"
HOST="3.109.167.163"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$REPO_ROOT"

echo "→ uploading schedule files to /opt/ts-app/deploy/"
ssh -i "$KEY" ubuntu@$HOST "sudo mkdir -p /opt/ts-app/deploy/systemd && sudo chown -R tsapp:tsapp /opt/ts-app/deploy"
rsync -az -e "ssh -i $KEY" --rsync-path="sudo -u tsapp rsync" \
  deploy/holiday-check.sh \
  deploy/holidays-2026.json \
  ubuntu@$HOST:/opt/ts-app/deploy/
rsync -az -e "ssh -i $KEY" --rsync-path="sudo -u tsapp rsync" \
  deploy/systemd/ \
  ubuntu@$HOST:/opt/ts-app/deploy/systemd/

echo "→ installing units + enabling timers on AWS"
ssh -i "$KEY" ubuntu@$HOST '
  set -e

  # Make holiday-check.sh executable (rsync -a preserves perms but be safe)
  sudo chmod +x /opt/ts-app/deploy/holiday-check.sh
  sudo chown tsapp:tsapp /opt/ts-app/deploy/holiday-check.sh /opt/ts-app/deploy/holidays-2026.json

  # Stop + disable existing timers so re-install never double-fires
  for t in tsapp-start.timer tsapp-stop.timer tsapp-healthcheck.timer \
           tsapp-sunday-start.timer tsapp-sunday-stop.timer; do
    sudo systemctl disable --now "$t" 2>/dev/null || true
  done

  # Copy units into /etc/systemd/system/
  for f in /opt/ts-app/deploy/systemd/*.service /opt/ts-app/deploy/systemd/*.timer; do
    sudo cp "$f" /etc/systemd/system/
  done
  sudo chmod 644 /etc/systemd/system/tsapp-start.* \
                 /etc/systemd/system/tsapp-stop.* \
                 /etc/systemd/system/tsapp-healthcheck.* \
                 /etc/systemd/system/tsapp-sunday-start.* \
                 /etc/systemd/system/tsapp-sunday-stop.*

  sudo systemctl daemon-reload

  # Enable + start the TIMERS (services are oneshot, fire when timer triggers)
  sudo systemctl enable --now tsapp-start.timer
  sudo systemctl enable --now tsapp-stop.timer
  sudo systemctl enable --now tsapp-healthcheck.timer
  sudo systemctl enable --now tsapp-sunday-start.timer
  sudo systemctl enable --now tsapp-sunday-stop.timer

  echo ""
  echo "→ verification: holiday-check on today"
  /opt/ts-app/deploy/holiday-check.sh /opt/ts-app/deploy/holidays-2026.json || true

  echo ""
  echo "→ verification: timers scheduled"
  sudo systemctl list-timers tsapp-*.timer --no-pager
'

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  TradeSelect schedule INSTALLED"
echo "═══════════════════════════════════════════════════════════════════"
echo "  Start:  Mon..Fri 08:55 IST  (with NSE holiday gate)"
echo "  Stop:   Mon..Fri 17:00 IST"
echo "  Health: Mon..Fri 09:00 IST  → /var/log/tsapp/health.log"
echo "  Sunday: 17:55–19:30 IST     (weekly digest window)"
echo ""
echo "  Manual override (always works, ignores timers):"
echo "    sudo systemctl start tsapp     # start now"
echo "    sudo systemctl stop tsapp      # stop now"
echo ""
echo "  Inspect:"
echo "    sudo systemctl list-timers tsapp-*.timer"
echo "    sudo journalctl -u tsapp-start.service --since today"
echo "    tail -f /var/log/tsapp/schedule.log"
echo ""
echo "  Uninstall:"
echo "    bash deploy/uninstall-schedule.sh"
echo "═══════════════════════════════════════════════════════════════════"
