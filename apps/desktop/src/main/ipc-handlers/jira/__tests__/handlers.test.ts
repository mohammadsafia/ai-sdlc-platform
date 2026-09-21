// apps/desktop/src/main/ipc-handlers/jira/__tests__/handlers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { handlers, store, cfg, clientMock, createTask, push, sync } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  store: { getProject: vi.fn(), getTasks: vi.fn((): Array<Record<string, unknown>> => []) },
  cfg: { getJiraConfig: vi.fn(), createJiraClient: vi.fn() },
  clientMock: { myself: vi.fn(), project: vi.fn(), statuses: vi.fn(), search: vi.fn(), issue: vi.fn(), browseUrl: (k: string) => `https://j/browse/${k}` },
  createTask: vi.fn(),
  push: { pushMilestoneToJira: vi.fn() },
  sync: { syncTaskStatus: vi.fn() },
}));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn((c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn)) } }));
vi.mock('../../../project-store', () => ({ projectStore: store }));
vi.mock('../../../jira/config', () => cfg);
vi.mock('../../task/create-task', () => ({ createTaskInProject: createTask }));
vi.mock('../../../jira/push-milestone', () => push);
vi.mock('../../../jira/status-sync', () => sync);
vi.mock('../../requirements-handlers', () => ({ tryAcquireSlugLock: vi.fn(() => () => undefined) }));

import { registerJiraHandlers } from '../index';

beforeEach(() => {
  handlers.clear(); vi.clearAllMocks();
  store.getProject.mockReturnValue({ id: 'p1', path: '/repo', autoBuildPath: '.auto-claude' });
  cfg.getJiraConfig.mockReturnValue({ baseUrl: 'https://j', email: 'e', apiToken: 't', projectKey: 'ACME', issueType: 'Task', epicIssueType: 'Epic', statusMap: {} });
  cfg.createJiraClient.mockReturnValue(clientMock);
  registerJiraHandlers();
});

describe('jira handlers', () => {
  it('checkConnection returns account and project names', async () => {
    clientMock.myself.mockResolvedValue({ accountId: '1', displayName: 'Ann' });
    clientMock.project.mockResolvedValue({ id: '1', key: 'ACME', name: 'Acme', issueTypes: [] });
    expect(await handlers.get('jira:checkConnection')!({}, 'p1')).toEqual({ success: true, data: { accountName: 'Ann', projectName: 'Acme' } });
  });
  it('refuses when Jira is not configured', async () => {
    cfg.getJiraConfig.mockReturnValueOnce(null);
    expect(await handlers.get('jira:checkConnection')!({}, 'p1')).toEqual({ success: false, error: 'Jira is not configured for this project' });
  });
  it('getMetadata lists non-subtask issue types and statuses', async () => {
    clientMock.project.mockResolvedValue({ id: '1', key: 'ACME', name: 'Acme', issueTypes: [{ id: '1', name: 'Task', subtask: false }, { id: '2', name: 'Sub-task', subtask: true }, { id: '3', name: 'Epic', subtask: false }] });
    clientMock.statuses.mockResolvedValue(['To Do', 'Done']);
    expect(await handlers.get('jira:getMetadata')!({}, 'p1')).toEqual({ success: true, data: { issueTypes: ['Task', 'Epic'], statuses: ['To Do', 'Done'] } });
  });
  it('searchIssues composes JQL and flags imported keys', async () => {
    store.getTasks.mockReturnValue([{ id: 'x', metadata: { jiraKey: 'ACME-2' } }]);
    clientMock.search.mockResolvedValue({ isLast: false, nextPageToken: 'n', issues: [{ key: 'ACME-2', fields: { summary: 'S', status: { name: 'To Do' }, issuetype: { name: 'Task' }, assignee: { displayName: 'Ann' }, updated: 'u' } }] });
    const r = (await handlers.get('jira:searchIssues')!({}, 'p1', { status: 'To Do', jql: 'labels = x' })) as { data: { issues: unknown[]; nextPageToken?: string } };
    expect(clientMock.search.mock.calls[0][0].jql).toBe('project = "ACME" AND status = "To Do" AND (labels = x) ORDER BY updated DESC');
    expect(r.data.issues[0]).toEqual({ key: 'ACME-2', summary: 'S', status: 'To Do', issueType: 'Task', assignee: 'Ann', updated: 'u', url: 'https://j/browse/ACME-2', imported: true });
    expect(r.data.nextPageToken).toBe('n');
  });
  it('importIssues skips linked keys, creates tasks, and reports failures', async () => {
    store.getTasks.mockReturnValue([{ id: 'x', metadata: { jiraKey: 'ACME-1' } }]);
    clientMock.issue.mockImplementation(async (key: string) => { if (key === 'ACME-3') throw new Error('boom'); return { key, fields: { summary: `Sum ${key}`, description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] } } }; });
    createTask.mockImplementation((_p: unknown, input: { title: string; metadata: unknown }) => ({ id: 's', specId: 's', title: input.title, metadata: input.metadata }));
    const r = (await handlers.get('jira:importIssues')!({}, 'p1', ['ACME-1', 'ACME-2', 'ACME-3'])) as { data: { imported: number; skipped: string[]; failed: unknown[]; tasks: unknown[] } };
    expect(r.data.imported).toBe(1);
    expect(r.data.skipped).toEqual(['ACME-1']);
    expect(r.data.failed).toEqual([{ key: 'ACME-3', error: 'boom' }]);
    const input = createTask.mock.calls[0][1];
    expect(input.title).toBe('Sum ACME-2');
    expect(input.description).toContain('Body');
    expect(input.description).toContain('Source: https://j/browse/ACME-2');
    expect(input.metadata).toEqual({ sourceType: 'jira', jiraKey: 'ACME-2', jiraUrl: 'https://j/browse/ACME-2', category: 'feature' });
  });
  it('pushMilestone delegates under the slug lock and retrySync delegates', async () => {
    push.pushMilestoneToJira.mockResolvedValue({ set: { version: 1 }, warnings: ['w'] });
    expect(await handlers.get('jira:pushMilestone')!({}, 'p1', 'a', 'M1')).toEqual({ success: true, data: { set: { version: 1 }, warnings: ['w'] } });
    sync.syncTaskStatus.mockResolvedValue({ synced: true });
    store.getTasks.mockReturnValue([{ id: '001-t', specId: '001-t', status: 'done' }]);
    expect(await handlers.get('jira:retrySync')!({}, 'p1', '001-t')).toEqual({ success: true, data: { synced: true } });
    expect(sync.syncTaskStatus).toHaveBeenCalledWith('p1', '001-t', 'done');
  });
});
