import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Config } from './types.js';

const CONFIG_DIR = path.join(os.homedir(), '.gitlo');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

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
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getConfig(key: keyof Config): string | undefined {
  return readConfig()[key];
}

export function setConfig(key: keyof Config, value: string): void {
  const config = readConfig();
  config[key] = value;
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
