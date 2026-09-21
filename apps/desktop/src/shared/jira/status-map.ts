// apps/desktop/src/shared/jira/status-map.ts
import type { TaskStatus } from '../types/task';

export type JiraStatusMap = Record<TaskStatus, string | null>;

export const TASK_STATUSES: readonly TaskStatus[] = ['backlog', 'queue', 'in_progress', 'ai_review', 'human_review', 'done', 'pr_created', 'error'];

export const DEFAULT_JIRA_STATUS_MAP: JiraStatusMap = {
  backlog: 'To Do',
  queue: 'To Do',
  in_progress: 'In Progress',
  ai_review: 'In Progress',
  human_review: 'In Progress',
  done: 'Done',
  pr_created: 'Done',
  error: null,
};

/** Parse the compact env form `status:Name;status:Name`; an empty name means not synced. Unknown or malformed input keeps defaults. */
export function parseStatusMap(text: string | undefined | null): JiraStatusMap {
  const out: JiraStatusMap = { ...DEFAULT_JIRA_STATUS_MAP };
  if (!text || !text.includes(':')) return out;
  for (const pair of text.split(';')) {
    const idx = pair.indexOf(':');
    if (idx < 0) continue;
    const status = pair.slice(0, idx).trim() as TaskStatus;
    if (!TASK_STATUSES.includes(status)) continue;
    const name = pair.slice(idx + 1).trim();
    out[status] = name.length > 0 ? name : null;
  }
  return out;
}

export function serializeStatusMap(map: JiraStatusMap): string {
  return TASK_STATUSES.map((s) => `${s}:${map[s] ?? ''}`).join(';');
}

export function targetStatusFor(map: JiraStatusMap, status: TaskStatus): string | null {
  return map[status] ?? null;
}
