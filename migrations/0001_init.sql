-- telemetry.lmhstech.com — schema.
--
-- PRIVACY NOTE, and it is the reason several columns are missing:
--
-- This database holds crash reports from apps students use. It has no name
-- column, no email column and no student ID column, and there must never be
-- one. The only identifier that may appear against a report is the OIDC `sub`
-- of the signed-in user at the time — a UUID that means nothing outside
-- auth.lmhstech.com — and even that is optional and off by default.
--
-- Reporting apps are expected to scrub before they send; src/lib/scrub.js
-- scrubs again on arrival, because "expected to" is not a control.

-- ── Reporting sources ─────────────────────────────────────────────────────
-- One row per app allowed to POST /api/ingest. Each gets its own key so a key
-- can be rotated for one app without taking the whole estate's reporting down.
CREATE TABLE IF NOT EXISTS apps (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,     -- 'velri', 'fleet', 'sandbox-1', …
  name        TEXT NOT NULL,
  key_hash    TEXT NOT NULL,            -- SHA-256 of the ingest key, hex
  key_hint    TEXT,                     -- last 4 chars, to tell keys apart in the UI
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  created_by  TEXT                      -- admin username that registered it
);
CREATE INDEX IF NOT EXISTS idx_apps_key ON apps(key_hash) WHERE active = 1;

-- ── Issues ────────────────────────────────────────────────────────────────
-- Events that share a fingerprint are one issue. This is what the dashboard
-- lists and what the AI prioritises; `events` below is the evidence.
CREATE TABLE IF NOT EXISTS issues (
  id              TEXT PRIMARY KEY,
  app_id          TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  fingerprint     TEXT NOT NULL,
  title           TEXT NOT NULL,        -- scrubbed first line of the message
  culprit         TEXT,                 -- best-guess file:line from the stack
  level           TEXT NOT NULL,        -- error | warning | info
  status          TEXT NOT NULL,        -- open | resolved | ignored
  events_count    INTEGER NOT NULL DEFAULT 0,
  first_seen_at   INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,

  -- Effective priority: P1 (drop everything) … P4 (noise). `priority_source`
  -- records whether a human overrode the model. A manual priority is never
  -- overwritten by a later AI pass — see src/lib/triage.js.
  priority        TEXT,
  priority_source TEXT,                 -- ai | manual | rule
  ai_priority     TEXT,
  ai_confidence   REAL,
  ai_rationale    TEXT,
  ai_model        TEXT,
  ai_at           INTEGER,

  resolved_at     INTEGER,
  resolved_by     TEXT,
  UNIQUE (app_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_issues_board  ON issues(status, priority, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_app    ON issues(app_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_untriaged ON issues(ai_at) WHERE ai_at IS NULL;

-- ── Events ────────────────────────────────────────────────────────────────
-- Individual occurrences. Swept on EVENT_RETENTION_DAYS; the parent issue
-- survives its events so the counts and the triage decision are not lost.
CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  issue_id     TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  app_id       TEXT NOT NULL,
  message      TEXT NOT NULL,
  stack        TEXT,
  context      TEXT,                    -- scrubbed JSON blob, app-supplied
  environment  TEXT,                    -- production | development
  release      TEXT,                    -- git sha or version string
  user_sub     TEXT,                    -- OIDC sub only, or NULL. Never a name.
  occurred_at  INTEGER NOT NULL,
  received_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_issue ON events(issue_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_sweep ON events(received_at);

-- ── Who may sign in ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_users (
  sub           TEXT PRIMARY KEY,
  username      TEXT,
  role          TEXT NOT NULL,          -- student | teacher | admin, from the IdP
  first_seen_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);

-- ── Student viewers ───────────────────────────────────────────────────────
-- Teachers and admins get in by role. A student gets in only by being listed
-- here, added by an admin.
--
-- Keyed on username, not sub: an admin adding a student is reading a five-char
-- username off a printed label, and that student may never have signed in here
-- yet, so no sub exists to key on. `sub` is backfilled at first login — the
-- same pattern fleet uses for teacher assignments.
CREATE TABLE IF NOT EXISTS viewers (
  id          TEXT PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE,
  sub         TEXT,
  granted_by  TEXT NOT NULL,            -- admin username
  granted_at  INTEGER NOT NULL,
  note        TEXT                      -- e.g. "period 3 helpdesk". Not a name.
);
CREATE INDEX IF NOT EXISTS idx_viewers_sub ON viewers(sub);

-- ── Sessions + in-flight logins ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  sub        TEXT NOT NULL,
  username   TEXT,
  role       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS oidc_txns (
  id            TEXT PRIMARY KEY,
  state         TEXT NOT NULL,
  nonce         TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  return_to     TEXT,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_txns_expiry ON oidc_txns(expires_at);

-- ── Ingest rate limiting ──────────────────────────────────────────────────
-- Coarse per-app, per-minute counters. Swept with everything else.
CREATE TABLE IF NOT EXISTS ingest_budget (
  app_id     TEXT NOT NULL,
  minute     INTEGER NOT NULL,          -- unix seconds / 60
  count      INTEGER NOT NULL,
  PRIMARY KEY (app_id, minute)
);

-- ── Admin audit ───────────────────────────────────────────────────────────
-- Granting a student access to crash reports is a decision worth being able
-- to reconstruct later.
CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  actor      TEXT NOT NULL,             -- admin username
  action     TEXT NOT NULL,
  target     TEXT,
  detail     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at DESC);
