/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { JiraIntegration } from '../JiraIntegration';
import type { ProjectEnvConfig } from '../../../../../shared/types';
import { DEFAULT_JIRA_STATUS_MAP } from '../../../../../shared/jira/status-map';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && Object.keys(o).length ? `${k}:${Object.values(o).join(',')}` : k,
    i18n: { language: 'en' },
  }),
}));

const api = { jiraCheckConnection: vi.fn(), jiraGetMetadata: vi.fn() };
const env = (over: Partial<ProjectEnvConfig> = {}): ProjectEnvConfig =>
  ({
    linearEnabled: false,
    githubEnabled: false,
    gitlabEnabled: false,
    memoryEnabled: false,
    enableFancyUi: true,
    openaiKeyIsGlobal: false,
    jiraEnabled: true,
    jiraBaseUrl: 'https://acme.atlassian.net',
    jiraEmail: 'a@b.c',
    jiraApiToken: 't',
    jiraProjectKey: 'ACME',
    jiraStatusMap: DEFAULT_JIRA_STATUS_MAP,
    ...over,
  }) as ProjectEnvConfig;

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
});

describe('JiraIntegration', () => {
  it('tests the connection and shows the account and project', async () => {
    api.jiraCheckConnection.mockResolvedValue({ success: true, data: { accountName: 'Ann', projectName: 'Acme' } });
    render(<JiraIntegration projectId="p1" envConfig={env()} updateEnvConfig={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.test' }));
    expect(await screen.findByText('settings.connectedProject:Ann,Acme')).toBeInTheDocument();
    expect(api.jiraCheckConnection).toHaveBeenCalledWith('p1');
  });

  it('shows the error from a failed test', async () => {
    api.jiraCheckConnection.mockResolvedValue({ success: false, error: 'HTTP 401' });
    render(<JiraIntegration projectId="p1" envConfig={env()} updateEnvConfig={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.test' }));
    expect(await screen.findByText('HTTP 401')).toBeInTheDocument();
  });

  it('loads metadata into the selects and updates the status map', async () => {
    api.jiraGetMetadata.mockResolvedValue({
      success: true,
      data: { issueTypes: ['Task', 'Story', 'Epic'], statuses: ['To Do', 'In Review', 'Done'] },
    });
    const update = vi.fn();
    render(<JiraIntegration projectId="p1" envConfig={env()} updateEnvConfig={update} />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.loadMetadata' }));
    await waitFor(() => expect(screen.getByLabelText('settings.issueType')).toHaveDisplayValue('Task'));
    fireEvent.change(screen.getByLabelText('settings.issueType'), { target: { value: 'Story' } });
    expect(update).toHaveBeenCalledWith({ jiraIssueType: 'Story' });
    fireEvent.change(screen.getByLabelText('settings.kanbanStatus.human_review'), { target: { value: 'In Review' } });
    expect(update).toHaveBeenCalledWith({ jiraStatusMap: { ...DEFAULT_JIRA_STATUS_MAP, human_review: 'In Review' } });
    fireEvent.change(screen.getByLabelText('settings.kanbanStatus.error'), { target: { value: '' } });
    expect(update).toHaveBeenLastCalledWith({ jiraStatusMap: { ...DEFAULT_JIRA_STATUS_MAP, error: null } });
  });

  it('hides the form when disabled and toggles the flag', () => {
    const update = vi.fn();
    render(<JiraIntegration projectId="p1" envConfig={env({ jiraEnabled: false })} updateEnvConfig={update} />);
    expect(screen.queryByLabelText('settings.baseUrl')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch'));
    expect(update).toHaveBeenCalledWith({ jiraEnabled: true });
  });
});
