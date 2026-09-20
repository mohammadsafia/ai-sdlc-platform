/**
 * @vitest-environment jsdom
 */
// apps/desktop/src/renderer/components/project-settings/__tests__/SkillsSettings.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SkillsSettings } from '../SkillsSettings';
import { useSkillsStore } from '../../../stores/skills-store';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: Record<string, string>) => (opts?.commit ? `${key}:${opts.commit}` : key) }),
}));

const listSkills = vi.fn();
const refreshSkills = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = { listSkills, refreshSkills };
  useSkillsStore.setState({ snapshot: null, isLoading: false, error: null });
});

describe('SkillsSettings', () => {
  it('loads on mount and renders skills with source, pins, and status', async () => {
    listSkills.mockResolvedValue({
      success: true,
      data: {
        skills: [
          { name: 'fe', description: 'Frontend', source: 'local', dir: '/x/fe' },
          { name: 'fe', description: 'Central frontend', source: 'central', dir: '/y/fe', repoUrl: 'https://r', overriddenBy: 'local' },
        ],
        pins: { coder: ['fe'] },
        warnings: ['w1'],
        lock: { repos: { 'https://r': { ref: 'main', commit: 'abcdef1234567890', resolvedAt: 't' } } },
      },
    });
    render(<SkillsSettings projectId="p1" />);
    await waitFor(() => expect(listSkills).toHaveBeenCalledWith('p1'));
    expect(await screen.findByText('Frontend')).toBeInTheDocument();
    expect(screen.getByText('Central frontend')).toBeInTheDocument();
    expect(screen.getByText('projectSections.skills.status.overridden')).toBeInTheDocument();
    expect(screen.getByText('coder')).toBeInTheDocument();
    expect(screen.getByText('w1')).toBeInTheDocument();
    expect(screen.getByText('projectSections.skills.repos.commit:abcdef1')).toBeInTheDocument();
  });

  it('shows a blocking error banner', async () => {
    listSkills.mockResolvedValue({ success: true, data: { skills: [], pins: {}, warnings: [], error: 'BAD CONFIG', lock: { repos: {} } } });
    render(<SkillsSettings projectId="p1" />);
    expect(await screen.findByText('BAD CONFIG')).toBeInTheDocument();
    expect(screen.getByText('projectSections.skills.blockingError')).toBeInTheDocument();
  });

  it('refresh button calls refreshSkills', async () => {
    listSkills.mockResolvedValue({ success: true, data: { skills: [], pins: {}, warnings: [], lock: { repos: {} } } });
    refreshSkills.mockResolvedValue({ success: true, data: { skills: [], pins: {}, warnings: [], lock: { repos: {} } } });
    render(<SkillsSettings projectId="p1" />);
    await screen.findByText('projectSections.skills.empty');
    fireEvent.click(screen.getByRole('button', { name: 'projectSections.skills.refresh' }));
    await waitFor(() => expect(refreshSkills).toHaveBeenCalledWith('p1'));
  });
});
