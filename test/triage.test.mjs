// Triage tests.
//
// The model is stubbed. What is being tested is the part that must hold when
// the model is wrong, absent, or adversarial: the floor, the volume nudge, and
// the promise that a human's override survives.

import test from 'node:test';
import assert from 'node:assert/strict';

import { triageIssue, ruleFloor, volumeAdjust, deviceCeiling, atMost } from '../src/lib/triage.js';

const issue = (over = {}) => ({
  title: 'Cannot read properties of undefined (reading id)',
  culprit: 'routes/api.js:88',
  level: 'error',
  events_count: 1,
  app_slug: 'velri',
  sample_stack: null,
  ...over,
});

/** env with an AI binding that always answers with `priority`. */
const envSaying = (priority, extra = {}) => ({
  AI: { run: async () => ({ response: JSON.stringify({ priority, confidence: 0.9, rationale: 'stub', ...extra }) }) },
});

const envDown = { AI: { run: async () => { throw new Error('AI unavailable'); } } };

test('rules floor auth and database failures at P2', () => {
  assert.equal(ruleFloor(issue({ title: 'Token exchange failed: 502' })).priority, 'P2');
  assert.equal(ruleFloor(issue({ title: 'D1_ERROR: no such table: sessions' })).priority, 'P2');
  assert.equal(ruleFloor(issue({ title: 'Nonce mismatch' })).priority, 'P2');
});

// Regression: the first pattern used \bd1\b, which does not match "D1_ERROR"
// because underscore is a word character — so every real D1 failure, which is
// exactly how D1 labels them, slipped past the floor and was left to the model.
// Caught in production, not by the original tests.
test('every shape D1 actually reports a failure in floors at P2', () => {
  for (const title of [
    'D1_ERROR: no such column: laptop_name',
    'D1_ERROR: UNIQUE constraint failed: apps.slug',
    'Error: D1_ERROR: near "SELCT": syntax error',
    'no such column: fingerprint',
  ]) {
    assert.equal(ruleFloor(issue({ title })).priority, 'P2', title);
  }
});

test('anything touching personal data floors at P1', () => {
  assert.equal(ruleFloor(issue({ title: 'PII detected in payload' })).priority, 'P1');
  // The scrubber having fired means something reached the reporter that should
  // not have been in scope at all — that is a bug worth waking up for.
  assert.equal(ruleFloor(issue({ sample_stack: 'at render(user=[email])' })).priority, 'P1');
});

test('an ordinary error has no floor, so the model decides', () => {
  assert.equal(ruleFloor(issue()).priority, null);
});

test('the model may raise priority above the floor but never below it', async () => {
  const authIssue = issue({ title: 'Token exchange failed' });

  // Model says P4; floor says P2. P2 wins.
  const relaxed = await triageIssue(envSaying('P4'), authIssue);
  assert.equal(relaxed.priority, 'P2');
  assert.equal(relaxed.aiPriority, 'P4');
  assert.match(relaxed.rationale, /Raised to P2/);

  // Model says P1; floor says P2. P1 wins — raising is allowed.
  const raised = await triageIssue(envSaying('P1'), authIssue);
  assert.equal(raised.priority, 'P1');
});

test('a garbage model response falls through to the rule floor', async () => {
  const env = { AI: { run: async () => ({ response: 'I think this one is quite bad, honestly.' }) } };
  const out = await triageIssue(env, issue({ title: 'Token exchange failed' }));
  assert.equal(out.priority, 'P2');
  assert.equal(out.source, 'rule');
});

test('an out-of-range priority from the model is not trusted', async () => {
  const out = await triageIssue(envSaying('P0'), issue());
  assert.equal(out.source, 'rule');
  assert.ok(['P1', 'P2', 'P3', 'P4'].includes(out.priority));
});

test('when every model fails, the issue is still filed', async () => {
  const out = await triageIssue(envDown, issue());
  assert.equal(out.source, 'rule');
  assert.equal(out.priority, 'P3');
  assert.match(out.rationale, /unavailable/i);
  assert.equal(out.model, null);
});

test('known-noisy errors are filed as P4 without spending a model call', async () => {
  let called = false;
  const env = { AI: { run: async () => { called = true; return {}; } } };

  const out = await triageIssue(env, issue({ title: 'ResizeObserver loop completed with undelivered notifications' }));
  assert.equal(out.priority, 'P4');
  assert.equal(out.source, 'rule');
  assert.equal(called, false, 'noise should short-circuit before the model');
});

test('volume nudges by one step and never past P2', () => {
  assert.equal(volumeAdjust('P4', 1), 'P4');
  assert.equal(volumeAdjust('P4', 12), 'P3');
  assert.equal(volumeAdjust('P4', 80), 'P2');
  assert.equal(volumeAdjust('P3', 80), 'P2');
  // Already severe: unchanged.
  assert.equal(volumeAdjust('P1', 5000), 'P1');
  assert.equal(volumeAdjust('P2', 5000), 'P2');
});

test('confidence outside 0-1 is discarded rather than displayed', async () => {
  const out = await triageIssue(envSaying('P3', { confidence: 42 }), issue());
  assert.equal(out.confidence, null);
});

test('an info-level report floors at P4', () => {
  assert.equal(ruleFloor(issue({ level: 'info', title: 'cache warmed' })).priority, 'P4');
});

// ── Reports from the classroom laptops ─────────────────────────────────────
//
// These arrive through the fleet manager and look nothing like a page error:
// no stack, no user, and a message written for a teacher rather than a
// developer. The rules must not read them as web noise.

const laptop = (over = {}, context = {}) => issue({
  title: 'Startup check failed: Internet access — No internet connection',
  culprit: 'preflight/internet',
  app_slug: 'fleet',
  sample_stack: null,
  context: { source: 'laptop', component: 'preflight', check: 'internet', hostname: 'kiosk-07', ...context },
  ...over,
});

test('a laptop that cannot get online floors at P3', () => {
  const out = ruleFloor(laptop());
  assert.equal(out.priority, 'P3');
  assert.match(out.reason, /laptop/i);
});

test('a check the laptop marks as blocking floors even with an unfamiliar message', () => {
  assert.equal(
    ruleFloor(laptop({ title: 'Startup check failed: Kiosk profile — something new and strange' },
      { check: 'kiosk_home', critical: true })).priority,
    'P3',
  );
});

test('a device fault worded like web noise is not filed as noise', async () => {
  let called = false;
  const env = { AI: { run: async () => { called = true; return { response: JSON.stringify({ priority: 'P3', confidence: 0.8, rationale: 'stub' }) }; } } };

  // "network error" is a cancelled request in a browser and a broken laptop here.
  const out = await triageIssue(env, laptop({ title: 'Wi-Fi association failed: network error' }));
  assert.equal(called, true, 'device reports must reach the model, not the noise shortcut');
  assert.notEqual(out.priority, 'P4');
});

test('a laptop warning that harms nothing does not floor', () => {
  assert.equal(
    ruleFloor(laptop({ title: 'Sound output — No audio device detected' }, { check: 'audio' })).priority,
    null,
  );
});

test('the same fault on many laptops is carried up by volume', () => {
  const floor = ruleFloor(laptop({ events_count: 60 }));
  assert.equal(volumeAdjust(floor.priority, 60), 'P2');
});

test('context that is a JSON string (as stored) is still understood', () => {
  const stored = laptop();
  stored.context = JSON.stringify(stored.context);
  assert.equal(ruleFloor(stored).priority, 'P3');
});

test('a web app report is unaffected by any of this', () => {
  assert.equal(ruleFloor(issue({ title: 'Cannot read properties of undefined' })).priority, null);
});

test('the model is told it is looking at a machine', async () => {
  let seen = '';
  const env = { AI: { run: async (_m, opts) => { seen = opts.messages[1].content; return { response: '{"priority":"P3","confidence":0.7,"rationale":"stub"}' }; } } };
  await triageIssue(env, laptop());
  assert.match(seen, /Device: classroom laptop kiosk-07/);
  assert.match(seen, /failed check "internet"/);
  assert.doesNotMatch(seen, /\(none supplied\)/, 'a machine report should not pretend to have a stack');
});

// ── Breadth, not loudness ──────────────────────────────────────────────────
//
// Regression: one laptop missing wpasupplicant reported nine failed checks.
// Each was true, each was "a student cannot work", and the model filed all
// nine at P1 with 100% confidence — a board of solid red for one machine on a
// cart. Breadth is now counted, and it caps the model.

test('one broken laptop cannot exceed P3, however sure the model is', async () => {
  const out = await triageIssue(envSaying('P1', { confidence: 1 }), laptop({ device_count: 1, events_count: 9 }));
  assert.equal(out.aiPriority, 'P1', 'the model still says what it thinks');
  assert.equal(out.priority, 'P3', 'but one laptop is filed as one laptop');
  assert.match(out.rationale, /1 laptop/);
});

test('the same fault on a few laptops is allowed up to P2', async () => {
  const out = await triageIssue(envSaying('P1'), laptop({ device_count: 3 }));
  assert.equal(out.priority, 'P2');
});

test('the whole fleet is left alone at P1', async () => {
  const out = await triageIssue(envSaying('P1'), laptop({ device_count: 12 }));
  assert.equal(out.priority, 'P1');
});

test('a single laptops repeats do not nudge it up on volume', async () => {
  // 60 events, all from one machine: still one machine.
  const out = await triageIssue(envSaying('P3'), laptop({ device_count: 1, events_count: 60 }));
  assert.equal(out.priority, 'P3');
});

test('the ceiling only ever lowers, and only for devices', () => {
  assert.equal(atMost('P1', 'P3'), 'P3');   // caps a model that panicked
  assert.equal(atMost('P4', 'P3'), 'P4');   // never raises: that is the floor's job
  assert.equal(atMost('P2', null), 'P2');   // web reports are uncapped
});

test('for one laptop the ceiling beats even the auth floor', async () => {
  // "Clever sign-in page" trips the sign-in rule, which floors at P2. On a
  // single laptop that is still one laptop, and the ceiling says so.
  const out = await triageIssue(envSaying('P1'),
    laptop({ title: 'Startup check failed: Clever sign-in page — did not respond', device_count: 1 }));
  assert.equal(out.priority, 'P3');
});

test('the model is told how many machines are affected', async () => {
  let seen = '';
  const env = { AI: { run: async (_m, o) => { seen = o.messages[1].content; return { response: '{"priority":"P3","confidence":0.7,"rationale":"stub"}' }; } } };
  await triageIssue(env, laptop({ device_count: 4 }));
  assert.match(seen, /Machines affected: 4/);
});

test('web app issues keep their volume nudge and no ceiling', async () => {
  const out = await triageIssue(envSaying('P4'), issue({ events_count: 80, title: 'Some web bug' }));
  assert.equal(out.priority, 'P2', 'volume still speaks for pages');
  assert.equal(deviceCeiling(issue()), null);
});

test('with AI down, a single laptop still lands at P3 rather than P2', () => {
  // The rule fallback used to be volume-nudged straight past the ceiling.
  const out = ruleFloor(laptop({ events_count: 80 }));
  assert.equal(atMost(volumeAdjust(out.priority, 80), deviceCeiling(laptop({ device_count: 1 }))), 'P3');
});
