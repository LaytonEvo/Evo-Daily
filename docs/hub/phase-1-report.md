# Evo Ops Hub: Phase 1 report (Shell and Tasks)

Status: **code complete on branch `hub/phase-1`. Not merged and not deployed.**
Stopped at the Phase 1 gate for Layton's review, as the spec asks.

## Approach

Evo Tasks was already live and in daily use, so the hub grows from it rather
than replacing it. The spec says Evo Tasks "becomes the app shell: its auth,
layout and user model are the hub's". Nothing is migrated for the team: same
app, same accounts, same tasks and history.

## What Phase 1 added

| Spec item | What was built |
| --- | --- |
| Google sign-in, Workspace domain only | "Sign in with Google" on the login page, shown once `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` are set. Google must have verified the address, and both the address and the Workspace (`hd`) must be evolutiongolf.co.uk. Only people who already have an account can sign in. Signing in with Google retires the temporary password an admin issued. |
| Sessions expire after 12 h idle; admins can force sign-out | Idle time is measured from the person's last page load, or their sign-in if later. **Sign out everywhere** on People, and deactivating someone, both refuse every session issued before that moment. |
| Roles: Admin, Manager, Member, plus module access | New `MANAGER` role. A Manager is a Member inside Tasks, because every Tasks check is `role === ADMIN`. Module access is ticked per person on People. |
| `tasks` gains `source_module` and `source_ref` | Both are on `TaskTemplate`. A module-raised task is an ordinary one-off, so it flows through generation, the sweep and reports unchanged. |
| Task hook | `createTask()` in `src/lib/create-task.ts`. It is idempotent per open source item, and safe when raised concurrently. |
| Member screen shows module badges and links through | My day shows the raising module as a badge linking to the source item. |
| Activity log | Every scheduled or manual run of the six jobs is logged with status, duration, message and details. The Activity page shows the job registry, last run, last success, Run now, and a filterable run list. |
| Job registry and good-run rules | `src/lib/job-registry.ts`. `generate` warns if an active template due today has no task. The Slack jobs warn if a message failed to send. |
| Home screen status | A one-line warning on My day, for admins and anyone with Activity, when a job failed or warned in the last 24 h. It is silent otherwise. |
| Hub navigation | Sidebar gets the hub modules a person can open. Unbuilt modules (Approvals, Email, TikTok, Finance, Reporting) stay hidden. |

Schema change: one additive migration (`hub_phase1`). It adds the `MANAGER`
role, two user columns, two template columns and the `activity_log` table, and
changes no existing data.

## Acceptance tests relevant to Phase 1

| Test | Result | How checked |
| --- | --- | --- |
| A user outside @evolutiongolf.co.uk cannot sign in | **Pass** (logic) | Unit tests reject other domains, look-alike domains, personal Google accounts on a company address, and unverified emails. A live Google sign-in needs the OAuth client. |
| A Member cannot see Finance or Admin screens, even by typing the URL | **Pass** | Existing guards for /admin (redirect, and 403 on API routes). The new Activity page and its Run now API were tested in the browser: a Member is redirected, the API answers 403, and nav shows no Activity link. |
| A recurring daily task regenerates the next day and appears on the assignee's home | **Pass** | Existing Evo Tasks acceptance tests 1–4 and 12. |
| A module-raised task appears with its module badge and links back | **Pass** | `tests/hub.test.ts`: lands on My day with module and link, idempotent under concurrent raises. |
| Every worker run appears in the activity log with status and duration | **Pass** | `tests/hub.test.ts`, plus cron endpoints and Run now checked against the running app. |
| Member home and task tick-off work on a phone | **Pass** | Unchanged Evo Tasks screens, already mobile-first. |

Test suite: **455 passing** (the existing 430, plus 25 new in
`tests/hub.test.ts`). Typecheck, lint and production build are clean. Force
sign-out was also checked end to end in a browser: the person is bounced to
login and can sign straight back in.

## Deliberate differences from the spec

1. **Password stays as the fallback, instead of an email magic link.** Every
   current account has a password, and a magic link would need an email
   provider. Google covers the Workspace; passwords cover everyone else.
2. **Jobs stay on Railway cron services calling the app over HTTP, not
   pg-boss.** That setup already works. The registry and activity log give the
   spec's "one place to see what ran" without changing how jobs are triggered.
3. **The 30-day report doesn't yet split out module-raised tasks.** No module
   raises tasks until Phase 2. The split goes in with the first module that
   does, so it can be tested against real rows.

## Moving to the EU (the new Railway project)

The live app runs in the **EvoTasks** project in `us-west2`. A new project,
**evo-ops-hub**, has been created for the hub. Its Postgres is staged in EU
West (Amsterdam) but not yet applied. Suggested cutover, about 30 minutes,
out of hours:

1. In the evo-ops-hub project, apply the staged Postgres with its volume in
   EU West.
2. Create the web service from this repo, plus the six cron services as
   described above, and copy the variables across. Set `NEXTAUTH_URL` to the
   hub's domain.
3. Pause the old cron services, `pg_dump` the EvoTasks database and restore it
   into the new one, then deploy.
4. Check sign-in, My day and Activity, then point the domain at the new
   service.
5. Leave the old project paused for a week, then delete it.

## Questions

- [ ] OK to merge `hub/phase-1` into the deploy branch? Railway deploys from it
  immediately. The migration is additive.
- [ ] The hub's domain, and when to do the EU cutover.
- [ ] Should the app say **Evo Ops Hub** instead of **EvoTasks** yet, or wait
  until a second module ships?
- [ ] Who is the hub owner? The spec proposes Karin, as Manager with Activity.
  The seeded data has Karin as Admin.

## Gate

> The whole team has used it daily for 2 weeks, and ClickUp is no longer
> needed for recurring tasks.

The team already uses Evo Tasks daily, and ClickUp is retired, so this gate
looks met once the branch is merged and running. Phase 2 (approvals inbox,
integrations health, daily digest, Slack alerts, Health page, kill switches)
starts on your go-ahead.
