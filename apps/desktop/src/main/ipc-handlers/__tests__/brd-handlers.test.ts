// apps/desktop/src/main/ipc-handlers/__tests__/brd-handlers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { handlers, sent, getProject, files, runBrdWriter, featureSettings, brdGit, bb } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  sent: [] as unknown[][],
  getProject: vi.fn(),
  files: { listBrds: vi.fn(), readBrd: vi.fn(), writeBrd: vi.fn(), createBrd: vi.fn() },
  runBrdWriter: vi.fn(),
  featureSettings: vi.fn(() => ({ model: 'sonnet', thinkingLevel: 'medium' })),
  brdGit: { brdChanges: vi.fn(), commitBrd: vi.fn() },
  bb: { getBitbucketConfig: vi.fn(() => null as unknown), detectBitbucketRepo: vi.fn(() => null as unknown) },
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn((c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn)) },
}));
vi.mock('../utils', () => ({ safeSendToRenderer: vi.fn((_get: unknown, ...args: unknown[]) => { sent.push(args); return true; }) }));
vi.mock('../../project-store', () => ({ projectStore: { getProject } }));
vi.mock('../../brd/brd-files', () => files);
vi.mock('../../ai/runners/brd-writer', () => ({ runBrdWriter }));
vi.mock('../feature-settings-helper', () => ({ getActiveProviderFeatureSettings: featureSettings }));
vi.mock('../../brd/brd-git', () => brdGit);
vi.mock('../../bitbucket/config', () => ({ getBitbucketConfig: bb.getBitbucketConfig }));
vi.mock('../../bitbucket/remote', () => ({ detectBitbucketRepo: bb.detectBitbucketRepo }));

import { registerBrdHandlers } from '../brd-handlers';

describe('brd handlers', () => {
  beforeEach(() => {
    handlers.clear();
    sent.length = 0;
    vi.clearAllMocks();
    getProject.mockReturnValue({ id: 'p1', path: '/repo' });
    registerBrdHandlers(() => null);
  });

  it('list/read/write/create delegate with the project path', async () => {
    files.listBrds.mockResolvedValue([{ slug: 'a' }]);
    expect(await handlers.get('brd:list')!({}, 'p1')).toEqual({ success: true, data: [{ slug: 'a' }] });
    expect(files.listBrds).toHaveBeenCalledWith('/repo');

    files.readBrd.mockResolvedValue({ summary: { slug: 'a' }, content: '#' });
    expect(await handlers.get('brd:read')!({}, 'p1', 'a')).toEqual({ success: true, data: { summary: { slug: 'a' }, content: '#' } });

    files.writeBrd.mockResolvedValue({ slug: 'a' });
    await handlers.get('brd:write')!({}, 'p1', 'a', 'content');
    expect(files.writeBrd).toHaveBeenCalledWith('/repo', 'a', 'content');

    files.createBrd.mockResolvedValue({ slug: 'new-one' });
    expect(await handlers.get('brd:create')!({}, 'p1', 'New one')).toEqual({ success: true, data: { slug: 'new-one' } });
  });

  it('returns error results for unknown projects and thrown errors', async () => {
    getProject.mockReturnValue(undefined);
    expect(await handlers.get('brd:list')!({}, 'nope')).toEqual({ success: false, error: 'Project not found: nope' });
    getProject.mockReturnValue({ id: 'p1', path: '/repo' });
    files.readBrd.mockRejectedValue(new Error('BRD not found: x'));
    expect(await handlers.get('brd:read')!({}, 'p1', 'x')).toEqual({ success: false, error: 'BRD not found: x' });
  });

  it('draft starts a run, forwards events with the runId, and clears the run on done', async () => {
    runBrdWriter.mockImplementation(async (_cfg: unknown, onEvent: (e: unknown) => void) => {
      onEvent({ type: 'text-delta', text: 'a' });
      onEvent({ type: 'done', text: 'a' });
    });
    const r = (await handlers.get('brd:draft')!({}, 'p1', { mode: 'draft', notes: 'n', title: 'T' })) as { success: boolean; data: { runId: string } };
    expect(r.success).toBe(true);
    await new Promise((res) => setTimeout(res, 10));
    expect(runBrdWriter).toHaveBeenCalledWith(
      expect.objectContaining({ projectDir: '/repo', mode: 'draft', notes: 'n', title: 'T', modelShorthand: 'sonnet', thinkingLevel: 'medium' }),
      expect.any(Function),
    );
    expect(sent).toEqual([
      ['brd:draft-chunk', { runId: r.data.runId, text: 'a' }],
      ['brd:draft-done', { runId: r.data.runId, text: 'a' }],
    ]);
    // a new run is allowed after done
    const r2 = (await handlers.get('brd:draft')!({}, 'p1', { mode: 'draft', notes: 'n' })) as { success: boolean };
    expect(r2.success).toBe(true);
    await new Promise((res) => setTimeout(res, 10)); // let the deferred run finish so it does not leak into the next test
  });

  it('revise reads the existing BRD and passes it to the runner', async () => {
    files.readBrd.mockResolvedValue({ summary: { slug: 'a' }, content: '# Existing' });
    runBrdWriter.mockImplementation(async (_c: unknown, onEvent: (e: unknown) => void) => onEvent({ type: 'done', text: 'x' }));
    await handlers.get('brd:draft')!({}, 'p1', { mode: 'revise', notes: 'fix', slug: 'a' });
    await new Promise((res) => setTimeout(res, 10));
    expect(runBrdWriter).toHaveBeenCalledWith(expect.objectContaining({ mode: 'revise', existing: '# Existing' }), expect.any(Function));
  });

  it('rejects a second concurrent draft for the same project and supports cancel', async () => {
    let release: () => void = () => {};
    runBrdWriter.mockImplementation((cfg: { abortSignal?: AbortSignal }, onEvent: (e: unknown) => void) =>
      new Promise<void>((resolve) => {
        cfg.abortSignal?.addEventListener('abort', () => { onEvent({ type: 'error', error: 'aborted' }); resolve(); });
        release = resolve;
      }),
    );
    const first = (await handlers.get('brd:draft')!({}, 'p1', { mode: 'draft', notes: 'n' })) as { success: boolean; data: { runId: string } };
    const second = await handlers.get('brd:draft')!({}, 'p1', { mode: 'draft', notes: 'n' });
    expect(second).toEqual({ success: false, error: 'A draft is already running for this project' });
    expect(await handlers.get('brd:draft-cancel')!({}, first.data.runId)).toEqual({ success: true });
    await new Promise((res) => setTimeout(res, 10));
    expect(sent.at(-1)).toEqual(['brd:draft-error', { runId: first.data.runId, error: 'cancelled' }]);
    expect(await handlers.get('brd:draft-cancel')!({}, 'unknown')).toEqual({ success: false, error: 'No running draft with id unknown' });
    release();
  });

  it('changes and commit delegate to the git service, passing Bitbucket auth when configured', async () => {
    brdGit.brdChanges.mockReturnValue({ branch: 'develop', files: [] });
    expect(await handlers.get('brd:changes')!({}, 'p1')).toEqual({ success: true, data: { branch: 'develop', files: [] } });

    brdGit.commitBrd.mockResolvedValue({ commit: 'abc', pushed: true });
    expect(await handlers.get('brd:commit')!({}, 'p1', 'msg', true)).toEqual({ success: true, data: { commit: 'abc', pushed: true } });
    expect(brdGit.commitBrd).toHaveBeenLastCalledWith('/repo', 'msg', true, undefined);

    bb.getBitbucketConfig.mockReturnValue({ email: 'a@b.c', apiToken: 't', workspace: '', repoSlug: '' });
    bb.detectBitbucketRepo.mockReturnValue({ workspace: 'w', repoSlug: 's', remoteUrl: 'https://bitbucket.org/w/s.git' });
    await handlers.get('brd:commit')!({}, 'p1', 'msg', true);
    expect(brdGit.commitBrd).toHaveBeenLastCalledWith('/repo', 'msg', true, {
      remoteUrl: 'https://bitbucket.org/w/s.git',
      header: `Authorization: Basic ${Buffer.from('a@b.c:t').toString('base64')}`,
    });
  });
});
