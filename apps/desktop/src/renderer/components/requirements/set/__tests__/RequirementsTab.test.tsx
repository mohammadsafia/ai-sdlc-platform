/**
 * @vitest-environment jsdom
 */
// apps/desktop/src/renderer/components/requirements/set/__tests__/RequirementsTab.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RequirementsTab } from '../RequirementsTab';
import { useRequirementsStore } from '../../../../stores/requirements-store';
import type { RequirementsSet } from '../../../../../shared/types/requirements';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && Object.keys(o).length > 0 ? `${k}:${Object.values(o).join(',')}` : k),
    i18n: { language: 'en' },
  }),
}));

const set: RequirementsSet = {
  version: 1, brdSlug: 'a', brdHash: 'H', status: 'draft', generatedAt: 't',
  requirements: [{ id: 'R1', title: 'Signup wizard', description: 'd', acceptanceCriteria: ['Has 3 steps'], area: 'Onboarding', needsDesign: true, included: true }],
  milestones: [{ id: 'M1', name: 'Foundations', description: 'd', order: 1, included: true }],
  tasks: [{ id: 'T1', title: 'Build wizard', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 1, included: true }],
};
const api = { requirementsGenerate: vi.fn(), requirementsWrite: vi.fn(), requirementsApprove: vi.fn(), requirementsCancel: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  useRequirementsStore.getState().reset();
  useRequirementsStore.setState({ slug: 'a', currentBrdHash: 'H' });
});

describe('RequirementsTab', () => {
  it('shows the empty state with Generate, and the structure gate message when the BRD is not ready', () => {
    const { rerender } = render(<RequirementsTab projectId="p1" brdReady={true} missingSections={[]} />);
    expect(screen.getByText('set.none')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'set.generate' })).toBeEnabled();
    rerender(<RequirementsTab projectId="p1" brdReady={false} missingSections={['Milestones']} />);
    expect(screen.getByRole('button', { name: 'set.generate' })).toBeDisabled();
    expect(screen.getByText(/Milestones/)).toBeInTheDocument();
  });

  it('shows the running state with phase and cancel', () => {
    useRequirementsStore.setState({ run: { status: 'running', runId: 'r1', phase: 'parsing' } });
    render(<RequirementsTab projectId="p1" brdReady={true} missingSections={[]} />);
    expect(screen.getByText('set.phase.parsing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'set.cancel' })).toBeInTheDocument();
  });

  it('renders the set, blocks Approve while warnings exist, and toggles the refine label with selection', async () => {
    useRequirementsStore.setState({ set, savedSet: set, warnings: [] });
    render(<RequirementsTab projectId="p1" brdReady={true} missingSections={[]} />);
    expect(screen.getByDisplayValue('Signup wizard')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Foundations')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Build wizard')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'set.approve' })).toBeEnabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'set.fields.included T1' }));
    expect(screen.getByText('set.warnings')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'set.approve' })).toBeDisabled();

    expect(screen.getByRole('button', { name: 'set.assist.refineSet' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'set.fields.select R1' }));
    expect(screen.getByRole('button', { name: 'set.assist.refineSelected:1' })).toBeInTheDocument();
  });

  it('shows a proposal with counts and accept installs it', () => {
    const proposed = { ...set, requirements: [{ ...set.requirements[0], title: 'Renamed' }] };
    useRequirementsStore.setState({ set, savedSet: set, warnings: [], run: { status: 'proposal', runId: 'r1', proposal: { set: proposed, changeSummary: 'renamed', warnings: [] } } });
    render(<RequirementsTab projectId="p1" brdReady={true} missingSections={[]} />);
    expect(screen.getByText('renamed')).toBeInTheDocument();
    expect(screen.getAllByText(/set\.assist\.counts:/).length).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: 'set.assist.accept' }));
    expect(useRequirementsStore.getState().set?.requirements[0].title).toBe('Renamed');
    expect(screen.getByText('set.unsaved')).toBeInTheDocument();
  });
});
