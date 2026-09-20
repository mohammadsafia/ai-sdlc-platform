// apps/desktop/src/main/ai/skills/sync.ts
/**
 * Central skill repos: one bare mirror per URL, one immutable checkout per commit.
 * Main process only. Git is run with argument arrays, never a shell string.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { findExecutable } from '../../platform';
import { GIT_TIMEOUT_MS, type CentralRepoConfig } from './types';

const execFileAsync = promisify(execFile);

export type GitRunner = (args: string[], options?: { cwd?: string }) => Promise<string>;

export interface SyncDeps {
  git: GitRunner;
  /** Usually app.getPath('userData') */
  baseDir: string;
}

export function createGitRunner(): GitRunner {
  const gitBin = findExecutable('git') ?? 'git';
  return async (args, options) => {
    const { stdout } = await execFileAsync(gitBin, args, {
      cwd: options?.cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
  };
}

export function repoKey(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

function repoRoot(deps: SyncDeps, url: string): string {
  return path.join(deps.baseDir, 'skill-repos', repoKey(url));
}

export function mirrorDir(deps: SyncDeps, url: string): string {
  return path.join(repoRoot(deps, url), 'mirror');
}

export function checkoutDir(deps: SyncDeps, url: string, commit: string): string {
  return path.join(repoRoot(deps, url), commit);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

function wrap(url: string, action: string, err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(`Skill repo ${url}: ${action} failed: ${message}`);
}

async function ensureMirror(deps: SyncDeps, url: string): Promise<{ mirror: string; created: boolean }> {
  const mirror = mirrorDir(deps, url);
  if (await exists(mirror)) return { mirror, created: false };
  await fs.mkdir(path.dirname(mirror), { recursive: true });
  try {
    // Blobless partial clone: refs + trees only. Blobs are fetched lazily when a
    // commit is checked out, which keeps large public skill collections fast.
    await deps.git(['clone', '--mirror', '--filter=blob:none', url, mirror]);
  } catch (err) {
    throw wrap(url, 'clone', err);
  }
  return { mirror, created: true };
}

async function hasCommit(deps: SyncDeps, mirror: string, commit: string): Promise<boolean> {
  try {
    await deps.git(['--git-dir', mirror, 'cat-file', '-e', `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** Make sure `<root>/<commit>` exists. Returns the checkout path. Never modifies an existing checkout. */
export async function ensureCheckout(deps: SyncDeps, url: string, commit: string): Promise<string> {
  const target = checkoutDir(deps, url, commit);
  if (await exists(target)) return target;

  const { mirror } = await ensureMirror(deps, url);
  if (!(await hasCommit(deps, mirror, commit))) {
    try {
      await deps.git(['--git-dir', mirror, 'fetch', '--prune', 'origin']);
    } catch (err) {
      throw wrap(url, 'fetch', err);
    }
  }
  try {
    await deps.git(['--git-dir', mirror, 'worktree', 'add', '--detach', target, commit]);
  } catch (err) {
    throw wrap(url, `checkout of ${commit}`, err);
  }
  return target;
}

/** Fetch, resolve `repo.ref` (or the default branch) to a commit, and ensure its checkout. */
export async function refreshRepo(deps: SyncDeps, repo: CentralRepoConfig): Promise<{ ref: string; commit: string }> {
  const { mirror, created } = await ensureMirror(deps, repo.url);
  if (!created) {
    try {
      await deps.git(['--git-dir', mirror, 'fetch', '--prune', 'origin']);
    } catch (err) {
      throw wrap(repo.url, 'fetch', err);
    }
  }

  let ref = repo.ref;
  if (!ref) {
    try {
      const head = (await deps.git(['--git-dir', mirror, 'symbolic-ref', 'HEAD'])).trim();
      ref = head.replace(/^refs\/heads\//, '');
    } catch (err) {
      throw wrap(repo.url, 'default branch lookup', err);
    }
  }

  let commit: string;
  try {
    commit = (await deps.git(['--git-dir', mirror, 'rev-parse', '--verify', `${ref}^{commit}`])).trim();
  } catch (err) {
    throw wrap(repo.url, `resolving ref "${ref}"`, err);
  }

  await ensureCheckout(deps, repo.url, commit);
  return { ref, commit };
}
