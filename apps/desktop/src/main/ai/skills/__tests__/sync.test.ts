// apps/desktop/src/main/ai/skills/__tests__/sync.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { ensureCheckout, refreshRepo, repoKey, mirrorDir, checkoutDir, type GitRunner, type SyncDeps } from '../sync';

interface Call { args: string[]; cwd?: string }

function fakeGit(behavior: (args: string[]) => string | Error = () => ''): { git: GitRunner; calls: Call[] } {
  const calls: Call[] = [];
  const git: GitRunner = async (args, options) => {
    calls.push({ args, cwd: options?.cwd });
    const r = behavior(args);
    if (r instanceof Error) throw r;
    return r;
  };
  return { git, calls };
}

describe('sync', () => {
  let baseDir: string;
  const url = 'https://github.com/acme/skills.git';

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'skills-sync-'));
  });
  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('derives stable, filesystem-safe directories from the url', () => {
    const deps: SyncDeps = { git: fakeGit().git, baseDir };
    expect(repoKey(url)).toMatch(/^[a-f0-9]{16}$/);
    expect(repoKey(url)).toBe(repoKey(url));
    expect(mirrorDir(deps, url)).toBe(path.join(baseDir, 'skill-repos', repoKey(url), 'mirror'));
    expect(checkoutDir(deps, url, 'abc')).toBe(path.join(baseDir, 'skill-repos', repoKey(url), 'abc'));
  });

  it('ensureCheckout clones the mirror and adds a detached worktree when nothing exists', async () => {
    const { git, calls } = fakeGit();
    const deps: SyncDeps = { git, baseDir };
    const dir = await ensureCheckout(deps, url, 'abc123');
    expect(dir).toBe(checkoutDir(deps, url, 'abc123'));
    expect(calls.map((c) => c.args)).toEqual([
      ['clone', '--mirror', '--filter=blob:none', url, mirrorDir(deps, url)],
      ['--git-dir', mirrorDir(deps, url), 'cat-file', '-e', 'abc123^{commit}'],
      ['--git-dir', mirrorDir(deps, url), 'worktree', 'add', '--detach', dir, 'abc123'],
    ]);
  });

  it('ensureCheckout fetches when the commit is missing from an existing mirror', async () => {
    const deps: SyncDeps = { git: fakeGit().git, baseDir };
    mkdirSync(mirrorDir(deps, url), { recursive: true });
    const { git, calls } = fakeGit((args) => (args.includes('cat-file') ? new Error('missing') : ''));
    const dir = await ensureCheckout({ git, baseDir }, url, 'abc123');
    expect(calls.map((c) => c.args)).toEqual([
      ['--git-dir', mirrorDir(deps, url), 'cat-file', '-e', 'abc123^{commit}'],
      ['--git-dir', mirrorDir(deps, url), 'fetch', '--prune', 'origin'],
      ['--git-dir', mirrorDir(deps, url), 'worktree', 'add', '--detach', dir, 'abc123'],
    ]);
  });

  it('ensureCheckout is a no-op when the checkout already exists', async () => {
    const deps: SyncDeps = { git: fakeGit().git, baseDir };
    mkdirSync(checkoutDir(deps, url, 'abc123'), { recursive: true });
    const { git, calls } = fakeGit();
    await ensureCheckout({ git, baseDir }, url, 'abc123');
    expect(calls).toEqual([]);
  });

  it('refreshRepo resolves an explicit ref and returns its commit', async () => {
    const { git, calls } = fakeGit((args) => (args.includes('rev-parse') ? 'deadbeef\n' : ''));
    const deps: SyncDeps = { git, baseDir };
    const r = await refreshRepo(deps, { url, ref: 'release', subpath: 'skills' });
    expect(r).toEqual({ ref: 'release', commit: 'deadbeef' });
    expect(calls[0].args).toEqual(['clone', '--mirror', '--filter=blob:none', url, mirrorDir(deps, url)]);
    expect(calls[1].args).toEqual(['--git-dir', mirrorDir(deps, url), 'rev-parse', '--verify', 'release^{commit}']);
    expect(existsSync(path.join(baseDir, 'skill-repos'))).toBe(true);
  });

  it('refreshRepo fetches an existing mirror and uses the default branch when ref is absent', async () => {
    const deps0: SyncDeps = { git: fakeGit().git, baseDir };
    mkdirSync(mirrorDir(deps0, url), { recursive: true });
    const { git, calls } = fakeGit((args) => {
      if (args.includes('symbolic-ref')) return 'refs/heads/main\n';
      if (args.includes('rev-parse')) return 'c0ffee\n';
      return '';
    });
    const r = await refreshRepo({ git, baseDir }, { url, subpath: 'skills' });
    expect(r).toEqual({ ref: 'main', commit: 'c0ffee' });
    expect(calls.map((c) => c.args)).toEqual([
      ['--git-dir', mirrorDir(deps0, url), 'fetch', '--prune', 'origin'],
      ['--git-dir', mirrorDir(deps0, url), 'symbolic-ref', 'HEAD'],
      ['--git-dir', mirrorDir(deps0, url), 'rev-parse', '--verify', 'main^{commit}'],
      ['--git-dir', mirrorDir(deps0, url), 'cat-file', '-e', 'c0ffee^{commit}'],
      ['--git-dir', mirrorDir(deps0, url), 'worktree', 'add', '--detach', checkoutDir(deps0, url, 'c0ffee'), 'c0ffee'],
    ]);
  });

  it('refreshRepo surfaces git failures with the url in the message', async () => {
    const { git } = fakeGit(() => new Error('could not resolve host'));
    await expect(refreshRepo({ git, baseDir }, { url, subpath: 'skills' })).rejects.toThrow(url);
  });
});
