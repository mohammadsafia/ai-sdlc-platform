import { describe, it, expect, vi, beforeEach } from 'vitest';

const { handlers, getProject, cfg, client, detect } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getProject: vi.fn(),
  cfg: { getBitbucketConfig: vi.fn() },
  client: { user: vi.fn(), repository: vi.fn() },
  detect: vi.fn(),
}));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn((c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn)) } }));
vi.mock('../../project-store', () => ({ projectStore: { getProject } }));
vi.mock('../../bitbucket/config', () => cfg);
vi.mock('../../bitbucket/client', () => ({ createBitbucketClient: () => client }));
vi.mock('../../bitbucket/remote', () => ({ detectBitbucketRepo: detect }));

import { registerBitbucketHandlers } from '../bitbucket';

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  getProject.mockReturnValue({ id: 'p1', path: '/repo' });
  registerBitbucketHandlers();
});

describe('bitbucket handlers', () => {
  it('checkConnection reports the user and repository', async () => {
    cfg.getBitbucketConfig.mockReturnValue({ email: 'a', apiToken: 't', workspace: 'acme', repoSlug: 'todo' });
    client.user.mockResolvedValue({ displayName: 'Ann' });
    client.repository.mockResolvedValue({ name: 'Todo', fullName: 'acme/todo' });
    expect(await handlers.get('bitbucket:checkConnection')!({}, 'p1')).toEqual({ success: true, data: { accountName: 'Ann', repoName: 'acme/todo' } });
    expect(detect).not.toHaveBeenCalled();
  });

  it('checkConnection falls back to detection for the repo and reports errors', async () => {
    cfg.getBitbucketConfig.mockReturnValue({ email: 'a', apiToken: 't', workspace: '', repoSlug: '' });
    detect.mockReturnValue({ workspace: 'acme', repoSlug: 'todo', remoteUrl: 'u' });
    client.user.mockResolvedValue({ displayName: 'Ann' });
    client.repository.mockRejectedValue(new Error('Bitbucket request failed with HTTP 404'));
    expect(await handlers.get('bitbucket:checkConnection')!({}, 'p1')).toEqual({ success: false, error: 'Bitbucket request failed with HTTP 404' });
    expect(client.repository).toHaveBeenCalledWith('acme', 'todo');
  });

  it('checkConnection refuses when not configured; detectRepo returns the parsed remote or null', async () => {
    cfg.getBitbucketConfig.mockReturnValue(null);
    expect(await handlers.get('bitbucket:checkConnection')!({}, 'p1')).toEqual({ success: false, error: 'Bitbucket is not configured for this project' });
    detect.mockReturnValue({ workspace: 'acme', repoSlug: 'todo', remoteUrl: 'u' });
    expect(await handlers.get('bitbucket:detectRepo')!({}, 'p1')).toEqual({ success: true, data: { workspace: 'acme', repoSlug: 'todo' } });
    detect.mockReturnValue(null);
    expect(await handlers.get('bitbucket:detectRepo')!({}, 'p1')).toEqual({ success: true, data: null });
  });
});
