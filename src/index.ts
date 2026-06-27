#!/usr/bin/env node

import { Command } from 'commander';
import packageJson from '../package.json';
import { parseOptions, runBackup, createConfigCommands, createScheduleCommands } from './cli.js';
import { runInteractive } from './interactive.js';
import { checkForUpdate, printUpdateBanner, selfUpdate } from './update-checker.js';
import { runMigrations } from './migration.js';

const program = new Command();

program
  .name('gitlo')
  .description('CLI tool to backup all your GitHub repositories locally')
  .version(packageJson.version);

// Config subcommands
createConfigCommands(program);

// Schedule subcommands
createScheduleCommands(program);

// Self-update command
program
  .command('update')
  .description('Update gitlo to the latest version from npm')
  .action(async () => {
    // Skip the update banner for the `gitlo update` command itself.
    selfUpdate();
  });

/**
 * Check for a newer version and show the banner at the TOP, before the main
 * command runs. This is blocking, but the daily cache means it only hits the
 * network once per day — every other run is instant. Skipped for fast-exiting
 * paths (--help, --version) and in non-TTY (CI/scripts).
 */
async function notifyIfUpdate(): Promise<void> {
  if (!process.stdout.isTTY) return; // never in CI/pipes
  // Skip --help/--version so those stay instant.
  const argv = process.argv.slice(2).join(' ');
  if (argv.includes('--help') || argv.includes('-h') || argv.includes('--version') || argv.includes('-V')) {
    return;
  }
  const info = await checkForUpdate(packageJson.version).catch(() => null);
  if (info) {
    printUpdateBanner(info);
  }
}

// Main backup command
program
  .option('-t, --token <token>', 'GitHub personal access token (or set via gitlo config)')
  .option('-o, --output-dir <dir>', 'Output directory for backups (or set via gitlo config)')
  .option('-m, --method <method>', 'Clone method: https or ssh', 'https')
  .option('--include-private', 'Include private repositories', true)
  .option('--exclude-private', 'Exclude private repositories')
  .option('--include-forks', 'Include forked repositories', false)
  .option('--dry-run', 'Show what would be backed up without cloning')
  .option('--update', 'Update existing repositories (git pull)', false)
  .option('-b, --branch-strategy <strategy>', 'Branch strategy: default (default branch) or all (every branch)', 'default')
  .option('-v, --verbose', 'Show detailed progress and filtering information', false)
  .action(async (options: any) => {
    // Run config + cron migrations first so the environment is current before
    // anything else. Non-fatal: failures are caught and logged inside.
    runMigrations();

    await notifyIfUpdate();

    // Bare `gitlo` (no args at all) launches the interactive menu instead of
    // running a backup immediately. Any flag/subcommand behaves as before.
    if (process.argv.slice(2).length === 0) {
      await runInteractive();
      return;
    }
    await runBackup(parseOptions(options));
  });

// Run the program
program.parse();
