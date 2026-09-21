// apps/desktop/src/main/brd/brd-git.ts
import { execFileSync } from 'node:child_process';

import type { BrdChangedFile, BrdChanges, BrdCommitResult, BrdFileStatus } from '../../shared/types/brd';
import { type PushAuth, pushBranch } from '../ai/runners/pr-common';
import { getToolPath } from '../cli-tool-manager';
import { getIsolatedGitEnv } from '../utils/git-isolation';

const BRD_PATHSPECS = ['docs/brd', 'docs/design'];

function git(gitPath: string, cwd: string, args: string[]): string {
  return execFileSync(gitPath, args, { cwd, env: getIsolatedGitEnv(), encoding: 'utf-8', stdio: 'pipe' });
}

function assertRepo(gitPath: string, cwd: string): void {
  try {
    git(gitPath, cwd, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    throw new Error('Not a git repository');
  }
}

function statusOf(code: string): BrdFileStatus {
  if (code === '??') return 'untracked';
  if (code.includes('D')) return 'deleted';
  if (code.includes('A')) return 'added';
  return 'modified';
}

/** Parse `git status --porcelain` output into changed files (renames report the new path). */
export function parsePorcelain(output: string): BrdChangedFile[] {
  const files: BrdChangedFile[] = [];
  for (const line of output.split('\n')) {
    if (line.length < 4) continue;
    const code = line.slice(0, 2);
    let path = line.slice(3).trim();
    const arrow = path.indexOf(' -> ');
    if (arrow >= 0) path = path.slice(arrow + 4);
    files.push({ path, status: statusOf(code) });
  }
  return files;
}

/** Current branch and the changed files under docs/brd. */
export function brdChanges(projectDir: string, gitPath: string = getToolPath('git')): BrdChanges {
  assertRepo(gitPath, projectDir);
  const branch = git(gitPath, projectDir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const files = parsePorcelain(git(gitPath, projectDir, ['status', '--porcelain', '--untracked-files=all', '--', ...BRD_PATHSPECS]));
  return { branch, files };
}

/** Stage and commit docs/brd only, then optionally push the current branch. A failed push is returned as a warning. */
export async function commitBrd(
  projectDir: string,
  message: string,
  push: boolean,
  auth?: PushAuth,
  gitPath: string = getToolPath('git'),
): Promise<BrdCommitResult> {
  const trimmed = message.trim();
  if (!trimmed) throw new Error('Commit message is required');
  assertRepo(gitPath, projectDir);
  const branch = git(gitPath, projectDir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  git(gitPath, projectDir, ['add', '-A', '--', ...BRD_PATHSPECS]);
  git(gitPath, projectDir, ['commit', '-m', trimmed, '--', ...BRD_PATHSPECS]);
  const commit = git(gitPath, projectDir, ['rev-parse', '--short', 'HEAD']).trim();
  if (!push) return { commit, pushed: false };
  const pushError = pushBranch(projectDir, gitPath, branch, auth);
  return pushError ? { commit, pushed: false, pushError } : { commit, pushed: true };
}
