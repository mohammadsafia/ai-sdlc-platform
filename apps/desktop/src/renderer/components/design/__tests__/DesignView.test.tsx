/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DesignView } from '../DesignView';
import { useDesignStore } from '../../../stores/design-store';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && Object.keys(o).length ? `${k}:${Object.values(o).join(',')}` : k),
    i18n: { language: 'en' },
  }),
}));
vi.mock('react-markdown', () => ({ default: ({ children }: { children: string }) => <div data-testid="preview">{children}</div> }));
vi.mock('remark-gfm', () => ({ default: () => null }));

const summary = { brdSlug: 'a', requirementId: 'R1', title: 'One', status: 'draft' as const, modifiedAt: 't' };
const doc = '---\nbrd: a\nrequirement: R1\ntitle: One\nstatus: draft\nupdated: 2026-09-21\n---\n# One\n\n## Summary\nText\n';
const set = {
  requirements: [
    { id: 'R1', title: 'One', description: 'd1', acceptanceCriteria: ['c1'], area: 'x', needsDesign: true, included: true },
    { id: 'R2', title: 'Two', description: 'd2', acceptanceCriteria: ['c2'], area: 'x', needsDesign: true, included: true },
  ],
};
const api = {
  brdList: vi.fn(),
  requirementsRead: vi.fn(),
  designList: vi.fn(),
  designRead: vi.fn(),
  designWrite: vi.fn(),
  designCreate: vi.fn(),
  designSetStatus: vi.fn(),
  designDraft: vi.fn(),
  designDraftCancel: vi.fn(),
  onDesignDraftChunk: vi.fn(() => () => undefined),
  onDesignDraftDone: vi.fn(() => () => undefined),
  onDesignDraftError: vi.fn(() => () => undefined),
  brdChanges: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  api.brdList.mockResolvedValue({ success: true, data: [{ slug: 'a', title: 'A' }] });
  api.requirementsRead.mockResolvedValue({ success: true, data: { set } });
  api.designList.mockResolvedValue({ success: true, data: [summary] });
  api.brdChanges.mockResolvedValue({ success: false });
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  useDesignStore.getState().reset();
});

describe('DesignView', () => {
  it('lists needsDesign requirements with status chips and opens a brief', async () => {
    api.designRead.mockResolvedValue({ success: true, data: { summary, content: doc } });
    render(<DesignView projectId="p1" />);
    expect(await screen.findByText('One')).toBeInTheDocument();
    expect(screen.getByText('status.draft')).toBeInTheDocument();
    expect(screen.getByText('status.none')).toBeInTheDocument();
    fireEvent.click(screen.getByText('One'));
    expect(await screen.findByLabelText('editor.markdown')).toHaveValue(doc);
    expect(screen.getByRole('button', { name: 'editor.approve' })).toBeInTheDocument();
  });

  it('shows the empty state for a requirement without a brief and creates from template', async () => {
    api.designRead.mockResolvedValue({ success: false, error: 'Design brief not found: a/R2' });
    api.designCreate.mockResolvedValue({ success: true, data: { ...summary, requirementId: 'R2', title: 'Two' } });
    render(<DesignView projectId="p1" />);
    fireEvent.click(await screen.findByText('Two'));
    expect(await screen.findByText('empty.title:R2')).toBeInTheDocument();
    expect(screen.getByText('c2')).toBeInTheDocument();
    api.designRead.mockResolvedValue({ success: true, data: { summary: { ...summary, requirementId: 'R2' }, content: doc } });
    fireEvent.click(screen.getByRole('button', { name: 'empty.createFromTemplate' }));
    await waitFor(() => expect(api.designCreate).toHaveBeenCalledWith('p1', 'a', 'R2'));
    expect(await screen.findByLabelText('editor.markdown')).toBeInTheDocument();
  });

  it('approves and unapproves', async () => {
    api.designRead.mockResolvedValue({ success: true, data: { summary, content: doc } });
    api.designSetStatus.mockResolvedValue({ success: true, data: { ...summary, status: 'approved' } });
    render(<DesignView projectId="p1" />);
    fireEvent.click(await screen.findByText('One'));
    fireEvent.click(await screen.findByRole('button', { name: 'editor.approve' }));
    await waitFor(() => expect(api.designSetStatus).toHaveBeenCalledWith('p1', 'a', 'R1', 'approved'));
    expect(await screen.findByRole('button', { name: 'editor.unapprove' })).toBeInTheDocument();
  });

  it('guards unsaved changes when switching requirements', async () => {
    api.designRead.mockResolvedValue({ success: true, data: { summary, content: doc } });
    render(<DesignView projectId="p1" />);
    fireEvent.click(await screen.findByText('One'));
    const editor = await screen.findByLabelText('editor.markdown');
    fireEvent.change(editor, { target: { value: `${doc}more` } });
    fireEvent.click(screen.getByText('Two'));
    expect(await screen.findByText('unsavedDialog.title')).toBeInTheDocument();
  });
});
