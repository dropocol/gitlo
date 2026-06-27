import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import chalk from 'chalk';

const REGISTRY_URL = 'https://registry.npmjs.org/gitlo/latest';
const CACHE_FILE = path.join(os.homedir(), '.gitlo', '.update-check');
// How often to actually hit the registry (24h). Within this window we reuse
// the cached result so we don't spam npm on every invocation.
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateInfo {
  latestVersion: string;
  currentVersion: string;
  hasUpdate: boolean;
}

/** Compare two semver strings (x.y.z). Returns 1 if a > b, -1 if a < b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const parts = v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
    // Pad to 3 components so '1.0' compares as '1.0.0'.
    while (parts.length < 3) parts.push(0);
    return parts;
  };
  const [aMajor, aMinor, aPatch] = parse(a);
  const [bMajor, bMinor, bPatch] = parse(b);
  if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1;
  if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1;
  if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1;
  return 0;
}

/** Read the cached check result. Returns null if missing, stale, or invalid. */
function readCache(): { latestVersion: string; checkedAt: number } | null {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (typeof data.latestVersion === 'string' && typeof data.checkedAt === 'number') {
      return data;
    }
  } catch {
    // Missing or corrupt cache — treat as a miss.
  }
  return null;
}

/** Persist the latest known version + timestamp so we don't re-check too often. */
function writeCache(latestVersion: string): void {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ latestVersion, checkedAt: Date.now() }), { mode: 0o600 });
  } catch {
    // Caching is best-effort; never let it break the CLI.
  }
}

/** Fetch the latest published version from the npm registry. Rejects on error. */
function fetchLatestVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(REGISTRY_URL, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (typeof data.version === 'string') {
            resolve(data.version);
          } else {
            reject(new Error('No version in registry response'));
          }
        } catch (err) {
          reject(err as Error);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.on('error', reject);
  });
}

/**
 * Check whether a newer version exists. Uses the daily cache to avoid hitting
 * the registry on every run. Returns null if the check should be skipped
 * (within cache window) or fails — callers treat null as "no info available".
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  const cached = readCache();

  // Within the cache window: reuse the cached result without a network call.
  if (cached && Date.now() - cached.checkedAt < CHECK_INTERVAL_MS) {
    const hasUpdate = compareVersions(cached.latestVersion, currentVersion) > 0;
    return { latestVersion: cached.latestVersion, currentVersion, hasUpdate };
  }

  // Cache stale or missing — fetch fresh. On any failure, fall back to the
  // stale cache if we have one, else give up silently.
  try {
    const latestVersion = await fetchLatestVersion();
    writeCache(latestVersion);
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;
    return { latestVersion, currentVersion, hasUpdate };
  } catch {
    if (cached) {
      const hasUpdate = compareVersions(cached.latestVersion, currentVersion) > 0;
      return { latestVersion: cached.latestVersion, currentVersion, hasUpdate };
    }
    return null;
  }
}

/**
 * Print the update status. Shows an "update available" banner when a newer
 * version exists, or a brief "on latest" confirmation when current. Safe to
 * call — does nothing if stdout isn't a TTY. Returns null silently if there
 * is no update info available (e.g. network failed).
 */
export function printUpdateBanner(info: UpdateInfo): void {
  // Only show in an interactive terminal, never in CI/pipes.
  if (!process.stdout.isTTY) return;

  if (info.hasUpdate) {
    const line = '─'.repeat(52);
    console.log();
    console.log(chalk.cyan(`┌${line}┐`));
    console.log(chalk.cyan('│') + chalk.yellow.bold('  A new version of gitlo is available!'.padEnd(52)) + chalk.cyan('│'));
    console.log(chalk.cyan('│') + chalk.gray(`  Current: ${info.currentVersion}   →   Latest: ${chalk.green.bold(info.latestVersion)}`.padEnd(52)) + chalk.cyan('│'));
    console.log(chalk.cyan('│') + chalk.gray('  Run: npm install -g gitlo@latest'.padEnd(52)) + chalk.cyan('│'));
    console.log(chalk.cyan('│') + chalk.gray('  (or: gitlo update)'.padEnd(52)) + chalk.cyan('│'));
    console.log(chalk.cyan(`└${line}┘`));
    console.log();
  } else {
    // Confirms the check ran and the user is up to date.
    console.log(chalk.gray(`gitlo ${info.currentVersion} — up to date ✓`));
    console.log();
  }
}

/**
 * Detect whether gitlo was installed globally via npm. Returns the npm
 * executable name ('npm') or null if it can't be determined.
 */
function detectPackageManager(): string | null {
  try {
    execSync('npm --version', { stdio: 'ignore' });
    return 'npm';
  } catch {
    return null;
  }
}

/**
 * Self-update gitlo by running the global install. Returns true on success.
 * Streams the installer output so the user sees progress.
 */
export function selfUpdate(): boolean {
  const pm = detectPackageManager();
  if (!pm) {
    console.error(chalk.red('❌ Could not find npm. Update manually:'));
    console.error(chalk.gray('   npm install -g gitlo@latest'));
    return false;
  }

  console.log(chalk.blue(`\n🔄 Updating gitlo via ${pm}...\n`));
  try {
    execSync(`${pm} install -g gitlo@latest`, { stdio: 'inherit' });
    console.log(chalk.green('\n✓ gitlo updated successfully!\n'));
    return true;
  } catch {
    console.error(chalk.red('\n❌ Update failed. You can update manually:'));
    console.error(chalk.gray(`   ${pm} install -g gitlo@latest\n`));
    return false;
  }
}
