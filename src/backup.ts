import simpleGit, { SimpleGit } from 'simple-git';
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

/**
 * Strip any embedded credentials from a git remote URL.
 * `https://token@github.com/...` -> `https://github.com/...`
 */
function stripCredentialsFromUrl(url: string): string {
  return url.replace(/^(https?:\/\/)[^/@]+@/, '$1').trim();
}

/**
 * Inject a token into an HTTPS clone URL for authentication.
 */
function withToken(url: string, token: string): string {
  return url.replace('https://', `https://${token}@`);
}

/**
 * Reset the repo's origin remote to a clean (token-free) URL.
 * Used in finally blocks so a token never lingers in .git/config.
 */
async function resetRemoteToCleanUrl(repoPath: string, cleanUrl: string): Promise<void> {
  try {
    await simpleGit(repoPath).remote(['set-url', 'origin', cleanUrl]);
  } catch {
    // Best effort — repo may be in a bad state.
  }
}

/**
 * Fast-forward a single branch to its remote counterpart.
 * Creates a local tracking branch if it doesn't exist yet.
 * Silent on failure — this is best-effort for backup completeness.
 */
async function fastForwardBranch(git: SimpleGit, branch: string): Promise<void> {
  const remoteRef = `origin/${branch}`;
  try {
    const localBranches = await git.branchLocal();
    if (!localBranches.all.includes(branch)) {
      // Branch doesn't exist locally yet — create a tracking branch.
      await git.raw(['branch', '--track', branch, remoteRef]);
      return;
    }
    // Try a fast-forward pull. If it fails (diverged/non-ff), reset hard to
    // match the remote — a backup should mirror the source of truth.
    try {
      await git.pull('origin', branch, { '--ff-only': null });
    } catch {
      await git.checkout(branch).catch(() => {});
      await git.reset(['--hard', remoteRef]);
    }
  } catch {
    // Best effort — skip branches that can't be updated.
  }
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
  const useHttps = options.method === 'https';
  const cleanCloneUrl = stripCredentialsFromUrl(repo.cloneUrl);

  try {
    if (fs.existsSync(repoPath)) {
      if (!options.updateExisting) {
        repoSpinner.warn(`${progress} ${chalk.yellow('⚠')} ${repo.name} already exists (use --update to pull changes)`);
        return { status: 'skipped' };
      }

      repoSpinner.text = `${progress} Updating ${repo.name}...`;
      const git = simpleGit(repoPath);

      // Capture the current remote so we can always restore it, even if the
      // update fails. This prevents a tokenized URL from lingering in config.
      const originalUrlResult = await git.remote(['get-url', 'origin']);
      const originalUrl = typeof originalUrlResult === 'string'
        ? originalUrlResult.trim().replace(/[\n\r\t]/g, '')
        : '';

      let needsRestore = false;
      try {
        if (options.token && useHttps && originalUrl) {
          await git.remote(['set-url', 'origin', withToken(repo.cloneUrl, options.token).trim()]);
          needsRestore = true;
        }

        // Fetch ALL branches and tags so the backup is complete. This always
        // runs regardless of strategy — every ref's history is always backed up.
        await git.fetch(['--all', '--tags', '--prune']);

        if (options.branchStrategy === 'all') {
          // "all" strategy: fast-forward every remote branch so each one's
          // working tree is also materialized/updated locally.
          const allRefs = await git.branch(['-r']);
          const remoteBranches = (allRefs?.all || [])
            .filter((b) => b.startsWith('origin/') && !b.includes('HEAD'))
            .map((b) => b.replace('origin/', '').trim());

          for (const branch of remoteBranches) {
            await fastForwardBranch(git, branch);
          }

          // Leave the repo checked out on its default branch.
          if (repo.defaultBranch) {
            await git.checkout(repo.defaultBranch).catch(() => {});
          }
        } else {
          // "default" strategy: only update the default branch's working tree.
          const defaultBranch = repo.defaultBranch;
          if (defaultBranch) {
            await fastForwardBranch(git, defaultBranch);
          }
        }
      } finally {
        if (needsRestore && originalUrl) {
          await resetRemoteToCleanUrl(repoPath, originalUrl);
        } else if (useHttps && !originalUrl.includes('@')) {
          // Defensive: make sure no token was left behind by any path above.
          await resetRemoteToCleanUrl(repoPath, cleanCloneUrl);
        }
      }

      repoSpinner.succeed(`${progress} ${chalk.green('✓')} Updated ${chalk.white(repo.name)}`);
      return { status: 'updated' };
    }

    // --- Clone path ---
    repoSpinner.text = `${progress} Cloning ${repo.name}...`;
    const cloneUrl = options.method === 'ssh' ? repo.sshUrl : repo.cloneUrl;
    const parentDir = path.dirname(repoPath);
    let tokenWasInjected = false;

    try {
      let effectiveUrl = cloneUrl;
      if (options.token && useHttps) {
        effectiveUrl = withToken(cloneUrl, options.token);
        tokenWasInjected = true;
      }
      await simpleGit(parentDir).clone(effectiveUrl, repoPath);
    } catch (error) {
      // Clean up a half-cloned repo dir so a retry doesn't choke, and so we
      // never leave a tokenized remote sitting in a broken .git/config.
      if (fs.existsSync(repoPath)) {
        try {
          fs.rmSync(repoPath, { recursive: true, force: true });
        } catch {
          // best effort
        }
      }
      throw error;
    } finally {
      // Always scrub the token from the freshly cloned repo's config.
      if (tokenWasInjected) {
        await resetRemoteToCleanUrl(repoPath, cleanCloneUrl);
      }
    }

    repoSpinner.succeed(`${progress} ${chalk.green('✓')} Cloned ${chalk.white(repo.name)}`);
    return { status: 'cloned' };
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
