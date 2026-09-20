// apps/desktop/src/main/ai/agent/__tests__/worker-skills.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { buildSkillsSectionForAgent, resolveEffectiveAgentType } from '../skills-prompt';
import type { SkillsSnapshot } from '../../skills/types';

describe('resolveEffectiveAgentType', () => {
  it('prefers the explicit agent type, then a prompt name that is an agent type, then the session type', () => {
    expect(resolveEffectiveAgentType('coder', 'build_orchestrator', 'qa_fixer')).toBe('qa_fixer');
    expect(resolveEffectiveAgentType('coder', 'build_orchestrator')).toBe('coder');
    expect(resolveEffectiveAgentType('spec_orchestrator_agentic', 'spec_orchestrator')).toBe('spec_orchestrator');
  });
});

describe('buildSkillsSectionForAgent', () => {
  let root: string;
  let specDir: string;
  let snapshot: SkillsSnapshot;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'worker-skills-'));
    specDir = path.join(root, 'spec');
    mkdirSync(specDir);
    const dir = path.join(root, 'std');
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: std\ndescription: S\n---\nSTD BODY\n');
    snapshot = { skills: [{ name: 'std', description: 'S', source: 'local', dir }], pins: { coder: ['std'] }, warnings: [], lock: { repos: {} } };
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty string when there is no snapshot', async () => {
    expect(await buildSkillsSectionForAgent(undefined, 'coder', specDir)).toBe('');
  });

  it('builds the section and records pinned usage', async () => {
    const section = await buildSkillsSectionForAgent(snapshot, 'coder', specDir);
    expect(section).toContain('STD BODY');
    const records = JSON.parse(readFileSync(path.join(specDir, 'skills_used.json'), 'utf-8'));
    expect(records).toEqual([expect.objectContaining({ name: 'std', agentType: 'coder', pinned: true })]);
  });

  it('throws on a budget error', async () => {
    writeFileSync(path.join(root, 'std', 'SKILL.md'), `---\nname: std\ndescription: S\n---\n${'x'.repeat(41_000)}`);
    await expect(buildSkillsSectionForAgent(snapshot, 'coder', specDir)).rejects.toThrow(/40000/);
  });
});
