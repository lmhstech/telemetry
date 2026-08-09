// Telemetry reporter for browser pages (main-site, finance-site, and the
// dashboards' client-side code).
//
// Two things are different in a browser and both matter:
//
//   1. The ingest key ships to the client and is therefore public. That is
//      accepted: the key authorises *writing a crash report*, nothing else,
//      and it is revoked by rotating it in the admin page. Never give a
//      browser the key of a server-side app.
//   2. The page is full of things a student typed. So this sends the error
//      and nothing else — no DOM, no form state, no localStorage.

(function () {
  'use strict';

  var cfg = window.LMHS_TELEMETRY || {};
  var KEY = cfg.key;
  var ENDPOINT = cfg.endpoint || 'https://telemetry.lmhstech.com/api/ingest';
  if (!KEY) return; // not configured on this page

  function scrub(text) {
    return String(text == null ? '' : text)
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
      .replace(/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, '[jwt]')
      .replace(/\b\d{6,}\b/g, '[number]');
  }

  // Errors on a page arrive in bursts — one broken script can fire the same
  // handler on every frame. Cap what any one page load will send.
  var sent = 0;
  var MAX_PER_PAGE = 5;
  var seen = {};

  function send(message, stack, extra) {
    if (sent >= MAX_PER_PAGE) return;

    // Collapse repeats within this page load before they leave the browser.
    var dedupe = message + '|' + (extra && extra.line);
    if (seen[dedupe]) return;
    seen[dedupe] = true;
    sent++;

    var body = JSON.stringify({
      message: scrub(message).slice(0, 1000),
      stack: scrub(stack).slice(0, 4000) || undefined,
      level: 'error',
      environment: cfg.environment || 'production',
      release: cfg.release,
      context: {
        // Path only. A query string can carry anything a student typed.
        path: location.pathname,
        line: extra && extra.line,
        col: extra && extra.col,
        // Coarse, non-identifying: enough to tell "only on the lab iPads".
        ua: navigator.userAgent.slice(0, 200)
      },
      occurred_at: Math.floor(Date.now() / 1000)
    });

    try {
      // keepalive lets the report survive the page being closed, which is
      // exactly when the interesting errors happen.
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
        body: body,
        keepalive: true,
        mode: 'cors'
      })['catch'](function () {});
    } catch (e) {
      // Nothing to do. A page must not break because it could not report.
    }
  }

  window.addEventListener('error', function (e) {
    // Resource load failures (img/script 404) surface here with no message and
    // are noise; the service would file them P4 anyway, so save the request.
    if (!e.message) return;
    send(e.message, e.error && e.error.stack, { line: e.lineno, col: e.colno });
  });

  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    send(
      (r && r.message) || String(r),
      r && r.stack,
      {}
    );
  });

  // Manual reporting, for a caught error worth knowing about:
  //   window.lmhsReport(err)
  window.lmhsReport = function (err, context) {
    send((err && err.message) || String(err), err && err.stack, context || {});
  };
})();
