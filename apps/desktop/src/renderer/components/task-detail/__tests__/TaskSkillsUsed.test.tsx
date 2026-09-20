/**
 * @vitest-environment jsdom
 */
// apps/desktop/src/renderer/components/task-detail/__tests__/TaskSkillsUsed.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskSkillsUsed } from '../TaskSkillsUsed';
import type { Task } from '../../../../shared/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const readFile = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = { readFile };
});

const task = { id: 't1', specsPath: '/p/.auto-claude/specs/001-x' } as unknown as Task;

describe('TaskSkillsUsed', () => {
  it('renders deduplicated skills with pinned/loaded markers', async () => {
    readFile.mockResolvedValue({
      success: true,
      data: JSON.stringify([
        { name: 'std', agentType: 'coder', pinned: true, at: 't1' },
        { name: 'std', agentType: 'coder', pinned: true, at: 't2' },
        { name: 'docs', resource: 'ref/a.md', agentType: 'qa_reviewer', pinned: false, at: 't3' },
      ]),
    });
    render(<TaskSkillsUsed task={task} />);
    expect(await screen.findByText('std')).toBeInTheDocument();
    expect(readFile).toHaveBeenCalledWith('/p/.auto-claude/specs/001-x/skills_used.json');
    expect(screen.getAllByText('std')).toHaveLength(1);
    expect(screen.getByText('docs')).toBeInTheDocument();
    expect(screen.getByText('coder')).toBeInTheDocument();
    expect(screen.getByText('qa_reviewer')).toBeInTheDocument();
    expect(screen.getByText('tasks:skillsUsed.pinned')).toBeInTheDocument();
    expect(screen.getByText('ref/a.md')).toBeInTheDocument();
  });

  it('shows the empty message when the file is missing', async () => {
    readFile.mockResolvedValue({ success: false, error: 'ENOENT' });
    render(<TaskSkillsUsed task={task} />);
    expect(await screen.findByText('tasks:skillsUsed.empty')).toBeInTheDocument();
  });

  it('renders nothing without specsPath', () => {
    const { container } = render(<TaskSkillsUsed task={{ id: 't2' } as unknown as Task} />);
    expect(container).toBeEmptyDOMElement();
  });
});
