// Grouping tests. The property that matters: the same bug collapses to one
// issue, and two different bugs do not.

import test from 'node:test';
import assert from 'node:assert/strict';

import { fingerprintFor, normaliseMessage, culpritFrame, titleFor, deviceCulprit } from '../src/lib/fingerprint.js';

test('varying ids and numbers do not split one bug into many issues', async () => {
  const a = await fingerprintFor({ appId: 'app1', message: 'Failed to load lesson 4821' });
  const b = await fingerprintFor({ appId: 'app1', message: 'Failed to load lesson 9137' });
  assert.equal(a, b);
});

test('uuids, hashes and quoted values are normalised away', () => {
  assert.equal(
    normaliseMessage('no row for 3f2a1b4c-5d6e-7f80-9012-3456789abcde'),
    'no row for <uuid>',
  );
  assert.equal(normaliseMessage("bad column 'full_name'"), 'bad column <s>');
  assert.equal(normaliseMessage('at 0xdeadbeef'), 'at <hex>');
});

test('scrubber placeholders normalise to one token, so redaction does not fragment grouping', () => {
  assert.equal(normaliseMessage('mail to [email] failed'), normaliseMessage('mail to [phone] failed'));
});

test('genuinely different messages stay apart', async () => {
  const a = await fingerprintFor({ appId: 'app1', message: 'Database is gone' });
  const b = await fingerprintFor({ appId: 'app1', message: 'Cannot read properties of undefined' });
  assert.notEqual(a, b);
});

test('the same message in two apps is two issues', async () => {
  const a = await fingerprintFor({ appId: 'velri', message: 'Timeout' });
  const b = await fingerprintFor({ appId: 'fleet', message: 'Timeout' });
  assert.notEqual(a, b);
});

test('the same generic message from two different lines is two issues', async () => {
  const stackA = "    at get (src/routes/api.js:88:12)";
  const stackB = "    at post (src/routes/admin.js:14:3)";
  const a = await fingerprintFor({ appId: 'app1', message: 'undefined is not an object', stack: stackA });
  const b = await fingerprintFor({ appId: 'app1', message: 'undefined is not an object', stack: stackB });
  assert.notEqual(a, b);
});

test('an app-supplied fingerprint overrides the derived one', async () => {
  const a = await fingerprintFor({ appId: 'app1', message: 'Upstream 500', explicit: 'gemini-down' });
  const b = await fingerprintFor({ appId: 'app1', message: 'Totally different text', explicit: 'gemini-down' });
  assert.equal(a, b);
});

test('the culprit is the app frame, not the runtime or a dependency', () => {
  const stack = [
    'Error: boom',
    '    at Object.<anonymous> (/app/node_modules/jose/dist/verify.js:10:5)',
    '    at node:internal/process/task_queues:95:5',
    '    at handler (/app/src/routes/api.js:88:12)',
  ].join('\n');
  assert.equal(culpritFrame(stack), 'routes/api.js:88');
});

test('python-style tracebacks are understood too', () => {
  const stack = 'Traceback:\n  File "backend/api/routes/admin.py", line 262, in list_users';
  assert.equal(culpritFrame(stack), 'routes/admin.py:262');
});

test('a stack with no usable frame is not an error', () => {
  assert.equal(culpritFrame('something went wrong'), null);
  assert.equal(culpritFrame(null), null);
});

test('titles are the first line, bounded', () => {
  assert.equal(titleFor('boom\nat line 2\nat line 3'), 'boom');
  assert.ok(titleFor('x'.repeat(500)).length <= 200);
  assert.equal(titleFor(''), 'Unknown error');
});

test('a machine report gets a culprit from the check that failed', () => {
  assert.equal(deviceCulprit({ component: 'preflight', check: 'wifi_link' }), 'preflight/wifi_link');
  assert.equal(deviceCulprit({ component: 'agent', command: 'set_wifi' }), 'agent/set_wifi');
  assert.equal(deviceCulprit({ check: 'internet' }), 'device/internet');
  assert.equal(deviceCulprit({ source: 'laptop' }), null);
  assert.equal(deviceCulprit(null), null);
});
