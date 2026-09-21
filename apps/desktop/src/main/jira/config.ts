// apps/desktop/src/main/jira/config.ts
import type { JiraStatusMap } from '../../shared/jira/status-map';
import { loadProjectEnvVars } from '../ipc-handlers/context/utils';
import { JiraClient } from './client';
import { readJiraEnv } from './env';

export interface JiraProjectConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueType: string;
  epicIssueType: string;
  statusMap: JiraStatusMap;
}

/** Resolved Jira config for a project, or null when disabled or incomplete. */
export function getJiraConfig(project: { path: string; autoBuildPath?: string }): JiraProjectConfig | null {
  const env = readJiraEnv(loadProjectEnvVars(project.path, project.autoBuildPath));
  if (!env.jiraEnabled || !env.jiraBaseUrl || !env.jiraEmail || !env.jiraApiToken || !env.jiraStatusMap) return null;
  return {
    baseUrl: env.jiraBaseUrl,
    email: env.jiraEmail,
    apiToken: env.jiraApiToken,
    projectKey: env.jiraProjectKey ?? '',
    issueType: env.jiraIssueType ?? 'Task',
    epicIssueType: env.jiraEpicIssueType ?? 'Epic',
    statusMap: env.jiraStatusMap,
  };
}

export function createJiraClient(config: JiraProjectConfig): JiraClient {
  return new JiraClient({ baseUrl: config.baseUrl, email: config.email, apiToken: config.apiToken });
}
