// apps/desktop/src/shared/types/requirements.ts
export type RequirementsStatus = 'draft' | 'approved';
export type ProposedTaskCategory = 'feature' | 'bug' | 'refactor' | 'docs';
export const PROPOSED_TASK_CATEGORIES: readonly ProposedTaskCategory[] = ['feature', 'bug', 'refactor', 'docs'];

export interface Requirement {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  area: string;
  needsDesign: boolean;
  included: boolean;
}

export interface Milestone {
  id: string;
  name: string;
  description: string;
  order: number;
  included: boolean;
}

export interface ProposedTask {
  id: string;
  title: string;
  description: string;
  milestoneId: string;
  requirementIds: string[];
  category: ProposedTaskCategory;
  order: number;
  included: boolean;
}

/** One Kanban task created from a proposed task. */
export interface ReleasedTask {
  proposedTaskId: string;   // "T3"
  specId: string;           // Kanban task id and spec directory name
}

/** Release record for one milestone; may be partial after a failure midway. */
export interface MilestoneRelease {
  releasedAt: string;       // ISO, first successful task creation
  tasks: ReleasedTask[];
}

export interface RequirementsSet {
  version: 1;
  brdSlug: string;
  brdHash: string;
  status: RequirementsStatus;
  generatedAt: string;
  approvedAt?: string;
  requirements: Requirement[];
  milestones: Milestone[];
  tasks: ProposedTask[];
  /** Keyed by milestone id. Absent until the first release. */
  releases?: Record<string, MilestoneRelease>;
}

/** Model output before post-processing. Ids are null for new items and echoed back during refinement. */
export interface GeneratedBody {
  requirements: Array<Omit<Requirement, 'id' | 'included'> & { id?: string | null }>;
  milestones: Array<Omit<Milestone, 'id' | 'included'> & { id?: string | null }>;
  tasks: Array<Omit<ProposedTask, 'id' | 'included'> & { id?: string | null }>;
  changeSummary?: string | null;
}

export interface SectionCounts { added: number; changed: number; removed: number }
export interface SectionDiff { requirements: SectionCounts; milestones: SectionCounts; tasks: SectionCounts }

export type RequirementsRunMode = 'generate' | 'refine';
export interface RequirementsGenerateRequest {
  slug: string;
  mode: RequirementsRunMode;
  feedback?: string;
  selection?: string[];
}
export type RequirementsRunPhase = 'started' | 'parsing' | 'repairing';
export interface RequirementsProgress { runId: string; phase: RequirementsRunPhase }
export interface RequirementsDone { runId: string; set: RequirementsSet; changeSummary?: string; warnings: string[] }
export interface RequirementsError { runId: string; error: string }
