// apps/desktop/src/preload/api/modules/jira-api.ts
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import type { JiraConnectionStatus, JiraImportResult, JiraMetadata, JiraSearchParams, JiraSearchResult } from '../../../shared/types/integrations';
import type { RequirementsSet } from '../../../shared/types/requirements';
import { invokeIpc } from './ipc-utils';

export interface JiraAPI {
  jiraCheckConnection: (projectId: string) => Promise<IPCResult<JiraConnectionStatus>>;
  jiraGetMetadata: (projectId: string) => Promise<IPCResult<JiraMetadata>>;
  jiraSearchIssues: (projectId: string, params: JiraSearchParams) => Promise<IPCResult<JiraSearchResult>>;
  jiraImportIssues: (projectId: string, keys: string[]) => Promise<IPCResult<JiraImportResult>>;
  jiraPushMilestone: (projectId: string, slug: string, milestoneId: string) => Promise<IPCResult<{ set: RequirementsSet; warnings: string[] }>>;
  jiraRetrySync: (projectId: string, taskId: string) => Promise<IPCResult<{ synced: boolean; error?: string }>>;
}

export const createJiraAPI = (): JiraAPI => ({
  jiraCheckConnection: (projectId) => invokeIpc(IPC_CHANNELS.JIRA_CHECK_CONNECTION, projectId),
  jiraGetMetadata: (projectId) => invokeIpc(IPC_CHANNELS.JIRA_GET_METADATA, projectId),
  jiraSearchIssues: (projectId, params) => invokeIpc(IPC_CHANNELS.JIRA_SEARCH_ISSUES, projectId, params),
  jiraImportIssues: (projectId, keys) => invokeIpc(IPC_CHANNELS.JIRA_IMPORT_ISSUES, projectId, keys),
  jiraPushMilestone: (projectId, slug, milestoneId) => invokeIpc(IPC_CHANNELS.JIRA_PUSH_MILESTONE, projectId, slug, milestoneId),
  jiraRetrySync: (projectId, taskId) => invokeIpc(IPC_CHANNELS.JIRA_RETRY_SYNC, projectId, taskId),
});
