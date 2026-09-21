// apps/desktop/src/main/jira/env.ts
import { parseStatusMap, serializeStatusMap } from '../../shared/jira/status-map';
import type { ProjectEnvConfig } from '../../shared/types';

export const JIRA_ENV_KEYS = {
  ENABLED: 'JIRA_ENABLED',
  BASE_URL: 'JIRA_BASE_URL',
  EMAIL: 'JIRA_EMAIL',
  API_TOKEN: 'JIRA_API_TOKEN',
  PROJECT_KEY: 'JIRA_PROJECT_KEY',
  ISSUE_TYPE: 'JIRA_ISSUE_TYPE',
  EPIC_ISSUE_TYPE: 'JIRA_EPIC_ISSUE_TYPE',
  STATUS_MAP: 'JIRA_STATUS_MAP',
} as const;

type JiraEnvConfig = Pick<ProjectEnvConfig, 'jiraEnabled' | 'jiraBaseUrl' | 'jiraEmail' | 'jiraApiToken' | 'jiraProjectKey' | 'jiraIssueType' | 'jiraEpicIssueType' | 'jiraStatusMap'>;

/** Jira config from parsed .env vars. Enabled when a token exists and JIRA_ENABLED is not "false". */
export function readJiraEnv(vars: Record<string, string>): JiraEnvConfig {
  const out: JiraEnvConfig = { jiraEnabled: false };
  const token = vars[JIRA_ENV_KEYS.API_TOKEN]?.trim();
  if (token) {
    out.jiraApiToken = token;
    out.jiraEnabled = vars[JIRA_ENV_KEYS.ENABLED]?.toLowerCase() !== 'false';
  }
  const baseUrl = vars[JIRA_ENV_KEYS.BASE_URL]?.trim();
  if (baseUrl) out.jiraBaseUrl = baseUrl.replace(/\/+$/, '');
  const email = vars[JIRA_ENV_KEYS.EMAIL]?.trim();
  if (email) out.jiraEmail = email;
  const key = vars[JIRA_ENV_KEYS.PROJECT_KEY]?.trim();
  if (key) out.jiraProjectKey = key.toUpperCase();
  out.jiraIssueType = vars[JIRA_ENV_KEYS.ISSUE_TYPE]?.trim() || 'Task';
  out.jiraEpicIssueType = vars[JIRA_ENV_KEYS.EPIC_ISSUE_TYPE]?.trim() || 'Epic';
  out.jiraStatusMap = parseStatusMap(vars[JIRA_ENV_KEYS.STATUS_MAP]);
  return out;
}

/** Env var updates for the provided Jira fields only. */
export function jiraEnvUpdates(config: Partial<ProjectEnvConfig>): Record<string, string> {
  const u: Record<string, string> = {};
  if (config.jiraEnabled !== undefined) u[JIRA_ENV_KEYS.ENABLED] = config.jiraEnabled ? 'true' : 'false';
  if (config.jiraBaseUrl !== undefined) u[JIRA_ENV_KEYS.BASE_URL] = config.jiraBaseUrl.replace(/\/+$/, '');
  if (config.jiraEmail !== undefined) u[JIRA_ENV_KEYS.EMAIL] = config.jiraEmail;
  if (config.jiraApiToken !== undefined) u[JIRA_ENV_KEYS.API_TOKEN] = config.jiraApiToken;
  if (config.jiraProjectKey !== undefined) u[JIRA_ENV_KEYS.PROJECT_KEY] = config.jiraProjectKey.toUpperCase();
  if (config.jiraIssueType !== undefined) u[JIRA_ENV_KEYS.ISSUE_TYPE] = config.jiraIssueType;
  if (config.jiraEpicIssueType !== undefined) u[JIRA_ENV_KEYS.EPIC_ISSUE_TYPE] = config.jiraEpicIssueType;
  if (config.jiraStatusMap !== undefined) u[JIRA_ENV_KEYS.STATUS_MAP] = serializeStatusMap(config.jiraStatusMap);
  return u;
}
