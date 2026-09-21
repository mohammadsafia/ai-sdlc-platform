// apps/desktop/src/shared/jira/push.ts
import type { Milestone, ReleasedTask, RequirementsSet } from '../types/requirements';
import { type AdfDocument, markdownToAdf } from './adf';

export interface JiraIssueFields {
  fields: {
    project: { key: string };
    summary: string;
    issuetype: { name: string };
    description: AdfDocument;
    parent?: { key: string };
  };
}

/** Released tasks of the milestone that have no Jira issue yet. */
export function pendingPushTasks(set: RequirementsSet, milestoneId: string): ReleasedTask[] {
  const entry = set.releases?.[milestoneId];
  if (!entry) return [];
  const issues = entry.jira?.issues ?? {};
  return entry.tasks.filter((t) => !issues[t.proposedTaskId]);
}

/** True when the milestone has an epic and every released task has an issue key. */
export function isMilestonePushed(set: RequirementsSet, milestoneId: string): boolean {
  const entry = set.releases?.[milestoneId];
  if (!entry?.jira) return false;
  return entry.tasks.every((t) => !!entry.jira?.issues[t.proposedTaskId]);
}

export function buildEpicFields(projectKey: string, epicType: string, milestone: Milestone): JiraIssueFields {
  return { fields: { project: { key: projectKey }, summary: milestone.name, issuetype: { name: epicType }, description: markdownToAdf(milestone.description) } };
}

export function buildTaskFields(projectKey: string, issueType: string, epicKey: string, summary: string, markdown: string): JiraIssueFields {
  return { fields: { project: { key: projectKey }, summary, issuetype: { name: issueType }, description: markdownToAdf(markdown), parent: { key: epicKey } } };
}
