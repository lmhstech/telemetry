// Admin API: registering the apps that may report, and granting students
// access to read what they report.
//
// Everything here is admin-only and everything here is audited.

import { json, badRequest, forbidden, notFound, now, randomId, sha256hex } from '../lib/http.js';
import { isAdmin } from '../lib/session.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;

// Usernames issued by auth.lmhstech.com are five random alphanumeric
// characters. Kept slightly wider than that so a future change to the
// generator does not lock admins out of granting access.
const USERNAME_RE = /^[A-Za-z0-9]{3,32}$/;

async function audit(env, actor, action, target, detail) {
  await env.DB.prepare(
    'INSERT INTO audit_log (id, actor, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(randomId(12), actor || 'unknown', action, target || null, detail || null, now())
    .run();
}

/** Ingest keys are shown once, at creation, and only ever stored hashed. */
function newIngestKey() {
  const secret = randomId(32);
  return { key: `lmhstel_${secret}`, hint: secret.slice(-4) };
}

// ── Reporting apps ─────────────────────────────────────────────────────────

// GET /api/admin/apps
export async function listApps(request, env, session) {
  if (!isAdmin(session)) return forbidden('Admins only.');

  const { results } = await env.DB.prepare(
    `SELECT a.id, a.slug, a.name, a.key_hint, a.active, a.created_at, a.created_by,
            COUNT(i.id) AS issue_count,
            MAX(i.last_seen_at) AS last_report_at
     FROM apps a LEFT JOIN issues i ON i.app_id = a.id
     GROUP BY a.id ORDER BY a.name`,
  ).all();

  return json({ apps: results || [] });
}

// POST /api/admin/apps  { slug, name }  -> returns the key ONCE
export async function createApp(request, env, session) {
  if (!isAdmin(session)) return forbidden('Admins only.');

  const body = await request.json().catch(() => null);
  const slug = String(body?.slug || '').trim().toLowerCase();
  const name = String(body?.name || '').trim().slice(0, 80);

  if (!SLUG_RE.test(slug)) return badRequest('slug must be 2-39 chars, lowercase letters, digits and hyphens');
  if (!name) return badRequest('name is required');

  const existing = await env.DB.prepare('SELECT id FROM apps WHERE slug = ?').bind(slug).first();
  if (existing) return badRequest(`An app with slug "${slug}" already exists`);

  const { key, hint } = newIngestKey();
  const id = randomId(16);

  await env.DB.prepare(
    'INSERT INTO apps (id, slug, name, key_hash, key_hint, active, created_at, created_by) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
  )
    .bind(id, slug, name, await sha256hex(key), hint, now(), session.username)
    .run();

  await audit(env, session.username, 'app.create', slug, null);

  return json({
    ok: true,
    app: { id, slug, name, key_hint: hint },
    ingest_key: key,
    notice: 'Copy this key now — it is stored hashed and cannot be shown again.',
  }, { status: 201 });
}

// POST /api/admin/apps/:id/rotate — new key, old one dead immediately.
export async function rotateKey(request, env, session, id) {
  if (!isAdmin(session)) return forbidden('Admins only.');

  const app = await env.DB.prepare('SELECT id, slug FROM apps WHERE id = ?').bind(id).first();
  if (!app) return notFound('No such app');

  const { key, hint } = newIngestKey();
  await env.DB.prepare('UPDATE apps SET key_hash = ?, key_hint = ? WHERE id = ?')
    .bind(await sha256hex(key), hint, id)
    .run();

  await audit(env, session.username, 'app.rotate_key', app.slug, null);

  return json({
    ok: true,
    ingest_key: key,
    notice: 'The previous key stopped working the moment this was issued. Update the app before its next deploy.',
  });
}

// PATCH /api/admin/apps/:id  { active }
export async function setAppActive(request, env, session, id) {
  if (!isAdmin(session)) return forbidden('Admins only.');

  const body = await request.json().catch(() => null);
  if (typeof body?.active !== 'boolean') return badRequest('active must be true or false');

  const res = await env.DB.prepare('UPDATE apps SET active = ? WHERE id = ?')
    .bind(body.active ? 1 : 0, id)
    .run();
  if (!res.meta.changes) return notFound('No such app');

  await audit(env, session.username, body.active ? 'app.enable' : 'app.disable', id, null);
  return json({ ok: true });
}

// ── Student viewers ────────────────────────────────────────────────────────

// GET /api/admin/viewers
export async function listViewers(request, env, session) {
  if (!isAdmin(session)) return forbidden('Admins only.');

  const { results } = await env.DB.prepare(
    `SELECT v.id, v.username, v.note, v.granted_by, v.granted_at,
            v.sub IS NOT NULL AS has_signed_in,
            u.last_login_at
     FROM viewers v LEFT JOIN app_users u ON u.sub = v.sub
     ORDER BY v.granted_at DESC`,
  ).all();

  return json({ viewers: results || [] });
}

// POST /api/admin/viewers  { username, note }
//
// Keyed on username because that is what an admin is holding: a five-character
// code off a printed label. The student need not ever have opened this app —
// `sub` is filled in at their first sign-in.
export async function addViewer(request, env, session) {
  if (!isAdmin(session)) return forbidden('Admins only.');

  const body = await request.json().catch(() => null);
  const username = String(body?.username || '').trim();

  // A note is for context like "period 3 helpdesk". It is not a name field,
  // and the length cap plus the audit trail are what keep it from becoming one.
  const note = String(body?.note || '').trim().slice(0, 80) || null;

  if (!USERNAME_RE.test(username)) {
    return badRequest('username must be 3-32 letters and digits — the code from the student\'s sign-in label');
  }

  const existing = await env.DB.prepare('SELECT id FROM viewers WHERE username = ?').bind(username).first();
  if (existing) return badRequest(`${username} already has access`);

  // If this student has signed in to telemetry before, link the grant to their
  // sub straight away rather than waiting for a next login that may not come.
  const known = await env.DB.prepare('SELECT sub FROM app_users WHERE username = ?').bind(username).first();

  const id = randomId(12);
  await env.DB.prepare(
    'INSERT INTO viewers (id, username, sub, granted_by, granted_at, note) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, username, known?.sub || null, session.username, now(), note)
    .run();

  await audit(env, session.username, 'viewer.add', username, note);
  return json({ ok: true, viewer: { id, username, note } }, { status: 201 });
}

// DELETE /api/admin/viewers/:id
//
// Also drops the student's live sessions. Revoking access that leaves the
// person still looking at the page until their cookie expires is not revoking
// access.
export async function removeViewer(request, env, session, id) {
  if (!isAdmin(session)) return forbidden('Admins only.');

  const viewer = await env.DB.prepare('SELECT id, username, sub FROM viewers WHERE id = ?').bind(id).first();
  if (!viewer) return notFound('No such grant');

  await env.DB.prepare('DELETE FROM viewers WHERE id = ?').bind(id).run();
  if (viewer.sub) {
    await env.DB.prepare("DELETE FROM sessions WHERE sub = ? AND role = 'student'").bind(viewer.sub).run();
  }

  await audit(env, session.username, 'viewer.remove', viewer.username, null);
  return json({ ok: true });
}

// GET /api/admin/audit?limit=
export async function listAudit(request, env, session) {
  if (!isAdmin(session)) return forbidden('Admins only.');

  const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get('limit')) || 100, 1), 300);
  const { results } = await env.DB.prepare(
    'SELECT id, actor, action, target, detail, created_at FROM audit_log ORDER BY created_at DESC LIMIT ?',
  )
    .bind(limit)
    .all();

  return json({ entries: results || [] });
}
