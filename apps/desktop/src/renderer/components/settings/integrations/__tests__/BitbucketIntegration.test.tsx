/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BitbucketIntegration } from '../BitbucketIntegration';
import type { ProjectEnvConfig } from '../../../../../shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && Object.keys(o).length ? `${k}:${Object.values(o).join(',')}` : k),
    i18n: { language: 'en' },
  }),
}));

const api = { bitbucketCheckConnection: vi.fn(), bitbucketDetectRepo: vi.fn() };
const env = (over: Partial<ProjectEnvConfig> = {}): ProjectEnvConfig =>
  ({
    jiraEnabled: false,
    jiraEmail: 'jira@b.c',
    bitbucketEnabled: true,
    bitbucketEmail: 'a@b.c',
    bitbucketApiToken: 't',
    bitbucketWorkspace: 'acme',
    bitbucketRepoSlug: 'todo',
    ...over,
  }) as ProjectEnvConfig;

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
});

describe('BitbucketIntegration', () => {
  it('tests the connection and shows the account and repository', async () => {
    api.bitbucketCheckConnection.mockResolvedValue({ success: true, data: { accountName: 'Ann', repoName: 'acme/todo' } });
    render(<BitbucketIntegration projectId="p1" envConfig={env()} updateEnvConfig={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.test' }));
    expect(await screen.findByText('settings.connectedRepo:Ann,acme/todo')).toBeInTheDocument();
    expect(api.bitbucketCheckConnection).toHaveBeenCalledWith('p1');
  });

  it('shows the error from a failed test', async () => {
    api.bitbucketCheckConnection.mockResolvedValue({ success: false, error: 'HTTP 401' });
    render(<BitbucketIntegration projectId="p1" envConfig={env()} updateEnvConfig={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.test' }));
    expect(await screen.findByText('HTTP 401')).toBeInTheDocument();
  });

  it('detects the repository from the remote or explains that it is not Bitbucket', async () => {
    const update = vi.fn();
    api.bitbucketDetectRepo
      .mockResolvedValueOnce({ success: true, data: { workspace: 'acme', repoSlug: 'todo' } })
      .mockResolvedValueOnce({ success: true, data: null });
    render(<BitbucketIntegration projectId="p1" envConfig={env({ bitbucketWorkspace: '', bitbucketRepoSlug: '' })} updateEnvConfig={update} />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.detect' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ bitbucketWorkspace: 'acme', bitbucketRepoSlug: 'todo' }));
    fireEvent.click(screen.getByRole('button', { name: 'settings.detect' }));
    expect(await screen.findByText('settings.detectNone')).toBeInTheDocument();
  });

  it('hides the form when disabled and prefills the email from Jira on enable', () => {
    const update = vi.fn();
    render(<BitbucketIntegration projectId="p1" envConfig={env({ bitbucketEnabled: false, bitbucketEmail: undefined })} updateEnvConfig={update} />);
    expect(screen.queryByLabelText('settings.workspace')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch'));
    expect(update).toHaveBeenCalledWith({ bitbucketEnabled: true, bitbucketEmail: 'jira@b.c' });
  });
});
