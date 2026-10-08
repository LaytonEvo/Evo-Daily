# Evo Ops Hub: Phase 2 report (Core services)

Status: **code complete on branch `hub/phase-2`. Not merged and not deployed.**
Stopped at the Phase 2 gate for Layton's review.

## What was built

| Spec item | What was built |
| --- | --- |
| Approvals inbox | `/approvals`: one queue, filterable by module and "assigned to me", with cards showing a plain summary, a preview link and the module's editable fields. Approve, Reject (note, optional rework task) and edit-then-approve. Each approval has a detail page with its decision, edits and result. Failed actions can be retried. Approvals expire when given an expiry. |
| Exactly once | The decision is a conditional update on `PENDING`, and the module's action is claimed by setting `executedAt`. Tested with five simultaneous approves and in a browser with a double-click: one decision, one action. |
| Who decides | Admins anything. A manager anything in their granted modules. Anyone else only what is assigned to them. |
| Approvals on the home screen | My day shows "N approvals waiting for you", flagging any over 48 hours. The midday Slack brief now includes them too. |
| Task hook | Built in Phase 1. It is now used by rework, failing-job, repeated-warning and expiring-token tasks. |
| Integrations table and health strip | Every Slack call updates `integrations`. Auth failures mark Slack down; rate limits and network trouble mark it degraded; one bad channel doesn't count. Shown on Health and in the admin strip on My day. |
| Slack alerts | Integration down, job missed its window, and job failed twice each open an **incident**: one Slack DM to admins when it opens (the manager channel if no admin has Slack), and one when it recovers. Nothing repeats in between. |
| Failed twice → task | Also raises a task for the hub owner, with the latest error. |
| Outcome warnings | Listed in the 07:30 admin digest. Three warning runs in a row raise a task for the hub owner. |
| Job registry and missed windows | Each job now has an expected interval. `hub.monitor` checks every job every 15 minutes, and doesn't flag a job the log is too young to judge. |
| Health page | `/admin/health`: each module green, amber or red, with every job's last run, last success, warnings this week and Run now. Also connections, open incidents, recent app errors, automation switches, the hub owner, and the end-to-end test buttons. |
| Kill switches | One per module plus a global one. Off stops outside actions (Slack nudges and miss alerts today, and approving into a paused module) while screens and the queue keep working. Each change is stored with who and why. A paused module shows amber. |
| Error tracking | `src/instrumentation.ts` records every server-side error (route pattern, method, message, stack; never headers or bodies) in `app_errors`, shown on Health. |
| Copy for Claude Code | On failed and warning runs (Activity) and on app errors (Health). It builds one block with the job, error, details, recent runs and where in the spec and code to look. |
| Deploy checks | GitHub Actions CI (typecheck, lint, all tests on a real Postgres, build) and `npm run smoke`, a read-only post-deploy check that signs in and loads each screen. |
| Retention | `hub.housekeeping` daily: logs, errors and incidents after 12 months, decided approvals after 24. |

## The gate

> A test approval and a test module-raised task work end to end.

**Met locally, on a production build.** From Health → "Send me a test
approval", I edited the message on a 390 px phone screen and double-clicked
Approve. Result: one approval decision, one `approval.test` run and one
`hub.test-approval` run, carrying the edited text. "Raise a test task for
me" put a task with the Hub badge and link on My day. A Member got 404 on the
admin's approval page, 403 from its API and a redirect from Health. Both
paths are also automated in `tests/hub-phase2.test.ts` ("the Phase 2 gate").
To meet the gate in production, use the same two buttons once this is deployed.

Tests: **487 passing** (32 new in `tests/hub-phase2.test.ts`). Typecheck,
lint, build and the smoke script are clean.

## Deliberate differences from the spec

1. **The daily digest isn't a third DM to everyone.** Evo Tasks already sends
   two a day by design, so approvals waiting go into the existing midday
   brief. A separate 07:30 digest goes to admins only, with failures,
   warnings, incidents and stale approvals. Email digests need an email
   provider, which the hub doesn't have yet.
2. **Error tracking is built in, not Sentry.** No account or third party is
   needed, and errors sit next to the jobs on Health. Client-side
   (browser-only) errors aren't captured. Sentry can be added later if
   that matters.
3. **One new cron service, not three.** The monitor runs every 15 minutes and
   also starts the daily housekeeping and the 07:30 digest when they're due.
4. **Alerts go to Slack only**, and hub-down alerts come from the external
   uptime monitor, which has to be set up outside the app (below).
5. **Not built yet:** Claude API cost logging and budgets. That's monitoring,
   but not on the Phase 2 list, and the only AI use today is Slack free-text
   replies. It belongs with the first module that drafts with Claude (Email
   or Finance).

## After merging (needs doing once)

1. **Add the monitor cron service** in the EvoTasks Railway project:
   `curlimages/curl`, schedule `*/15 * * * *`, the same `APP_URL` and
   `CRON_SECRET` as the others, and start command
   `sh -c 'curl -sS -X POST "$APP_URL/api/cron/run/hub.monitor" -H "x-cron-secret: $CRON_SECRET" --fail --max-time 120'`.
2. **Turn on "Wait for CI"** for `evotasks-web` in Railway, so a failing test
   blocks a deploy.
3. **Set up an uptime monitor** (Better Stack or UptimeRobot, free tier) on
   `https://<app>/api/health` every 5 minutes, alerting admins.
4. **Choose the hub owner** on Health. Until then it's the longest-standing
   admin.
5. Press the two test buttons on Health to meet the gate in production.

## Next

Phase 3 (Finance/AP) starts on your go-ahead. It needs: the Xero connection
(a Xero app with draft-bills-only scopes), the Gmail account that receives
finance@evolutiongolf.co.uk, and the Google Drive archive folder.
