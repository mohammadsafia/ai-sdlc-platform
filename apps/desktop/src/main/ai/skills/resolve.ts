// apps/desktop/src/main/ai/skills/resolve.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { DEFAULT_ALLOWED_SCHEMES, loadSkillsConfig, loadSkillsLock, writeSkillsLock } from './config';
import { discoverSkills } from './discovery';
import { buildSnapshot } from './resolver';
import { createGitRunner, ensureCheckout, refreshRepo, type GitRunner, type SyncDeps } from './sync';
import {
  SKILLS_DIR,
  SKILLS_LOCK_FILE,
  emptySnapshot,
  type CentralRepoConfig,
  type SkillDefinition,
  type SkillsLock,
  type SkillsSnapshot,
} from './types';

export interface ResolveOptions {
  userDataDir: string;
  git?: GitRunner;
  allowedSchemes?: readonly string[];
}

function errorSnapshot(error: string, lock: SkillsLock = { repos: {} }): SkillsSnapshot {
  return { ...emptySnapshot(), error, lock };
}

/** Resolve `<checkout>/<subpath>` and make sure it stays inside the checkout. */
async function skillsRootInCheckout(checkout: string, repo: CentralRepoConfig): Promise<string> {
  const realCheckout = await fs.realpath(checkout);
  const candidate = path.resolve(realCheckout, repo.subpath);
  const boundary = realCheckout.endsWith(path.sep) ? realCheckout : realCheckout + path.sep;
  if (candidate !== realCheckout && !candidate.startsWith(boundary)) {
    throw new Error(`Skill repo ${repo.url}: subpath "${repo.subpath}" escapes the repository`);
  }
  return candidate;
}

async function resolveWithLock(
  projectDir: string,
  lock: SkillsLock,
  options: ResolveOptions,
): Promise<SkillsSnapshot> {
  const configResult = await loadSkillsConfig(projectDir, options.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES);
  if (!configResult.ok) return errorSnapshot(configResult.error, lock);
  const { config } = configResult;

  const deps: SyncDeps = { git: options.git ?? createGitRunner(), baseDir: options.userDataDir };
  const warnings: string[] = [];

  const local = await discoverSkills(path.join(projectDir, SKILLS_DIR), 'local');
  warnings.push(...local.warnings);

  const central: Array<{ repo: CentralRepoConfig; skills: SkillDefinition[] }> = [];
  for (const repo of config.centralRepos) {
    const entry = lock.repos[repo.url];
    if (!entry) {
      return errorSnapshot(
        `No lock entry for skill repo ${repo.url}. Open Project Settings > Skills and click Refresh, then commit ${SKILLS_LOCK_FILE}.`,
        lock,
      );
    }
    let checkout: string;
    try {
      checkout = await ensureCheckout(deps, repo.url, entry.commit);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorSnapshot(`${message}. If you are offline, reconnect and retry.`, lock);
    }
    let root: string;
    try {
      root = await skillsRootInCheckout(checkout, repo);
    } catch (err) {
      return errorSnapshot(err instanceof Error ? err.message : String(err), lock);
    }
    const found = await discoverSkills(root, 'central', { repoUrl: repo.url, commit: entry.commit }, { only: repo.include });
    warnings.push(...found.warnings.map((w) => `${repo.url}: ${w}`));
    central.push({ repo, skills: found.skills });
  }

  return buildSnapshot({ local: local.skills, central, config, lock, warnings });
}

/** Resolve using the committed lockfile. Never writes files. */
export async function resolveSkills(projectDir: string, options: ResolveOptions): Promise<SkillsSnapshot> {
  const lock = await loadSkillsLock(projectDir);
  return resolveWithLock(projectDir, lock, options);
}

/** Fetch every central repo, rewrite the lockfile, then resolve. */
export async function refreshSkills(projectDir: string, options: ResolveOptions): Promise<SkillsSnapshot> {
  const configResult = await loadSkillsConfig(projectDir, options.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES);
  if (!configResult.ok) return errorSnapshot(configResult.error);
  const { config } = configResult;

  const deps: SyncDeps = { git: options.git ?? createGitRunner(), baseDir: options.userDataDir };
  const previous = await loadSkillsLock(projectDir);
  const lock: SkillsLock = { repos: {} };

  for (const repo of config.centralRepos) {
    try {
      const { ref, commit } = await refreshRepo(deps, repo);
      lock.repos[repo.url] = { ref, commit, resolvedAt: new Date().toISOString() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorSnapshot(`${message}. The previous lockfile was left unchanged.`, previous);
    }
  }

  if (config.centralRepos.length > 0 || Object.keys(previous.repos).length > 0) {
    await writeSkillsLock(projectDir, lock);
  }
  return resolveWithLock(projectDir, lock, options);
}
