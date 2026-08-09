// OIDC login / callback / logout against auth.lmhstech.com.

import { now, randomId, redirect, html, cookie, clearCookie, parseCookies } from '../lib/http.js';
import { pkce, buildAuthorizeUrl, exchangeCode, endSessionUrl } from '../lib/oidc.js';
import {
  provisionUser, createSession, destroySession, getSession, SESSION_COOKIE_NAME,
} from '../lib/session.js';
import { deniedPage } from '../ui/pages.js';

const TXN_COOKIE = 'telemetry_txn';
const TXN_TTL = 600; // 10 min to complete a login

export async function login(request, env) {
  const { verifier, challenge } = await pkce();
  const state = randomId(24);
  const nonce = randomId(24);
  const txnId = randomId(24);

  const returnTo = sanitizeReturn(new URL(request.url).searchParams.get('return_to'));

  const ts = now();
  await env.DB.prepare(
    `INSERT INTO oidc_txns (id, state, nonce, code_verifier, return_to, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(txnId, state, nonce, verifier, returnTo, ts, ts + TXN_TTL)
    .run();

  return redirect(await buildAuthorizeUrl(env, { challenge, state, nonce }), {
    headers: { 'Set-Cookie': cookie(TXN_COOKIE, txnId, { maxAge: TXN_TTL, sameSite: 'Lax' }) },
  });
}

export async function callback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  const oidcError = url.searchParams.get('error');
  if (oidcError) return html(deniedPage(env, `Sign-in failed: ${oidcError}`), { status: 400 });
  if (!code || !state) return html(deniedPage(env, 'Missing code or state.'), { status: 400 });

  const txnId = parseCookies(request)[TXN_COOKIE];
  if (!txnId) return html(deniedPage(env, 'Login session expired. Try again.'), { status: 400 });

  const txn = await env.DB.prepare('SELECT * FROM oidc_txns WHERE id = ?').bind(txnId).first();
  await env.DB.prepare('DELETE FROM oidc_txns WHERE id = ?').bind(txnId).run(); // single use

  if (!txn || txn.expires_at < now()) return html(deniedPage(env, 'Login expired. Try again.'), { status: 400 });
  if (txn.state !== state) return html(deniedPage(env, 'State mismatch. Try again.'), { status: 400 });

  let claims;
  try {
    claims = await exchangeCode(env, { code, codeVerifier: txn.code_verifier, expectedNonce: txn.nonce });
  } catch {
    return html(deniedPage(env, 'Could not verify your identity.'), { status: 400 });
  }

  await provisionUser(env, claims);
  const session = await createSession(env, claims);

  // Note: a student with no viewer grant still gets a session here, and is
  // turned away by canView() at the page instead. That is deliberate — if an
  // admin adds them while they are sitting on the "no access" page, a refresh
  // is enough, with no second trip through the IdP.
  const headers = new Headers();
  headers.append('Set-Cookie', cookie(SESSION_COOKIE_NAME, session.id, { maxAge: session.maxAge }));
  headers.append('Set-Cookie', clearCookie(TXN_COOKIE));
  headers.append('Location', sanitizeReturn(txn.return_to) || '/');
  return new Response(null, { status: 302, headers });
}

export async function logout(request, env) {
  const session = await getSession(env, request);
  if (session) await destroySession(env, session.id);

  const headers = new Headers();
  headers.append('Set-Cookie', clearCookie(SESSION_COOKIE_NAME));
  headers.append('Location', (await endSessionUrl(env)) || '/');
  return new Response(null, { status: 302, headers });
}

// Only local, path-only returns — anything else is an open redirect.
function sanitizeReturn(value) {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}
