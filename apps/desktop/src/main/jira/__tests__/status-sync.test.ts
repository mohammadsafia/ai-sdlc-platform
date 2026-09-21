// apps/desktop/src/main/jira/__tests__/status-sync.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { cfg, clientMock, fsMock, store } = vi.hoisted(() => ({
  cfg: { getJiraConfig: vi.fn(), createJiraClient: vi.fn() },
  clientMock: { transitions: vi.fn(), transition: vi.fn() },
  fsMock: { readFileSync: vi.fn(), writeFileSync: vi.fn(), existsSync: vi.fn(() => true) },
  store: { getProject: vi.fn(() => ({ id: 'p1', path: '/repo', autoBuildPath: '.auto-claude' })) },
}));
vi.mock('../config', () => cfg);
vi.mock('node:fs', () => fsMock);
vi.mock('../../project-store', () => ({ projectStore: store }));

import { scheduleJiraSync, syncTaskStatus } from '../status-sync';

beforeEach(() => {
  vi.clearAllMocks();
  cfg.getJiraConfig.mockReturnValue({ baseUrl: 'https://j', email: 'e', apiToken: 't', projectKey: 'ACME', issueType: 'Task', epicIssueType: 'Epic', statusMap: { backlog: 'To Do', queue: 'To Do', in_progress: 'In Progress', ai_review: 'In Progress', human_review: 'In Progress', done: 'Done', pr_created: 'Done', error: null } });
  cfg.createJiraClient.mockReturnValue(clientMock);
  fsMock.readFileSync.mockReturnValue(JSON.stringify({ jiraKey: 'ACME-2' }));
  clientMock.transitions.mockResolvedValue([{ id: '11', name: 'Start', to: { name: 'In Progress' } }, { id: '31', name: 'Finish', to: { name: 'Done' } }]);
  clientMock.transition.mockResolvedValue(undefined);
});

describe('syncTaskStatus', () => {
  it('posts the transition whose target matches the mapped status and records it', async () => {
    const r = await syncTaskStatus('p1', '001-t', 'done');
    expect(r).toEqual({ synced: true });
    expect(clientMock.transition).toHaveBeenCalledWith('ACME-2', '31');
    const written = JSON.parse(fsMock.writeFileSync.mock.calls[0][1] as string);
    expect(written).toMatchObject({ jiraKey: 'ACME-2', jiraSyncedStatus: 'Done' });
    expect(written.jiraSyncError).toBeUndefined();
  });
  it('does nothing for unlinked tasks, unmapped statuses, or disabled Jira', async () => {
    fsMock.readFileSync.mockReturnValueOnce(JSON.stringify({}));
    expect(await syncTaskStatus('p1', '001-t', 'done')).toEqual({ synced: false });
    expect(await syncTaskStatus('p1', '001-t', 'error')).toEqual({ synced: false });
    cfg.getJiraConfig.mockReturnValueOnce(null);
    expect(await syncTaskStatus('p1', '001-t', 'done')).toEqual({ synced: false });
    expect(clientMock.transition).not.toHaveBeenCalled();
  });
  it('records an error when no transition leads to the target', async () => {
    clientMock.transitions.mockResolvedValueOnce([{ id: '11', name: 'Start', to: { name: 'In Progress' } }]);
    const r = await syncTaskStatus('p1', '001-t', 'done');
    expect(r.synced).toBe(false);
    expect(r.error).toBe("No transition to 'Done' is available from the issue's current status");
    expect(JSON.parse(fsMock.writeFileSync.mock.calls[0][1] as string).jiraSyncError).toBe(r.error);
  });
  it('debounces rapid status changes into one transition', async () => {
    vi.useFakeTimers();
    scheduleJiraSync('p1', '001-t', 'in_progress', 50);
    scheduleJiraSync('p1', '001-t', 'done', 50);
    await vi.advanceTimersByTimeAsync(60);
    expect(clientMock.transitions).toHaveBeenCalledTimes(1);
    expect(clientMock.transition).toHaveBeenCalledWith('ACME-2', '31');
    vi.useRealTimers();
  });
});
