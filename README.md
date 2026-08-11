# telemetry.lmhstech.com

Error reporting and AI issue triage for the LMHS Tech estate. Cloudflare
Workers + D1 + Workers AI, signed in with `auth.lmhstech.com`, styled with
main-site's design language.

Every app in the estate reports its unhandled errors here. This groups them,
sorts them into P1–P4 with Workers AI, and puts the result on one board that a
teacher can read between classes.

---

## Why this exists in this shape

Three decisions drive everything else.

**Reporting must never make the reporting app worse.** A telemetry service that
is slow, down, or misconfigured must be invisible to a student loading a page.
Every client swallows its own errors, times out fast, and sends after the
response has gone out. Ingest does the minimum synchronously and pushes AI
triage into `waitUntil`.

**This must not become a place where student data lives.** Crash reports are
the most likely accidental route for personal information into a database — a
stack trace carries whatever was in scope, and velri goes to real trouble to
keep student names client-side. Every client scrubs before sending and
`src/lib/scrub.js` scrubs again on arrival. The schema has no name column, no
email column, and no student ID column, and must never get one.

**A wall of undifferentiated red is the same as no alerting at all.** Rules set
a priority floor, the model sorts within it, and the model's reasoning is
always shown next to its verdict. A priority nobody can interrogate is a
priority nobody should trust.

---

## Setup

```bash
npm install
npm run db:create          # paste the returned database_id into wrangler.toml
npm run migrate:remote
```

Register the app at `auth.lmhstech.com/admin` → **Applications**:

- Redirect URI: `https://telemetry.lmhstech.com/auth/callback` — exact string
  match, no trailing slash
- Confidential client
- First-party

Put the client ID in `wrangler.toml`, then:

```bash
wrangler secret put OIDC_CLIENT_SECRET
npm run deploy
```

The first admin to sign in gets in by their IdP role — there is no bootstrap
step here.

---

## Who can see what

| | Board | Wallboard | Change priority / resolve | Admin page |
|---|---|---|---|---|
| `admin` | yes | yes | yes | yes |
| `teacher` | yes | yes | yes | no |
| `student` | only if granted | only if granted | no | no |
| paired display | **no** | yes | no | no |

Students are closed by default. An admin grants access on the **Admin** page by
the five-character username from the student's sign-in label — they do not need
to have opened this app before, and the grant links to their `sub` at first
login. Removing a grant also deletes their sessions, because revoking access
that leaves someone looking at the page until their cookie expires is not
revoking access.

Every grant and every priority override is written to the audit log.

---

## The wallboard

`/tv` — the board on a screen. Full-bleed, no navigation, re-fetches every 20
seconds and pages through the open issues so nothing needs scrolling. There is
a link to it in the nav; a signed-in teacher or admin can just open it.

What it shows: a status banner (**all clear · minor issues · degraded · N P1
incidents**), the P1–P4 counts, event volume over the last hour and day, every
open issue sorted by priority, and a dot per reporting app coloured by its worst
open issue.

Two things it deliberately does that a normal page does not:

- **It says when it is stale.** A frozen wallboard and a healthy one look
  identical, so the header carries a live indicator that turns red and starts
  counting minutes as soon as the feed stops answering. A failed fetch leaves
  the last good board up rather than blanking the screen over a thirty-second
  blip.
- **It measures the screen.** Row height is read back from the first row that
  lays out, so the same page fills a 1080p TV and a laptop without a hardcoded
  row count.

### Pairing a TV

Sessions here last twelve hours, which is right for a person and useless for a
screen that is supposed to be on all year. So a display gets its own kind of
session: **Admin → Wall displays → Pair a display** returns a one-time
`/tv/pair?t=…` link. Open it once on the TV; it swaps the token for a cookie,
redirects to `/tv`, and that screen stays signed in for `TV_SESSION_DAYS` (90).

The link is a credential — anyone holding it can see the board — so it is shown
once, like an ingest key, and never again.

A paired display can reach **`/tv` and `/api/tv` and nothing else**. It cannot
read `/api/issues`, an issue's events, or a single stack trace; `canView()`
returns false for it. What `/api/tv` returns is therefore the whole of what a
paired screen can ever learn: titles, culprit files, counts and timestamps. No
stacks, no context blobs, no `user_sub`. That boundary is the point — this
credential lives in a TV's browser profile, in a room full of teenagers, for
three months at a time.

Unpairing deletes the session, so the screen shows **DISPLAY SIGNED OUT** within
20 seconds. Pairing and unpairing are both audited.

---

## Reporting from an app

Register the app at `/admin` → **Reporting apps**. You get an ingest key, shown
once. Then drop in the client for your runtime from `clients/`:

| Runtime | File | Install as |
|---|---|---|
| Cloudflare Workers | `clients/worker.js` | `src/lib/telemetry.js` |
| Node / Express (CJS) | `clients/express.cjs` | `middleware/telemetry.cjs` |
| Browser / static | `clients/browser.js` | `js/telemetry.js` |
| Python / FastAPI | `clients/telemetry.py` | `middleware/telemetry.py` |
| Classroom laptops | — | via the fleet manager (see below) |

### Managed laptops

The kiosk laptops report here too — failed startup checks, Wi-Fi that will not
connect, a crash-looping browser, a systemd unit that died. They do **not** hold
an ingest key: a key that walks out of the building on a laptop must not be able
to write to the estate's error board. They post to `fleet.lmhstech.com` with
their per-device key and the fleet Worker forwards under its own `TELEMETRY_KEY`,
stamping which machine it was. A laptop that is offline spools its reports to
disk and delivers them on the next heartbeat.

Nothing needs configuring here beyond registering `fleet` as a reporting app.
Those reports arrive with no stack and a `context.source` of `laptop`; triage
reads them as machines rather than pages — see `deviceFacts` in
`src/lib/triage.js`.

### Workers

```js
import { withTelemetry } from './lib/telemetry.js';

export default withTelemetry({
  async fetch(request, env, ctx) { /* … */ },
});
```

```bash
wrangler secret put TELEMETRY_KEY
```

### Express

```js
const { telemetryErrorHandler, reportFatal } = require('./middleware/telemetry.cjs');

app.use(telemetryErrorHandler);   // last, after routes and the 404
```

Set `TELEMETRY_KEY` in the environment. The handler reports and then calls
`next(err)`, so whatever the app already did about errors keeps happening.

### Browser

```html
<script src="/js/telemetry.js"></script>
```

Edit the config block at the top of that file with the key. **The site's CSP
must allow `connect-src https://telemetry.lmhstech.com`** or every report is
silently blocked.

A static site's ingest key is public by necessity. That is accepted: it
authorises writing a crash report and nothing else, and it is revoked by
rotating it on the admin page. Never give a browser the key of a server-side
app.

### Python

```python
from middleware.telemetry import install_fastapi
install_fastapi(app)
```

### The wire format

`POST /api/ingest`, `Authorization: Bearer <ingest key>`:

```json
{
  "message":     "required",
  "stack":       "optional",
  "level":       "error | warning | info",
  "environment": "production",
  "release":     "git sha",
  "fingerprint": "optional — override grouping",
  "context":     { "any": "json, scrubbed and bounded" },
  "occurred_at": 1786300000
}
```

Returns `202` with the issue id. Rate limited per app per minute; bodies over
`INGEST_MAX_BYTES` are rejected.

---

## Triage

```
rules compute a floor  →  model classifies within it  →  floor re-applied
```

The floor is not advisory. Anything touching sign-in, sessions or the database
is at least P2. Anything touching personal data — including the scrubber
firing, which means something reached a reporter that should never have been in
scope — is P1. The model may **raise** a priority; it may not lower one past
the floor.

Volume nudges by at most one step and never past P2, because a crash loop in
one kiosk can manufacture a big number on its own.

Known-noise classes (`ResizeObserver loop`, cancelled fetches, browser
extensions) short-circuit to P4 without spending a model call.

If every model fails, the rule floor is the answer and the card says so. An
issue that could not be triaged still lands on the board — silently dropping
the thing you could not classify is the worst outcome available.

A human override is recorded as `manual` and is never overwritten by a later
model pass. Admins can force a re-triage, which explicitly discards the
override.

---

## Retention

Retention is a privacy control, not housekeeping. Swept nightly at 04:42 UTC:

| Data | Kept |
|---|---|
| Event bodies | `EVENT_RETENTION_DAYS` (30) |
| Resolved issues | `RESOLVED_ISSUE_RETENTION_DAYS` (90) |
| Sessions, in-flight logins | Until expiry |
| Audit log | 1 year |

Issue rows outlive their events, so counts and the triage decision survive the
raw text they were derived from.

---

## Tests

```bash
npm test
```

32 tests over the parts where being wrong is expensive: the scrubber, issue
grouping, and the triage floor. The model is stubbed — what is tested is what
must hold when it is wrong, absent, or adversarial.
