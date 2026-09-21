// apps/desktop/src/main/bitbucket/env.ts
import type { ProjectEnvConfig } from '../../shared/types';

export const BITBUCKET_ENV_KEYS = {
  ENABLED: 'BITBUCKET_ENABLED',
  EMAIL: 'BITBUCKET_EMAIL',
  API_TOKEN: 'BITBUCKET_API_TOKEN',
  WORKSPACE: 'BITBUCKET_WORKSPACE',
  REPO_SLUG: 'BITBUCKET_REPO_SLUG',
} as const;

type BitbucketEnvConfig = Pick<ProjectEnvConfig, 'bitbucketEnabled' | 'bitbucketEmail' | 'bitbucketApiToken' | 'bitbucketWorkspace' | 'bitbucketRepoSlug'>;

/** Bitbucket config from parsed .env vars. Enabled when a token exists and BITBUCKET_ENABLED is not "false". */
export function readBitbucketEnv(vars: Record<string, string>): BitbucketEnvConfig {
  const out: BitbucketEnvConfig = { bitbucketEnabled: false };
  const token = vars[BITBUCKET_ENV_KEYS.API_TOKEN]?.trim();
  if (token) {
    out.bitbucketApiToken = token;
    out.bitbucketEnabled = vars[BITBUCKET_ENV_KEYS.ENABLED]?.toLowerCase() !== 'false';
  }
  const email = vars[BITBUCKET_ENV_KEYS.EMAIL]?.trim();
  if (email) out.bitbucketEmail = email;
  const workspace = vars[BITBUCKET_ENV_KEYS.WORKSPACE]?.trim();
  if (workspace) out.bitbucketWorkspace = workspace.toLowerCase();
  const slug = vars[BITBUCKET_ENV_KEYS.REPO_SLUG]?.trim();
  if (slug) out.bitbucketRepoSlug = slug.toLowerCase();
  return out;
}

/** Env var updates for the provided Bitbucket fields only. */
export function bitbucketEnvUpdates(config: Partial<ProjectEnvConfig>): Record<string, string> {
  const u: Record<string, string> = {};
  if (config.bitbucketEnabled !== undefined) u[BITBUCKET_ENV_KEYS.ENABLED] = config.bitbucketEnabled ? 'true' : 'false';
  if (config.bitbucketEmail !== undefined) u[BITBUCKET_ENV_KEYS.EMAIL] = config.bitbucketEmail;
  if (config.bitbucketApiToken !== undefined) u[BITBUCKET_ENV_KEYS.API_TOKEN] = config.bitbucketApiToken;
  if (config.bitbucketWorkspace !== undefined) u[BITBUCKET_ENV_KEYS.WORKSPACE] = config.bitbucketWorkspace.trim().toLowerCase();
  if (config.bitbucketRepoSlug !== undefined) u[BITBUCKET_ENV_KEYS.REPO_SLUG] = config.bitbucketRepoSlug.trim().toLowerCase();
  return u;
}
