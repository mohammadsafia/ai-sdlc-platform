// apps/desktop/src/main/ai/skills/__tests__/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  loadSkillsConfig,
  loadSkillsLock,
  writeSkillsLock,
  isAllowedRepoUrl,
} from '../config';

describe('skills config', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(path.join(tmpdir(), 'skills-config-'));
    mkdirSync(path.join(projectDir, '.claude'), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('returns empty config when file is missing', async () => {
    const result = await loadSkillsConfig(projectDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.exists).toBe(false);
    expect(result.config).toEqual({ centralRepos: [], pins: {}, disabled: [] });
  });

  it('parses a valid config and applies subpath default', async () => {
    writeFileSync(
      path.join(projectDir, '.claude', 'skills.json'),
      JSON.stringify({
        centralRepos: [{ url: 'https://github.com/acme/skills.git', include: ['a'] }],
        pins: { coder: ['a'] },
      }),
    );
    const result = await loadSkillsConfig(projectDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.exists).toBe(true);
    expect(result.config.centralRepos[0]).toEqual({
      url: 'https://github.com/acme/skills.git',
      subpath: 'skills',
      include: ['a'],
    });
    expect(result.config.pins).toEqual({ coder: ['a'] });
    expect(result.config.disabled).toEqual([]);
  });

  it('reports malformed JSON as an error', async () => {
    writeFileSync(path.join(projectDir, '.claude', 'skills.json'), '{ not json');
    const result = await loadSkillsConfig(projectDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('skills.json');
  });

  it('reports unknown fields and bad shapes as an error', async () => {
    writeFileSync(
      path.join(projectDir, '.claude', 'skills.json'),
      JSON.stringify({ centralRepos: 'nope', extra: 1 }),
    );
    const result = await loadSkillsConfig(projectDir);
    expect(result.ok).toBe(false);
  });

  it('rejects disallowed URL schemes', async () => {
    writeFileSync(
      path.join(projectDir, '.claude', 'skills.json'),
      JSON.stringify({ centralRepos: [{ url: 'file:///tmp/x' }] }),
    );
    const result = await loadSkillsConfig(projectDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('file:///tmp/x');
  });

  it('accepts https, ssh and scp-style urls', () => {
    expect(isAllowedRepoUrl('https://github.com/a/b.git')).toBe(true);
    expect(isAllowedRepoUrl('ssh://git@bitbucket.org/a/b.git')).toBe(true);
    expect(isAllowedRepoUrl('git@bitbucket.org:a/b.git')).toBe(true);
    expect(isAllowedRepoUrl('http://github.com/a/b.git')).toBe(false);
    expect(isAllowedRepoUrl('file:///tmp/x')).toBe(false);
    expect(isAllowedRepoUrl('/tmp/x')).toBe(false);
    expect(isAllowedRepoUrl('file:///tmp/x', ['file:'])).toBe(true);
  });

  it('loads an empty lock when missing and round-trips a written lock', async () => {
    expect(await loadSkillsLock(projectDir)).toEqual({ repos: {} });
    const lock = {
      repos: { 'https://x/y.git': { ref: 'main', commit: 'abc', resolvedAt: '2026-09-20T00:00:00.000Z' } },
    };
    await writeSkillsLock(projectDir, lock);
    expect(existsSync(path.join(projectDir, '.claude', 'skills.lock.json'))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(projectDir, '.claude', 'skills.lock.json'), 'utf-8'))).toEqual(lock);
    expect(await loadSkillsLock(projectDir)).toEqual(lock);
  });

  it('treats a malformed lock as empty', async () => {
    writeFileSync(path.join(projectDir, '.claude', 'skills.lock.json'), 'garbage');
    expect(await loadSkillsLock(projectDir)).toEqual({ repos: {} });
  });
});
