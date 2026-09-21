import { describe, it, expect, vi, beforeEach } from 'vitest';

const { handlers, sent, getProject, files, brd, req, runDesignWriter, featureSettings } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  sent: [] as unknown[][],
  getProject: vi.fn(),
  files: { listDesignBriefs: vi.fn(), readDesignBrief: vi.fn(), writeDesignBrief: vi.fn(), createDesignBrief: vi.fn(), setDesignBriefStatus: vi.fn() },
  brd: { readBrd: vi.fn() },
  req: { readRequirements: vi.fn() },
  runDesignWriter: vi.fn(),
  featureSettings: vi.fn(() => ({ model: 'sonnet', thinkingLevel: 'medium' })),
}));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn((c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn)) } }));
vi.mock('../utils', () => ({ safeSendToRenderer: vi.fn((_get: unknown, ...args: unknown[]) => { sent.push(args); return true; }) }));
vi.mock('../../project-store', () => ({ projectStore: { getProject } }));
vi.mock('../../design/design-files', () => files);
vi.mock('../../brd/brd-files', () => brd);
vi.mock('../../brd/requirements-files', () => req);
vi.mock('../../ai/runners/design-writer', () => ({ runDesignWriter }));
vi.mock('../feature-settings-helper', () => ({ getActiveProviderFeatureSettings: featureSettings }));

import { registerDesignHandlers } from '../design-handlers';

const set = {
  requirements: [
    { id: 'R3', title: 'Filter', description: 'd', acceptanceCriteria: ['a'], area: 'List', needsDesign: true, included: true },
    { id: 'R4', title: 'Sort', description: 'd', acceptanceCriteria: [], area: 'List', needsDesign: true, included: true },
  ],
};
const tick = () => new Promise((r) => setTimeout(r, 5));
const draft = (requirementId: string, mode: 'draft' | 'revise' = 'draft') => ({ brdSlug: 'todo-app', requirementId, mode, notes: 'n' });

beforeEach(() => {
  handlers.clear();
  sent.length = 0;
  vi.clearAllMocks();
  getProject.mockReturnValue({ id: 'p1', path: '/repo' });
  registerDesignHandlers(() => null);
});

describe('design handlers', () => {
  it('list/read/write/setStatus delegate with the project path', async () => {
    files.listDesignBriefs.mockResolvedValue([{ requirementId: 'R3' }]);
    expect(await handlers.get('design:list')!({}, 'p1')).toEqual({ success: true, data: [{ requirementId: 'R3' }] });
    files.readDesignBrief.mockResolvedValue({ summary: { requirementId: 'R3' }, content: '#' });
    expect(await handlers.get('design:read')!({}, 'p1', 'todo-app', 'R3')).toEqual({ success: true, data: { summary: { requirementId: 'R3' }, content: '#' } });
    files.writeDesignBrief.mockResolvedValue({ requirementId: 'R3' });
    await handlers.get('design:write')!({}, 'p1', 'todo-app', 'R3', 'content');
    expect(files.writeDesignBrief).toHaveBeenCalledWith('/repo', 'todo-app', 'R3', 'content');
    files.setDesignBriefStatus.mockResolvedValue({ status: 'approved' });
    expect(await handlers.get('design:setStatus')!({}, 'p1', 'todo-app', 'R3', 'approved')).toEqual({ success: true, data: { status: 'approved' } });
  });

  it('create looks up the requirement title and refuses unknown ids', async () => {
    req.readRequirements.mockResolvedValue(set);
    files.createDesignBrief.mockResolvedValue({ requirementId: 'R3', title: 'Filter' });
    expect(await handlers.get('design:create')!({}, 'p1', 'todo-app', 'R3')).toEqual({ success: true, data: { requirementId: 'R3', title: 'Filter' } });
    expect(files.createDesignBrief).toHaveBeenCalledWith('/repo', 'todo-app', { id: 'R3', title: 'Filter' });
    expect(await handlers.get('design:create')!({}, 'p1', 'todo-app', 'R9')).toEqual({ success: false, error: 'Requirement R9 not found in todo-app' });
  });

  it('draft loads the BRD, requirement, and existing brief, forwards events, and clears the run', async () => {
    req.readRequirements.mockResolvedValue(set);
    brd.readBrd.mockResolvedValue({ summary: {}, content: '# Todo\nBody' });
    files.readDesignBrief.mockResolvedValue({ summary: {}, content: '# Old' });
    runDesignWriter.mockImplementation(async (_cfg: unknown, onEvent: (e: unknown) => void) => {
      onEvent({ type: 'text-delta', text: 'a' });
      onEvent({ type: 'done', text: 'a' });
    });
    const r = (await handlers.get('design:draft')!({}, 'p1', draft('R3', 'revise'))) as { data: { runId: string } };
    await tick();
    expect(runDesignWriter.mock.calls[0][0]).toMatchObject({
      projectDir: '/repo', mode: 'revise', notes: 'n', brdSlug: 'todo-app', brdBody: '# Todo\nBody', existing: '# Old',
      requirement: { id: 'R3', title: 'Filter' }, siblingTitles: ['Sort'], modelShorthand: 'sonnet',
    });
    expect(sent).toEqual([
      ['design:draft-chunk', { runId: r.data.runId, text: 'a' }],
      ['design:draft-done', { runId: r.data.runId, text: 'a' }],
    ]);
    expect(await handlers.get('design:draft')!({}, 'p1', draft('R3'))).toMatchObject({ success: true });
    await tick();
  });

  it('draft refuses a second concurrent run and unknown requirements; cancel aborts', async () => {
    req.readRequirements.mockResolvedValue(set);
    brd.readBrd.mockResolvedValue({ summary: {}, content: '#' });
    runDesignWriter.mockImplementation(() => new Promise(() => {}));
    const r = (await handlers.get('design:draft')!({}, 'p1', draft('R3'))) as { data: { runId: string } };
    expect(await handlers.get('design:draft')!({}, 'p1', draft('R4'))).toEqual({ success: false, error: 'A draft is already running for this project' });
    expect(await handlers.get('design:draft-cancel')!({}, r.data.runId)).toEqual({ success: true });
    expect(await handlers.get('design:draft-cancel')!({}, 'nope')).toEqual({ success: false, error: 'No running draft with id nope' });
    await tick();
    expect(await handlers.get('design:draft')!({}, 'p1', draft('R9'))).toEqual({ success: false, error: 'Requirement R9 not found in todo-app' });
  });
});
