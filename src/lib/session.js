// App sessions (created after a verified OIDC login), user provisioning, and
// the access rule for who may look at crash reports.

import { now, randomId, parseCookies } from './http.js';

const SESSION_COOKIE = 'telemetry_session';
const SESSION_TTL = 12 * 60 * 60; // one school day

export const SESSION_COOKIE_NAME = SESSION_COOKIE;

/**
 * Upsert the app_users row from OIDC claims.
 *
 * Roles are re-read from the IdP on every login rather than cached, per
 * INTEGRATING.md: a student promoted to helpdesk, or a teacher who has left,
 * must take effect at their next sign-in and not whenever a cache expires.
 */
export async function provisionUser(env, { sub, username, role }) {
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO app_users (sub, username, role, first_seen_at, last_login_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(sub) DO UPDATE SET username = excluded.username,
       role = excluded.role, last_login_at = excluded.last_login_at`,
  )
    .bind(sub, username, role, ts, ts)
    .run();

  // Backfill sub on a grant an admin created from a printed username before
  // this student had ever signed in here. Same pattern as fleet's assignments.
  if (username) {
    await env.DB.prepare('UPDATE viewers SET sub = ? WHERE username = ? AND sub IS NULL')
      .bind(sub, username)
      .run();
  }
}

export async function createSession(env, { sub, username, role }) {
  const id = randomId(32);
  const ts = now();
  await env.DB.prepare(
    'INSERT INTO sessions (id, sub, username, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, sub, username, role, ts, ts + SESSION_TTL)
    .run();
  return { id, maxAge: SESSION_TTL };
}

export async function getSession(env, request) {
  const id = parseCookies(request)[SESSION_COOKIE];
  if (!id) return null;

  const row = await env.DB.prepare(
    'SELECT id, sub, username, role, expires_at FROM sessions WHERE id = ?',
  )
    .bind(id)
    .first();
  if (!row) return null;
  if (row.expires_at < now()) {
    await destroySession(env, id);
    return null;
  }
  return { id: row.id, sub: row.sub, username: row.username, role: row.role };
}

export async function destroySession(env, id) {
  if (!id) return;
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
}

// ── Access ─────────────────────────────────────────────────────────────────

export const isStaff = (session) => session?.role === 'admin' || session?.role === 'teacher';
export const isAdmin = (session) => session?.role === 'admin';

/**
 * May this session read the issue board?
 *
 * Teachers and admins by role. A student only by an explicit, per-student
 * grant made by an admin — closed by default. Grants are matched on `sub`
 * where we have one and on username otherwise, so a grant works on a
 * student's very first visit.
 */
export async function canView(env, session) {
  if (!session) return false;
  if (isStaff(session)) return true;

  const row = await env.DB.prepare(
    'SELECT id FROM viewers WHERE (sub IS NOT NULL AND sub = ?) OR username = ? LIMIT 1',
  )
    .bind(session.sub, session.username || '')
    .first();
  return !!row;
}
