// apps/desktop/src/main/brd/brd-files.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parseBrdFrontmatter, slugify } from '../../shared/brd/structure';
import type { BrdSummary } from '../../shared/types/brd';
import { renderBrdTemplate } from './templates';

export const BRD_DIR = 'docs/brd';
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Absolute path of the BRD folder, verified to stay inside the project when it exists. */
async function brdDir(projectDir: string): Promise<string> {
  const realProject = await fs.realpath(projectDir);
  const dir = path.join(realProject, BRD_DIR);
  if (await exists(dir)) {
    const real = await fs.realpath(dir);
    const boundary = realProject.endsWith(path.sep) ? realProject : realProject + path.sep;
    if (!real.startsWith(boundary)) throw new Error(`${BRD_DIR} resolves outside the project`);
  }
  return dir;
}

export async function brdPath(projectDir: string, slug: string): Promise<string> {
  if (!SLUG_PATTERN.test(slug)) throw new Error(`Invalid BRD slug: "${slug}"`);
  return path.join(await brdDir(projectDir), `${slug}.md`);
}

async function summarize(filePath: string, slug: string, content: string): Promise<BrdSummary> {
  const stat = await fs.stat(filePath);
  const fm = parseBrdFrontmatter(content);
  return {
    slug,
    title: fm.title ?? slug,
    status: fm.status,
    ...(fm.owner ? { owner: fm.owner } : {}),
    ...(fm.created ? { created: fm.created } : {}),
    modifiedAt: stat.mtime.toISOString(),
    ...(fm.errors.length > 0 ? { warning: fm.errors.join('; ') } : {}),
  };
}

export async function listBrds(projectDir: string): Promise<BrdSummary[]> {
  const dir = await brdDir(projectDir);
  if (!(await exists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: BrdSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const slug = entry.name.slice(0, -3);
    if (!SLUG_PATTERN.test(slug)) continue;
    const filePath = path.join(dir, entry.name);
    const content = await fs.readFile(filePath, 'utf-8');
    out.push(await summarize(filePath, slug, content));
  }
  out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return out;
}

export async function readBrd(projectDir: string, slug: string): Promise<{ summary: BrdSummary; content: string }> {
  const filePath = await brdPath(projectDir, slug);
  if (!(await exists(filePath))) throw new Error(`BRD not found: ${slug}`);
  const content = await fs.readFile(filePath, 'utf-8');
  return { summary: await summarize(filePath, slug, content), content };
}

export async function writeBrd(projectDir: string, slug: string, content: string): Promise<BrdSummary> {
  const filePath = await brdPath(projectDir, slug);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, content, 'utf-8');
  await fs.rename(tmp, filePath);
  return summarize(filePath, slug, content);
}

export async function createBrd(projectDir: string, title: string, now: Date = new Date()): Promise<BrdSummary> {
  const base = slugify(title);
  let slug = base;
  for (let i = 2; await exists(await brdPath(projectDir, slug)); i++) {
    slug = `${base}-${i}`;
  }
  const created = now.toISOString().slice(0, 10);
  return writeBrd(projectDir, slug, renderBrdTemplate(title.trim(), created));
}
