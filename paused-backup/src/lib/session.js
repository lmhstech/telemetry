// App sessions (created after a verified OIDC login), user provisioning, and
// the access rule for who may look at crash reports.

import { now, randomId, parseCookies } from './http.js';

const SESSION_COOKIE = 'telemetry_session';
const SESSION_TTL = 12 * 60 * 60; // one school day

export const SESSION_COOKIE_NAME = SESSION_COOKIE;

/**
 * The wall display.
 *
 * A TV in the corner of the room cannot sign in with OIDC — nobody is going to
 * walk over and re-authenticate it twice a day, and a board that is showing a
 * login screen is worse than no board at all. So a display gets a session of
 * its own kind: created by an admin, long-lived, revocable, and able to reach
 * exactly two routes (`/tv` and `/api/tv`).
 *
 * It is deliberately NOT a student session with extra time. `canView` returns
 * false for it, so it cannot read `/api/issues`, an issue's events, or a single
 * stack trace — the summary feed is all it can see. That matters because this
 * credential lives in a TV's browser profile in a room full of teenagers.
 */
export const DISPLAY_ROLE = 'display';
const DISPLAY_TTL_DEFAULT_DAYS = 90;

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

/**
 * Mint a display session. Returns the id, which is also the pairing token —
 * the TV visits `/tv/pair?t=<id>` once and thereafter holds it as a cookie.
 *
 * There is no separate token table on purpose: the thing being handed out *is*
 * a session, so it revokes, expires and gets swept by exactly the machinery
 * that already exists for every other session.
 */
export async function createDisplaySession(env, { label, createdBy }) {
  const id = randomId(32);
  const ts = now();
  const days = Number(env.TV_SESSION_DAYS || DISPLAY_TTL_DEFAULT_DAYS);
  const expires = ts + days * 86400;

  await env.DB.prepare(
    'INSERT INTO sessions (id, sub, username, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, `tv:${randomId(8)}`, label, DISPLAY_ROLE, ts, expires)
    .run();

  return { id, expires_at: expires, days };
}

export async function destroySession(env, id) {
  if (!id) return;
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
}

// ── Access ─────────────────────────────────────────────────────────────────

export const isStaff = (session) => session?.role === 'admin' || session?.role === 'teacher';
export const isAdmin = (session) => session?.role === 'admin';
export const isDisplay = (session) => session?.role === DISPLAY_ROLE;

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

  // A wall display is not a reader. It gets the summary feed and nothing else,
  // so it must fail this check before the grant lookup rather than rely on no
  // `viewers` row happening to match its synthetic sub.
  if (isDisplay(session)) return false;

  if (isStaff(session)) return true;

  const row = await env.DB.prepare(
    'SELECT id FROM viewers WHERE (sub IS NOT NULL AND sub = ?) OR username = ? LIMIT 1',
  )
    .bind(session.sub, session.username || '')
    .first();
  return !!row;
}

/** May this session read the wallboard summary? Anyone who can read the board,
 *  plus the displays themselves. */
export async function canViewTv(env, session) {
  if (isDisplay(session)) return true;
  return canView(env, session);
}
