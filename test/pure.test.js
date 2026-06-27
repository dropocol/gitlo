'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// These are pure functions exported from the compiled output.
const {
  getCronExpression,
  formatSchedule,
} = require('../dist/cron.js');
const { maskToken, expandPath } = require('../dist/config-manager.js');

// ---------------------------------------------------------------------------
// getCronExpression
// ---------------------------------------------------------------------------
test('getCronExpression: hourly', () => {
  assert.equal(getCronExpression({ frequency: 'hourly' }), '0 * * * *');
});

test('getCronExpression: daily uses HH:MM (minute then hour)', () => {
  assert.equal(
    getCronExpression({ frequency: 'daily', time: '03:30' }),
    '30 03 * * *'
  );
  assert.equal(
    getCronExpression({ frequency: 'daily' }),
    '00 02 * * *' // default 02:00 -> minute=00 hour=02
  );
});

test('getCronExpression: weekly includes day of week', () => {
  assert.equal(
    getCronExpression({ frequency: 'weekly', time: '02:00', dayOfWeek: 1 }),
    '00 02 * * 1'
  );
});

test('getCronExpression: monthly runs on the 1st', () => {
  assert.equal(
    getCronExpression({ frequency: 'monthly', time: '05:15' }),
    '15 05 1 * *'
  );
});

test('getCronExpression: custom falls back when empty', () => {
  assert.equal(getCronExpression({ frequency: 'custom' }), '0 2 * * 0');
  assert.equal(
    getCronExpression({ frequency: 'custom', customExpression: '*/5 * * * *' }),
    '*/5 * * * *'
  );
});

test('getCronExpression: unknown frequency defaults', () => {
  assert.equal(getCronExpression({ frequency: 'nope' }), '0 2 * * 0');
});

// ---------------------------------------------------------------------------
// formatSchedule
// ---------------------------------------------------------------------------
test('formatSchedule: daily', () => {
  assert.equal(formatSchedule({ frequency: 'daily', time: '03:00' }), 'Daily at 03:00');
});

test('formatSchedule: weekly maps day index to name', () => {
  assert.equal(
    formatSchedule({ frequency: 'weekly', dayOfWeek: 1, time: '02:00' }),
    'Weekly on Monday at 02:00'
  );
});

test('formatSchedule: monthly', () => {
  assert.equal(
    formatSchedule({ frequency: 'monthly', time: '02:00' }),
    'Monthly on the 1st at 02:00'
  );
});

// ---------------------------------------------------------------------------
// maskToken
// ---------------------------------------------------------------------------
test('maskToken: preserves prefix and suffix for long tokens', () => {
  const token = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz';
  const masked = maskToken(token);
  assert.equal(masked, 'ghp_****wxyz');
  // The middle of the token must never appear in the mask.
  assert.equal(masked.includes('0123456789'), false);
});

test('maskToken: does not duplicate content for short tokens', () => {
  // Old code produced "abc****abc" here.
  assert.equal(maskToken('abc'), '****');
  assert.equal(maskToken('12345678'), '****'); // exactly 8 chars => still hidden
});

test('maskToken: handles github_pat_ prefix', () => {
  const token = 'github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const masked = maskToken(token);
  // First 4 chars of "github_pat_..." are "gith"
  assert.equal(masked.slice(0, 4), 'gith');
  assert.ok(masked.includes('****'));
});

test('maskToken: empty input', () => {
  assert.equal(maskToken(''), '');
});

// ---------------------------------------------------------------------------
// expandPath
// ---------------------------------------------------------------------------
test('expandPath: replaces leading tilde with homedir', () => {
  const os = require('node:os');
  assert.equal(expandPath('~/foo'), require('node:path').join(os.homedir(), 'foo'));
});

test('expandPath: leaves non-tilde paths untouched', () => {
  assert.equal(expandPath('/abs/path'), '/abs/path');
  assert.equal(expandPath('relative/path'), 'relative/path');
});
