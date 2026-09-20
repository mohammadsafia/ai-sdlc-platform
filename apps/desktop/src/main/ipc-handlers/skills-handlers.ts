// apps/desktop/src/main/ipc-handlers/skills-handlers.ts
import { app, ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import { refreshSkills, resolveSkills } from '../ai/skills/resolve';
import type { SkillsSnapshot } from '../ai/skills/types';
import { projectStore } from '../project-store';

type SnapshotFn = (projectDir: string, options: { userDataDir: string }) => Promise<SkillsSnapshot>;

async function withProject(projectId: string, fn: SnapshotFn): Promise<IPCResult<SkillsSnapshot>> {
  const project = projectStore.getProject(projectId);
  if (!project) return { success: false, error: `Project not found: ${projectId}` };
  try {
    const data = await fn(project.path, { userDataDir: app.getPath('userData') });
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function registerSkillsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SKILLS_LIST, (_event, projectId: string) => withProject(projectId, resolveSkills));
  ipcMain.handle(IPC_CHANNELS.SKILLS_REFRESH, (_event, projectId: string) => withProject(projectId, refreshSkills));
}
