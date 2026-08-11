// The wallboard — /tv.
//
// A screen on the wall of Room 1-240 showing every open issue and how the
// estate is doing, refreshing itself all day without anyone touching it.
//
// Three things drive the design:
//
//   * It is read from across a room, not from a desk. Everything is sized in
//     `vh` so it scales with whatever it is plugged into, and the single most
//     important fact — is anything on fire — is a banner, not a number.
//   * It must never scroll, because nobody is going to scroll it. The list
//     measures how many rows fit and pages through the rest on a timer.
//   * A frozen board and a healthy board look identical, which makes silence
//     the dangerous failure. The header carries a live indicator that goes red
//     and starts counting when the feed stops answering.
//
// Like the other pages here, nothing from the database is interpolated into
// HTML on the server — the client builds nodes and sets textContent, so an
// error title containing markup stays text.

import { esc } from '../lib/http.js';
import { STYLES, TV_STYLES, HEAD } from './styles.js';

const REFRESH_MS = 20000;   // how often to re-fetch
const PAGE_MS = 12000;      // how long each page of issues is held
const STALE_MS = 90000;     // no successful fetch for this long → say so

export function tvPage(env, session) {
  const body = `
  <div class="tv" id="tv">

    <div class="tv-head">
      <div class="mark">LM</div>
      <div class="who">
        <small>ROOM 1-240</small>
        <span>TELEMETRY</span>
      </div>
      <div class="spacer"></div>
      <div class="tv-live"><span class="dot"></span><span id="live">connecting…</span></div>
      <div class="tv-clock" id="clock">--:--</div>
    </div>

    <div class="tv-status ok" id="status">
      <div class="big" id="status-big">LOADING</div>
      <div class="sub" id="status-sub">Fetching the board…</div>
    </div>

    <div class="tv-tiles" id="tiles"></div>

    <div class="tv-board">
      <div class="tv-panel">
        <div class="tv-panel-head">
          <span>Open issues</span><span class="count" id="issue-count">—</span>
          <span class="pager" id="pager"></span>
        </div>
        <div class="tv-list" id="list"></div>
      </div>
      <div class="tv-panel">
        <div class="tv-panel-head"><span>Apps</span><span class="count" id="app-count">—</span></div>
        <div class="tv-apps" id="apps"></div>
      </div>
    </div>

  </div>

  <div class="tv-gone" id="gone">
    <h1>DISPLAY SIGNED OUT</h1>
    <p id="gone-why">This screen's access to telemetry has ended. An admin can pair it again from
       the Admin page — Wall displays — and open the link it gives you on this TV.</p>
    <p class="mono" style="font-size:1.6vh">${esc(env.PUBLIC_URL || '')}/admin</p>
  </div>`;

  const script = `
const REFRESH_MS = ${REFRESH_MS};
const PAGE_MS = ${PAGE_MS};
const STALE_MS = ${STALE_MS};

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
};

let DATA = null;
let page = 0;
let lastOk = 0;

function ago(ts) {
  if (!ts) return 'never';
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

// ── Status banner ─────────────────────────────────────────────────────────
// The one line somebody glancing up from a desk actually reads. P1 outranks
// everything; "quiet" and "all clear" are different facts and are worded as
// such, because a board that says ALL CLEAR while eleven P4s sit under it is
// a board people stop believing.
function renderStatus(d) {
  const box = $('#status');
  const p1 = d.p1 || 0, p2 = d.p2 || 0, p3 = d.p3 || 0, p4 = d.p4 || 0;
  let cls, big, sub;

  if (p1) {
    cls = 'critical';
    big = p1 === 1 ? '1 P1 INCIDENT' : p1 + ' P1 INCIDENTS';
    sub = 'Something is blocking people right now. Start here.';
  } else if (p2) {
    cls = 'degraded';
    big = 'DEGRADED';
    sub = p2 + (p2 === 1 ? ' major issue open' : ' major issues open') + ' — no P1s.';
  } else if (p3) {
    cls = 'watch';
    big = 'MINOR ISSUES';
    sub = p3 + (p3 === 1 ? ' normal-priority issue' : ' normal-priority issues') + ' open. Nothing blocking.';
  } else if (p4) {
    cls = 'ok';
    big = 'ALL CLEAR';
    sub = p4 + (p4 === 1 ? ' known-noise issue' : ' known-noise issues') + ' open, nothing that matters.';
  } else {
    cls = 'ok';
    big = 'ALL CLEAR';
    sub = 'No open issues anywhere in the estate.';
  }

  box.className = 'tv-status ' + cls;
  $('#status-big').textContent = big;
  $('#status-sub').textContent = sub;
}

function tile(n, label, cls) {
  const d = el('div', 'tv-tile ' + (cls || '') + (n ? '' : ' zero'));
  d.appendChild(el('div', 'n', n));
  d.appendChild(el('div', 'l', label));
  return d;
}

function renderTiles(d) {
  const box = $('#tiles');
  box.textContent = '';
  box.appendChild(tile(d.p1 || 0, 'P1 blocking', 'p1'));
  box.appendChild(tile(d.p2 || 0, 'P2 major', 'p2'));
  box.appendChild(tile(d.p3 || 0, 'P3 normal', 'p3'));
  box.appendChild(tile(d.p4 || 0, 'P4 noise', 'p4'));
  box.appendChild(tile(d.events_1h || 0, 'Events 1h'));
  box.appendChild(tile(d.events_24h || 0, 'Events 24h'));
  box.appendChild(tile(d.untriaged || 0, 'Awaiting triage'));
}

function renderApps(d) {
  const box = $('#apps');
  box.textContent = '';
  const apps = d.apps || [];
  $('#app-count').textContent = apps.length ? apps.length + ' reporting' : '—';

  const RANK = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };
  apps.forEach(a => {
    const worst = RANK[a.worst_rank] || '';
    const row = el('div', 'tv-app ' + (worst || 'quiet'));
    row.appendChild(el('span', 'dot'));
    row.appendChild(el('span', 'name', a.name || a.slug));
    row.appendChild(el('span', 'n', a.open_issues
      ? a.open_issues + ' open · ' + ago(a.last_seen_at)
      : 'ok · ' + ago(a.last_seen_at)));
    box.appendChild(row);
  });
}

// How many rows fit right now. Measured rather than assumed, because this page
// runs on whatever screen it is plugged into and a hardcoded count would
// either overflow a small one or waste half of a large one.
//
// ROW_H is remembered from the first real row that gets laid out; the vh
// figures below are only the estimate used before there is one to measure, and
// they must stay in step with .tv-row in styles.js.
let ROW_H = 0;
function rowsPerPage() {
  const list = $('#list');
  const gap = window.innerHeight * 0.007;
  const rowH = ROW_H || window.innerHeight * 0.066;
  return Math.max(1, Math.floor((list.clientHeight + gap) / (rowH + gap)));
}

function renderList() {
  const d = DATA;
  const list = $('#list');
  const issues = (d && d.issues) || [];
  $('#issue-count').textContent = issues.length ? String(issues.length) : '0';

  list.textContent = '';

  if (!issues.length) {
    const e = el('div', 'tv-empty');
    e.appendChild(el('div', 'big', 'Nothing open'));
    e.appendChild(el('div', 'small', 'Every reported issue has been resolved or ignored.'));
    list.appendChild(e);
    $('#pager').textContent = '';
    return;
  }

  const per = rowsPerPage();
  const pages = Math.max(1, Math.ceil(issues.length / per));
  if (page >= pages) page = 0;

  issues.slice(page * per, page * per + per).forEach(i => {
    const row = el('div', 'tv-row ' + (i.priority || 'P4'));
    row.appendChild(el('div', 'pri', i.priority || '—'));

    const body = el('div', 'body');
    body.appendChild(el('div', 'title', i.title));
    const meta = [i.app_name || i.app_slug, i.culprit, i.events_count +
      (i.events_count === 1 ? ' event' : ' events')].filter(Boolean).join('  ·  ');
    body.appendChild(el('div', 'meta', meta));
    row.appendChild(body);

    const when = el('div', 'when');
    when.appendChild(el('b', null, ago(i.last_seen_at)));
    when.appendChild(document.createTextNode('ago'));
    row.appendChild(when);

    list.appendChild(row);
  });

  $('#pager').textContent = pages > 1 ? 'page ' + (page + 1) + ' / ' + pages : '';

  // Now that a row exists, take its real height. If that changes the answer —
  // it usually does by one, since the estimate cannot know about borders and
  // rounding — lay the page out again with the true figure.
  const first = list.firstElementChild;
  if (first && first.offsetHeight && Math.abs(first.offsetHeight - ROW_H) > 0.5) {
    ROW_H = first.offsetHeight;
    if (rowsPerPage() !== per) renderList();
  }
}

function renderClock() {
  const d = new Date();
  $('#clock').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// The live indicator is the board's own health, separate from the estate's.
function renderLive() {
  const tv = $('#tv');
  if (!lastOk) return;
  const since = Date.now() - lastOk;
  if (since > STALE_MS) {
    tv.classList.add('stale');
    $('#live').textContent = 'stale · no update for ' + Math.floor(since / 60000) + 'm';
  } else {
    tv.classList.remove('stale');
    $('#live').textContent = 'live · updated ' + Math.floor(since / 1000) + 's ago';
  }
}

async function refresh() {
  try {
    const res = await fetch('/api/tv', { headers: { 'Accept': 'application/json' } });
    if (res.status === 401 || res.status === 403) {
      // The pairing was revoked or has expired. Say so on the screen instead of
      // leaving the last good board up forever, which would be a lie.
      $('#gone').classList.add('on');
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    DATA = await res.json();
    lastOk = Date.now();
    $('#gone').classList.remove('on');
    renderStatus(DATA);
    renderTiles(DATA);
    renderApps(DATA);
    renderList();
  } catch (e) {
    // Leave the last good board up and let the live indicator go stale — a
    // blank screen during a thirty-second network blip helps nobody.
  }
  renderLive();
}

// Re-measure on resize; the TV may be plugged into a different screen, and
// every size here is relative to the viewport.
window.addEventListener('resize', () => { ROW_H = 0; page = 0; renderList(); });

refresh();
setInterval(refresh, REFRESH_MS);
setInterval(() => { page += 1; renderList(); }, PAGE_MS);
setInterval(renderClock, 1000);
setInterval(renderLive, 1000);
renderClock();
`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
${HEAD}
<title>Wallboard — LMHS Telemetry</title>
<style>${STYLES}${TV_STYLES}</style>
</head>
<body>
${body}
<script>${script}</script>
</body>
</html>`;
}

/**
 * Shown when a screen reaches /tv with no session at all.
 *
 * Distinct from the sign-in page on purpose: whoever is standing in front of
 * this is looking at a TV, not their own laptop, and the useful instruction is
 * "an admin pairs this from the Admin page", not "sign in".
 */
export function tvPairPage(env) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
${HEAD}
<title>Pair this display — LMHS Telemetry</title>
<style>${STYLES}${TV_STYLES}</style>
</head>
<body>
<div class="tv-gone on">
  <h1 style="color:var(--text)">PAIR THIS DISPLAY</h1>
  <p>This screen is not signed in. An admin can pair it from the Admin page under
     <b>Wall displays</b> — that produces a one-time link to open on this TV, and it stays
     signed in from then on.</p>
  <p class="mono" style="font-size:1.8vh;color:var(--primary)">${esc(env.PUBLIC_URL || '')}/admin</p>
  <p style="font-size:1.7vh">Signed-in teachers and admins can just open
     <span class="mono">${esc(env.PUBLIC_URL || '')}/tv</span> directly.</p>
</div>
</body>
</html>`;
}
