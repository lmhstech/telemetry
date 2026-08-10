// Browser API for the issue board. Session-authenticated; every handler
// re-checks access rather than trusting the router to have done it.

import { json, badRequest, forbidden, notFound, now, randomId } from '../lib/http.js';
import { canView, canViewTv, isStaff, isAdmin } from '../lib/session.js';
import { PRIORITIES } from '../lib/triage.js';
import { runTriage } from './ingest.js';

const STATUSES = new Set(['open', 'resolved', 'ignored']);

/** Log an action that changes who can see what, or what the board claims. */
async function audit(env, actor, action, target, detail) {
  await env.DB.prepare(
    'INSERT INTO audit_log (id, actor, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(randomId(12), actor || 'unknown', action, target || null, detail || null, now())
    .run();
}

// GET /api/issues?status=&priority=&app=&q=&limit=
export async function listIssues(request, env, session) {
  if (!(await canView(env, session))) return forbidden('You do not have access to telemetry.');

  const p = new URL(request.url).searchParams;
  const where = [];
  const binds = [];

  const status = p.get('status');
  if (status && STATUSES.has(status)) {
    where.push('i.status = ?');
    binds.push(status);
  } else if (!status || status === 'active') {
    where.push("i.status != 'ignored'");
  }

  const priority = p.get('priority');
  if (priority && PRIORITIES.includes(priority)) {
    where.push('i.priority = ?');
    binds.push(priority);
  }

  const app = p.get('app');
  if (app) {
    where.push('a.slug = ?');
    binds.push(app);
  }

  const q = (p.get('q') || '').trim();
  if (q) {
    where.push('(i.title LIKE ? OR i.culprit LIKE ?)');
    const like = `%${q.slice(0, 80)}%`;
    binds.push(like, like);
  }

  const limit = Math.min(Math.max(Number(p.get('limit')) || 100, 1), 200);

  const { results } = await env.DB.prepare(
    `SELECT i.id, i.title, i.culprit, i.level, i.status, i.events_count,
            i.first_seen_at, i.last_seen_at, i.priority, i.priority_source,
            i.ai_priority, i.ai_confidence, i.ai_rationale, i.ai_model, i.ai_at,
            i.resolved_at, i.resolved_by,
            a.slug AS app_slug, a.name AS app_name
     FROM issues i
     JOIN apps a ON a.id = i.app_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY
       CASE i.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 ELSE 5 END,
       i.last_seen_at DESC
     LIMIT ?`,
  )
    .bind(...binds, limit)
    .all();

  return json({ issues: results || [] });
}

// GET /api/issues/:id — one issue plus its most recent events.
export async function getIssue(request, env, session, id) {
  if (!(await canView(env, session))) return forbidden('You do not have access to telemetry.');

  const issue = await env.DB.prepare(
    `SELECT i.*, a.slug AS app_slug, a.name AS app_name
     FROM issues i JOIN apps a ON a.id = i.app_id WHERE i.id = ?`,
  )
    .bind(id)
    .first();
  if (!issue) return notFound('No such issue');

  const { results } = await env.DB.prepare(
    `SELECT id, message, stack, context, environment, release, occurred_at, received_at
     FROM events WHERE issue_id = ? ORDER BY occurred_at DESC LIMIT 20`,
  )
    .bind(id)
    .all();

  // user_sub is deliberately not selected. It exists so a developer can ask
  // "did this hit one person or thirty", which the count answers, and there is
  // no screen where showing one student's identifier to another helps.
  return json({ issue, events: results || [] });
}

// GET /api/stats — the board's summary tiles.
export async function stats(request, env, session) {
  if (!(await canView(env, session))) return forbidden('You do not have access to telemetry.');

  const row = await env.DB.prepare(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'open')                    AS open_issues,
       COUNT(*) FILTER (WHERE status = 'open' AND priority = 'P1') AS p1,
       COUNT(*) FILTER (WHERE status = 'open' AND priority = 'P2') AS p2,
       COUNT(*) FILTER (WHERE status = 'open' AND priority = 'P3') AS p3,
       COUNT(*) FILTER (WHERE status = 'open' AND priority = 'P4') AS p4,
       COUNT(*) FILTER (WHERE ai_at IS NULL AND status = 'open')   AS untriaged
     FROM issues`,
  ).first();

  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM events WHERE received_at > ?',
  )
    .bind(now() - 86400)
    .first();

  const { results: apps } = await env.DB.prepare(
    `SELECT a.slug, a.name,
            COUNT(i.id) FILTER (WHERE i.status = 'open') AS open_issues,
            MAX(i.last_seen_at) AS last_seen_at
     FROM apps a LEFT JOIN issues i ON i.app_id = a.id
     WHERE a.active = 1
     GROUP BY a.id ORDER BY a.name`,
  ).all();

  return json({ ...row, events_24h: recent?.n || 0, apps: apps || [] });
}

// GET /api/tv — everything the wallboard draws, in one round trip.
//
// This is the only endpoint a display session can reach, so what it returns is
// the whole of what a paired TV can ever learn. Deliberately absent: stacks,
// context blobs, event bodies, `user_sub`. A title and a culprit file are
// enough to know that something is broken and where to go look, and they are
// what already passes the scrubber on the way in.
export async function tvSummary(request, env, session) {
  if (!(await canViewTv(env, session))) return forbidden('You do not have access to telemetry.');

  const counts = await env.DB.prepare(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'open')                     AS open_issues,
       COUNT(*) FILTER (WHERE status = 'open' AND priority = 'P1') AS p1,
       COUNT(*) FILTER (WHERE status = 'open' AND priority = 'P2') AS p2,
       COUNT(*) FILTER (WHERE status = 'open' AND priority = 'P3') AS p3,
       COUNT(*) FILTER (WHERE status = 'open' AND priority = 'P4') AS p4,
       COUNT(*) FILTER (WHERE ai_at IS NULL AND status = 'open')   AS untriaged
     FROM issues`,
  ).first();

  const ts = now();
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) FILTER (WHERE received_at > ?) AS events_24h,
            COUNT(*) FILTER (WHERE received_at > ?) AS events_1h
     FROM events`,
  )
    .bind(ts - 86400, ts - 3600)
    .first();

  // worst_rank is the numeric form of the highest open priority for the app —
  // the dot next to its name. NULL means nothing open, which is the good case.
  const { results: apps } = await env.DB.prepare(
    `SELECT a.slug, a.name,
            COUNT(i.id) FILTER (WHERE i.status = 'open') AS open_issues,
            MIN(CASE i.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 ELSE 5 END)
              FILTER (WHERE i.status = 'open') AS worst_rank,
            MAX(i.last_seen_at) AS last_seen_at
     FROM apps a LEFT JOIN issues i ON i.app_id = a.id
     WHERE a.active = 1
     GROUP BY a.id ORDER BY a.name`,
  ).all();

  const { results: issues } = await env.DB.prepare(
    `SELECT i.id, i.title, i.culprit, i.level, i.events_count, i.last_seen_at,
            i.priority, i.priority_source, a.name AS app_name, a.slug AS app_slug
     FROM issues i JOIN apps a ON a.id = i.app_id
     WHERE i.status = 'open'
     ORDER BY
       CASE i.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 ELSE 5 END,
       i.last_seen_at DESC
     LIMIT 200`,
  ).all();

  return json({
    ...counts,
    events_24h: recent?.events_24h || 0,
    events_1h: recent?.events_1h || 0,
    apps: apps || [],
    issues: issues || [],
    generated_at: ts,
  });
}

// POST /api/issues/:id/status  { status }
export async function setStatus(request, env, session, id) {
  if (!isStaff(session)) return forbidden('Only teachers and admins can change an issue.');

  const body = await request.json().catch(() => null);
  const status = body?.status;
  if (!STATUSES.has(status)) return badRequest('status must be open, resolved or ignored');

  const res = await env.DB.prepare(
    `UPDATE issues SET status = ?,
       resolved_at = CASE WHEN ? = 'resolved' THEN ? ELSE NULL END,
       resolved_by = CASE WHEN ? = 'resolved' THEN ? ELSE NULL END
     WHERE id = ?`,
  )
    .bind(status, status, now(), status, session.username, id)
    .run();
  if (!res.meta.changes) return notFound('No such issue');

  await audit(env, session.username, `issue.${status}`, id, null);
  return json({ ok: true });
}

// POST /api/issues/:id/priority  { priority }
// A human override. Recorded as 'manual' so later AI passes leave it alone.
export async function setPriority(request, env, session, id) {
  if (!isStaff(session)) return forbidden('Only teachers and admins can change priority.');

  const body = await request.json().catch(() => null);
  const priority = body?.priority;
  if (!PRIORITIES.includes(priority)) return badRequest(`priority must be one of ${PRIORITIES.join(', ')}`);

  const res = await env.DB.prepare(
    "UPDATE issues SET priority = ?, priority_source = 'manual' WHERE id = ?",
  )
    .bind(priority, id)
    .run();
  if (!res.meta.changes) return notFound('No such issue');

  await audit(env, session.username, 'issue.priority', id, priority);
  return json({ ok: true });
}

// POST /api/issues/:id/retriage — ask the model again.
// Useful after an issue's volume changes, or when a rule has been edited.
export async function retriage(request, env, session, id) {
  if (!isAdmin(session)) return forbidden('Only admins can re-run triage.');

  const issue = await env.DB.prepare(
    `SELECT i.id, i.title, i.culprit, i.level, i.events_count, a.slug AS app_slug
     FROM issues i JOIN apps a ON a.id = i.app_id WHERE i.id = ?`,
  )
    .bind(id)
    .first();
  if (!issue) return notFound('No such issue');

  const sample = await env.DB.prepare(
    'SELECT stack, environment FROM events WHERE issue_id = ? ORDER BY occurred_at DESC LIMIT 1',
  )
    .bind(id)
    .first();

  // Clearing priority_source lets the model's answer land; a manual override
  // is explicitly being discarded by an admin asking for this.
  await env.DB.prepare("UPDATE issues SET priority_source = 'ai' WHERE id = ?").bind(id).run();

  const verdict = await runTriage(env, {
    ...issue,
    sample_stack: sample?.stack || null,
    environment: sample?.environment || null,
  });

  await audit(env, session.username, 'issue.retriage', id, verdict.priority);
  return json({ ok: true, verdict });
}
