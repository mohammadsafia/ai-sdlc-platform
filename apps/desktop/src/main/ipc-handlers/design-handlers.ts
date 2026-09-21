// apps/desktop/src/main/ipc-handlers/design-handlers.ts
import { randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult, Project } from '../../shared/types';
import type { DesignBriefStatus, DesignBriefSummary, DesignDraftRequest } from '../../shared/types/design';
import type { Requirement } from '../../shared/types/requirements';
import type { ThinkingLevel } from '../ai/config/types';
import { runDesignWriter } from '../ai/runners/design-writer';
import { readBrd } from '../brd/brd-files';
import { readRequirements } from '../brd/requirements-files';
import { createDesignBrief, listDesignBriefs, readDesignBrief, setDesignBriefStatus, writeDesignBrief } from '../design/design-files';
import { projectStore } from '../project-store';
import { getActiveProviderFeatureSettings } from './feature-settings-helper';
import { safeSendToRenderer } from './utils';

interface ActiveRun {
  runId: string;
  projectId: string;
  controller: AbortController;
}

const activeRuns = new Map<string, ActiveRun>(); // keyed by projectId

async function withProject<T>(projectId: string, fn: (project: Project) => Promise<T>): Promise<IPCResult<T>> {
  const project = projectStore.getProject(projectId);
  if (!project) return { success: false, error: `Project not found: ${projectId}` };
  try {
    return { success: true, data: await fn(project) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/** The named requirement and the titles of its siblings, or throws. */
async function loadRequirement(
  projectPath: string,
  brdSlug: string,
  requirementId: string,
): Promise<{ requirement: Requirement; siblingTitles: string[] }> {
  const set = await readRequirements(projectPath, brdSlug);
  const requirement = set?.requirements.find((r) => r.id === requirementId);
  if (!set || !requirement) throw new Error(`Requirement ${requirementId} not found in ${brdSlug}`);
  return { requirement, siblingTitles: set.requirements.filter((r) => r.id !== requirementId).map((r) => r.title) };
}

export function registerDesignHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC_CHANNELS.DESIGN_LIST, (_e, projectId: string) => withProject(projectId, (p) => listDesignBriefs(p.path)));
  ipcMain.handle(IPC_CHANNELS.DESIGN_READ, (_e, projectId: string, brdSlug: string, requirementId: string) =>
    withProject(projectId, (p) => readDesignBrief(p.path, brdSlug, requirementId)),
  );
  ipcMain.handle(IPC_CHANNELS.DESIGN_WRITE, (_e, projectId: string, brdSlug: string, requirementId: string, content: string) =>
    withProject<DesignBriefSummary>(projectId, (p) => writeDesignBrief(p.path, brdSlug, requirementId, content)),
  );
  ipcMain.handle(IPC_CHANNELS.DESIGN_CREATE, (_e, projectId: string, brdSlug: string, requirementId: string) =>
    withProject<DesignBriefSummary>(projectId, async (p) => {
      const { requirement } = await loadRequirement(p.path, brdSlug, requirementId);
      return createDesignBrief(p.path, brdSlug, { id: requirement.id, title: requirement.title });
    }),
  );
  ipcMain.handle(IPC_CHANNELS.DESIGN_SET_STATUS, (_e, projectId: string, brdSlug: string, requirementId: string, status: DesignBriefStatus) =>
    withProject<DesignBriefSummary>(projectId, (p) => setDesignBriefStatus(p.path, brdSlug, requirementId, status)),
  );

  ipcMain.handle(IPC_CHANNELS.DESIGN_DRAFT, async (_e, projectId: string, request: DesignDraftRequest): Promise<IPCResult<{ runId: string }>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    if (activeRuns.has(projectId)) return { success: false, error: 'A draft is already running for this project' };

    let requirement: Requirement;
    let siblingTitles: string[];
    let brdBody: string;
    let existing: string | undefined;
    try {
      ({ requirement, siblingTitles } = await loadRequirement(project.path, request.brdSlug, request.requirementId));
      brdBody = (await readBrd(project.path, request.brdSlug)).content;
      if (request.mode === 'revise') existing = (await readDesignBrief(project.path, request.brdSlug, request.requirementId)).content;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }

    const runId = randomUUID();
    const controller = new AbortController();
    activeRuns.set(projectId, { runId, projectId, controller });
    const { model, thinkingLevel } = getActiveProviderFeatureSettings('roadmap');

    // Defer past the invoke reply so the renderer knows the runId before any event arrives.
    setTimeout(() => {
      if (controller.signal.aborted) {
        activeRuns.delete(projectId);
        safeSendToRenderer(getMainWindow, IPC_CHANNELS.DESIGN_DRAFT_ERROR, { runId, error: 'cancelled' });
        return;
      }
      void runDesignWriter(
        {
          projectDir: project.path,
          mode: request.mode,
          notes: request.notes,
          brdSlug: request.brdSlug,
          requirement: {
            id: requirement.id,
            title: requirement.title,
            description: requirement.description,
            acceptanceCriteria: requirement.acceptanceCriteria,
            area: requirement.area,
          },
          siblingTitles,
          brdBody,
          existing,
          modelShorthand: model,
          thinkingLevel: thinkingLevel as ThinkingLevel,
          abortSignal: controller.signal,
        },
        (event) => {
          if (event.type === 'text-delta') {
            safeSendToRenderer(getMainWindow, IPC_CHANNELS.DESIGN_DRAFT_CHUNK, { runId, text: event.text });
            return;
          }
          if (activeRuns.get(projectId)?.runId === runId) activeRuns.delete(projectId);
          if (event.type === 'done') safeSendToRenderer(getMainWindow, IPC_CHANNELS.DESIGN_DRAFT_DONE, { runId, text: event.text });
          else safeSendToRenderer(getMainWindow, IPC_CHANNELS.DESIGN_DRAFT_ERROR, { runId, error: event.error });
        },
      );
    }, 0);

    return { success: true, data: { runId } };
  });

  ipcMain.handle(IPC_CHANNELS.DESIGN_DRAFT_CANCEL, (_e, runId: string): IPCResult => {
    const run = [...activeRuns.values()].find((r) => r.runId === runId);
    if (!run) return { success: false, error: `No running draft with id ${runId}` };
    run.controller.abort();
    activeRuns.delete(run.projectId);
    return { success: true };
  });
}
