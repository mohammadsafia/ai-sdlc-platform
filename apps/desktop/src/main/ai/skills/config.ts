// apps/desktop/src/main/ai/skills/config.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod/v3';

import {
  SKILLS_CONFIG_FILE,
  SKILLS_LOCK_FILE,
  type SkillsConfig,
  type SkillsLock,
} from './types';

export const DEFAULT_ALLOWED_SCHEMES = ['https:', 'ssh:'] as const;

const SCP_STYLE_URL = /^[\w.-]+@[\w.-]+:[\w./~-]+$/;

/**
 * Accepts https://, ssh://, and scp-style git@host:path URLs.
 * `allowedSchemes` overrides the scheme list (tests pass ['file:']).
 */
export function isAllowedRepoUrl(
  url: string,
  allowedSchemes: readonly string[] = DEFAULT_ALLOWED_SCHEMES,
): boolean {
  if (SCP_STYLE_URL.test(url) && allowedSchemes.includes('ssh:')) return true;
  try {
    const parsed = new URL(url);
    return allowedSchemes.includes(parsed.protocol);
  } catch {
    return false;
  }
}

const centralRepoSchema = z
  .object({
    url: z.string().min(1),
    ref: z.string().min(1).optional(),
    subpath: z.string().min(1).default('skills'),
    include: z.array(z.string().min(1)).optional(),
  })
  .strict();

const skillsConfigSchema = z
  .object({
    centralRepos: z.array(centralRepoSchema).default([]),
    pins: z.record(z.array(z.string().min(1))).default({}),
    disabled: z.array(z.string().min(1)).default([]),
  })
  .strict();

const lockEntrySchema = z.object({
  ref: z.string().min(1),
  commit: z.string().min(1),
  resolvedAt: z.string().min(1),
});

const skillsLockSchema = z.object({
  repos: z.record(lockEntrySchema),
});

export type ConfigLoadResult =
  | { ok: true; config: SkillsConfig; exists: boolean }
  | { ok: false; error: string };

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function loadSkillsConfig(
  projectDir: string,
  allowedSchemes: readonly string[] = DEFAULT_ALLOWED_SCHEMES,
): Promise<ConfigLoadResult> {
  const filePath = path.join(projectDir, SKILLS_CONFIG_FILE);
  const raw = await readIfExists(filePath);
  if (raw === null) {
    return { ok: true, exists: false, config: { centralRepos: [], pins: {}, disabled: [] } };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `${SKILLS_CONFIG_FILE} is not valid JSON: ${message}` };
  }

  const parsed = skillsConfigSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return { ok: false, error: `${SKILLS_CONFIG_FILE} is invalid: ${issues}` };
  }

  for (const repo of parsed.data.centralRepos) {
    if (!isAllowedRepoUrl(repo.url, allowedSchemes)) {
      return {
        ok: false,
        error: `${SKILLS_CONFIG_FILE}: repository URL "${repo.url}" is not allowed. Use https://, ssh://, or git@host:path.`,
      };
    }
  }

  return { ok: true, exists: true, config: parsed.data };
}

export async function loadSkillsLock(projectDir: string): Promise<SkillsLock> {
  const raw = await readIfExists(path.join(projectDir, SKILLS_LOCK_FILE));
  if (raw === null) return { repos: {} };
  try {
    const parsed = skillsLockSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : { repos: {} };
  } catch {
    return { repos: {} };
  }
}

export async function writeSkillsLock(projectDir: string, lock: SkillsLock): Promise<void> {
  const filePath = path.join(projectDir, SKILLS_LOCK_FILE);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(lock, null, 2)}\n`, 'utf-8');
}
