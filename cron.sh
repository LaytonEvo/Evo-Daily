#!/usr/bin/env sh
# Cron entrypoint. Calls one scheduled endpoint and exits.
#
# The Railway deployment does not use this script — each cron service there is
# a curlimages/curl image with the equivalent call as its start command, so a
# scheduled job does not have to build the whole app to make one request. This
# script is kept for running the same jobs from anywhere else: a local crontab,
# a different host, or a manual catch-up run.
#
# Requires APP_URL, CRON_SECRET and JOB. Every job is idempotent and safe to
# re-run, so a retry or a double-fire costs nothing.
#
# --- On timezones -----------------------------------------------------------
# Railway cron schedules are evaluated in UTC and there is no per-service
# timezone setting. The spec asks for 00:05 and 00:15 London. A fixed UTC
# schedule of 00:05/00:15 satisfies it in both halves of the year:
#
#   GMT (winter):  00:05 UTC = 00:05 London
#   BST (summer):  00:05 UTC = 01:05 London
#
# Both land after London midnight, which is all that matters — the jobs ask
# lib/time.ts what day it is, and it answers in London. The summer hour of
# drift is harmless, and /my-day generates today's instances on load anyway.
#
#   JOB=generate         5 0 * * *      (00:05 UTC)
#   JOB=sweep           15 0 * * *      (00:15 UTC)
#   JOB=morning-brief   30 7 * * 1-5    (08:30 London in summer — see below)
#   JOB=afternoon-nudge  0 15 * * 1-5
#   JOB=manager-digest   0 7 * * 1
#
# The Phase 3 nudge times are the exception: those are read by a person, so an
# hour of drift is the difference between a brief at 08:30 and one at 09:30.
# The times above are correct for BST; subtract an hour from the UTC hour when
# the clocks go back, or drive them from a scheduler that understands London.
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
