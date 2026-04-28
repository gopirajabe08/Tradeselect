#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# tsapp post-start health check.
#
# Strict: requires HTTP 200 AND body containing "ok":true.
# Logs every run to /var/log/tsapp/health.log.
# Exit codes:
#   0 — healthy
#   1 — connection failed (curl exit non-zero)
#   2 — wrong status code (not 200)
#   3 — body missing "ok":true (degraded health)
# ═══════════════════════════════════════════════════════════════════════

set -u

URL="${1:-http://127.0.0.1:2001/api/health}"
LOG="${HEALTH_LOG:-/var/log/tsapp/health.log}"
TS=$(TZ=Asia/Kolkata date -Iseconds)

BODY_FILE=$(mktemp)
trap 'rm -f "$BODY_FILE"' EXIT

STATUS=$(curl --silent --max-time 10 --max-redirs 0 \
  --output "$BODY_FILE" \
  --write-out '%{http_code}' \
  "$URL" 2>/dev/null)
CURL_RC=$?

BODY=$(head -c 300 "$BODY_FILE" 2>/dev/null | tr -d '\n' || echo "")

if [ "$CURL_RC" -ne 0 ]; then
  echo "$TS healthcheck FAIL curl_rc=$CURL_RC http=$STATUS" >> "$LOG"
  exit 1
fi

if [ "$STATUS" != "200" ]; then
  echo "$TS healthcheck FAIL http=$STATUS body=$BODY" >> "$LOG"
  exit 2
fi

if ! echo "$BODY" | grep -q '"ok":true'; then
  echo "$TS healthcheck FAIL ok!=true http=$STATUS body=$BODY" >> "$LOG"
  exit 3
fi

echo "$TS healthcheck OK http=$STATUS body=$BODY" >> "$LOG"
exit 0
