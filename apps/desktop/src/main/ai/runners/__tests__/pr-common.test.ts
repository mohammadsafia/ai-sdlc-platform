import { describe, it, expect, vi, beforeEach } from 'vitest';

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync }));
vi.mock('../../client/factory', () => ({ createSimpleClient: vi.fn() }));

import { basicAuthHeader, isAuthPushError, pushBranch } from '../pr-common';

const authFail = () => Object.assign(new Error('fail'), { stderr: 'fatal: Authentication failed for https://bitbucket.org/acme/todo.git' });

beforeEach(() => vi.clearAllMocks());

describe('pushBranch', () => {
  it('pushes with upstream and returns undefined on success', () => {
    execFileSync.mockReturnValue('');
    expect(pushBranch('/wt', 'git', 'auto-claude/001-x')).toBeUndefined();
    expect(execFileSync).toHaveBeenCalledWith('git', ['push', '--set-upstream', 'origin', 'auto-claude/001-x'], expect.objectContaining({ cwd: '/wt' }));
  });

  it('retries once with the auth header on an HTTPS auth failure', () => {
    execFileSync.mockImplementationOnce(() => { throw authFail(); }).mockReturnValueOnce('');
    const auth = { remoteUrl: 'https://bitbucket.org/acme/todo.git', header: basicAuthHeader('a@b.c', 'tok') };
    expect(pushBranch('/wt', 'git', 'b', auth)).toBeUndefined();
    expect(execFileSync).toHaveBeenCalledTimes(2);
    expect(execFileSync.mock.calls[1][1]).toEqual(['-c', `http.extraheader=${auth.header}`, 'push', '--set-upstream', 'origin', 'b']);
  });

  it('does not retry for SSH remotes or non-auth errors', () => {
    execFileSync.mockImplementation(() => { throw authFail(); });
    expect(pushBranch('/wt', 'git', 'b', { remoteUrl: 'git@bitbucket.org:acme/todo.git', header: 'x' })).toContain('Authentication failed');
    expect(execFileSync).toHaveBeenCalledTimes(1);
    execFileSync.mockImplementation(() => { throw Object.assign(new Error('x'), { stderr: 'error: failed to push some refs' }); });
    expect(pushBranch('/wt', 'git', 'b', { remoteUrl: 'https://bitbucket.org/acme/todo.git', header: 'x' })).toContain('failed to push');
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });
});

describe('helpers', () => {
  it('builds the basic auth header and classifies auth errors', () => {
    expect(basicAuthHeader('a@b.c', 'tok')).toBe(`Authorization: Basic ${Buffer.from('a@b.c:tok').toString('base64')}`);
    expect(isAuthPushError('fatal: Authentication failed')).toBe(true);
    expect(isAuthPushError('could not read Username for')).toBe(true);
    expect(isAuthPushError('The requested URL returned error: 403')).toBe(true);
    expect(isAuthPushError('rejected: non-fast-forward')).toBe(false);
  });
});
