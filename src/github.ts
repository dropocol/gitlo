import { Octokit } from '@octokit/rest';
import chalk from 'chalk';
import type { RepoInfo, BackupOptions } from './types.js';

interface FetchResult {
  repos: RepoInfo[];
  totalFetched: number;
  forksFiltered: number;
  privateFiltered: number;
  pagesFetched: number;
}

export async function fetchAllRepos(
  octokit: Octokit,
  options: BackupOptions
): Promise<FetchResult> {
  const repos: RepoInfo[] = [];
  let page = 1;
  const perPage = 100;
  let totalFetched = 0;
  let forksFiltered = 0;
  let privateFiltered = 0;
  let pagesFetched = 0;

  while (true) {
    const { data, headers } = await octokit.rest.repos.listForAuthenticatedUser({
      per_page: perPage,
      page: page,
      sort: 'updated',
      direction: 'desc',
      affiliation: 'owner,collaborator,organization_member',
    });

    if (data.length === 0) break;

    pagesFetched++;
    totalFetched += data.length;

    if (options.verbose) {
      console.log(chalk.gray(`  Page ${page}: fetched ${data.length} repos`));
    }

    for (const repo of data) {
      // Skip forks if not included
      if (repo.fork && !options.includeForks) {
        forksFiltered++;
        if (options.verbose) {
          console.log(chalk.gray(`    - Skipping fork: ${repo.name}`));
        }
        continue;
      }

      // Skip private repos if not included
      if (repo.private && !options.includePrivate) {
        privateFiltered++;
        if (options.verbose) {
          console.log(chalk.gray(`    - Skipping private: ${repo.name}`));
        }
        continue;
      }

      repos.push({
        name: repo.name,
        cloneUrl: repo.clone_url,
        sshUrl: repo.ssh_url,
        isPrivate: repo.private,
        description: repo.description,
        updatedAt: repo.updated_at,
        defaultBranch: repo.default_branch,
      });
    }

    // Check if we've reached the last page
    const linkHeader = headers?.link;
    if (!linkHeader || !linkHeader.includes('rel="next"')) {
      break;
    }

    if (data.length < perPage) break;
    page++;
  }

  return {
    repos,
    totalFetched,
    forksFiltered,
    privateFiltered,
    pagesFetched,
  };
}

export async function getAuthenticatedUser(octokit: Octokit): Promise<string> {
  const { data: user } = await octokit.rest.users.getAuthenticated();
  return user.login;
}
