// apps/desktop/src/renderer/stores/__tests__/requirements-store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRequirementsStore, setupRequirementsListeners } from '../requirements-store';
import type { RequirementsSet } from '../../../shared/types/requirements';

const { addTask } = vi.hoisted(() => ({ addTask: vi.fn() }));
vi.mock('../task-store', () => ({ useTaskStore: { getState: () => ({ addTask }) } }));

const api = {
  requirementsRead: vi.fn(), requirementsWrite: vi.fn(), requirementsApprove: vi.fn(),
  requirementsGenerate: vi.fn(), requirementsCancel: vi.fn(), requirementsRelease: vi.fn(),
  onRequirementsProgress: vi.fn(), onRequirementsDone: vi.fn(), onRequirementsError: vi.fn(),
};
let progressCb: (p: { runId: string; phase: string }) => void = () => {};
let doneCb: (d: { runId: string; set: RequirementsSet; changeSummary?: string; warnings: string[] }) => void = () => {};
let errorCb: (e: { runId: string; error: string }) => void = () => {};

const set: RequirementsSet = {
  version: 1, brdSlug: 'a', brdHash: 'H', status: 'draft', generatedAt: 't',
  requirements: [{ id: 'R1', title: 'r', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: false, included: true }],
  milestones: [{ id: 'M1', name: 'm', description: 'd', order: 1, included: true }, { id: 'M2', name: 'n', description: 'd', order: 2, included: true }],
  tasks: [{ id: 'T1', title: 't', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 1, included: true }],
};

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { window: unknown }).window = { electronAPI: api };
  api.onRequirementsProgress.mockImplementation((cb) => { progressCb = cb; return () => {}; });
  api.onRequirementsDone.mockImplementation((cb) => { doneCb = cb; return () => {}; });
  api.onRequirementsError.mockImplementation((cb) => { errorCb = cb; return () => {}; });
  useRequirementsStore.getState().reset();
});

describe('requirements-store', () => {
  it('load reads the set and hash and computes warnings', async () => {
    api.requirementsRead.mockResolvedValue({ success: true, data: { set, currentBrdHash: 'H' } });
    await useRequirementsStore.getState().load('p1', 'a');
    const s = useRequirementsStore.getState();
    expect(s.set).toEqual(set);
    expect(s.isStale()).toBe(false);
    expect(s.warnings).toEqual([]);
  });

  it('toggleInclude, edit, and moveMilestone mark dirty and recompute warnings', async () => {
    api.requirementsRead.mockResolvedValue({ success: true, data: { set, currentBrdHash: 'OTHER' } });
    await useRequirementsStore.getState().load('p1', 'a');
    expect(useRequirementsStore.getState().isStale()).toBe(true);
    useRequirementsStore.getState().toggleInclude('tasks', 'T1');
    expect(useRequirementsStore.getState().isDirty()).toBe(true);
    expect(useRequirementsStore.getState().warnings.join(' ')).toContain('R1');
    useRequirementsStore.getState().edit('requirements', 'R1', { title: 'Renamed' });
    expect(useRequirementsStore.getState().set?.requirements[0].title).toBe('Renamed');
    useRequirementsStore.getState().moveMilestone('M2', 'up');
    expect(useRequirementsStore.getState().set?.milestones.map((m) => [m.id, m.order])).toEqual([['M2', 1], ['M1', 2]]);
  });

  it('save writes and clears dirty; approve is refused when dirty or with warnings, else stores approved', async () => {
    api.requirementsRead.mockResolvedValue({ success: true, data: { set, currentBrdHash: 'H' } });
    await useRequirementsStore.getState().load('p1', 'a');
    useRequirementsStore.getState().edit('requirements', 'R1', { title: 'x' });
    expect(useRequirementsStore.getState().canApprove()).toBe(false);
    api.requirementsWrite.mockImplementation(async (_p: string, _s: string, s: RequirementsSet) => ({ success: true, data: s }));
    await useRequirementsStore.getState().save('p1');
    expect(useRequirementsStore.getState().isDirty()).toBe(false);
    expect(useRequirementsStore.getState().canApprove()).toBe(true);
    api.requirementsApprove.mockImplementation(async (_p: string, _s: string, s: RequirementsSet) => ({ success: true, data: { ...s, status: 'approved', approvedAt: 'now' } }));
    await useRequirementsStore.getState().approve('p1');
    expect(useRequirementsStore.getState().set?.status).toBe('approved');
    useRequirementsStore.getState().toggleInclude('tasks', 'T1');
    expect(useRequirementsStore.getState().canApprove()).toBe(false);
  });

  it('generate → progress → done becomes a proposal; accept installs it, discard drops it', async () => {
    const stop = setupRequirementsListeners();
    api.requirementsRead.mockResolvedValue({ success: true, data: { set: null, currentBrdHash: 'H' } });
    await useRequirementsStore.getState().load('p1', 'a');
    api.requirementsGenerate.mockResolvedValue({ success: true, data: { runId: 'r1' } });
    await useRequirementsStore.getState().generate('p1');
    expect(api.requirementsGenerate).toHaveBeenCalledWith('p1', { slug: 'a', mode: 'generate' });
    progressCb({ runId: 'r1', phase: 'parsing' });
    expect(useRequirementsStore.getState().run).toMatchObject({ status: 'running', phase: 'parsing' });
    doneCb({ runId: 'r1', set, warnings: ['w'] });
    expect(useRequirementsStore.getState().run.status).toBe('proposal');
    useRequirementsStore.getState().accept();
    expect(useRequirementsStore.getState().set).toEqual(set);
    expect(useRequirementsStore.getState().isDirty()).toBe(true);
    expect(useRequirementsStore.getState().run.status).toBe('idle');

    api.requirementsGenerate.mockResolvedValue({ success: true, data: { runId: 'r2' } });
    useRequirementsStore.getState().toggleSelect('R1');
    await useRequirementsStore.getState().refine('p1', 'shorter');
    expect(api.requirementsGenerate).toHaveBeenLastCalledWith('p1', { slug: 'a', mode: 'refine', feedback: 'shorter', selection: ['R1'] });
    doneCb({ runId: 'r2', set: { ...set, requirements: [{ ...set.requirements[0], title: 'S' }] }, changeSummary: 'shortened', warnings: [] });
    expect(useRequirementsStore.getState().run.proposal?.changeSummary).toBe('shortened');
    useRequirementsStore.getState().discard();
    expect(useRequirementsStore.getState().set?.requirements[0].title).toBe('r');

    api.requirementsGenerate.mockResolvedValue({ success: true, data: { runId: 'r3' } });
    await useRequirementsStore.getState().refine('p1', 'x');
    errorCb({ runId: 'r3', error: 'boom' });
    expect(useRequirementsStore.getState().run).toMatchObject({ status: 'idle', error: 'boom' });
    stop();
  });

  it('refreshBrdHash updates only the BRD hash and keeps local edits', async () => {
    api.requirementsRead.mockResolvedValue({ success: true, data: { set, currentBrdHash: 'H' } });
    await useRequirementsStore.getState().load('p1', 'a');
    useRequirementsStore.getState().edit('requirements', 'R1', { title: 'changed' });
    api.requirementsRead.mockResolvedValue({ success: true, data: { set, currentBrdHash: 'H2' } });
    await useRequirementsStore.getState().refreshBrdHash('p1');
    const s = useRequirementsStore.getState();
    expect(s.currentBrdHash).toBe('H2');
    expect(s.isStale()).toBe(true);
    expect(s.set?.requirements[0].title).toBe('changed');
    expect(s.isDirty()).toBe(true);
  });

  it('cancel calls the API with the run id', async () => {
    setupRequirementsListeners();
    api.requirementsRead.mockResolvedValue({ success: true, data: { set: null, currentBrdHash: 'H' } });
    await useRequirementsStore.getState().load('p1', 'a');
    api.requirementsGenerate.mockResolvedValue({ success: true, data: { runId: 'r9' } });
    api.requirementsCancel.mockResolvedValue({ success: true });
    await useRequirementsStore.getState().generate('p1');
    await useRequirementsStore.getState().cancel();
    expect(api.requirementsCancel).toHaveBeenCalledWith('r9');
  });
  const approved: RequirementsSet = { ...set, status: 'approved', approvedAt: 't' };
  const released: RequirementsSet = { ...approved, releases: { M1: { releasedAt: 't', tasks: [{ proposedTaskId: 'T1', specId: '001-t' }] } } };

  it('release calls the API, installs the returned set as saved, and pushes tasks to the task store', async () => {
    api.requirementsRead.mockResolvedValue({ success: true, data: { set: approved, currentBrdHash: 'H' } });
    await useRequirementsStore.getState().load('p1', 'a');
    const task = { id: '001-t', specId: '001-t', status: 'backlog' };
    api.requirementsRelease.mockResolvedValue({ success: true, data: { set: released, tasks: [task] } });
    await useRequirementsStore.getState().release('p1', 'M1');
    expect(api.requirementsRelease).toHaveBeenCalledWith('p1', 'a', 'M1');
    expect(addTask).toHaveBeenCalledWith(task);
    const s = useRequirementsStore.getState();
    expect(s.set).toEqual(released);
    expect(s.isDirty()).toBe(false);
    expect(s.isReleasing).toBe(false);
    expect(s.error).toBeNull();
  });

  it('release surfaces the error and reloads the set so a partial record shows', async () => {
    api.requirementsRead.mockResolvedValue({ success: true, data: { set: approved, currentBrdHash: 'H' } });
    await useRequirementsStore.getState().load('p1', 'a');
    api.requirementsRead.mockResolvedValue({ success: true, data: { set: released, currentBrdHash: 'H' } });
    api.requirementsRelease.mockResolvedValue({ success: false, error: 'Could not create a task for T2 (u): disk full' });
    await useRequirementsStore.getState().release('p1', 'M1');
    const s = useRequirementsStore.getState();
    expect(s.error).toBe('Could not create a task for T2 (u): disk full');
    expect(s.set?.releases?.M1.tasks).toHaveLength(1);
  });

  it('releaseReason reflects the gate, dirty edits, and a running run', async () => {
    api.requirementsRead.mockResolvedValue({ success: true, data: { set: approved, currentBrdHash: 'H' } });
    await useRequirementsStore.getState().load('p1', 'a');
    expect(useRequirementsStore.getState().releaseReason('M1')).toBeNull();
    expect(useRequirementsStore.getState().releaseReason('M2')).toBe('notNext');
    useRequirementsStore.getState().edit('requirements', 'R1', { title: 'x' });
    expect(useRequirementsStore.getState().releaseReason('M1')).toBe('dirty');
    useRequirementsStore.setState({ set: approved, run: { status: 'running', runId: 'r' } });
    expect(useRequirementsStore.getState().releaseReason('M1')).toBe('running');
  });

  it('lockedIds and nextMilestone derive from the set', async () => {
    api.requirementsRead.mockResolvedValue({ success: true, data: { set: released, currentBrdHash: 'H' } });
    await useRequirementsStore.getState().load('p1', 'a');
    expect([...useRequirementsStore.getState().lockedIds()].sort()).toEqual(['M1', 'R1', 'T1']);
    expect(useRequirementsStore.getState().nextMilestone()?.id).toBe('M2');
  });

  it('refine excludes locked ids: whole-set refinement selects only unlocked ids, targeted drops locked ones', async () => {
    api.requirementsRead.mockResolvedValue({ success: true, data: { set: released, currentBrdHash: 'H' } });
    await useRequirementsStore.getState().load('p1', 'a');
    api.requirementsGenerate.mockResolvedValue({ success: true, data: { runId: 'r1' } });
    await useRequirementsStore.getState().refine('p1', 'tighten');
    expect(api.requirementsGenerate).toHaveBeenLastCalledWith('p1', { slug: 'a', mode: 'refine', feedback: 'tighten', selection: ['M2'] });
    useRequirementsStore.getState().toggleSelect('T1');
    useRequirementsStore.getState().toggleSelect('M2');
    await useRequirementsStore.getState().refine('p1', 'again');
    expect(api.requirementsGenerate).toHaveBeenLastCalledWith('p1', { slug: 'a', mode: 'refine', feedback: 'again', selection: ['M2'] });
  });
});
