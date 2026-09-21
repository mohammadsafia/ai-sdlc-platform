/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrdCommitDialog, defaultCommitMessage } from '../BrdCommitDialog';
import { useBrdStore } from '../../../stores/brd-store';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && Object.keys(o).length ? `${k}:${Object.values(o).join(',')}` : k),
    i18n: { language: 'en' },
  }),
}));

const api = { brdCommit: vi.fn(), brdChanges: vi.fn() };
const files = [
  { path: 'docs/brd/todo-app.md', status: 'modified' as const },
  { path: 'docs/brd/todo-app.requirements.json', status: 'untracked' as const },
  { path: 'docs/brd/onboarding.md', status: 'untracked' as const },
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  useBrdStore.getState().reset();
  useBrdStore.setState({ changes: { branch: 'develop', files } });
  api.brdChanges.mockResolvedValue({ success: true, data: { branch: 'develop', files: [] } });
});

describe('defaultCommitMessage', () => {
  it('lists slugs once, sorted, and says add when everything is new', () => {
    expect(defaultCommitMessage(files)).toBe('docs(brd): update onboarding, todo-app');
    expect(defaultCommitMessage(files.slice(1))).toBe('docs(brd): add onboarding, todo-app');
    expect(defaultCommitMessage([{ path: 'docs/design/todo-app/R3.md', status: 'modified' }])).toBe('docs(design): update todo-app/R3');
    expect(defaultCommitMessage([{ path: 'docs/design/todo-app/R3.md', status: 'untracked' }, { path: 'docs/brd/todo-app.md', status: 'modified' }])).toBe('docs: update todo-app, todo-app/R3');
  });
});

describe('BrdCommitDialog', () => {
  it('lists files, prefills the message, commits with push, and shows the result', async () => {
    api.brdCommit.mockResolvedValue({ success: true, data: { commit: 'abc1234', pushed: true } });
    render(<BrdCommitDialog open onOpenChange={vi.fn()} projectId="p1" />);
    expect(screen.getByText('docs/brd/todo-app.md')).toBeInTheDocument();
    expect(screen.getByLabelText('commit.message')).toHaveValue('docs(brd): update onboarding, todo-app');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'commit.commit' }));
    await waitFor(() => expect(api.brdCommit).toHaveBeenCalledWith('p1', 'docs(brd): update onboarding, todo-app', true));
    expect(await screen.findByText('commit.donePushed:abc1234')).toBeInTheDocument();
  });

  it('remembers the push choice and shows a push warning', async () => {
    api.brdCommit.mockResolvedValue({ success: true, data: { commit: 'abc1234', pushed: false, pushError: 'rejected' } });
    render(<BrdCommitDialog open onOpenChange={vi.fn()} projectId="p1" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(localStorage.getItem('brd.commit.push')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'commit.commit' }));
    await waitFor(() => expect(api.brdCommit).toHaveBeenCalledWith('p1', expect.any(String), false));
    expect(await screen.findByText('commit.pushFailed:abc1234,rejected')).toBeInTheDocument();
  });
});
