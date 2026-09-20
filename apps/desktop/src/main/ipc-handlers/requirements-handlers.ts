// apps/desktop/src/main/ipc-handlers/requirements-handlers.ts
import { randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

import { assignIds, mergeRefinement, validateRequirementsSet } from '../../shared/brd/requirements';
import { checkBrdStructure } from '../../shared/brd/structure';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import type { RequirementsGenerateRequest, RequirementsSet } from '../../shared/types/requirements';
import type { ThinkingLevel } from '../ai/config/types';
import { runRequirementsGenerator } from '../ai/runners/requirements-generator';
import { readBrd } from '../brd/brd-files';
import { brdHash, readRequirements, writeRequirements } from '../brd/requirements-files';
import { projectStore } from '../project-store';
import { getActiveProviderFeatureSettings } from './feature-settings-helper';
import { safeSendToRenderer } from './utils';

interface ActiveRun { runId: string; slug: string; controller: AbortController }
const activeRuns = new Map<string, ActiveRun>(); // keyed by `${projectId}:${slug}`

function fail(error: unknown): IPCResult<never> {
  return { success: false, error: error instanceof Error ? error.message : String(error) };
}

export function registerRequirementsHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC_CHANNELS.REQUIREMENTS_READ, async (_e, projectId: string, slug: string) => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    try {
      const [set, brd] = await Promise.all([readRequirements(project.path, slug), readBrd(project.path, slug)]);
      return { success: true, data: { set, currentBrdHash: brdHash(brd.content) } };
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(IPC_CHANNELS.REQUIREMENTS_WRITE, async (_e, projectId: string, slug: string, set: RequirementsSet) => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    try {
      const { approvedAt: _a, ...rest } = set;
      const data = await writeRequirements(project.path, slug, { ...rest, status: 'draft' });
      return { success: true, data };
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(IPC_CHANNELS.REQUIREMENTS_APPROVE, async (_e, projectId: string, slug: string, set: RequirementsSet) => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    const warnings = validateRequirementsSet(set);
    if (warnings.length > 0) return { success: false, error: `Cannot approve: ${warnings.join('; ')}` };
    try {
      const data = await writeRequirements(project.path, slug, { ...set, status: 'approved', approvedAt: new Date().toISOString() });
      return { success: true, data };
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(IPC_CHANNELS.REQUIREMENTS_GENERATE, async (_e, projectId: string, request: RequirementsGenerateRequest): Promise<IPCResult<{ runId: string }>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    const key = `${projectId}:${request.slug}`;
    if (activeRuns.has(key)) return { success: false, error: 'A run is already in progress for this BRD' };

    let brdMarkdown: string;
    let previous: RequirementsSet | null;
    try {
      brdMarkdown = (await readBrd(project.path, request.slug)).content;
      previous = await readRequirements(project.path, request.slug);
    } catch (err) {
      return fail(err);
    }
    const structure = checkBrdStructure(brdMarkdown);
    if (!structure.ok) {
      const missing = structure.sections.filter((s) => s.required && (!s.present || s.empty)).map((s) => s.heading);
      const fm = structure.frontmatterErrors;
      return { success: false, error: `The BRD is not ready: ${[...missing.map((m) => `${m} is missing or empty`), ...fm].join('; ')}` };
    }
    if (request.mode === 'refine' && !previous) return { success: false, error: 'Generate a requirements set before refining it' };

    const runId = randomUUID();
    const controller = new AbortController();
    activeRuns.set(key, { runId, slug: request.slug, controller });
    const { model, thinkingLevel } = getActiveProviderFeatureSettings('roadmap');
    const hash = brdHash(brdMarkdown);

    void runRequirementsGenerator(
      {
        projectDir: project.path,
        mode: request.mode,
        brdMarkdown,
        previous: previous ?? undefined,
        feedback: request.feedback,
        selection: request.selection,
        modelShorthand: model,
        thinkingLevel: thinkingLevel as ThinkingLevel,
        abortSignal: controller.signal,
      },
      (event) => {
        if (event.type === 'progress') {
          safeSendToRenderer(getMainWindow, IPC_CHANNELS.REQUIREMENTS_PROGRESS, { runId, phase: event.phase });
          return;
        }
        if (activeRuns.get(key)?.runId === runId) activeRuns.delete(key);
        if (event.type === 'error') {
          safeSendToRenderer(getMainWindow, IPC_CHANNELS.REQUIREMENTS_ERROR, { runId, error: event.error });
          return;
        }
        if (request.mode === 'refine' && previous) {
          const { set, warnings } = mergeRefinement(previous, event.body, request.selection);
          safeSendToRenderer(getMainWindow, IPC_CHANNELS.REQUIREMENTS_DONE, { runId, set, changeSummary: event.body.changeSummary, warnings });
        } else {
          const assigned = assignIds(event.body);
          const set: RequirementsSet = {
            version: 1,
            brdSlug: request.slug,
            brdHash: hash,
            status: 'draft',
            generatedAt: new Date().toISOString(),
            requirements: assigned.requirements,
            milestones: assigned.milestones,
            tasks: assigned.tasks,
          };
          safeSendToRenderer(getMainWindow, IPC_CHANNELS.REQUIREMENTS_DONE, { runId, set, warnings: assigned.warnings });
        }
      },
    );
    return { success: true, data: { runId } };
  });

  ipcMain.handle(IPC_CHANNELS.REQUIREMENTS_CANCEL, (_e, runId: string): IPCResult => {
    const run = [...activeRuns.values()].find((r) => r.runId === runId);
    if (!run) return { success: false, error: `No running generation with id ${runId}` };
    run.controller.abort();
    return { success: true };
  });
}
