// apps/desktop/src/main/bitbucket/config.ts
import { loadProjectEnvVars } from '../ipc-handlers/context/utils';
import { readBitbucketEnv } from './env';

export interface BitbucketProjectConfig {
  email: string;
  apiToken: string;
  /** May be blank; callers fall back to detectBitbucketRepo(). */
  workspace: string;
  repoSlug: string;
}

/** Resolved Bitbucket config for a project, or null when disabled or missing credentials. */
export function getBitbucketConfig(project: { path: string; autoBuildPath?: string }): BitbucketProjectConfig | null {
  const env = readBitbucketEnv(loadProjectEnvVars(project.path, project.autoBuildPath));
  if (!env.bitbucketEnabled || !env.bitbucketEmail || !env.bitbucketApiToken) return null;
  return {
    email: env.bitbucketEmail,
    apiToken: env.bitbucketApiToken,
    workspace: env.bitbucketWorkspace ?? '',
    repoSlug: env.bitbucketRepoSlug ?? '',
  };
}
