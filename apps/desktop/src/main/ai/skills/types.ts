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

export type {
  SkillSource,
  SkillDefinition,
  CentralRepoConfig,
  SkillsConfig,
  SkillsLockEntry,
  SkillsLock,
  SkillsSnapshot,
  AgentSkills,
  SkillUsageRecord,
} from '../../../shared/types/skills';

import type { SkillsSnapshot } from '../../../shared/types/skills';

export function emptySnapshot(): SkillsSnapshot {
  return { skills: [], pins: {}, warnings: [], lock: { repos: {} } };
}
