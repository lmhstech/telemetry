// The issue board and the admin page.
//
// Both are server-rendered shells that fetch their data from /api/*. Nothing
// interpolates a crash report into HTML on the server; the client builds nodes
// with textContent so a stack trace containing markup is text, not markup.

import { esc } from '../lib/http.js';
import { STYLES, HEAD } from './styles.js';

function nav(session, current) {
  const admin = session.role === 'admin';
  const link = (href, label) =>
    `<a href="${href}"${current === href ? ' class="on"' : ''}>${label}</a>`;

  return `<nav class="nav">
    <a class="nav-brand" href="/">
      <div class="mark">LM</div>
      <div class="nav-title"><small>ROOM 1-240</small><span>TELEMETRY</span></div>
    </a>
    <div class="nav-spacer"></div>
    <div class="nav-links">
      ${link('/', 'Issues')}
      ${admin ? link('/admin', 'Admin') : ''}
      <!-- New tab: /tv is a full-screen board with no nav of its own, so
           opening it in place would strand whoever clicked it. -->
      <a href="/tv" target="_blank" rel="noopener">TV ↗</a>
    </div>
    <div class="nav-user">
      <span class="who">${esc(session.username || '')}</span>
      <span class="role ${esc(session.role)}">${esc(session.role)}</span>
      <a class="btn sm" href="/auth/logout">Sign out</a>
    </div>
  </nav>`;
}

function page(title, session, current, body, script) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
${HEAD}
<title>${esc(title)}</title>
<style>${STYLES}</style>
</head>
<body>
${nav(session, current)}
<div class="wrap">${body}</div>
<script>${script}</script>
</body>
</html>`;
}

// ── Shared client helpers, inlined into both pages ─────────────────────────
const CLIENT_HELPERS = `
const $ = (s, r) => (r || document).querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
};
async function api(path, opts) {
  const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Request failed: ' + res.status));
  return data;
}
function ago(ts) {
  if (!ts) return 'never';
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
function toast(msg, bad) {
  const t = el('div', null, msg);
  t.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:200;'
    + 'background:' + (bad ? 'var(--primary)' : 'var(--surface-3)') + ';color:#fff;padding:11px 20px;'
    + 'border-radius:9px;border:1px solid var(--border-hi);font-weight:600;font-size:0.86rem;';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
`;

// ── Issue board ────────────────────────────────────────────────────────────

export function dashboardPage(env, session) {
  const staff = session.role === 'admin' || session.role === 'teacher';

  const body = `
    <div class="page-head">
      <div>
        <h1>ISSUES</h1>
        <p>Sorted by priority, then by how recently it last happened. Priorities are set by Workers AI and can be overridden.</p>
      </div>
      <button class="btn" id="refresh">Refresh</button>
    </div>

    <div class="stats" id="stats"></div>

    <div class="filters">
      <input type="search" id="q" placeholder="Search title or file…" />
      <select id="status">
        <option value="active">Open &amp; resolved</option>
        <option value="open" selected>Open only</option>
        <option value="resolved">Resolved</option>
        <option value="ignored">Ignored</option>
      </select>
      <select id="priority">
        <option value="">Any priority</option>
        <option value="P1">P1 — blocking</option>
        <option value="P2">P2 — major</option>
        <option value="P3">P3 — normal</option>
        <option value="P4">P4 — noise</option>
      </select>
      <select id="app"><option value="">All apps</option></select>
    </div>

    <div class="issues" id="list"></div>

    <div class="modal-bg" id="modal"><div class="modal" id="modal-body"></div></div>
  `;

  const script = `${CLIENT_HELPERS}
const STAFF = ${staff ? 'true' : 'false'};
let ISSUES = [];

function statTile(n, label, cls) {
  const d = el('div', 'stat' + (cls ? ' ' + cls : ''));
  d.appendChild(el('div', 'n', n));
  d.appendChild(el('div', 'l', label));
  return d;
}

async function loadStats() {
  const s = await api('/api/stats');
  const box = $('#stats');
  box.textContent = '';
  box.appendChild(statTile(s.open_issues || 0, 'Open'));
  box.appendChild(statTile(s.p1 || 0, 'P1 blocking', 'p1'));
  box.appendChild(statTile(s.p2 || 0, 'P2 major', 'p2'));
  box.appendChild(statTile(s.p3 || 0, 'P3 normal', 'p3'));
  box.appendChild(statTile(s.p4 || 0, 'P4 noise', 'p4'));
  box.appendChild(statTile(s.events_24h || 0, 'Events 24h'));
  if (s.untriaged) box.appendChild(statTile(s.untriaged, 'Awaiting triage'));

  const sel = $('#app');
  if (sel.options.length <= 1) {
    (s.apps || []).forEach(a => {
      const o = document.createElement('option');
      o.value = a.slug;
      o.textContent = a.name + (a.open_issues ? ' (' + a.open_issues + ')' : '');
      sel.appendChild(o);
    });
  }
}

function issueCard(i) {
  const card = el('div', 'issue ' + (i.priority || 'P4') + (i.status === 'resolved' ? ' resolved' : ''));
  card.tabIndex = 0;

  const top = el('div', 'issue-top');
  top.appendChild(el('span', 'badge ' + (i.priority || 'P4'), i.priority || '—'));
  top.appendChild(el('span', 'issue-title', i.title));
  top.appendChild(el('span', 'badge app', i.app_name || i.app_slug));
  if (i.status !== 'open') top.appendChild(el('span', 'badge status', i.status));
  card.appendChild(top);

  const meta = el('div', 'issue-meta');
  if (i.culprit) meta.appendChild(el('span', 'culprit', i.culprit));
  meta.appendChild(el('span', null, i.events_count + (i.events_count === 1 ? ' event' : ' events')));
  meta.appendChild(el('span', null, 'last ' + ago(i.last_seen_at)));
  meta.appendChild(el('span', null, i.level));
  card.appendChild(meta);

  // Always show why this priority was chosen, and by whom.
  if (i.ai_rationale || i.priority_source === 'manual') {
    const manual = i.priority_source === 'manual';
    const note = el('div', 'ai-note' + (manual ? ' manual' : ''));
    note.appendChild(el('span', 'tag', manual ? 'set by hand' : 'ai triage'));
    const txt = manual
      ? 'Priority set manually' + (i.ai_priority ? ' (the model suggested ' + i.ai_priority + ')' : '') + '.'
      : i.ai_rationale + (i.ai_confidence != null ? '  · confidence ' + Math.round(i.ai_confidence * 100) + '%' : '');
    note.appendChild(el('span', null, txt));
    card.appendChild(note);
  }

  const open = () => showIssue(i.id);
  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return card;
}

async function load() {
  const params = new URLSearchParams();
  if ($('#q').value.trim()) params.set('q', $('#q').value.trim());
  if ($('#status').value) params.set('status', $('#status').value);
  if ($('#priority').value) params.set('priority', $('#priority').value);
  if ($('#app').value) params.set('app', $('#app').value);

  try {
    const [{ issues }] = await Promise.all([api('/api/issues?' + params), loadStats()]);
    ISSUES = issues;
    const list = $('#list');
    list.textContent = '';
    if (!issues.length) {
      const e = el('div', 'empty');
      e.appendChild(el('div', 'big', 'Nothing here'));
      e.appendChild(el('div', null, 'No issues match these filters. That is usually good news.'));
      list.appendChild(e);
      return;
    }
    issues.forEach(i => list.appendChild(issueCard(i)));
  } catch (err) {
    toast(err.message, true);
  }
}

async function showIssue(id) {
  const { issue, events } = await api('/api/issues/' + encodeURIComponent(id));
  const b = $('#modal-body');
  b.textContent = '';

  const close = el('div', 'modal-close', '×');
  close.addEventListener('click', hideModal);
  b.appendChild(close);

  b.appendChild(el('h2', null, issue.title));

  const sub = el('div', 'mono');
  sub.style.color = 'var(--text-dim)';
  sub.textContent = [issue.app_name, issue.culprit, issue.level,
    issue.events_count + ' events', 'first ' + ago(issue.first_seen_at)].filter(Boolean).join('  ·  ');
  b.appendChild(sub);

  if (issue.ai_rationale) {
    const note = el('div', 'ai-note');
    note.appendChild(el('span', 'tag', issue.ai_model ? 'ai triage' : 'rules'));
    note.appendChild(el('span', null, issue.ai_rationale
      + (issue.ai_model ? '  ·  ' + issue.ai_model : '')));
    b.appendChild(note);
  }

  if (STAFF) {
    const row = el('div', 'row');
    ['P1','P2','P3','P4'].forEach(p => {
      const btn = el('button', 'btn sm' + (issue.priority === p ? ' primary' : ''), p);
      btn.addEventListener('click', async () => {
        try {
          await api('/api/issues/' + issue.id + '/priority', { method: 'POST', body: JSON.stringify({ priority: p }) });
          toast('Priority set to ' + p);
          hideModal(); load();
        } catch (e) { toast(e.message, true); }
      });
      row.appendChild(btn);
    });

    const spacer = el('span'); spacer.style.flex = '1'; row.appendChild(spacer);

    [['resolved','Resolve'], ['ignored','Ignore'], ['open','Reopen']].forEach(([st, label]) => {
      if (issue.status === st) return;
      const btn = el('button', 'btn sm', label);
      btn.addEventListener('click', async () => {
        try {
          await api('/api/issues/' + issue.id + '/status', { method: 'POST', body: JSON.stringify({ status: st }) });
          toast('Marked ' + st);
          hideModal(); load();
        } catch (e) { toast(e.message, true); }
      });
      row.appendChild(btn);
    });
    b.appendChild(row);
  }

  events.forEach((ev, idx) => {
    const h = el('div', 'mono');
    h.style.cssText = 'color:var(--text-dim);margin:14px 0 6px';
    h.textContent = (idx === 0 ? 'Most recent — ' : '') + ago(ev.occurred_at)
      + (ev.environment ? '  ·  ' + ev.environment : '')
      + (ev.release ? '  ·  ' + ev.release : '');
    b.appendChild(h);

    const pre = el('pre', null, ev.stack || ev.message);
    b.appendChild(pre);

    if (ev.context) {
      const c = el('pre', null, ev.context);
      c.style.marginTop = '6px';
      b.appendChild(c);
    }
  });

  $('#modal').classList.add('on');
}

function hideModal() { $('#modal').classList.remove('on'); }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') hideModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideModal(); });

['#status','#priority','#app'].forEach(s => $(s).addEventListener('change', load));
let t; $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
$('#refresh').addEventListener('click', load);

load();
setInterval(load, 60000);
`;

  return page('Issues — LMHS Telemetry', session, '/', body, script);
}

// ── Admin ──────────────────────────────────────────────────────────────────

export function adminPage(env, session) {
  const body = `
    <div class="page-head">
      <div>
        <h1>ADMIN</h1>
        <p>Reporting apps, student access, and the record of who changed what.</p>
      </div>
    </div>

    <div class="card">
      <h2>STUDENT ACCESS</h2>
      <div class="hint">
        Teachers and admins can already see telemetry. Add a student by the username on their
        sign-in label — five characters, like <span class="mono">k7Rm4</span>. They do not need to have
        opened this app before. Removing access also signs them out immediately.
      </div>
      <div class="filters">
        <input id="v-user" placeholder="Username (e.g. k7Rm4)" maxlength="32" />
        <input id="v-note" placeholder="Note — e.g. 'period 3 helpdesk'. Not a name." maxlength="80" />
        <button class="btn primary" id="v-add">Grant access</button>
      </div>
      <div id="viewers"></div>
    </div>

    <div class="card">
      <h2>REPORTING APPS</h2>
      <div class="hint">
        Each app gets its own ingest key. The key is shown once, here, and stored only as a hash —
        if it is lost, rotate it. Rotating kills the old key immediately.
      </div>
      <div class="filters">
        <input id="a-slug" placeholder="slug (e.g. velri)" maxlength="39" />
        <input id="a-name" placeholder="Display name" maxlength="80" />
        <button class="btn primary" id="a-add">Register app</button>
      </div>
      <div id="apps"></div>
    </div>

    <div class="card">
      <h2>WALL DISPLAYS</h2>
      <div class="hint">
        A TV showing the board all day. Pairing gives you a one-time link to open on that screen —
        it signs the screen in for months, so nobody has to walk over and log it back in.
        A paired display can only ever read the summary board: no stack traces, no event bodies,
        no admin. Unpair to kill it, and it goes dark within twenty seconds.
      </div>
      <div class="filters">
        <input id="d-label" placeholder="Which screen? e.g. 'Room 1-240 wall'" maxlength="40" />
        <button class="btn primary" id="d-add">Pair a display</button>
        <a class="btn" href="/tv" target="_blank" rel="noopener">Open the board here</a>
      </div>
      <div id="displays"></div>
    </div>

    <div class="card">
      <h2>AUDIT</h2>
      <div class="hint">Access grants and priority overrides, most recent first.</div>
      <div id="audit"></div>
    </div>

    <div class="modal-bg" id="modal"><div class="modal" id="modal-body"></div></div>
  `;

  const script = `${CLIENT_HELPERS}

function table(cols, rows, render) {
  const t = el('table');
  const thead = el('thead'); const htr = el('tr');
  cols.forEach(c => htr.appendChild(el('th', null, c)));
  thead.appendChild(htr); t.appendChild(thead);
  const tb = el('tbody');
  rows.forEach(r => tb.appendChild(render(r)));
  t.appendChild(tb);
  return t;
}

function showKey(key, notice, title) {
  const b = $('#modal-body');
  b.textContent = '';
  const close = el('div', 'modal-close', '×');
  close.addEventListener('click', () => $('#modal').classList.remove('on'));
  b.appendChild(close);
  b.appendChild(el('h2', null, title || 'Ingest key'));
  b.appendChild(el('div', 'warn', notice));
  b.appendChild(el('div', 'keybox', key));
  const copy = el('button', 'btn primary', 'Copy to clipboard');
  copy.addEventListener('click', () => {
    navigator.clipboard.writeText(key).then(() => toast('Copied')).catch(() => toast('Copy failed', true));
  });
  b.appendChild(copy);
  $('#modal').classList.add('on');
}

/** ago() counts backwards; a pairing expires in the future. */
function until(ts) {
  const s = ts - Math.floor(Date.now() / 1000);
  if (s <= 0) return 'expired';
  if (s < 86400) return 'in ' + Math.max(1, Math.floor(s / 3600)) + 'h';
  return 'in ' + Math.floor(s / 86400) + 'd';
}

async function loadViewers() {
  const { viewers } = await api('/api/admin/viewers');
  const box = $('#viewers');
  box.textContent = '';
  if (!viewers.length) {
    box.appendChild(el('div', 'hint', 'No students have been granted access yet.'));
    return;
  }
  box.appendChild(table(['Username', 'Note', 'Granted by', 'When', 'Signed in', ''], viewers, v => {
    const tr = el('tr');
    tr.appendChild(el('td', 'mono', v.username));
    tr.appendChild(el('td', null, v.note || '—'));
    tr.appendChild(el('td', 'mono', v.granted_by));
    tr.appendChild(el('td', null, ago(v.granted_at)));
    tr.appendChild(el('td', null, v.has_signed_in ? ago(v.last_login_at) : 'not yet'));
    const td = el('td');
    const btn = el('button', 'btn sm', 'Remove');
    btn.addEventListener('click', async () => {
      if (!confirm('Remove telemetry access for ' + v.username + '? They will be signed out now.')) return;
      try { await api('/api/admin/viewers/' + v.id, { method: 'DELETE' }); toast('Access removed'); loadViewers(); }
      catch (e) { toast(e.message, true); }
    });
    td.appendChild(btn); tr.appendChild(td);
    return tr;
  }));
}

async function loadApps() {
  const { apps } = await api('/api/admin/apps');
  const box = $('#apps');
  box.textContent = '';
  if (!apps.length) {
    box.appendChild(el('div', 'hint', 'No apps registered yet. Register one to get an ingest key.'));
    return;
  }
  box.appendChild(table(['App', 'Slug', 'Key', 'Issues', 'Last report', 'Status', ''], apps, a => {
    const tr = el('tr');
    tr.appendChild(el('td', null, a.name));
    tr.appendChild(el('td', 'mono', a.slug));
    tr.appendChild(el('td', 'mono', '…' + (a.key_hint || '????')));
    tr.appendChild(el('td', null, a.issue_count));
    tr.appendChild(el('td', null, a.last_report_at ? ago(a.last_report_at) : 'never'));
    tr.appendChild(el('td', null, a.active ? 'active' : 'disabled'));

    const td = el('td');
    const rot = el('button', 'btn sm', 'Rotate key');
    rot.addEventListener('click', async () => {
      if (!confirm('Rotate the key for ' + a.name + '? Its current key stops working immediately.')) return;
      try {
        const r = await api('/api/admin/apps/' + a.id + '/rotate', { method: 'POST' });
        showKey(r.ingest_key, r.notice); loadApps();
      } catch (e) { toast(e.message, true); }
    });
    td.appendChild(rot);

    const tog = el('button', 'btn sm', a.active ? 'Disable' : 'Enable');
    tog.style.marginLeft = '6px';
    tog.addEventListener('click', async () => {
      try {
        await api('/api/admin/apps/' + a.id, { method: 'PATCH', body: JSON.stringify({ active: !a.active }) });
        loadApps();
      } catch (e) { toast(e.message, true); }
    });
    td.appendChild(tog);
    tr.appendChild(td);
    return tr;
  }));
}

async function loadDisplays() {
  const { displays } = await api('/api/admin/displays');
  const box = $('#displays');
  box.textContent = '';
  if (!displays.length) {
    box.appendChild(el('div', 'hint', 'No displays paired. The board still works signed in — this is only for a screen that stays on.'));
    return;
  }
  box.appendChild(table(['Display', 'Token', 'Paired', 'Expires', ''], displays, d => {
    const tr = el('tr');
    tr.appendChild(el('td', null, d.label));
    tr.appendChild(el('td', 'mono', '…' + d.hint));
    tr.appendChild(el('td', null, ago(d.created_at)));
    tr.appendChild(el('td', null, until(d.expires_at)));
    const td = el('td');
    const btn = el('button', 'btn sm', 'Unpair');
    btn.addEventListener('click', async () => {
      if (!confirm('Unpair "' + d.label + '"? That screen goes dark on its next refresh.')) return;
      try { await api('/api/admin/displays/' + d.id, { method: 'DELETE' }); toast('Display unpaired'); loadDisplays(); loadAudit(); }
      catch (e) { toast(e.message, true); }
    });
    td.appendChild(btn); tr.appendChild(td);
    return tr;
  }));
}

$('#d-add').addEventListener('click', async () => {
  const label = $('#d-label').value.trim();
  if (!label) return toast('Give the screen a label first', true);
  try {
    const r = await api('/api/admin/displays', { method: 'POST', body: JSON.stringify({ label }) });
    $('#d-label').value = '';
    showKey(r.pair_url, r.notice, 'Open this on the TV');
    loadDisplays(); loadAudit();
  } catch (e) { toast(e.message, true); }
});

async function loadAudit() {
  const { entries } = await api('/api/admin/audit?limit=50');
  const box = $('#audit');
  box.textContent = '';
  if (!entries.length) { box.appendChild(el('div', 'hint', 'Nothing yet.')); return; }
  box.appendChild(table(['When', 'Who', 'Action', 'Target', 'Detail'], entries, e => {
    const tr = el('tr');
    tr.appendChild(el('td', null, ago(e.created_at)));
    tr.appendChild(el('td', 'mono', e.actor));
    tr.appendChild(el('td', 'mono', e.action));
    tr.appendChild(el('td', 'mono', e.target || '—'));
    tr.appendChild(el('td', null, e.detail || '—'));
    return tr;
  }));
}

$('#v-add').addEventListener('click', async () => {
  const username = $('#v-user').value.trim();
  if (!username) return toast('Enter a username', true);
  try {
    await api('/api/admin/viewers', {
      method: 'POST',
      body: JSON.stringify({ username, note: $('#v-note').value.trim() }),
    });
    $('#v-user').value = ''; $('#v-note').value = '';
    toast('Access granted to ' + username);
    loadViewers(); loadAudit();
  } catch (e) { toast(e.message, true); }
});

$('#a-add').addEventListener('click', async () => {
  const slug = $('#a-slug').value.trim().toLowerCase();
  const name = $('#a-name').value.trim();
  if (!slug || !name) return toast('Slug and name are both required', true);
  try {
    const r = await api('/api/admin/apps', { method: 'POST', body: JSON.stringify({ slug, name }) });
    $('#a-slug').value = ''; $('#a-name').value = '';
    showKey(r.ingest_key, r.notice);
    loadApps(); loadAudit();
  } catch (e) { toast(e.message, true); }
});

$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').classList.remove('on'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modal').classList.remove('on'); });

loadViewers(); loadApps(); loadDisplays(); loadAudit();
`;

  return page('Admin — LMHS Telemetry', session, '/admin', body, script);
}
