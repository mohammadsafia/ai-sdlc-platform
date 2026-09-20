/**
 * @vitest-environment jsdom
 */
// apps/desktop/src/renderer/components/requirements/__tests__/RequirementsView.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RequirementsView } from '../RequirementsView';
import { useBrdStore } from '../../../stores/brd-store';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }) }));
vi.mock('react-markdown', () => ({ default: ({ children }: { children: string }) => <div>{children}</div> }));
vi.mock('remark-gfm', () => ({ default: () => null }));

const api = {
  brdList: vi.fn(),
  brdRead: vi.fn(),
  brdCreate: vi.fn(),
  onBrdDraftChunk: vi.fn(() => () => undefined),
  onBrdDraftDone: vi.fn(() => () => undefined),
  onBrdDraftError: vi.fn(() => () => undefined),
};
const doc = '---\ntitle: A\nstatus: draft\ncreated: 2026-09-20\n---\n# A\n';

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  useBrdStore.getState().reset();
});

describe('RequirementsView', () => {
  it('lists BRDs on mount and opens one on click', async () => {
    api.brdList.mockResolvedValue({ success: true, data: [{ slug: 'a', title: 'A', status: 'review', modifiedAt: 't' }] });
    api.brdRead.mockResolvedValue({ success: true, data: { summary: { slug: 'a', title: 'A', status: 'review', modifiedAt: 't' }, content: doc } });
    render(<RequirementsView projectId="p1" />);
    expect(await screen.findByText('A')).toBeInTheDocument();
    expect(screen.getByText('status.review')).toBeInTheDocument();
    fireEvent.click(screen.getByText('A'));
    await waitFor(() => expect(api.brdRead).toHaveBeenCalledWith('p1', 'a'));
    expect(await screen.findByRole('textbox', { name: 'editor.markdown' })).toHaveValue(doc);
  });

  it('shows the empty state and creates a BRD through the dialog', async () => {
    api.brdList.mockResolvedValue({ success: true, data: [] });
    api.brdCreate.mockResolvedValue({ success: true, data: { slug: 'onboarding', title: 'Onboarding', status: 'draft', modifiedAt: 't' } });
    api.brdRead.mockResolvedValue({ success: true, data: { summary: { slug: 'onboarding', title: 'Onboarding', status: 'draft', modifiedAt: 't' }, content: doc } });
    render(<RequirementsView projectId="p1" />);
    expect(await screen.findByText('list.empty')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'list.newBrd' }));
    fireEvent.change(await screen.findByLabelText('newDialog.titleLabel'), { target: { value: 'Onboarding' } });
    fireEvent.click(screen.getByRole('button', { name: 'newDialog.create' }));
    await waitFor(() => expect(api.brdCreate).toHaveBeenCalledWith('p1', 'Onboarding'));
    expect((await screen.findAllByText('Onboarding')).length).toBeGreaterThan(0);
  });
});
