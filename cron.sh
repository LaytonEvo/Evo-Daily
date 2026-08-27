#!/usr/bin/env sh
# Railway cron service entrypoint.
#
# Create one Railway cron service per schedule below, all pointing at this
# script with JOB set. Schedules are given in London time; set the Railway cron
# service timezone to Europe/London so the clock changes are handled for you.
#
#   JOB=generate         5 0 * * *
#   JOB=sweep           15 0 * * *
#   JOB=morning-brief   30 8 * * 1-5   (Phase 3, optional)
#   JOB=afternoon-nudge  0 16 * * 1-5  (Phase 3, optional)
#   JOB=manager-digest   0 8 * * 1     (Phase 3, optional)
#
# Requires APP_URL and CRON_SECRET. Every job is idempotent and safe to re-run.
set -eu

: "${APP_URL:?APP_URL is not set}"
: "${CRON_SECRET:?CRON_SECRET is not set}"
: "${JOB:?JOB is not set}"

case "$JOB" in
  generate|sweep)
    ENDPOINT="$APP_URL/api/cron/$JOB"
    ;;
  morning-brief|afternoon-nudge|manager-digest|miss-alerts)
    ENDPOINT="$APP_URL/api/cron/nudge?job=$JOB"
    ;;
  *)
    echo "Unknown JOB: $JOB" >&2
    exit 1
    ;;
esac

echo "Running $JOB against $ENDPOINT"

STATUS=$(curl -sS -o /tmp/cron-response.json -w "%{http_code}" \
  -X POST "$ENDPOINT" \
  -H "x-cron-secret: $CRON_SECRET" \
  --max-time 120 --retry 3 --retry-delay 5 --retry-connrefused)

cat /tmp/cron-response.json
echo

if [ "$STATUS" -ge 300 ]; then
  echo "$JOB failed with HTTP $STATUS" >&2
  exit 1
fi

echo "$JOB completed"
