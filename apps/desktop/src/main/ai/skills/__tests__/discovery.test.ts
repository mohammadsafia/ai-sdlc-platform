// apps/desktop/src/main/ai/skills/__tests__/discovery.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { discoverSkills } from '../discovery';

function writeSkill(root: string, folder: string, frontmatter: string, body = '# Skill\n') {
  const dir = path.join(root, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}`);
  return dir;
}

describe('discoverSkills', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'skills-disc-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty result for a missing directory', async () => {
    const r = await discoverSkills(path.join(root, 'nope'), 'local');
    expect(r).toEqual({ skills: [], warnings: [] });
  });

  it('discovers valid skills sorted by name with resolved dir', async () => {
    writeSkill(root, 'zeta', 'name: zeta\ndescription: Z');
    writeSkill(root, 'alpha', 'name: alpha\ndescription: A');
    const r = await discoverSkills(root, 'local');
    expect(r.warnings).toEqual([]);
    expect(r.skills.map((s) => s.name)).toEqual(['alpha', 'zeta']);
    expect(r.skills[0]).toEqual({
      name: 'alpha',
      description: 'A',
      source: 'local',
      dir: realpathSync(path.join(root, 'alpha')),
    });
  });

  it('attaches repoUrl and commit for central skills', async () => {
    writeSkill(root, 'a', 'name: a\ndescription: A');
    const r = await discoverSkills(root, 'central', { repoUrl: 'https://x/y.git', commit: 'abc' });
    expect(r.skills[0].repoUrl).toBe('https://x/y.git');
    expect(r.skills[0].commit).toBe('abc');
    expect(r.skills[0].source).toBe('central');
  });

  it('skips folders without SKILL.md, without frontmatter, or with name mismatch', async () => {
    mkdirSync(path.join(root, 'empty'));
    mkdirSync(path.join(root, 'nofm'));
    writeFileSync(path.join(root, 'nofm', 'SKILL.md'), '# no frontmatter');
    writeSkill(root, 'folder', 'name: other\ndescription: D');
    writeSkill(root, 'missing-desc', 'name: missing-desc');
    writeFileSync(path.join(root, 'stray.md'), 'x');
    const r = await discoverSkills(root, 'local');
    expect(r.skills).toEqual([]);
    expect(r.warnings).toHaveLength(3);
    expect(r.warnings.join('\n')).toContain('nofm');
    expect(r.warnings.join('\n')).toContain('folder');
    expect(r.warnings.join('\n')).toContain('missing-desc');
  });

  it('rejects names that are not kebab-case', async () => {
    writeSkill(root, 'Bad_Name', 'name: Bad_Name\ndescription: D');
    const r = await discoverSkills(root, 'local');
    expect(r.skills).toEqual([]);
    expect(r.warnings[0]).toContain('Bad_Name');
  });

  it('caps long descriptions at 200 characters with a warning', async () => {
    writeSkill(root, 'long', `name: long\ndescription: ${'x'.repeat(250)}`);
    const r = await discoverSkills(root, 'local');
    expect(r.skills[0].description).toHaveLength(200);
    expect(r.warnings[0]).toContain('long');
  });

  it('follows a symlinked skill folder and records the real path', async () => {
    const real = writeSkill(root, 'real-target', 'name: linked\ndescription: L');
    symlinkSync(real, path.join(root, 'linked'), 'dir');
    const r = await discoverSkills(root, 'local');
    const linked = r.skills.find((s) => s.name === 'linked');
    expect(linked?.dir).toBe(realpathSync(real));
  });
});
