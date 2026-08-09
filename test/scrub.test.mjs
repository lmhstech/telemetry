// The scrubber is the control that keeps a crash report from becoming a
// student record. These tests are the specification for that claim.

import test from 'node:test';
import assert from 'node:assert/strict';

import { scrubText, scrubStack, scrubValue } from '../src/lib/scrub.js';

test('email addresses never survive', () => {
  assert.equal(scrubText('failed for jane.doe@scps.k12.fl.us'), 'failed for [email]');
  assert.equal(scrubText('to=a@b.co, cc=c+tag@d.org'), 'to=[email], cc=[email]');
});

test('student ID numbers and other long digit runs are removed', () => {
  assert.equal(scrubText('lookup failed for 1234567'), 'lookup failed for [number]');
  // Short numbers are useful context and are kept: line numbers, counts, codes.
  assert.equal(scrubText('failed with status 404 after 3 tries'), 'failed with status 404 after 3 tries');
});

test('credentials are stripped', () => {
  assert.match(scrubText('Authorization: Bearer abcdefghijklmnop'), /\[credential\]/);
  assert.match(scrubText('eyJhbGciOi.eyJzdWIiOiJ4.signature'), /\[jwt\]/);
  assert.match(scrubText('?password=hunter2000&next=/'), /password=\[redacted\]/);
  assert.match(scrubText('api_key: "sk-abcdefghijklmnopqrst"'), /\[redacted\]|\[credential\]/);
});

test('home directory names are removed from paths but the path shape survives', () => {
  assert.equal(scrubText('at /Users/jsmith/dev/app/index.js:12'), 'at /Users/[user]/dev/app/index.js:12');
  assert.equal(scrubText('C:\\Users\\jsmith\\app'), 'C:\\Users\\[user]\\app');
  assert.equal(scrubText('at /home/pi/runner/main.mjs:4'), 'at /home/[user]/runner/main.mjs:4');
});

test('IP addresses and phone numbers go', () => {
  assert.equal(scrubText('from 192.168.1.44'), 'from [ip]');
  assert.equal(scrubText('call 407-555-0134'), 'call [phone]');
});

test('keys that name personal data have their values dropped entirely', () => {
  const out = scrubValue({
    full_name: 'Jane Doe',
    Email: 'jane@example.com',
    studentId: 'ABC',        // not digits, so only the key name catches it
    note: 'submission failed',
    nested: { displayName: 'Jane', ok: true },
  });

  assert.equal(out.full_name, '[redacted]');
  assert.equal(out.Email, '[redacted]');
  assert.equal(out.studentId, '[redacted]');
  assert.equal(out.nested.displayName, '[redacted]');
  // Innocent fields are left alone — the report still has to be useful.
  assert.equal(out.note, 'submission failed');
  assert.equal(out.nested.ok, true);
});

test('context is bounded in depth, breadth and length', () => {
  let deep = { v: 'bottom' };
  for (let i = 0; i < 12; i++) deep = { next: deep };
  assert.equal(JSON.stringify(scrubValue(deep)).includes('depth limit'), true);

  const wide = {};
  for (let i = 0; i < 200; i++) wide['k' + i] = i;
  assert.equal(scrubValue(wide)['[truncated]'], true);

  const long = scrubValue({ blob: 'x'.repeat(50000) });
  assert.ok(long.blob.length <= 2000);

  const arr = scrubValue({ list: Array.from({ length: 100 }, (_, i) => i) });
  assert.ok(arr.list.length <= 41);
  assert.match(String(arr.list.at(-1)), /more/);
});

test('scrubValue tolerates the junk a crashing app actually sends', () => {
  assert.equal(scrubValue(null), null);
  assert.equal(scrubValue(undefined), null);
  assert.equal(scrubValue(() => {}), '[unsupported]');
  assert.equal(scrubValue(Number.NaN), 'NaN');
  assert.equal(scrubValue(true), true);
});

test('stacks are scrubbed and capped, and non-strings do not throw', () => {
  const stack = Array.from({ length: 200 }, (_, i) => `    at fn${i} (/Users/jsmith/app/f.js:${i}:1)`).join('\n');
  const out = scrubStack(stack);
  assert.ok(out.split('\n').length <= 40);
  assert.ok(!out.includes('jsmith'));

  assert.equal(scrubStack(undefined), null);
  assert.equal(scrubStack(12345), null);
});

test('scrubbing is idempotent — running it twice changes nothing further', () => {
  const once = scrubText('jane@x.com from 10.0.0.1 id 1234567');
  assert.equal(scrubText(once), once);
});
