import { describe, it, expect, vi, beforeEach } from 'vitest';
import { briefStatus, setupDesignListeners, useDesignStore } from '../design-store';

const api = {
  brdList: vi.fn(),
  requirementsRead: vi.fn(),
  designList: vi.fn(),
  designRead: vi.fn(),
  designWrite: vi.fn(),
  designCreate: vi.fn(),
  designSetStatus: vi.fn(),
  designDraft: vi.fn(),
  designDraftCancel: vi.fn(),
  onDesignDraftChunk: vi.fn(),
  onDesignDraftDone: vi.fn(),
  onDesignDraftError: vi.fn(),
  brdChanges: vi.fn().mockResolvedValue({ success: false }),
};
type Listener<T> = (p: T) => void;
let chunkCb: Listener<{ runId: string; text: string }> = () => undefined;
let doneCb: Listener<{ runId: string; text: string }> = () => undefined;

const summary = { brdSlug: 'a', requirementId: 'R1', title: 'One', status: 'draft' as const, modifiedAt: 't' };
const doc = '---\nbrd: a\nrequirement: R1\ntitle: One\nstatus: draft\nupdated: 2026-09-21\n---\n# One\n\n## Summary\nText\n';
const set = { requirements: [{ id: 'R1', title: 'One', needsDesign: true }, { id: 'R2', title: 'Two', needsDesign: false }] };

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { window: unknown }).window = { electronAPI: api };
  api.onDesignDraftChunk.mockImplementation((cb) => { chunkCb = cb; return () => undefined; });
  api.onDesignDraftDone.mockImplementation((cb) => { doneCb = cb; return () => undefined; });
  api.onDesignDraftError.mockImplementation(() => () => undefined);
  useDesignStore.getState().reset();
});

describe('design-store', () => {
  it('load collects needsDesign requirements per BRD with a set, and the briefs', async () => {
    api.brdList.mockResolvedValue({ success: true, data: [{ slug: 'a', title: 'A' }, { slug: 'b', title: 'B' }] });
    api.requirementsRead.mockImplementation(async (_p: string, slug: string) => ({ success: true, data: { set: slug === 'a' ? set : null } }));
    api.designList.mockResolvedValue({ success: true, data: [summary] });
    await useDesignStore.getState().load('p1');
    const s = useDesignStore.getState();
    expect(Object.keys(s.requirementsBySlug)).toEqual(['a']);
    expect(s.requirementsBySlug.a.requirements.map((r) => r.id)).toEqual(['R1']);
    expect(s.briefs).toEqual([summary]);
    expect(briefStatus(s.briefs, 'a', 'R1')).toBe('draft');
    expect(briefStatus(s.briefs, 'a', 'R9')).toBe('none');
  });

  it('select reads the brief, refuses while dirty, and save writes', async () => {
    api.designRead.mockResolvedValue({ success: true, data: { summary, content: doc } });
    expect(await useDesignStore.getState().select('p1', 'a', 'R1')).toBe(true);
    expect(useDesignStore.getState().structure?.ok).toBe(false);
    useDesignStore.getState().setContent(`${doc}x`);
    expect(await useDesignStore.getState().select('p1', 'a', 'R1')).toBe(false);
    api.designWrite.mockResolvedValue({ success: true, data: { ...summary, title: 'One' } });
    await useDesignStore.getState().save('p1');
    expect(api.designWrite).toHaveBeenCalledWith('p1', 'a', 'R1', `${doc}x`);
    expect(useDesignStore.getState().isDirty()).toBe(false);
  });

  it('select with no brief keeps the selection and empty content', async () => {
    api.designRead.mockResolvedValue({ success: false, error: 'Design brief not found: a/R1' });
    expect(await useDesignStore.getState().select('p1', 'a', 'R1')).toBe(true);
    expect(useDesignStore.getState().selected).toEqual({ brdSlug: 'a', requirementId: 'R1' });
    expect(useDesignStore.getState().selectedSummary).toBeNull();
  });

  it('setStatus updates the brief list and the selected summary', async () => {
    useDesignStore.setState({ briefs: [summary], selected: { brdSlug: 'a', requirementId: 'R1' }, selectedSummary: summary });
    api.designSetStatus.mockResolvedValue({ success: true, data: { ...summary, status: 'approved' } });
    const approvedDoc = doc.replace('status: draft', 'status: approved');
    api.designRead.mockResolvedValue({ success: true, data: { summary: { ...summary, status: 'approved' }, content: approvedDoc } });
    await useDesignStore.getState().setStatus('p1', 'approved');
    expect(useDesignStore.getState().briefs[0].status).toBe('approved');
    expect(useDesignStore.getState().selectedSummary?.status).toBe('approved');
    expect(useDesignStore.getState().content).toBe(approvedDoc);
    expect(useDesignStore.getState().isDirty()).toBe(false);
  });

  it('draft streams into a proposal; accept creates the file when none exists', async () => {
    setupDesignListeners();
    useDesignStore.setState({ selected: { brdSlug: 'a', requirementId: 'R1' }, selectedSummary: null });
    api.designDraft.mockResolvedValue({ success: true, data: { runId: 'run1' } });
    await useDesignStore.getState().startDraft('p1', 'draft', 'notes');
    expect(api.designDraft).toHaveBeenCalledWith('p1', { brdSlug: 'a', requirementId: 'R1', mode: 'draft', notes: 'notes' });
    chunkCb({ runId: 'run1', text: 'he' });
    chunkCb({ runId: 'other', text: 'zzz' });
    doneCb({ runId: 'run1', text: 'hello' });
    expect(useDesignStore.getState().draft).toEqual({ status: 'proposal', runId: 'run1', text: 'hello' });
    api.designWrite.mockResolvedValue({ success: true, data: summary });
    await useDesignStore.getState().acceptDraft('p1');
    expect(api.designWrite).toHaveBeenCalledWith('p1', 'a', 'R1', 'hello');
    expect(useDesignStore.getState().selectedSummary).toEqual(summary);
    expect(useDesignStore.getState().briefs).toEqual([summary]);
    expect(useDesignStore.getState().savedContent).toBe('hello');
  });

  it('accept on an existing brief only replaces the editor content', async () => {
    useDesignStore.setState({
      selected: { brdSlug: 'a', requirementId: 'R1' }, selectedSummary: summary, content: doc, savedContent: doc,
      draft: { status: 'proposal', runId: 'r', text: 'new' },
    });
    await useDesignStore.getState().acceptDraft('p1');
    expect(api.designWrite).not.toHaveBeenCalled();
    expect(useDesignStore.getState().content).toBe('new');
    expect(useDesignStore.getState().isDirty()).toBe(true);
  });
});
