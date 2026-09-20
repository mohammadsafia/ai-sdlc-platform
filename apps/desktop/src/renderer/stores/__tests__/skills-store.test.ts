// apps/desktop/src/renderer/stores/__tests__/skills-store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSkillsStore } from '../skills-store';

const listSkills = vi.fn();
const refreshSkills = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { window: unknown }).window = { electronAPI: { listSkills, refreshSkills } };
  useSkillsStore.setState({ snapshot: null, isLoading: false, error: null });
});

describe('skills-store', () => {
  it('load stores the snapshot', async () => {
    listSkills.mockResolvedValue({ success: true, data: { skills: [], pins: {}, warnings: [], lock: { repos: {} } } });
    await useSkillsStore.getState().load('p1');
    expect(listSkills).toHaveBeenCalledWith('p1');
    expect(useSkillsStore.getState().snapshot?.skills).toEqual([]);
    expect(useSkillsStore.getState().isLoading).toBe(false);
    expect(useSkillsStore.getState().error).toBeNull();
  });

  it('load stores an IPC error', async () => {
    listSkills.mockResolvedValue({ success: false, error: 'nope' });
    await useSkillsStore.getState().load('p1');
    expect(useSkillsStore.getState().error).toBe('nope');
  });

  it('refresh calls refreshSkills and stores the snapshot', async () => {
    refreshSkills.mockResolvedValue({ success: true, data: { skills: [], pins: {}, warnings: ['w'], lock: { repos: {} } } });
    await useSkillsStore.getState().refresh('p1');
    expect(refreshSkills).toHaveBeenCalledWith('p1');
    expect(useSkillsStore.getState().snapshot?.warnings).toEqual(['w']);
  });
});
