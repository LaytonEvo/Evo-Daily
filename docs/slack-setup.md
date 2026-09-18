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

At <https://api.slack.com/apps> → **Create New App**, in the Evolution Golf
workspace. Choose **From a manifest** (YAML) and paste:

```yaml
display_information:
  name: EvoTasks
  description: Your recurring tasks, in Slack.
  background_color: "#422afb"
features:
  bot_user:
    display_name: EvoTasks
    always_online: true
  app_home:
    home_tab_enabled: false
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
oauth_config:
  scopes:
    bot:
      - chat:write
      - im:history
      - im:write
      - users:read
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

That covers the four scopes and the Messages Tab, which are the two things
easiest to miss. The request URLs are deliberately absent — see step 3.

**Blank app** is the same thing by hand; it is what Slack used to call *From
scratch*. The scopes are, for reference:

| Scope | Why |
|---|---|
| `chat:write` | Send the nudges |
| `im:history` | Read DMs sent to the bot |
| `im:write` | Open a DM with someone the bot has not messaged before |
| `users:read` | Resolve member IDs when linking accounts |

Either way: **Install to Workspace**, copy the **Bot User OAuth Token**
(`xoxb-…`), and take the **Signing Secret** from **Basic Information**.

Built by hand rather than from the manifest? **App Home** → enable the
**Messages Tab** and tick *Allow users to send Slash commands and messages from
the messages tab*. Without this the bot cannot be DMed at all.

## 2. Set the variables

In Railway, on `evotasks-web`:

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_MANAGER_CHANNEL_ID=C...        # optional, for the Monday digest — see below
ANTHROPIC_API_KEY=sk-ant-...         # optional, for free-text replies
```

Set them in the dashboard, not in a file — they are secrets and this repository
is not the place for them.

### The manager digest channel

`SLACK_MANAGER_CHANNEL_ID` is the only variable that is not copied from the app
settings page. In Slack, open the channel, click its name, and the **Channel ID**
(`C…`) is at the bottom of the About tab. Unset, the Monday digest runs and
returns without posting.

Then **invite the bot to that channel** — `/invite @EvoTasks` in the channel
itself. Without it `chat.postMessage` comes back `not_in_channel` and the digest
fails every Monday. The cron output names the error either way.

## 3. Point Slack at the app

These come last, and cannot go in the manifest. Slack verifies a request URL
the moment it is set, and both endpoints check the signature before they answer
anything — including Slack's own `url_verification` challenge. That is
deliberate (see Security), but it means the secret has to be set and deployed
first, or the handshake fails.

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
POST /api/cron/nudge/morning-brief     30 7 * * 1-5
POST /api/cron/nudge/afternoon-nudge    0 15 * * 1-5
POST /api/cron/nudge/manager-digest     0 7 * * 1
POST /api/cron/nudge/miss-alerts       20 0 * * *
```

with header `x-cron-secret: $CRON_SECRET`.

Those schedules are UTC and correct for BST, which is what the London times
in the code comments mean in summer: 08:30, 16:00 and 08:00 Monday. When the
clocks go back, subtract an hour from each UTC hour, or the brief arrives at
09:30. `miss-alerts` only has to land after midnight London, so it needs no
adjustment.

The job name goes in the path rather than a query string on purpose. A Railway
cron service is a curl image with a single string as its start command, and a
`?` in that string does not reach curl — it comes back a usage error, while the
same command without one runs fine.

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
