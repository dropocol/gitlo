import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import { readConfig } from './config-manager.js';

const CRON_COMMENT = '# gitlo-auto-backup';

export interface CronSchedule {
  frequency: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';
  customExpression?: string;
  updateOnly?: boolean;
  time?: string; // For daily/weekly: "HH:MM"
  dayOfWeek?: number; // 0-6 for weekly (0 = Sunday)
}

export function getCronExpression(schedule: CronSchedule): string {
  switch (schedule.frequency) {
    case 'hourly':
      return '0 * * * *';
    case 'daily':
      const [hour, minute] = (schedule.time || '02:00').split(':');
      return `${minute} ${hour} * * *`;
    case 'weekly':
      const [weekHour, weekMinute] = (schedule.time || '02:00').split(':');
      const day = schedule.dayOfWeek ?? 0;
      return `${weekMinute} ${weekHour} * * ${day}`;
    case 'monthly':
      const [monthHour, monthMinute] = (schedule.time || '02:00').split(':');
      return `${monthMinute} ${monthHour} 1 * *`;
    case 'custom':
      return schedule.customExpression || '0 2 * * 0';
    default:
      return '0 2 * * 0'; // Default: Sundays at 2 AM
  }
}

export function getCronCommand(updateOnly = false): string {
  const config = readConfig();
  const gitloPath = execSync('which gitlo', { encoding: 'utf-8' }).trim() || 'gitlo';
  
  let command = `${gitloPath}`;
  
  // Add update flag if specified
  if (updateOnly) {
    command += ' --update';
  }
  
  return command;
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
    
    let fullCommand = command;
    if (logFile) {
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
