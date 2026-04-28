#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# Roll back the schedule timers. Leaves tsapp.service untouched and running
# (or stopped — whatever its current state is). After this, the service
# behaves exactly like before install: always-on under normal restart policy.
#
# Run from Mac:
#   bash deploy/uninstall-schedule.sh
# ═══════════════════════════════════════════════════════════════════════

set -e

KEY="/Users/vgopiraja/Documents/LuckyNavi/Honeydaalu-key.pem"
HOST="3.109.167.163"

ssh -i "$KEY" ubuntu@$HOST '
  set -e
  for t in tsapp-start.timer tsapp-stop.timer tsapp-healthcheck.timer \
           tsapp-sunday-start.timer tsapp-sunday-stop.timer; do
    sudo systemctl disable --now "$t" 2>/dev/null || true
  done
  sudo rm -f /etc/systemd/system/tsapp-start.{service,timer} \
             /etc/systemd/system/tsapp-stop.{service,timer} \
             /etc/systemd/system/tsapp-healthcheck.{service,timer} \
             /etc/systemd/system/tsapp-sunday-start.{service,timer} \
             /etc/systemd/system/tsapp-sunday-stop.{service,timer}
  sudo systemctl daemon-reload
  echo "→ schedule timers removed. tsapp.service unchanged."
  systemctl is-active tsapp || true
'
