/**
 * @vitest-environment jsdom
 */
// apps/desktop/src/renderer/components/requirements/set/__tests__/RequirementsSetEditor.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RequirementsSetEditor } from '../RequirementsSetEditor';
import { useRequirementsStore } from '../../../../stores/requirements-store';
import { useTaskStore } from '../../../../stores/task-store';
import { useProjectEnvStore } from '../../../../stores/project-env-store';
import { useDesignStore } from '../../../../stores/design-store';
import { DesignNavigationProvider } from '../../../../contexts/DesignNavigationContext';
import type { RequirementsSet } from '../../../../../shared/types/requirements';
import type { Task } from '../../../../../shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && Object.keys(o).length > 0 ? `${k}:${Object.values(o).join(',')}` : k),
    i18n: { language: 'en' },
  }),
}));

const set: RequirementsSet = {
  version: 1, brdSlug: 'a', brdHash: 'H', status: 'approved', generatedAt: 't', approvedAt: 't',
  requirements: [{ id: 'R1', title: 'Signup wizard', description: 'd', acceptanceCriteria: ['Has 3 steps'], area: 'Onboarding', needsDesign: true, included: true }],
  milestones: [
    { id: 'M1', name: 'Foundations', description: 'd', order: 1, included: true },
    { id: 'M2', name: 'Growth', description: 'd', order: 2, included: true },
  ],
  tasks: [
    { id: 'T1', title: 'Build wizard', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 1, included: true },
    { id: 'T2', title: 'Add invites', description: 'd', milestoneId: 'M2', requirementIds: ['R1'], category: 'feature', order: 1, included: true },
  ],
};
const m1Release = { releasedAt: '2026-09-21T10:00:00.000Z', tasks: [{ proposedTaskId: 'T1', specId: '001-build-wizard' }] };
const released: RequirementsSet = { ...set, releases: { M1: m1Release } };
const api = { requirementsRelease: vi.fn(), requirementsGenerate: vi.fn(), requirementsWrite: vi.fn(), requirementsApprove: vi.fn(), requirementsCancel: vi.fn(), jiraPushMilestone: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  useRequirementsStore.getState().reset();
  useTaskStore.setState({ tasks: [] });
  useProjectEnvStore.setState({ envConfig: null });
});

describe('RequirementsSetEditor release controls', () => {
  it('shows an enabled Release button on the next milestone only and calls release', async () => {
    useRequirementsStore.setState({ slug: 'a', set, savedSet: set, currentBrdHash: 'H' });
    api.requirementsRelease.mockResolvedValue({ success: true, data: { set: released, tasks: [] } });
    render(<RequirementsSetEditor projectId="p1" />);
    const buttons = screen.getAllByRole('button', { name: 'release.button' });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toBeEnabled();
    expect(buttons[1]).toBeDisabled();
    expect(screen.getByText('release.reason.notNext')).toBeInTheDocument();
    fireEvent.click(buttons[0]);
    expect(api.requirementsRelease).toHaveBeenCalledWith('p1', 'a', 'M1');
  });

  it('shows the gate reason when the set is not approved', () => {
    const draft = { ...set, status: 'draft' as const };
    useRequirementsStore.setState({ slug: 'a', set: draft, savedSet: draft, currentBrdHash: 'H' });
    render(<RequirementsSetEditor projectId="p1" />);
    expect(screen.getAllByRole('button', { name: 'release.button' })[0]).toBeDisabled();
    // Status is checked before ordering, so every milestone reports the same reason
    expect(screen.getAllByText('release.reason.notApproved')).toHaveLength(2);
  });

  it('renders released items read-only with a badge, a status chip, and a rollup', () => {
    useRequirementsStore.setState({ slug: 'a', set: released, savedSet: released, currentBrdHash: 'H' });
    useTaskStore.setState({ tasks: [{ id: '001-build-wizard', specId: '001-build-wizard', status: 'in_progress' } as unknown as Task] });
    render(<RequirementsSetEditor projectId="p1" />);
    expect(screen.getByText(/release\.released:/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Build wizard')).toBeDisabled();
    expect(screen.getByDisplayValue('Foundations')).toBeDisabled();
    expect(screen.getByLabelText('set.fields.included T1')).toBeDisabled();
    expect(screen.getByLabelText('set.fields.select T1')).toBeDisabled();
    expect(screen.getByDisplayValue('Add invites')).toBeEnabled();
    expect(screen.getByText('release.status.in_progress')).toBeInTheDocument();
    expect(screen.getByText('release.rollup:0,1')).toBeInTheDocument();
    // M1 is locked so its move arrows are hidden; M2 still has its pair
    expect(screen.getAllByLabelText('set.fields.moveUp')).toHaveLength(1);
  });

  it('shows "not on this machine" when the released spec has no local task', () => {
    useRequirementsStore.setState({ slug: 'a', set: released, savedSet: released, currentBrdHash: 'H' });
    render(<RequirementsSetEditor projectId="p1" />);
    expect(screen.getByText('release.statusUnavailable')).toBeInTheDocument();
  });
});

describe('RequirementsSetEditor Jira chips', () => {
  const pushed: RequirementsSet = {
    ...released,
    releases: {
      M1: { ...m1Release, jira: { epicKey: 'ACME-1', issues: { T1: 'ACME-2' }, pushedAt: 't' } },
    },
  };

  it('shows Push to Jira on a released, unpushed milestone when Jira is enabled and calls the store', () => {
    useProjectEnvStore.setState({ envConfig: { jiraEnabled: true } as never });
    useRequirementsStore.setState({ slug: 'a', set: released, savedSet: released, currentBrdHash: 'H' });
    api.jiraPushMilestone.mockResolvedValue({ success: true, data: { set: pushed, warnings: [] } });
    render(<RequirementsSetEditor projectId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: 'chip.push' }));
    expect(api.jiraPushMilestone).toHaveBeenCalledWith('p1', 'a', 'M1');
  });

  it('shows the epic link and issue chips when pushed, and nothing when Jira is disabled', () => {
    useProjectEnvStore.setState({ envConfig: { jiraEnabled: true, jiraBaseUrl: 'https://j' } as never });
    useRequirementsStore.setState({ slug: 'a', set: pushed, savedSet: pushed, currentBrdHash: 'H' });
    const { unmount } = render(<RequirementsSetEditor projectId="p1" />);
    expect(screen.getByText('chip.epic:ACME-1')).toBeInTheDocument();
    expect(screen.getByText('ACME-2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'chip.push' })).not.toBeInTheDocument();
    unmount();
    useProjectEnvStore.setState({ envConfig: { jiraEnabled: false } as never });
    render(<RequirementsSetEditor projectId="p1" />);
    expect(screen.queryByText('chip.epic:ACME-1')).not.toBeInTheDocument();
    expect(screen.queryByText('ACME-2')).not.toBeInTheDocument();
  });
});

describe('RequirementsSetEditor design chips', () => {
  it('shows the brief status next to needsDesign requirements and navigates', () => {
    useDesignStore.setState({ briefs: [{ brdSlug: 'a', requirementId: 'R1', title: 'x', status: 'approved', modifiedAt: 't' }] });
    useRequirementsStore.setState({ slug: 'a', set, savedSet: set, currentBrdHash: 'H' });
    const navigate = vi.fn();
    render(
      <DesignNavigationProvider navigate={navigate}>
        <RequirementsSetEditor projectId="p1" />
      </DesignNavigationProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'view.title R1' }));
    expect(navigate).toHaveBeenCalledWith('a', 'R1');
    expect(screen.getByText('status.approved')).toBeInTheDocument();
  });
});
