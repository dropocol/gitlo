import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';

export const CRON_COMMENT = '# gitlo-auto-backup';

export interface CronSchedule {
  frequency: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';
  customExpression?: string;
  updateOnly?: boolean;
  time?: string; // For daily/weekly: "HH:MM"
  dayOfWeek?: number; // 0-6 for weekly (0 = Sunday)
}

export function getCronExpression(schedule: CronSchedule): string {
  switch (schedule.frequency) {
    case 'hourly': {
      return '0 * * * *';
    }
    case 'daily': {
      const [hour, minute] = (schedule.time || '02:00').split(':');
      return `${minute} ${hour} * * *`;
    }
    case 'weekly': {
      const [weekHour, weekMinute] = (schedule.time || '02:00').split(':');
      const day = schedule.dayOfWeek ?? 0;
      return `${weekMinute} ${weekHour} * * ${day}`;
    }
    case 'monthly': {
      const [monthHour, monthMinute] = (schedule.time || '02:00').split(':');
      return `${monthMinute} ${monthHour} 1 * *`;
    }
    case 'custom': {
      return schedule.customExpression || '0 2 * * 0';
    }
    default: {
      return '0 2 * * 0'; // Default: Sundays at 2 AM
    }
  }
}

export function getCronCommand(updateOnly = false): string {
  // Use full path to node and the built JS file for cron compatibility
  // Cron has limited PATH, so we can't rely on wrapper scripts
  const nodePath = execSync('which node', { encoding: 'utf-8' }).trim();

  // Get the path to dist/index.js from the current file location
  // After compilation, this file is at dist/cron.js, so we need index.js in the same dir
  const scriptPath = path.join(path.dirname(__filename), 'index.js');

  let command = `${nodePath} ${scriptPath}`;

  // Add update flag if specified
  if (updateOnly) {
    command += ' --update';
    // Scheduled backups always sync EVERY branch so a scheduled run is a
    // complete backup. (Without this, only the default branch's working tree
    // would be updated, even though all branch data is fetched.)
    command += ' --branch-strategy all';
  }

  return command;
}

export interface ParsedCronLine {
  schedule: string;   // the 5-field cron expression
  command: string;    // everything between the schedule and the redirect/comment
  logPath: string | null; // the path in ">> <path> 2>&1", if present
  comment: string;    // trailing comment, e.g. "# gitlo-auto-backup"
}

/**
 * Parse a crontab line into its structural parts. Pure function — no I/O.
 * Returns null if the line is malformed (e.g. fewer than 6 whitespace fields).
 *
 * Example input:
 *   "45 19 * * * /usr/bin/node /path/index.js --update >> /x.log 2>&1 # gitlo-auto-backup"
 * Produces:
 *   { schedule: "45 19 * * *",
 *     command:  "/usr/bin/node /path/index.js --update",
 *     logPath:  "/x.log",
 *     comment:  "# gitlo-auto-backup" }
 */
export function parseCronLine(line: string): ParsedCronLine | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  // First 5 whitespace-separated tokens are the schedule.
  const parts = trimmed.split(/\s+/);
  if (parts.length < 6) return null;
  const schedule = parts.slice(0, 5).join(' ');

  // The remainder is command + optional redirect + optional comment.
  let rest = parts.slice(5).join(' ');

  // Extract trailing comment (everything after the first ' #').
  let comment = '';
  const commentMatch = rest.match(/\s+#\s*.+$/);
  if (commentMatch) {
    comment = commentMatch[0].trim();
    rest = rest.slice(0, commentMatch.index).trim();
  }

  // Extract log redirect ">> <path> 2>&1" (path may be quoted).
  let logPath: string | null = null;
  const logMatch = rest.match(/>>\s+("?'?[^&]+?"?'?)\s+2>&1/);
  if (logMatch) {
    logPath = logMatch[1].replace(/^["']|["']$/g, '').trim();
    rest = rest.slice(0, logMatch.index).trim();
  }

  return { schedule, command: rest.trim(), logPath, comment };
}

export function listCronJobs(): string[] {
  try {
    const currentCrontab = execSync('crontab -l', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    return currentCrontab.split('\n').filter(line => line.includes(CRON_COMMENT));
  } catch {
    return [];
  }
}

export function getAllCronLines(): string[] {
  try {
    const currentCrontab = execSync('crontab -l', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    return currentCrontab.split('\n');
  } catch {
    return [];
  }
}

export function addCronJob(schedule: CronSchedule, logFile?: string): boolean {
  try {
    const cronExpression = getCronExpression(schedule);
    const command = getCronCommand(schedule.updateOnly);

    // Validate the log file path. Cron lines are newline-delimited, so a
    // newline in the path would inject an extra cron entry. Spaces and shell
    // metacharacters also need quoting.
    let fullCommand = command;
    if (logFile) {
      if (/\s/.test(logFile) && !/^['"]/.test(logFile)) {
        // Quote paths containing whitespace.
        logFile = `"${logFile}"`;
      }
      if (/[\n\r]/.test(logFile)) {
        throw new Error('Log file path must not contain newlines');
      }
      fullCommand += ` >> ${logFile} 2>&1`;
    }

    const cronLine = `${cronExpression} ${fullCommand} ${CRON_COMMENT}`;
    
    // Get existing crontab
    let currentLines: string[] = [];
    try {
      const currentCrontab = execSync('crontab -l', { encoding: 'utf-8' });
      currentLines = currentCrontab.split('\n').filter(line => line.trim());
    } catch {
      // No existing crontab, that's fine
    }
    
    // Remove any existing gitlo jobs
    const filteredLines = currentLines.filter(line => !line.includes(CRON_COMMENT));
    
    // Add new job
    filteredLines.push(cronLine);
    
    // Write new crontab
    const newCrontab = filteredLines.join('\n') + '\n';
    const tempFile = path.join(os.tmpdir(), `gitlo-cron-${Date.now()}`);
    fs.writeFileSync(tempFile, newCrontab);
    
    execSync(`crontab ${tempFile}`);
    fs.unlinkSync(tempFile);
    
    return true;
  } catch (error) {
    console.error(chalk.red('Error setting up cron job:'), error);
    return false;
  }
}

export function removeCronJob(): boolean {
  try {
    let currentLines: string[] = [];
    try {
      const currentCrontab = execSync('crontab -l', { encoding: 'utf-8' });
      currentLines = currentCrontab.split('\n').filter(line => line.trim());
    } catch {
      return true; // No crontab exists, nothing to remove
    }
    
    // Remove gitlo jobs
    const filteredLines = currentLines.filter(line => !line.includes(CRON_COMMENT));
    
    // Write new crontab
    const newCrontab = filteredLines.join('\n') + '\n';
    const tempFile = path.join(os.tmpdir(), `gitlo-cron-${Date.now()}`);
    fs.writeFileSync(tempFile, newCrontab);
    
    execSync(`crontab ${tempFile}`);
    fs.unlinkSync(tempFile);
    
    return true;
  } catch (error) {
    console.error(chalk.red('Error removing cron job:'), error);
    return false;
  }
}

export function formatSchedule(schedule: CronSchedule): string {
  switch (schedule.frequency) {
    case 'hourly':
      return 'Every hour';
    case 'daily':
      return `Daily at ${schedule.time || '02:00'}`;
    case 'weekly':
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return `Weekly on ${days[schedule.dayOfWeek ?? 0]} at ${schedule.time || '02:00'}`;
    case 'monthly':
      return `Monthly on the 1st at ${schedule.time || '02:00'}`;
    case 'custom':
      return `Custom: ${schedule.customExpression}`;
    default:
      return 'Unknown';
  }
}
