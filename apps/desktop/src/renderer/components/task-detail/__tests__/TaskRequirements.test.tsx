/**
 * @vitest-environment jsdom
 */
// apps/desktop/src/renderer/components/task-detail/__tests__/TaskRequirements.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskRequirements } from '../TaskRequirements';
import type { Task } from '../../../../shared/types';
import { useDesignStore } from '../../../stores/design-store';
import { DesignNavigationProvider } from '../../../contexts/DesignNavigationContext';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const brdRead = vi.fn();
const requirementsRead = vi.fn();
const designList = vi.fn().mockResolvedValue({ success: true, data: [] });
beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = { brdRead, requirementsRead, designList };
  useDesignStore.getState().reset();
});

const set = {
  version: 1, brdSlug: 'todo-app', brdHash: 'H', status: 'approved', generatedAt: 't',
  requirements: [
    { id: 'R1', title: 'Add todos', description: 'd', acceptanceCriteria: ['x'], area: 'Core', needsDesign: false, included: true },
    { id: 'R2', title: 'Persist', description: 'd', acceptanceCriteria: ['y'], area: 'Storage', needsDesign: false, included: true },
  ],
  milestones: [{ id: 'M1', name: 'Core', description: 'd', order: 1, included: true }],
  tasks: [],
};
const task = {
  id: '001-x', projectId: 'p1',
  metadata: { sourceType: 'requirements', brdSlug: 'todo-app', milestoneId: 'M1', requirementIds: ['R1'], proposedTaskId: 'T1' },
} as unknown as Task;

describe('TaskRequirements', () => {
  it('shows the BRD title, milestone, and covered requirements, and opens the BRD', async () => {
    brdRead.mockResolvedValue({ success: true, data: { summary: { slug: 'todo-app', title: 'Todo app', status: 'draft', modifiedAt: 't' }, content: '' } });
    requirementsRead.mockResolvedValue({ success: true, data: { set, currentBrdHash: 'H' } });
    const onOpenBrd = vi.fn();
    render(<TaskRequirements task={task} onOpenBrd={onOpenBrd} />);
    expect(await screen.findByText('Todo app')).toBeInTheDocument();
    expect(brdRead).toHaveBeenCalledWith('p1', 'todo-app');
    expect(screen.getByText('Core')).toBeInTheDocument();
    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.getByText('Add todos')).toBeInTheDocument();
    expect(screen.queryByText('Persist')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'tasks:requirementsSection.openBrd' }));
    expect(onOpenBrd).toHaveBeenCalledWith('todo-app');
  });

  it('renders nothing for tasks without a BRD link or when the BRD is missing', async () => {
    const { container } = render(<TaskRequirements task={{ id: 't', projectId: 'p1', metadata: {} } as unknown as Task} />);
    expect(container).toBeEmptyDOMElement();
    brdRead.mockResolvedValue({ success: false, error: 'BRD not found: todo-app' });
    requirementsRead.mockResolvedValue({ success: true, data: { set: null, currentBrdHash: '' } });
    const { container: c2 } = render(<TaskRequirements task={task} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(c2).toBeEmptyDOMElement();
  });

  it('shows a design chip for needsDesign requirements', async () => {
    brdRead.mockResolvedValue({ success: true, data: { summary: { slug: 'todo-app', title: 'Todo app', status: 'draft', modifiedAt: 't' }, content: '' } });
    requirementsRead.mockResolvedValue({ success: true, data: { set: { ...set, requirements: [{ ...set.requirements[0], needsDesign: true }, set.requirements[1]] }, currentBrdHash: 'H' } });
    const navigate = vi.fn();
    render(
      <DesignNavigationProvider navigate={navigate}>
        <TaskRequirements task={task} />
      </DesignNavigationProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'view.title R1' }));
    expect(navigate).toHaveBeenCalledWith('todo-app', 'R1');
    expect(screen.getByText('status.none')).toBeInTheDocument();
    expect(designList).toHaveBeenCalledWith('p1');
  });
});
