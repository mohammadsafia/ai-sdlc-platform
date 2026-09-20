// apps/desktop/src/main/ipc-handlers/__tests__/requirements-handlers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequirementsSet } from '../../../shared/types/requirements';

const { handlers, sent, getProject, files, brd, run, featureSettings } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  sent: [] as unknown[][],
  getProject: vi.fn(),
  files: { readRequirements: vi.fn(), writeRequirements: vi.fn(), brdHash: vi.fn(() => 'HASH') },
  brd: { readBrd: vi.fn() },
  run: vi.fn(),
  featureSettings: vi.fn(() => ({ model: 'sonnet', thinkingLevel: 'medium' })),
}));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn((c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn)) } }));
vi.mock('../utils', () => ({ safeSendToRenderer: vi.fn((_g: unknown, ...args: unknown[]) => { sent.push(args); return true; }) }));
vi.mock('../../project-store', () => ({ projectStore: { getProject } }));
vi.mock('../../brd/requirements-files', () => files);
vi.mock('../../brd/brd-files', () => brd);
vi.mock('../../ai/runners/requirements-generator', () => ({ runRequirementsGenerator: run }));
vi.mock('../feature-settings-helper', () => ({ getActiveProviderFeatureSettings: featureSettings }));

import { registerRequirementsHandlers } from '../requirements-handlers';

const goodBrd = '---\ntitle: A\nstatus: draft\ncreated: 2026-09-20\n---\n# A\n\n## Summary\n\ns\n\n## Problem and goals\n\np\n\n## Scope\n\n### In scope\n\nx\n\n## Functional requirements\n\n### F\n\n1. r\n\n## Milestones\n\n### Milestone 1: One\n\nm\n';
const set: RequirementsSet = {
  version: 1, brdSlug: 'a', brdHash: 'HASH', status: 'draft', generatedAt: 't',
  requirements: [{ id: 'R1', title: 'r', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: false, included: true }],
  milestones: [{ id: 'M1', name: 'm', description: 'd', order: 1, included: true }],
  tasks: [{ id: 'T1', title: 't', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 1, included: true }],
};
const body = {
  requirements: [{ title: 'r', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: false }],
  milestones: [{ name: 'm', description: 'd', order: 1 }],
  tasks: [{ title: 't', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature' as const, order: 1 }],
};
const tick = () => new Promise((r) => setTimeout(r, 10));

describe('requirements handlers', () => {
  beforeEach(() => {
    handlers.clear(); sent.length = 0; vi.clearAllMocks();
    getProject.mockReturnValue({ id: 'p1', path: '/repo' });
    brd.readBrd.mockResolvedValue({ summary: { slug: 'a' }, content: goodBrd });
    registerRequirementsHandlers(() => null);
  });

  it('read returns the set and the current BRD hash', async () => {
    files.readRequirements.mockResolvedValue(set);
    expect(await handlers.get('requirements:read')!({}, 'p1', 'a')).toEqual({ success: true, data: { set, currentBrdHash: 'HASH' } });
  });

  it('write forces draft and strips approvedAt', async () => {
    files.writeRequirements.mockImplementation(async (_p: string, _s: string, s: RequirementsSet) => s);
    const r = (await handlers.get('requirements:write')!({}, 'p1', 'a', { ...set, status: 'approved', approvedAt: 'x' })) as { data: RequirementsSet };
    expect(r.data.status).toBe('draft');
    expect(r.data.approvedAt).toBeUndefined();
  });

  it('approve refuses with warnings and otherwise writes approved', async () => {
    files.writeRequirements.mockImplementation(async (_p: string, _s: string, s: RequirementsSet) => s);
    const bad = { ...set, tasks: [] };
    const refused = await handlers.get('requirements:approve')!({}, 'p1', 'a', bad);
    expect(refused).toMatchObject({ success: false, error: expect.stringContaining('R1') });
    const ok = (await handlers.get('requirements:approve')!({}, 'p1', 'a', set)) as { data: RequirementsSet };
    expect(ok.data.status).toBe('approved');
    expect(ok.data.approvedAt).toBeTruthy();
  });

  it('generate is refused when the BRD fails the structure check', async () => {
    brd.readBrd.mockResolvedValue({ summary: { slug: 'a' }, content: '---\ntitle: A\ncreated: 2026-01-01\n---\n# A\n' });
    const r = await handlers.get('requirements:generate')!({}, 'p1', { slug: 'a', mode: 'generate' });
    expect(r).toMatchObject({ success: false, error: expect.stringContaining('Summary') });
  });

  it('generate post-processes the body into a set with ids and hash, and emits done', async () => {
    files.readRequirements.mockResolvedValue(null);
    run.mockImplementation(async (_c: unknown, onEvent: (e: unknown) => void) => {
      onEvent({ type: 'progress', phase: 'started' });
      onEvent({ type: 'done', body });
    });
    const r = (await handlers.get('requirements:generate')!({}, 'p1', { slug: 'a', mode: 'generate' })) as { data: { runId: string } };
    await tick();
    expect(sent[0]).toEqual(['requirements:progress', { runId: r.data.runId, phase: 'started' }]);
    const done = sent[1][1] as { runId: string; set: RequirementsSet; warnings: string[] };
    expect(sent[1][0]).toBe('requirements:done');
    expect(done.set).toMatchObject({ brdSlug: 'a', brdHash: 'HASH', status: 'draft', version: 1 });
    expect(done.set.requirements[0]).toMatchObject({ id: 'R1', included: true });
    expect(done.set.tasks[0]).toMatchObject({ id: 'T1', requirementIds: ['R1'] });
  });

  it('refine requires an existing set and merges with selection', async () => {
    files.readRequirements.mockResolvedValue(null);
    expect(await handlers.get('requirements:generate')!({}, 'p1', { slug: 'a', mode: 'refine', feedback: 'x' })).toMatchObject({ success: false });
    files.readRequirements.mockResolvedValue(set);
    run.mockImplementation(async (cfg: { previous?: RequirementsSet; selection?: string[] }, onEvent: (e: unknown) => void) => {
      expect(cfg.previous).toEqual(set);
      expect(cfg.selection).toEqual(['R1']);
      onEvent({ type: 'done', body: { ...body, requirements: [{ id: 'R1', ...body.requirements[0], title: 'changed' }], changeSummary: 'renamed R1' } });
    });
    await handlers.get('requirements:generate')!({}, 'p1', { slug: 'a', mode: 'refine', feedback: 'x', selection: ['R1'] });
    await tick();
    const done = sent.at(-1)![1] as { set: RequirementsSet; changeSummary?: string };
    expect(done.set.requirements[0].title).toBe('changed');
    expect(done.changeSummary).toBe('renamed R1');
  });

  it('rejects a concurrent run for the same slug and supports cancel', async () => {
    files.readRequirements.mockResolvedValue(null);
    run.mockImplementation((cfg: { abortSignal?: AbortSignal }, onEvent: (e: unknown) => void) =>
      new Promise<void>((resolve) => cfg.abortSignal?.addEventListener('abort', () => { onEvent({ type: 'error', error: 'cancelled' }); resolve(); })),
    );
    const first = (await handlers.get('requirements:generate')!({}, 'p1', { slug: 'a', mode: 'generate' })) as { data: { runId: string } };
    expect(await handlers.get('requirements:generate')!({}, 'p1', { slug: 'a', mode: 'generate' })).toEqual({ success: false, error: 'A run is already in progress for this BRD' });
    expect(await handlers.get('requirements:cancel')!({}, first.data.runId)).toEqual({ success: true });
    await tick();
    expect(sent.at(-1)).toEqual(['requirements:error', { runId: first.data.runId, error: 'cancelled' }]);
  });
});
