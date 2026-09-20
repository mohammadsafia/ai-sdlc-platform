/**
 * Project Skills — types shared by main, preload, and renderer.
 * Constants and helpers live in src/main/ai/skills/types.ts.
 */

export type SkillSource = 'local' | 'central';

export interface SkillDefinition {
  name: string;
  description: string;
  source: SkillSource;
  /** Central only */
  repoUrl?: string;
  /** Central only */
  commit?: string;
  /** Absolute path to the skill folder, symlinks resolved */
  dir: string;
  /** Set on a central skill shadowed by a local skill of the same name */
  overriddenBy?: 'local';
}

export interface CentralRepoConfig {
  url: string;
  ref?: string;
  /** Folder inside the repo holding skill folders. "." = repo root. */
  subpath: string;
  /** Allow-list of skill names from this repo */
  include?: string[];
}

export interface SkillsConfig {
  centralRepos: CentralRepoConfig[];
  /** target (agent type or phase group) → skill names */
  pins: Record<string, string[]>;
  disabled: string[];
}

export interface SkillsLockEntry {
  ref: string;
  commit: string;
  resolvedAt: string;
}

export interface SkillsLock {
  repos: Record<string, SkillsLockEntry>;
}

/** Serializable, read-only result of resolution. Crosses the worker boundary. */
export interface SkillsSnapshot {
  skills: SkillDefinition[];
  pins: Record<string, string[]>;
  warnings: string[];
  /** Blocking error. When set, pipeline start must fail with this message. */
  error?: string;
  lock: SkillsLock;
}

export interface AgentSkills {
  pinned: SkillDefinition[];
  catalog: SkillDefinition[];
}

export interface SkillUsageRecord {
  name: string;
  resource?: string;
  agentType: string;
  pinned: boolean;
  at: string;
}
