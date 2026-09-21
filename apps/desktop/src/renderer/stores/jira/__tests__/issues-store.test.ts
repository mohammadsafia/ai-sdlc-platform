import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useJiraIssuesStore } from '../issues-store';

const { addTask } = vi.hoisted(() => ({ addTask: vi.fn() }));
vi.mock('../../task-store', () => ({ useTaskStore: { getState: () => ({ addTask }) } }));

const api = { jiraSearchIssues: vi.fn(), jiraImportIssues: vi.fn() };
const issue = (key: string, imported = false) => ({
  key,
  summary: `S ${key}`,
  status: 'To Do',
  issueType: 'Task',
  updated: 'u',
  url: `https://j/${key}`,
  imported,
});

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { window: unknown }).window = { electronAPI: api };
  useJiraIssuesStore.getState().reset();
});

describe('jira issues store', () => {
  it('load applies filters, loadMore appends with the page token', async () => {
    api.jiraSearchIssues.mockResolvedValueOnce({ success: true, data: { issues: [issue('A-1')], nextPageToken: 'n' } });
    useJiraIssuesStore.getState().setFilter({ status: 'To Do', jql: 'labels = x' });
    await useJiraIssuesStore.getState().load('p1');
    expect(api.jiraSearchIssues).toHaveBeenCalledWith('p1', { status: 'To Do', jql: 'labels = x' });
    api.jiraSearchIssues.mockResolvedValueOnce({ success: true, data: { issues: [issue('A-2')] } });
    await useJiraIssuesStore.getState().loadMore('p1');
    expect(api.jiraSearchIssues).toHaveBeenLastCalledWith('p1', { status: 'To Do', jql: 'labels = x', pageToken: 'n' });
    const s = useJiraIssuesStore.getState();
    expect(s.issues.map((i) => i.key)).toEqual(['A-1', 'A-2']);
    expect(s.nextPageToken).toBeUndefined();
  });

  it('search filters summaries locally without a request', async () => {
    api.jiraSearchIssues.mockResolvedValueOnce({
      success: true,
      data: { issues: [issue('A-1'), { ...issue('A-2'), summary: 'Login page' }] },
    });
    await useJiraIssuesStore.getState().load('p1');
    useJiraIssuesStore.getState().setFilter({ search: 'login' });
    expect(useJiraIssuesStore.getState().visibleIssues().map((i) => i.key)).toEqual(['A-2']);
    expect(api.jiraSearchIssues).toHaveBeenCalledTimes(1);
  });

  it('importSelected imports, marks issues imported, pushes tasks, and keeps the result', async () => {
    api.jiraSearchIssues.mockResolvedValueOnce({ success: true, data: { issues: [issue('A-1'), issue('A-2')] } });
    await useJiraIssuesStore.getState().load('p1');
    useJiraIssuesStore.getState().toggle('A-1');
    useJiraIssuesStore.getState().toggle('A-2');
    useJiraIssuesStore.getState().toggle('A-2');
    api.jiraImportIssues.mockResolvedValue({
      success: true,
      data: { imported: 1, skipped: [], failed: [], tasks: [{ id: 't', specId: 't', metadata: { jiraKey: 'A-1' } }] },
    });
    await useJiraIssuesStore.getState().importSelected('p1');
    expect(api.jiraImportIssues).toHaveBeenCalledWith('p1', ['A-1']);
    expect(addTask).toHaveBeenCalledTimes(1);
    const s = useJiraIssuesStore.getState();
    expect(s.issues.find((i) => i.key === 'A-1')?.imported).toBe(true);
    expect(s.issues.find((i) => i.key === 'A-2')?.imported).toBe(false);
    expect(s.selection).toEqual([]);
    expect(s.lastImport?.imported).toBe(1);
  });

  it('surfaces API errors', async () => {
    api.jiraSearchIssues.mockResolvedValueOnce({ success: false, error: 'HTTP 401' });
    await useJiraIssuesStore.getState().load('p1');
    expect(useJiraIssuesStore.getState().error).toBe('HTTP 401');
    expect(useJiraIssuesStore.getState().isLoading).toBe(false);
  });
});
