// apps/desktop/src/main/ipc-handlers/__tests__/skills-handlers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { handlers, resolveSkills, refreshSkills, getProject } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  resolveSkills: vi.fn(),
  refreshSkills: vi.fn(),
  getProject: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn)) },
  app: { getPath: vi.fn(() => '/tmp/userData') },
}));
vi.mock('../../ai/skills/resolve', () => ({ resolveSkills, refreshSkills }));
vi.mock('../../project-store', () => ({ projectStore: { getProject } }));

import { registerSkillsHandlers } from '../skills-handlers';

describe('skills handlers', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerSkillsHandlers();
  });

  it('skills:list resolves using the project path and userData dir', async () => {
    getProject.mockReturnValue({ id: 'p1', path: '/repo' });
    resolveSkills.mockResolvedValue({ skills: [], pins: {}, warnings: [], lock: { repos: {} } });
    const result = await handlers.get('skills:list')!({}, 'p1');
    expect(resolveSkills).toHaveBeenCalledWith('/repo', { userDataDir: '/tmp/userData' });
    expect(result).toEqual({ success: true, data: { skills: [], pins: {}, warnings: [], lock: { repos: {} } } });
  });

  it('skills:refresh calls refreshSkills', async () => {
    getProject.mockReturnValue({ id: 'p1', path: '/repo' });
    refreshSkills.mockResolvedValue({ skills: [], pins: {}, warnings: ['w'], lock: { repos: {} } });
    const result = (await handlers.get('skills:refresh')!({}, 'p1')) as { success: boolean; data: { warnings: string[] } };
    expect(refreshSkills).toHaveBeenCalledWith('/repo', { userDataDir: '/tmp/userData' });
    expect(result.data.warnings).toEqual(['w']);
  });

  it('returns an error result for an unknown project', async () => {
    getProject.mockReturnValue(undefined);
    const result = await handlers.get('skills:list')!({}, 'nope');
    expect(result).toEqual({ success: false, error: 'Project not found: nope' });
  });

  it('turns thrown errors into error results', async () => {
    getProject.mockReturnValue({ id: 'p1', path: '/repo' });
    refreshSkills.mockRejectedValue(new Error('boom'));
    const result = await handlers.get('skills:refresh')!({}, 'p1');
    expect(result).toEqual({ success: false, error: 'boom' });
  });
});
