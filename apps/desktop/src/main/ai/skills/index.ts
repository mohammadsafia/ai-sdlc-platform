// apps/desktop/src/main/ai/skills/index.ts
export * from './types';
export { loadSkillsConfig, loadSkillsLock, writeSkillsLock, isAllowedRepoUrl, DEFAULT_ALLOWED_SCHEMES } from './config';
export { discoverSkills } from './discovery';
export { parseFrontmatter } from './frontmatter';
export { readSkillBody, listSkillFiles, readSkillResource, appendSkillUsage, readSkillUsage } from './skill-files';
export { agentPhaseGroup, buildSnapshot, getSkillsForAgent, effectiveSkills, findSkill } from './resolver';
export { createGitRunner, ensureCheckout, refreshRepo } from './sync';
export type { GitRunner, SyncDeps } from './sync';
export { resolveSkills, refreshSkills } from './resolve';
export type { ResolveOptions } from './resolve';
