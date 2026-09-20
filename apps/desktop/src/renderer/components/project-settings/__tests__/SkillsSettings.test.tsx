/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SkillsSettings, shortRepoLabel } from '../SkillsSettings';
import { useSkillsStore } from '../../../stores/skills-store';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.commit) return `${key}:${opts.commit}`;
      if (opts?.count !== undefined) return `${key}:${opts.count}`;
      return key;
    },
  }),
}));

const listSkills = vi.fn();
const refreshSkills = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = { listSkills, refreshSkills };
  useSkillsStore.setState({ snapshot: null, isLoading: false, error: null });
});

describe('shortRepoLabel', () => {
  it('reduces git urls to owner/repo', () => {
    expect(shortRepoLabel('https://github.com/acme/skills.git')).toBe('acme/skills');
    expect(shortRepoLabel('git@bitbucket.org:team/ai-skills.git')).toBe('team/ai-skills');
    expect(shortRepoLabel('ssh://git@host/deep/path/repo')).toBe('path/repo');
    expect(shortRepoLabel('https://r')).toBe('r');
  });
});

describe('SkillsSettings', () => {
  const snapshot = {
    skills: [
      { name: 'fe', description: 'Frontend', source: 'local', dir: '/x/fe' },
      { name: 'fe', description: 'Central frontend', source: 'central', dir: '/y/fe', repoUrl: 'https://github.com/acme/skills.git', overriddenBy: 'local' },
    ],
    pins: { coder: ['fe'] },
    warnings: ['w1', 'w2'],
    lock: { repos: { 'https://github.com/acme/skills.git': { ref: 'main', commit: 'abcdef1234567890', resolvedAt: 't' } } },
  };

  it('loads on mount and renders skills with source, short repo, pins, and status badge', async () => {
    listSkills.mockResolvedValue({ success: true, data: snapshot });
    render(<SkillsSettings projectId="p1" />);
    await waitFor(() => expect(listSkills).toHaveBeenCalledWith('p1'));
    expect(await screen.findByText('Frontend')).toBeInTheDocument();
    expect(screen.getByText('Central frontend')).toBeInTheDocument();
    expect(screen.getByText('projectSections.skills.status.overridden')).toBeInTheDocument();
    expect(screen.getByText('projectSections.skills.status.active')).toBeInTheDocument();
    expect(screen.getByText('coder')).toBeInTheDocument();
    expect(screen.getAllByText('acme/skills').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('https://github.com/acme/skills.git')).not.toBeInTheDocument();
    expect(screen.getByText('projectSections.skills.repos.commit:abcdef1')).toBeInTheDocument();
  });

  it('keeps warnings collapsed behind a count until expanded', async () => {
    listSkills.mockResolvedValue({ success: true, data: snapshot });
    render(<SkillsSettings projectId="p1" />);
    const trigger = await screen.findByRole('button', { name: 'projectSections.skills.warningsCount:2' });
    expect(screen.queryByText('w1')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(await screen.findByText('w1')).toBeInTheDocument();
    expect(screen.getByText('w2')).toBeInTheDocument();
  });

  it('keeps the how-to hint collapsed until expanded', async () => {
    listSkills.mockResolvedValue({ success: true, data: { ...snapshot, warnings: [] } });
    render(<SkillsSettings projectId="p1" />);
    const trigger = await screen.findByRole('button', { name: 'projectSections.skills.howToTitle' });
    expect(screen.queryByText('.claude/skills/<name>/SKILL.md')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(await screen.findByText('.claude/skills/<name>/SKILL.md')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /warningsCount/ })).not.toBeInTheDocument();
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
