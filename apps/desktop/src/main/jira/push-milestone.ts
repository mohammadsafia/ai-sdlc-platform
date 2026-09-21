// apps/desktop/src/main/jira/push-milestone.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { getSpecsDir } from '../../shared/constants';
import { buildEpicFields, buildTaskFields, pendingPushTasks } from '../../shared/jira/push';
import type { MilestoneJiraRelease, RequirementsSet } from '../../shared/types/requirements';
import type { TaskMetadata } from '../../shared/types/task';
import { readRequirements, writeRequirements } from '../brd/requirements-files';
import { createJiraClient, getJiraConfig } from './config';

type ProjectRef = { id: string; path: string; autoBuildPath: string };

function specDir(project: ProjectRef, specId: string): string {
  return path.join(project.path, getSpecsDir(project.autoBuildPath), specId);
}

function taskDescription(project: ProjectRef, specId: string, fallback: string): string {
  const plan = path.join(specDir(project, specId), 'implementation_plan.json');
  try {
    const parsed = JSON.parse(readFileSync(plan, 'utf-8')) as { description?: string };
    return typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description : fallback;
  } catch {
    return fallback;
  }
}

function stampTaskMetadata(project: ProjectRef, specId: string, patch: Partial<TaskMetadata>): void {
  const file = path.join(specDir(project, specId), 'task_metadata.json');
  let current: TaskMetadata = {};
  try {
    if (existsSync(file)) current = JSON.parse(readFileSync(file, 'utf-8')) as TaskMetadata;
  } catch {
    /* rewrite below */
  }
  writeFileSync(file, JSON.stringify({ ...current, ...patch }, null, 2), 'utf-8');
}

/**
 * Create the Epic and one issue per released task that has no key yet, recording
 * progress in the set after the epic and after each batch. Never creates duplicates.
 */
export async function pushMilestoneToJira(
  project: ProjectRef,
  slug: string,
  milestoneId: string,
): Promise<{ set: RequirementsSet; warnings: string[] }> {
  const config = getJiraConfig(project);
  if (!config) throw new Error('Jira is not configured for this project');
  if (!config.projectKey) throw new Error('Set a Jira project key before pushing');
  const stored = await readRequirements(project.path, slug);
  const entry = stored?.releases?.[milestoneId];
  if (!stored || !entry) throw new Error('Release the milestone before pushing it to Jira');
  const milestone = stored.milestones.find((m) => m.id === milestoneId);
  if (!milestone) throw new Error(`Milestone ${milestoneId} not found`);

  const client = createJiraClient(config);
  const warnings: string[] = [];
  let current = stored;

  const persist = async (jira: MilestoneJiraRelease): Promise<void> => {
    const rel = current.releases?.[milestoneId];
    if (!rel) return;
    current = await writeRequirements(project.path, slug, { ...current, releases: { ...(current.releases ?? {}), [milestoneId]: { ...rel, jira } } });
  };

  let jira: MilestoneJiraRelease | undefined = entry.jira;
  if (!jira) {
    const epic = await client.createIssue(buildEpicFields(config.projectKey, config.epicIssueType, milestone));
    jira = { epicKey: epic.key, issues: {}, pushedAt: new Date().toISOString() };
    await persist(jira);
  }
  const epicKey = jira.epicKey;

  const pending = pendingPushTasks(current, milestoneId);
  if (pending.length === 0) return { set: current, warnings };
  const byProposed = new Map(current.tasks.map((t) => [t.id, t]));
  const inputs = pending.map((p) => {
    const proposed = byProposed.get(p.proposedTaskId);
    const title = proposed?.title ?? p.specId;
    return buildTaskFields(config.projectKey, config.issueType, epicKey, title, taskDescription(project, p.specId, proposed?.description ?? title));
  });
  const result = await client.createIssues(inputs);
  for (const f of result.failed) {
    const p = pending[f.index];
    const proposed = byProposed.get(p.proposedTaskId);
    warnings.push(`Could not create a Jira issue for ${p.proposedTaskId} (${proposed?.title ?? p.specId}): ${f.error}`);
  }
  if (result.created.length > 0) {
    const issues = { ...jira.issues };
    for (const c of result.created) {
      const p = pending[c.index];
      issues[p.proposedTaskId] = c.key;
      stampTaskMetadata(project, p.specId, { jiraKey: c.key, jiraUrl: client.browseUrl(c.key), jiraEpicKey: epicKey });
    }
    jira = { ...jira, issues, pushedAt: new Date().toISOString() };
    await persist(jira);
  }
  return { set: current, warnings };
}
