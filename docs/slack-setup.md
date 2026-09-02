# Connecting Slack

Two halves, and they switch on independently.

**Outbound** — the morning brief, the afternoon nudge, the manager digest and
miss alerts. Needs `SLACK_BOT_TOKEN` and the cron schedules. This half was built
in Phase 3 and has never been switched on.

**Inbound** — DMs to the bot and the Done buttons. Needs `SLACK_SIGNING_SECRET`
as well. Free-text replies additionally need `ANTHROPIC_API_KEY`; without it the
buttons still work and typed messages get told so.

Nothing here changes the app's behaviour for anyone who is not in Slack.

## 1. Create the Slack app

At <https://api.slack.com/apps> → **Create New App** → **From scratch**, in the
Evolution Golf workspace.

**OAuth & Permissions** → Bot Token Scopes:

| Scope | Why |
|---|---|
| `chat:write` | Send the nudges |
| `im:history` | Read DMs sent to the bot |
| `im:write` | Open a DM with someone the bot has not messaged before |
| `users:read` | Resolve member IDs when linking accounts |

Install to the workspace. Copy the **Bot User OAuth Token** (`xoxb-…`).

**Basic Information** → copy the **Signing Secret**.

**App Home** → enable the **Messages Tab** and tick *Allow users to send Slash
commands and messages from the messages tab*. Without this the bot cannot be
DMed at all.

## 2. Set the variables

In Railway, on `evotasks-web`:

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_MANAGER_CHANNEL_ID=C...        # optional, for the Monday digest
ANTHROPIC_API_KEY=sk-ant-...         # optional, for free-text replies
```

Set them in the dashboard, not in a file — they are secrets and this repository
is not the place for them.

## 3. Point Slack at the app

Both URLs need the app deployed and the signing secret set first, or Slack's
verification handshake fails.

**Event Subscriptions** → Request URL:

```
https://evotasks-web-production.up.railway.app/api/slack/events
```

Slack sends a one-off challenge; the endpoint answers it. Then under *Subscribe
to bot events* add **`message.im`**.

**Interactivity & Shortcuts** → on → Request URL:

```
https://evotasks-web-production.up.railway.app/api/slack/interactive
```

## 4. Link each person

A Slack account only works once it is mapped to an EvoTasks account. In Slack
the member ID is under **Profile → ⋮ → Copy member ID** (`U…`). Paste it into
**People → Edit → Slack member ID**.

Unmapped Slack accounts are told to ask an admin. They are never treated as
anonymous.

## 5. Schedule the nudges

Railway crons are **UTC only**, so the London times below shift by an hour in
summer. Each is a separate service running one `curl`, the same pattern as the
existing `cron-sweep` and `cron-generate`:

```
POST /api/cron/nudge?job=morning-brief     30 8 * * 1-5
POST /api/cron/nudge?job=afternoon-nudge    0 16 * * 1-5
POST /api/cron/nudge?job=manager-digest     0 8 * * 1
POST /api/cron/nudge?job=miss-alerts       20 0 * * *
```

with header `authorization: Bearer $CRON_SECRET`.

## What the bot does

- **Morning brief** — one row per task with a **Done** button. A tap completes
  it outright; there is no matching to get wrong.
- **Typed replies** — "done the stock take, ran out of range balls" completes
  the task and keeps the second half as a note. If two tasks fit equally well,
  or none does, it asks rather than guessing.
- **"what do I owe"** — lists what is open.
- **Asking for a new task** (admins only) — reads the sentence back and stops
  there. It does not create the task: a recurring task needs an exact schedule
  and owner, and a guessed one generates wrong work every day until someone
  notices.

## Security

Every inbound request is verified against the signing secret over the raw bytes,
with a five-minute replay window. With no secret set, everything inbound is
refused — it fails closed.

Identity comes only from the Slack user ID → `User.slackUserId` mapping. The
instance ID in a button, and any ID the model returns, are both re-checked
against the database under the same ownership and grace-window rules as the web
app, so a tampered request cannot reach another person's task.
