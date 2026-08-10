// Telemetry dashboard styles.
//
// The tokens are main-site's (lmhstech.com) red/black language, copied
// verbatim from its css/site.css so this reads as part of the same estate —
// same red, same Bebas/Rajdhani/Space Mono stack, same easing. fleet's
// dashboard already extends the same set; the component styles below follow
// its naming so the two dashboards stay recognisably siblings.
//
// Note the *other* design language in this org — auth and velri use navy and
// amber with DM Sans. That is the sign-in surface. Anything that hangs off
// main-site, as this does, uses these tokens.

export const STYLES = `
:root {
  --primary: #E60000; --primary-rgb: 230,0,0;
  --bg: #050505; --surface: #111111; --surface-2: #1A1A1A; --surface-3: #232323;
  --text: #FFFFFF; --text-dim: #A0A0A0;
  --border: rgba(255,255,255,0.08); --border-hi: rgba(255,255,255,0.16);
  --accent: #FF3333;

  /* Priority ramp. Deliberately not four shades of red: P1 has to win at a
     glance across a room, and a colour-blind reader needs the label to carry
     the meaning too, which is why every badge prints its own name. */
  --p1: #E60000; --p1-rgb: 230,0,0;
  --p2: #FF8A00; --p2-rgb: 255,138,0;
  --p3: #FFB400; --p3-rgb: 255,180,0;
  --p4: #6B7280; --p4-rgb: 107,114,128;
  --ok: #22C55E;

  --font-display: 'Bebas Neue', 'Arial Narrow', sans-serif;
  --font-body: 'Rajdhani', 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'Space Mono', ui-monospace, Menlo, monospace;
  --nav-h: 64px; --ease: cubic-bezier(0.2,0.8,0.2,1); --fast: 0.2s var(--ease);
}
*, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
html { color-scheme: dark; }
body {
  background: var(--bg); color: var(--text); font-family: var(--font-body);
  font-size: 17px; line-height: 1.5; -webkit-font-smoothing: antialiased; min-height: 100vh;
}
a { color: inherit; text-decoration: none; }
button, input, select { font-family: inherit; font-size: inherit; }
:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; border-radius: 3px; }
::selection { background: rgba(var(--primary-rgb),0.85); color: #fff; }

/* ── Nav ── */
.nav {
  position: sticky; top: 0; z-index: 50; height: var(--nav-h);
  background: rgba(5,5,5,0.85); backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; padding: 0 20px; gap: 20px;
}
.nav-brand { display: flex; align-items: center; gap: 12px; }
.nav-brand .mark {
  width: 34px; height: 34px; border-radius: 8px; background: var(--primary);
  display: grid; place-items: center; font-family: var(--font-display);
  font-size: 1.2rem; color: #fff;
}
.nav-title { display: flex; flex-direction: column; line-height: 1; }
.nav-title small { font-size: 0.6rem; letter-spacing: 0.22em; color: var(--primary); font-weight: 700; }
.nav-title span { font-family: var(--font-display); font-size: 1.3rem; letter-spacing: 0.02em; }
.nav-spacer { flex: 1; }
.nav-links { display: flex; gap: 16px; font-size: 0.85rem; color: var(--text-dim); }
.nav-links a:hover { color: var(--text); }
.nav-links a.on { color: var(--primary); }
.nav-user { display: flex; align-items: center; gap: 10px; font-size: 0.85rem; color: var(--text-dim); }
.nav-user .who { font-family: var(--font-mono); font-size: 0.8rem; color: var(--text); }
.nav-user .role {
  font-family: var(--font-mono); font-size: 0.62rem; text-transform: uppercase;
  letter-spacing: 0.1em; padding: 3px 8px; border-radius: 5px;
  border: 1px solid var(--border-hi);
}
.nav-user .role.admin { color: var(--primary); border-color: rgba(var(--primary-rgb),0.4); }

/* ── Layout ── */
.wrap { max-width: 1240px; margin: 0 auto; padding: 28px 20px 80px; }
.page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 22px; flex-wrap: wrap; }
.page-head h1 { font-family: var(--font-display); font-size: 2.6rem; letter-spacing: 0.02em; line-height: 1; }
.page-head p { color: var(--text-dim); font-size: 0.9rem; margin-top: 4px; }

/* ── Stat tiles ── */
.stats { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
.stat {
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
  padding: 12px 18px; min-width: 108px; transition: border-color var(--fast);
}
.stat:hover { border-color: var(--border-hi); }
.stat .n { font-family: var(--font-display); font-size: 2rem; line-height: 1; }
.stat .l { font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-dim); margin-top: 4px; }
.stat.p1 .n { color: var(--p1); } .stat.p2 .n { color: var(--p2); }
.stat.p3 .n { color: var(--p3); } .stat.p4 .n { color: var(--p4); }

/* ── Filters ── */
.filters { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 18px; align-items: center; }
.filters input, .filters select {
  background: var(--surface); color: var(--text); border: 1px solid var(--border);
  border-radius: 8px; padding: 8px 12px; transition: border-color var(--fast);
}
.filters input:focus, .filters select:focus { border-color: rgba(var(--primary-rgb),0.5); outline: none; }
.filters input { min-width: 220px; }

/* ── Issue list ── */
.issues { display: flex; flex-direction: column; gap: 10px; }
.issue {
  background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--p4);
  border-radius: 12px; padding: 14px 18px; cursor: pointer;
  transition: border-color var(--fast), transform var(--fast), background var(--fast);
}
.issue:hover { background: var(--surface-2); border-color: var(--border-hi); transform: translateX(2px); }
.issue.P1 { border-left-color: var(--p1); }
.issue.P2 { border-left-color: var(--p2); }
.issue.P3 { border-left-color: var(--p3); }
.issue.P4 { border-left-color: var(--p4); opacity: 0.78; }
.issue.resolved { opacity: 0.5; }

.issue-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.issue-title { font-weight: 600; font-size: 1.02rem; flex: 1; min-width: 240px; word-break: break-word; }
.issue-meta { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 7px; font-size: 0.78rem; color: var(--text-dim); font-family: var(--font-mono); }
.issue-meta .culprit { color: var(--text); }

.badge {
  font-family: var(--font-mono); font-size: 0.64rem; font-weight: 700; letter-spacing: 0.08em;
  padding: 3px 8px; border-radius: 5px; border: 1px solid; text-transform: uppercase; white-space: nowrap;
}
.badge.P1 { color: var(--p1); border-color: rgba(var(--p1-rgb),0.45); background: rgba(var(--p1-rgb),0.1); }
.badge.P2 { color: var(--p2); border-color: rgba(var(--p2-rgb),0.45); background: rgba(var(--p2-rgb),0.1); }
.badge.P3 { color: var(--p3); border-color: rgba(var(--p3-rgb),0.45); background: rgba(var(--p3-rgb),0.1); }
.badge.P4 { color: var(--p4); border-color: rgba(var(--p4-rgb),0.45); background: rgba(var(--p4-rgb),0.1); }
.badge.app { color: var(--text-dim); border-color: var(--border-hi); }
.badge.status { color: var(--ok); border-color: rgba(34,197,94,0.4); }

/* The model's reasoning is shown, always, next to its verdict. A priority
   nobody can interrogate is a priority nobody should trust. */
.ai-note {
  margin-top: 9px; padding: 8px 11px; background: var(--surface-2);
  border: 1px solid var(--border); border-radius: 8px;
  font-size: 0.82rem; color: var(--text-dim); display: flex; gap: 9px; align-items: flex-start;
}
.ai-note .tag {
  font-family: var(--font-mono); font-size: 0.6rem; letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--primary); border: 1px solid rgba(var(--primary-rgb),0.35); border-radius: 4px;
  padding: 2px 6px; flex-shrink: 0; margin-top: 1px;
}
.ai-note.manual .tag { color: var(--text); border-color: var(--border-hi); }

/* ── Buttons ── */
.btn {
  background: var(--surface-2); color: var(--text); border: 1px solid var(--border-hi);
  border-radius: 8px; padding: 8px 14px; cursor: pointer; font-weight: 600; font-size: 0.85rem;
  transition: background var(--fast), border-color var(--fast);
}
.btn:hover { background: var(--surface-3); border-color: rgba(var(--primary-rgb),0.4); }
.btn.primary { background: var(--primary); border-color: var(--primary); }
.btn.primary:hover { background: var(--accent); }
.btn.sm { padding: 5px 10px; font-size: 0.76rem; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── Modal ── */
.modal-bg {
  position: fixed; inset: 0; background: rgba(0,0,0,0.75); backdrop-filter: blur(4px);
  z-index: 100; display: none; align-items: flex-start; justify-content: center; padding: 40px 20px; overflow-y: auto;
}
.modal-bg.on { display: flex; }
.modal {
  background: var(--surface); border: 1px solid var(--border-hi); border-radius: 16px;
  max-width: 860px; width: 100%; padding: 24px;
}
.modal h2 { font-family: var(--font-display); font-size: 1.8rem; margin-bottom: 4px; }
.modal pre {
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  padding: 12px; overflow-x: auto; font-family: var(--font-mono);
  font-size: 0.76rem; line-height: 1.55; color: var(--text-dim); white-space: pre-wrap; word-break: break-word;
}
.modal .row { display: flex; gap: 10px; flex-wrap: wrap; margin: 14px 0; align-items: center; }
.modal-close { float: right; cursor: pointer; color: var(--text-dim); font-size: 1.5rem; line-height: 1; }
.modal-close:hover { color: var(--text); }

/* ── Tables (admin) ── */
table { width: 100%; border-collapse: collapse; margin-top: 10px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 0.87rem; }
th { font-size: 0.66rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-dim); font-weight: 700; }
td.mono, .mono { font-family: var(--font-mono); font-size: 0.8rem; }

.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 20px; }
.card h2 { font-family: var(--font-display); font-size: 1.6rem; letter-spacing: 0.02em; margin-bottom: 2px; }
.card .hint { color: var(--text-dim); font-size: 0.84rem; margin-bottom: 14px; }

.empty { text-align: center; padding: 60px 20px; color: var(--text-dim); }
.empty .big { font-family: var(--font-display); font-size: 2rem; color: var(--text); margin-bottom: 6px; }

.keybox {
  background: var(--bg); border: 1px solid rgba(var(--primary-rgb),0.4); border-radius: 8px;
  padding: 12px; font-family: var(--font-mono); font-size: 0.82rem; word-break: break-all; margin: 10px 0;
}
.warn { color: var(--p2); font-size: 0.82rem; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
@media (max-width: 640px) {
  .wrap { padding: 20px 14px 60px; }
  .page-head h1 { font-size: 2rem; }
  .nav-links { display: none; }
  .filters input { min-width: 0; flex: 1; }
}
`;

/**
 * Wallboard styles, layered on top of STYLES.
 *
 * Different constraints from every other page here: it is read from across a
 * classroom rather than from a desk, it never scrolls because nobody is going
 * to touch it, and it is on for the whole school day. So sizes are in `vh` and
 * scale with the screen, the layout is a fixed grid that fills the viewport
 * exactly once, and the list pages itself instead of overflowing.
 */
export const TV_STYLES = `
body { overflow: hidden; }

.tv {
  height: 100vh; display: grid; gap: 1.1vh;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  padding: 1.4vh 1.4vw;
  /* Pixel-shift against burn-in. This screen shows the same layout for eight
     hours a day on a panel nobody is going to replace. */
  animation: tv-shift 1800s steps(6, end) infinite alternate;
}
@keyframes tv-shift { from { transform: translate(-5px, -4px); } to { transform: translate(5px, 4px); } }

/* ── Header ── */
.tv-head { display: flex; align-items: center; gap: 1.4vw; }
.tv-head .mark {
  width: 4.4vh; height: 4.4vh; border-radius: 0.9vh; background: var(--primary);
  display: grid; place-items: center; font-family: var(--font-display); font-size: 2.2vh; flex-shrink: 0;
}
.tv-head .who { display: flex; flex-direction: column; line-height: 1.05; }
.tv-head .who small { font-size: 1.15vh; letter-spacing: 0.24em; color: var(--primary); font-weight: 700; }
.tv-head .who span { font-family: var(--font-display); font-size: 2.6vh; letter-spacing: 0.02em; }
.tv-head .spacer { flex: 1; }
.tv-clock { font-family: var(--font-display); font-size: 4vh; line-height: 1; font-variant-numeric: tabular-nums; }
.tv-live {
  display: flex; align-items: center; gap: 0.7vw; font-family: var(--font-mono);
  font-size: 1.35vh; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-dim);
}
.tv-live .dot {
  width: 1.1vh; height: 1.1vh; border-radius: 50%; background: var(--ok);
  animation: tv-pulse 2s var(--ease) infinite;
}
@keyframes tv-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
/* Silence is the dangerous failure on a wallboard: a frozen page and a healthy
   one look identical. When the feed stops, the header says so in red. */
.tv.stale .tv-live { color: var(--p1); }
.tv.stale .tv-live .dot { background: var(--p1); animation: none; }

/* ── Status banner ── */
.tv-status {
  border-radius: 1.4vh; padding: 1.8vh 2vw; display: flex; align-items: center; gap: 1.6vw;
  border: 1px solid; background: var(--surface);
}
.tv-status .big { font-family: var(--font-display); font-size: 6.2vh; line-height: 1; letter-spacing: 0.02em; }
.tv-status .sub { font-size: 2vh; color: var(--text-dim); }
.tv-status.ok       { border-color: rgba(34,197,94,0.45);        background: linear-gradient(100deg, rgba(34,197,94,0.12), transparent 60%), var(--surface); }
.tv-status.ok .big  { color: var(--ok); }
.tv-status.watch      { border-color: rgba(var(--p3-rgb),0.5);   background: linear-gradient(100deg, rgba(var(--p3-rgb),0.12), transparent 60%), var(--surface); }
.tv-status.watch .big { color: var(--p3); }
.tv-status.degraded      { border-color: rgba(var(--p2-rgb),0.5); background: linear-gradient(100deg, rgba(var(--p2-rgb),0.14), transparent 60%), var(--surface); }
.tv-status.degraded .big { color: var(--p2); }
.tv-status.critical      { border-color: rgba(var(--p1-rgb),0.65); background: linear-gradient(100deg, rgba(var(--p1-rgb),0.18), transparent 60%), var(--surface); }
.tv-status.critical .big { color: var(--p1); }
/* P1 is the one state worth stealing attention from the far side of the room. */
.tv-status.critical { animation: tv-alarm 2.4s var(--ease) infinite; }
@keyframes tv-alarm {
  0%, 100% { box-shadow: 0 0 0 0 rgba(var(--p1-rgb), 0); }
  50%      { box-shadow: 0 0 4vh 0 rgba(var(--p1-rgb), 0.30); }
}

/* ── Tiles ── */
.tv-tiles { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 0.9vw; }
.tv-tile {
  background: var(--surface); border: 1px solid var(--border); border-radius: 1.1vh;
  padding: 1.1vh 1.2vw; display: flex; flex-direction: column; justify-content: center;
}
.tv-tile .n { font-family: var(--font-display); font-size: 4.4vh; line-height: 1; font-variant-numeric: tabular-nums; }
.tv-tile .l { font-size: 1.25vh; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-dim); margin-top: 0.4vh; }
.tv-tile.p1 .n { color: var(--p1); } .tv-tile.p2 .n { color: var(--p2); }
.tv-tile.p3 .n { color: var(--p3); } .tv-tile.p4 .n { color: var(--p4); }
.tv-tile.zero .n { color: var(--text-dim); }

/* ── Board ── */
.tv-board { display: grid; grid-template-columns: minmax(0,1fr) 25vw; gap: 0.9vw; min-height: 0; }
.tv-panel {
  background: var(--surface); border: 1px solid var(--border); border-radius: 1.2vh;
  padding: 1.2vh 1vw; display: grid; grid-template-rows: auto minmax(0,1fr); min-height: 0;
}
.tv-panel-head {
  display: flex; align-items: baseline; gap: 0.8vw; margin-bottom: 0.9vh;
  font-family: var(--font-mono); font-size: 1.3vh; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-dim);
}
.tv-panel-head .count { color: var(--text); }
.tv-panel-head .pager { margin-left: auto; }

.tv-list { display: flex; flex-direction: column; gap: 0.7vh; min-height: 0; overflow: hidden; }
.tv-row {
  display: flex; align-items: center; gap: 1vw; height: 6.6vh; flex-shrink: 0;
  background: var(--surface-2); border-left: 0.45vh solid var(--p4); border-radius: 0.9vh;
  padding: 0 1.1vw;
}
.tv-row.P1 { border-left-color: var(--p1); background: rgba(var(--p1-rgb),0.10); }
.tv-row.P2 { border-left-color: var(--p2); background: rgba(var(--p2-rgb),0.08); }
.tv-row.P3 { border-left-color: var(--p3); }
.tv-row.P4 { border-left-color: var(--p4); opacity: 0.72; }
.tv-row .pri {
  font-family: var(--font-mono); font-weight: 700; font-size: 1.7vh; width: 3.4vw; flex-shrink: 0;
}
.tv-row.P1 .pri { color: var(--p1); } .tv-row.P2 .pri { color: var(--p2); }
.tv-row.P3 .pri { color: var(--p3); } .tv-row.P4 .pri { color: var(--p4); }
.tv-row .body { flex: 1; min-width: 0; }
.tv-row .title {
  font-size: 2.1vh; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tv-row .meta {
  font-family: var(--font-mono); font-size: 1.3vh; color: var(--text-dim);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 0.2vh;
}
.tv-row .when {
  font-family: var(--font-mono); font-size: 1.6vh; color: var(--text-dim);
  text-align: right; flex-shrink: 0; min-width: 6vw;
}
.tv-row .when b { display: block; color: var(--text); font-size: 2vh; font-weight: 700; }

/* ── Apps ── */
.tv-apps { display: flex; flex-direction: column; gap: 0.6vh; overflow: hidden; }
.tv-app { display: flex; align-items: center; gap: 0.8vw; height: 4.6vh; flex-shrink: 0; }
.tv-app .dot { width: 1.3vh; height: 1.3vh; border-radius: 50%; background: var(--ok); flex-shrink: 0; }
.tv-app.P1 .dot { background: var(--p1); } .tv-app.P2 .dot { background: var(--p2); }
.tv-app.P3 .dot { background: var(--p3); } .tv-app.P4 .dot { background: var(--p4); }
.tv-app .name { flex: 1; min-width: 0; font-size: 1.9vh; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tv-app .n { font-family: var(--font-mono); font-size: 1.5vh; color: var(--text-dim); flex-shrink: 0; }
.tv-app.quiet .name { color: var(--text-dim); }

.tv-empty {
  display: grid; place-content: center; text-align: center; gap: 1vh; height: 100%; color: var(--text-dim);
}
.tv-empty .big { font-family: var(--font-display); font-size: 5vh; color: var(--ok); }
.tv-empty .small { font-size: 1.9vh; }

/* ── Signed-out curtain ── */
.tv-gone {
  position: fixed; inset: 0; z-index: 300; display: none;
  place-content: center; text-align: center; gap: 1.4vh;
  background: rgba(5,5,5,0.96); padding: 4vh;
}
.tv-gone.on { display: grid; }
.tv-gone h1 { font-family: var(--font-display); font-size: 6vh; color: var(--p1); }
.tv-gone p { color: var(--text-dim); font-size: 2.2vh; max-width: 60ch; margin: 0 auto; }

@media (prefers-reduced-motion: reduce) {
  .tv { animation: none; }
  .tv-status.critical { animation: none; }
  .tv-live .dot { animation: none; }
}
`;

/** Shared <head> content. Fonts match main-site's link exactly. */
export const HEAD = `
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
`;
