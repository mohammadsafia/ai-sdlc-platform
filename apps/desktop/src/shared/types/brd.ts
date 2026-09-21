// apps/desktop/src/shared/types/brd.ts
export type BrdStatus = 'draft' | 'review' | 'approved';
export const BRD_STATUSES: readonly BrdStatus[] = ['draft', 'review', 'approved'];

export interface BrdSummary {
  slug: string;
  title: string;
  status: BrdStatus;
  owner?: string;
  created?: string;
  /** ISO timestamp of the file's last modification */
  modifiedAt: string;
  /** Set when the file could not be fully parsed (e.g. missing frontmatter title) */
  warning?: string;
}

export interface BrdFrontmatter {
  title?: string;
  status: BrdStatus;
  owner?: string;
  created?: string;
  errors: string[];
}

export interface BrdSection {
  heading: string;
  required: boolean;
  present: boolean;
  empty: boolean;
}

export interface BrdStructureResult {
  ok: boolean;
  sections: BrdSection[];
  frontmatterErrors: string[];
}

export type BrdDraftMode = 'draft' | 'revise';

export interface BrdDraftRequest {
  mode: BrdDraftMode;
  /** PO notes (draft) or instructions (revise) */
  notes: string;
  /** Existing BRD to revise */
  slug?: string;
  /** Title for a new draft */
  title?: string;
}

export interface BrdDraftChunk { runId: string; text: string }
export interface BrdDraftDone { runId: string; text: string }
export interface BrdDraftError { runId: string; error: string }

/** Git state of docs/brd (see main/brd/brd-git.ts). */
export type BrdFileStatus = 'added' | 'modified' | 'deleted' | 'untracked';
export interface BrdChangedFile { path: string; status: BrdFileStatus }
export interface BrdChanges { branch: string; files: BrdChangedFile[] }
export interface BrdCommitResult { commit: string; pushed: boolean; pushError?: string }
