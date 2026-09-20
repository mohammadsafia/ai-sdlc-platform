// apps/desktop/src/main/ai/skills/__tests__/resolver.test.ts
import { describe, it, expect } from 'vitest';
import { agentPhaseGroup, buildSnapshot, getSkillsForAgent, effectiveSkills, findSkill } from '../resolver';
import type { SkillDefinition, SkillsConfig, SkillsLock } from '../types';

const lock: SkillsLock = { repos: {} };
const cfg = (over: Partial<SkillsConfig> = {}): SkillsConfig => ({ centralRepos: [], pins: {}, disabled: [], ...over });
const skill = (name: string, source: 'local' | 'central', repoUrl?: string): SkillDefinition => ({
  name,
  description: `${name} desc`,
  source,
  dir: `/skills/${source}/${name}`,
  ...(repoUrl ? { repoUrl } : {}),
});
const repo = (url: string, include?: string[]) => ({ url, subpath: 'skills', ...(include ? { include } : {}) });

describe('agentPhaseGroup', () => {
  it('maps pipeline agents to phase groups', () => {
    expect(agentPhaseGroup('spec_writer')).toBe('spec');
    expect(agentPhaseGroup('spec_gatherer')).toBe('spec');
    expect(agentPhaseGroup('planner')).toBe('planning');
    expect(agentPhaseGroup('coder')).toBe('coding');
    expect(agentPhaseGroup('qa_reviewer')).toBe('qa');
    expect(agentPhaseGroup('qa_fixer')).toBe('qa');
    expect(agentPhaseGroup('insights')).toBeNull();
    expect(agentPhaseGroup('pr_reviewer')).toBeNull();
  });
});

describe('buildSnapshot', () => {
  it('orders local first then central, both by name', () => {
    const snap = buildSnapshot({
      local: [skill('b', 'local'), skill('a', 'local')],
      central: [{ repo: repo('u1'), skills: [skill('z', 'central', 'u1'), skill('c', 'central', 'u1')] }],
      config: cfg(),
      lock,
      warnings: [],
    });
    expect(snap.error).toBeUndefined();
    expect(snap.skills.map((s) => s.name)).toEqual(['a', 'b', 'c', 'z']);
  });

  it('local overrides central with the same name and keeps the shadowed entry flagged', () => {
    const snap = buildSnapshot({
      local: [skill('x', 'local')],
      central: [{ repo: repo('u1'), skills: [skill('x', 'central', 'u1')] }],
      config: cfg(),
      lock,
      warnings: [],
    });
    expect(snap.skills).toHaveLength(2);
    expect(snap.skills[0]).toMatchObject({ name: 'x', source: 'local' });
    expect(snap.skills[1]).toMatchObject({ name: 'x', source: 'central', overriddenBy: 'local' });
    expect(effectiveSkills(snap).map((s) => s.source)).toEqual(['local']);
    expect(findSkill(snap, 'x')?.source).toBe('local');
  });

  it('applies include filters per repo', () => {
    const snap = buildSnapshot({
      local: [],
      central: [{ repo: repo('u1', ['keep']), skills: [skill('keep', 'central', 'u1'), skill('drop', 'central', 'u1')] }],
      config: cfg(),
      lock,
      warnings: [],
    });
    expect(snap.skills.map((s) => s.name)).toEqual(['keep']);
  });

  it('warns when an include name does not exist in the repo', () => {
    const snap = buildSnapshot({
      local: [],
      central: [{ repo: repo('u1', ['ghost']), skills: [] }],
      config: cfg(),
      lock,
      warnings: [],
    });
    expect(snap.warnings[0]).toContain('ghost');
  });

  it('drops disabled skills from both sources', () => {
    const snap = buildSnapshot({
      local: [skill('a', 'local')],
      central: [{ repo: repo('u1'), skills: [skill('b', 'central', 'u1')] }],
      config: cfg({ disabled: ['a', 'b'] }),
      lock,
      warnings: [],
    });
    expect(snap.skills).toEqual([]);
  });

  it('errors when two central repos export the same name', () => {
    const snap = buildSnapshot({
      local: [],
      central: [
        { repo: repo('u1'), skills: [skill('dup', 'central', 'u1')] },
        { repo: repo('u2'), skills: [skill('dup', 'central', 'u2')] },
      ],
      config: cfg(),
      lock,
      warnings: [],
    });
    expect(snap.error).toContain('dup');
    expect(snap.error).toContain('u1');
    expect(snap.error).toContain('u2');
  });

  it('errors on unknown pin targets and unknown pinned skill names', () => {
    const base = { local: [skill('a', 'local')], central: [], lock, warnings: [] };
    expect(buildSnapshot({ ...base, config: cfg({ pins: { nobody: ['a'] } }) }).error).toContain('nobody');
    expect(buildSnapshot({ ...base, config: cfg({ pins: { coder: ['ghost'] } }) }).error).toContain('ghost');
    expect(buildSnapshot({ ...base, config: cfg({ pins: { coder: ['a'], qa: ['a'] } }) }).error).toBeUndefined();
  });

  it('errors when a pinned skill is disabled', () => {
    const snap = buildSnapshot({
      local: [skill('a', 'local')],
      central: [],
      config: cfg({ pins: { coder: ['a'] }, disabled: ['a'] }),
      lock,
      warnings: [],
    });
    expect(snap.error).toContain('a');
  });

  it('passes through warnings and lock', () => {
    const l: SkillsLock = { repos: { u1: { ref: 'main', commit: 'c', resolvedAt: 't' } } };
    const snap = buildSnapshot({ local: [], central: [], config: cfg(), lock: l, warnings: ['w'] });
    expect(snap.warnings).toEqual(['w']);
    expect(snap.lock).toBe(l);
  });
});

describe('getSkillsForAgent', () => {
  const snap = buildSnapshot({
    local: [skill('std', 'local'), skill('fe', 'local'), skill('tests', 'local'), skill('extra', 'local')],
    central: [],
    config: cfg({ pins: { coding: ['std'], coder: ['fe'], qa: ['tests'] } }),
    lock,
    warnings: [],
  });

  it('unions agent-type pins and phase-group pins, rest goes to catalog', () => {
    const r = getSkillsForAgent(snap, 'coder');
    expect(r.pinned.map((s) => s.name)).toEqual(['fe', 'std']);
    expect(r.catalog.map((s) => s.name)).toEqual(['extra', 'tests']);
  });

  it('agents outside the pipeline only get exact-type pins', () => {
    const r = getSkillsForAgent(snap, 'insights');
    expect(r.pinned).toEqual([]);
    expect(r.catalog).toHaveLength(4);
  });

  it('never returns overridden entries', () => {
    const s2 = buildSnapshot({
      local: [skill('x', 'local')],
      central: [{ repo: repo('u1'), skills: [skill('x', 'central', 'u1')] }],
      config: cfg({ pins: { coder: ['x'] } }),
      lock,
      warnings: [],
    });
    const r = getSkillsForAgent(s2, 'coder');
    expect(r.pinned).toHaveLength(1);
    expect(r.pinned[0].source).toBe('local');
    expect(r.catalog).toEqual([]);
  });
});
