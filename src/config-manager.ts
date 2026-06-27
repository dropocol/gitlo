import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Config } from './types.js';

export const CONFIG_DIR = path.join(os.homedir(), '.gitlo');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export function readConfig(): Config {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {
    // Ignore errors
  }
  return {};
}

export function writeConfig(config: Config): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  // Config file holds the GitHub token, so keep it owner-only (0600).
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(CONFIG_FILE, 0o600);
  } catch {
    // Best effort; some filesystems ignore chmod.
  }
}

export function maskToken(token: string): string {
  if (!token) return '';
  // Keep the readable prefix (e.g. ghp_ / github_pat_) but never leak enough
  // to reconstruct the token. For very short values, don't duplicate content.
  const len = token.length;
  if (len <= 8) return '****';
  const prefix = token.slice(0, 4);
  const suffix = token.slice(-4);
  return `${prefix}****${suffix}`;
}

export function getConfig(key: keyof Config): string | undefined {
  const value = readConfig()[key];
  // configVersion is numeric, but getConfig is only used for string-valued keys.
  return typeof value === 'string' ? value : undefined;
}

export function setConfig(key: keyof Config, value: string): void {
  const config = readConfig();
  (config as Record<string, unknown>)[key] = value;
  writeConfig(config);
}

export function removeConfig(key: keyof Config): void {
  const config = readConfig();
  delete config[key];
  writeConfig(config);
}

export function expandPath(filePath: string): string {
  return filePath.replace(/^~/, os.homedir());
}
