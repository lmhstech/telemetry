// PAUSED. The real application lives in ../paused-backup/src and is not wired
// up. See RESTORE.md in this repo to bring it back.
//
// The estate has been paused by the school pending official approval. This
// stands in for every route the app used to serve.
//
// Style is the main-site design language the app already used — same tokens,
// same fonts, same red — so the pause reads as the same product resting rather
// than as a stranger's error page.

const APP_NAME = 'telemetry.lmhstech.com';

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Paused — ${APP_NAME}</title>
<meta name="robots" content="noindex, nofollow" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@400;600&display=swap" rel="stylesheet" />
<style>
  :root {
    --primary:   #E60000;
    --bg:        #050505;
    --surface:   #111111;
    --text:      #FFFFFF;
    --text-dim:  #A0A0A0;
    --border:    rgba(255, 255, 255, 0.08);
    --font-display: 'Bebas Neue', Impact, sans-serif;
    --font-body:    'Rajdhani', 'Segoe UI', system-ui, sans-serif;
  }

  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  :root { color-scheme: dark; }

  body {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-body);
    line-height: 1.6;
    text-align: center;
  }

  main {
    max-width: 34rem;
    width: 100%;
    padding: 56px 32px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  /* The one piece of colour on the page. A paused product should still look
     like itself, and the red is the strongest thing that says so. */
  .bar {
    width: 56px;
    height: 4px;
    margin: 0 auto 28px;
    background: var(--primary);
    border-radius: 2px;
  }

  h1 {
    font-family: var(--font-display);
    font-size: clamp(2.5rem, 8vw, 4rem);
    letter-spacing: 0.02em;
    line-height: 1.05;
    margin-bottom: 16px;
  }

  p {
    color: var(--text-dim);
    font-size: 1.05rem;
    max-width: 26rem;
    margin: 0 auto;
  }

  .app {
    margin-top: 32px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    font-size: 0.8rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
</style>
</head>
<body>
  <main>
    <div class="bar" aria-hidden="true"></div>
    <h1>We are paused at this time</h1>
    <p>This service is temporarily unavailable. It will return once it is cleared to resume.</p>
    <div class="app">${APP_NAME}</div>
  </main>
</body>
</html>`;

export default {
  async fetch() {
    // 503 rather than 200: this is a real service that is temporarily down, and
    // saying so keeps the paused page out of search results and stops clients
    // from caching it as the app's actual content.
    return new Response(PAGE, {
      status: 503,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': '86400',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
      },
    });
  },
};
