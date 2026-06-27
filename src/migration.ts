import * as fs from 'fs';
import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import chalk from 'chalk';

import type { Config } from './types.js';
import { CONFIG_FILE, writeConfig } from './config-manager.js';
import { getAllCronLines, getCronCommand, parseCronLine, CRON_COMMENT } from './cron.js';

/** Bump this when the config schema changes. Absent = unversioned (pre-v1). */
export const CURRENT_CONFIG_VERSION = 1;

/**
 * Strictly read & parse the config file. Unlike readConfig() (which swallows
 * errors into {}), this surfaces parse failures so migration can back up a
 * broken file instead of silently wiping it. Never logs the token value.
 */
function readConfigStrict(): { data: Config | null; error: string | null } {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return { data: null, error: null };
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const data = JSON.parse(raw) as Config;
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Migrate the config file to CURRENT_CONFIG_VERSION. Idempotent and non-fatal:
 * - If already current → no-op (fast path on 99% of runs).
 * - If a field needs migration → apply migrations in order, re-write via
 *   writeConfig (preserves 0600 perms).
 * - If the file is corrupt/unreadable → back it up, start fresh, warn the user.
 *
 * Returns true if a migration actually happened (useful for logging).
 */
export function migrateConfig(): boolean {
  let { data, error } = readConfigStrict();

  // Corrupt or unreadable config: back it up and start fresh.
  if (error) {
    try {
      const backup = `${CONFIG_FILE}.bak.${Date.now()}`;
      fs.copyFileSync(CONFIG_FILE, backup);
      console.warn(chalk.yellow(`⚠️  Config file was unreadable; backed up to ${backup}.`));
      console.warn(chalk.yellow(`   Starting with a fresh config. Re-run \`gitlo config set token <token>\` if needed.`));
    } catch {
      console.warn(chalk.yellow('⚠️  Config file unreadable and could not be backed up.'));
    }
    data = {};
    error = null;
  }

  if (!data) data = {}; // missing file — fresh start

  const currentVersion = data.configVersion ?? 0; // 0 = unversioned (pre-v1)

  // Fast path: already up to date.
  if (currentVersion >= CURRENT_CONFIG_VERSION) {
    return false;
  }

  const before = JSON.stringify(data);

  // --- Initial migration (unversioned → v1) --------------------------------
  // Ensure branchStrategy exists with a safe default. The default is 'all'
  // because the purpose of a backup tool is to protect against account/repo
  // loss — syncing every branch is the safer choice.
  if (!data.branchStrategy) {
    data.branchStrategy = 'all';
  }
  data.configVersion = 1;

  const after = JSON.stringify(data);

  // Only write if something actually changed (avoids needless disk writes).
  if (before !== after) {
    writeConfig(data);
    console.log(chalk.gray(`ℹ️  Migrated config to v${CURRENT_CONFIG_VERSION}.`));
  }

  return true;
}

/**
 * Migrate stale gitlo cron lines to the new command structure (adds
 * `--branch-strategy all`). Preserves the user's chosen schedule and log path,
 * and never touches unrelated crontab entries.
 *
 * Stale = a line marked `# gitlo-auto-backup` that lacks `--branch-strategy all`.
 * Idempotent: already-migrated lines are skipped.
 */
export function migrateCron(): boolean {
  let lines: string[];
  try {
    lines = getAllCronLines();
  } catch {
    return false; // no crontab or crontab unavailable — nothing to migrate
  }

  if (lines.length === 0) return false;

  let migratedAny = false;
  const updated = lines.map((line) => {
    // Only touch gitlo's own lines, and only if they're stale.
    if (!line.includes(CRON_COMMENT)) return line;
    if (line.includes('--branch-strategy all')) return line; // already current

    const parsed = parseCronLine(line);
    if (!parsed) return line; // malformed — leave it alone

    // Rebuild the command with the new structure.
    const newCommand = getCronCommand(true); // true => --update --branch-strategy all
    const redirect = parsed.logPath ? ` >> ${parsed.logPath} 2>&1` : '';
    const newLine = `${parsed.schedule} ${newCommand}${redirect} ${CRON_COMMENT}`;

    if (newLine !== line) {
      migratedAny = true;
      return newLine;
    }
    return line;
  });

  if (!migratedAny) return false;

  // Rewrite the crontab via the established temp-file idiom. Preserve every
  // non-gitlo line exactly as-is.
  try {
    const tempFile = path.join(os.tmpdir(), `gitlo-cron-${Date.now()}`);
    fs.writeFileSync(tempFile, updated.join('\n') + '\n');
    execSync(`crontab ${tempFile}`, { stdio: ['pipe', 'ignore', 'ignore'] });
    fs.unlinkSync(tempFile);
    console.log(chalk.gray('ℹ️  Updated scheduled backup to the new format (all-branches sync).'));
    return true;
  } catch {
    console.warn(chalk.yellow('⚠️  Could not update your scheduled backup automatically.'));
    console.warn(chalk.yellow('   Re-run `gitlo schedule setup` to refresh it.'));
    return false;
  }
}

/**
 * Run all migrations (config then cron). Called once at startup. Non-fatal:
 * any failure is caught and logged, never blocking the CLI.
 */
export function runMigrations(): void {
  try {
    migrateConfig();
  } catch (err) {
    console.warn(chalk.yellow('⚠️  Config migration skipped due to an unexpected error.'));
    console.warn(chalk.gray(`   ${err instanceof Error ? err.message : String(err)}`));
  }
  try {
    migrateCron();
  } catch (err) {
    console.warn(chalk.yellow('⚠️  Cron migration skipped due to an unexpected error.'));
    console.warn(chalk.gray(`   ${err instanceof Error ? err.message : String(err)}`));
  }
}
