import { describe, it, expect, vi, beforeEach } from 'vitest';

const common = vi.hoisted(() => ({
  pushBranch: vi.fn(),
  gatherPRContext: vi.fn(() => ({ diffSummary: 'd', commitLog: 'c' })),
  generatePRBody: vi.fn(async (): Promise<string | null> => 'AI body'),
  extractSpecSummary: vi.fn(() => 'Spec body'),
  basicAuthHeader: vi.fn(() => 'Authorization: Basic x'),
}));
vi.mock('../../ai/runners/pr-common', () => common);

const client = vi.hoisted(() => ({ findOpenPullRequest: vi.fn(), createPullRequest: vi.fn() }));
vi.mock('../client', () => ({ createBitbucketClient: () => client }));

import { createBitbucketPR } from '../create-pr';

const cfg = {
  projectDir: '/p', worktreePath: '/wt', specId: '001-x', branchName: 'auto-claude/001-x', baseBranch: 'origin/develop', title: 'T',
  gitPath: 'git', config: { email: 'a@b.c', apiToken: 'tok', workspace: '', repoSlug: '' }, workspace: 'acme', repoSlug: 'todo', remoteUrl: 'https://bitbucket.org/acme/todo.git',
};

beforeEach(() => {
  vi.clearAllMocks();
  common.pushBranch.mockReturnValue(undefined);
  client.findOpenPullRequest.mockResolvedValue(null);
  client.createPullRequest.mockResolvedValue({ id: 3, url: 'https://bitbucket.org/acme/todo/pull-requests/3' });
});

describe('createBitbucketPR', () => {
  it('pushes with auth, strips origin/ from the destination, and returns the PR url', async () => {
    const r = await createBitbucketPR(cfg);
    expect(r).toEqual({ success: true, prUrl: 'https://bitbucket.org/acme/todo/pull-requests/3', alreadyExists: false });
    expect(common.pushBranch).toHaveBeenCalledWith('/wt', 'git', 'auto-claude/001-x', { remoteUrl: cfg.remoteUrl, header: 'Authorization: Basic x' });
    expect(client.createPullRequest).toHaveBeenCalledWith('acme', 'todo', { title: 'T', description: 'AI body', sourceBranch: 'auto-claude/001-x', destinationBranch: 'develop' });
  });

  it('returns the existing PR when one is open for the branch', async () => {
    client.findOpenPullRequest.mockResolvedValue({ id: 1, url: 'https://x/1' });
    expect(await createBitbucketPR(cfg)).toEqual({ success: true, prUrl: 'https://x/1', alreadyExists: true });
    expect(client.createPullRequest).not.toHaveBeenCalled();
  });

  it('fails on push errors and surfaces API errors', async () => {
    common.pushBranch.mockReturnValue('denied');
    expect(await createBitbucketPR(cfg)).toEqual({ success: false, error: 'Failed to push branch: denied' });
    common.pushBranch.mockReturnValue(undefined);
    client.createPullRequest.mockRejectedValue(new Error('destination: Branch not found'));
    expect(await createBitbucketPR(cfg)).toEqual({ success: false, error: 'destination: Branch not found' });
  });

  it('uses the spec summary when the AI body is empty', async () => {
    common.generatePRBody.mockResolvedValueOnce(null);
    await createBitbucketPR(cfg);
    expect(client.createPullRequest.mock.calls[0][2].description).toBe('Spec body');
  });
});
