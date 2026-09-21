import { create } from 'zustand';

import type { JiraImportResult, JiraIssueSummary } from '../../../shared/types/integrations';
import { useTaskStore } from '../task-store';

interface Filters {
  status: string;
  jql: string;
  search: string;
}

interface JiraIssuesState {
  issues: JiraIssueSummary[];
  nextPageToken?: string;
  filters: Filters;
  selection: string[];
  isLoading: boolean;
  isImporting: boolean;
  error: string | null;
  lastImport: JiraImportResult | null;

  visibleIssues: () => JiraIssueSummary[];
  setFilter: (patch: Partial<Filters>) => void;
  load: (projectId: string) => Promise<void>;
  loadMore: (projectId: string) => Promise<void>;
  toggle: (key: string) => void;
  clearSelection: () => void;
  importSelected: (projectId: string) => Promise<void>;
  reset: () => void;
}

const initial = {
  issues: [] as JiraIssueSummary[],
  nextPageToken: undefined as string | undefined,
  filters: { status: '', jql: '', search: '' } as Filters,
  selection: [] as string[],
  isLoading: false,
  isImporting: false,
  error: null as string | null,
  lastImport: null as JiraImportResult | null,
};

export const useJiraIssuesStore = create<JiraIssuesState>((set, get) => {
  const params = (pageToken?: string) => {
    const { status, jql } = get().filters;
    return {
      ...(status ? { status } : {}),
      ...(jql.trim() ? { jql: jql.trim() } : {}),
      ...(pageToken ? { pageToken } : {}),
    };
  };

  const fetchPage = async (projectId: string, pageToken?: string) => {
    set({ isLoading: true, error: null });
    const result = await window.electronAPI.jiraSearchIssues(projectId, params(pageToken));
    if (!result.success || !result.data) {
      set({ error: result.error ?? 'Unknown error', isLoading: false });
      return null;
    }
    set({ isLoading: false });
    return result.data;
  };

  return {
    ...initial,
    visibleIssues: () => {
      const q = get().filters.search.trim().toLowerCase();
      if (!q) return get().issues;
      return get().issues.filter((i) => i.summary.toLowerCase().includes(q) || i.key.toLowerCase().includes(q));
    },
    setFilter: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
    load: async (projectId) => {
      const page = await fetchPage(projectId);
      if (page) set({ issues: page.issues, nextPageToken: page.nextPageToken, selection: [] });
    },
    loadMore: async (projectId) => {
      const token = get().nextPageToken;
      if (!token) return;
      const page = await fetchPage(projectId, token);
      if (page) set((s) => ({ issues: [...s.issues, ...page.issues], nextPageToken: page.nextPageToken }));
    },
    toggle: (key) =>
      set((s) => ({
        selection: s.selection.includes(key) ? s.selection.filter((k) => k !== key) : [...s.selection, key],
      })),
    clearSelection: () => set({ selection: [] }),
    importSelected: async (projectId) => {
      const keys = get().selection;
      if (keys.length === 0) return;
      set({ isImporting: true, error: null });
      const result = await window.electronAPI.jiraImportIssues(projectId, keys);
      if (!result.success || !result.data) {
        set({ error: result.error ?? 'Unknown error', isImporting: false });
        return;
      }
      const data = result.data;
      for (const task of data.tasks) useTaskStore.getState().addTask(task);
      const importedKeys = data.tasks.map((t) => t.metadata?.jiraKey).filter((k): k is string => !!k);
      const done = new Set([...importedKeys, ...data.skipped]);
      set((s) => ({
        issues: s.issues.map((i) => (done.has(i.key) ? { ...i, imported: true } : i)),
        selection: [],
        isImporting: false,
        lastImport: data,
      }));
    },
    reset: () => set({ ...initial, filters: { ...initial.filters } }),
  };
});
