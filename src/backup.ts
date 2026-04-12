import simpleGit from 'simple-git';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import type { RepoInfo, BackupOptions } from './types.js';

interface BackupStats {
  successCount: number;
  errorCount: number;
  updateCount: number;
}

export async function cloneOrUpdateRepo(
  repo: RepoInfo,
  repoPath: string,
  options: BackupOptions,
  progress: string,
  index: number,
  total: number
): Promise<{ status: 'cloned' | 'updated' | 'skipped' | 'error'; error?: string }> {
  const repoSpinner = ora(`${progress} Processing ${repo.name}...`).start();

  try {
    if (fs.existsSync(repoPath)) {
      if (options.updateExisting) {
        repoSpinner.text = `${progress} Updating ${repo.name}...`;
        const git = simpleGit(repoPath);
        await git.pull('origin', 'main').catch(async () => {
          // Try master if main fails
          await git.pull('origin', 'master');
        });
        repoSpinner.succeed(`${progress} ${chalk.green('✓')} Updated ${chalk.white(repo.name)}`);
        return { status: 'updated' };
      } else {
        repoSpinner.warn(`${progress} ${chalk.yellow('⚠')} ${repo.name} already exists (use --update to pull changes)`);
        return { status: 'skipped' };
      }
    } else {
      repoSpinner.text = `${progress} Cloning ${repo.name}...`;
      const cloneUrl = options.method === 'ssh' ? repo.sshUrl : repo.cloneUrl;
      const parentDir = path.dirname(repoPath);
      await simpleGit(parentDir).clone(cloneUrl, repoPath);
      repoSpinner.succeed(`${progress} ${chalk.green('✓')} Cloned ${chalk.white(repo.name)}`);
      return { status: 'cloned' };
    }
  } catch (error) {
    repoSpinner.fail(`${progress} ${chalk.red('✗')} Failed to process ${repo.name}`);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(chalk.red(`    Error: ${errorMessage}`));
    return { status: 'error', error: errorMessage };
  }
}

export function displayRepoList(repos: RepoInfo[]): void {
  console.log(chalk.bold('\n📋 Repositories to backup:\n'));
  repos.forEach((repo, i) => {
    const privacy = repo.isPrivate ? chalk.red('🔒') : chalk.green('🌐');
    console.log(`  ${i + 1}. ${privacy} ${chalk.white(repo.name)}`);
    if (repo.description) {
      console.log(`     ${chalk.gray(repo.description)}`);
    }
  });
}

export function displaySummary(
  stats: BackupStats,
  updateExisting: boolean,
  backupPath: string
): void {
  console.log(chalk.bold('\n📊 Backup Summary\n'));
  console.log(`  ${chalk.green('✓')} Successfully cloned: ${stats.successCount}`);
  if (updateExisting) {
    console.log(`  ${chalk.blue('↻')} Updated: ${stats.updateCount}`);
  }
  if (stats.errorCount > 0) {
    console.log(`  ${chalk.red('✗')} Failed: ${stats.errorCount}`);
  }
  console.log(`\n  ${chalk.bold('Location:')} ${chalk.cyan(backupPath)}\n`);
}

export function ensureDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
