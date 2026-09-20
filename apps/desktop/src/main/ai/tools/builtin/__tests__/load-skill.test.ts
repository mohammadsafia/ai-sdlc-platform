// apps/desktop/src/main/ai/tools/builtin/__tests__/load-skill.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { loadSkillTool } from '../load-skill';
import type { ToolContext } from '../../types';
import type { SkillsSnapshot } from '../../../skills/types';

describe('load_skill tool', () => {
  let root: string;
  let specDir: string;
  let snapshot: SkillsSnapshot;

  const ctx = (over: Partial<ToolContext> = {}): ToolContext =>
    ({
      cwd: root,
      projectDir: root,
      specDir,
      securityProfile: {} as ToolContext['securityProfile'],
      skillsSnapshot: snapshot,
      agentType: 'coder',
      ...over,
    }) as ToolContext;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'load-skill-'));
    specDir = path.join(root, 'spec');
    mkdirSync(specDir);
    const dir = path.join(root, 'skills', 'demo');
    mkdirSync(path.join(dir, 'ref'), { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: demo\ndescription: D\n---\n# Demo body\n');
    writeFileSync(path.join(dir, 'ref', 'notes.md'), 'notes content');
    snapshot = {
      skills: [
        { name: 'demo', description: 'D', source: 'local', dir },
        { name: 'shadow', description: 'S', source: 'central', dir: path.join(root, 'nowhere'), overriddenBy: 'local' },
      ],
      pins: {},
      warnings: [],
      lock: { repos: {} },
    };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('is named load_skill and read-only', () => {
    expect(loadSkillTool.metadata.name).toBe('load_skill');
    expect(loadSkillTool.metadata.permission).toBe('read_only');
  });

  it('returns body and file list without resource', async () => {
    const out = (await loadSkillTool.config.execute({ name: 'demo' }, ctx())) as string;
    expect(out).toContain('# Demo body');
    expect(out).toContain('Bundled files:');
    expect(out).toContain('ref/notes.md');
  });

  it('returns a resource with resource set', async () => {
    const out = (await loadSkillTool.config.execute({ name: 'demo', resource: 'ref/notes.md' }, ctx())) as string;
    expect(out).toBe('notes content');
  });

  it('errors on unknown or overridden names and lists valid names', async () => {
    const out = (await loadSkillTool.config.execute({ name: 'shadow' }, ctx())) as string;
    expect(out).toMatch(/^Error: Unknown skill "shadow"/);
    expect(out).toContain('demo');
  });

  it('errors when the resource escapes the skill folder', async () => {
    const out = (await loadSkillTool.config.execute({ name: 'demo', resource: '../../spec/x' }, ctx())) as string;
    expect(out).toMatch(/^Error: .*outside the skill folder/);
  });

  it('errors when no skills snapshot is present', async () => {
    const out = (await loadSkillTool.config.execute({ name: 'demo' }, ctx({ skillsSnapshot: undefined }))) as string;
    expect(out).toMatch(/^Error: No project skills/);
  });

  it('appends usage records to the spec dir', async () => {
    await loadSkillTool.config.execute({ name: 'demo' }, ctx());
    await loadSkillTool.config.execute({ name: 'demo', resource: 'ref/notes.md' }, ctx());
    const records = JSON.parse(readFileSync(path.join(specDir, 'skills_used.json'), 'utf-8'));
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ name: 'demo', agentType: 'coder', pinned: false });
    expect(records[1]).toMatchObject({ name: 'demo', resource: 'ref/notes.md' });
  });
});
