// apps/desktop/src/main/ai/skills/skill-files.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parseFrontmatter } from './frontmatter';
import {
  MAX_RESOURCE_BYTES,
  MAX_SKILL_FILES_LISTED,
  SKILLS_USAGE_FILE,
  type SkillUsageRecord,
} from './types';

/** SKILL.md content without the frontmatter block. */
export async function readSkillBody(skillDir: string): Promise<string> {
  const raw = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8');
  const fm = parseFrontmatter(raw);
  return fm ? fm.body : raw;
}

/** Bundled files (recursive) as posix-style paths relative to the skill folder. */
export async function listSkillFiles(skillDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string, rel: string): Promise<void> {
    if (out.length >= MAX_SKILL_FILES_LISTED) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= MAX_SKILL_FILES_LISTED) return;
      if (entry.name === '.git') continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(current, entry.name), relPath);
      } else if (entry.isFile() && relPath !== 'SKILL.md') {
        out.push(relPath);
      }
    }
  }
  await walk(skillDir, '');
  return out;
}

/**
 * Read one bundled file. The resolved real path must stay inside the skill
 * folder; symlinks pointing outside are rejected.
 */
export async function readSkillResource(skillDir: string, resource: string): Promise<string> {
  const realSkillDir = await fs.realpath(skillDir);
  const boundary = realSkillDir.endsWith(path.sep) ? realSkillDir : realSkillDir + path.sep;

  if (path.isAbsolute(resource)) {
    throw new Error(`Resource "${resource}" is outside the skill folder`);
  }
  const candidate = path.resolve(realSkillDir, resource);

  let real: string;
  try {
    real = await fs.realpath(candidate);
  } catch {
    if (!candidate.startsWith(boundary)) {
      throw new Error(`Resource "${resource}" is outside the skill folder`);
    }
    throw new Error(`Resource "${resource}" not found in skill`);
  }
  if (!real.startsWith(boundary)) {
    throw new Error(`Resource "${resource}" is outside the skill folder`);
  }

  const stat = await fs.stat(real);
  if (!stat.isFile()) throw new Error(`Resource "${resource}" not found in skill`);
  if (stat.size > MAX_RESOURCE_BYTES) {
    throw new Error(`Resource "${resource}" is too large (${stat.size} bytes, max ${MAX_RESOURCE_BYTES})`);
  }
  return fs.readFile(real, 'utf-8');
}

export async function readSkillUsage(specDir: string): Promise<SkillUsageRecord[]> {
  try {
    const raw = await fs.readFile(path.join(specDir, SKILLS_USAGE_FILE), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SkillUsageRecord[]) : [];
  } catch {
    return [];
  }
}

/** Append one record. Silently no-op when the spec dir does not exist. */
export async function appendSkillUsage(specDir: string, record: SkillUsageRecord): Promise<void> {
  try {
    if (!(await fs.stat(specDir)).isDirectory()) return;
  } catch {
    return;
  }
  const existing = await readSkillUsage(specDir);
  existing.push(record);
  await fs.writeFile(path.join(specDir, SKILLS_USAGE_FILE), `${JSON.stringify(existing, null, 2)}\n`, 'utf-8');
}
