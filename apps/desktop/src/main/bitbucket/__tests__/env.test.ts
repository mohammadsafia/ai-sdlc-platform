import { describe, it, expect } from 'vitest';
import { BITBUCKET_ENV_KEYS, bitbucketEnvUpdates, readBitbucketEnv } from '../env';

describe('bitbucket env', () => {
  it('is enabled only with a token and not explicitly disabled', () => {
    expect(readBitbucketEnv({})).toEqual({ bitbucketEnabled: false });
    expect(readBitbucketEnv({ BITBUCKET_API_TOKEN: 't' })).toMatchObject({ bitbucketEnabled: true, bitbucketApiToken: 't' });
    expect(readBitbucketEnv({ BITBUCKET_API_TOKEN: 't', BITBUCKET_ENABLED: 'false' })).toMatchObject({ bitbucketEnabled: false });
  });

  it('reads and trims the remaining fields', () => {
    expect(readBitbucketEnv({ BITBUCKET_API_TOKEN: 't', BITBUCKET_EMAIL: ' a@b.c ', BITBUCKET_WORKSPACE: 'Acme', BITBUCKET_REPO_SLUG: 'todo ' }))
      .toMatchObject({ bitbucketEmail: 'a@b.c', bitbucketWorkspace: 'acme', bitbucketRepoSlug: 'todo' });
  });

  it('serializes only the provided fields', () => {
    expect(bitbucketEnvUpdates({ bitbucketEnabled: true, bitbucketWorkspace: 'Acme' })).toEqual({
      [BITBUCKET_ENV_KEYS.ENABLED]: 'true',
      [BITBUCKET_ENV_KEYS.WORKSPACE]: 'acme',
    });
    expect(bitbucketEnvUpdates({})).toEqual({});
  });
});
