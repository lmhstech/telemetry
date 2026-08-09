// Triage tests.
//
// The model is stubbed. What is being tested is the part that must hold when
// the model is wrong, absent, or adversarial: the floor, the volume nudge, and
// the promise that a human's override survives.

import test from 'node:test';
import assert from 'node:assert/strict';

import { triageIssue, ruleFloor, volumeAdjust } from '../src/lib/triage.js';

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
