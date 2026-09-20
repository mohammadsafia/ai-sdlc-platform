// apps/desktop/src/main/ai/skills/resolver.ts
import { AGENT_CONFIGS } from '../config/agent-configs';
import {
  PHASE_GROUPS,
  type AgentSkills,
  type CentralRepoConfig,
  type PhaseGroup,
  type SkillDefinition,
  type SkillsConfig,
  type SkillsLock,
  type SkillsSnapshot,
} from './types';

export interface SnapshotInput {
  local: SkillDefinition[];
  central: Array<{ repo: CentralRepoConfig; skills: SkillDefinition[] }>;
  config: SkillsConfig;
  lock: SkillsLock;
  warnings: string[];
}

/** Pipeline agent → phase group. Non-pipeline agents return null. */
export function agentPhaseGroup(agentType: string): PhaseGroup | null {
  if (agentType.startsWith('spec_')) return 'spec';
  if (agentType === 'planner') return 'planning';
  if (agentType === 'coder') return 'coding';
  if (agentType === 'qa_reviewer' || agentType === 'qa_fixer') return 'qa';
  return null;
}

function isKnownPinTarget(target: string): boolean {
  return (PHASE_GROUPS as readonly string[]).includes(target) || target in AGENT_CONFIGS;
}

const byName = (a: SkillDefinition, b: SkillDefinition) => a.name.localeCompare(b.name);

export function buildSnapshot(input: SnapshotInput): SkillsSnapshot {
  const warnings = [...input.warnings];
  const disabled = new Set(input.config.disabled);
  const fail = (error: string): SkillsSnapshot => ({ skills: [], pins: {}, warnings, error, lock: input.lock });

  // Central: include filter, duplicate detection across repos
  const centralByName = new Map<string, SkillDefinition>();
  for (const { repo, skills } of input.central) {
    const include = repo.include ? new Set(repo.include) : null;
    if (include) {
      const present = new Set(skills.map((s) => s.name));
      for (const name of include) {
        if (!present.has(name)) warnings.push(`Repo ${repo.url}: included skill "${name}" was not found`);
      }
    }
    for (const s of skills) {
      if (include && !include.has(s.name)) continue;
      if (disabled.has(s.name)) continue;
      const existing = centralByName.get(s.name);
      if (existing) {
        return fail(
          `Skill "${s.name}" is provided by two central repos: ${existing.repoUrl ?? '?'} and ${repo.url}. Use "include" to pick one.`,
        );
      }
      centralByName.set(s.name, s);
    }
  }

  // Local wins on name; shadowed central stays, flagged
  const local = input.local.filter((s) => !disabled.has(s.name)).sort(byName);
  const localNames = new Set(local.map((s) => s.name));
  const central = [...centralByName.values()]
    .map((s) => (localNames.has(s.name) ? { ...s, overriddenBy: 'local' as const } : s))
    .sort(byName);
  const skills = [...local, ...central];
  const effectiveNames = new Set(skills.filter((s) => !s.overriddenBy).map((s) => s.name));

  // Pins validation
  for (const [target, names] of Object.entries(input.config.pins)) {
    if (!isKnownPinTarget(target)) {
      return fail(`Pin target "${target}" is not an agent type or phase group (${PHASE_GROUPS.join(', ')})`);
    }
    for (const name of names) {
      if (disabled.has(name)) return fail(`Pinned skill "${name}" (target "${target}") is listed in "disabled"`);
      if (!effectiveNames.has(name)) return fail(`Pinned skill "${name}" (target "${target}") does not exist`);
    }
  }

  return { skills, pins: input.config.pins, warnings, lock: input.lock };
}

export function effectiveSkills(snapshot: SkillsSnapshot): SkillDefinition[] {
  return snapshot.skills.filter((s) => !s.overriddenBy);
}

export function findSkill(snapshot: SkillsSnapshot, name: string): SkillDefinition | undefined {
  return effectiveSkills(snapshot).find((s) => s.name === name);
}

export function getSkillsForAgent(snapshot: SkillsSnapshot, agentType: string): AgentSkills {
  const group = agentPhaseGroup(agentType);
  const pinnedNames = new Set<string>([
    ...(snapshot.pins[agentType] ?? []),
    ...(group ? snapshot.pins[group] ?? [] : []),
  ]);
  const all = effectiveSkills(snapshot);
  return {
    pinned: all.filter((s) => pinnedNames.has(s.name)),
    catalog: all.filter((s) => !pinnedNames.has(s.name)),
  };
}
