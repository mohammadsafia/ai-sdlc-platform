// apps/desktop/src/shared/types/design.ts
export type DesignBriefStatus = 'draft' | 'approved';
export const DESIGN_BRIEF_STATUSES: readonly DesignBriefStatus[] = ['draft', 'approved'];

export interface DesignBriefSummary {
  brdSlug: string;
  requirementId: string;
  title: string;
  status: DesignBriefStatus;
  /** ISO timestamp of the file's last modification */
  modifiedAt: string;
  /** Set when the frontmatter could not be fully parsed */
  warning?: string;
}

export interface DesignFrontmatter {
  brd?: string;
  requirement?: string;
  title?: string;
  status: DesignBriefStatus;
  updated?: string;
  errors: string[];
}

export type DesignDraftMode = 'draft' | 'revise';
export interface DesignDraftRequest {
  brdSlug: string;
  requirementId: string;
  mode: DesignDraftMode;
  notes: string;
}
export interface DesignDraftChunk {
  runId: string;
  text: string;
}
export interface DesignDraftDone {
  runId: string;
  text: string;
}
export interface DesignDraftError {
  runId: string;
  error: string;
}
