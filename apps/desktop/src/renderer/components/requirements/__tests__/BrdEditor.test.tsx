/**
 * @vitest-environment jsdom
 */
// apps/desktop/src/renderer/components/requirements/__tests__/BrdEditor.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrdEditor } from '../BrdEditor';
import { useBrdStore } from '../../../stores/brd-store';
import { useRequirementsStore } from '../../../stores/requirements-store';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.error ? `${k}:${o.error}` : k), i18n: { language: 'en' } }),
}));
vi.mock('react-markdown', () => ({ default: ({ children }: { children: string }) => <div data-testid="preview">{children}</div> }));
vi.mock('remark-gfm', () => ({ default: () => null }));

const doc = '---\ntitle: A\nstatus: draft\ncreated: 2026-09-20\n---\n# A\n\n## Summary\n\nText\n';
const api = {
  brdWrite: vi.fn(),
  brdDraft: vi.fn(),
  brdDraftCancel: vi.fn(),
  requirementsRead: vi.fn().mockResolvedValue({ success: true, data: { set: null, currentBrdHash: 'x' } }),
};

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  useBrdStore.getState().reset();
  useBrdStore.setState({
    selectedSlug: 'a',
    selectedSummary: { slug: 'a', title: 'A', status: 'draft', modifiedAt: 't' },
    content: doc,
    savedContent: doc,
    structure: useBrdStore.getState().structure,
  });
  useBrdStore.getState().setContent(doc);
});

describe('BrdEditor', () => {
  it('shows the checklist with required sections and marks missing ones', () => {
    render(<BrdEditor projectId="p1" />);
    expect(screen.getByText('Summary')).toBeInTheDocument();
    expect(screen.getAllByText('structure.missing').length).toBeGreaterThan(0); // Problem and goals etc. are missing
    expect(screen.getByTestId('preview')).toHaveTextContent('# A');
  });

  it('typing marks the document dirty and Save writes it', async () => {
    api.brdWrite.mockResolvedValue({ success: true, data: { slug: 'a', title: 'A', status: 'draft', modifiedAt: 't2' } });
    render(<BrdEditor projectId="p1" />);
    fireEvent.change(screen.getByRole('textbox', { name: 'editor.markdown' }), { target: { value: `${doc}\nmore` } });
    expect(screen.getByText('editor.unsaved')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'editor.save' }));
    await screen.findByText('editor.saved');
    expect(api.brdWrite).toHaveBeenCalledWith('p1', 'a', `${doc}\nmore`);
  });

  it('Save refreshes the requirements BRD hash so staleness shows without reselecting', async () => {
    api.brdWrite.mockResolvedValue({ success: true, data: { slug: 'a', title: 'A', status: 'draft', modifiedAt: 't2' } });
    render(<BrdEditor projectId="p1" />);
    await waitFor(() => expect(useRequirementsStore.getState().currentBrdHash).toBe('x'));
    api.requirementsRead.mockResolvedValue({ success: true, data: { set: null, currentBrdHash: 'y' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'editor.markdown' }), { target: { value: `${doc}\nmore` } });
    fireEvent.click(screen.getByRole('button', { name: 'editor.save' }));
    await screen.findByText('editor.saved');
    await waitFor(() => expect(useRequirementsStore.getState().currentBrdHash).toBe('y'));
  });

  it('assist panel enables Revise for a non-empty document and shows a proposal to accept', async () => {
    api.brdDraft.mockResolvedValue({ success: true, data: { runId: 'r1' } });
    render(<BrdEditor projectId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: 'assist.title' }));
    const revise = screen.getByRole('button', { name: 'assist.revise' });
    expect(revise).toBeDisabled(); // no notes yet
    fireEvent.change(screen.getByRole('textbox', { name: 'assist.notesLabel' }), { target: { value: 'shorter' } });
    expect(revise).toBeEnabled();
    fireEvent.click(revise);
    await screen.findByText('assist.streaming');
    useBrdStore.setState({ draft: { status: 'proposal', runId: 'r1', text: 'PROPOSED' } });
    fireEvent.click(await screen.findByRole('button', { name: 'assist.accept' }));
    expect(useBrdStore.getState().content).toBe('PROPOSED');
    expect(screen.getByText('editor.unsaved')).toBeInTheDocument();
  });
});
