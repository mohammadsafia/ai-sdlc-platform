// apps/desktop/src/shared/design/release.ts
import type { DesignBriefSummary } from '../types/design';
import type { RequirementsSet } from '../types/requirements';

/** Ids of needsDesign requirements covered by the milestone's included tasks that have no approved brief, in set order. */
export function needsDesignWithoutApprovedBrief(set: RequirementsSet, milestoneId: string, briefs: DesignBriefSummary[]): string[] {
  const covered = new Set(set.tasks.filter((t) => t.milestoneId === milestoneId && t.included).flatMap((t) => t.requirementIds));
  const approved = new Set(briefs.filter((b) => b.brdSlug === set.brdSlug && b.status === 'approved').map((b) => b.requirementId));
  return set.requirements.filter((r) => r.needsDesign && covered.has(r.id) && !approved.has(r.id)).map((r) => r.id);
}
