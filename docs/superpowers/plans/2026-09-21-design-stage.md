# Design Stage (4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI-drafted, designer-approved design briefs per `needsDesign` requirement, injected into the build agents' prompts and surfaced as a release warning.

**Architecture:** Briefs are Markdown files in `docs/design/<brd-slug>/<R-id>.md` handled by a `src/main/design/` module that mirrors `src/main/brd/`. A streaming design-writer runner mirrors the BRD writer. The worker's prompt assembly gains a design section built from the task's requirement ids. A Design view with its own Zustand store mirrors the BRD workspace, and status chips link from the Requirements tab and task detail.

**Tech Stack:** Electron main + preload + React renderer, TypeScript strict, Zustand, react-i18next, Vitest, Biome, Vercel AI SDK `streamText`.

**Spec:** `docs/superpowers/specs/2026-09-21-design-stage-design.md`

## Global Constraints

- Paths are relative to `apps/desktop/`; run commands from there. Work on `develop`, commit per task.
- Vercel AI SDK only, through `createSimpleClient` + `streamText` as `brd-writer.ts` does.
- All UI text through `react-i18next`; add keys to `en` and `fr`.
- Brief path `docs/design/<brd-slug>/<requirementId>.md`; requirement ids match `^R\d+$`; slugs match `^[a-z0-9]+(-[a-z0-9]+)*$`.
- Statuses: `draft`, `approved`. Only `approved` briefs are injected.
- Injection agent types: `spec_gatherer`, `spec_researcher`, `spec_writer`, `planner`, `coder`, `qa_reviewer`; cap 40 KB.
- Release warning text: `No approved design brief for <ids joined by ", ">`.
- Sidebar item `design`, shortcut `E`, icon `PenTool`.
- Error strings: `Design brief not found: <slug>/<id>`, `Design brief already exists: <slug>/<id>`, `Requirement <id> not found in <slug>`, `A draft is already running for this project`.

---

### Task 1: Types, template, structure check, and files module

**Files:**
- Create: `src/shared/types/design.ts`, `src/shared/design/structure.ts`, `templates/design-brief-template.md`, `src/main/design/design-files.ts`
- Test: `src/shared/design/__tests__/structure.test.ts`, `src/main/design/__tests__/design-files.test.ts`

**Interfaces:**
- Produces: types in 2.4 of the spec; `DESIGN_REQUIRED_SECTIONS`, `DESIGN_OPTIONAL_SECTIONS`, `parseDesignFrontmatter(md)`, `checkDesignStructure(md): BrdStructureResult`; `DESIGN_DIR`, `designBriefPath`, `listDesignBriefs`, `readDesignBrief`, `writeDesignBrief`, `createDesignBrief`, `setDesignBriefStatus`, `approvedBriefs`, `renderDesignTemplate(title, brd, requirement, updatedIso)`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/desktop/src/shared/design/__tests__/structure.test.ts
import { describe, it, expect } from 'vitest';
import { checkDesignStructure, parseDesignFrontmatter } from '../structure';

const doc = `---
brd: todo-app
requirement: R3
title: Filter todos
status: approved
updated: 2026-09-21
---
# Filter todos

## Summary
Users filter by status.

## User flows
1. Tap a filter.

## Screens

### List
Layout: toolbar
States: empty, loading, error, success
Interactions: tap

## Components
- FilterBar

## Copy

## Accessibility

## Open questions
`;

describe('design structure', () => {
  it('parses frontmatter and validates status', () => {
    expect(parseDesignFrontmatter(doc)).toEqual({ brd: 'todo-app', requirement: 'R3', title: 'Filter todos', status: 'approved', updated: '2026-09-21', errors: [] });
    expect(parseDesignFrontmatter('# no fm').errors).toEqual(['Frontmatter block is missing']);
    expect(parseDesignFrontmatter(doc.replace('status: approved', 'status: done')).errors).toEqual(['status must be one of draft, approved']);
    expect(parseDesignFrontmatter(doc.replace('status: approved', 'status: done')).status).toBe('draft');
  });

  it('checks required and optional sections', () => {
    const r = checkDesignStructure(doc);
    expect(r.ok).toBe(true);
    expect(r.sections.map((s) => [s.heading, s.required, s.present && !s.empty])).toEqual([
      ['Summary', true, true], ['User flows', true, true], ['Screens', true, true], ['Components', true, true],
      ['Copy', false, false], ['Accessibility', false, false], ['Open questions', false, false],
    ]);
    expect(checkDesignStructure(doc.replace('Users filter by status.', '')).ok).toBe(false);
  });
});
```

```ts
// apps/desktop/src/main/design/__tests__/design-files.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

vi.mock('../../brd/templates', () => ({
  loadTemplate: () => '---\ntitle: <Title>\nbrd: <Brd>\nrequirement: <Requirement>\nstatus: draft\nupdated: <YYYY-MM-DD>\n---\n# <Title>\n\n## Summary\n',
}));

import { approvedBriefs, createDesignBrief, listDesignBriefs, readDesignBrief, setDesignBriefStatus, writeDesignBrief } from '../design-files';

let dir: string;
const brief = (status: string, title = 'Filter todos') =>
  `---\nbrd: todo-app\nrequirement: R3\ntitle: ${title}\nstatus: ${status}\nupdated: 2026-09-21\n---\n# ${title}\n\n## Summary\nBody text\n`;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'design-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('design files', () => {
  it('lists briefs across BRDs with status and warnings', async () => {
    mkdirSync(path.join(dir, 'docs/design/todo-app'), { recursive: true });
    writeFileSync(path.join(dir, 'docs/design/todo-app/R3.md'), brief('approved'));
    writeFileSync(path.join(dir, 'docs/design/todo-app/R4.md'), '# no frontmatter');
    writeFileSync(path.join(dir, 'docs/design/todo-app/notes.md'), 'ignored');
    const list = await listDesignBriefs(dir);
    expect(list.map((b) => [b.brdSlug, b.requirementId, b.status, b.title])).toEqual([
      ['todo-app', 'R3', 'approved', 'Filter todos'],
      ['todo-app', 'R4', 'draft', 'R4'],
    ]);
    expect(list[1].warning).toContain('Frontmatter');
    expect(await listDesignBriefs(path.join(dir, 'nowhere'))).toEqual([]);
  });

  it('creates from the template, refuses duplicates, reads and writes', async () => {
    const s = await createDesignBrief(dir, 'todo-app', { id: 'R3', title: 'Filter todos' }, new Date('2026-09-21T10:00:00Z'));
    expect(s).toMatchObject({ brdSlug: 'todo-app', requirementId: 'R3', status: 'draft', title: 'Filter todos' });
    const file = readFileSync(path.join(dir, 'docs/design/todo-app/R3.md'), 'utf-8');
    expect(file).toContain('title: Filter todos\nbrd: todo-app\nrequirement: R3\nstatus: draft\nupdated: 2026-09-21');
    await expect(createDesignBrief(dir, 'todo-app', { id: 'R3', title: 'x' })).rejects.toThrow('Design brief already exists: todo-app/R3');
    await writeDesignBrief(dir, 'todo-app', 'R3', brief('draft', 'Renamed'));
    expect((await readDesignBrief(dir, 'todo-app', 'R3')).summary.title).toBe('Renamed');
    await expect(readDesignBrief(dir, 'todo-app', 'R9')).rejects.toThrow('Design brief not found: todo-app/R9');
    await expect(readDesignBrief(dir, '../x', 'R1')).rejects.toThrow('Invalid BRD slug');
    await expect(readDesignBrief(dir, 'todo-app', 'x1')).rejects.toThrow('Invalid requirement id');
  });

  it('changes status by rewriting only the frontmatter lines', async () => {
    mkdirSync(path.join(dir, 'docs/design/todo-app'), { recursive: true });
    writeFileSync(path.join(dir, 'docs/design/todo-app/R3.md'), brief('draft'));
    const s = await setDesignBriefStatus(dir, 'todo-app', 'R3', 'approved', new Date('2026-09-22T00:00:00Z'));
    expect(s.status).toBe('approved');
    const file = readFileSync(path.join(dir, 'docs/design/todo-app/R3.md'), 'utf-8');
    expect(file).toContain('status: approved\nupdated: 2026-09-22\n');
    expect(file.split('---\n')[2]).toBe('# Filter todos\n\n## Summary\nBody text\n');
  });

  it('returns approved bodies in requirement order', async () => {
    mkdirSync(path.join(dir, 'docs/design/todo-app'), { recursive: true });
    writeFileSync(path.join(dir, 'docs/design/todo-app/R3.md'), brief('approved'));
    writeFileSync(path.join(dir, 'docs/design/todo-app/R1.md'), brief('draft'));
    const out = await approvedBriefs(dir, 'todo-app', ['R9', 'R3', 'R1']);
    expect(out).toEqual([{ requirementId: 'R3', title: 'Filter todos', body: '# Filter todos\n\n## Summary\nBody text\n' }]);
    expect(existsSync(path.join(dir, 'docs/design/todo-app/R9.md'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/design src/main/design`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write types, structure, template, files module**

```ts
// apps/desktop/src/shared/types/design.ts
export type DesignBriefStatus = 'draft' | 'approved';
export const DESIGN_BRIEF_STATUSES: readonly DesignBriefStatus[] = ['draft', 'approved'];

export interface DesignBriefSummary {
  brdSlug: string;
  requirementId: string;
  title: string;
  status: DesignBriefStatus;
  /** ISO timestamp of the file's last modification */
  modifiedAt: string;
  /** Set when the frontmatter could not be fully parsed */
  warning?: string;
}

export interface DesignFrontmatter {
  brd?: string;
  requirement?: string;
  title?: string;
  status: DesignBriefStatus;
  updated?: string;
  errors: string[];
}

export type DesignDraftMode = 'draft' | 'revise';
export interface DesignDraftRequest {
  brdSlug: string;
  requirementId: string;
  mode: DesignDraftMode;
  notes: string;
}
export interface DesignDraftChunk { runId: string; text: string }
export interface DesignDraftDone { runId: string; text: string }
export interface DesignDraftError { runId: string; error: string }
```

```ts
// apps/desktop/src/shared/design/structure.ts
import { parseFrontmatter } from '../frontmatter';
import type { BrdSection, BrdStructureResult } from '../types/brd';
import { DESIGN_BRIEF_STATUSES, type DesignBriefStatus, type DesignFrontmatter } from '../types/design';

export const DESIGN_REQUIRED_SECTIONS = ['Summary', 'User flows', 'Screens', 'Components'] as const;
export const DESIGN_OPTIONAL_SECTIONS = ['Copy', 'Accessibility', 'Open questions'] as const;

export function parseDesignFrontmatter(markdown: string): DesignFrontmatter {
  const fm = parseFrontmatter(markdown);
  if (!fm) return { status: 'draft', errors: ['Frontmatter block is missing'] };
  const errors: string[] = [];
  const get = (k: string) => fm.fields[k]?.trim() || undefined;
  const rawStatus = get('status');
  let status: DesignBriefStatus = 'draft';
  if (rawStatus) {
    if ((DESIGN_BRIEF_STATUSES as readonly string[]).includes(rawStatus)) status = rawStatus as DesignBriefStatus;
    else errors.push(`status must be one of ${DESIGN_BRIEF_STATUSES.join(', ')}`);
  }
  if (!get('title')) errors.push('title is required');
  return { brd: get('brd'), requirement: get('requirement'), title: get('title'), status, updated: get('updated'), errors };
}

function splitSections(markdown: string): Map<string, string[]> {
  const fm = parseFrontmatter(markdown);
  const body = fm ? fm.body : markdown;
  const sections = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) {
      current = [];
      sections.set(h2[1].toLowerCase(), current);
      continue;
    }
    current?.push(line);
  }
  return sections;
}

/** Whitespace, headings, bare list markers, "Label:" lines from the template, and <placeholders> count as empty. */
function isEmptyContent(lines: string[]): boolean {
  return lines.every((raw) => {
    const line = raw.replace(/<[^>]*>/g, '').trim();
    if (line === '') return true;
    if (/^#+(\s|$)/.test(line)) return true;
    if (/^(\d+\.|[-*+])\s*$/.test(line)) return true;
    if (/^(Layout|States|Interactions):\s*(empty, loading, error, success)?$/.test(line)) return true;
    return false;
  });
}

export function checkDesignStructure(markdown: string): BrdStructureResult {
  const frontmatterErrors = parseDesignFrontmatter(markdown).errors;
  const found = splitSections(markdown);
  const describe = (heading: string, required: boolean): BrdSection => {
    const lines = found.get(heading.toLowerCase());
    const present = lines !== undefined;
    return { heading, required, present, empty: !present || isEmptyContent(lines) };
  };
  const sections = [...DESIGN_REQUIRED_SECTIONS.map((h) => describe(h, true)), ...DESIGN_OPTIONAL_SECTIONS.map((h) => describe(h, false))];
  const ok = frontmatterErrors.length === 0 && sections.every((s) => !s.required || (s.present && !s.empty));
  return { ok, sections, frontmatterErrors };
}
```

`templates/design-brief-template.md`:

```markdown
---
title: <Title>
brd: <Brd>
requirement: <Requirement>
status: draft
updated: <YYYY-MM-DD>
---

# <Title>

## Summary

<What the user can do after this change, in two or three sentences.>

## User flows

<Numbered steps for each flow, starting from where the user is.>

## Screens

### <Screen name>
Layout:
States: empty, loading, error, success
Interactions:

## Components

<Existing components to reuse and new ones to build.>

## Copy

<Labels, button text, empty-state and error messages.>

## Accessibility

<Keyboard, focus, contrast, and screen-reader notes.>

## Open questions

<Anything the designer or PO must confirm.>
```

```ts
// apps/desktop/src/main/design/design-files.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parseFrontmatter } from '../../shared/frontmatter';
import { parseDesignFrontmatter } from '../../shared/design/structure';
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

export async function readDesignBrief(projectDir: string, brdSlug: string, requirementId: string): Promise<{ summary: DesignBriefSummary; content: string }> {
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
```

- [ ] **Step 4: Run tests, lint, typecheck, commit**

Run: `npx vitest run src/shared/design src/main/design && npx biome check src/shared/design src/shared/types/design.ts src/main/design && npx tsc --noEmit -p tsconfig.json`
Expected: PASS. Confirm `templates/` is included in the packaged resources the same way `brd-template.md` is (check `electron-builder` `extraResources` in `package.json`; if it lists the folder, nothing to do).

```bash
git add src/shared/types/design.ts src/shared/design templates/design-brief-template.md src/main/design
git commit -m "feat(design): brief types, template, structure check, and file module"
```

---

### Task 2: Design writer runner and prompt

**Files:**
- Create: `prompts/design_writer.md`, `src/main/ai/runners/design-writer.ts`
- Test: `src/main/ai/runners/__tests__/design-writer.test.ts`

**Interfaces:**
- Produces: `DesignWriterConfig`, `DesignWriterEvent` (same union as `BrdWriterEvent`), `buildDesignWriterPrompts(config, template, projectContext)`, `runDesignWriter(config, onEvent)`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/src/main/ai/runners/__tests__/design-writer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { streamText, createSimpleClient } = vi.hoisted(() => ({ streamText: vi.fn(), createSimpleClient: vi.fn() }));
vi.mock('ai', () => ({ streamText }));
vi.mock('../../client/factory', () => ({ createSimpleClient }));
vi.mock('../../prompts/prompt-loader', () => ({ tryLoadPrompt: () => 'DESIGN RULES' }));
vi.mock('../../../brd/templates', () => ({ loadTemplate: () => '---\ntitle: <Title>\n---\n## Summary\n' }));
vi.mock('../brd-writer', () => ({ loadBrdProjectContext: () => 'Project: Acme' }));

import { buildDesignWriterPrompts, runDesignWriter } from '../design-writer';

const cfg = {
  projectDir: '/p', mode: 'draft' as const, notes: 'Keep it minimal.', brdSlug: 'todo-app',
  requirement: { id: 'R3', title: 'Filter todos', description: 'Filter by status', acceptanceCriteria: ['Shows all', 'Shows done'], area: 'List' },
  siblingTitles: ['Add todo', 'Delete todo'], brdBody: '# Todo app\nBody',
};

async function* parts(items: Array<Record<string, unknown>>) {
  for (const p of items) yield p;
}

beforeEach(() => vi.clearAllMocks());

describe('buildDesignWriterPrompts', () => {
  it('draft mode embeds rules, template, context, requirement, siblings, BRD, and notes', () => {
    const { system, prompt } = buildDesignWriterPrompts(cfg, 'TEMPLATE BODY', 'Project: Acme');
    expect(system).toContain('DESIGN RULES');
    expect(system).toContain('## TEMPLATE\n\nTEMPLATE BODY');
    expect(system).toContain('## PROJECT CONTEXT\n\nProject: Acme');
    expect(prompt).toContain('MODE: DRAFT');
    expect(prompt).toContain('Requirement R3: Filter todos');
    expect(prompt).toContain('- Shows all\n- Shows done');
    expect(prompt).toContain('Other requirements in this BRD: Add todo; Delete todo');
    expect(prompt).toContain('BRD:\n# Todo app\nBody');
    expect(prompt).toContain('Designer notes:\nKeep it minimal.');
    expect(prompt).toContain('brd: todo-app');
  });

  it('revise mode includes the existing brief and instructions', () => {
    const { prompt } = buildDesignWriterPrompts({ ...cfg, mode: 'revise', existing: '# Old', notes: 'Add an empty state.' }, 'T', '');
    expect(prompt).toContain('MODE: REVISE');
    expect(prompt).toContain('Current brief:\n\n# Old');
    expect(prompt).toContain('Instructions:\nAdd an empty state.');
  });
});

describe('runDesignWriter', () => {
  it('streams deltas then done', async () => {
    createSimpleClient.mockResolvedValue({ model: { modelId: 'claude' }, systemPrompt: 's' });
    streamText.mockReturnValue({ fullStream: parts([{ type: 'text-delta', text: 'a' }, { type: 'text-delta', text: 'b' }]) });
    const events: unknown[] = [];
    await runDesignWriter(cfg, (e) => events.push(e));
    expect(events).toEqual([{ type: 'text-delta', text: 'a' }, { type: 'text-delta', text: 'b' }, { type: 'done', text: 'ab' }]);
  });

  it('reports stream errors and thrown errors', async () => {
    createSimpleClient.mockResolvedValue({ model: { modelId: 'claude' }, systemPrompt: 's' });
    streamText.mockReturnValue({ fullStream: parts([{ type: 'error', error: new Error('boom') }]) });
    const events: unknown[] = [];
    await runDesignWriter(cfg, (e) => events.push(e));
    expect(events).toEqual([{ type: 'error', error: 'boom' }]);
    createSimpleClient.mockRejectedValue(new Error('no model'));
    const events2: unknown[] = [];
    await runDesignWriter(cfg, (e) => events2.push(e));
    expect(events2).toEqual([{ type: 'error', error: 'no model' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ai/runners/__tests__/design-writer.test.ts`
Expected: FAIL, cannot find `../design-writer`.

- [ ] **Step 3: Write the prompt and runner**

`prompts/design_writer.md`:

```markdown
# Design Brief Writer

You write design briefs for a software product team, one brief per requirement. You produce Markdown only, following the TEMPLATE exactly: same frontmatter fields, same level-2 section order, same heading text.

Rules:
- Frontmatter: title, brd, requirement, and updated exactly as given in the input; status "draft".
- Summary: what the user can do after this change, two or three sentences.
- User flows: numbered steps per flow, starting from where the user already is in the product.
- Screens: one level-3 heading per screen or screen change. Each screen lists Layout, States (empty, loading, error, success; say "not applicable" for a state that cannot occur), and Interactions.
- Components: existing components to reuse first, then new ones. Name them plainly.
- Copy: exact labels, button text, empty-state and error messages.
- Accessibility: keyboard, focus order, contrast, and screen-reader notes.
- Open questions: anything the designer or product owner must confirm.
- Where the input gives no information, write a short, reasonable proposal and mark it "(assumption)".
- Cover every acceptance criterion of the requirement. Do not add requirements, features, or criteria that are not in the input.
- Stay neutral about colors, fonts, and spacing; the project's design system applies those. Never write dates, durations, or estimates.
- Do not wrap the document in code fences. Output the document and nothing else.

In DRAFT mode you receive the requirement, the BRD, and the designer's notes and write the whole brief.
In REVISE mode you receive the current brief and instructions; apply the instructions, keep everything else unchanged, and return the complete brief.
```

```ts
// apps/desktop/src/main/ai/runners/design-writer.ts
/**
 * Design brief writer — drafts or revises one design brief as Markdown.
 * Streams text only; never writes files. Mirrors brd-writer.ts.
 */
import { streamText } from 'ai';

import { loadTemplate } from '../../brd/templates';
import type { DesignDraftMode } from '../../../shared/types/design';
import { createSimpleClient } from '../client/factory';
import type { ThinkingLevel } from '../config/types';
import { tryLoadPrompt } from '../prompts/prompt-loader';
import { loadBrdProjectContext } from './brd-writer';

export interface DesignWriterRequirement {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  area: string;
}

export interface DesignWriterConfig {
  projectDir: string;
  mode: DesignDraftMode;
  notes: string;
  brdSlug: string;
  requirement: DesignWriterRequirement;
  siblingTitles: string[];
  brdBody: string;
  existing?: string;
  modelShorthand?: string;
  thinkingLevel?: ThinkingLevel;
  abortSignal?: AbortSignal;
}

export type DesignWriterEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; error: string };

const FALLBACK_SYSTEM = 'You write design briefs in Markdown following the TEMPLATE exactly. Output the document only.';

export function buildDesignWriterPrompts(
  config: DesignWriterConfig,
  template: string,
  projectContext: string,
): { system: string; prompt: string } {
  const rules = tryLoadPrompt('design_writer') ?? FALLBACK_SYSTEM;
  const system =
    `${rules.trim()}\n\n## TEMPLATE\n\n${template.trim()}\n` +
    (projectContext ? `\n## PROJECT CONTEXT\n\n${projectContext.trim()}\n` : '');
  const r = config.requirement;
  const requirementBlock =
    `Requirement ${r.id}: ${r.title}\nArea: ${r.area}\n${r.description.trim()}\n\nAcceptance criteria:\n${r.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}\n\n` +
    `Other requirements in this BRD: ${config.siblingTitles.join('; ') || '(none)'}\n\n` +
    `Frontmatter values: title: ${r.title}, brd: ${config.brdSlug}, requirement: ${r.id}, updated: ${new Date().toISOString().slice(0, 10)}\n\n`;
  const prompt =
    config.mode === 'draft'
      ? `MODE: DRAFT\n\n${requirementBlock}BRD:\n${config.brdBody.trim()}\n\nDesigner notes:\n${config.notes.trim() || '(none)'}\n\nWrite the complete design brief now.`
      : `MODE: REVISE\n\n${requirementBlock}Current brief:\n\n${(config.existing ?? '').trim()}\n\nInstructions:\n${config.notes.trim()}\n\nReturn the complete revised brief now.`;
  return { system, prompt };
}

export async function runDesignWriter(config: DesignWriterConfig, onEvent: (e: DesignWriterEvent) => void): Promise<void> {
  let text = '';
  try {
    const { system, prompt } = buildDesignWriterPrompts(config, loadTemplate('design-brief-template'), loadBrdProjectContext(config.projectDir));
    const client = await createSimpleClient({
      systemPrompt: system,
      modelShorthand: config.modelShorthand ?? 'sonnet',
      thinkingLevel: config.thinkingLevel ?? 'medium',
      maxSteps: 1,
      tools: {},
    });
    const modelId = typeof client.model === 'string' ? client.model : client.model.modelId;
    const isCodex = modelId?.includes('codex') ?? false;
    const result = streamText({
      model: client.model,
      system: isCodex ? undefined : system,
      prompt,
      abortSignal: config.abortSignal,
      ...(isCodex ? { providerOptions: { openai: { instructions: system, store: false } } } : {}),
    });
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        text += part.text;
        onEvent({ type: 'text-delta', text: part.text });
      } else if (part.type === 'error') {
        onEvent({ type: 'error', error: part.error instanceof Error ? part.error.message : String(part.error) });
        return;
      }
    }
    onEvent({ type: 'done', text });
  } catch (err: unknown) {
    onEvent({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}
```

- [ ] **Step 4: Run tests, lint, commit**

Run: `npx vitest run src/main/ai/runners/__tests__/design-writer.test.ts && npx biome check src/main/ai/runners/design-writer.ts`
Expected: PASS.

```bash
git add prompts/design_writer.md src/main/ai/runners/design-writer.ts src/main/ai/runners/__tests__/design-writer.test.ts
git commit -m "feat(design): streaming design brief writer and prompt"
```

---

### Task 3: IPC channels, handlers, preload, types, mock

**Files:**
- Create: `src/main/ipc-handlers/design-handlers.ts`, `src/preload/api/modules/design-api.ts`
- Modify: `src/shared/constants/ipc.ts` (after `BRD_COMMIT`), `src/shared/types/ipc.ts` (after `brdCommit`), `src/preload/api/agent-api.ts` (mirror the BRD API lines), `src/renderer/lib/browser-mock.ts` (after `brdCommit`), `src/main/ipc-handlers/index.ts` (mirror `registerBrdHandlers`)
- Test: `src/main/ipc-handlers/__tests__/design-handlers.test.ts`

**Interfaces:**
- Produces: channels `DESIGN_LIST 'design:list'`, `DESIGN_READ 'design:read'`, `DESIGN_WRITE 'design:write'`, `DESIGN_CREATE 'design:create'`, `DESIGN_SET_STATUS 'design:setStatus'`, `DESIGN_DRAFT 'design:draft'`, `DESIGN_DRAFT_CANCEL 'design:draft-cancel'`, `DESIGN_DRAFT_CHUNK 'design:draft-chunk'`, `DESIGN_DRAFT_DONE 'design:draft-done'`, `DESIGN_DRAFT_ERROR 'design:draft-error'`. ElectronAPI: `designList(projectId)`, `designRead(projectId, brdSlug, requirementId)`, `designWrite(projectId, brdSlug, requirementId, content)`, `designCreate(projectId, brdSlug, requirementId)`, `designSetStatus(projectId, brdSlug, requirementId, status)`, `designDraft(projectId, request)`, `designDraftCancel(runId)`, `onDesignDraftChunk/Done/Error(cb)`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/src/main/ipc-handlers/__tests__/design-handlers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { handlers, sent, getProject, files, brd, req, runDesignWriter, featureSettings } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  sent: [] as unknown[][],
  getProject: vi.fn(),
  files: { listDesignBriefs: vi.fn(), readDesignBrief: vi.fn(), writeDesignBrief: vi.fn(), createDesignBrief: vi.fn(), setDesignBriefStatus: vi.fn() },
  brd: { readBrd: vi.fn() },
  req: { readRequirements: vi.fn() },
  runDesignWriter: vi.fn(),
  featureSettings: vi.fn(() => ({ model: 'sonnet', thinkingLevel: 'medium' })),
}));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn((c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn)) } }));
vi.mock('../utils', () => ({ safeSendToRenderer: vi.fn((_get: unknown, ...args: unknown[]) => { sent.push(args); return true; }) }));
vi.mock('../../project-store', () => ({ projectStore: { getProject } }));
vi.mock('../../design/design-files', () => files);
vi.mock('../../brd/brd-files', () => brd);
vi.mock('../../brd/requirements-files', () => req);
vi.mock('../../ai/runners/design-writer', () => ({ runDesignWriter }));
vi.mock('../feature-settings-helper', () => ({ getActiveProviderFeatureSettings: featureSettings }));

import { registerDesignHandlers } from '../design-handlers';

const set = {
  requirements: [
    { id: 'R3', title: 'Filter', description: 'd', acceptanceCriteria: ['a'], area: 'List', needsDesign: true, included: true },
    { id: 'R4', title: 'Sort', description: 'd', acceptanceCriteria: [], area: 'List', needsDesign: true, included: true },
  ],
};
const tick = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => {
  handlers.clear();
  sent.length = 0;
  vi.clearAllMocks();
  getProject.mockReturnValue({ id: 'p1', path: '/repo' });
  registerDesignHandlers(() => null);
});

describe('design handlers', () => {
  it('list/read/write/setStatus delegate with the project path', async () => {
    files.listDesignBriefs.mockResolvedValue([{ requirementId: 'R3' }]);
    expect(await handlers.get('design:list')!({}, 'p1')).toEqual({ success: true, data: [{ requirementId: 'R3' }] });
    files.readDesignBrief.mockResolvedValue({ summary: { requirementId: 'R3' }, content: '#' });
    expect(await handlers.get('design:read')!({}, 'p1', 'todo-app', 'R3')).toEqual({ success: true, data: { summary: { requirementId: 'R3' }, content: '#' } });
    files.writeDesignBrief.mockResolvedValue({ requirementId: 'R3' });
    await handlers.get('design:write')!({}, 'p1', 'todo-app', 'R3', 'content');
    expect(files.writeDesignBrief).toHaveBeenCalledWith('/repo', 'todo-app', 'R3', 'content');
    files.setDesignBriefStatus.mockResolvedValue({ status: 'approved' });
    expect(await handlers.get('design:setStatus')!({}, 'p1', 'todo-app', 'R3', 'approved')).toEqual({ success: true, data: { status: 'approved' } });
  });

  it('create looks up the requirement title and refuses unknown ids', async () => {
    req.readRequirements.mockResolvedValue(set);
    files.createDesignBrief.mockResolvedValue({ requirementId: 'R3', title: 'Filter' });
    expect(await handlers.get('design:create')!({}, 'p1', 'todo-app', 'R3')).toEqual({ success: true, data: { requirementId: 'R3', title: 'Filter' } });
    expect(files.createDesignBrief).toHaveBeenCalledWith('/repo', 'todo-app', { id: 'R3', title: 'Filter' });
    expect(await handlers.get('design:create')!({}, 'p1', 'todo-app', 'R9')).toEqual({ success: false, error: 'Requirement R9 not found in todo-app' });
  });

  it('draft loads the BRD, requirement, and existing brief, forwards events, and clears the run', async () => {
    req.readRequirements.mockResolvedValue(set);
    brd.readBrd.mockResolvedValue({ summary: {}, content: '# Todo\nBody' });
    files.readDesignBrief.mockResolvedValue({ summary: {}, content: '# Old' });
    runDesignWriter.mockImplementation(async (_cfg: unknown, onEvent: (e: unknown) => void) => {
      onEvent({ type: 'text-delta', text: 'a' });
      onEvent({ type: 'done', text: 'a' });
    });
    const r = (await handlers.get('design:draft')!({}, 'p1', { brdSlug: 'todo-app', requirementId: 'R3', mode: 'revise', notes: 'n' })) as { data: { runId: string } };
    await tick();
    expect(runDesignWriter.mock.calls[0][0]).toMatchObject({
      projectDir: '/repo', mode: 'revise', notes: 'n', brdSlug: 'todo-app', brdBody: '# Todo\nBody', existing: '# Old',
      requirement: { id: 'R3', title: 'Filter' }, siblingTitles: ['Sort'], modelShorthand: 'sonnet',
    });
    expect(sent).toEqual([
      ['design:draft-chunk', { runId: r.data.runId, text: 'a' }],
      ['design:draft-done', { runId: r.data.runId, text: 'a' }],
    ]);
    // run cleared: a second draft starts
    expect((await handlers.get('design:draft')!({}, 'p1', { brdSlug: 'todo-app', requirementId: 'R3', mode: 'draft', notes: '' })) as object).toMatchObject({ success: true });
  });

  it('draft refuses a second concurrent run and unknown requirements; cancel aborts', async () => {
    req.readRequirements.mockResolvedValue(set);
    brd.readBrd.mockResolvedValue({ summary: {}, content: '#' });
    runDesignWriter.mockImplementation(() => new Promise(() => {}));
    const r = (await handlers.get('design:draft')!({}, 'p1', { brdSlug: 'todo-app', requirementId: 'R3', mode: 'draft', notes: '' })) as { data: { runId: string } };
    expect(await handlers.get('design:draft')!({}, 'p1', { brdSlug: 'todo-app', requirementId: 'R4', mode: 'draft', notes: '' })).toEqual({ success: false, error: 'A draft is already running for this project' });
    expect(await handlers.get('design:draft-cancel')!({}, r.data.runId)).toEqual({ success: true });
    expect(await handlers.get('design:draft-cancel')!({}, 'nope')).toEqual({ success: false, error: 'No running draft with id nope' });
    await tick();
    expect(await handlers.get('design:draft')!({}, 'p1', { brdSlug: 'todo-app', requirementId: 'R9', mode: 'draft', notes: '' })).toEqual({ success: false, error: 'Requirement R9 not found in todo-app' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ipc-handlers/__tests__/design-handlers.test.ts`
Expected: FAIL.

- [ ] **Step 3: Constants, handler, preload, types, mock, registration**

`src/shared/constants/ipc.ts`, after `BRD_COMMIT: 'brd:commit',`:

```ts
  DESIGN_LIST: 'design:list',
  DESIGN_READ: 'design:read',
  DESIGN_WRITE: 'design:write',
  DESIGN_CREATE: 'design:create',
  DESIGN_SET_STATUS: 'design:setStatus',
  DESIGN_DRAFT: 'design:draft',
  DESIGN_DRAFT_CANCEL: 'design:draft-cancel',
  DESIGN_DRAFT_CHUNK: 'design:draft-chunk',
  DESIGN_DRAFT_DONE: 'design:draft-done',
  DESIGN_DRAFT_ERROR: 'design:draft-error',
```

```ts
// apps/desktop/src/main/ipc-handlers/design-handlers.ts
import { randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult, Project } from '../../shared/types';
import type { DesignBriefStatus, DesignBriefSummary, DesignDraftRequest } from '../../shared/types/design';
import type { Requirement } from '../../shared/types/requirements';
import type { ThinkingLevel } from '../ai/config/types';
import { runDesignWriter } from '../ai/runners/design-writer';
import { readBrd } from '../brd/brd-files';
import { readRequirements } from '../brd/requirements-files';
import { createDesignBrief, listDesignBriefs, readDesignBrief, setDesignBriefStatus, writeDesignBrief } from '../design/design-files';
import { projectStore } from '../project-store';
import { getActiveProviderFeatureSettings } from './feature-settings-helper';
import { safeSendToRenderer } from './utils';

interface ActiveRun { runId: string; projectId: string; controller: AbortController }

const activeRuns = new Map<string, ActiveRun>(); // keyed by projectId

async function withProject<T>(projectId: string, fn: (project: Project) => Promise<T>): Promise<IPCResult<T>> {
  const project = projectStore.getProject(projectId);
  if (!project) return { success: false, error: `Project not found: ${projectId}` };
  try {
    return { success: true, data: await fn(project) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/** The named requirement and the titles of its siblings, or throws. */
async function loadRequirement(projectPath: string, brdSlug: string, requirementId: string): Promise<{ requirement: Requirement; siblingTitles: string[] }> {
  const set = await readRequirements(projectPath, brdSlug);
  const requirement = set?.requirements.find((r) => r.id === requirementId);
  if (!set || !requirement) throw new Error(`Requirement ${requirementId} not found in ${brdSlug}`);
  return { requirement, siblingTitles: set.requirements.filter((r) => r.id !== requirementId).map((r) => r.title) };
}

export function registerDesignHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC_CHANNELS.DESIGN_LIST, (_e, projectId: string) => withProject(projectId, (p) => listDesignBriefs(p.path)));
  ipcMain.handle(IPC_CHANNELS.DESIGN_READ, (_e, projectId: string, brdSlug: string, requirementId: string) =>
    withProject(projectId, (p) => readDesignBrief(p.path, brdSlug, requirementId)),
  );
  ipcMain.handle(IPC_CHANNELS.DESIGN_WRITE, (_e, projectId: string, brdSlug: string, requirementId: string, content: string) =>
    withProject<DesignBriefSummary>(projectId, (p) => writeDesignBrief(p.path, brdSlug, requirementId, content)),
  );
  ipcMain.handle(IPC_CHANNELS.DESIGN_CREATE, (_e, projectId: string, brdSlug: string, requirementId: string) =>
    withProject<DesignBriefSummary>(projectId, async (p) => {
      const { requirement } = await loadRequirement(p.path, brdSlug, requirementId);
      return createDesignBrief(p.path, brdSlug, { id: requirement.id, title: requirement.title });
    }),
  );
  ipcMain.handle(IPC_CHANNELS.DESIGN_SET_STATUS, (_e, projectId: string, brdSlug: string, requirementId: string, status: DesignBriefStatus) =>
    withProject<DesignBriefSummary>(projectId, (p) => setDesignBriefStatus(p.path, brdSlug, requirementId, status)),
  );

  ipcMain.handle(IPC_CHANNELS.DESIGN_DRAFT, async (_e, projectId: string, request: DesignDraftRequest): Promise<IPCResult<{ runId: string }>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    if (activeRuns.has(projectId)) return { success: false, error: 'A draft is already running for this project' };

    let requirement: Requirement;
    let siblingTitles: string[];
    let brdBody: string;
    let existing: string | undefined;
    try {
      ({ requirement, siblingTitles } = await loadRequirement(project.path, request.brdSlug, request.requirementId));
      brdBody = (await readBrd(project.path, request.brdSlug)).content;
      if (request.mode === 'revise') existing = (await readDesignBrief(project.path, request.brdSlug, request.requirementId)).content;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }

    const runId = randomUUID();
    const controller = new AbortController();
    activeRuns.set(projectId, { runId, projectId, controller });
    const { model, thinkingLevel } = getActiveProviderFeatureSettings('roadmap');

    // Defer past the invoke reply so the renderer knows the runId before any event arrives.
    setTimeout(() => {
      if (controller.signal.aborted) {
        activeRuns.delete(projectId);
        safeSendToRenderer(getMainWindow, IPC_CHANNELS.DESIGN_DRAFT_ERROR, { runId, error: 'cancelled' });
        return;
      }
      void runDesignWriter(
        {
          projectDir: project.path,
          mode: request.mode,
          notes: request.notes,
          brdSlug: request.brdSlug,
          requirement: {
            id: requirement.id,
            title: requirement.title,
            description: requirement.description,
            acceptanceCriteria: requirement.acceptanceCriteria,
            area: requirement.area,
          },
          siblingTitles,
          brdBody,
          existing,
          modelShorthand: model,
          thinkingLevel: thinkingLevel as ThinkingLevel,
          abortSignal: controller.signal,
        },
        (event) => {
          if (event.type === 'text-delta') {
            safeSendToRenderer(getMainWindow, IPC_CHANNELS.DESIGN_DRAFT_CHUNK, { runId, text: event.text });
            return;
          }
          if (activeRuns.get(projectId)?.runId === runId) activeRuns.delete(projectId);
          if (event.type === 'done') safeSendToRenderer(getMainWindow, IPC_CHANNELS.DESIGN_DRAFT_DONE, { runId, text: event.text });
          else safeSendToRenderer(getMainWindow, IPC_CHANNELS.DESIGN_DRAFT_ERROR, { runId, error: event.error });
        },
      );
    }, 0);

    return { success: true, data: { runId } };
  });

  ipcMain.handle(IPC_CHANNELS.DESIGN_DRAFT_CANCEL, (_e, runId: string): IPCResult => {
    const run = [...activeRuns.values()].find((r) => r.runId === runId);
    if (!run) return { success: false, error: `No running draft with id ${runId}` };
    run.controller.abort();
    activeRuns.delete(run.projectId);
    return { success: true };
  });
}
```

```ts
// apps/desktop/src/preload/api/modules/design-api.ts
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import type { DesignBriefStatus, DesignBriefSummary, DesignDraftChunk, DesignDraftDone, DesignDraftError, DesignDraftRequest } from '../../../shared/types/design';
import { createIpcListener, invokeIpc, type IpcListenerCleanup } from './ipc-utils';

export interface DesignAPI {
  designList: (projectId: string) => Promise<IPCResult<DesignBriefSummary[]>>;
  designRead: (projectId: string, brdSlug: string, requirementId: string) => Promise<IPCResult<{ summary: DesignBriefSummary; content: string }>>;
  designWrite: (projectId: string, brdSlug: string, requirementId: string, content: string) => Promise<IPCResult<DesignBriefSummary>>;
  designCreate: (projectId: string, brdSlug: string, requirementId: string) => Promise<IPCResult<DesignBriefSummary>>;
  designSetStatus: (projectId: string, brdSlug: string, requirementId: string, status: DesignBriefStatus) => Promise<IPCResult<DesignBriefSummary>>;
  designDraft: (projectId: string, request: DesignDraftRequest) => Promise<IPCResult<{ runId: string }>>;
  designDraftCancel: (runId: string) => Promise<IPCResult>;
  onDesignDraftChunk: (callback: (chunk: DesignDraftChunk) => void) => IpcListenerCleanup;
  onDesignDraftDone: (callback: (done: DesignDraftDone) => void) => IpcListenerCleanup;
  onDesignDraftError: (callback: (error: DesignDraftError) => void) => IpcListenerCleanup;
}

export const createDesignAPI = (): DesignAPI => ({
  designList: (projectId) => invokeIpc(IPC_CHANNELS.DESIGN_LIST, projectId),
  designRead: (projectId, brdSlug, requirementId) => invokeIpc(IPC_CHANNELS.DESIGN_READ, projectId, brdSlug, requirementId),
  designWrite: (projectId, brdSlug, requirementId, content) => invokeIpc(IPC_CHANNELS.DESIGN_WRITE, projectId, brdSlug, requirementId, content),
  designCreate: (projectId, brdSlug, requirementId) => invokeIpc(IPC_CHANNELS.DESIGN_CREATE, projectId, brdSlug, requirementId),
  designSetStatus: (projectId, brdSlug, requirementId, status) => invokeIpc(IPC_CHANNELS.DESIGN_SET_STATUS, projectId, brdSlug, requirementId, status),
  designDraft: (projectId, request) => invokeIpc(IPC_CHANNELS.DESIGN_DRAFT, projectId, request),
  designDraftCancel: (runId) => invokeIpc(IPC_CHANNELS.DESIGN_DRAFT_CANCEL, runId),
  onDesignDraftChunk: (callback) => createIpcListener<[DesignDraftChunk]>(IPC_CHANNELS.DESIGN_DRAFT_CHUNK, callback),
  onDesignDraftDone: (callback) => createIpcListener<[DesignDraftDone]>(IPC_CHANNELS.DESIGN_DRAFT_DONE, callback),
  onDesignDraftError: (callback) => createIpcListener<[DesignDraftError]>(IPC_CHANNELS.DESIGN_DRAFT_ERROR, callback),
});
```

- `agent-api.ts`: mirror the `createBrdAPI`/`BrdAPI` lines with `createDesignAPI`/`DesignAPI` (import, type union member, `const designAPI = createDesignAPI();`, `...designAPI,`, type re-export).
- `src/shared/types/ipc.ts`: import the design types from `./design` and add the ten `DesignAPI` signatures after `brdCommit`.
- `browser-mock.ts` after `brdCommit`: `designList: async () => ({ success: true, data: [] })`, `designRead/designWrite/designCreate/designSetStatus/designDraft/designDraftCancel: async () => ({ success: false, error: 'Not available in browser mock' })`, `onDesignDraftChunk/Done/Error: () => () => {}`.
- `ipc-handlers/index.ts`: import `registerDesignHandlers` from `'./design-handlers'`, call `registerDesignHandlers(getMainWindow)` right after the BRD registration (same argument), and export it.

- [ ] **Step 4: Run tests, lint, typecheck, commit**

Run: `npx vitest run src/main/ipc-handlers/__tests__/design-handlers.test.ts src/preload && npx biome check src/main/ipc-handlers/design-handlers.ts src/preload/api/modules/design-api.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

```bash
git add src/main/ipc-handlers/design-handlers.ts src/main/ipc-handlers/__tests__/design-handlers.test.ts src/main/ipc-handlers/index.ts src/preload src/shared/constants/ipc.ts src/shared/types/ipc.ts src/renderer/lib/browser-mock.ts
git commit -m "feat(design): brief handlers with streaming draft, preload API, and mock"
```

---

### Task 4: Prompt injection of approved briefs

**Files:**
- Create: `src/main/ai/agent/design-prompt.ts`
- Modify: `src/main/ai/prompts/types.ts` (`PromptContext`), `src/main/ai/prompts/prompt-loader.ts` (`injectContext`, after the skills section), `src/main/ai/agent/worker.ts` (`assemblePrompt`)
- Test: `src/main/ai/agent/__tests__/design-prompt.test.ts`, extend `src/main/ai/prompts/__tests__/prompt-loader.test.ts` if it exists (else the design-prompt test covers rendering)

**Interfaces:**
- Consumes: `approvedBriefs` (Task 1).
- Produces: `DESIGN_AGENT_TYPES`, `DESIGN_SECTION_CAP`, `renderDesignSection(briefs, cap)`, `buildDesignSectionForAgent(projectDir, specDir, agentType)`; `PromptContext.designSection?: string`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/src/main/ai/agent/__tests__/design-prompt.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const { approvedBriefs } = vi.hoisted(() => ({ approvedBriefs: vi.fn() }));
vi.mock('../../../design/design-files', () => ({ approvedBriefs }));

import { DESIGN_SECTION_CAP, buildDesignSectionForAgent, renderDesignSection } from '../design-prompt';

let specDir: string;
beforeEach(() => {
  vi.clearAllMocks();
  specDir = mkdtempSync(path.join(tmpdir(), 'spec-'));
});

const meta = (m: object) => writeFileSync(path.join(specDir, 'task_metadata.json'), JSON.stringify(m));

describe('buildDesignSectionForAgent', () => {
  it('returns empty without metadata, without requirement links, or for other agent types', async () => {
    expect(await buildDesignSectionForAgent('/p', specDir, 'coder')).toBe('');
    meta({ brdSlug: 'todo-app' });
    expect(await buildDesignSectionForAgent('/p', specDir, 'coder')).toBe('');
    meta({ brdSlug: 'todo-app', requirementIds: ['R3'] });
    expect(await buildDesignSectionForAgent('/p', specDir, 'complexity_assessor')).toBe('');
    expect(approvedBriefs).not.toHaveBeenCalled();
    rmSync(specDir, { recursive: true, force: true });
  });

  it('renders approved briefs for build agents and swallows read errors', async () => {
    meta({ brdSlug: 'todo-app', requirementIds: ['R3', 'R4'] });
    approvedBriefs.mockResolvedValue([{ requirementId: 'R3', title: 'Filter todos', body: '# Filter todos\n\n## Summary\nText\n' }]);
    const section = await buildDesignSectionForAgent('/p', specDir, 'planner');
    expect(approvedBriefs).toHaveBeenCalledWith('/p', 'todo-app', ['R3', 'R4']);
    expect(section).toContain('# Approved design briefs');
    expect(section).toContain('## R3: Filter todos\n# Filter todos\n\n## Summary\nText');
    approvedBriefs.mockRejectedValue(new Error('disk'));
    expect(await buildDesignSectionForAgent('/p', specDir, 'coder')).toBe('');
    approvedBriefs.mockResolvedValue([]);
    expect(await buildDesignSectionForAgent('/p', specDir, 'coder')).toBe('');
    rmSync(specDir, { recursive: true, force: true });
  });
});

describe('renderDesignSection', () => {
  it('caps the total size and lists omitted briefs', () => {
    const big = 'x'.repeat(DESIGN_SECTION_CAP);
    const out = renderDesignSection([
      { requirementId: 'R1', title: 'A', body: big },
      { requirementId: 'R2', title: 'B', body: 'small' },
      { requirementId: 'R3', title: 'C', body: 'small' },
    ], DESIGN_SECTION_CAP);
    expect(out).toContain('## R1: A');
    expect(out).not.toContain('## R2: B');
    expect(out).toContain('(2 more briefs omitted: R2, R3)');
    expect(out.length).toBeLessThan(DESIGN_SECTION_CAP + 400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ai/agent/__tests__/design-prompt.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the module and wire it**

```ts
// apps/desktop/src/main/ai/agent/design-prompt.ts
/**
 * Approved design briefs for the requirements a task covers, rendered as a
 * prompt section for the build agents. Read at build time from docs/design.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { approvedBriefs } from '../../design/design-files';

export const DESIGN_AGENT_TYPES: ReadonlySet<string> = new Set(['spec_gatherer', 'spec_researcher', 'spec_writer', 'planner', 'coder', 'qa_reviewer']);
export const DESIGN_SECTION_CAP = 40 * 1024;

const HEADER =
  '# Approved design briefs\n\n' +
  'These briefs were approved by the design team for the requirements this task covers. Follow them for screens, flows, states, components, and copy. Where the code cannot match a brief, say so in your output instead of inventing a different design.\n\n';

interface Brief { requirementId: string; title: string; body: string }

export function renderDesignSection(briefs: Brief[], cap: number = DESIGN_SECTION_CAP): string {
  if (briefs.length === 0) return '';
  let out = HEADER;
  const omitted: string[] = [];
  for (const b of briefs) {
    const block = `## ${b.requirementId}: ${b.title}\n${b.body.trim()}\n\n`;
    if (omitted.length > 0 || out.length + block.length > cap) {
      omitted.push(b.requirementId);
      continue;
    }
    out += block;
  }
  if (omitted.length > 0) out += `(${omitted.length} more briefs omitted: ${omitted.join(', ')})\n\n`;
  return out;
}

function readLinks(specDir: string): { brdSlug: string; requirementIds: string[] } | null {
  const file = join(specDir, 'task_metadata.json');
  if (!existsSync(file)) return null;
  try {
    const meta = JSON.parse(readFileSync(file, 'utf-8')) as { brdSlug?: unknown; requirementIds?: unknown };
    if (typeof meta.brdSlug !== 'string' || !Array.isArray(meta.requirementIds) || meta.requirementIds.length === 0) return null;
    return { brdSlug: meta.brdSlug, requirementIds: meta.requirementIds.filter((id): id is string => typeof id === 'string') };
  } catch {
    return null;
  }
}

/** Section text, or '' when the agent type, task links, or briefs do not apply. Never throws. */
export async function buildDesignSectionForAgent(projectDir: string, specDir: string, agentType: string): Promise<string> {
  if (!DESIGN_AGENT_TYPES.has(agentType)) return '';
  const links = readLinks(specDir);
  if (!links) return '';
  try {
    return renderDesignSection(await approvedBriefs(projectDir, links.brdSlug, links.requirementIds));
  } catch {
    return '';
  }
}
```

`src/main/ai/prompts/types.ts`, after `skillsSection?: string;`:

```ts
  /** Pre-built `# Approved design briefs` section (see ai/agent/design-prompt.ts). Empty/undefined = omit. */
  designSection?: string;
```

`prompt-loader.ts` `injectContext`, after the skills block:

```ts
  // 4c. Approved design briefs for the requirements this task covers
  if (context.designSection) {
    sections.push(context.designSection);
  }
```

`worker.ts` `assemblePrompt`: import `buildDesignSectionForAgent` from `'./design-prompt'`; after the skills `postLog`, add

```ts
  const designSection = await buildDesignSectionForAgent(session.projectDir, session.specDir, effectiveAgentType);
  if (designSection) {
    postLog(`Design briefs injected for ${effectiveAgentType} (${(designSection.length / 1024).toFixed(1)}KB)`);
  }
```

and pass `designSection,` in the `injectContext` call.

- [ ] **Step 4: Run tests, lint, typecheck, commit**

Run: `npx vitest run src/main/ai/agent src/main/ai/prompts && npx biome check src/main/ai/agent/design-prompt.ts src/main/ai/prompts/prompt-loader.ts src/main/ai/prompts/types.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

```bash
git add src/main/ai/agent/design-prompt.ts src/main/ai/agent/__tests__/design-prompt.test.ts src/main/ai/prompts/types.ts src/main/ai/prompts/prompt-loader.ts src/main/ai/agent/worker.ts
git commit -m "feat(design): inject approved design briefs into build agent prompts"
```

---

### Task 5: Release warning and commit pathspec

**Files:**
- Create: `src/shared/design/release.ts`
- Modify: `src/main/ipc-handlers/requirements-handlers.ts` (release handler, after the Jira block), `src/main/brd/brd-git.ts` (pathspecs), `src/renderer/components/requirements/BrdCommitDialog.tsx` (`defaultCommitMessage`)
- Test: `src/shared/design/__tests__/release.test.ts`, extend `src/main/ipc-handlers/__tests__/requirements-handlers.test.ts`, `src/main/brd/__tests__/brd-git.test.ts`, `src/renderer/components/requirements/__tests__/BrdCommitDialog.test.tsx`

**Interfaces:**
- Produces: `needsDesignWithoutApprovedBrief(set, milestoneId, briefs): string[]` (requirement ids, in set order).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/desktop/src/shared/design/__tests__/release.test.ts
import { describe, it, expect } from 'vitest';
import { needsDesignWithoutApprovedBrief } from '../release';
import type { RequirementsSet } from '../../types/requirements';

const set = {
  brdSlug: 'todo-app',
  requirements: [
    { id: 'R1', needsDesign: true, included: true }, { id: 'R2', needsDesign: false, included: true },
    { id: 'R3', needsDesign: true, included: true }, { id: 'R4', needsDesign: true, included: true },
  ],
  milestones: [], tasks: [
    { id: 'T1', milestoneId: 'M1', requirementIds: ['R1', 'R2'], included: true },
    { id: 'T2', milestoneId: 'M1', requirementIds: ['R3'], included: false },
    { id: 'T3', milestoneId: 'M2', requirementIds: ['R4'], included: true },
  ],
} as unknown as RequirementsSet;

describe('needsDesignWithoutApprovedBrief', () => {
  it('lists needsDesign requirements of the milestone that lack an approved brief', () => {
    const briefs = [
      { brdSlug: 'todo-app', requirementId: 'R1', status: 'draft' as const, title: '', modifiedAt: '' },
      { brdSlug: 'other', requirementId: 'R4', status: 'approved' as const, title: '', modifiedAt: '' },
    ];
    expect(needsDesignWithoutApprovedBrief(set, 'M1', briefs)).toEqual(['R1']);
    expect(needsDesignWithoutApprovedBrief(set, 'M2', briefs)).toEqual(['R4']);
    expect(needsDesignWithoutApprovedBrief(set, 'M2', [{ ...briefs[1], brdSlug: 'todo-app' }])).toEqual([]);
  });
});
```

Append to `requirements-handlers.test.ts`: in the hoisted block add `designFiles: { listDesignBriefs: vi.fn(async () => [] as unknown[]) }` and `vi.mock('../../design/design-files', () => designFiles);` and the test (reuse the fixtures the "release pushes to Jira" test uses; the released milestone must contain a `needsDesign` requirement without a brief):

```ts
  it('release warns about needsDesign requirements without an approved brief', async () => {
    // Arrange the same approved set as the release tests, with R1 needsDesign: true
    designFiles.listDesignBriefs.mockResolvedValueOnce([{ brdSlug: 'a', requirementId: 'R1', status: 'draft', title: '', modifiedAt: '' }]);
    const r = (await handlers.get('requirements:release')!({}, 'p1', 'a', 'M1')) as { success: boolean; data: { warnings: string[] } };
    expect(r.success).toBe(true);
    expect(r.data.warnings).toContain('No approved design brief for R1');
  });
```

Extend `brd-git.test.ts` expectations: `calls()[2]` becomes `'status --porcelain -- docs/brd docs/design'`, and the commit test expects `'add -A -- docs/brd docs/design'` and `'commit -m docs(brd): update a -- docs/brd docs/design'`.

Extend `BrdCommitDialog.test.tsx` `defaultCommitMessage` test:

```ts
    expect(defaultCommitMessage([{ path: 'docs/design/todo-app/R3.md', status: 'modified' }])).toBe('docs(design): update todo-app/R3');
    expect(defaultCommitMessage([{ path: 'docs/design/todo-app/R3.md', status: 'untracked' }, { path: 'docs/brd/todo-app.md', status: 'modified' }])).toBe('docs: update todo-app, todo-app/R3');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/design src/main/ipc-handlers/__tests__/requirements-handlers.test.ts src/main/brd src/renderer/components/requirements/__tests__/BrdCommitDialog.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/desktop/src/shared/design/release.ts
import type { DesignBriefSummary } from '../types/design';
import type { RequirementsSet } from '../types/requirements';

/** Ids of needsDesign requirements covered by the milestone's included tasks that have no approved brief, in set order. */
export function needsDesignWithoutApprovedBrief(set: RequirementsSet, milestoneId: string, briefs: DesignBriefSummary[]): string[] {
  const covered = new Set(set.tasks.filter((t) => t.milestoneId === milestoneId && t.included).flatMap((t) => t.requirementIds));
  const approved = new Set(briefs.filter((b) => b.brdSlug === set.brdSlug && b.status === 'approved').map((b) => b.requirementId));
  return set.requirements.filter((r) => r.needsDesign && covered.has(r.id) && !approved.has(r.id)).map((r) => r.id);
}
```

Release handler: import `needsDesignWithoutApprovedBrief` from `'../../shared/design/release'` and `listDesignBriefs` from `'../design/design-files'`; after the Jira block and before the return:

```ts
        if (created.length > 0) {
          try {
            const missing = needsDesignWithoutApprovedBrief(current, milestoneId, await listDesignBriefs(project.path));
            if (missing.length > 0) warnings.push(`No approved design brief for ${missing.join(', ')}`);
          } catch {
            // Design briefs are advisory; a read failure must not fail the release
          }
        }
```

`brd-git.ts`: `const BRD_PATHSPECS = ['docs/brd', 'docs/design'];` and use `...BRD_PATHSPECS` in the three git calls (status, add, commit).

`BrdCommitDialog.tsx` `defaultCommitMessage`:

```ts
function slugOf(path: string): string {
  const file = path.split('/').pop()?.replace(/\.requirements\.json$/, '').replace(/\.md$/, '') ?? path;
  if (path.startsWith('docs/design/')) {
    const brd = path.split('/')[2];
    return brd ? `${brd}/${file}` : file;
  }
  return file;
}

export function defaultCommitMessage(files: BrdChangedFile[]): string {
  const slugs = Array.from(new Set(files.map((f) => slugOf(f.path)))).sort();
  const allNew = files.length > 0 && files.every((f) => f.status === 'untracked' || f.status === 'added');
  const kinds = new Set(files.map((f) => (f.path.startsWith('docs/design/') ? 'design' : 'brd')));
  const scope = kinds.size === 1 ? `docs(${[...kinds][0]})` : 'docs';
  return `${scope}: ${allNew ? 'add' : 'update'} ${slugs.join(', ')}`;
}
```

- [ ] **Step 4: Run tests, lint, typecheck, commit**

Run: `npx vitest run src/shared/design src/main/ipc-handlers/__tests__/requirements-handlers.test.ts src/main/brd src/renderer/components/requirements && npx biome check src/shared/design src/main/brd/brd-git.ts src/renderer/components/requirements/BrdCommitDialog.tsx && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

```bash
git add src/shared/design src/main/ipc-handlers/requirements-handlers.ts src/main/ipc-handlers/__tests__/requirements-handlers.test.ts src/main/brd src/renderer/components/requirements/BrdCommitDialog.tsx src/renderer/components/requirements/__tests__/BrdCommitDialog.test.tsx
git commit -m "feat(design): release warning for unapproved briefs and design files in BRD commits"
```

---

### Task 6: i18n, design store, and navigation context

**Files:**
- Create: `src/shared/i18n/locales/en/design.json`, `src/shared/i18n/locales/fr/design.json`, `src/renderer/stores/design-store.ts`, `src/renderer/contexts/DesignNavigationContext.tsx`
- Modify: `src/shared/i18n/index.ts`, `src/shared/i18n/locales/{en,fr}/navigation.json` (`items.design`), `src/shared/i18n/locales/{en,fr}/requirements.json` (`set.designChip`), `src/shared/i18n/locales/{en,fr}/tasks.json` (`requirementsSection.design`)
- Test: `src/renderer/stores/__tests__/design-store.test.ts`

**Interfaces:**
- Produces: `useDesignStore` with the state and actions listed in spec 4.2; `setupDesignListeners()`; `DesignNavigationProvider`, `useDesignNavigation(): ((brdSlug, requirementId) => void) | null`; `briefStatus(briefs, brdSlug, requirementId): 'none' | 'draft' | 'approved'`.

- [ ] **Step 1: i18n files**

`en/design.json`:

```json
{
  "view": { "title": "Design", "subtitle": "Design briefs for requirements that need design" },
  "list": { "empty": "No requirements need design yet.", "noSets": "Generate requirements for a BRD first." },
  "status": { "none": "No brief", "draft": "Draft", "approved": "Approved" },
  "empty": {
    "title": "No brief for {{id}} yet",
    "acceptance": "Acceptance criteria",
    "notes": "Notes for the designer agent",
    "notesPlaceholder": "Constraints, references, and anything the brief must respect.",
    "createFromTemplate": "Create from template",
    "draftWithAi": "Draft with AI"
  },
  "editor": {
    "save": "Save", "saving": "Saving…", "saved": "Saved", "unsaved": "Unsaved changes",
    "approve": "Approve", "unapprove": "Unapprove", "markdown": "Markdown", "preview": "Preview",
    "loadError": "Could not load this brief: {{error}}", "saveError": "Could not save: {{error}}",
    "requirement": "Requirement"
  },
  "assist": {
    "title": "AI assist", "notesLabel": "Instructions", "notesPlaceholder": "Describe what to change, for example: add a mobile layout for the list.",
    "revise": "Revise with instructions", "streaming": "Writing…", "cancel": "Cancel",
    "proposalTitle": "Proposed brief", "accept": "Accept into editor", "discard": "Discard", "error": "The assistant failed: {{error}}"
  },
  "structure": { "title": "Structure", "ok": "All required sections are filled", "missing": "Missing", "emptySection": "Empty", "optional": "optional", "frontmatter": "Frontmatter" },
  "unsavedDialog": { "title": "Discard unsaved changes?", "description": "You have unsaved changes in the current brief. Switching will discard them.", "discard": "Discard changes", "cancel": "Keep editing" }
}
```

`fr/design.json`:

```json
{
  "view": { "title": "Design", "subtitle": "Briefs de design pour les exigences qui en ont besoin" },
  "list": { "empty": "Aucune exigence ne nécessite de design pour l'instant.", "noSets": "Générez d'abord les exigences d'un BRD." },
  "status": { "none": "Pas de brief", "draft": "Brouillon", "approved": "Approuvé" },
  "empty": {
    "title": "Pas encore de brief pour {{id}}",
    "acceptance": "Critères d'acceptation",
    "notes": "Notes pour l'agent designer",
    "notesPlaceholder": "Contraintes, références et tout ce que le brief doit respecter.",
    "createFromTemplate": "Créer depuis le modèle",
    "draftWithAi": "Rédiger avec l'IA"
  },
  "editor": {
    "save": "Enregistrer", "saving": "Enregistrement…", "saved": "Enregistré", "unsaved": "Modifications non enregistrées",
    "approve": "Approuver", "unapprove": "Retirer l'approbation", "markdown": "Markdown", "preview": "Aperçu",
    "loadError": "Impossible de charger ce brief : {{error}}", "saveError": "Impossible d'enregistrer : {{error}}",
    "requirement": "Exigence"
  },
  "assist": {
    "title": "Assistant IA", "notesLabel": "Instructions", "notesPlaceholder": "Décrivez ce qu'il faut changer, par exemple : ajouter une mise en page mobile pour la liste.",
    "revise": "Réviser selon les instructions", "streaming": "Rédaction…", "cancel": "Annuler",
    "proposalTitle": "Brief proposé", "accept": "Accepter dans l'éditeur", "discard": "Rejeter", "error": "L'assistant a échoué : {{error}}"
  },
  "structure": { "title": "Structure", "ok": "Toutes les sections requises sont remplies", "missing": "Manquante", "emptySection": "Vide", "optional": "optionnelle", "frontmatter": "Frontmatter" },
  "unsavedDialog": { "title": "Abandonner les modifications ?", "description": "Le brief en cours a des modifications non enregistrées. Changer de brief les perdra.", "discard": "Abandonner", "cancel": "Continuer l'édition" }
}
```

`src/shared/i18n/index.ts`: import `enDesign`/`frDesign`, add `design: enDesign` / `design: frDesign`, add `'design'` to `ns`. `navigation.json`: `"design": "Design"` (fr: `"Design"`) after `"requirements"`. `requirements.json` `set`: `"designChip": "Design"` (fr `"Design"`). `tasks.json` `requirementsSection`: `"design": "Design"` (fr `"Design"`).

- [ ] **Step 2: Write the failing store test**

```ts
// apps/desktop/src/renderer/stores/__tests__/design-store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { briefStatus, setupDesignListeners, useDesignStore } from '../design-store';

const api = {
  brdList: vi.fn(), requirementsRead: vi.fn(), designList: vi.fn(), designRead: vi.fn(), designWrite: vi.fn(),
  designCreate: vi.fn(), designSetStatus: vi.fn(), designDraft: vi.fn(), designDraftCancel: vi.fn(),
  onDesignDraftChunk: vi.fn(), onDesignDraftDone: vi.fn(), onDesignDraftError: vi.fn(), brdChanges: vi.fn().mockResolvedValue({ success: false }),
};
type Listener<T> = (p: T) => void;
let chunkCb: Listener<{ runId: string; text: string }> = () => {};
let doneCb: Listener<{ runId: string; text: string }> = () => {};

const summary = { brdSlug: 'a', requirementId: 'R1', title: 'One', status: 'draft' as const, modifiedAt: 't' };
const doc = '---\nbrd: a\nrequirement: R1\ntitle: One\nstatus: draft\nupdated: 2026-09-21\n---\n# One\n\n## Summary\nText\n';
const set = { requirements: [{ id: 'R1', title: 'One', needsDesign: true }, { id: 'R2', title: 'Two', needsDesign: false }] };

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { window: unknown }).window = { electronAPI: api };
  api.onDesignDraftChunk.mockImplementation((cb) => { chunkCb = cb; return () => {}; });
  api.onDesignDraftDone.mockImplementation((cb) => { doneCb = cb; return () => {}; });
  api.onDesignDraftError.mockImplementation(() => () => {});
  useDesignStore.getState().reset();
});

describe('design-store', () => {
  it('load collects needsDesign requirements per BRD with a set, and the briefs', async () => {
    api.brdList.mockResolvedValue({ success: true, data: [{ slug: 'a', title: 'A' }, { slug: 'b', title: 'B' }] });
    api.requirementsRead.mockImplementation(async (_p: string, slug: string) => ({ success: true, data: { set: slug === 'a' ? set : null } }));
    api.designList.mockResolvedValue({ success: true, data: [summary] });
    await useDesignStore.getState().load('p1');
    const s = useDesignStore.getState();
    expect(Object.keys(s.requirementsBySlug)).toEqual(['a']);
    expect(s.requirementsBySlug.a.requirements.map((r) => r.id)).toEqual(['R1']);
    expect(s.briefs).toEqual([summary]);
    expect(briefStatus(s.briefs, 'a', 'R1')).toBe('draft');
    expect(briefStatus(s.briefs, 'a', 'R9')).toBe('none');
  });

  it('select reads the brief, refuses while dirty, and save writes', async () => {
    api.designRead.mockResolvedValue({ success: true, data: { summary, content: doc } });
    expect(await useDesignStore.getState().select('p1', 'a', 'R1')).toBe(true);
    expect(useDesignStore.getState().structure?.ok).toBe(false);
    useDesignStore.getState().setContent(`${doc}x`);
    expect(await useDesignStore.getState().select('p1', 'a', 'R1')).toBe(false);
    api.designWrite.mockResolvedValue({ success: true, data: { ...summary, title: 'One' } });
    await useDesignStore.getState().save('p1');
    expect(api.designWrite).toHaveBeenCalledWith('p1', 'a', 'R1', `${doc}x`);
    expect(useDesignStore.getState().isDirty()).toBe(false);
  });

  it('select with no brief keeps the selection and empty content', async () => {
    api.designRead.mockResolvedValue({ success: false, error: 'Design brief not found: a/R1' });
    expect(await useDesignStore.getState().select('p1', 'a', 'R1')).toBe(true);
    expect(useDesignStore.getState().selected).toEqual({ brdSlug: 'a', requirementId: 'R1' });
    expect(useDesignStore.getState().selectedSummary).toBeNull();
  });

  it('setStatus updates the brief list and the selected summary', async () => {
    useDesignStore.setState({ briefs: [summary], selected: { brdSlug: 'a', requirementId: 'R1' }, selectedSummary: summary });
    api.designSetStatus.mockResolvedValue({ success: true, data: { ...summary, status: 'approved' } });
    await useDesignStore.getState().setStatus('p1', 'approved');
    expect(useDesignStore.getState().briefs[0].status).toBe('approved');
    expect(useDesignStore.getState().selectedSummary?.status).toBe('approved');
  });

  it('draft streams into a proposal; accept creates the file when none exists', async () => {
    setupDesignListeners();
    useDesignStore.setState({ selected: { brdSlug: 'a', requirementId: 'R1' }, selectedSummary: null });
    api.designDraft.mockResolvedValue({ success: true, data: { runId: 'run1' } });
    await useDesignStore.getState().startDraft('p1', 'draft', 'notes');
    expect(api.designDraft).toHaveBeenCalledWith('p1', { brdSlug: 'a', requirementId: 'R1', mode: 'draft', notes: 'notes' });
    chunkCb({ runId: 'run1', text: 'he' });
    chunkCb({ runId: 'other', text: 'zzz' });
    doneCb({ runId: 'run1', text: 'hello' });
    expect(useDesignStore.getState().draft).toEqual({ status: 'proposal', runId: 'run1', text: 'hello' });
    api.designWrite.mockResolvedValue({ success: true, data: summary });
    await useDesignStore.getState().acceptDraft('p1');
    expect(api.designWrite).toHaveBeenCalledWith('p1', 'a', 'R1', 'hello');
    expect(useDesignStore.getState().selectedSummary).toEqual(summary);
    expect(useDesignStore.getState().briefs).toEqual([summary]);
    expect(useDesignStore.getState().savedContent).toBe('hello');
  });

  it('accept on an existing brief only replaces the editor content', async () => {
    useDesignStore.setState({ selected: { brdSlug: 'a', requirementId: 'R1' }, selectedSummary: summary, content: doc, savedContent: doc, draft: { status: 'proposal', runId: 'r', text: 'new' } });
    await useDesignStore.getState().acceptDraft('p1');
    expect(api.designWrite).not.toHaveBeenCalled();
    expect(useDesignStore.getState().content).toBe('new');
    expect(useDesignStore.getState().isDirty()).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/renderer/stores/__tests__/design-store.test.ts`
Expected: FAIL.

- [ ] **Step 4: Write the store and the navigation context**

```ts
// apps/desktop/src/renderer/stores/design-store.ts
import { create } from 'zustand';

import { checkDesignStructure } from '../../shared/design/structure';
import type { BrdStructureResult } from '../../shared/types/brd';
import type { DesignBriefStatus, DesignBriefSummary, DesignDraftMode } from '../../shared/types/design';
import type { Requirement } from '../../shared/types/requirements';
import { useBrdStore } from './brd-store';

export type DesignDraftStatus = 'idle' | 'streaming' | 'proposal';
interface DraftState { status: DesignDraftStatus; runId?: string; text: string; error?: string }
export interface BriefSelection { brdSlug: string; requirementId: string }
export type BriefStatusLabel = 'none' | DesignBriefStatus;

interface DesignState {
  briefs: DesignBriefSummary[];
  requirementsBySlug: Record<string, { title: string; requirements: Requirement[] }>;
  selected: BriefSelection | null;
  /** Null when the selected requirement has no brief file yet. */
  selectedSummary: DesignBriefSummary | null;
  content: string;
  savedContent: string;
  structure: BrdStructureResult | null;
  draft: DraftState;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  pendingOpen: BriefSelection | null;

  isDirty: () => boolean;
  reset: () => void;
  requestOpen: (brdSlug: string, requirementId: string) => void;
  load: (projectId: string) => Promise<void>;
  select: (projectId: string, brdSlug: string, requirementId: string, opts?: { force?: boolean }) => Promise<boolean>;
  setContent: (content: string) => void;
  save: (projectId: string) => Promise<void>;
  create: (projectId: string) => Promise<void>;
  setStatus: (projectId: string, status: DesignBriefStatus) => Promise<void>;
  startDraft: (projectId: string, mode: DesignDraftMode, notes: string) => Promise<void>;
  cancelDraft: () => Promise<void>;
  acceptDraft: (projectId: string) => Promise<void>;
  discardDraft: () => void;
}

const idleDraft: DraftState = { status: 'idle', text: '' };

const initial = {
  briefs: [] as DesignBriefSummary[],
  requirementsBySlug: {} as Record<string, { title: string; requirements: Requirement[] }>,
  selected: null as BriefSelection | null,
  selectedSummary: null as DesignBriefSummary | null,
  content: '',
  savedContent: '',
  structure: null as BrdStructureResult | null,
  draft: idleDraft,
  isLoading: false,
  isSaving: false,
  error: null as string | null,
  pendingOpen: null as BriefSelection | null,
};

export function briefStatus(briefs: DesignBriefSummary[], brdSlug: string, requirementId: string): BriefStatusLabel {
  return briefs.find((b) => b.brdSlug === brdSlug && b.requirementId === requirementId)?.status ?? 'none';
}

function upsert(briefs: DesignBriefSummary[], summary: DesignBriefSummary): DesignBriefSummary[] {
  const i = briefs.findIndex((b) => b.brdSlug === summary.brdSlug && b.requirementId === summary.requirementId);
  return i === -1 ? [...briefs, summary] : briefs.map((b, j) => (j === i ? summary : b));
}

export const useDesignStore = create<DesignState>((set, get) => ({
  ...initial,

  isDirty: () => get().content !== get().savedContent,
  reset: () => set((s) => ({ ...initial, draft: { ...idleDraft }, pendingOpen: s.pendingOpen })),
  requestOpen: (brdSlug, requirementId) => set({ pendingOpen: { brdSlug, requirementId } }),

  load: async (projectId) => {
    set({ isLoading: true, error: null });
    const [brds, briefs] = await Promise.all([window.electronAPI.brdList(projectId), window.electronAPI.designList(projectId)]);
    if (!brds.success || !brds.data) {
      set({ error: brds.error ?? 'Unknown error', isLoading: false });
      return;
    }
    const requirementsBySlug: DesignState['requirementsBySlug'] = {};
    for (const brd of brds.data) {
      const read = await window.electronAPI.requirementsRead(projectId, brd.slug);
      const requirements = read.success && read.data?.set ? read.data.set.requirements.filter((r) => r.needsDesign) : null;
      if (requirements) requirementsBySlug[brd.slug] = { title: brd.title, requirements };
    }
    set({ requirementsBySlug, briefs: briefs.success && briefs.data ? briefs.data : [], isLoading: false });
  },

  select: async (projectId, brdSlug, requirementId, opts) => {
    if (get().isDirty() && !opts?.force) return false;
    set({ isLoading: true, error: null, draft: { ...idleDraft } });
    const result = await window.electronAPI.designRead(projectId, brdSlug, requirementId);
    if (!result.success || !result.data) {
      set({ selected: { brdSlug, requirementId }, selectedSummary: null, content: '', savedContent: '', structure: null, isLoading: false });
      return true;
    }
    set({
      selected: { brdSlug, requirementId },
      selectedSummary: result.data.summary,
      content: result.data.content,
      savedContent: result.data.content,
      structure: checkDesignStructure(result.data.content),
      isLoading: false,
    });
    return true;
  },

  setContent: (content) => set({ content, structure: checkDesignStructure(content) }),

  save: async (projectId) => {
    const { selected, content } = get();
    if (!selected) return;
    set({ isSaving: true, error: null });
    const result = await window.electronAPI.designWrite(projectId, selected.brdSlug, selected.requirementId, content);
    if (!result.success || !result.data) {
      set({ error: result.error ?? 'Unknown error', isSaving: false });
      return;
    }
    set((s) => ({ savedContent: content, selectedSummary: result.data ?? null, briefs: upsert(s.briefs, result.data as DesignBriefSummary), isSaving: false }));
    void useBrdStore.getState().refreshChanges(projectId);
  },

  create: async (projectId) => {
    const { selected } = get();
    if (!selected) return;
    set({ error: null });
    const result = await window.electronAPI.designCreate(projectId, selected.brdSlug, selected.requirementId);
    if (!result.success || !result.data) {
      set({ error: result.error ?? 'Unknown error' });
      return;
    }
    set((s) => ({ briefs: upsert(s.briefs, result.data as DesignBriefSummary) }));
    await get().select(projectId, selected.brdSlug, selected.requirementId, { force: true });
    void useBrdStore.getState().refreshChanges(projectId);
  },

  setStatus: async (projectId, status) => {
    const { selected } = get();
    if (!selected) return;
    set({ error: null });
    const result = await window.electronAPI.designSetStatus(projectId, selected.brdSlug, selected.requirementId, status);
    if (!result.success || !result.data) {
      set({ error: result.error ?? 'Unknown error' });
      return;
    }
    const summary = result.data;
    set((s) => ({ briefs: upsert(s.briefs, summary), selectedSummary: summary }));
    void useBrdStore.getState().refreshChanges(projectId);
  },

  startDraft: async (projectId, mode, notes) => {
    const { selected } = get();
    if (!selected) return;
    set({ draft: { status: 'streaming', text: '' } });
    const result = await window.electronAPI.designDraft(projectId, { brdSlug: selected.brdSlug, requirementId: selected.requirementId, mode, notes });
    if (!result.success || !result.data) {
      set({ draft: { status: 'idle', text: '', error: result.error ?? 'Unknown error' } });
      return;
    }
    set({ draft: { status: 'streaming', runId: result.data.runId, text: '' } });
  },

  cancelDraft: async () => {
    const { runId } = get().draft;
    if (runId) await window.electronAPI.designDraftCancel(runId);
  },

  acceptDraft: async (projectId) => {
    const { draft, selected, selectedSummary } = get();
    if (draft.status !== 'proposal' || !selected) return;
    if (selectedSummary) {
      set({ content: draft.text, structure: checkDesignStructure(draft.text), draft: { ...idleDraft } });
      return;
    }
    const result = await window.electronAPI.designWrite(projectId, selected.brdSlug, selected.requirementId, draft.text);
    if (!result.success || !result.data) {
      set({ draft: { ...draft, error: result.error ?? 'Unknown error' } });
      return;
    }
    const summary = result.data;
    set((s) => ({
      briefs: upsert(s.briefs, summary),
      selectedSummary: summary,
      content: draft.text,
      savedContent: draft.text,
      structure: checkDesignStructure(draft.text),
      draft: { ...idleDraft },
    }));
    void useBrdStore.getState().refreshChanges(projectId);
  },

  discardDraft: () => set({ draft: { ...idleDraft } }),
}));

/** Subscribe to draft stream events. Returns an unsubscribe function. */
export function setupDesignListeners(): () => void {
  const store = useDesignStore;
  const isCurrent = (runId: string) => store.getState().draft.runId === runId;
  const offChunk = window.electronAPI.onDesignDraftChunk(({ runId, text }) => {
    if (!isCurrent(runId)) return;
    store.setState((s) => ({ draft: { ...s.draft, text: s.draft.text + text } }));
  });
  const offDone = window.electronAPI.onDesignDraftDone(({ runId, text }) => {
    if (!isCurrent(runId)) return;
    store.setState({ draft: { status: 'proposal', runId, text } });
  });
  const offError = window.electronAPI.onDesignDraftError(({ runId, error }) => {
    if (!isCurrent(runId)) return;
    store.setState((s) => ({ draft: { status: 'idle', text: s.draft.text, error } }));
  });
  return () => {
    offChunk();
    offDone();
    offError();
  };
}
```

```tsx
// apps/desktop/src/renderer/contexts/DesignNavigationContext.tsx
import { createContext, useContext, type ReactNode } from 'react';

export type DesignNavigate = (brdSlug: string, requirementId: string) => void;

const DesignNavigationContext = createContext<DesignNavigate | null>(null);

export function DesignNavigationProvider({ navigate, children }: { navigate: DesignNavigate; children: ReactNode }) {
  return <DesignNavigationContext.Provider value={navigate}>{children}</DesignNavigationContext.Provider>;
}

/** Opens the Design view on a requirement; null outside the provider (tests, isolated renders). */
export function useDesignNavigation(): DesignNavigate | null {
  return useContext(DesignNavigationContext);
}
```

- [ ] **Step 5: Run tests, lint, typecheck, commit**

Run: `npx vitest run src/renderer/stores/__tests__/design-store.test.ts src/shared/i18n && npx biome check src/renderer/stores/design-store.ts src/renderer/contexts/DesignNavigationContext.tsx src/shared/i18n/locales/en/design.json src/shared/i18n/locales/fr/design.json && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

```bash
git add src/shared/i18n src/renderer/stores/design-store.ts src/renderer/stores/__tests__/design-store.test.ts src/renderer/contexts/DesignNavigationContext.tsx
git commit -m "feat(design): design store, draft listeners, navigation context, and i18n"
```

---

### Task 7: Design view, sidebar, and app route

**Files:**
- Create: `src/renderer/components/design/DesignView.tsx`, `DesignBriefList.tsx`, `DesignBriefEmpty.tsx`, `DesignBriefEditor.tsx`, `DesignAssistPanel.tsx`, `DesignStatusChip.tsx`
- Modify: `src/renderer/components/Sidebar.tsx` (`SidebarView` + base nav item after requirements), `src/renderer/App.tsx` (route + provider)
- Test: `src/renderer/components/design/__tests__/DesignView.test.tsx`

**Interfaces:**
- Consumes: `useDesignStore`, `briefStatus`, `setupDesignListeners`, `useDesignNavigation` (Task 6).
- Produces: `DesignView({ projectId })`, `DesignStatusChip({ brdSlug, requirementId })`.

- [ ] **Step 1: Write the failing test**

```tsx
/**
 * @vitest-environment jsdom
 */
// apps/desktop/src/renderer/components/design/__tests__/DesignView.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DesignView } from '../DesignView';
import { useDesignStore } from '../../../stores/design-store';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o && Object.keys(o).length ? `${k}:${Object.values(o).join(',')}` : k), i18n: { language: 'en' } }),
}));
vi.mock('react-markdown', () => ({ default: ({ children }: { children: string }) => <div data-testid="preview">{children}</div> }));
vi.mock('remark-gfm', () => ({ default: () => null }));

const summary = { brdSlug: 'a', requirementId: 'R1', title: 'One', status: 'draft' as const, modifiedAt: 't' };
const doc = '---\nbrd: a\nrequirement: R1\ntitle: One\nstatus: draft\nupdated: 2026-09-21\n---\n# One\n\n## Summary\nText\n';
const set = { requirements: [
  { id: 'R1', title: 'One', description: 'd1', acceptanceCriteria: ['c1'], area: 'x', needsDesign: true, included: true },
  { id: 'R2', title: 'Two', description: 'd2', acceptanceCriteria: ['c2'], area: 'x', needsDesign: true, included: true },
] };
const api = {
  brdList: vi.fn().mockResolvedValue({ success: true, data: [{ slug: 'a', title: 'A' }] }),
  requirementsRead: vi.fn().mockResolvedValue({ success: true, data: { set } }),
  designList: vi.fn().mockResolvedValue({ success: true, data: [summary] }),
  designRead: vi.fn(), designWrite: vi.fn(), designCreate: vi.fn(), designSetStatus: vi.fn(), designDraft: vi.fn(), designDraftCancel: vi.fn(),
  onDesignDraftChunk: vi.fn(() => () => undefined), onDesignDraftDone: vi.fn(() => () => undefined), onDesignDraftError: vi.fn(() => () => undefined),
  brdChanges: vi.fn().mockResolvedValue({ success: false }),
};

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  useDesignStore.getState().reset();
});

describe('DesignView', () => {
  it('lists needsDesign requirements with status chips and opens a brief', async () => {
    api.designRead.mockResolvedValue({ success: true, data: { summary, content: doc } });
    render(<DesignView projectId="p1" />);
    expect(await screen.findByText('One')).toBeInTheDocument();
    expect(screen.getByText('status.draft')).toBeInTheDocument();
    expect(screen.getByText('status.none')).toBeInTheDocument();
    fireEvent.click(screen.getByText('One'));
    expect(await screen.findByLabelText('editor.markdown')).toHaveValue(doc);
    expect(screen.getByRole('button', { name: 'editor.approve' })).toBeInTheDocument();
  });

  it('shows the empty state for a requirement without a brief and creates from template', async () => {
    api.designRead.mockResolvedValue({ success: false, error: 'Design brief not found: a/R2' });
    api.designCreate.mockResolvedValue({ success: true, data: { ...summary, requirementId: 'R2', title: 'Two' } });
    render(<DesignView projectId="p1" />);
    fireEvent.click(await screen.findByText('Two'));
    expect(await screen.findByText('empty.title:R2')).toBeInTheDocument();
    expect(screen.getByText('c2')).toBeInTheDocument();
    api.designRead.mockResolvedValue({ success: true, data: { summary: { ...summary, requirementId: 'R2' }, content: doc } });
    fireEvent.click(screen.getByRole('button', { name: 'empty.createFromTemplate' }));
    await waitFor(() => expect(api.designCreate).toHaveBeenCalledWith('p1', 'a', 'R2'));
    expect(await screen.findByLabelText('editor.markdown')).toBeInTheDocument();
  });

  it('approves and unapproves', async () => {
    api.designRead.mockResolvedValue({ success: true, data: { summary, content: doc } });
    api.designSetStatus.mockResolvedValue({ success: true, data: { ...summary, status: 'approved' } });
    render(<DesignView projectId="p1" />);
    fireEvent.click(await screen.findByText('One'));
    fireEvent.click(await screen.findByRole('button', { name: 'editor.approve' }));
    await waitFor(() => expect(api.designSetStatus).toHaveBeenCalledWith('p1', 'a', 'R1', 'approved'));
    expect(await screen.findByRole('button', { name: 'editor.unapprove' })).toBeInTheDocument();
  });

  it('guards unsaved changes when switching requirements', async () => {
    api.designRead.mockResolvedValue({ success: true, data: { summary, content: doc } });
    render(<DesignView projectId="p1" />);
    fireEvent.click(await screen.findByText('One'));
    const editor = await screen.findByLabelText('editor.markdown');
    fireEvent.change(editor, { target: { value: `${doc}more` } });
    fireEvent.click(screen.getByText('Two'));
    expect(await screen.findByText('unsavedDialog.title')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/design`
Expected: FAIL.

- [ ] **Step 3: Write the components**

```tsx
// apps/desktop/src/renderer/components/design/DesignStatusChip.tsx
import { useTranslation } from 'react-i18next';
import { PenTool } from 'lucide-react';

import { useDesignNavigation } from '../../contexts/DesignNavigationContext';
import { briefStatus, useDesignStore } from '../../stores/design-store';
import { Badge } from '../ui/badge';

const variant = { none: 'outline', draft: 'secondary', approved: 'success' } as const;

/** Brief status for a requirement; clicking opens it in the Design view when navigation is available. */
export function DesignStatusChip({ brdSlug, requirementId }: { brdSlug: string; requirementId: string }) {
  const { t } = useTranslation('design');
  const briefs = useDesignStore((s) => s.briefs);
  const navigate = useDesignNavigation();
  const status = briefStatus(briefs, brdSlug, requirementId);
  const badge = (
    <Badge variant={variant[status]} className="gap-1">
      <PenTool className="h-3 w-3" />
      {t(`status.${status}`)}
    </Badge>
  );
  if (!navigate) return badge;
  return (
    <button type="button" className="inline-flex" onClick={() => navigate(brdSlug, requirementId)} aria-label={`${t('view.title')} ${requirementId}`}>
      {badge}
    </button>
  );
}
```

```tsx
// apps/desktop/src/renderer/components/design/DesignBriefList.tsx
import { useTranslation } from 'react-i18next';

import type { DesignBriefSummary } from '../../../shared/types/design';
import type { Requirement } from '../../../shared/types/requirements';
import { briefStatus, type BriefSelection } from '../../stores/design-store';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';

interface DesignBriefListProps {
  requirementsBySlug: Record<string, { title: string; requirements: Requirement[] }>;
  briefs: DesignBriefSummary[];
  selected: BriefSelection | null;
  onSelect: (brdSlug: string, requirementId: string) => void;
}

const variant = { none: 'outline', draft: 'secondary', approved: 'success' } as const;

export function DesignBriefList({ requirementsBySlug, briefs, selected, onSelect }: DesignBriefListProps) {
  const { t } = useTranslation('design');
  const slugs = Object.keys(requirementsBySlug);
  const total = slugs.reduce((n, s) => n + requirementsBySlug[s].requirements.length, 0);
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden border-r border-border">
      <div className="p-3">
        <h1 className="text-base font-semibold">{t('view.title')}</h1>
        <p className="text-xs text-muted-foreground">{t('view.subtitle')}</p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {slugs.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">{t('list.noSets')}</p>
        ) : total === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">{t('list.empty')}</p>
        ) : (
          slugs.map((slug) => (
            <div key={slug} className="px-2 pb-2">
              <div className="px-2 py-1 text-xs font-medium text-muted-foreground">{requirementsBySlug[slug].title}</div>
              <ul>
                {requirementsBySlug[slug].requirements.map((r) => {
                  const status = briefStatus(briefs, slug, r.id);
                  const active = selected?.brdSlug === slug && selected.requirementId === r.id;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(slug, r.id)}
                        className={cn('flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-muted/60', active && 'bg-muted')}
                      >
                        <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">{r.id}</span>
                        <span className="min-w-0 flex-1 truncate text-sm">{r.title}</span>
                        <Badge variant={variant[status]}>{t(`status.${status}`)}</Badge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </ScrollArea>
    </div>
  );
}
```

```tsx
// apps/desktop/src/renderer/components/design/DesignBriefEmpty.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FilePlus, Loader2, Sparkles } from 'lucide-react';

import type { Requirement } from '../../../shared/types/requirements';
import { useDesignStore } from '../../stores/design-store';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';

export function DesignBriefEmpty({ projectId, requirement }: { projectId: string; requirement: Requirement }) {
  const { t } = useTranslation('design');
  const [notes, setNotes] = useState('');
  const { draft, create, startDraft, cancelDraft, acceptDraft, discardDraft, error } = useDesignStore();
  const streaming = draft.status === 'streaming';
  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div>
        <h2 className="text-lg font-semibold">{t('empty.title', { id: requirement.id })}</h2>
        <p className="text-sm font-medium">{requirement.title}</p>
        <p className="text-sm text-muted-foreground">{requirement.description}</p>
      </div>
      <div className="text-sm">
        <div className="mb-1 font-medium">{t('empty.acceptance')}</div>
        <ul className="list-disc pl-5">
          {requirement.acceptanceCriteria.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
      <label className="text-xs font-medium" htmlFor="design-empty-notes">{t('empty.notes')}</label>
      <Textarea id="design-empty-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('empty.notesPlaceholder')} disabled={streaming} />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={streaming} onClick={() => void create(projectId)}>
          <FilePlus className="mr-1 h-4 w-4" />
          {t('empty.createFromTemplate')}
        </Button>
        <Button size="sm" disabled={streaming} onClick={() => void startDraft(projectId, 'draft', notes)}>
          <Sparkles className="mr-1 h-4 w-4" />
          {t('empty.draftWithAi')}
        </Button>
        {streaming && (
          <>
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t('assist.streaming')}</span>
            <Button size="sm" variant="ghost" onClick={() => void cancelDraft()}>{t('assist.cancel')}</Button>
          </>
        )}
      </div>
      {(error || draft.error) && <p className="text-xs text-destructive">{t('assist.error', { error: error ?? draft.error })}</p>}
      {(streaming || draft.status === 'proposal') && draft.text && (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted/30 p-2">
          <div className="mb-1 text-xs font-medium">{t('assist.proposalTitle')}</div>
          <pre className="whitespace-pre-wrap font-mono text-xs">{draft.text}</pre>
          {draft.status === 'proposal' && (
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => void acceptDraft(projectId)}>{t('assist.accept')}</Button>
              <Button size="sm" variant="outline" onClick={discardDraft}>{t('assist.discard')}</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

```tsx
// apps/desktop/src/renderer/components/design/DesignAssistPanel.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Loader2, Sparkles } from 'lucide-react';

import { cn } from '../../lib/utils';
import { useDesignStore } from '../../stores/design-store';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Textarea } from '../ui/textarea';

export function DesignAssistPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation('design');
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const { draft, startDraft, cancelDraft, acceptDraft, discardDraft } = useDesignStore();
  const streaming = draft.status === 'streaming';
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border border-border">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-muted/50">
          <ChevronRight className={cn('h-4 w-4 transition-transform', open && 'rotate-90')} />
          <Sparkles className="h-4 w-4" />
          {t('assist.title')}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-3 pb-3">
        <label className="block text-xs font-medium" htmlFor="design-assist-notes">{t('assist.notesLabel')}</label>
        <Textarea id="design-assist-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('assist.notesPlaceholder')} disabled={streaming} />
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={!notes.trim() || streaming} onClick={() => void startDraft(projectId, 'revise', notes)}>{t('assist.revise')}</Button>
          {streaming && (
            <>
              <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t('assist.streaming')}</span>
              <Button size="sm" variant="ghost" onClick={() => void cancelDraft()}>{t('assist.cancel')}</Button>
            </>
          )}
        </div>
        {draft.error && <p className="text-xs text-destructive">{t('assist.error', { error: draft.error })}</p>}
        {(streaming || draft.status === 'proposal') && draft.text && (
          <div className="rounded-md border border-border bg-muted/30 p-2">
            <div className="mb-1 text-xs font-medium">{t('assist.proposalTitle')}</div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs">{draft.text}</pre>
            {draft.status === 'proposal' && (
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => void acceptDraft(projectId)}>{t('assist.accept')}</Button>
                <Button size="sm" variant="outline" onClick={discardDraft}>{t('assist.discard')}</Button>
              </div>
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
```

```tsx
// apps/desktop/src/renderer/components/design/DesignBriefEditor.tsx
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CheckCircle2, Save, Undo2 } from 'lucide-react';

import { parseFrontmatter } from '../../../shared/frontmatter';
import type { Requirement } from '../../../shared/types/requirements';
import { useDesignStore } from '../../stores/design-store';
import { StructureChecklist } from '../requirements/StructureChecklist';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { DesignAssistPanel } from './DesignAssistPanel';

export function DesignBriefEditor({ projectId, requirement }: { projectId: string; requirement: Requirement }) {
  const { t } = useTranslation('design');
  const { selectedSummary, content, setContent, structure, save, setStatus, isSaving, error } = useDesignStore();
  const dirty = useDesignStore((s) => s.content !== s.savedContent);
  if (!selectedSummary) return null;
  const approved = selectedSummary.status === 'approved';
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{selectedSummary.title}</h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{requirement.id}</span>
            <Badge variant={approved ? 'success' : 'secondary'}>{t(`status.${selectedSummary.status}`)}</Badge>
            <span>{dirty ? t('editor.unsaved') : t('editor.saved')}</span>
            {error && <span className="text-destructive">{t('editor.saveError', { error })}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={approved ? 'outline' : 'default'} disabled={dirty || isSaving} onClick={() => void setStatus(projectId, approved ? 'draft' : 'approved')}>
            {approved ? <Undo2 className="mr-2 h-4 w-4" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            {approved ? t('editor.unapprove') : t('editor.approve')}
          </Button>
          <Button size="sm" disabled={!dirty || isSaving} onClick={() => void save(projectId)}>
            <Save className="mr-2 h-4 w-4" />
            {isSaving ? t('editor.saving') : t('editor.save')}
          </Button>
        </div>
      </div>
      <StructureChecklist result={structure} />
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <textarea
          aria-label={t('editor.markdown')}
          className="h-full w-full resize-none rounded-md border border-border bg-background p-3 font-mono text-xs leading-5 focus:outline-none focus:ring-1 focus:ring-ring"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
        />
        <section className="h-full overflow-auto rounded-md border border-border p-3 prose prose-sm dark:prose-invert max-w-none" aria-label={t('editor.preview')}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{parseFrontmatter(content)?.body ?? content}</ReactMarkdown>
        </section>
      </div>
      <DesignAssistPanel projectId={projectId} />
    </div>
  );
}
```

Note: `StructureChecklist` reads the `requirements` namespace for its labels, which is acceptable since the strings are identical; do not duplicate the component.

```tsx
// apps/desktop/src/renderer/components/design/DesignView.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { setupDesignListeners, useDesignStore, type BriefSelection } from '../../stores/design-store';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../ui/alert-dialog';
import { DesignBriefEditor } from './DesignBriefEditor';
import { DesignBriefEmpty } from './DesignBriefEmpty';
import { DesignBriefList } from './DesignBriefList';

export function DesignView({ projectId }: { projectId: string }) {
  const { t } = useTranslation('design');
  const { requirementsBySlug, briefs, selected, selectedSummary, load, select, reset, error } = useDesignStore();
  const [pending, setPending] = useState<BriefSelection | null>(null);

  useEffect(() => {
    const stop = setupDesignListeners();
    reset();
    void load(projectId).then(() => {
      const open = useDesignStore.getState().pendingOpen;
      if (!open) return;
      useDesignStore.setState({ pendingOpen: null });
      void select(projectId, open.brdSlug, open.requirementId, { force: true });
    });
    return stop;
  }, [projectId, load, reset, select]);

  const handleSelect = async (brdSlug: string, requirementId: string) => {
    if (useDesignStore.getState().isDirty()) {
      setPending({ brdSlug, requirementId });
      return;
    }
    await select(projectId, brdSlug, requirementId);
  };

  const requirement = selected ? requirementsBySlug[selected.brdSlug]?.requirements.find((r) => r.id === selected.requirementId) : undefined;

  return (
    <div className="grid h-full grid-cols-[300px_1fr]">
      <DesignBriefList requirementsBySlug={requirementsBySlug} briefs={briefs} selected={selected} onSelect={(s, r) => void handleSelect(s, r)} />
      <div className="min-h-0">
        {error && !selected && <p className="px-4 pt-4 text-sm text-destructive">{error}</p>}
        {selected && requirement ? (
          selectedSummary ? <DesignBriefEditor projectId={projectId} requirement={requirement} /> : <DesignBriefEmpty projectId={projectId} requirement={requirement} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('list.empty')}</div>
        )}
      </div>
      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('unsavedDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('unsavedDialog.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('unsavedDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const next = pending;
                setPending(null);
                if (next) void select(projectId, next.brdSlug, next.requirementId, { force: true });
              }}
            >
              {t('unsavedDialog.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

Sidebar: add `'design'` to `SidebarView`, import `PenTool` from `lucide-react`, and insert `{ id: 'design', labelKey: 'navigation:items.design', icon: PenTool, shortcut: 'E' },` after the requirements item in `baseNavItems`.

App: import `DesignView` and `DesignNavigationProvider`; render after the requirements route:

```tsx
                {activeView === 'design' && (activeProjectId || selectedProjectId) && (
                  <ErrorBoundary>
                    <DesignView projectId={activeProjectId || selectedProjectId!} />
                  </ErrorBoundary>
                )}
```

Wrap the part of the tree that contains both the main views and `TaskDetailModal` in

```tsx
<DesignNavigationProvider
  navigate={(brdSlug, requirementId) => {
    useDesignStore.getState().requestOpen(brdSlug, requirementId);
    handleCloseTaskDetail();
    setActiveView('design');
  }}
>
```

(import `useDesignStore`). If the provider must sit above `ErrorBoundary`s, place it right inside the top-level layout wrapper.

- [ ] **Step 4: Run tests, lint, typecheck, commit**

Run: `npx vitest run src/renderer/components/design src/renderer/components/Sidebar* 2>/dev/null; npx vitest run src/renderer/components/design && npx biome check src/renderer/components/design src/renderer/components/Sidebar.tsx && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

```bash
git add src/renderer/components/design src/renderer/components/Sidebar.tsx src/renderer/App.tsx
git commit -m "feat(design): Design view with brief list, editor, assist, and approval"
```

---

### Task 8: Status chips in the Requirements tab and task detail

**Files:**
- Modify: `src/renderer/components/requirements/set/RequirementsSetEditor.tsx` (requirement row, next to the needsDesign checkbox), `src/renderer/components/task-detail/TaskRequirements.tsx` (covered list), `src/renderer/components/requirements/RequirementsView.tsx` (load briefs on mount)
- Test: extend `src/renderer/components/requirements/set/__tests__/RequirementsSetEditor.test.tsx`, `src/renderer/components/task-detail/__tests__/TaskRequirements.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `RequirementsSetEditor.test.tsx` (import `useDesignStore` from `'../../../../stores/design-store'` and `DesignNavigationProvider` from `'../../../../contexts/DesignNavigationContext'`):

```tsx
describe('RequirementsSetEditor design chips', () => {
  it('shows the brief status next to needsDesign requirements and navigates', () => {
    useDesignStore.setState({ briefs: [{ brdSlug: 'a', requirementId: 'R1', title: 'x', status: 'approved', modifiedAt: 't' }] });
    useRequirementsStore.setState({ slug: 'a', set, savedSet: set, currentBrdHash: 'H' });
    const navigate = vi.fn();
    render(<DesignNavigationProvider navigate={navigate}><RequirementsSetEditor projectId="p1" /></DesignNavigationProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'view.title R1' }));
    expect(navigate).toHaveBeenCalledWith('a', 'R1');
    expect(screen.getByText('status.approved')).toBeInTheDocument();
  });
});
```

(The editor test's i18n mock returns keys, so the chip renders `status.approved`; the `set` fixture's R1 has `needsDesign: true`.)

Append to `TaskRequirements.test.tsx` (import `useDesignStore` and `DesignNavigationProvider`; the existing fixture has R1 `needsDesign: false` and R2 `needsDesign: false`, so set R1 `needsDesign: true` in a local copy):

```tsx
  it('shows a design chip for needsDesign requirements', async () => {
    brdRead.mockResolvedValue({ success: true, data: { summary: { slug: 'todo-app', title: 'Todo' }, content: '' } });
    requirementsRead.mockResolvedValue({ success: true, data: { set: { ...set, requirements: [{ ...set.requirements[0], needsDesign: true }, set.requirements[1]] } } });
    useDesignStore.setState({ briefs: [] });
    const navigate = vi.fn();
    render(<DesignNavigationProvider navigate={navigate}><TaskRequirements task={task} /></DesignNavigationProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'view.title R1' }));
    expect(navigate).toHaveBeenCalledWith('todo-app', 'R1');
    expect(screen.getByText('status.none')).toBeInTheDocument();
  });
```

(`task` is the fixture the file already uses with `requirementIds: ['R1', 'R2']`; adjust names to the file's fixtures.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/components/requirements/set src/renderer/components/task-detail/__tests__/TaskRequirements.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Add the chips**

`RequirementsSetEditor.tsx`: import `DesignStatusChip` from `'../../design/DesignStatusChip'`; read `const slug = useRequirementsStore((s) => s.slug);` (the store already holds `slug`); in the requirement row after the needsDesign checkbox span, render `{r.needsDesign && slug && <DesignStatusChip brdSlug={slug} requirementId={r.id} />}` inside the same flex container.

`TaskRequirements.tsx`: import `DesignStatusChip`; in the covered list item, after the title span, render `{r.needsDesign && <DesignStatusChip brdSlug={slug} requirementId={r.id} />}`.

`RequirementsView.tsx`: in the mount effect, add `void useDesignStore.getState().load(projectId);` so the chips have brief statuses (import `useDesignStore`). `TaskRequirements`: add `useEffect(() => { void useDesignStore.getState().load(task.projectId); }, [task.projectId]);` guarded by `if (useDesignStore.getState().briefs.length === 0)`.

- [ ] **Step 4: Run tests, lint, typecheck, commit**

Run: `npx vitest run src/renderer/components/requirements src/renderer/components/task-detail && npx biome check src/renderer/components/requirements/set/RequirementsSetEditor.tsx src/renderer/components/task-detail/TaskRequirements.tsx src/renderer/components/requirements/RequirementsView.tsx && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

```bash
git add src/renderer/components/requirements src/renderer/components/task-detail
git commit -m "feat(design): brief status chips in the Requirements tab and task detail"
```

---

### Task 9: Full gate and manual check

- [ ] **Step 1: Full suite, lint, typecheck**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all green (pre-existing lint warnings only).

- [ ] **Step 2: Manual check in the running app (todo project)**

Kill leftover Electron processes, then `nvm use 24 && npm run dev:mcp` from the repo root; drive with the Playwright-over-CDP helper.

1. Sidebar shows "Design" (E). The view lists the Todo app's `needsDesign` requirements with "No brief" chips.
2. Select one; the empty state shows its acceptance criteria. "Create from template" writes `docs/design/todo-app/<R>.md` and opens the editor with the checklist showing the four required sections empty.
3. On another requirement, "Draft with AI" streams a proposal; Accept writes the file; the checklist shows required sections filled; Save is disabled (nothing dirty); Approve flips the chip to "Approved" and the file's `status: approved`.
4. Requirements view, Requirements tab: the two requirements show their chips; clicking one opens the Design view on it.
5. Release the next milestone: the warning lists the `needsDesign` requirements without approved briefs and omits the approved one.
6. Start a released task covering the approved requirement; the run log shows "Design briefs injected for spec_gatherer" and later for coder.
7. The BRD list's Commit badge counts the design files; the dialog prefills `docs(design): add todo-app/<R>, todo-app/<R>` and commits.

- [ ] **Step 3: Commit fixes from the manual check**

Commit with `fix(design): ...` describing what the run exposed.

---

## Spec coverage checklist (self-review)

| Spec section | Task |
|---|---|
| 2.1 files, 2.2 template, 2.3 lifecycle, 2.4 data model | 1 |
| 3.1 files module | 1 |
| 3.2 AI writer | 2 |
| 3.3 IPC, preload, mock | 3 |
| 3.4 prompt injection | 4 |
| 3.5 release warning, 3.6 commit | 5 |
| 4.1 Design view, 4.2 store, navigation | 6, 7 |
| 4.3 cross-links, 4.4 commit dialog | 8, 5 |
| 5 i18n | 6 |
| 6 testing, manual check | every task; 9 |
