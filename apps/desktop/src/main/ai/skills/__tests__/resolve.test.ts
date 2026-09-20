// apps/desktop/src/main/ai/skills/__tests__/resolve.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { resolveSkills, refreshSkills } from '../resolve';
import { createGitRunner } from '../sync';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
}

function writeSkill(root: string, folder: string, description: string) {
  mkdirSync(path.join(root, folder), { recursive: true });
  writeFileSync(path.join(root, folder, 'SKILL.md'), `---\nname: ${folder}\ndescription: ${description}\n---\n# ${folder}\n`);
}

describe('resolveSkills / refreshSkills', () => {
  let tmp: string;
  let projectDir: string;
  let userDataDir: string;
  let remoteUrl: string;
  const opts = () => ({ userDataDir, git: createGitRunner(), allowedSchemes: ['file:'] as const });

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'skills-resolve-'));
    projectDir = path.join(tmp, 'project');
    userDataDir = path.join(tmp, 'userData');
    mkdirSync(path.join(projectDir, '.claude', 'skills'), { recursive: true });
    mkdirSync(userDataDir);

    // central repo: work tree → bare remote
    const work = path.join(tmp, 'central-work');
    mkdirSync(work);
    git(['init', '-q', '-b', 'main'], work);
    writeSkill(path.join(work, 'skills'), 'central-one', 'From central');
    writeSkill(path.join(work, 'skills'), 'shared', 'Central version');
    git(['add', '.'], work);
    git(['commit', '-q', '-m', 'init'], work);
    const bare = path.join(tmp, 'central.git');
    git(['clone', '-q', '--bare', work, bare], tmp);
    remoteUrl = `file://${bare}`;

    writeSkill(path.join(projectDir, '.claude', 'skills'), 'local-one', 'Local');
    writeSkill(path.join(projectDir, '.claude', 'skills'), 'shared', 'Local version');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('with no config resolves local skills only', async () => {
    const snap = await resolveSkills(projectDir, opts());
    expect(snap.error).toBeUndefined();
    expect(snap.skills.map((s) => s.name)).toEqual(['local-one', 'shared']);
  });

  it('returns a blocking error for malformed config', async () => {
    writeFileSync(path.join(projectDir, '.claude', 'skills.json'), '{');
    const snap = await resolveSkills(projectDir, opts());
    expect(snap.error).toContain('skills.json');
    expect(snap.skills).toEqual([]);
  });

  it('errors when a central repo has no lock entry and tells the user to refresh', async () => {
    writeFileSync(path.join(projectDir, '.claude', 'skills.json'), JSON.stringify({ centralRepos: [{ url: remoteUrl }] }));
    const snap = await resolveSkills(projectDir, opts());
    expect(snap.error).toContain('Refresh');
    expect(snap.error).toContain('skills.lock.json');
  });

  it('refreshSkills writes the lock and resolves central skills with local override', async () => {
    writeFileSync(
      path.join(projectDir, '.claude', 'skills.json'),
      JSON.stringify({ centralRepos: [{ url: remoteUrl }], pins: { coder: ['central-one'] } }),
    );
    const snap = await refreshSkills(projectDir, opts());
    expect(snap.error).toBeUndefined();

    const lock = JSON.parse(readFileSync(path.join(projectDir, '.claude', 'skills.lock.json'), 'utf-8'));
    expect(lock.repos[remoteUrl].ref).toBe('main');
    expect(lock.repos[remoteUrl].commit).toMatch(/^[0-9a-f]{40}$/);

    expect(snap.skills.map((s) => [s.name, s.source, s.overriddenBy ?? null])).toEqual([
      ['local-one', 'local', null],
      ['shared', 'local', null],
      ['central-one', 'central', null],
      ['shared', 'central', 'local'],
    ]);
    const central = snap.skills.find((s) => s.name === 'central-one');
    expect(central?.commit).toBe(lock.repos[remoteUrl].commit);
    expect(central?.dir).toContain(path.join('skill-repos'));
    expect(snap.pins).toEqual({ coder: ['central-one'] });

    // A second plain resolve uses the lock and the existing checkout
    const again = await resolveSkills(projectDir, opts());
    expect(again.error).toBeUndefined();
    expect(again.skills).toHaveLength(4);
  });

  it('rejects a subpath that escapes the checkout', async () => {
    writeFileSync(path.join(projectDir, '.claude', 'skills.json'), JSON.stringify({ centralRepos: [{ url: remoteUrl, subpath: '../..' }] }));
    const snap = await refreshSkills(projectDir, opts());
    expect(snap.error).toContain('subpath');
  });

  it('supports subpath "." for repos with skills at the root', async () => {
    const work = path.join(tmp, 'root-work');
    mkdirSync(work);
    git(['init', '-q', '-b', 'main'], work);
    writeSkill(work, 'root-skill', 'At root');
    git(['add', '.'], work);
    git(['commit', '-q', '-m', 'init'], work);
    const bare = path.join(tmp, 'root.git');
    git(['clone', '-q', '--bare', work, bare], tmp);
    writeFileSync(path.join(projectDir, '.claude', 'skills.json'), JSON.stringify({ centralRepos: [{ url: `file://${bare}`, subpath: '.' }] }));
    const snap = await refreshSkills(projectDir, opts());
    expect(snap.error).toBeUndefined();
    expect(snap.skills.map((s) => s.name)).toContain('root-skill');
  });
});
