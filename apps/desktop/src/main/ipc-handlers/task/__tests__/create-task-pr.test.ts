import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTaskPR, type TaskPRDeps } from '../create-task-pr';

vi.mock('../../../ai/runners/github/pr-creator', () => ({ createPR: vi.fn() }));
vi.mock('../../../bitbucket/config', () => ({ getBitbucketConfig: vi.fn() }));
vi.mock('../../../bitbucket/create-pr', () => ({ createBitbucketPR: vi.fn() }));
vi.mock('../../../bitbucket/remote', () => ({ detectBitbucketRepo: vi.fn() }));
vi.mock('../../../cli-tool-manager', () => ({ getToolPath: vi.fn() }));

const deps = (): TaskPRDeps => ({
  detect: vi.fn(() => null),
  getConfig: vi.fn(() => null),
  bitbucket: vi.fn(async () => ({ success: true, prUrl: 'https://bb/1' })),
  github: vi.fn(async () => ({ success: true, prUrl: 'https://gh/1' })),
  toolPath: vi.fn((name: 'gh' | 'git') => `/bin/${name}`),
});
const req = { project: { path: '/p' }, worktreePath: '/wt', specId: '001-x', branchName: 'auto-claude/001-x', baseBranch: 'develop', title: 'T', draft: false };

beforeEach(() => vi.clearAllMocks());

describe('createTaskPR', () => {
  it('uses GitHub for non-Bitbucket origins', async () => {
    const d = deps();
    expect(await createTaskPR(req, d)).toEqual({ success: true, prUrl: 'https://gh/1' });
    expect(d.github).toHaveBeenCalledWith(expect.objectContaining({ ghPath: '/bin/gh', gitPath: '/bin/git', branchName: 'auto-claude/001-x' }));
    expect(d.bitbucket).not.toHaveBeenCalled();
  });

  it('refuses a Bitbucket origin without config and never resolves gh', async () => {
    const d = deps();
    (d.detect as ReturnType<typeof vi.fn>).mockReturnValue({ workspace: 'acme', repoSlug: 'todo', remoteUrl: 'https://bitbucket.org/acme/todo.git' });
    expect(await createTaskPR(req, d)).toEqual({ success: false, error: 'Bitbucket is not configured for this project' });
    expect(d.toolPath).not.toHaveBeenCalledWith('gh');
  });

  it('uses Bitbucket with saved workspace/slug over detected ones', async () => {
    const d = deps();
    (d.detect as ReturnType<typeof vi.fn>).mockReturnValue({ workspace: 'acme', repoSlug: 'todo', remoteUrl: 'https://bitbucket.org/acme/todo.git' });
    (d.getConfig as ReturnType<typeof vi.fn>).mockReturnValue({ email: 'a', apiToken: 't', workspace: 'other', repoSlug: '' });
    expect(await createTaskPR(req, d)).toEqual({ success: true, prUrl: 'https://bb/1' });
    expect(d.bitbucket).toHaveBeenCalledWith(expect.objectContaining({ workspace: 'other', repoSlug: 'todo', remoteUrl: 'https://bitbucket.org/acme/todo.git', gitPath: '/bin/git' }));
  });
});
