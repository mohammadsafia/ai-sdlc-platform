// apps/desktop/src/main/ipc-handlers/jira/index.ts
import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/constants';
import { adfToText } from '../../../shared/jira/adf';
import type { IPCResult, Task } from '../../../shared/types';
import type { JiraConnectionStatus, JiraImportResult, JiraMetadata, JiraSearchParams, JiraSearchResult } from '../../../shared/types/integrations';
import type { RequirementsSet } from '../../../shared/types/requirements';
import { createJiraClient, getJiraConfig } from '../../jira/config';
import { pushMilestoneToJira } from '../../jira/push-milestone';
import { syncTaskStatus } from '../../jira/status-sync';
import { projectStore } from '../../project-store';
import { tryAcquireSlugLock } from '../requirements-handlers';
import { createTaskInProject } from '../task/create-task';

const NOT_CONFIGURED = 'Jira is not configured for this project';

function fail(err: unknown): IPCResult<never> {
  return { success: false, error: err instanceof Error ? err.message : String(err) };
}

function linkedKeys(projectId: string): Set<string> {
  const keys = new Set<string>();
  for (const t of projectStore.getTasks(projectId)) if (t.metadata?.jiraKey) keys.add(t.metadata.jiraKey);
  return keys;
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function registerJiraHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.JIRA_CHECK_CONNECTION, async (_e, projectId: string): Promise<IPCResult<JiraConnectionStatus>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    const config = getJiraConfig(project);
    if (!config) return { success: false, error: NOT_CONFIGURED };
    try {
      const client = createJiraClient(config);
      const me = await client.myself();
      const data: JiraConnectionStatus = { accountName: me.displayName };
      if (config.projectKey) data.projectName = (await client.project(config.projectKey)).name;
      return { success: true, data };
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(IPC_CHANNELS.JIRA_GET_METADATA, async (_e, projectId: string): Promise<IPCResult<JiraMetadata>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    const config = getJiraConfig(project);
    if (!config) return { success: false, error: NOT_CONFIGURED };
    if (!config.projectKey) return { success: false, error: 'Set a Jira project key first' };
    try {
      const client = createJiraClient(config);
      const [proj, statuses] = await Promise.all([client.project(config.projectKey), client.statuses(config.projectKey)]);
      return { success: true, data: { issueTypes: proj.issueTypes.filter((t) => !t.subtask).map((t) => t.name), statuses } };
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(IPC_CHANNELS.JIRA_SEARCH_ISSUES, async (_e, projectId: string, params: JiraSearchParams = {}): Promise<IPCResult<JiraSearchResult>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    const config = getJiraConfig(project);
    if (!config) return { success: false, error: NOT_CONFIGURED };
    if (!config.projectKey) return { success: false, error: 'Set a Jira project key first' };
    try {
      const clauses = [`project = ${quote(config.projectKey)}`];
      if (params.status) clauses.push(`status = ${quote(params.status)}`);
      if (params.jql?.trim()) clauses.push(`(${params.jql.trim()})`);
      const client = createJiraClient(config);
      const page = await client.search({ jql: `${clauses.join(' AND ')} ORDER BY updated DESC`, nextPageToken: params.pageToken });
      const linked = linkedKeys(projectId);
      const issues = page.issues.map((i) => ({
        key: i.key,
        summary: i.fields.summary,
        status: i.fields.status?.name ?? '',
        issueType: i.fields.issuetype?.name ?? '',
        assignee: i.fields.assignee?.displayName,
        updated: i.fields.updated ?? '',
        url: client.browseUrl(i.key),
        imported: linked.has(i.key),
      }));
      return { success: true, data: { issues, ...(page.isLast ? {} : { nextPageToken: page.nextPageToken }) } };
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(IPC_CHANNELS.JIRA_IMPORT_ISSUES, async (_e, projectId: string, keys: string[]): Promise<IPCResult<JiraImportResult>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    const config = getJiraConfig(project);
    if (!config) return { success: false, error: NOT_CONFIGURED };
    const client = createJiraClient(config);
    const linked = linkedKeys(projectId);
    const result: JiraImportResult = { imported: 0, skipped: [], failed: [], tasks: [] };
    for (const key of keys) {
      if (linked.has(key)) {
        result.skipped.push(key);
        continue;
      }
      try {
        const issue = await client.issue(key);
        const url = client.browseUrl(key);
        const body = adfToText(issue.fields.description);
        const description = `${body ? `${body}\n\n` : ''}Source: ${url}`;
        const task: Task = createTaskInProject(project, {
          title: issue.fields.summary,
          description,
          metadata: { sourceType: 'jira', jiraKey: key, jiraUrl: url, category: 'feature' },
        });
        result.tasks.push(task);
        result.imported++;
        linked.add(key);
      } catch (err) {
        result.failed.push({ key, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { success: true, data: result };
  });

  ipcMain.handle(IPC_CHANNELS.JIRA_PUSH_MILESTONE, async (_e, projectId: string, slug: string, milestoneId: string): Promise<IPCResult<{ set: RequirementsSet; warnings: string[] }>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    const unlock = tryAcquireSlugLock(projectId, slug);
    if (!unlock) return { success: false, error: 'A run is already in progress for this BRD' };
    try {
      const data = await pushMilestoneToJira(project, slug, milestoneId);
      return { success: true, data };
    } catch (err) {
      return fail(err);
    } finally {
      unlock();
    }
  });

  ipcMain.handle(IPC_CHANNELS.JIRA_RETRY_SYNC, async (_e, projectId: string, taskId: string): Promise<IPCResult<{ synced: boolean; error?: string }>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    const task = projectStore.getTasks(projectId).find((t) => t.id === taskId || t.specId === taskId);
    if (!task) return { success: false, error: `Task not found: ${taskId}` };
    const data = await syncTaskStatus(projectId, task.specId ?? task.id, task.status);
    return { success: true, data };
  });
}
