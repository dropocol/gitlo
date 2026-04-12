#!/usr/bin/env node

import { Command } from 'commander';
import { parseOptions, runBackup, createConfigCommands, createScheduleCommands } from './cli.js';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const packageJson = require('../package.json');

const program = new Command();

program
  .name('gitlo')
  .description('CLI tool to backup all your GitHub repositories locally')
  .version(packageJson.version);

// Config subcommands
createConfigCommands(program);

// Schedule subcommands
createScheduleCommands(program);

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
  .option('-v, --verbose', 'Show detailed progress and filtering information', false)
  .action(async (options: any) => {
    await runBackup(parseOptions(options));
  });

// Run the program
program.parse();
