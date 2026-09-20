// apps/desktop/src/main/brd/requirements-files.ts
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { RequirementsSetSchema } from '../../shared/brd/requirements';
import type { RequirementsSet } from '../../shared/types/requirements';
import { brdPath } from './brd-files';

export function brdHash(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex');
}

/** `<docs/brd>/<slug>.requirements.json`, reusing brdPath's slug and containment checks. */
export async function requirementsPath(projectDir: string, slug: string): Promise<string> {
  const md = await brdPath(projectDir, slug);
  return path.join(path.dirname(md), `${slug}.requirements.json`);
}

export async function readRequirements(projectDir: string, slug: string): Promise<RequirementsSet | null> {
  const file = await requirementsPath(projectDir, slug);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = RequirementsSetSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${slug}.requirements.json is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return parsed.data as RequirementsSet;
}

export async function writeRequirements(projectDir: string, slug: string, set: RequirementsSet): Promise<RequirementsSet> {
  const file = await requirementsPath(projectDir, slug);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(set, null, 2)}\n`, 'utf-8');
  await fs.rename(tmp, file);
  return set;
}
