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

// ---------------------------------------------------------------------------
// interactive validators (isValidTime, isIntInRange)
// ---------------------------------------------------------------------------
const { isValidTime, isIntInRange } = require('../dist/interactive.js');

test('isValidTime: accepts valid 24-hour HH:MM', () => {
  assert.equal(isValidTime('00:00'), true);
  assert.equal(isValidTime('02:00'), true);
  assert.equal(isValidTime('14:30'), true);
  assert.equal(isValidTime('23:59'), true);
});

test('isValidTime: rejects out-of-range and malformed', () => {
  assert.equal(isValidTime('24:00'), false); // hour too high
  assert.equal(isValidTime('23:60'), false); // minute too high
  assert.equal(isValidTime('9:30'), false);  // not zero-padded
  assert.equal(isValidTime('2:00'), false);
  assert.equal(isValidTime(''), false);
  assert.equal(isValidTime('abc'), false);
  assert.equal(isValidTime('1200'), false);
});

test('isIntInRange: accepts integers in range', () => {
  assert.equal(isIntInRange('0', 0, 6), true);
  assert.equal(isIntInRange('3', 0, 6), true);
  assert.equal(isIntInRange('6', 0, 6), true);
});

test('isIntInRange: rejects out-of-range and non-integers', () => {
  assert.equal(isIntInRange('-1', 0, 6), false);
  assert.equal(isIntInRange('7', 0, 6), false);
  assert.equal(isIntInRange('3.5', 0, 6), false);
  assert.equal(isIntInRange('', 0, 6), false);
  assert.equal(isIntInRange('abc', 0, 6), false);
});

// ---------------------------------------------------------------------------
// update-checker: compareVersions
// ---------------------------------------------------------------------------
const { compareVersions } = require('../dist/update-checker.js');

test('compareVersions: newer versions return 1', () => {
  assert.equal(compareVersions('1.1.0', '1.0.2'), 1);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.0.10', '1.0.9'), 1);
});

test('compareVersions: older versions return -1', () => {
  assert.equal(compareVersions('1.0.2', '1.1.0'), -1);
  assert.equal(compareVersions('1.9.9', '2.0.0'), -1);
});

test('compareVersions: equal versions return 0', () => {
  assert.equal(compareVersions('1.0.2', '1.0.2'), 0);
  assert.equal(compareVersions('1.1.0', '1.1.0'), 0);
});

test('compareVersions: handles v prefix and malformed input gracefully', () => {
  assert.equal(compareVersions('v1.1.0', '1.0.2'), 1);
  assert.equal(compareVersions('1.0.2', 'v1.1.0'), -1);
  // Malformed parts default to 0 rather than throwing.
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.x.0', '1.0.0'), 0);
});

// ---------------------------------------------------------------------------
// cron: getCronCommand includes --branch-strategy all for update runs
// ---------------------------------------------------------------------------
const { getCronCommand } = require('../dist/cron.js');

test('getCronCommand: update-only run syncs all branches', () => {
  const cmd = getCronCommand(true);
  assert.ok(cmd.includes('--update'), 'update-only command should include --update');
  assert.ok(cmd.includes('--branch-strategy all'), 'scheduled update should sync all branches');
});

test('getCronCommand: full (clone) run has no branch-strategy flag', () => {
  const cmd = getCronCommand(false);
  assert.ok(!cmd.includes('--update'), 'full run should not include --update');
  // Branch strategy only applies to updates; full clones fetch everything anyway.
  assert.ok(!cmd.includes('--branch-strategy'), 'full run should not include --branch-strategy');
});

// ---------------------------------------------------------------------------
// cron: parseCronLine
// ---------------------------------------------------------------------------
const { parseCronLine } = require('../dist/cron.js');

test('parseCronLine: parses a real stale gitlo line', () => {
  const line = '45 19 * * * /usr/bin/node /path/index.js --update >> /home/u/.gitlo/backup.log 2>&1 # gitlo-auto-backup';
  const parsed = parseCronLine(line);
  assert.equal(parsed.schedule, '45 19 * * *');
  assert.equal(parsed.command, '/usr/bin/node /path/index.js --update');
  assert.equal(parsed.logPath, '/home/u/.gitlo/backup.log');
  assert.equal(parsed.comment, '# gitlo-auto-backup');
});

test('parseCronLine: handles a line with no log redirect', () => {
  const line = '0 2 * * * /usr/bin/node /path/index.js --update # gitlo-auto-backup';
  const parsed = parseCronLine(line);
  assert.equal(parsed.schedule, '0 2 * * *');
  assert.equal(parsed.command, '/usr/bin/node /path/index.js --update');
  assert.equal(parsed.logPath, null);
  assert.equal(parsed.comment, '# gitlo-auto-backup');
});

test('parseCronLine: handles quoted log path with spaces', () => {
  const line = '0 2 * * * /usr/bin/node /p/index.js --update >> "/my logs/backup.log" 2>&1 # gitlo-auto-backup';
  const parsed = parseCronLine(line);
  assert.equal(parsed.logPath, '/my logs/backup.log');
});

test('parseCronLine: returns null for malformed/comment lines', () => {
  assert.equal(parseCronLine('# this is a comment'), null);
  assert.equal(parseCronLine(''), null);
  assert.equal(parseCronLine('only three fields'), null);
  assert.equal(parseCronLine('   '), null);
});

// ---------------------------------------------------------------------------
// migration: migrateConfig
// ---------------------------------------------------------------------------
const { migrateConfig, CURRENT_CONFIG_VERSION } = require('../dist/migration.js');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CONFIG_FILE = path.join(os.homedir(), '.gitlo', 'config.json');

function withTempConfig(contents, fn) {
  // Back up the real config, write a temp one, restore after the test.
  const backup = fs.existsSync(CONFIG_FILE) ? fs.readFileSync(CONFIG_FILE) : null;
  try {
    fs.writeFileSync(CONFIG_FILE, typeof contents === 'string' ? contents : JSON.stringify(contents));
    return fn();
  } finally {
    if (backup !== null) {
      fs.writeFileSync(CONFIG_FILE, backup);
    } else {
      fs.unlinkSync(CONFIG_FILE);
    }
  }
}

test('migrateConfig: adds configVersion to an unversioned config', () => {
  withTempConfig({ githubToken: 'ghp_test', outputDir: '/tmp/x' }, () => {
    migrateConfig();
    const after = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    assert.equal(after.configVersion, CURRENT_CONFIG_VERSION);
    // Preserves existing values.
    assert.equal(after.githubToken, 'ghp_test');
    assert.equal(after.outputDir, '/tmp/x');
    // Defaults branchStrategy to 'all' (safer for a backup tool).
    assert.equal(after.branchStrategy, 'all');
  });
});

test('migrateConfig: is idempotent (running twice yields the same result)', () => {
  withTempConfig({ githubToken: 'ghp_test' }, () => {
    migrateConfig();
    const first = fs.readFileSync(CONFIG_FILE, 'utf8');
    migrateConfig();
    const second = fs.readFileSync(CONFIG_FILE, 'utf8');
    assert.equal(first, second);
  });
});

test('migrateConfig: no-op when already current', () => {
  const current = { githubToken: 'ghp_test', branchStrategy: 'all', configVersion: CURRENT_CONFIG_VERSION };
  withTempConfig(current, () => {
    const result = migrateConfig();
    assert.equal(result, false); // false = nothing migrated
  });
});
