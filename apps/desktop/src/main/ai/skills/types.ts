// apps/desktop/src/main/ai/skills/types.ts
/**
 * Project Skills — shared types.
 * A skill is a folder with SKILL.md (Agent Skills standard).
 * See docs/superpowers/specs/2026-09-20-project-skills-design.md
 */

export const SKILLS_DIR = '.claude/skills';
export const SKILLS_CONFIG_FILE = '.claude/skills.json';
export const SKILLS_LOCK_FILE = '.claude/skills.lock.json';
/** Written inside the spec directory by prompt assembly and the load_skill tool. */
export const SKILLS_USAGE_FILE = 'skills_used.json';

export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_PINNED_CHARS = 40_000;
export const MAX_SKILL_FILES_LISTED = 200;
export const MAX_RESOURCE_BYTES = 512 * 1024;
export const GIT_TIMEOUT_MS = 120_000;

export const PHASE_GROUPS = ['spec', 'planning', 'coding', 'qa'] as const;
export type PhaseGroup = (typeof PHASE_GROUPS)[number];

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

export function emptySnapshot(): SkillsSnapshot {
  return { skills: [], pins: {}, warnings: [], lock: { repos: {} } };
}
