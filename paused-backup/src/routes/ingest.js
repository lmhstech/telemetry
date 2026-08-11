// POST /api/ingest — the endpoint every other app in the estate reports to.
//
// Design constraints, in order of importance:
//
//   1. It must never make the reporting app worse. Reporting is best-effort:
//      a slow or failing telemetry service must not slow down or fail a
//      student's page load. So this does the minimum synchronously and pushes
//      AI triage into ctx.waitUntil.
//   2. It must not become a way to store personal information. Everything is
//      scrubbed on arrival — see lib/scrub.js for why we do not simply trust
//      the reporter.
//   3. It must not be a way to fill the database. Per-app rate limit, body
//      size cap, and bounded field lengths.

import {
  json, badRequest, unauthorized, tooMany, now, randomId, sha256hex, timingSafeEqual,
} from '../lib/http.js';
import { scrubText, scrubStack, scrubValue } from '../lib/scrub.js';
import { fingerprintFor, culpritFrame, deviceCulprit, titleFor } from '../lib/fingerprint.js';
import { triageIssue } from '../lib/triage.js';

const LEVELS = new Set(['error', 'warning', 'info']);

/** Resolve the bearer ingest key to an active app row, or null. */
async function authenticateApp(env, request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const presented = match[1].trim();
  if (!presented) return null;

  const hash = await sha256hex(presented);
  const app = await env.DB.prepare(
    'SELECT id, slug, name, key_hash FROM apps WHERE key_hash = ? AND active = 1',
  )
    .bind(hash)
    .first();
  if (!app) return null;

  // The lookup above already matched on the hash; this is belt-and-braces
  // against a future refactor that widens the query.
  if (!timingSafeEqual(app.key_hash, hash)) return null;
  return app;
}

/** Coarse per-app, per-minute budget. */
async function withinBudget(env, appId) {
  const limit = Number(env.INGEST_MAX_PER_MINUTE || 120);
  const minute = Math.floor(now() / 60);

  await env.DB.prepare(
    `INSERT INTO ingest_budget (app_id, minute, count) VALUES (?, ?, 1)
     ON CONFLICT(app_id, minute) DO UPDATE SET count = count + 1`,
  )
    .bind(appId, minute)
    .run();

  const row = await env.DB.prepare('SELECT count FROM ingest_budget WHERE app_id = ? AND minute = ?')
    .bind(appId, minute)
    .first();
  return (row?.count || 0) <= limit;
}

export async function ingest(request, env, ctx) {
  const app = await authenticateApp(env, request);
  if (!app) return unauthorized('Unknown or inactive ingest key');

  const maxBytes = Number(env.INGEST_MAX_BYTES || 16384);
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > maxBytes) return badRequest(`Report too large (max ${maxBytes} bytes)`);

  const raw = await request.text();
  if (raw.length > maxBytes) return badRequest(`Report too large (max ${maxBytes} bytes)`);

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return badRequest('Invalid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return badRequest('Body must be a JSON object');

  const message = scrubText(String(body.message ?? '')).trim();
  if (!message) return badRequest('message is required');

  const level = LEVELS.has(body.level) ? body.level : 'error';
  const stack = scrubStack(body.stack);
  const environment = scrubText(String(body.environment ?? 'production')).slice(0, 40);
  const release = scrubText(String(body.release ?? '')).slice(0, 80) || null;

  // The reporter may pass the signed-in user's OIDC sub — a UUID and nothing
  // else. Anything that is not UUID-shaped is dropped rather than stored,
  // because the only reason it would not be UUID-shaped is that someone put
  // something identifying there.
  const rawSub = typeof body.user_sub === 'string' ? body.user_sub.trim() : '';
  const userSub = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawSub) ? rawSub : null;

  const context = body.context && typeof body.context === 'object' ? scrubValue(body.context) : null;

  // A reporter's clock may be wrong or attacker-set; clamp to a sane window
  // around ours so nothing sorts to the year 2098.
  const received = now();
  const claimed = Number(body.occurred_at);
  const occurred = Number.isFinite(claimed) && claimed > received - 86400 && claimed <= received + 300
    ? Math.floor(claimed)
    : received;

  if (!(await withinBudget(env, app.id))) {
    return tooMany('Ingest rate limit exceeded for this app');
  }

  const fingerprint = await fingerprintFor({
    appId: app.id,
    message,
    stack,
    explicit: body.fingerprint,
  });
  // A report from a laptop has no stack; what it has is the check or command
  // that failed, which is the same kind of pointer.
  const culprit = culpritFrame(stack) || deviceCulprit(context);
  const title = titleFor(message);

  // Upsert the issue. A resolved issue that recurs reopens: the fix did not
  // hold, and that is more useful to know than a tidy board.
  await env.DB.prepare(
    `INSERT INTO issues (id, app_id, fingerprint, title, culprit, level, status,
                         events_count, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', 1, ?, ?)
     ON CONFLICT(app_id, fingerprint) DO UPDATE SET
       events_count = events_count + 1,
       last_seen_at = excluded.last_seen_at,
       title        = excluded.title,
       culprit      = COALESCE(excluded.culprit, issues.culprit),
       status       = CASE WHEN issues.status = 'resolved' THEN 'open' ELSE issues.status END,
       resolved_at  = CASE WHEN issues.status = 'resolved' THEN NULL ELSE issues.resolved_at END,
       resolved_by  = CASE WHEN issues.status = 'resolved' THEN NULL ELSE issues.resolved_by END`,
  )
    .bind(randomId(16), app.id, fingerprint, title, culprit, level, occurred, occurred)
    .run();

  const issue = await env.DB.prepare(
    `SELECT id, events_count, level, title, culprit, ai_at, priority, priority_source
     FROM issues WHERE app_id = ? AND fingerprint = ?`,
  )
    .bind(app.id, fingerprint)
    .first();

  await env.DB.prepare(
    `INSERT INTO events (id, issue_id, app_id, message, stack, context, environment,
                         release, user_sub, occurred_at, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      randomId(16), issue.id, app.id, message.slice(0, 4000), stack,
      context ? JSON.stringify(context) : null,
      environment, release, userSub, occurred, received,
    )
    .run();

  // Triage happens after the response is on its way. The reporting app gets
  // its 202 without waiting for a model.
  if (!issue.ai_at) {
    ctx.waitUntil(
      runTriage(env, {
        ...issue,
        app_slug: app.slug,
        sample_stack: stack,
        environment,
        context,   // a machine's identity and failed check live here, not in a stack
      }).catch((err) => console.error('triage failed:', err && err.message)),
    );
  }

  return json({ ok: true, issue_id: issue.id, status: 'accepted' }, { status: 202 });
}

/**
 * Run triage and store the result.
 *
 * A priority a human set by hand is never overwritten — the whole point of the
 * override is that the person knows something the model does not.
 */
export async function runTriage(env, issue) {
  // How much of the estate this touches, counted rather than guessed. One
  // laptop repeating a fault four times is one laptop; four laptops reporting
  // it once each is a different problem entirely, and the events know which.
  let deviceCount = 0;
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(DISTINCT json_extract(context, '$.machine_id')) AS machines
       FROM events WHERE issue_id = ?`,
    )
      .bind(issue.id)
      .first();
    deviceCount = Number(row?.machines) || 0;
  } catch {
    /* json_extract on a malformed context must not stop triage */
  }

  const verdict = await triageIssue(env, { ...issue, device_count: deviceCount });

  await env.DB.prepare(
    `UPDATE issues SET
       priority        = CASE WHEN priority_source = 'manual' THEN priority ELSE ? END,
       priority_source = CASE WHEN priority_source = 'manual' THEN 'manual' ELSE ? END,
       ai_priority     = ?,
       ai_confidence   = ?,
       ai_rationale    = ?,
       ai_model        = ?,
       ai_at           = ?
     WHERE id = ?`,
  )
    .bind(
      verdict.priority, verdict.source, verdict.aiPriority, verdict.confidence,
      verdict.rationale, verdict.model, now(), issue.id,
    )
    .run();

  return verdict;
}
