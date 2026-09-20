// apps/desktop/src/main/ai/skills/discovery.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parseFrontmatter } from './frontmatter';
import { MAX_DESCRIPTION_LENGTH, type SkillDefinition, type SkillSource } from './types';

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface DiscoveryResult {
  skills: SkillDefinition[];
  warnings: string[];
}

export interface SkillOrigin {
  repoUrl?: string;
  commit?: string;
}

export interface DiscoveryOptions {
  /** When set, only folders with these names are examined (no warnings for others). */
  only?: readonly string[];
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Discover skills directly under `dir` (one level: `<dir>/<name>/SKILL.md`).
 * Invalid folders are skipped with a warning. Missing `dir` yields no skills.
 */
export async function discoverSkills(
  dir: string,
  source: SkillSource,
  origin: SkillOrigin = {},
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const skills: SkillDefinition[] = [];
  const warnings: string[] = [];

  if (!(await isDirectory(dir))) return { skills, warnings };

  const only = options.only ? new Set(options.only) : null;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (only && !only.has(entry.name)) continue;
    const folder = path.join(dir, entry.name);
    if (!(entry.isDirectory() || entry.isSymbolicLink())) continue;
    if (!(await isDirectory(folder))) continue;

    const skillFile = path.join(folder, 'SKILL.md');
    let raw: string;
    try {
      raw = await fs.readFile(skillFile, 'utf-8');
    } catch {
      continue; // plain folder without SKILL.md — not a skill, not a warning
    }

    const fm = parseFrontmatter(raw);
    if (!fm) {
      warnings.push(`Skipped "${entry.name}": SKILL.md has no frontmatter block`);
      continue;
    }
    const name = fm.fields.name ?? '';
    let description = fm.fields.description ?? '';

    if (!name || name !== entry.name) {
      warnings.push(`Skipped "${entry.name}": frontmatter name "${name}" must equal the folder name`);
      continue;
    }
    if (!SKILL_NAME_PATTERN.test(name)) {
      warnings.push(`Skipped "${entry.name}": name must be kebab-case (a-z, 0-9, hyphens)`);
      continue;
    }
    if (!description) {
      warnings.push(`Skipped "${entry.name}": frontmatter description is required`);
      continue;
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      description = description.slice(0, MAX_DESCRIPTION_LENGTH);
      warnings.push(`Description of "${name}" was capped at ${MAX_DESCRIPTION_LENGTH} characters`);
    }

    skills.push({
      name,
      description,
      source,
      dir: await fs.realpath(folder),
      ...(origin.repoUrl ? { repoUrl: origin.repoUrl } : {}),
      ...(origin.commit ? { commit: origin.commit } : {}),
    });
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return { skills, warnings };
}
