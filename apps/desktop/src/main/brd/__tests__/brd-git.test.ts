import { describe, it, expect, vi, beforeEach } from 'vitest';

const { execFileSync, pushBranch } = vi.hoisted(() => ({ execFileSync: vi.fn(), pushBranch: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync }));
vi.mock('../../ai/runners/pr-common', () => ({ pushBranch }));
vi.mock('../../cli-tool-manager', () => ({ getToolPath: () => 'git' }));

import { brdChanges, commitBrd, parsePorcelain } from '../brd-git';

const calls = () => execFileSync.mock.calls.map((c) => (c[1] as string[]).join(' '));

beforeEach(() => vi.clearAllMocks());

describe('parsePorcelain', () => {
  it('maps status codes and renames', () => {
    expect(parsePorcelain(' M docs/brd/a.md\n?? docs/brd/b.md\nA  docs/brd/c.md\n D docs/brd/d.md\nR  docs/brd/e.md -> docs/brd/f.md\nMM docs/brd/g.md\n')).toEqual([
      { path: 'docs/brd/a.md', status: 'modified' },
      { path: 'docs/brd/b.md', status: 'untracked' },
      { path: 'docs/brd/c.md', status: 'added' },
      { path: 'docs/brd/d.md', status: 'deleted' },
      { path: 'docs/brd/f.md', status: 'modified' },
      { path: 'docs/brd/g.md', status: 'modified' },
    ]);
  });
});

describe('brdChanges', () => {
  it('returns the branch and files scoped to docs/brd', () => {
    execFileSync.mockReturnValueOnce('true\n').mockReturnValueOnce('develop\n').mockReturnValueOnce(' M docs/brd/a.md\n');
    expect(brdChanges('/repo', 'git')).toEqual({ branch: 'develop', files: [{ path: 'docs/brd/a.md', status: 'modified' }] });
    expect(calls()[2]).toBe('status --porcelain -- docs/brd docs/design');
  });

  it('throws when not a git repository', () => {
    execFileSync.mockImplementationOnce(() => { throw new Error('fatal: not a git repository'); });
    expect(() => brdChanges('/repo', 'git')).toThrow('Not a git repository');
  });
});

describe('commitBrd', () => {
  it('stages docs/brd, commits with the message, pushes, and returns the short hash', async () => {
    execFileSync.mockReturnValueOnce('true\n').mockReturnValueOnce('develop\n').mockReturnValueOnce('').mockReturnValueOnce('').mockReturnValueOnce('abc1234\n');
    pushBranch.mockReturnValue(undefined);
    const auth = { remoteUrl: 'https://bitbucket.org/a/b.git', header: 'Authorization: Basic x' };
    expect(await commitBrd('/repo', 'docs(brd): update a', true, auth, 'git')).toEqual({ commit: 'abc1234', pushed: true });
    expect(calls().slice(2, 5)).toEqual(['add -A -- docs/brd docs/design', 'commit -m docs(brd): update a -- docs/brd docs/design', 'rev-parse --short HEAD']);
    expect(pushBranch).toHaveBeenCalledWith('/repo', 'git', 'develop', auth);
  });

  it('reports a push failure as a warning after committing, and skips the push when asked', async () => {
    execFileSync.mockReturnValueOnce('true\n').mockReturnValueOnce('develop\n').mockReturnValueOnce('').mockReturnValueOnce('').mockReturnValueOnce('abc1234\n');
    pushBranch.mockReturnValue('rejected');
    expect(await commitBrd('/repo', 'm', true, undefined, 'git')).toEqual({ commit: 'abc1234', pushed: false, pushError: 'rejected' });
    execFileSync.mockReturnValueOnce('true\n').mockReturnValueOnce('develop\n').mockReturnValueOnce('').mockReturnValueOnce('').mockReturnValueOnce('abc1234\n');
    expect(await commitBrd('/repo', 'm', false, undefined, 'git')).toEqual({ commit: 'abc1234', pushed: false });
    expect(pushBranch).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty message', async () => {
    await expect(commitBrd('/repo', '   ', false, undefined, 'git')).rejects.toThrow('Commit message is required');
  });
});
