// apps/desktop/src/main/design/design-files.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parseDesignFrontmatter } from '../../shared/design/structure';
import { parseFrontmatter } from '../../shared/frontmatter';
import type { DesignBriefStatus, DesignBriefSummary } from '../../shared/types/design';
import { loadTemplate } from '../brd/templates';

export const DESIGN_DIR = 'docs/design';
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REQ_PATTERN = /^R\d+$/;

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Absolute docs/design folder, verified to stay inside the project when it exists. */
async function designDir(projectDir: string): Promise<string> {
  const realProject = await fs.realpath(projectDir);
  const dir = path.join(realProject, DESIGN_DIR);
  if (await exists(dir)) {
    const real = await fs.realpath(dir);
    const boundary = realProject.endsWith(path.sep) ? realProject : realProject + path.sep;
    if (!real.startsWith(boundary)) throw new Error(`${DESIGN_DIR} resolves outside the project`);
  }
  return dir;
}

export async function designBriefPath(projectDir: string, brdSlug: string, requirementId: string): Promise<string> {
  if (!SLUG_PATTERN.test(brdSlug)) throw new Error(`Invalid BRD slug: "${brdSlug}"`);
  if (!REQ_PATTERN.test(requirementId)) throw new Error(`Invalid requirement id: "${requirementId}"`);
  return path.join(await designDir(projectDir), brdSlug, `${requirementId}.md`);
}

export function renderDesignTemplate(title: string, brd: string, requirement: string, updatedIso: string): string {
  return loadTemplate('design-brief-template')
    .replace(/<Title>/g, title)
    .replace(/<Brd>/g, brd)
    .replace(/<Requirement>/g, requirement)
    .replace(/<YYYY-MM-DD>/g, updatedIso);
}

async function summarize(filePath: string, brdSlug: string, requirementId: string, content: string): Promise<DesignBriefSummary> {
  const stat = await fs.stat(filePath);
  const fm = parseDesignFrontmatter(content);
  return {
    brdSlug,
    requirementId,
    title: fm.title ?? requirementId,
    status: fm.status,
    modifiedAt: stat.mtime.toISOString(),
    ...(fm.errors.length > 0 ? { warning: fm.errors.join('; ') } : {}),
  };
}

export async function listDesignBriefs(projectDir: string): Promise<DesignBriefSummary[]> {
  let dir: string;
  try {
    dir = await designDir(projectDir);
  } catch {
    return [];
  }
  if (!(await exists(dir))) return [];
  const out: DesignBriefSummary[] = [];
  for (const brdEntry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!brdEntry.isDirectory() || !SLUG_PATTERN.test(brdEntry.name)) continue;
    const brdDir = path.join(dir, brdEntry.name);
    for (const entry of await fs.readdir(brdDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const id = entry.name.slice(0, -3);
      if (!REQ_PATTERN.test(id)) continue;
      const filePath = path.join(brdDir, entry.name);
      out.push(await summarize(filePath, brdEntry.name, id, await fs.readFile(filePath, 'utf-8')));
    }
  }
  out.sort((a, b) => a.brdSlug.localeCompare(b.brdSlug) || Number(a.requirementId.slice(1)) - Number(b.requirementId.slice(1)));
  return out;
}

export async function readDesignBrief(
  projectDir: string,
  brdSlug: string,
  requirementId: string,
): Promise<{ summary: DesignBriefSummary; content: string }> {
  const filePath = await designBriefPath(projectDir, brdSlug, requirementId);
  if (!(await exists(filePath))) throw new Error(`Design brief not found: ${brdSlug}/${requirementId}`);
  const content = await fs.readFile(filePath, 'utf-8');
  return { summary: await summarize(filePath, brdSlug, requirementId, content), content };
}

export async function writeDesignBrief(projectDir: string, brdSlug: string, requirementId: string, content: string): Promise<DesignBriefSummary> {
  const filePath = await designBriefPath(projectDir, brdSlug, requirementId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, content, 'utf-8');
  await fs.rename(tmp, filePath);
  return summarize(filePath, brdSlug, requirementId, content);
}

export async function createDesignBrief(
  projectDir: string,
  brdSlug: string,
  requirement: { id: string; title: string },
  now: Date = new Date(),
): Promise<DesignBriefSummary> {
  const filePath = await designBriefPath(projectDir, brdSlug, requirement.id);
  if (await exists(filePath)) throw new Error(`Design brief already exists: ${brdSlug}/${requirement.id}`);
  const updated = now.toISOString().slice(0, 10);
  return writeDesignBrief(projectDir, brdSlug, requirement.id, renderDesignTemplate(requirement.title.trim(), brdSlug, requirement.id, updated));
}

/** Rewrites the status and updated frontmatter lines only; the body stays byte-identical. */
export async function setDesignBriefStatus(
  projectDir: string,
  brdSlug: string,
  requirementId: string,
  status: DesignBriefStatus,
  now: Date = new Date(),
): Promise<DesignBriefSummary> {
  const { content } = await readDesignBrief(projectDir, brdSlug, requirementId);
  const normalized = content.replace(/\r\n/g, '\n');
  const end = normalized.indexOf('\n---', 4);
  if (!normalized.startsWith('---\n') || end === -1) throw new Error(`Design brief has no frontmatter: ${brdSlug}/${requirementId}`);
  const updated = now.toISOString().slice(0, 10);
  let block = normalized.slice(4, end);
  block = /^status:.*$/m.test(block) ? block.replace(/^status:.*$/m, `status: ${status}`) : `${block}\nstatus: ${status}`;
  block = /^updated:.*$/m.test(block) ? block.replace(/^updated:.*$/m, `updated: ${updated}`) : `${block}\nupdated: ${updated}`;
  return writeDesignBrief(projectDir, brdSlug, requirementId, `---\n${block}${normalized.slice(end)}`);
}

/** Bodies (frontmatter stripped) of approved briefs, in the given requirement order; missing or draft briefs are skipped. */
export async function approvedBriefs(
  projectDir: string,
  brdSlug: string,
  requirementIds: string[],
): Promise<Array<{ requirementId: string; title: string; body: string }>> {
  const out: Array<{ requirementId: string; title: string; body: string }> = [];
  for (const id of requirementIds) {
    let read: { summary: DesignBriefSummary; content: string };
    try {
      read = await readDesignBrief(projectDir, brdSlug, id);
    } catch {
      continue;
    }
    if (read.summary.status !== 'approved') continue;
    out.push({ requirementId: id, title: read.summary.title, body: parseFrontmatter(read.content)?.body ?? read.content });
  }
  return out;
}
