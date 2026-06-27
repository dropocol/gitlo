import * as readline from 'readline/promises';
import { stdin, stdout } from 'process';
import chalk from 'chalk';
import * as os from 'os';

import { parseOptions, runBackup } from './cli.js';
import {
  readConfig,
  getConfig,
  setConfig,
  removeConfig,
  expandPath,
  maskToken,
} from './config-manager.js';
import {
  addCronJob,
  getCronExpression,
  formatSchedule,
  listCronJobs,
  removeCronJob,
  type CronSchedule,
} from './cron.js';
import { checkForUpdate, printUpdateBanner, selfUpdate } from './update-checker.js';
import packageJson from '../package.json';

// ---------------------------------------------------------------------------
// Pure validators (exported for unit testing)
// ---------------------------------------------------------------------------

/** Returns true for a valid HH:MM 24-hour time string. */
export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Returns true for an integer in [min, max]. */
export function isIntInRange(value: string, min: number, max: number): boolean {
  if (value.trim() === '' || !/^-?\d+$/.test(value.trim())) return false;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max;
}

// ---------------------------------------------------------------------------
// Prompt primitives (built on Node's readline/promises — zero deps)
// ---------------------------------------------------------------------------

interface Choice<T> {
  label: string;
  value: T;
}

let rl: readline.Interface | null = null;
// Set to true when stdin closes (EOF / Ctrl+D) or the user hits Ctrl+C, so the
// prompt helpers can bail out gracefully instead of looping forever.
let stdinClosed = false;

function getInterface(): readline.Interface {
  if (!rl) {
    rl = readline.createInterface({
      input: stdin,
      output: stdout,
      terminal: stdout.isTTY,
    });
    // On EOF (Ctrl+D) or Ctrl+C, mark the stream as closed so any pending
    // question resolves and the main loop can exit cleanly.
    rl.on('close', () => {
      stdinClosed = true;
    });
  }
  return rl;
}

function closeInterface(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
}

/**
 * Wraps rl.question so that EOF / Ctrl+C / Ctrl+D resolves to null instead of
 * throwing or hanging. Callers treat null as "user wants to quit".
 */
async function ask(question: string): Promise<string | null> {
  if (stdinClosed) return null;
  const iface = getInterface();
  try {
    const answer = await iface.question(question);
    if (stdinClosed) return null;
    return answer;
  } catch {
    return null;
  }
}

/** Show a numbered menu and return the chosen value. Re-loops on bad input. Returns null on EOF/Ctrl+C. */
async function select<T>(message: string, choices: Choice<T>[]): Promise<T | null> {
  const lines = choices.map((c, i) => `  ${chalk.cyan(`${i + 1}`)}. ${c.label}`);
  const prompt = `${chalk.bold(message)}\n${lines.join('\n')}\n${chalk.gray('> ')}`;

  while (true) {
    const answer = await ask(prompt);
    if (answer === null) return null; // EOF / Ctrl+C
    const idx = parseInt(answer.trim(), 10);
    if (Number.isInteger(idx) && idx >= 1 && idx <= choices.length) {
      return choices[idx - 1].value;
    }
    console.log(chalk.yellow(`  Please enter a number between 1 and ${choices.length}.`));
  }
}

/** Yes/no question with a default. Honors Enter (default) and y/n variants. Returns null on EOF/Ctrl+C. */
async function confirm(message: string, defaultValue = true): Promise<boolean | null> {
  const hint = defaultValue ? '[Y/n]' : '[y/N]';
  const answer = await ask(`${message} ${chalk.gray(hint)} `);
  if (answer === null) return null;

  const trimmed = answer.trim().toLowerCase();
  if (trimmed === '') return defaultValue;
  return trimmed === 'y' || trimmed === 'yes';
}

/** Free-text input with optional default and validator. Loops on invalid. Returns null on EOF/Ctrl+C. */
async function input(
  message: string,
  defaultValue?: string,
  validate?: (v: string) => string | null // returns error message or null if ok
): Promise<string | null> {
  const hint = defaultValue ? chalk.gray(` (default: ${defaultValue})`) : '';
  const prompt = `${message}${hint}: `;

  while (true) {
    const answer = await ask(prompt);
    if (answer === null) return null;
    const value = answer.trim() === '' && defaultValue !== undefined ? defaultValue : answer.trim();

    if (value === '') {
      console.log(chalk.yellow('  This field is required.'));
      continue;
    }
    if (validate) {
      const error = validate(value);
      if (error) {
        console.log(chalk.yellow(`  ${error}`));
        continue;
      }
    }
    return value;
  }
}

/** Secret input — token is read without being echoed to the terminal. Returns null on EOF/Ctrl+C. */
async function password(message: string): Promise<string | null> {
  // When stdin is a TTY, switch to raw mode so the secret isn't echoed.
  const isTTY = !!process.stdin.isTTY;
  const wasRaw = isTTY ? process.stdin.isRaw : false;

  if (isTTY) {
    process.stdin.setRawMode(true);
  }

  let value: string | null = null;
  try {
    value = await ask(`${message}: `);
  } finally {
    if (isTTY) {
      process.stdin.setRawMode(wasRaw as boolean);
    }
    // Print a newline so subsequent output isn't on the muted line.
    process.stdout.write('\n');
  }
  return value === null ? null : value.trim();
}

// ---------------------------------------------------------------------------
// Menu actions (each reuses existing functions — no logic duplicated)
// ---------------------------------------------------------------------------

async function actionRunBackup(): Promise<void> {
  const config = readConfig();

  // Resolve token the same way parseOptions does: arg > env > config.
  // Here there's no arg, so: env > config.
  let token = process.env.GITHUB_TOKEN || config.githubToken;

  if (!token) {
    console.log(chalk.yellow('\nNo GitHub token found.'));
    const setNow = await confirm('Would you like to set one now?', true);
    if (setNow === null) return; // EOF / Ctrl+C
    if (setNow) {
      const entered = await password('Paste your GitHub token');
      if (!entered) {
        console.log(chalk.red('Token is required to run a backup. Aborting.'));
        return;
      }
      token = entered;
      setConfig('githubToken', token);
      console.log(chalk.green('✓ GitHub token saved\n'));
    } else {
      console.log(chalk.gray('Get a token at: https://github.com/settings/tokens'));
      return;
    }
  }

  console.log(chalk.gray(`Using token: ${maskToken(token)}\n`));

  const method = await select<'https' | 'ssh'>('Clone method?', [
    { label: 'HTTPS (default, works with token)', value: 'https' },
    { label: 'SSH (requires SSH key setup)', value: 'ssh' },
  ]);
  if (method === null) return;

  const updateExisting = await confirm('Update existing repositories (git pull) instead of skipping them?', true);
  if (updateExisting === null) return;

  // Branch strategy only matters when updating existing repos.
  let branchStrategy: 'default' | 'all' = config.branchStrategy || 'default';
  if (updateExisting) {
    const strategyChoice = await select<'default' | 'all'>('When updating, which branches should be synced?', [
      { label: 'Default branch only (faster)', value: 'default' },
      { label: 'All branches — checkout & update every branch (most complete)', value: 'all' },
    ]);
    if (strategyChoice === null) return;
    branchStrategy = strategyChoice;
  }

  const includeForks = await confirm('Include forked repositories?', false);
  if (includeForks === null) return;

  const includePrivate = await confirm('Include private repositories?', true);
  if (includePrivate === null) return;

  const dryRun = await confirm('Dry run first? (preview what will be backed up, no download)', false);
  if (dryRun === null) return;

  const verbose = await confirm('Show detailed progress (per-page fetch, skipped repos)?', false);
  if (verbose === null) return;

  const outputDir = await input('Output directory', config.outputDir || '(your GitHub username)');
  if (outputDir === null) return;
  const resolvedOutputDir = outputDir.trim() === '(your GitHub username)' ? undefined : expandPath(outputDir.trim());

  console.log(chalk.bold('\n📋 Review your choices:\n'));
  console.log(`  Token:         ${maskToken(token!)}`);
  console.log(`  Output:        ${resolvedOutputDir || '(username as folder)'}`);
  console.log(`  Method:        ${method}`);
  console.log(`  Update:        ${updateExisting ? 'yes' : 'no'}`);
  if (updateExisting) {
    console.log(`  Branches:      ${branchStrategy === 'all' ? 'all branches' : 'default branch only'}`);
  }
  console.log(`  Forks:         ${includeForks ? 'include' : 'exclude'}`);
  console.log(`  Private:       ${includePrivate ? 'include' : 'exclude'}`);
  console.log(`  Dry run:       ${dryRun ? 'yes' : 'no'}`);
  console.log(`  Verbose:       ${verbose ? 'yes' : 'no'}\n`);

  const proceed = await confirm('Start the backup?', true);
  if (!proceed) {
    console.log(chalk.gray('Cancelled.'));
    return;
  }

  // Build a synthetic options object in the shape Commander would produce,
  // then let parseOptions merge env/config exactly as the CLI does.
  const cmdOptions = {
    token: token,
    outputDir: resolvedOutputDir,
    method,
    includePrivate,
    includeForks,
    dryRun,
    update: updateExisting,
    branchStrategy,
    excludePrivate: !includePrivate,
    verbose,
  };

  closeInterface(); // free the TTY before the backup output begins
  await runBackup(parseOptions(cmdOptions));
}

async function actionConfigure(): Promise<void> {
  const choice = await select('What do you want to configure?', [
    { label: 'Set GitHub token', value: 'set-token' },
    { label: 'Set output directory', value: 'set-output' },
    { label: 'Set branch strategy', value: 'set-strategy' },
    { label: 'Get a single value', value: 'get-value' },
    { label: 'Remove GitHub token', value: 'remove-token' },
    { label: 'Remove output directory', value: 'remove-output' },
    { label: 'Reset branch strategy', value: 'remove-strategy' },
    { label: 'Back to main menu', value: 'back' },
  ]);
  if (choice === null) return;

  switch (choice) {
    case 'set-token': {
      const token = await password('Paste your GitHub token');
      if (!token) {
        console.log(chalk.red('No token entered.'));
        return;
      }
      setConfig('githubToken', token);
      console.log(chalk.green('✓ GitHub token saved'));
      console.log(chalk.gray('Config file: ~/.gitlo/config.json'));
      break;
    }
    case 'set-output': {
      const current = readConfig().outputDir;
      const dir = await input('Output directory path', current || '~/.gitlo/backups');
      if (dir === null) return;
      const expanded = expandPath(dir);
      setConfig('outputDir', expanded);
      console.log(chalk.green('✓ Default output directory saved'));
      console.log(chalk.gray(`Path: ${expanded}`));
      break;
    }
    case 'set-strategy': {
      const current = readConfig().branchStrategy || 'default';
      const strategy = await select<'default' | 'all'>(
        `Branch strategy for updating existing repos (current: ${current})?`,
        [
          { label: 'default — sync only the default branch (faster)', value: 'default' },
          { label: 'all — checkout & sync every branch (most complete)', value: 'all' },
        ]
      );
      if (strategy === null) return;
      setConfig('branchStrategy', strategy);
      console.log(chalk.green(`✓ Branch strategy set to '${strategy}'`));
      console.log(chalk.gray('Config file: ~/.gitlo/config.json'));
      break;
    }
    case 'get-value': {
      const key = await select('Which value?', [
        { label: 'token', value: 'token' },
        { label: 'output-dir', value: 'output-dir' },
        { label: 'branch-strategy', value: 'branch-strategy' },
      ]);
      if (key === null) return;

      const resolvedKey = key === 'token' ? 'githubToken' : key === 'output-dir' ? 'outputDir' : 'branchStrategy';
      const value = getConfig(resolvedKey as any);
      if (value) {
        const display = resolvedKey === 'githubToken' ? maskToken(value) : value;
        console.log(chalk.green(`${key}: ${display}`));
      } else {
        console.log(chalk.yellow(`${key}: not set`));
      }
      break;
    }
    case 'remove-token': {
      const sure = await confirm('Remove the saved GitHub token?', false);
      if (sure === null) return;
      if (sure) {
        removeConfig('githubToken');
        console.log(chalk.green('✓ GitHub token removed'));
      }
      break;
    }
    case 'remove-output': {
      const sure = await confirm('Remove the saved output directory?', false);
      if (sure === null) return;
      if (sure) {
        removeConfig('outputDir');
        console.log(chalk.green('✓ Default output directory removed'));
      }
      break;
    }
    case 'remove-strategy': {
      const sure = await confirm('Reset branch strategy to default (default branch only)?', false);
      if (sure === null) return;
      if (sure) {
        removeConfig('branchStrategy');
        console.log(chalk.green('✓ Branch strategy reset to default'));
      }
      break;
    }
    case 'back':
    default:
      return;
  }
}

async function actionSchedule(): Promise<void> {
  const choice = await select('Schedule automatic backups?', [
    { label: 'Set up a schedule', value: 'setup' },
    { label: 'List scheduled jobs', value: 'list' },
    { label: 'Remove scheduled backup', value: 'remove' },
    { label: 'Back to main menu', value: 'back' },
  ]);

  if (choice === null) return;

  switch (choice) {
    case 'setup': {
      await scheduleSetup();
      break;
    }
    case 'list': {
      console.log(chalk.bold('\n📋 Scheduled Backup Jobs\n'));
      const jobs = listCronJobs();
      if (jobs.length === 0) {
        console.log(chalk.yellow('No scheduled backups found.'));
      } else {
        jobs.forEach((job, i) => console.log(`  ${i + 1}. ${chalk.cyan(job)}`));
      }
      console.log();
      break;
    }
    case 'remove': {
      const sure = await confirm('Remove the scheduled backup?', false);
      if (sure === null) return;
      if (sure) {
        if (removeCronJob()) {
          console.log(chalk.green('✓ Scheduled backup removed successfully!'));
        } else {
          console.log(chalk.red('❌ Failed to remove scheduled backup'));
        }
      }
      break;
    }
    case 'back':
    default:
      return;
  }
}

async function scheduleSetup(): Promise<void> {
  const frequency = await select<CronSchedule['frequency']>('How often should backups run?', [
    { label: 'Weekly', value: 'weekly' },
    { label: 'Daily', value: 'daily' },
    { label: 'Monthly', value: 'monthly' },
    { label: 'Hourly', value: 'hourly' },
  ]);
  if (frequency === null) return;

  let dayOfWeek = 0;
  if (frequency === 'weekly') {
    const dayInput = await input(
      'Day of week (0=Sunday, 1=Monday, ... 6=Saturday)',
      '0',
      (v) => (isIntInRange(v, 0, 6) ? null : 'Enter a number from 0 to 6.')
    );
    if (dayInput === null) return;
    dayOfWeek = parseInt(dayInput, 10);
  }

  const time = await input(
    'Time (24-hour HH:MM)',
    '02:00',
    (v) => (isValidTime(v) ? null : 'Use HH:MM format, e.g. 02:00 or 14:30.')
  );
  if (time === null) return;

  const full = await confirm('Full backup (clone all repos) instead of just updating existing ones?', false);
  if (full === null) return;

  const logFileRaw = await input('Log file path', '~/.gitlo/backup.log');
  if (logFileRaw === null) return;
  const logFile = logFileRaw.replace(/^~/, os.homedir());

  const schedule: CronSchedule = {
    frequency,
    time,
    dayOfWeek,
    updateOnly: !full,
  };

  console.log(chalk.bold('\n📋 Review schedule:\n'));
  console.log(`  Frequency:  ${formatSchedule(schedule)}`);
  console.log(`  Mode:       ${full ? 'Full backup' : 'Update existing (default)'}`);
  console.log(`  Log file:   ${logFile}`);
  console.log(`  Cron:       ${getCronExpression(schedule)}\n`);

  const proceed = await confirm('Create this schedule?', true);
  if (!proceed) {
    console.log(chalk.gray('Cancelled.'));
    return;
  }

  if (addCronJob(schedule, logFile)) {
    console.log(chalk.green('\n✓ Automatic backup scheduled successfully!'));
    console.log(chalk.gray(`Cron expression: ${getCronExpression(schedule)}`));
  } else {
    console.log(chalk.red('\n❌ Failed to schedule backup'));
  }
}

async function actionViewConfig(): Promise<void> {
  const config = readConfig();
  console.log(chalk.bold('\n📋 gitlo Configuration\n'));

  if (config.githubToken) {
    console.log(`  ${chalk.cyan('token')}: ${maskToken(config.githubToken)}`);
  } else {
    console.log(`  ${chalk.cyan('token')}: ${chalk.gray('not set')}`);
  }

  if (config.outputDir) {
    console.log(`  ${chalk.cyan('output-dir')}: ${config.outputDir}`);
  } else {
    console.log(`  ${chalk.cyan('output-dir')}: ${chalk.gray('not set')}`);
  }

  console.log(`  ${chalk.cyan('branch-strategy')}: ${config.branchStrategy || chalk.gray('default')}`);

  console.log(chalk.gray('\nConfig file: ~/.gitlo/config.json\n'));
}

async function actionUpdate(): Promise<void> {
  console.log(chalk.bold.blue('\n🔄  Update gitlo\n'));
  console.log(chalk.gray(`Current version: ${packageJson.version}`));

  // Check for the latest version (uses the daily cache; may hit the network).
  const spinnerText = 'Checking npm for the latest version...';
  process.stdout.write(chalk.gray(`${spinnerText}`));
  const info = await checkForUpdate(packageJson.version).catch(() => null);
  process.stdout.write('\r\x1b[K'); // clear the inline spinner text

  if (!info) {
    console.log(chalk.yellow('Could not check for updates (network unavailable).'));
    const proceed = await confirm('Try updating anyway?', false);
    if (proceed) {
      closeInterface();
      selfUpdate();
    }
    return;
  }

  if (!info.hasUpdate) {
    console.log(chalk.green(`You're on the latest version (${info.currentVersion}). 🎉\n`));
    return;
  }

  console.log(chalk.yellow(`A new version is available: ${info.currentVersion} → ${info.latestVersion}\n`));
  const proceed = await confirm('Update now?', true);
  if (!proceed) {
    console.log(chalk.gray(`You can update later with: gitlo update`));
    return;
  }

  closeInterface(); // free the TTY before running the installer
  selfUpdate();
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runInteractive(): Promise<void> {
  console.log(chalk.bold.blue('\n🗄️  gitlo - GitHub Backup Tool\n'));

  let running = true;
  while (running) {
    const choice = await select('What would you like to do?', [
      { label: '🔄  Run a backup now', value: 'backup' },
      { label: '⚙️   Configure settings (token / output directory)', value: 'config' },
      { label: '📅  Schedule automatic backups', value: 'schedule' },
      { label: '👀  View current configuration', value: 'view' },
      { label: '⬆️   Update gitlo', value: 'update' },
      { label: '🚪  Exit', value: 'exit' },
    ]);

    // EOF / Ctrl+C on the main menu → exit gracefully.
    if (choice === null) {
      console.log(chalk.gray('\nBye! 👋\n'));
      break;
    }

    switch (choice) {
      case 'backup':
        await actionRunBackup();
        break;
      case 'config':
        await actionConfigure();
        break;
      case 'schedule':
        await actionSchedule();
        break;
      case 'view':
        await actionViewConfig();
        break;
      case 'update':
        await actionUpdate();
        break;
      case 'exit':
        running = false;
        console.log(chalk.gray('\nBye! 👋\n'));
        break;
    }

    // After a backup we close the interface (runBackup controls its own output
    // and may process.exit). For other actions, loop back to the menu.
    if (choice === 'backup') {
      running = false;
    }
  }

  closeInterface();
}
