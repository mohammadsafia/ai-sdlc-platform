// apps/desktop/src/renderer/stores/design-store.ts
import { create } from 'zustand';

import { checkDesignStructure } from '../../shared/design/structure';
import type { BrdStructureResult } from '../../shared/types/brd';
import type { DesignBriefStatus, DesignBriefSummary, DesignDraftMode } from '../../shared/types/design';
import type { Requirement } from '../../shared/types/requirements';
import { useBrdStore } from './brd-store';

export type DesignDraftStatus = 'idle' | 'streaming' | 'proposal';
interface DraftState {
  status: DesignDraftStatus;
  runId?: string;
  text: string;
  error?: string;
}
export interface BriefSelection {
  brdSlug: string;
  requirementId: string;
}
export type BriefStatusLabel = 'none' | DesignBriefStatus;
export type RequirementsBySlug = Record<string, { title: string; requirements: Requirement[] }>;

interface DesignState {
  briefs: DesignBriefSummary[];
  requirementsBySlug: RequirementsBySlug;
  selected: BriefSelection | null;
  /** Null when the selected requirement has no brief file yet. */
  selectedSummary: DesignBriefSummary | null;
  content: string;
  savedContent: string;
  structure: BrdStructureResult | null;
  draft: DraftState;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  pendingOpen: BriefSelection | null;

  isDirty: () => boolean;
  reset: () => void;
  requestOpen: (brdSlug: string, requirementId: string) => void;
  load: (projectId: string) => Promise<void>;
  /** Refreshes only the brief summaries (used by status chips outside the Design view). */
  loadBriefs: (projectId: string) => Promise<void>;
  select: (projectId: string, brdSlug: string, requirementId: string, opts?: { force?: boolean }) => Promise<boolean>;
  setContent: (content: string) => void;
  save: (projectId: string) => Promise<void>;
  create: (projectId: string) => Promise<void>;
  setStatus: (projectId: string, status: DesignBriefStatus) => Promise<void>;
  startDraft: (projectId: string, mode: DesignDraftMode, notes: string) => Promise<void>;
  cancelDraft: () => Promise<void>;
  acceptDraft: (projectId: string) => Promise<void>;
  discardDraft: () => void;
}

const idleDraft: DraftState = { status: 'idle', text: '' };

const initial = {
  briefs: [] as DesignBriefSummary[],
  requirementsBySlug: {} as RequirementsBySlug,
  selected: null as BriefSelection | null,
  selectedSummary: null as DesignBriefSummary | null,
  content: '',
  savedContent: '',
  structure: null as BrdStructureResult | null,
  draft: idleDraft,
  isLoading: false,
  isSaving: false,
  error: null as string | null,
  pendingOpen: null as BriefSelection | null,
};

export function briefStatus(briefs: DesignBriefSummary[], brdSlug: string, requirementId: string): BriefStatusLabel {
  return briefs.find((b) => b.brdSlug === brdSlug && b.requirementId === requirementId)?.status ?? 'none';
}

function upsert(briefs: DesignBriefSummary[], summary: DesignBriefSummary): DesignBriefSummary[] {
  const i = briefs.findIndex((b) => b.brdSlug === summary.brdSlug && b.requirementId === summary.requirementId);
  return i === -1 ? [...briefs, summary] : briefs.map((b, j) => (j === i ? summary : b));
}

export const useDesignStore = create<DesignState>((set, get) => ({
  ...initial,

  isDirty: () => get().content !== get().savedContent,
  reset: () => set((s) => ({ ...initial, draft: { ...idleDraft }, pendingOpen: s.pendingOpen })),
  requestOpen: (brdSlug, requirementId) => set({ pendingOpen: { brdSlug, requirementId } }),

  load: async (projectId) => {
    set({ isLoading: true, error: null });
    const [brds, briefs] = await Promise.all([window.electronAPI.brdList(projectId), window.electronAPI.designList(projectId)]);
    if (!brds.success || !brds.data) {
      set({ error: brds.error ?? 'Unknown error', isLoading: false });
      return;
    }
    const requirementsBySlug: RequirementsBySlug = {};
    for (const brd of brds.data) {
      const read = await window.electronAPI.requirementsRead(projectId, brd.slug);
      const requirements = read.success && read.data?.set ? read.data.set.requirements.filter((r) => r.needsDesign) : null;
      if (requirements) requirementsBySlug[brd.slug] = { title: brd.title, requirements };
    }
    set({ requirementsBySlug, briefs: briefs.success && briefs.data ? briefs.data : [], isLoading: false });
  },

  loadBriefs: async (projectId) => {
    const briefs = await window.electronAPI.designList(projectId);
    if (briefs.success && briefs.data) set({ briefs: briefs.data });
  },

  select: async (projectId, brdSlug, requirementId, opts) => {
    if (get().isDirty() && !opts?.force) return false;
    set({ isLoading: true, error: null, draft: { ...idleDraft } });
    const result = await window.electronAPI.designRead(projectId, brdSlug, requirementId);
    if (!result.success || !result.data) {
      set({ selected: { brdSlug, requirementId }, selectedSummary: null, content: '', savedContent: '', structure: null, isLoading: false });
      return true;
    }
    set({
      selected: { brdSlug, requirementId },
      selectedSummary: result.data.summary,
      content: result.data.content,
      savedContent: result.data.content,
      structure: checkDesignStructure(result.data.content),
      isLoading: false,
    });
    return true;
  },

  setContent: (content) => set({ content, structure: checkDesignStructure(content) }),

  save: async (projectId) => {
    const { selected, content } = get();
    if (!selected) return;
    set({ isSaving: true, error: null });
    const result = await window.electronAPI.designWrite(projectId, selected.brdSlug, selected.requirementId, content);
    if (!result.success || !result.data) {
      set({ error: result.error ?? 'Unknown error', isSaving: false });
      return;
    }
    const summary = result.data;
    set((s) => ({ savedContent: content, selectedSummary: summary, briefs: upsert(s.briefs, summary), isSaving: false }));
    void useBrdStore.getState().refreshChanges(projectId);
  },

  create: async (projectId) => {
    const { selected } = get();
    if (!selected) return;
    set({ error: null });
    const result = await window.electronAPI.designCreate(projectId, selected.brdSlug, selected.requirementId);
    if (!result.success || !result.data) {
      set({ error: result.error ?? 'Unknown error' });
      return;
    }
    const summary = result.data;
    set((s) => ({ briefs: upsert(s.briefs, summary) }));
    await get().select(projectId, selected.brdSlug, selected.requirementId, { force: true });
    void useBrdStore.getState().refreshChanges(projectId);
  },

  setStatus: async (projectId, status) => {
    const { selected } = get();
    if (!selected) return;
    set({ error: null });
    const result = await window.electronAPI.designSetStatus(projectId, selected.brdSlug, selected.requirementId, status);
    if (!result.success || !result.data) {
      set({ error: result.error ?? 'Unknown error' });
      return;
    }
    const summary = result.data;
    set((s) => ({ briefs: upsert(s.briefs, summary), selectedSummary: summary }));
    // The file's frontmatter changed on disk; reload it so the editor matches.
    const reread = await window.electronAPI.designRead(projectId, selected.brdSlug, selected.requirementId);
    if (reread.success && reread.data) {
      set({ content: reread.data.content, savedContent: reread.data.content, structure: checkDesignStructure(reread.data.content) });
    }
    void useBrdStore.getState().refreshChanges(projectId);
  },

  startDraft: async (projectId, mode, notes) => {
    const { selected } = get();
    if (!selected) return;
    set({ draft: { status: 'streaming', text: '' } });
    const result = await window.electronAPI.designDraft(projectId, { brdSlug: selected.brdSlug, requirementId: selected.requirementId, mode, notes });
    if (!result.success || !result.data) {
      set({ draft: { status: 'idle', text: '', error: result.error ?? 'Unknown error' } });
      return;
    }
    set({ draft: { status: 'streaming', runId: result.data.runId, text: '' } });
  },

  cancelDraft: async () => {
    const { runId } = get().draft;
    if (runId) await window.electronAPI.designDraftCancel(runId);
  },

  acceptDraft: async (projectId) => {
    const { draft, selected, selectedSummary } = get();
    if (draft.status !== 'proposal' || !selected) return;
    if (selectedSummary) {
      set({ content: draft.text, structure: checkDesignStructure(draft.text), draft: { ...idleDraft } });
      return;
    }
    const result = await window.electronAPI.designWrite(projectId, selected.brdSlug, selected.requirementId, draft.text);
    if (!result.success || !result.data) {
      set({ draft: { ...draft, error: result.error ?? 'Unknown error' } });
      return;
    }
    const summary = result.data;
    set((s) => ({
      briefs: upsert(s.briefs, summary),
      selectedSummary: summary,
      content: draft.text,
      savedContent: draft.text,
      structure: checkDesignStructure(draft.text),
      draft: { ...idleDraft },
    }));
    void useBrdStore.getState().refreshChanges(projectId);
  },

  discardDraft: () => set({ draft: { ...idleDraft } }),
}));

/** Subscribe to draft stream events. Returns an unsubscribe function. */
export function setupDesignListeners(): () => void {
  const store = useDesignStore;
  const isCurrent = (runId: string) => store.getState().draft.runId === runId;
  const offChunk = window.electronAPI.onDesignDraftChunk(({ runId, text }) => {
    if (!isCurrent(runId)) return;
    store.setState((s) => ({ draft: { ...s.draft, text: s.draft.text + text } }));
  });
  const offDone = window.electronAPI.onDesignDraftDone(({ runId, text }) => {
    if (!isCurrent(runId)) return;
    store.setState({ draft: { status: 'proposal', runId, text } });
  });
  const offError = window.electronAPI.onDesignDraftError(({ runId, error }) => {
    if (!isCurrent(runId)) return;
    store.setState((s) => ({ draft: { status: 'idle', text: s.draft.text, error } }));
  });
  return () => {
    offChunk();
    offDone();
    offError();
  };
}
