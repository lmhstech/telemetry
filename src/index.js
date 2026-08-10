// telemetry.lmhstech.com — Worker entry / router.
//
// Three surfaces:
//   1. Ingest   POST /api/ingest   — per-app bearer key, no session
//   2. Pages    /, /admin          — OIDC session cookie
//   3. API      /api/…             — session cookie + role/grant checks
//
// Plus a nightly scheduled sweep that enforces retention.

import { html, json, notFound, now, redirect, cookie } from './lib/http.js';
import {
  getSession, canView, isAdmin, isDisplay,
  DISPLAY_ROLE, SESSION_COOKIE_NAME,
} from './lib/session.js';
import * as authRoutes from './routes/auth.js';
import { ingest } from './routes/ingest.js';
import * as api from './routes/api.js';
import * as admin from './routes/admin.js';
import { loginPage, noAccessPage } from './ui/pages.js';
import { dashboardPage, adminPage } from './ui/dashboard.js';
import { tvPage, tvPairPage } from './ui/tv.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    try {
      // ── Ingest. First, and deliberately outside the session check. ──
      if (path === '/api/ingest') {
        if (method === 'OPTIONS') return preflight();
        if (method !== 'POST') return json({ error: 'Use POST' }, { status: 405 });
        return withCors(await ingest(request, env, ctx));
      }

      // Liveness probe for status.lmhstech.com. Says nothing about the estate.
      if (path === '/health') return json({ ok: true, service: 'telemetry', time: now() });

      // ── Auth flow ──
      if (path === '/auth/login') return authRoutes.login(request, env);
      if (path === '/auth/callback') return authRoutes.callback(request, env);
      if (path === '/auth/logout') return authRoutes.logout(request, env);

      // Pairing a wall display. Outside the session check because this is what
      // creates the session — the token in `?t=` *is* a display session that an
      // admin minted, and all this does is move it into a cookie so it does not
      // sit in the TV's address bar or history.
      if (path === '/tv/pair') return pairDisplay(request, env, url);

      // ── Everything below needs a session ──
      const session = await getSession(env, request);

      if (path === '/') {
        if (!session) return html(loginPage(env));
        if (!(await canView(env, session))) return html(noAccessPage(env, session), { status: 403 });
        return html(dashboardPage(env, session));
      }

      // The wallboard. A paired TV gets in on its display session; a signed-in
      // teacher or admin can just open it. Anyone else sees how to pair one.
      if (path === '/tv') {
        if (!session) return html(tvPairPage(env));
        if (isDisplay(session) || (await canView(env, session))) return html(tvPage(env, session));
        return html(noAccessPage(env, session), { status: 403 });
      }

      if (path === '/admin') {
        if (!session) return html(loginPage(env));
        if (!isAdmin(session)) return html(noAccessPage(env, session), { status: 403 });
        return html(adminPage(env, session));
      }

      if (path.startsWith('/api/')) {
        if (!session) return json({ error: 'Not signed in' }, { status: 401 });
        return routeApi(request, env, session, path, method);
      }

      return notFound('Not found');
    } catch (err) {
      // The telemetry service cannot report its own crashes to itself, so this
      // goes to `wrangler tail`. The client gets no internals.
      console.error('unhandled:', err && err.stack ? err.stack : err);
      return json({ error: 'Server error' }, { status: 500 });
    }
  },

  // Nightly retention sweep. Retention is a privacy control here, not
  // housekeeping — see migrations/0001_init.sql.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sweep(env));
  },
};

function routeApi(request, env, session, path, method) {
  // ── Board ──
  if (path === '/api/issues' && method === 'GET') return api.listIssues(request, env, session);
  if (path === '/api/stats' && method === 'GET') return api.stats(request, env, session);

  // The wallboard's feed, and the only /api route a display session may reach.
  if (path === '/api/tv' && method === 'GET') return api.tvSummary(request, env, session);

  let m;
  if ((m = path.match(/^\/api\/issues\/([^/]+)\/status$/)) && method === 'POST')
    return api.setStatus(request, env, session, m[1]);
  if ((m = path.match(/^\/api\/issues\/([^/]+)\/priority$/)) && method === 'POST')
    return api.setPriority(request, env, session, m[1]);
  if ((m = path.match(/^\/api\/issues\/([^/]+)\/retriage$/)) && method === 'POST')
    return api.retriage(request, env, session, m[1]);
  if ((m = path.match(/^\/api\/issues\/([^/]+)$/)) && method === 'GET')
    return api.getIssue(request, env, session, m[1]);

  // ── Admin ──
  if (path === '/api/admin/apps' && method === 'GET') return admin.listApps(request, env, session);
  if (path === '/api/admin/apps' && method === 'POST') return admin.createApp(request, env, session);
  if ((m = path.match(/^\/api\/admin\/apps\/([^/]+)\/rotate$/)) && method === 'POST')
    return admin.rotateKey(request, env, session, m[1]);
  if ((m = path.match(/^\/api\/admin\/apps\/([^/]+)$/)) && method === 'PATCH')
    return admin.setAppActive(request, env, session, m[1]);

  if (path === '/api/admin/viewers' && method === 'GET') return admin.listViewers(request, env, session);
  if (path === '/api/admin/viewers' && method === 'POST') return admin.addViewer(request, env, session);
  if ((m = path.match(/^\/api\/admin\/viewers\/([^/]+)$/)) && method === 'DELETE')
    return admin.removeViewer(request, env, session, m[1]);

  if (path === '/api/admin/displays' && method === 'GET') return admin.listDisplays(request, env, session);
  if (path === '/api/admin/displays' && method === 'POST') return admin.createDisplay(request, env, session);
  if ((m = path.match(/^\/api\/admin\/displays\/([^/]+)$/)) && method === 'DELETE')
    return admin.removeDisplay(request, env, session, m[1]);

  if (path === '/api/admin/audit' && method === 'GET') return admin.listAudit(request, env, session);

  return json({ error: 'Not found' }, { status: 404 });
}

/**
 * GET /tv/pair?t=<display session id>
 *
 * Swaps the token in the URL for the session cookie and bounces to /tv, so the
 * credential is not left sitting in the TV's address bar, history or in any
 * `Referer` it later sends. Only ever accepts a session whose role is
 * `display` — a token for anything else is treated as not existing.
 */
async function pairDisplay(request, env, url) {
  const token = url.searchParams.get('t') || '';
  if (!token) return html(tvPairPage(env), { status: 400 });

  const row = await env.DB.prepare(
    'SELECT id, expires_at FROM sessions WHERE id = ? AND role = ?',
  )
    .bind(token, DISPLAY_ROLE)
    .first();

  if (!row || row.expires_at < now()) return html(tvPairPage(env), { status: 403 });

  return redirect('/tv', {
    headers: {
      'Set-Cookie': cookie(SESSION_COOKIE_NAME, row.id, { maxAge: row.expires_at - now() }),
    },
  });
}

// ── CORS, for browser-side reporters only ──────────────────────────────────
//
// Ingest is authenticated by a bearer key, so the response carries no
// credentials and `*` is the correct origin here — it is not a hole, because
// possessing the key is the check. Browser reporters must therefore only ever
// use a key issued to a browser-exposed app; a leaked key is revoked by
// rotating it in the admin page.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}

function withCors(response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

// ── Retention sweep ────────────────────────────────────────────────────────

export async function sweep(env) {
  const ts = now();
  const eventCutoff = ts - Number(env.EVENT_RETENTION_DAYS || 30) * 86400;
  const resolvedCutoff = ts - Number(env.RESOLVED_ISSUE_RETENTION_DAYS || 90) * 86400;

  const statements = [
    // Expired sessions and abandoned half-finished logins.
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(ts),
    env.DB.prepare('DELETE FROM oidc_txns WHERE expires_at < ?').bind(ts),

    // Rate-limit counters older than an hour have nothing left to say.
    env.DB.prepare('DELETE FROM ingest_budget WHERE minute < ?').bind(Math.floor(ts / 60) - 60),

    // Event bodies past retention. The issue row survives, so the counts and
    // the triage decision outlive the raw text they were derived from.
    env.DB.prepare('DELETE FROM events WHERE received_at < ?').bind(eventCutoff),

    // Long-resolved issues go entirely.
    env.DB.prepare("DELETE FROM issues WHERE status = 'resolved' AND resolved_at IS NOT NULL AND resolved_at < ?")
      .bind(resolvedCutoff),

    // Audit entries are kept a year — long enough to answer "who gave that
    // student access", short enough to still be a retention limit.
    env.DB.prepare('DELETE FROM audit_log WHERE created_at < ?').bind(ts - 365 * 86400),
  ];

  const results = await env.DB.batch(statements);
  const removed = results.reduce((sum, r) => sum + (r.meta?.changes || 0), 0);
  console.log(`sweep: removed ${removed} rows`);
  return removed;
}
