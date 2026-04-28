#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# NSE trading-day gate.
#
# Exit 0 → today is a trading day (start the service)
# Exit 1 → today is a weekend or NSE holiday (do NOT start)
# Exit 2 → check itself failed (config/parse error)
#
# Fail-safe: any non-zero exit blocks the start. Better to miss one trading
# day to a misconfig than to fire orders on an unintended day.
#
# Usage: holiday-check.sh [path-to-holidays.json]
# Default holidays path: /opt/ts-app/deploy/holidays-2026.json
# ═══════════════════════════════════════════════════════════════════════

set -u

HOLIDAYS_FILE="${1:-/opt/ts-app/deploy/holidays-2026.json}"
TODAY_IST=$(TZ=Asia/Kolkata date +%Y-%m-%d)
DOW_IST=$(TZ=Asia/Kolkata date +%u)  # 1=Mon ... 7=Sun

# Weekend gate
if [ "$DOW_IST" -ge 6 ]; then
    echo "[holiday-check] $TODAY_IST is a weekend (DOW=$DOW_IST). Block start."
    exit 1
fi

# Holiday file present?
if [ ! -r "$HOLIDAYS_FILE" ]; then
    echo "[holiday-check] ERROR: holidays file not readable at $HOLIDAYS_FILE" >&2
    exit 2
fi

# Need a JSON parser. python3 is always present on Ubuntu/Debian.
if ! command -v python3 >/dev/null 2>&1; then
    echo "[holiday-check] ERROR: python3 not found" >&2
    exit 2
fi

# Parse and check membership.
IS_HOLIDAY=$(python3 - "$HOLIDAYS_FILE" "$TODAY_IST" <<'PY'
import json, sys
path, today = sys.argv[1], sys.argv[2]
try:
    with open(path) as f:
        data = json.load(f)
except Exception as e:
    sys.stderr.write(f"[holiday-check] parse error: {e}\n")
    sys.exit(2)
# Holidays are top-level keys that are ISO dates (skip _meta keys).
holiday_dates = {k for k in data.keys() if not k.startswith("_")}
if today in holiday_dates:
    print(f"HOLIDAY:{data[today]}")
else:
    print("TRADING_DAY")
PY
)
PARSE_RC=$?

if [ "$PARSE_RC" -ne 0 ]; then
    echo "[holiday-check] ERROR: holidays parse failed (rc=$PARSE_RC)" >&2
    exit 2
fi

case "$IS_HOLIDAY" in
    HOLIDAY:*)
        LABEL="${IS_HOLIDAY#HOLIDAY:}"
        echo "[holiday-check] $TODAY_IST is an NSE holiday: $LABEL. Block start."
        exit 1
        ;;
    TRADING_DAY)
        echo "[holiday-check] $TODAY_IST is a trading day. Allow start."
        exit 0
        ;;
    *)
        echo "[holiday-check] ERROR: unexpected check output: $IS_HOLIDAY" >&2
        exit 2
        ;;
esac
