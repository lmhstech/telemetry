// Small HTTP + cookie helpers. Deliberately the same shape as fleet's
// src/lib/http.js so the two Workers read alike.

export const now = () => Math.floor(Date.now() / 1000);

// Security headers applied to every response. main-site sets the equivalent
// with <meta http-equiv>; a Worker can send the real headers, so it does.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
      ...(init.headers || {}),
    },
  });
}

export function html(body, init = {}) {
  return new Response(body, {
    ...init,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
      // Fonts come from Google like the rest of the estate's pages; nothing
      // else may be loaded, and no page here may be framed or post a form off
      // -site.
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        'font-src https://fonts.gstatic.com',
        "img-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "form-action 'none'",
        "base-uri 'none'",
      ].join('; '),
      ...(init.headers || {}),
    },
  });
}

export function redirect(location, init = {}) {
  return new Response(null, { status: 302, ...init, headers: { Location: location, ...(init.headers || {}) } });
}

export const badRequest = (message) => json({ error: message }, { status: 400 });
export const unauthorized = (message = 'Unauthorized') => json({ error: message }, { status: 401 });
export const forbidden = (message = 'Forbidden') => json({ error: message }, { status: 403 });
export const notFound = (message = 'Not found') => json({ error: message }, { status: 404 });
export const tooMany = (message = 'Rate limited') => json({ error: message }, { status: 429 });

// ── Cookies ────────────────────────────────────────────────────────────────
export function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function cookie(name, value, { maxAge, httpOnly = true, sameSite = 'Lax', path = '/' } = {}) {
  let str = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}; Secure`;
  if (httpOnly) str += '; HttpOnly';
  if (typeof maxAge === 'number') str += `; Max-Age=${maxAge}`;
  return str;
}

export function clearCookie(name, path = '/') {
  return `${name}=; Path=${path}; SameSite=Lax; Secure; HttpOnly; Max-Age=0`;
}

// ── Primitives ─────────────────────────────────────────────────────────────
export function randomId(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

export function base64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256b64url(input) {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

export async function sha256hex(input) {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time string compare, for anything that gates access.
 * Length is not secret here (ingest keys are a fixed length), the content is.
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// HTML escaping. Everything interpolated into a page goes through this —
// crash reports are attacker-influenced text by definition.
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
