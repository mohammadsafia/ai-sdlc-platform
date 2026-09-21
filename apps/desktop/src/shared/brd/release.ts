// apps/desktop/src/shared/brd/release.ts
import type { Milestone, ProposedTask, RequirementsSet } from '../types/requirements';
import type { TaskCategory, TaskMetadata, TaskStatus } from '../types/task';

export type ReleaseGateReason = 'noSet' | 'notApproved' | 'dirty' | 'stale' | 'notNext' | 'complete';

/** Proposed task category → Kanban task category. */
export const RELEASE_CATEGORY: Record<ProposedTask['category'], TaskCategory> = {
  feature: 'feature',
  bug: 'bug_fix',
  refactor: 'refactoring',
  docs: 'documentation',
};

/** Included tasks of one milestone, in release order. */
export function includedTasksOf(set: RequirementsSet, milestoneId: string): ProposedTask[] {
  return set.tasks.filter((t) => t.included && t.milestoneId === milestoneId).sort((a, b) => a.order - b.order);
}

/** proposedTaskId → specId for every released task, across milestones. */
export function releasedTaskSpecIds(set: RequirementsSet): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of Object.values(set.releases ?? {})) {
    for (const t of entry.tasks) out.set(t.proposedTaskId, t.specId);
  }
  return out;
}

/** True when every included task of the milestone has a spec id. */
export function isMilestoneComplete(set: RequirementsSet, milestoneId: string): boolean {
  const entry = set.releases?.[milestoneId];
  if (!entry) return false;
  const released = new Set(entry.tasks.map((t) => t.proposedTaskId));
  return includedTasksOf(set, milestoneId).every((t) => released.has(t.id));
}

/** The lowest-order included milestone that is not complete, or null when everything is released. */
export function nextReleasableMilestone(set: RequirementsSet): Milestone | null {
  const candidates = set.milestones
    .filter((m) => m.included && !isMilestoneComplete(set, m.id))
    .sort((a, b) => a.order - b.order);
  return candidates[0] ?? null;
}

/** Ids that must not change anymore: released tasks, milestones with an entry, and requirements whose every included covering task is released. */
export function lockedIds(set: RequirementsSet): Set<string> {
  const specs = releasedTaskSpecIds(set);
  const locked = new Set<string>(specs.keys());
  for (const m of set.milestones) if (set.releases?.[m.id]) locked.add(m.id);
  for (const r of set.requirements) {
    if (!r.included) continue;
    const covering = set.tasks.filter((t) => t.included && t.requirementIds.includes(r.id));
    if (covering.length > 0 && covering.every((t) => specs.has(t.id))) locked.add(r.id);
  }
  return locked;
}

/** Per requirement: how many covering tasks were released and how many of those are done on this machine. */
export function requirementRollup(
  set: RequirementsSet,
  statuses: Map<string, TaskStatus>,
): Record<string, { released: number; done: number }> {
  const specs = releasedTaskSpecIds(set);
  const out: Record<string, { released: number; done: number }> = {};
  for (const r of set.requirements) {
    let released = 0;
    let done = 0;
    for (const t of set.tasks) {
      if (!t.included || !t.requirementIds.includes(r.id)) continue;
      const specId = specs.get(t.id);
      if (!specId) continue;
      released++;
      if (statuses.get(specId) === 'done') done++;
    }
    if (released > 0) out[r.id] = { released, done };
  }
  return out;
}

/** First failing release precondition, or null when the milestone can be released. */
export function releaseGate(
  set: RequirementsSet | null,
  savedSet: RequirementsSet | null,
  currentBrdHash: string,
  milestoneId: string,
): ReleaseGateReason | null {
  if (!set) return 'noSet';
  if (set.status !== 'approved') return 'notApproved';
  if (JSON.stringify(set) !== JSON.stringify(savedSet)) return 'dirty';
  if (set.brdHash !== currentBrdHash) return 'stale';
  if (isMilestoneComplete(set, milestoneId)) return 'complete';
  const next = nextReleasableMilestone(set);
  if (!next || next.id !== milestoneId) return 'notNext';
  return null;
}

/** Deterministic Kanban task content for one proposed task. */
export function buildReleaseTaskInput(
  set: RequirementsSet,
  task: ProposedTask,
  brdTitle: string,
): { title: string; description: string; metadata: TaskMetadata } {
  const requirements = set.requirements.filter((r) => task.requirementIds.includes(r.id));
  const milestone = set.milestones.find((m) => m.id === task.milestoneId);
  const lines: string[] = [task.description.trim(), '', '## Requirements covered', ''];
  for (const r of requirements) {
    lines.push(`### ${r.id}: ${r.title}`, r.description.trim(), '', 'Acceptance criteria:');
    for (const c of r.acceptanceCriteria) lines.push(`- [ ] ${c}`);
    lines.push('');
  }
  lines.push(
    `Source: BRD "${brdTitle}" (docs/brd/${set.brdSlug}.md), milestone ${milestone?.name ?? task.milestoneId}, requirements set docs/brd/${set.brdSlug}.requirements.json`,
  );
  return {
    title: task.title,
    description: lines.join('\n'),
    metadata: {
      sourceType: 'requirements',
      brdSlug: set.brdSlug,
      milestoneId: task.milestoneId,
      requirementIds: [...task.requirementIds],
      proposedTaskId: task.id,
      category: RELEASE_CATEGORY[task.category],
      acceptanceCriteria: requirements.flatMap((r) => r.acceptanceCriteria),
    },
  };
}
