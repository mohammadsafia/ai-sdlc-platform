// apps/desktop/src/main/ipc-handlers/requirements-handlers.ts
import { randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

import { buildReleaseTaskInput, includedTasksOf, releaseGate, type ReleaseGateReason } from '../../shared/brd/release';
import { assignIds, mergeRefinement, validateRequirementsSet } from '../../shared/brd/requirements';
import { checkBrdStructure } from '../../shared/brd/structure';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult, Task } from '../../shared/types';
import type { RequirementsGenerateRequest, RequirementsSet } from '../../shared/types/requirements';
import type { ThinkingLevel } from '../ai/config/types';
import { runRequirementsGenerator } from '../ai/runners/requirements-generator';
import { readBrd } from '../brd/brd-files';
import { brdHash, readRequirements, writeRequirements } from '../brd/requirements-files';
import { projectStore } from '../project-store';
import { getActiveProviderFeatureSettings } from './feature-settings-helper';
import { getJiraConfig } from '../jira/config';
import { pushMilestoneToJira } from '../jira/push-milestone';
import { createTaskInProject } from './task/create-task';
import { safeSendToRenderer } from './utils';

interface ActiveRun { runId: string; slug: string; controller: AbortController }
const activeRuns = new Map<string, ActiveRun>(); // keyed by `${projectId}:${slug}`

/** Take the per-slug lock shared by generation, release, and Jira pushes. Returns a release function, or null when busy. */
export function tryAcquireSlugLock(projectId: string, slug: string): (() => void) | null {
  const key = `${projectId}:${slug}`;
  if (activeRuns.has(key)) return null;
  activeRuns.set(key, { runId: randomUUID(), slug, controller: new AbortController() });
  return () => activeRuns.delete(key);
}

const RELEASE_GATE_MESSAGES: Record<ReleaseGateReason, string> = {
  noSet: 'Generate and approve a requirements set before releasing a milestone',
  notApproved: 'Approve the requirements set before releasing a milestone',
  dirty: 'Save the requirements set before releasing a milestone',
  stale: 'The BRD changed since this set was generated; regenerate and approve it first',
  notNext: 'Release earlier milestones first',
  complete: 'This milestone is already released',
};

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

    // Defer past the invoke reply so the renderer knows the runId before any event arrives.
    setTimeout(() => {
      if (controller.signal.aborted) {
        activeRuns.delete(key);
        safeSendToRenderer(getMainWindow, IPC_CHANNELS.REQUIREMENTS_ERROR, { runId, error: 'cancelled' });
        return;
      }
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
          const { set: merged, warnings } = mergeRefinement(previous, event.body, request.selection);
          // The model was given the current BRD, so the refined set is current again.
          const set: RequirementsSet = { ...merged, brdHash: hash };
          safeSendToRenderer(getMainWindow, IPC_CHANNELS.REQUIREMENTS_DONE, { runId, set, changeSummary: event.body.changeSummary ?? undefined, warnings });
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
    }, 0);
    return { success: true, data: { runId } };
  });

  ipcMain.handle(IPC_CHANNELS.REQUIREMENTS_CANCEL, (_e, runId: string): IPCResult => {
    const run = [...activeRuns.values()].find((r) => r.runId === runId);
    if (!run) return { success: false, error: `No running generation with id ${runId}` };
    run.controller.abort();
    return { success: true };
  });

  ipcMain.handle(
    IPC_CHANNELS.REQUIREMENTS_RELEASE,
    async (_e, projectId: string, slug: string, milestoneId: string): Promise<IPCResult<{ set: RequirementsSet; tasks: Task[]; warnings: string[] }>> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };
      const unlock = tryAcquireSlugLock(projectId, slug);
      if (!unlock) return { success: false, error: 'A run is already in progress for this BRD' };
      try {
        const [stored, brd] = await Promise.all([readRequirements(project.path, slug), readBrd(project.path, slug)]);
        const reason = releaseGate(stored, stored, brdHash(brd.content), milestoneId);
        if (reason || !stored) return { success: false, error: RELEASE_GATE_MESSAGES[reason ?? 'noSet'] };

        let current: RequirementsSet = stored;
        const created: Task[] = [];
        const alreadyDone = new Set((current.releases?.[milestoneId]?.tasks ?? []).map((t) => t.proposedTaskId));
        for (const proposed of includedTasksOf(current, milestoneId)) {
          if (alreadyDone.has(proposed.id)) continue;
          let task: Task;
          try {
            task = createTaskInProject(project, buildReleaseTaskInput(current, proposed, brd.summary.title));
          } catch (err) {
            return { success: false, error: `Could not create a task for ${proposed.id} (${proposed.title}): ${err instanceof Error ? err.message : String(err)}` };
          }
          created.push(task);
          const entry = current.releases?.[milestoneId] ?? { releasedAt: new Date().toISOString(), tasks: [] };
          current = {
            ...current,
            releases: { ...(current.releases ?? {}), [milestoneId]: { ...entry, tasks: [...entry.tasks, { proposedTaskId: proposed.id, specId: task.specId }] } },
          };
          try {
            current = await writeRequirements(project.path, slug, current);
          } catch (err) {
            const ids = created.map((t) => t.specId).join(', ');
            return { success: false, error: `Tasks ${ids} were created but the release record could not be saved: ${err instanceof Error ? err.message : String(err)}` };
          }
        }
        const warnings: string[] = [];
        if (created.length > 0 && getJiraConfig(project)) {
          try {
            // The lock is already held by this handler; push reads and writes the set file directly.
            const pushed = await pushMilestoneToJira(project, slug, milestoneId);
            current = pushed.set;
            warnings.push(...pushed.warnings);
          } catch (err) {
            warnings.push(`Jira push failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return { success: true, data: { set: current, tasks: created, warnings } };
      } catch (err) {
        return fail(err);
      } finally {
        unlock();
      }
    },
  );
}
