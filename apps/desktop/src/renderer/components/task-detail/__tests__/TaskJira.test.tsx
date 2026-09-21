/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TaskJira } from '../TaskJira';
import type { Task } from '../../../../shared/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const api = { jiraRetrySync: vi.fn(), openExternal: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
});

describe('TaskJira', () => {
  it('renders nothing without a key', () => {
    const { container } = render(<TaskJira task={{ id: 't', projectId: 'p1', metadata: {} } as unknown as Task} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows key, epic, synced status, error, and retries', async () => {
    api.jiraRetrySync.mockResolvedValue({ success: true, data: { synced: true } });
    const task = {
      id: '001-t',
      specId: '001-t',
      projectId: 'p1',
      status: 'done',
      metadata: {
        jiraKey: 'ACME-2',
        jiraUrl: 'https://j/browse/ACME-2',
        jiraEpicKey: 'ACME-1',
        jiraSyncedStatus: 'In Progress',
        jiraSyncError: 'No transition',
      },
    } as unknown as Task;
    render(<TaskJira task={task} />);
    expect(screen.getByText('ACME-2')).toBeInTheDocument();
    expect(screen.getByText('ACME-1')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('No transition')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ACME-2'));
    expect(api.openExternal).toHaveBeenCalledWith('https://j/browse/ACME-2');
    fireEvent.click(screen.getByRole('button', { name: 'detail.retry' }));
    await waitFor(() => expect(api.jiraRetrySync).toHaveBeenCalledWith('p1', '001-t'));
    await waitFor(() => expect(screen.queryByText('No transition')).not.toBeInTheDocument());
  });

  it('keeps the error returned by a failed retry', async () => {
    api.jiraRetrySync.mockResolvedValue({ success: true, data: { synced: false, error: 'Still no transition' } });
    const task = { id: 't', specId: 't', projectId: 'p1', metadata: { jiraKey: 'ACME-3', jiraSyncError: 'x' } } as unknown as Task;
    render(<TaskJira task={task} />);
    fireEvent.click(screen.getByRole('button', { name: 'detail.retry' }));
    expect(await screen.findByText('Still no transition')).toBeInTheDocument();
  });
});
