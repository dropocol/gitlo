export interface RepoInfo {
  name: string;
  cloneUrl: string;
  sshUrl: string;
  isPrivate: boolean;
  description: string | null;
  updatedAt: string | null;
  defaultBranch: string | null;
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
  /**
   * How to handle branches when updating an existing repo.
   * - 'default' : fetch all refs, update only the default branch (fast)
   * - 'all'     : fetch all refs and fast-forward every branch (most complete)
   * When cloning for the first time, both strategies fetch all branches;
   * this only affects what gets checked out/updated in the working tree.
   */
  branchStrategy: 'default' | 'all';
}

export interface Config {
  githubToken?: string;
  outputDir?: string;
  branchStrategy?: 'default' | 'all';
  /** Schema version for auto-migration. Absent = v1 (pre-migration). */
  configVersion?: number;
}
