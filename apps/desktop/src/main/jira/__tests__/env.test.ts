// apps/desktop/src/main/jira/__tests__/env.test.ts
import { describe, it, expect } from 'vitest';
import { jiraEnvUpdates, readJiraEnv } from '../env';

describe('jira env', () => {
  it('reads enabled config from vars with defaults', () => {
    const c = readJiraEnv({ JIRA_BASE_URL: 'https://acme.atlassian.net/', JIRA_EMAIL: 'a@b.c', JIRA_API_TOKEN: 't', JIRA_PROJECT_KEY: 'acme' });
    expect(c).toMatchObject({ jiraEnabled: true, jiraBaseUrl: 'https://acme.atlassian.net', jiraEmail: 'a@b.c', jiraApiToken: 't', jiraProjectKey: 'ACME', jiraIssueType: 'Task', jiraEpicIssueType: 'Epic' });
    expect(c.jiraStatusMap?.done).toBe('Done');
  });
  it('is disabled without a token or when JIRA_ENABLED=false', () => {
    expect(readJiraEnv({}).jiraEnabled).toBe(false);
    expect(readJiraEnv({ JIRA_API_TOKEN: 't', JIRA_ENABLED: 'false' }).jiraEnabled).toBe(false);
  });
  it('produces env updates only for provided fields and serializes the map', () => {
    const u = jiraEnvUpdates({ jiraEnabled: true, jiraProjectKey: 'ACME', jiraStatusMap: { backlog: 'To Do', queue: 'To Do', in_progress: 'Doing', ai_review: 'Doing', human_review: 'Doing', done: 'Done', pr_created: 'Done', error: null } });
    expect(u).toEqual({ JIRA_ENABLED: 'true', JIRA_PROJECT_KEY: 'ACME', JIRA_STATUS_MAP: 'backlog:To Do;queue:To Do;in_progress:Doing;ai_review:Doing;human_review:Doing;done:Done;pr_created:Done;error:' });
    expect(jiraEnvUpdates({})).toEqual({});
  });
});
