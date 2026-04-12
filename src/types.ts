export interface RepoInfo {
  name: string;
  cloneUrl: string;
  sshUrl: string;
  isPrivate: boolean;
  description: string | null;
  updatedAt: string | null;
}

export interface BackupOptions {
  token?: string;
  outputDir?: string;
  method: 'https' | 'ssh';
  includePrivate: boolean;
  includeForks: boolean;
  dryRun: boolean;
  updateExisting: boolean;
  verbose?: boolean;
}

export interface Config {
  githubToken?: string;
  outputDir?: string;
}
