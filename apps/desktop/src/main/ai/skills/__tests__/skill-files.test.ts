// apps/desktop/src/main/ai/skills/__tests__/skill-files.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  readSkillBody,
  listSkillFiles,
  readSkillResource,
  appendSkillUsage,
  readSkillUsage,
} from '../skill-files';

describe('skill-files', () => {
  let root: string;
  let skillDir: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'skill-files-'));
    skillDir = path.join(root, 'demo');
    mkdirSync(path.join(skillDir, 'references'), { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: demo\ndescription: D\n---\n# Demo\nBody text\n');
    writeFileSync(path.join(skillDir, 'references', 'guide.md'), 'guide');
    writeFileSync(path.join(skillDir, 'script.sh'), 'echo hi');
    writeFileSync(path.join(root, 'outside.txt'), 'secret');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('readSkillBody strips frontmatter', async () => {
    expect(await readSkillBody(skillDir)).toBe('# Demo\nBody text\n');
  });

  it('listSkillFiles lists bundled files as posix relative paths, excluding SKILL.md', async () => {
    expect(await listSkillFiles(skillDir)).toEqual(['references/guide.md', 'script.sh']);
  });

  it('listSkillFiles skips .git folders', async () => {
    mkdirSync(path.join(skillDir, '.git'));
    writeFileSync(path.join(skillDir, '.git', 'HEAD'), 'ref');
    expect(await listSkillFiles(skillDir)).toEqual(['references/guide.md', 'script.sh']);
  });

  it('readSkillResource reads a bundled file', async () => {
    expect(await readSkillResource(skillDir, 'references/guide.md')).toBe('guide');
  });

  it('readSkillResource rejects ../ escapes', async () => {
    await expect(readSkillResource(skillDir, '../outside.txt')).rejects.toThrow(/outside the skill folder/);
  });

  it('readSkillResource rejects absolute paths', async () => {
    await expect(readSkillResource(skillDir, path.join(root, 'outside.txt'))).rejects.toThrow(/outside the skill folder/);
  });

  it('readSkillResource rejects symlink escapes', async () => {
    symlinkSync(path.join(root, 'outside.txt'), path.join(skillDir, 'link.txt'));
    await expect(readSkillResource(skillDir, 'link.txt')).rejects.toThrow(/outside the skill folder/);
  });

  it('readSkillResource rejects missing files and oversized files', async () => {
    await expect(readSkillResource(skillDir, 'nope.md')).rejects.toThrow(/not found/);
    writeFileSync(path.join(skillDir, 'big.txt'), Buffer.alloc(512 * 1024 + 1, 97));
    await expect(readSkillResource(skillDir, 'big.txt')).rejects.toThrow(/too large/);
  });

  it('appendSkillUsage creates and appends to skills_used.json', async () => {
    const specDir = path.join(root, 'spec');
    mkdirSync(specDir);
    await appendSkillUsage(specDir, { name: 'demo', agentType: 'coder', pinned: true, at: 't1' });
    await appendSkillUsage(specDir, { name: 'demo', resource: 'script.sh', agentType: 'coder', pinned: false, at: 't2' });
    expect(await readSkillUsage(specDir)).toEqual([
      { name: 'demo', agentType: 'coder', pinned: true, at: 't1' },
      { name: 'demo', resource: 'script.sh', agentType: 'coder', pinned: false, at: 't2' },
    ]);
  });

  it('appendSkillUsage is a no-op when the spec dir does not exist', async () => {
    await expect(appendSkillUsage(path.join(root, 'missing'), { name: 'x', agentType: 'coder', pinned: false, at: 't' })).resolves.toBeUndefined();
  });
});
