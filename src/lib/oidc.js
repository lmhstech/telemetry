// OIDC authorization-code + PKCE client for auth.lmhstech.com.
//
// Per auth's INTEGRATING.md: PKCE is mandatory, the ID token MUST be verified
// against JWKS with the algorithm pinned to RS256, and endpoints come from the
// discovery document — never hardcoded.
//
// This is deliberately the same implementation fleet uses. Two Workers doing
// OIDC two different ways is how one of them ends up with the subtle bug.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { randomId, sha256b64url } from './http.js';

let _discovery = null;
let _discoveryAt = 0;
let _jwks = null;
let _jwksUri = null;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

export async function discovery(env) {
  if (_discovery && Date.now() - _discoveryAt < DISCOVERY_TTL_MS) return _discovery;
  const url = `${env.OIDC_ISSUER.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const res = await fetch(url, { cf: { cacheTtl: 3600 } });
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
  _discovery = await res.json();
  _discoveryAt = Date.now();
  return _discovery;
}

function jwksFor(uri) {
  if (!_jwks || _jwksUri !== uri) {
    _jwks = createRemoteJWKSet(new URL(uri));
    _jwksUri = uri;
  }
  return _jwks;
}

export async function pkce() {
  const verifier = randomId(48); // 64 url-safe chars, inside the 43-128 range
  return { verifier, challenge: await sha256b64url(verifier) };
}

export async function buildAuthorizeUrl(env, { challenge, state, nonce }) {
  const d = await discovery(env);
  const u = new URL(d.authorization_endpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', env.OIDC_CLIENT_ID);
  u.searchParams.set('redirect_uri', `${env.PUBLIC_URL}/auth/callback`);
  u.searchParams.set('scope', 'openid profile roles');
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', state);
  u.searchParams.set('nonce', nonce);
  return u.href;
}

// Exchange the code and return verified claims { sub, username, role }.
export async function exchangeCode(env, { code, codeVerifier, expectedNonce }) {
  const d = await discovery(env);

  const res = await fetch(d.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(`${env.OIDC_CLIENT_ID}:${env.OIDC_CLIENT_SECRET}`),
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${env.PUBLIC_URL}/auth/callback`,
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);

  const tokens = await res.json();
  if (!tokens.id_token) throw new Error('No id_token in token response');

  const { payload } = await jwtVerify(tokens.id_token, jwksFor(d.jwks_uri), {
    issuer: d.issuer,
    audience: env.OIDC_CLIENT_ID,
    algorithms: ['RS256'], // pinned — never trust `alg` from the header
  });

  if (payload.nonce !== expectedNonce) throw new Error('Nonce mismatch');

  return {
    sub: payload.sub,
    username: payload.preferred_username || null,
    role: payload.role || 'student',
    grantedScope: tokens.scope || '',
  };
}

export async function endSessionUrl(env) {
  try {
    const d = await discovery(env);
    if (!d.end_session_endpoint) return null;
    const u = new URL(d.end_session_endpoint);
    u.searchParams.set('post_logout_redirect_uri', env.PUBLIC_URL);
    u.searchParams.set('client_id', env.OIDC_CLIENT_ID);
    return u.href;
  } catch {
    return null;
  }
}
