# EvoTasks

Recurring operational accountability for Evolution Golf.

It does one job: management defines the recurring work, each person sees exactly
what they owe today, ticks it off, and management gets an honest completion
record. It replaces ClickUp for recurring work only.

**Deliberately not in v1:** comment threads, attachments, dependencies,
timelines, time tracking, custom fields, sprints, nested folders, or any status
beyond the three below. These are what killed adoption of the previous tool. Do
not add them, and do not add "just in case" configuration options.

---

## Running it locally

You need Node 22+ and a PostgreSQL 14+ database.

```bash
npm install
cp .env.example .env          # then fill in DATABASE_URL and the secrets
npx prisma migrate deploy
npm run db:seed               # optional: a full demo organisation
npm run dev
```

The seed creates Evolution Golf with nine people, five categories, nineteen
templates across every frequency and 45 days of backdated history, so the
reporting has something real-looking to show on the first run. It prints the
sign-in details when it finishes; the default password is `ChangeMe123!` unless
you set `SEED_DEFAULT_PASSWORD`.

Generate a secret with `openssl rand -base64 32`.

## Tests

```bash
npm test          # everything
npm run typecheck
```

The recurrence and timezone suites are pure and run anywhere. The rest need a
throwaway database — `cp .env.test.example .env.test` and point it at one, or
export `TEST_DATABASE_URL`. Leave it unset and those suites skip rather than
fail.

> The integration suites truncate every table between tests. Never point
> `TEST_DATABASE_URL` at a database with real data.

## Acceptance tests

Every test in §10 of the build spec is automated. `npm test` runs all of them.

| # | Acceptance test | Covered by |
| --- | --- | --- |
| 1 | DAILY Mon–Fri generates 5 in a Mon–Sun window, none at the weekend | `recurrence.test.ts`, `generation.test.ts` |
| 2 | MONTHLY day 31 gives 28 Feb, 31 Mar, 30 Apr 2027 | `recurrence.test.ts`, `generation.test.ts` |
| 3 | WEEKLY over 4 weeks generates exactly 4 | `recurrence.test.ts` |
| 4 | Three consecutive generate runs produce zero duplicates | `generation.test.ts` |
| 5 | A template with a past `endDate` generates nothing | `recurrence.test.ts`, `generation.test.ts` |
| 6 | Editing a title rebuilds future instances, leaves today's and past alone | `generation.test.ts` |
| 7 | Reassigning changes no instance due today or earlier | `generation.test.ts` |
| 8 | A BST task due today is still today at 23:30 London, rolls at midnight | `time.test.ts` |
| 9 | Both clock-change weekends give exactly one instance per day | `time.test.ts`, `recurrence.test.ts`, `generation.test.ts` |
| 10 | Completing after `dueAt` sets `wasLate` | `generation.test.ts` |
| 11 | Due 3 days ago is MISSED and a member cannot tick it | `generation.test.ts` |
| 12 | Due yesterday is still tickable and shows under Overdue | `generation.test.ts`, `my-day.test.ts` |
| 13 | The sweep is idempotent | `generation.test.ts` |
| 14 | Every status transition writes exactly one AuditLog row | `generation.test.ts` |
| 15 | A future due date appears in no denominator anywhere | `reports.test.ts` |
| 16 | Leaderboard totals reconcile with the org summary | `reports.test.ts` |
| 17 | A mid-window reassignment splits history correctly | `reports.test.ts` |
| 18 | CSV row count equals the on-screen count | `reports.test.ts` |
| 19 | A MEMBER on any admin route or API gets 403 | `guards.ts`; pages redirect, APIs answer 403 |
| 20 | A MEMBER cannot touch another user's instances | `generation.test.ts`, `my-day.test.ts` |
| 21 | A cron endpoint without a valid secret gets 401 | `my-day.test.ts` |


## Deploying to Railway

The production deployment lives in the **EvoTasks** project. It is four
services in one environment:

| Service | What it is |
| --- | --- |
| `evotasks-web` | The app. Built by nixpacks from this repo, `prisma migrate deploy` runs before it boots, health check on `/api/health` |
| `Postgres` | `postgres:16` with a persistent volume at `/var/lib/postgresql/data` |
| `cron-generate` | `curlimages/curl`, fires `POST /api/cron/generate` at 00:05 UTC |
| `cron-sweep` | `curlimages/curl`, fires `POST /api/cron/sweep` at 00:15 UTC |

The cron services are a curl image rather than this repo on purpose: a
scheduled job should not have to build the whole application to make one
authenticated request.

### Setting it up from scratch

1. Create a PostgreSQL service. Using the official image directly, give it a
   volume at `/var/lib/postgresql/data` and set `POSTGRES_USER`,
   `POSTGRES_PASSWORD`, `POSTGRES_DB`, and `PGDATA` to
   `/var/lib/postgresql/data/pgdata` — a subdirectory, because the volume root
   is not empty and `initdb` refuses to use it.
2. Create the web service from this repo and set the variables below.
   `DATABASE_URL` can reference the database as `${{Postgres.DATABASE_URL}}`.
3. Generate a domain for the web service and set `NEXTAUTH_URL` to it.
4. For each cron job, create a service from `curlimages/curl`, set `APP_URL`,
   `CRON_SECRET` and `JOB`, and give it the schedule and start command from
   `cron.sh`. Wrap the command in `sh -c '…'` — Railway execs an image's start
   command without a shell, so `$APP_URL` will not otherwise expand.

### On cron and the clocks

Railway evaluates cron schedules in UTC and has no per-service timezone. The
spec asks for 00:05 and 00:15 London, and a fixed UTC schedule satisfies it
year-round: 00:05 UTC is 00:05 London in winter and 01:05 London in summer.
Both are after London midnight, which is all the jobs need — they ask
`lib/time.ts` what day it is and it answers in London. The summer hour of
drift costs nothing, and `/my-day` generates the day's instances on load
regardless.

The Phase 3 nudges are the exception, because a person reads them at a
particular time. See the note at the top of `cron.sh`.

### Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | yes | Session signing key |
| `NEXTAUTH_URL` | yes | Full public URL |
| `CRON_SECRET` | yes | Shared secret for the cron endpoints |
| `APP_TIMEZONE` | yes | `Europe/London` |
| `TZ` | no | `Europe/London`, so container logs read in local time |
| `SLACK_BOT_TOKEN` | no | Phase 3. Without it the app runs unchanged and every nudge reports itself skipped |
| `SLACK_MANAGER_CHANNEL_ID` | no | Phase 3, for the Monday digest |
| `SEED_DEFAULT_PASSWORD` | no | Only read by the seed script |

The cron services need `APP_URL`, `CRON_SECRET` and `JOB` instead.

### Seeding a deployed environment

`npm run db:seed` **deletes every row** before it writes. To seed a Railway
environment, set it as the web service's pre-deploy command, redeploy once,
then clear it again — leaving it in place would wipe the database on every
subsequent deploy.

---

## How it works

### Everything is Europe/London

`src/lib/time.ts` is the only place in the codebase that may compute a local
date. Timestamps are stored as `timestamptz` in UTC and calendar dates as
`date`; in between, dates are `"YYYY-MM-DD"` strings so that recurrence
arithmetic can never lose or gain a day at a clock change. If you need to know
what day it is, ask `todayInLondon()`.

### The recurrence engine

`src/lib/recurrence.ts` is split in two on purpose.

`dueDatesFor` is pure — a schedule and a window in, calendar dates out.

| Frequency | Behaviour |
| --- | --- |
| `DAILY` | Every date whose ISO weekday is in `daysOfWeek`. Defaults to Mon–Fri; a task that fires seven days a week must say so explicitly |
| `WEEKLY` | The date in each ISO week matching `dayOfWeek` |
| `MONTHLY` | `dayOfMonth` of each month, clamped to that month's length — 31 gives 28 Feb, 30 Apr, 31 May |
| `ONE_OFF` | A single instance on `startDate`, never regenerated |

`generateInstances` writes them. It is idempotent by construction: one row per
`(templateId, dueDate)` behind a unique constraint, and it never updates or
deletes an existing instance. Running it five times produces identical rows.

### Why instances carry snapshot fields

`title`, `assigneeId` and `categoryId` are copied onto each instance when it is
generated and are never updated afterwards. If a task moves from Alex to Brad in
October, September's report still shows it against Alex. Reporting reads
instance fields only and never joins through to the template.

### Status

```
PENDING   --tick------------->  COMPLETED   (wasLate = completedAt > dueAt)
PENDING   --sweep------------>  MISSED      (today > dueDate + graceDays)
COMPLETED --untick----------->  PENDING     (grace window only; admins any time)
MISSED    --admin override--->  COMPLETED
```

*Overdue* is a derived display state, not a stored status: a `PENDING` instance
whose due date has passed. Every transition writes exactly one `AuditLog` row —
the reporting is only credible if it is auditable.

The nightly sweep only hardens a task to `MISSED` once the grace window has
closed. That is deliberate: someone can catch up on Monday after a Friday miss,
and `wasLate` still records that they did, so the metric keeps its teeth.

### Scheduled jobs

| Job | Schedule (London) | Action |
| --- | --- | --- |
| `generate` | 00:05 daily | Generate instances from today to today + `generationHorizonDays` |
| `sweep` | 00:15 daily | Mark stale `PENDING` instances `MISSED`, then fire miss alerts |
| `morning-brief` | 08:30 weekdays | Phase 3 |
| `afternoon-nudge` | 16:00 weekdays | Phase 3 |
| `manager-digest` | Monday 08:00 | Phase 3 |

Every job requires `x-cron-secret` and answers 401 without it. Belt and braces:
`/my-day` also calls `ensureInstancesForToday()` on load, so a failed cron or a
sleeping Railway service never costs anyone a day's tasks. That is safe
precisely because generation is idempotent.

### Reporting

Metric definitions live in one place, `src/lib/reports.ts`, and every panel and
CSV reads from it — so the leaderboard cannot disagree with the org summary, and
an export cannot disagree with the screen above it.

```
assigned       = instances whose dueDate falls in the window
completed      = status COMPLETED
missed         = status MISSED
outstanding    = status PENDING (still inside the grace window)
completionRate = completed / assigned
onTime         = COMPLETED and not wasLate
onTimeRate     = onTime / completed          (null when completed = 0)
```

Windows are always clipped to today, so an instance with a future due date
appears in no denominator anywhere. The leaderboard flags anyone below ten
assigned instances as low volume and sinks them below everyone carrying a real
load, so a 3-for-3 never tops the table over someone at 92% across 80 tasks.

Problem tasks rank templates by worst completion rate over a minimum of five
instances. Read it as a diagnostic, not an accusation: a task nobody ever
completes is usually a badly-designed task, a wrongly-assigned task, or one that
should be automated.

### Roles

Two, and only two. `ADMIN` can do everything, including their own task screen.
`MEMBER` sees and completes their own tasks and nothing else. There is no
permissions matrix and there should not be one.

### Multi-tenancy

Every table carries `organisationId` from day one, but v1 ships with a single
seeded organisation and no org-switching UI. This is a cheap hedge — the same
tool is likely to be pointed at another business later, and retrofitting tenancy
is expensive.

---

## Project layout

```
prisma/schema.prisma     Data model and migrations
prisma/seed.ts           Demo organisation with 45 days of history
src/lib/time.ts          The only place a local date may be computed
src/lib/recurrence.ts    Due-date computation, generation, the sweep
src/lib/instances.ts     Status transitions and the grace window
src/lib/reports.ts       Every metric definition, used by every panel
src/lib/templates.ts     Template editing rules
src/lib/nudges.ts        Phase 3 Slack nudges
src/app/my-day/          The member screen — the whole product
src/app/admin/           Templates, reports, people
src/app/api/cron/        Scheduled endpoints, secret-guarded
tests/                   Acceptance tests from the build spec
```

## Settings

Per organisation, in the `Settings` table:

- `graceDays` (default 2) — how long after the due date a task can still be
  ticked off before it hardens to `MISSED`.
- `generationHorizonDays` (default 14) — how far ahead instances are
  pre-generated.

## Decisions worth revisiting

These were assumed rather than specified. Each is cheap to change now and
expensive later.

- **Grace period of 2 days.** Long enough to catch up on Monday after a Friday
  miss, short enough that the report stays honest. Could be 1.
- **Missed tasks expire rather than roll over.** A daily task not done on
  Tuesday does not reappear on Wednesday. Rolling them over buries people under
  a backlog and makes the completion rate meaningless.
- **One assignee per task.** Shared ownership is no ownership, and it is the main
  reason recurring work slips.
- **Password auth rather than magic links.** Avoids an email-delivery dependency.
  Revisit if the team pushes back.
- **Slack as the nudge channel.** Assumes the whole team is in Slack daily. If
  not, email is the fallback and needs a provider.

## A note on what this software cannot do

A nicer screen will not by itself fix tasks not being completed. This tool
removes friction; it does not create accountability. The two things that create
accountability are a prompt at the right moment and the numbers being visible to
someone who will ask about them. Pair it with a fixed ten minutes on the
leaderboard in the weekly management meeting. That habit, not the software, is
what will move the number.
