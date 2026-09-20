// apps/desktop/src/main/ipc-handlers/brd-handlers.ts
import { randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import type { BrdDraftRequest, BrdSummary } from '../../shared/types/brd';
import { runBrdWriter } from '../ai/runners/brd-writer';
import type { ThinkingLevel } from '../ai/config/types';
import { createBrd, listBrds, readBrd, writeBrd } from '../brd/brd-files';
import { projectStore } from '../project-store';
import { getActiveProviderFeatureSettings } from './feature-settings-helper';
import { safeSendToRenderer } from './utils';

interface ActiveRun { runId: string; projectId: string; controller: AbortController }

const activeRuns = new Map<string, ActiveRun>(); // keyed by projectId

async function withProject<T>(projectId: string, fn: (projectPath: string) => Promise<T>): Promise<IPCResult<T>> {
  const project = projectStore.getProject(projectId);
  if (!project) return { success: false, error: `Project not found: ${projectId}` };
  try {
    return { success: true, data: await fn(project.path) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function registerBrdHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC_CHANNELS.BRD_LIST, (_e, projectId: string) => withProject(projectId, (p) => listBrds(p)));
  ipcMain.handle(IPC_CHANNELS.BRD_READ, (_e, projectId: string, slug: string) => withProject(projectId, (p) => readBrd(p, slug)));
  ipcMain.handle(IPC_CHANNELS.BRD_WRITE, (_e, projectId: string, slug: string, content: string) =>
    withProject<BrdSummary>(projectId, (p) => writeBrd(p, slug, content)),
  );
  ipcMain.handle(IPC_CHANNELS.BRD_CREATE, (_e, projectId: string, title: string) =>
    withProject<BrdSummary>(projectId, (p) => createBrd(p, title)),
  );

  ipcMain.handle(IPC_CHANNELS.BRD_DRAFT, async (_e, projectId: string, request: BrdDraftRequest): Promise<IPCResult<{ runId: string }>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    if (activeRuns.has(projectId)) return { success: false, error: 'A draft is already running for this project' };

    let existing: string | undefined;
    if (request.mode === 'revise' && request.slug) {
      try {
        existing = (await readBrd(project.path, request.slug)).content;
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    const runId = randomUUID();
    const controller = new AbortController();
    activeRuns.set(projectId, { runId, projectId, controller });
    const { model, thinkingLevel } = getActiveProviderFeatureSettings('roadmap');

    // Defer past the invoke reply so the renderer knows the runId before any event arrives.
    setTimeout(() => {
      if (controller.signal.aborted) {
        activeRuns.delete(projectId);
        safeSendToRenderer(getMainWindow, IPC_CHANNELS.BRD_DRAFT_ERROR, { runId, error: 'cancelled' });
        return;
      }
      void runBrdWriter(
      {
        projectDir: project.path,
        mode: request.mode,
        notes: request.notes,
        existing,
        title: request.title,
        modelShorthand: model,
        thinkingLevel: thinkingLevel as ThinkingLevel,
        abortSignal: controller.signal,
      },
      (event) => {
        if (event.type === 'text-delta') {
          safeSendToRenderer(getMainWindow, IPC_CHANNELS.BRD_DRAFT_CHUNK, { runId, text: event.text });
          return;
        }
        if (activeRuns.get(projectId)?.runId === runId) activeRuns.delete(projectId);
        if (event.type === 'done') {
          safeSendToRenderer(getMainWindow, IPC_CHANNELS.BRD_DRAFT_DONE, { runId, text: event.text });
        } else {
          safeSendToRenderer(getMainWindow, IPC_CHANNELS.BRD_DRAFT_ERROR, { runId, error: event.error });
        }
      },
    );
    }, 0);

    return { success: true, data: { runId } };
  });

  ipcMain.handle(IPC_CHANNELS.BRD_DRAFT_CANCEL, (_e, runId: string): IPCResult => {
    const run = [...activeRuns.values()].find((r) => r.runId === runId);
    if (!run) return { success: false, error: `No running draft with id ${runId}` };
    run.controller.abort();
    return { success: true };
  });
}
