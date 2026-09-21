// apps/desktop/src/main/bitbucket/remote.ts
import { execFileSync } from 'node:child_process';

import { type BitbucketRepoRef, parseBitbucketRemote } from '../../shared/bitbucket/remote';
import { getToolPath } from '../cli-tool-manager';
import { getIsolatedGitEnv } from '../utils/git-isolation';

export interface DetectedBitbucketRepo extends BitbucketRepoRef {
  remoteUrl: string;
}

/** Reads `origin` and returns the Bitbucket workspace/slug, or null when origin is missing or not on bitbucket.org. */
export function detectBitbucketRepo(projectPath: string, gitPath: string = getToolPath('git')): DetectedBitbucketRepo | null {
  let remoteUrl: string;
  try {
    remoteUrl = execFileSync(gitPath, ['remote', 'get-url', 'origin'], {
      cwd: projectPath,
      env: getIsolatedGitEnv(),
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
  } catch {
    return null;
  }
  const parsed = parseBitbucketRemote(remoteUrl);
  return parsed ? { ...parsed, remoteUrl } : null;
}
