// apps/desktop/src/renderer/stores/requirements-store.ts
import { create } from 'zustand';

import { lockedIds as computeLockedIds, nextReleasableMilestone, releaseGate, type ReleaseGateReason } from '../../shared/brd/release';
import { validateRequirementsSet } from '../../shared/brd/requirements';
import type {
  Milestone, ProposedTask, Requirement, RequirementsRunPhase, RequirementsSet,
} from '../../shared/types/requirements';
import { useTaskStore } from './task-store';

type Section = 'requirements' | 'milestones' | 'tasks';
type ItemOf<S extends Section> = S extends 'requirements' ? Requirement : S extends 'milestones' ? Milestone : ProposedTask;

interface Proposal { set: RequirementsSet; changeSummary?: string; warnings: string[] }
interface RunState { status: 'idle' | 'running' | 'proposal'; runId?: string; phase?: RequirementsRunPhase; proposal?: Proposal; error?: string }

interface RequirementsState {
  slug: string | null;
  set: RequirementsSet | null;
  savedSet: RequirementsSet | null;
  currentBrdHash: string;
  warnings: string[];
  selection: string[];
  run: RunState;
  isLoading: boolean;
  isSaving: boolean;
  isReleasing: boolean;
  error: string | null;

  isDirty: () => boolean;
  isStale: () => boolean;
  canApprove: () => boolean;
  lockedIds: () => Set<string>;
  nextMilestone: () => Milestone | null;
  releaseReason: (milestoneId: string) => ReleaseGateReason | 'running' | null;
  release: (projectId: string, milestoneId: string) => Promise<void>;
  reset: () => void;
  load: (projectId: string, slug: string) => Promise<void>;
  /** Re-read the BRD hash after the document was saved, keeping the set and any local edits. */
  refreshBrdHash: (projectId: string) => Promise<void>;
  edit: <S extends Section>(section: S, id: string, patch: Partial<ItemOf<S>>) => void;
  toggleInclude: (section: Section, id: string) => void;
  toggleSelect: (id: string) => void;
  moveMilestone: (id: string, direction: 'up' | 'down') => void;
  save: (projectId: string) => Promise<void>;
  approve: (projectId: string) => Promise<void>;
  generate: (projectId: string) => Promise<void>;
  refine: (projectId: string, feedback: string) => Promise<void>;
  regenerate: (projectId: string) => Promise<void>;
  cancel: () => Promise<void>;
  accept: () => void;
  discard: () => void;
}

const idle: RunState = { status: 'idle' };
const initial = {
  slug: null as string | null,
  set: null as RequirementsSet | null,
  savedSet: null as RequirementsSet | null,
  currentBrdHash: '',
  warnings: [] as string[],
  selection: [] as string[],
  run: idle,
  isLoading: false,
  isSaving: false,
  isReleasing: false,
  error: null as string | null,
};

const same = (a: RequirementsSet | null, b: RequirementsSet | null) => JSON.stringify(a) === JSON.stringify(b);

export const useRequirementsStore = create<RequirementsState>((set, get) => {
  const update = (mutate: (s: RequirementsSet) => RequirementsSet) => {
    const current = get().set;
    if (!current) return;
    const next = mutate(current);
    set({ set: next, warnings: validateRequirementsSet(next) });
  };
  const startRun = async (projectId: string, request: Parameters<typeof window.electronAPI.requirementsGenerate>[1]) => {
    set({ run: { status: 'running', phase: 'started' } });
    const result = await window.electronAPI.requirementsGenerate(projectId, request);
    if (!result.success || !result.data) {
      set({ run: { status: 'idle', error: result.error ?? 'Unknown error' } });
      return;
    }
    set({ run: { status: 'running', runId: result.data.runId, phase: 'started' } });
  };

  /** Ids the model may change: everything not locked. Undefined when nothing is locked and nothing is selected. */
  const unlockedSelection = (selection: string[]): string[] | undefined => {
    const current = get().set;
    if (!current) return selection.length > 0 ? selection : undefined;
    const locked = computeLockedIds(current);
    if (locked.size === 0) return selection.length > 0 ? selection : undefined;
    const candidates = selection.length > 0
      ? selection
      : [...current.requirements, ...current.milestones, ...current.tasks].map((i) => i.id);
    return candidates.filter((id) => !locked.has(id));
  };

  return {
    ...initial,

    isDirty: () => !same(get().set, get().savedSet),
    isStale: () => {
      const current = get().set;
      return !!current && current.brdHash !== get().currentBrdHash;
    },
    canApprove: () => {
      const { set: s, warnings } = get();
      return !!s && s.status !== 'approved' && !get().isDirty() && warnings.length === 0;
    },

    lockedIds: () => {
      const current = get().set;
      return current ? computeLockedIds(current) : new Set<string>();
    },
    nextMilestone: () => {
      const current = get().set;
      return current ? nextReleasableMilestone(current) : null;
    },
    releaseReason: (milestoneId) => {
      if (get().run.status === 'running' || get().isReleasing) return 'running';
      return releaseGate(get().set, get().savedSet, get().currentBrdHash, milestoneId);
    },
    release: async (projectId, milestoneId) => {
      const { slug } = get();
      if (!slug || get().releaseReason(milestoneId)) return;
      set({ isReleasing: true, error: null });
      const result = await window.electronAPI.requirementsRelease(projectId, slug, milestoneId);
      if (!result.success || !result.data) {
        // Reload first (a partial record may exist on disk), then surface the error, because load clears it.
        await get().load(projectId, slug);
        set({ error: result.error ?? 'Unknown error', isReleasing: false });
        return;
      }
      for (const task of result.data.tasks) useTaskStore.getState().addTask(task);
      const next = result.data.set;
      set({ set: next, savedSet: next, warnings: validateRequirementsSet(next), isReleasing: false });
    },

    reset: () => set({ ...initial, run: { ...idle } }),

    load: async (projectId, slug) => {
      set({ isLoading: true, error: null, slug, selection: [], run: { ...idle } });
      const result = await window.electronAPI.requirementsRead(projectId, slug);
      if (!result.success || !result.data) {
        set({ error: result.error ?? 'Unknown error', isLoading: false });
        return;
      }
      const { set: loaded, currentBrdHash } = result.data;
      set({ set: loaded, savedSet: loaded, currentBrdHash, warnings: loaded ? validateRequirementsSet(loaded) : [], isLoading: false });
    },

    refreshBrdHash: async (projectId) => {
      const { slug } = get();
      if (!slug) return;
      const result = await window.electronAPI.requirementsRead(projectId, slug);
      if (result.success && result.data) set({ currentBrdHash: result.data.currentBrdHash });
    },

    edit: (section, id, patch) =>
      update((s) => ({
        ...s,
        [section]: (s[section] as Array<{ id: string }>).map((item) => (item.id === id ? { ...item, ...patch } : item)),
      })),

    toggleInclude: (section, id) =>
      update((s) => ({
        ...s,
        [section]: (s[section] as Array<{ id: string; included: boolean }>).map((item) =>
          item.id === id ? { ...item, included: !item.included } : item,
        ),
      })),

    toggleSelect: (id) =>
      set((s) => ({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] })),

    moveMilestone: (id, direction) =>
      update((s) => {
        const sorted = [...s.milestones].sort((a, b) => a.order - b.order);
        const i = sorted.findIndex((m) => m.id === id);
        const j = direction === 'up' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= sorted.length) return s;
        [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
        const reordered = sorted.map((m, idx) => ({ ...m, order: idx + 1 }));
        return { ...s, milestones: reordered };
      }),

    save: async (projectId) => {
      const { slug, set: s } = get();
      if (!slug || !s) return;
      set({ isSaving: true, error: null });
      const result = await window.electronAPI.requirementsWrite(projectId, slug, s);
      if (!result.success || !result.data) {
        set({ error: result.error ?? 'Unknown error', isSaving: false });
        return;
      }
      set({ set: result.data, savedSet: result.data, warnings: validateRequirementsSet(result.data), isSaving: false });
    },

    approve: async (projectId) => {
      const { slug, set: s } = get();
      if (!slug || !s || !get().canApprove()) return;
      set({ isSaving: true, error: null });
      const result = await window.electronAPI.requirementsApprove(projectId, slug, s);
      if (!result.success || !result.data) {
        set({ error: result.error ?? 'Unknown error', isSaving: false });
        return;
      }
      set({ set: result.data, savedSet: result.data, isSaving: false });
    },

    generate: async (projectId) => {
      const { slug } = get();
      if (!slug) return;
      await startRun(projectId, { slug, mode: 'generate' });
    },

    refine: async (projectId, feedback) => {
      const { slug, selection } = get();
      if (!slug) return;
      const scoped = unlockedSelection(selection);
      await startRun(projectId, { slug, mode: 'refine', feedback, ...(scoped && scoped.length > 0 ? { selection: scoped } : {}) });
    },

    regenerate: async (projectId) => {
      const { slug } = get();
      if (!slug) return;
      const scoped = unlockedSelection([]);
      await startRun(projectId, {
        slug,
        mode: 'refine',
        feedback: 'The BRD changed; update the set to match it. Keep ids of items that still apply.',
        ...(scoped && scoped.length > 0 ? { selection: scoped } : {}),
      });
    },

    cancel: async () => {
      const { runId } = get().run;
      if (runId) await window.electronAPI.requirementsCancel(runId);
    },

    accept: () => {
      const { run } = get();
      if (run.status !== 'proposal' || !run.proposal) return;
      const next = run.proposal.set;
      set({ set: next, warnings: validateRequirementsSet(next), selection: [], run: { ...idle } });
    },

    discard: () => set({ run: { ...idle } }),
  };
});

export function setupRequirementsListeners(): () => void {
  const store = useRequirementsStore;
  const isCurrent = (runId: string) => store.getState().run.runId === runId;
  const offProgress = window.electronAPI.onRequirementsProgress(({ runId, phase }) => {
    if (!isCurrent(runId)) return;
    store.setState((s) => ({ run: { ...s.run, phase } }));
  });
  const offDone = window.electronAPI.onRequirementsDone(({ runId, set: proposed, changeSummary, warnings }) => {
    if (!isCurrent(runId)) return;
    store.setState({ run: { status: 'proposal', runId, proposal: { set: proposed, changeSummary, warnings } } });
  });
  const offError = window.electronAPI.onRequirementsError(({ runId, error }) => {
    if (!isCurrent(runId)) return;
    store.setState({ run: { status: 'idle', error } });
  });
  return () => {
    offProgress();
    offDone();
    offError();
  };
}
