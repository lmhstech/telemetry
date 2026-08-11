// Static pages: sign-in, access denied, and the "you are signed in but not on
// the list" page.

import { esc } from '../lib/http.js';
import { STYLES, HEAD } from './styles.js';

function shell(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
${HEAD}
<title>${esc(title)}</title>
<style>${STYLES}
.center { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.panel { max-width: 480px; width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 34px; text-align: center; }
.panel .mark { width: 54px; height: 54px; border-radius: 12px; background: var(--primary); display: grid; place-items: center; font-family: var(--font-display); font-size: 1.7rem; margin: 0 auto 18px; }
.panel h1 { font-family: var(--font-display); font-size: 2.2rem; letter-spacing: 0.02em; }
.panel .sub { font-size: 0.68rem; letter-spacing: 0.22em; text-transform: uppercase; color: var(--primary); font-weight: 700; margin-bottom: 4px; }
.panel p { color: var(--text-dim); margin: 12px 0 22px; font-size: 0.94rem; }
.panel .btn { display: inline-block; width: 100%; padding: 13px; }
.panel .foot { margin-top: 20px; font-size: 0.76rem; color: var(--text-dim); }
</style>
</head>
<body>
<div class="center"><div class="panel">${bodyHtml}</div></div>
</body>
</html>`;
}

export function loginPage(env) {
  return shell(
    'Sign in — LMHS Telemetry',
    `<div class="mark">LM</div>
     <div class="sub">Room 1-240</div>
     <h1>Telemetry</h1>
     <p>Error reporting and issue triage for the ${esc(env.SCHOOL_NAME || 'LMHS Tech')} estate.
        Sign in with your class account to continue.</p>
     <a class="btn primary" href="/auth/login">Sign in with LMHS Tech</a>
     <div class="foot">Teachers and admins have access by default.<br>Students need to be added by an admin.</div>`,
  );
}

export function deniedPage(env, message) {
  return shell(
    'Sign-in problem — LMHS Telemetry',
    `<div class="mark">LM</div>
     <div class="sub">Room 1-240</div>
     <h1>Hold on</h1>
     <p>${esc(message)}</p>
     <a class="btn primary" href="/auth/login">Try again</a>`,
  );
}

/**
 * Signed in, but not granted access.
 *
 * Deliberately tells the student exactly what to ask for and shows their own
 * username, because the admin adding them needs that string and reading it off
 * this page beats hunting for a printed label.
 */
export function noAccessPage(env, session) {
  return shell(
    'No access — LMHS Telemetry',
    `<div class="mark">LM</div>
     <div class="sub">Room 1-240</div>
     <h1>Not on the list</h1>
     <p>You are signed in as <span class="mono" style="color:var(--text)">${esc(session.username || 'unknown')}</span>,
        but telemetry access has not been granted to your account yet.</p>
     <p>Ask in Room 1-240 to be added — give them the username above.</p>
     <a class="btn" href="/auth/logout">Sign out</a>`,
  );
}
