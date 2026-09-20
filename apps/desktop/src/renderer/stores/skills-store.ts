// apps/desktop/src/renderer/stores/skills-store.ts
import { create } from 'zustand';
import type { SkillsSnapshot } from '../../shared/types/skills';

interface SkillsState {
  snapshot: SkillsSnapshot | null;
  isLoading: boolean;
  error: string | null;
  load: (projectId: string) => Promise<void>;
  refresh: (projectId: string) => Promise<void>;
}

async function run(
  set: (partial: Partial<SkillsState>) => void,
  call: () => Promise<{ success: boolean; data?: SkillsSnapshot; error?: string }>,
): Promise<void> {
  set({ isLoading: true, error: null });
  try {
    const result = await call();
    if (result.success && result.data) {
      set({ snapshot: result.data, isLoading: false });
    } else {
      set({ error: result.error ?? 'Unknown error', isLoading: false });
    }
  } catch (err) {
    set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
  }
}

export const useSkillsStore = create<SkillsState>((set) => ({
  snapshot: null,
  isLoading: false,
  error: null,
  load: (projectId) => run(set, () => window.electronAPI.listSkills(projectId)),
  refresh: (projectId) => run(set, () => window.electronAPI.refreshSkills(projectId)),
}));
