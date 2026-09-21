// apps/desktop/src/main/ipc-handlers/__tests__/requirements-handlers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequirementsSet } from '../../../shared/types/requirements';

const { handlers, sent, getProject, files, brd, run, featureSettings, createTask, jiraPush, jiraCfg } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  sent: [] as unknown[][],
  getProject: vi.fn(),
  files: { readRequirements: vi.fn(), writeRequirements: vi.fn(), brdHash: vi.fn(() => 'HASH') },
  brd: { readBrd: vi.fn() },
  run: vi.fn(),
  featureSettings: vi.fn(() => ({ model: 'sonnet', thinkingLevel: 'medium' })),
  createTask: vi.fn(),
  jiraPush: { pushMilestoneToJira: vi.fn() },
  jiraCfg: { getJiraConfig: vi.fn(() => null as unknown) },
}));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn((c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn)) } }));
vi.mock('../utils', () => ({ safeSendToRenderer: vi.fn((_g: unknown, ...args: unknown[]) => { sent.push(args); return true; }) }));
vi.mock('../../project-store', () => ({ projectStore: { getProject } }));
vi.mock('../../brd/requirements-files', () => files);
vi.mock('../../brd/brd-files', () => brd);
vi.mock('../../ai/runners/requirements-generator', () => ({ runRequirementsGenerator: run }));
vi.mock('../feature-settings-helper', () => ({ getActiveProviderFeatureSettings: featureSettings }));
vi.mock('../task/create-task', () => ({ createTaskInProject: createTask }));
vi.mock('../../jira/push-milestone', () => jiraPush);
vi.mock('../../jira/config', () => jiraCfg);

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
    files.brdHash.mockReturnValueOnce('HASH-NOW');
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
    // The model saw the current BRD, so the refined set is no longer stale
    expect(done.set.brdHash).toBe('HASH-NOW');
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
  const approved: RequirementsSet = { ...set, status: 'approved', approvedAt: 't' };
  const madeTask = (specId: string) => ({ id: specId, specId, projectId: 'p1', title: 't', description: 'd', status: 'backlog', subtasks: [], logs: [], metadata: {}, createdAt: new Date(), updatedAt: new Date() });

  it('release refuses when the gate fails and creates nothing', async () => {
    files.readRequirements.mockResolvedValue(set); // draft
    const r = await handlers.get('requirements:release')!({}, 'p1', 'a', 'M1');
    expect(r).toEqual({ success: false, error: 'Approve the requirements set before releasing a milestone' });
    expect(createTask).not.toHaveBeenCalled();
  });

  it('release creates one task per included proposed task, records each, and returns them', async () => {
    files.readRequirements.mockResolvedValue(approved);
    files.writeRequirements.mockImplementation(async (_p: string, _s: string, s: RequirementsSet) => s);
    createTask.mockReturnValueOnce(madeTask('001-t'));
    const r = (await handlers.get('requirements:release')!({}, 'p1', 'a', 'M1')) as { success: boolean; data: { set: RequirementsSet; tasks: unknown[] } };
    expect(r.success).toBe(true);
    expect(createTask).toHaveBeenCalledTimes(1);
    const [, input] = createTask.mock.calls[0];
    expect(input.title).toBe('t');
    expect(input.metadata).toMatchObject({ sourceType: 'requirements', brdSlug: 'a', milestoneId: 'M1', requirementIds: ['R1'], proposedTaskId: 'T1' });
    expect(r.data.tasks).toHaveLength(1);
    expect(r.data.set.releases?.M1.tasks).toEqual([{ proposedTaskId: 'T1', specId: '001-t' }]);
    expect(r.data.set.releases?.M1.releasedAt).toBeTruthy();
    expect(files.writeRequirements).toHaveBeenCalledTimes(1);
  });

  it('release stops at the first creation failure, keeps the partial record, and skips done tasks on retry', async () => {
    const two: RequirementsSet = {
      ...approved,
      tasks: [
        approved.tasks[0],
        { id: 'T2', title: 'u', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 2, included: true },
      ],
    };
    files.readRequirements.mockResolvedValue(two);
    files.writeRequirements.mockImplementation(async (_p: string, _s: string, s: RequirementsSet) => s);
    createTask.mockReturnValueOnce(madeTask('001-t')).mockImplementationOnce(() => { throw new Error('disk full'); });
    const r = (await handlers.get('requirements:release')!({}, 'p1', 'a', 'M1')) as { success: boolean; error: string };
    expect(r.success).toBe(false);
    expect(r.error).toBe('Could not create a task for T2 (u): disk full');
    const written = files.writeRequirements.mock.calls.at(-1)?.[2] as RequirementsSet;
    expect(written.releases?.M1.tasks).toEqual([{ proposedTaskId: 'T1', specId: '001-t' }]);

    // Retry: T1 already has a spec id and is skipped
    files.readRequirements.mockResolvedValue(written);
    createTask.mockReset();
    createTask.mockReturnValueOnce(madeTask('002-u'));
    const again = (await handlers.get('requirements:release')!({}, 'p1', 'a', 'M1')) as { success: boolean; data: { set: RequirementsSet } };
    expect(again.success).toBe(true);
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(again.data.set.releases?.M1.tasks.map((t) => t.proposedTaskId)).toEqual(['T1', 'T2']);
  });

  it('release refuses while a generation run is active for the slug', async () => {
    files.readRequirements.mockResolvedValue(null);
    const g = await handlers.get('requirements:generate')!({}, 'p1', { slug: 'a', mode: 'generate' });
    expect(g).toMatchObject({ success: true });
    const r = await handlers.get('requirements:release')!({}, 'p1', 'a', 'M1');
    expect(r).toEqual({ success: false, error: 'A run is already in progress for this BRD' });
    // Release the lock so later tests start clean
    await handlers.get('requirements:cancel')!({}, (g as { data: { runId: string } }).data.runId);
    await tick();
  });
  it('release pushes to Jira when configured and turns push failures into warnings', async () => {
    files.readRequirements.mockResolvedValue(approved);
    files.writeRequirements.mockImplementation(async (_p: string, _s: string, s: RequirementsSet) => s);
    createTask.mockReturnValueOnce(madeTask('001-t'));
    jiraCfg.getJiraConfig.mockReturnValueOnce({ projectKey: 'ACME' });
    jiraPush.pushMilestoneToJira.mockRejectedValueOnce(new Error('Jira down'));
    const r = (await handlers.get('requirements:release')!({}, 'p1', 'a', 'M1')) as { success: boolean; data: { warnings: string[]; set: RequirementsSet } };
    expect(r.success).toBe(true);
    expect(r.data.warnings).toEqual(['Jira push failed: Jira down']);
    expect(r.data.set.releases?.M1.tasks).toHaveLength(1);
  });

  it('release without Jira returns no warnings', async () => {
    files.readRequirements.mockResolvedValue(approved);
    files.writeRequirements.mockImplementation(async (_p: string, _s: string, s: RequirementsSet) => s);
    createTask.mockReturnValueOnce(madeTask('001-t'));
    const r = (await handlers.get('requirements:release')!({}, 'p1', 'a', 'M1')) as { data: { warnings: string[] } };
    expect(r.data.warnings).toEqual([]);
    expect(jiraPush.pushMilestoneToJira).not.toHaveBeenCalled();
  });
});
