// apps/desktop/src/renderer/stores/__tests__/brd-store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useBrdStore, setupBrdListeners } from '../brd-store';

const api = {
  brdList: vi.fn(),
  brdRead: vi.fn(),
  brdWrite: vi.fn(),
  brdCreate: vi.fn(),
  brdDraft: vi.fn(),
  brdDraftCancel: vi.fn(),
  onBrdDraftChunk: vi.fn(),
  onBrdDraftDone: vi.fn(),
  onBrdDraftError: vi.fn(),
};
type Listener<T> = (payload: T) => void;
let chunkCb: Listener<{ runId: string; text: string }> = () => {};
let doneCb: Listener<{ runId: string; text: string }> = () => {};
let errorCb: Listener<{ runId: string; error: string }> = () => {};

const summary = { slug: 'a', title: 'A', status: 'draft' as const, modifiedAt: 't' };
const doc = '---\ntitle: A\nstatus: draft\ncreated: 2026-09-20\n---\n# A\n\n## Summary\n\nText\n';

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { window: unknown }).window = { electronAPI: api };
  api.onBrdDraftChunk.mockImplementation((cb) => { chunkCb = cb; return () => {}; });
  api.onBrdDraftDone.mockImplementation((cb) => { doneCb = cb; return () => {}; });
  api.onBrdDraftError.mockImplementation((cb) => { errorCb = cb; return () => {}; });
  useBrdStore.getState().reset();
});

describe('brd-store', () => {
  it('load lists BRDs', async () => {
    api.brdList.mockResolvedValue({ success: true, data: [summary] });
    await useBrdStore.getState().load('p1');
    expect(useBrdStore.getState().brds).toEqual([summary]);
  });

  it('select reads content and computes structure; refuses when dirty unless forced', async () => {
    api.brdRead.mockResolvedValue({ success: true, data: { summary, content: doc } });
    await useBrdStore.getState().select('p1', 'a');
    const s = useBrdStore.getState();
    expect(s.selectedSlug).toBe('a');
    expect(s.content).toBe(doc);
    expect(s.structure?.sections.find((x) => x.heading === 'Summary')?.present).toBe(true);

    s.setContent(`${doc}\nmore`);
    expect(useBrdStore.getState().isDirty()).toBe(true);
    expect(await useBrdStore.getState().select('p1', 'b')).toBe(false);
    expect(useBrdStore.getState().selectedSlug).toBe('a');
    api.brdRead.mockResolvedValue({ success: true, data: { summary: { ...summary, slug: 'b' }, content: doc } });
    expect(await useBrdStore.getState().select('p1', 'b', { force: true })).toBe(true);
    expect(useBrdStore.getState().selectedSlug).toBe('b');
  });

  it('save writes content, clears dirty, and refreshes the list entry', async () => {
    api.brdRead.mockResolvedValue({ success: true, data: { summary, content: doc } });
    api.brdList.mockResolvedValue({ success: true, data: [summary] });
    await useBrdStore.getState().load('p1');
    await useBrdStore.getState().select('p1', 'a');
    useBrdStore.getState().setContent(`${doc}\nmore`);
    api.brdWrite.mockResolvedValue({ success: true, data: { ...summary, title: 'A2' } });
    await useBrdStore.getState().save('p1');
    expect(api.brdWrite).toHaveBeenCalledWith('p1', 'a', `${doc}\nmore`);
    expect(useBrdStore.getState().isDirty()).toBe(false);
    expect(useBrdStore.getState().brds[0].title).toBe('A2');
  });

  it('save failure keeps content dirty and stores the error', async () => {
    api.brdRead.mockResolvedValue({ success: true, data: { summary, content: doc } });
    await useBrdStore.getState().select('p1', 'a');
    useBrdStore.getState().setContent('x');
    api.brdWrite.mockResolvedValue({ success: false, error: 'disk full' });
    await useBrdStore.getState().save('p1');
    expect(useBrdStore.getState().isDirty()).toBe(true);
    expect(useBrdStore.getState().error).toBe('disk full');
  });

  it('create adds the BRD, selects it, and returns the slug', async () => {
    api.brdCreate.mockResolvedValue({ success: true, data: { ...summary, slug: 'new' } });
    api.brdRead.mockResolvedValue({ success: true, data: { summary: { ...summary, slug: 'new' }, content: doc } });
    expect(await useBrdStore.getState().create('p1', 'New')).toBe('new');
    expect(useBrdStore.getState().brds[0].slug).toBe('new');
    expect(useBrdStore.getState().selectedSlug).toBe('new');
  });

  it('draft streams into a proposal, accept replaces content and marks dirty, discard clears', async () => {
    const stop = setupBrdListeners();
    api.brdRead.mockResolvedValue({ success: true, data: { summary, content: doc } });
    await useBrdStore.getState().select('p1', 'a');
    api.brdDraft.mockResolvedValue({ success: true, data: { runId: 'r1' } });
    await useBrdStore.getState().startDraft('p1', 'revise', 'shorter');
    expect(api.brdDraft).toHaveBeenCalledWith('p1', { mode: 'revise', notes: 'shorter', slug: 'a', title: 'A' });
    expect(useBrdStore.getState().draft.status).toBe('streaming');
    chunkCb({ runId: 'r1', text: 'NEW ' });
    chunkCb({ runId: 'other', text: 'IGNORED' });
    chunkCb({ runId: 'r1', text: 'DOC' });
    expect(useBrdStore.getState().draft.text).toBe('NEW DOC');
    doneCb({ runId: 'r1', text: 'NEW DOC' });
    expect(useBrdStore.getState().draft.status).toBe('proposal');
    useBrdStore.getState().acceptDraft();
    expect(useBrdStore.getState().content).toBe('NEW DOC');
    expect(useBrdStore.getState().isDirty()).toBe(true);
    expect(useBrdStore.getState().draft.status).toBe('idle');

    api.brdDraft.mockResolvedValue({ success: true, data: { runId: 'r2' } });
    await useBrdStore.getState().startDraft('p1', 'revise', 'again');
    errorCb({ runId: 'r2', error: 'boom' });
    expect(useBrdStore.getState().draft).toMatchObject({ status: 'idle', error: 'boom' });
    useBrdStore.getState().discardDraft();
    expect(useBrdStore.getState().draft.text).toBe('');
    stop();
  });

  it('cancelDraft calls the API with the run id', async () => {
    setupBrdListeners();
    api.brdDraft.mockResolvedValue({ success: true, data: { runId: 'r9' } });
    api.brdDraftCancel.mockResolvedValue({ success: true });
    await useBrdStore.getState().startDraft('p1', 'draft', 'notes');
    await useBrdStore.getState().cancelDraft();
    expect(api.brdDraftCancel).toHaveBeenCalledWith('r9');
  });
});
