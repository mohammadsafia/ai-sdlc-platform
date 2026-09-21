/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { JiraIssues } from '../JiraIssues';
import { useJiraIssuesStore } from '../../stores/jira/issues-store';
import { useProjectStore } from '../../stores/project-store';
import { useProjectEnvStore } from '../../stores/project-env-store';
import type { ProjectEnvConfig } from '../../../shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && Object.keys(o).length ? `${k}:${Object.values(o).join(',')}` : k,
    i18n: { language: 'en' },
  }),
}));
vi.mock('../../stores/task-store', () => ({ useTaskStore: { getState: () => ({ addTask: vi.fn() }) } }));

const api = { jiraSearchIssues: vi.fn(), jiraImportIssues: vi.fn() };
const issue = (key: string, imported = false) => ({
  key,
  summary: `Sum ${key}`,
  status: 'To Do',
  issueType: 'Task',
  updated: '2026-09-21T00:00:00Z',
  url: `https://j/${key}`,
  imported,
});

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  useJiraIssuesStore.getState().reset();
  useProjectStore.setState({ projects: [{ id: 'p1', name: 'todo', path: '/p' }], selectedProjectId: 'p1' } as never);
  useProjectEnvStore.setState({ projectId: 'p1', envConfig: { jiraEnabled: true, jiraProjectKey: 'ACME' } as ProjectEnvConfig });
});

describe('JiraIssues', () => {
  it('shows the not-connected state when Jira is disabled', () => {
    useProjectEnvStore.setState({ envConfig: { jiraEnabled: false } as ProjectEnvConfig });
    const onOpenSettings = vi.fn();
    render(<JiraIssues onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByRole('button', { name: 'view.openSettings' }));
    expect(onOpenSettings).toHaveBeenCalled();
    expect(api.jiraSearchIssues).not.toHaveBeenCalled();
  });

  it('loads issues, marks imported ones, selects, and imports', async () => {
    api.jiraSearchIssues.mockResolvedValue({ success: true, data: { issues: [issue('ACME-1'), issue('ACME-2', true)] } });
    api.jiraImportIssues.mockResolvedValue({ success: true, data: { imported: 1, skipped: [], failed: [], tasks: [] } });
    render(<JiraIssues onOpenSettings={vi.fn()} />);
    expect(await screen.findByText('Sum ACME-1')).toBeInTheDocument();
    expect(screen.getByText('view.imported')).toBeInTheDocument();
    expect(screen.getByLabelText('ACME-2')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('ACME-1'));
    fireEvent.click(screen.getByRole('button', { name: 'view.import:1' }));
    await waitFor(() => expect(api.jiraImportIssues).toHaveBeenCalledWith('p1', ['ACME-1']));
    expect(await screen.findByText('view.importResult:1,0,0')).toBeInTheDocument();
  });
});
