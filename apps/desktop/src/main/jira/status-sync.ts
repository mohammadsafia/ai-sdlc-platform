// apps/desktop/src/main/jira/status-sync.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { getSpecsDir } from '../../shared/constants';
import { targetStatusFor } from '../../shared/jira/status-map';
import type { TaskMetadata, TaskStatus } from '../../shared/types/task';
import { projectStore } from '../project-store';
import { createJiraClient, getJiraConfig } from './config';

const timers = new Map<string, NodeJS.Timeout>();

function metadataPath(projectPath: string, autoBuildPath: string, taskId: string): string {
  return path.join(projectPath, getSpecsDir(autoBuildPath), taskId, 'task_metadata.json');
}

/** Transition the linked Jira issue to the status mapped from the Kanban status. Never throws. */
export async function syncTaskStatus(projectId: string, taskId: string, status: TaskStatus): Promise<{ synced: boolean; error?: string }> {
  const project = projectStore.getProject(projectId);
  if (!project) return { synced: false };
  const config = getJiraConfig(project);
  if (!config) return { synced: false };
  const file = metadataPath(project.path, project.autoBuildPath, taskId);
  let metadata: TaskMetadata = {};
  try {
    if (existsSync(file)) metadata = JSON.parse(readFileSync(file, 'utf-8')) as TaskMetadata;
  } catch {
    return { synced: false };
  }
  if (!metadata.jiraKey) return { synced: false };
  const target = targetStatusFor(config.statusMap, status);
  if (!target) return { synced: false };

  const write = (patch: Partial<TaskMetadata>) => writeFileSync(file, JSON.stringify({ ...metadata, ...patch }, null, 2), 'utf-8');
  try {
    const client = createJiraClient(config);
    const transitions = await client.transitions(metadata.jiraKey);
    const match = transitions.find((t) => t.to.name.toLowerCase() === target.toLowerCase());
    if (!match) {
      const error = `No transition to '${target}' is available from the issue's current status`;
      write({ jiraSyncError: error });
      return { synced: false, error };
    }
    await client.transition(metadata.jiraKey, match.id);
    const { jiraSyncError: _cleared, ...rest } = metadata;
    metadata = rest;
    write({ jiraSyncedStatus: target });
    return { synced: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(`[JiraSync] ${taskId}: ${error}`);
    write({ jiraSyncError: error });
    return { synced: false, error };
  }
}

/** Debounced sync: rapid status changes for one task send a single transition for the last status. */
export function scheduleJiraSync(projectId: string, taskId: string, status: TaskStatus, delayMs = 500): void {
  const key = `${projectId}:${taskId}`;
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void syncTaskStatus(projectId, taskId, status);
    }, delayMs),
  );
}
