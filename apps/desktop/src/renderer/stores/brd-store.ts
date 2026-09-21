// apps/desktop/src/renderer/stores/brd-store.ts
import { create } from 'zustand';

import { checkBrdStructure } from '../../shared/brd/structure';
import type { BrdChanges, BrdCommitResult, BrdDraftMode, BrdStructureResult, BrdSummary } from '../../shared/types/brd';

export type DraftStatus = 'idle' | 'streaming' | 'proposal';

interface DraftState {
  status: DraftStatus;
  runId?: string;
  text: string;
  error?: string;
}

interface BrdState {
  brds: BrdSummary[];
  selectedSlug: string | null;
  selectedSummary: BrdSummary | null;
  content: string;
  savedContent: string;
  structure: BrdStructureResult | null;
  draft: DraftState;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  /** BRD to open once the Requirements view has loaded its list (set from task detail). */
  pendingOpenSlug: string | null;
  /** Git state of docs/brd; null when the project is not a git repository. */
  changes: BrdChanges | null;
  isCommitting: boolean;
  lastCommit: BrdCommitResult | null;
  commitError: string | null;

  isDirty: () => boolean;
  reset: () => void;
  requestOpen: (slug: string) => void;
  load: (projectId: string) => Promise<void>;
  select: (projectId: string, slug: string, opts?: { force?: boolean }) => Promise<boolean>;
  setContent: (content: string) => void;
  save: (projectId: string) => Promise<void>;
  create: (projectId: string, title: string) => Promise<string | null>;
  startDraft: (projectId: string, mode: BrdDraftMode, notes: string) => Promise<void>;
  cancelDraft: () => Promise<void>;
  acceptDraft: () => void;
  discardDraft: () => void;
  refreshChanges: (projectId: string) => Promise<void>;
  commit: (projectId: string, message: string, push: boolean) => Promise<boolean>;
}

const idleDraft: DraftState = { status: 'idle', text: '' };

const initial = {
  brds: [] as BrdSummary[],
  selectedSlug: null as string | null,
  selectedSummary: null as BrdSummary | null,
  content: '',
  savedContent: '',
  structure: null as BrdStructureResult | null,
  draft: idleDraft,
  isLoading: false,
  isSaving: false,
  error: null as string | null,
  pendingOpenSlug: null as string | null,
  changes: null as BrdChanges | null,
  isCommitting: false,
  lastCommit: null as BrdCommitResult | null,
  commitError: null as string | null,
};

export const useBrdStore = create<BrdState>((set, get) => ({
  ...initial,

  isDirty: () => get().content !== get().savedContent,

  reset: () => set((s) => ({ ...initial, draft: { ...idleDraft }, pendingOpenSlug: s.pendingOpenSlug })),

  requestOpen: (slug) => set({ pendingOpenSlug: slug }),

  load: async (projectId) => {
    set({ isLoading: true, error: null });
    const result = await window.electronAPI.brdList(projectId);
    if (result.success && result.data) set({ brds: result.data, isLoading: false });
    else set({ error: result.error ?? 'Unknown error', isLoading: false });
  },

  select: async (projectId, slug, opts) => {
    if (get().isDirty() && !opts?.force) return false;
    set({ isLoading: true, error: null, draft: { ...idleDraft } });
    const result = await window.electronAPI.brdRead(projectId, slug);
    if (!result.success || !result.data) {
      set({ error: result.error ?? 'Unknown error', isLoading: false });
      return false;
    }
    const { summary, content } = result.data;
    set({
      selectedSlug: slug,
      selectedSummary: summary,
      content,
      savedContent: content,
      structure: checkBrdStructure(content),
      isLoading: false,
    });
    return true;
  },

  setContent: (content) => set({ content, structure: checkBrdStructure(content) }),

  save: async (projectId) => {
    const { selectedSlug, content } = get();
    if (!selectedSlug) return;
    set({ isSaving: true, error: null });
    const result = await window.electronAPI.brdWrite(projectId, selectedSlug, content);
    if (!result.success || !result.data) {
      set({ error: result.error ?? 'Unknown error', isSaving: false });
      return;
    }
    const summary = result.data;
    set((s) => ({
      savedContent: content,
      selectedSummary: summary,
      brds: s.brds.some((b) => b.slug === summary.slug)
        ? s.brds.map((b) => (b.slug === summary.slug ? summary : b))
        : [summary, ...s.brds],
      isSaving: false,
    }));
  },

  create: async (projectId, title) => {
    set({ error: null });
    const result = await window.electronAPI.brdCreate(projectId, title);
    if (!result.success || !result.data) {
      set({ error: result.error ?? 'Unknown error' });
      return null;
    }
    const summary = result.data;
    set((s) => ({ brds: [summary, ...s.brds] }));
    await get().select(projectId, summary.slug, { force: true });
    return summary.slug;
  },

  startDraft: async (projectId, mode, notes) => {
    const { selectedSlug, selectedSummary } = get();
    set({ draft: { status: 'streaming', text: '' } });
    const result = await window.electronAPI.brdDraft(projectId, {
      mode,
      notes,
      ...(selectedSlug ? { slug: selectedSlug } : {}),
      ...(selectedSummary?.title ? { title: selectedSummary.title } : {}),
    });
    if (!result.success || !result.data) {
      set({ draft: { status: 'idle', text: '', error: result.error ?? 'Unknown error' } });
      return;
    }
    set({ draft: { status: 'streaming', runId: result.data.runId, text: '' } });
  },

  cancelDraft: async () => {
    const { runId } = get().draft;
    if (runId) await window.electronAPI.brdDraftCancel(runId);
  },

  acceptDraft: () => {
    const { draft } = get();
    if (draft.status !== 'proposal') return;
    set({ content: draft.text, structure: checkBrdStructure(draft.text), draft: { ...idleDraft } });
  },

  discardDraft: () => set({ draft: { ...idleDraft } }),

  refreshChanges: async (projectId) => {
    const result = await window.electronAPI.brdChanges(projectId);
    set({ changes: result.success && result.data ? result.data : null });
  },

  commit: async (projectId, message, push) => {
    set({ isCommitting: true, commitError: null, lastCommit: null });
    const result = await window.electronAPI.brdCommit(projectId, message, push);
    if (!result.success || !result.data) {
      set({ commitError: result.error ?? 'Unknown error', isCommitting: false });
      return false;
    }
    set({ lastCommit: result.data, isCommitting: false });
    await get().refreshChanges(projectId);
    return true;
  },
}));

/** Subscribe to draft stream events. Returns an unsubscribe function. */
export function setupBrdListeners(): () => void {
  const store = useBrdStore;
  const isCurrent = (runId: string) => store.getState().draft.runId === runId;

  const offChunk = window.electronAPI.onBrdDraftChunk(({ runId, text }) => {
    if (!isCurrent(runId)) return;
    store.setState((s) => ({ draft: { ...s.draft, text: s.draft.text + text } }));
  });
  const offDone = window.electronAPI.onBrdDraftDone(({ runId, text }) => {
    if (!isCurrent(runId)) return;
    store.setState({ draft: { status: 'proposal', runId, text } });
  });
  const offError = window.electronAPI.onBrdDraftError(({ runId, error }) => {
    if (!isCurrent(runId)) return;
    store.setState((s) => ({ draft: { status: 'idle', text: s.draft.text, error } }));
  });
  return () => {
    offChunk();
    offDone();
    offError();
  };
}
