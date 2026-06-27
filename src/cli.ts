import { Command } from 'commander';
import chalk from 'chalk';
import * as os from 'os';
import { Octokit } from '@octokit/rest';
import ora from 'ora';
import * as path from 'path';
import type { BackupOptions, Config } from './types.js';
import { readConfig, getConfig, setConfig, removeConfig, expandPath, maskToken } from './config-manager.js';
import { fetchAllRepos, getAuthenticatedUser } from './github.js';
import { cloneOrUpdateRepo, displayRepoList, displaySummary, ensureDirectory } from './backup.js';
import {
  addCronJob,
  getCronExpression,
  formatSchedule,
  listCronJobs,
  removeCronJob,
  type CronSchedule,
} from './cron.js';

/**
 * Maps the user-facing config key (e.g. "output-dir") to the field stored in
 * the config file (e.g. "outputDir"). Keeps the get/set/remove commands DRY.
 */
const CONFIG_KEYS: Record<string, keyof Config> = {
  token: 'githubToken',
  'output-dir': 'outputDir',
  outputDir: 'outputDir',
  'branch-strategy': 'branchStrategy',
  branchStrategy: 'branchStrategy',
};

function resolveConfigKey(key: string): keyof Config | undefined {
  return CONFIG_KEYS[key];
}

function assertConfigKey(key: string): keyof Config {
  const resolved = resolveConfigKey(key);
  if (!resolved) {
    console.error(chalk.red(`❌ Unknown config key: ${key}`));
    console.log(chalk.gray('Valid keys: token, output-dir'));
    process.exit(1);
  }
  return resolved;
}

export function parseOptions(cmdOptions: any): BackupOptions {
  const config = readConfig();
  
  // Resolve token priority: CLI arg > env var > config file
  const token = cmdOptions.token || process.env.GITHUB_TOKEN || config.githubToken;
  
  // Resolve output dir priority: CLI arg > config file > undefined (will use username)
  let outputDir = cmdOptions.outputDir || config.outputDir;
  if (outputDir) {
    outputDir = expandPath(outputDir);
  }
  
  // Resolve branch strategy priority: CLI arg > config file > default 'default'
  const branchStrategyRaw = cmdOptions.branchStrategy || config.branchStrategy || 'default';
  const branchStrategy: 'default' | 'all' = branchStrategyRaw === 'all' ? 'all' : 'default';

  return {
    token,
    outputDir,
    method: cmdOptions.method as 'https' | 'ssh',
    includePrivate: !cmdOptions.excludePrivate,
    includeForks: cmdOptions.includeForks,
    dryRun: cmdOptions.dryRun,
    updateExisting: cmdOptions.update,
    verbose: cmdOptions.verbose,
    branchStrategy,
  };
}

export async function runBackup(options: BackupOptions): Promise<void> {
  console.log(chalk.bold.blue('\n🗄️  gitlo - GitHub Repository Backup Tool\n'));

  // Validate token
  if (!options.token) {
    console.error(chalk.red('❌ Error: GitHub token is required'));
    console.log(chalk.yellow('\nGet a token at: https://github.com/settings/tokens'));
    console.log(chalk.yellow('Required scopes: repo (for private repos), read:user\n'));
    console.log(chalk.gray('Setup options:'));
    console.log(chalk.gray('  1. Set via config:  gitlo config set token YOUR_TOKEN'));
    console.log(chalk.gray('  2. Environment var: export GITHUB_TOKEN=YOUR_TOKEN'));
    console.log(chalk.gray('  3. Pass directly:   gitlo -t YOUR_TOKEN\n'));
    process.exit(1);
  }

  // Initialize Octokit
  const octokit = new Octokit({ auth: options.token });

  try {
    // Get authenticated user
    const spinner = ora('Fetching user profile...').start();
    const username = await getAuthenticatedUser(octokit);
    spinner.succeed(`Authenticated as ${chalk.green(username)}`);

    // Set output directory
    const backupDir = options.outputDir || username;
    const backupPath = path.resolve(backupDir);

    console.log(chalk.gray(`Backup location: ${backupPath}`));
    console.log(chalk.gray(`Clone method: ${options.method}`));
    console.log(chalk.gray(`Include private: ${options.includePrivate}`));
    console.log(chalk.gray(`Include forks: ${options.includeForks}\n`));

    // Get expected repo count from user profile. NOTE: GitHub's /user endpoint
    // only returns `total_private_repos` for CLASSIC tokens with the `repo`
    // scope. Fine-grained tokens get `undefined` here, so we detect that and
    // avoid the misleading "you have N" comparison.
    const { data: user } = await octokit.rest.users.getAuthenticated();
    const expectedPublic = user.public_repos || 0;
    const expectedPrivateRaw = user.total_private_repos;
    const privateCountKnown = typeof expectedPrivateRaw === 'number';
    const expectedPrivate = privateCountKnown ? expectedPrivateRaw : 0;
    const expectedTotal = expectedPublic + expectedPrivate;

    // Fetch repositories
    const reposSpinner = ora('Fetching repositories...').start();
    const {
      repos,
      totalFetched,
      forksFiltered,
      privateFiltered,
      pagesFetched,
      publicCount,
      privateCount,
      ownerBreakdown,
    } = await fetchAllRepos(octokit, options);
    reposSpinner.succeed(`Found ${chalk.green(repos.length)} repositories to backup`);

    // Show filtering details
    console.log(chalk.gray(`  Pages fetched: ${pagesFetched}`));
    console.log(chalk.gray(`  Backing up: ${repos.length} (${publicCount} public, ${privateCount} private)`));

    // Owner breakdown — shows whether repos are under your user or orgs.
    const owners = Object.entries(ownerBreakdown).sort((a, b) => b[1] - a[1]);
    if (owners.length === 1) {
      console.log(chalk.gray(`  All under: ${owners[0][0]}`));
    } else if (owners.length > 1) {
      console.log(chalk.gray(`  Owners: ${owners.map(([o, n]) => `${o} (${n})`).join(', ')}`));
    }

    // Explain the relationship to GitHub's profile counter. When the private
    // count is unknown (fine-grained token), say so explicitly instead of
    // showing a misleading total.
    if (privateCountKnown) {
      console.log(chalk.gray(`  GitHub profile says you own: ${expectedTotal} (${expectedPublic} public, ${expectedPrivate} private)`));
      if (totalFetched < expectedTotal) {
        console.log(chalk.yellow(`  ⚠️  Fetched ${totalFetched} but profile expects ${expectedTotal}.`));
        console.log(chalk.yellow(`     Your token may lack 'repo' scope, or repos are in orgs needing extra access.`));
      }
    } else {
      console.log(chalk.gray(`  GitHub profile: ${expectedPublic} public repos visible`));
      console.log(chalk.gray(`  (Private count unavailable — fine-grained tokens can't read the private-repo counter.`));
      console.log(chalk.gray(`   All accessible private repos are still included in the backup above.)`));
    }

    if (forksFiltered > 0) {
      console.log(chalk.yellow(`  Skipped forks: ${forksFiltered} (use --include-forks to backup)`));
    }
    if (privateFiltered > 0) {
      console.log(chalk.yellow(`  Skipped private: ${privateFiltered} (use --include-private to backup)`));
    }
    console.log();

    if (repos.length === 0) {
      console.log(chalk.yellow('\nNo repositories found matching your criteria.'));
      if (forksFiltered > 0 && !options.includeForks) {
        console.log(chalk.yellow(`Tip: You have ${forksFiltered} forked repo(s). Use --include-forks to backup forks too.`));
      }
      if (privateFiltered > 0 && !options.includePrivate) {
        console.log(chalk.yellow(`Tip: You have ${privateFiltered} private repo(s). Use --include-private to backup private repos.`));
      }
      return;
    }

    // Display repository list
    displayRepoList(repos);

    if (options.dryRun) {
      console.log(chalk.yellow('\n🏃 Dry run mode - no repositories were cloned.\n'));
      return;
    }

    // Create backup directory
    ensureDirectory(backupPath);
    console.log(chalk.green(`\n📁 Backup directory: ${backupDir}`));

    // Clone/update repositories
    console.log(chalk.bold('\n⬇️  Backing up repositories...\n'));
    
    const stats = {
      successCount: 0,
      errorCount: 0,
      updateCount: 0,
    };

    for (let i = 0; i < repos.length; i++) {
      const repo = repos[i];
      const repoPath = path.join(backupPath, repo.name);
      const progress = chalk.gray(`[${i + 1}/${repos.length}]`);
      
      const result = await cloneOrUpdateRepo(repo, repoPath, options, progress, i, repos.length);
      
      switch (result.status) {
        case 'cloned':
          stats.successCount++;
          break;
        case 'updated':
          stats.updateCount++;
          break;
        case 'error':
          stats.errorCount++;
          break;
      }
    }

    // Summary
    displaySummary(stats, options.updateExisting, backupPath);

  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : typeof error === 'string' ? error : 'Unknown error';
    if (message.includes('Bad credentials')) {
      console.error(chalk.red('\n❌ Invalid GitHub token. Please check your token and try again.\n'));
    } else {
      console.error(chalk.red(`\n❌ Error: ${message}\n`));
    }
    process.exit(1);
  }
}

export function createConfigCommands(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Manage gitlo configuration (token and default output directory)');

  configCmd
    .command('set')
    .description('Set a configuration value')
    .argument('<key>', 'Configuration key (token, output-dir, or branch-strategy)')
    .argument('<value>', 'Value to set')
    .action((key: string, value: string) => {
      const resolvedKey = assertConfigKey(key);

      // Validate branch-strategy values.
      if (resolvedKey === 'branchStrategy' && value !== 'default' && value !== 'all') {
        console.error(chalk.red(`❌ Invalid branch-strategy: ${value}`));
        console.log(chalk.gray('Valid values: default, all'));
        process.exit(1);
      }

      const storedValue = resolvedKey === 'outputDir' ? expandPath(value) : value;
      setConfig(resolvedKey, storedValue);

      const messages: Record<string, string> = {
        githubToken: '✓ GitHub token saved',
        outputDir: '✓ Default output directory saved',
        branchStrategy: `✓ Branch strategy set to '${value}'`,
      };
      console.log(chalk.green(messages[resolvedKey]));
      console.log(chalk.gray(`Config file: ~/.gitlo/config.json`));
    });

  configCmd
    .command('get')
    .description('Get a configuration value')
    .argument('<key>', 'Configuration key (token, output-dir, or branch-strategy)')
    .action((key: string) => {
      const resolvedKey = assertConfigKey(key);
      const value = getConfig(resolvedKey);

      if (value) {
        const display = resolvedKey === 'githubToken' ? maskToken(value) : value;
        console.log(chalk.green(`${key}: ${display}`));
      } else {
        console.log(chalk.yellow(`${key}: not set`));
      }
    });

  configCmd
    .command('remove')
    .description('Remove a configuration value')
    .argument('<key>', 'Configuration key (token, output-dir, or branch-strategy)')
    .action((key: string) => {
      const resolvedKey = assertConfigKey(key);
      removeConfig(resolvedKey);
      const messages: Record<string, string> = {
        githubToken: '✓ GitHub token removed',
        outputDir: '✓ Default output directory removed',
        branchStrategy: '✓ Branch strategy reset to default',
      };
      console.log(chalk.green(messages[resolvedKey]));
    });

  configCmd
    .command('list')
    .description('List all configuration values')
    .action(() => {
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
      
      console.log(chalk.gray(`\nConfig file: ~/.gitlo/config.json\n`));
    });
}

export function createScheduleCommands(program: Command): void {
  const scheduleCmd = program
    .command('schedule')
    .description('Schedule automatic backups with cron');

  scheduleCmd
    .command('setup')
    .description('Set up automatic backups')
    .option('-f, --frequency <freq>', 'Backup frequency: hourly, daily, weekly, monthly', 'weekly')
    .option('-t, --time <time>', 'Time for daily/weekly/monthly (HH:MM format)', '02:00')
    .option('-d, --day <day>', 'Day of week for weekly (0-6, 0=Sunday)', '0')
    .option('--full', 'Clone all repos instead of updating existing (default: update existing)', false)
    .option('-l, --log <path>', 'Log file path', '~/.gitlo/backup.log')
    .action((cmdOptions) => {
      const schedule: CronSchedule = {
        frequency: cmdOptions.frequency,
        time: cmdOptions.time,
        dayOfWeek: parseInt(cmdOptions.day),
        updateOnly: !cmdOptions.full,
      };

      const logFile = cmdOptions.log.replace(/^~/, os.homedir());

      console.log(chalk.bold.blue('\n📅 Schedule Automatic Backups\n'));
      console.log(chalk.gray(`Frequency: ${formatSchedule(schedule)}`));
      console.log(chalk.gray(`Update only: ${!cmdOptions.full ? 'Yes (default)' : 'No (full backup)'}`));
      console.log(chalk.gray(`Log file: ${logFile}\n`));

      if (addCronJob(schedule, logFile)) {
        console.log(chalk.green('✓ Automatic backup scheduled successfully!'));
        console.log(chalk.gray(`Cron expression: ${getCronExpression(schedule)}`));
        console.log(chalk.gray(`\nTo view scheduled jobs: gitlo schedule list`));
        console.log(chalk.gray(`To remove: gitlo schedule remove\n`));
      } else {
        console.error(chalk.red('❌ Failed to schedule backup'));
        process.exit(1);
      }
    });

  scheduleCmd
    .command('list')
    .description('List scheduled backup jobs')
    .action(() => {
      console.log(chalk.bold('\n📋 Scheduled Backup Jobs\n'));

      const jobs = listCronJobs();
      if (jobs.length === 0) {
        console.log(chalk.yellow('No scheduled backups found.'));
        console.log(chalk.gray('Run: gitlo schedule setup'));
      } else {
        jobs.forEach((job: string, i: number) => {
          console.log(`  ${i + 1}. ${chalk.cyan(job)}`);
        });
      }
      console.log();
    });

  scheduleCmd
    .command('remove')
    .description('Remove scheduled backup')
    .action(() => {
      console.log(chalk.bold('\n🗑️  Remove Scheduled Backup\n'));

      if (removeCronJob()) {
        console.log(chalk.green('✓ Scheduled backup removed successfully!\n'));
      } else {
        console.error(chalk.red('❌ Failed to remove scheduled backup\n'));
        process.exit(1);
      }
    });
}
