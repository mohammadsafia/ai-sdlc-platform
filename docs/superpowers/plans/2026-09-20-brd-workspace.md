# BRD Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Requirements view where product owners create, edit, structure-check, and AI-draft Business Requirements Documents stored as Markdown under `docs/brd/` in the project repository.

**Architecture:** Pure BRD structure logic lives in `src/shared/brd/` so both main and renderer use it. Main owns file access (`src/main/brd/`), a template resolver, a streaming AI runner (`src/main/ai/runners/brd-writer.ts`) modeled on Insights, and one IPC module. The renderer adds a `requirements` view, a Zustand store that subscribes to draft stream events, and editor components with a react-markdown preview.

**Tech Stack:** TypeScript strict, Electron 40, Vercel AI SDK v6 (`streamText` via `createSimpleClient`), React 19, Zustand 5, react-markdown + remark-gfm, react-i18next, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-20-brd-workspace-design.md`

## Global Constraints

- Work under `apps/desktop/`; run commands from there with Node 24 (`nvm use 24`).
- No `process.platform`; no `console.log` in production paths (use the module's existing `debugLog`/`console.warn` conventions only where the touched file already does).
- All renderer text through `react-i18next`; every key added to both `en` and `fr`.
- Shared files in the target project: `<project>/docs/brd/<slug>.md` only. Nothing under `.auto-claude/`.
- Slug pattern, verbatim from the spec: `/^[a-z0-9]+(-[a-z0-9]+)*$/`. Required sections: `Summary`, `Problem and goals`, `Scope`, `Functional requirements`, `Milestones`. Optional: `Success metrics`, `Users and stakeholders`, `Non-functional requirements`, `Constraints and assumptions`, `Open questions`.
- Frontmatter: `title` (required), `status` in `draft | review | approved` (default `draft`), `owner` (optional), `created` (required, ISO date).
- The runner never writes files. One draft run per project at a time. Milestones carry no dates or durations.
- Sidebar shortcut for the new view is `Q` (`R` is already taken).
- Feature model settings come from `getActiveProviderFeatureSettings('roadmap')`.
- Component tests start with the `@vitest-environment jsdom` docblock and `import '@testing-library/jest-dom/vitest';`.
- Tests: `npx vitest run <path>`. Lint: `npm run lint`. Types: `npm run typecheck`. Commit after each task on branch `feat/brd-workspace`, ending messages with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File Structure

New (under `apps/desktop/`):

| Path | Responsibility |
|---|---|
| `src/shared/frontmatter.ts` | The frontmatter parser, moved from `src/main/ai/skills/frontmatter.ts` (which becomes a re-export) |
| `src/shared/types/brd.ts` | BRD types shared by main, preload, renderer |
| `src/shared/brd/structure.ts` | `slugify`, `parseBrdFrontmatter`, `checkBrdStructure` (pure) |
| `templates/brd-template.md` | The BRD template shipped with the app |
| `src/main/brd/templates.ts` | Resolve the templates dir in dev and packaged builds; `loadTemplate` |
| `src/main/brd/brd-files.ts` | list/read/write/create with path containment |
| `src/main/ai/runners/brd-writer.ts` | Streaming draft/revise runner |
| `prompts/brd_writer.md` | System prompt for the runner |
| `src/main/ipc-handlers/brd-handlers.ts` | `brd:*` channels and draft run management |
| `src/preload/api/modules/brd-api.ts` | Preload API incl. event subscriptions |
| `src/shared/i18n/locales/{en,fr}/requirements.json` | New namespace |
| `src/renderer/stores/brd-store.ts` | View state + listener setup |
| `src/renderer/components/requirements/*.tsx` | `RequirementsView`, `BrdList`, `NewBrdDialog`, `BrdEditor`, `StructureChecklist`, `BrdAssistPanel` |

Modified: `package.json` (extraResources), `src/shared/constants/ipc.ts`, `src/shared/types/ipc.ts`, `src/shared/types/index.ts`, `src/preload/api/agent-api.ts`, `src/main/ipc-handlers/index.ts`, `src/renderer/lib/browser-mock.ts`, `src/shared/i18n/index.ts`, `locales/{en,fr}/navigation.json`, `src/renderer/components/Sidebar.tsx`, `src/renderer/App.tsx`.

---

### Task 1: Shared BRD types and structure logic

**Files:**
- Create: `src/shared/frontmatter.ts` (moved content)
- Modify: `src/main/ai/skills/frontmatter.ts` → re-export
- Create: `src/shared/types/brd.ts`
- Modify: `src/shared/types/index.ts` (add `export * from './brd';`)
- Create: `src/shared/brd/structure.ts`
- Test: `src/shared/brd/__tests__/structure.test.ts`

**Interfaces:**
- Produces: `slugify(title: string): string`, `parseBrdFrontmatter(markdown: string): BrdFrontmatter`, `checkBrdStructure(markdown: string): BrdStructureResult`, `BRD_REQUIRED_SECTIONS`, `BRD_OPTIONAL_SECTIONS`, and the types below.

- [ ] **Step 1: Move the frontmatter parser**

Move the file: `git mv src/main/ai/skills/frontmatter.ts src/shared/frontmatter.ts`. Then create `src/main/ai/skills/frontmatter.ts` with:

```ts
// apps/desktop/src/main/ai/skills/frontmatter.ts
export { parseFrontmatter } from '../../../shared/frontmatter';
export type { Frontmatter } from '../../../shared/frontmatter';
```

Run `cd apps/desktop && npx vitest run src/main/ai/skills/` and expect all existing skills tests to pass unchanged.

- [ ] **Step 2: Write `src/shared/types/brd.ts`**

```ts
// apps/desktop/src/shared/types/brd.ts
export type BrdStatus = 'draft' | 'review' | 'approved';
export const BRD_STATUSES: readonly BrdStatus[] = ['draft', 'review', 'approved'];

export interface BrdSummary {
  slug: string;
  title: string;
  status: BrdStatus;
  owner?: string;
  created?: string;
  /** ISO timestamp of the file's last modification */
  modifiedAt: string;
  /** Set when the file could not be fully parsed (e.g. missing frontmatter title) */
  warning?: string;
}

export interface BrdFrontmatter {
  title?: string;
  status: BrdStatus;
  owner?: string;
  created?: string;
  errors: string[];
}

export interface BrdSection {
  heading: string;
  required: boolean;
  present: boolean;
  empty: boolean;
}

export interface BrdStructureResult {
  ok: boolean;
  sections: BrdSection[];
  frontmatterErrors: string[];
}

export type BrdDraftMode = 'draft' | 'revise';

export interface BrdDraftRequest {
  mode: BrdDraftMode;
  /** PO notes (draft) or instructions (revise) */
  notes: string;
  /** Existing BRD to revise */
  slug?: string;
  /** Title for a new draft */
  title?: string;
}

export interface BrdDraftChunk { runId: string; text: string }
export interface BrdDraftDone { runId: string; text: string }
export interface BrdDraftError { runId: string; error: string }
```

Add `export * from './brd';` to `src/shared/types/index.ts` next to `export * from './skills';`.

- [ ] **Step 3: Write the failing structure tests**

```ts
// apps/desktop/src/shared/brd/__tests__/structure.test.ts
import { describe, it, expect } from 'vitest';
import { slugify, parseBrdFrontmatter, checkBrdStructure, BRD_REQUIRED_SECTIONS } from '../structure';

const fm = '---\ntitle: Customer Onboarding\nstatus: draft\ncreated: 2026-09-20\n---\n';
const full = `${fm}# Customer Onboarding

## Summary

We need a guided onboarding.

## Problem and goals

New users churn in week one.

## Success metrics

Activation rate above 40%.

## Users and stakeholders

New customers; support team.

## Scope

### In scope

Signup wizard.

### Out of scope

Billing.

## Functional requirements

### Wizard

1. The wizard has three steps.

## Non-functional requirements

Loads under 2 seconds.

## Milestones

### Milestone 1: Wizard

Signup wizard end to end.

## Constraints and assumptions

Uses the existing auth service.

## Open questions

None.
`;

describe('slugify', () => {
  it('produces kebab-case slugs and a fallback', () => {
    expect(slugify('Customer Onboarding v2!')).toBe('customer-onboarding-v2');
    expect(slugify('  --Hello__World--  ')).toBe('hello-world');
    expect(slugify('***')).toBe('brd');
  });
});

describe('parseBrdFrontmatter', () => {
  it('reads fields and defaults status', () => {
    const r = parseBrdFrontmatter('---\ntitle: X\ncreated: 2026-01-01\nowner: Sam\n---\nbody');
    expect(r).toEqual({ title: 'X', status: 'draft', owner: 'Sam', created: '2026-01-01', errors: [] });
  });

  it('reports missing frontmatter, missing title/created, and bad status', () => {
    expect(parseBrdFrontmatter('# no fm').errors).toEqual(['Frontmatter block is missing']);
    const r = parseBrdFrontmatter('---\nstatus: bogus\n---\n');
    expect(r.errors).toEqual(['title is required', 'created is required', 'status must be one of draft, review, approved']);
    expect(r.status).toBe('draft');
  });
});

describe('checkBrdStructure', () => {
  it('passes a complete document', () => {
    const r = checkBrdStructure(full);
    expect(r.ok).toBe(true);
    expect(r.frontmatterErrors).toEqual([]);
    expect(r.sections.filter((s) => s.required).map((s) => s.heading)).toEqual([...BRD_REQUIRED_SECTIONS]);
    expect(r.sections.every((s) => s.present && !s.empty)).toBe(true);
  });

  it('fails when a required section is missing', () => {
    const r = checkBrdStructure(full.replace('## Milestones', '## Timeline'));
    expect(r.ok).toBe(false);
    expect(r.sections.find((s) => s.heading === 'Milestones')).toMatchObject({ present: false, empty: true, required: true });
  });

  it('treats placeholder-only and heading-only content as empty', () => {
    const r = checkBrdStructure(
      full
        .replace('We need a guided onboarding.', '<One paragraph: what this is and why now.>')
        .replace('1. The wizard has three steps.', '1. <Requirement>'),
    );
    expect(r.ok).toBe(false);
    expect(r.sections.find((s) => s.heading === 'Summary')).toMatchObject({ present: true, empty: true });
    expect(r.sections.find((s) => s.heading === 'Functional requirements')).toMatchObject({ present: true, empty: true });
  });

  it('does not fail on missing optional sections but lists them', () => {
    const r = checkBrdStructure(full.replace(/## Open questions[\s\S]*$/, ''));
    expect(r.ok).toBe(true);
    expect(r.sections.find((s) => s.heading === 'Open questions')).toMatchObject({ required: false, present: false });
  });

  it('matches headings case-insensitively and surfaces frontmatter errors', () => {
    const r = checkBrdStructure(full.replace('## Summary', '## SUMMARY').replace('title: Customer Onboarding\n', ''));
    expect(r.sections.find((s) => s.heading === 'Summary')?.present).toBe(true);
    expect(r.frontmatterErrors).toEqual(['title is required']);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/shared/brd/__tests__/structure.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 5: Write `src/shared/brd/structure.ts`**

```ts
// apps/desktop/src/shared/brd/structure.ts
import { parseFrontmatter } from '../frontmatter';
import { BRD_STATUSES, type BrdFrontmatter, type BrdSection, type BrdStatus, type BrdStructureResult } from '../types/brd';

export const BRD_REQUIRED_SECTIONS = [
  'Summary',
  'Problem and goals',
  'Scope',
  'Functional requirements',
  'Milestones',
] as const;

export const BRD_OPTIONAL_SECTIONS = [
  'Success metrics',
  'Users and stakeholders',
  'Non-functional requirements',
  'Constraints and assumptions',
  'Open questions',
] as const;

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'brd';
}

export function parseBrdFrontmatter(markdown: string): BrdFrontmatter {
  const fm = parseFrontmatter(markdown);
  if (!fm) return { status: 'draft', errors: ['Frontmatter block is missing'] };
  const errors: string[] = [];
  const title = fm.fields.title?.trim() || undefined;
  const created = fm.fields.created?.trim() || undefined;
  const owner = fm.fields.owner?.trim() || undefined;
  const rawStatus = fm.fields.status?.trim();
  if (!title) errors.push('title is required');
  if (!created) errors.push('created is required');
  let status: BrdStatus = 'draft';
  if (rawStatus) {
    if ((BRD_STATUSES as readonly string[]).includes(rawStatus)) status = rawStatus as BrdStatus;
    else errors.push(`status must be one of ${BRD_STATUSES.join(', ')}`);
  }
  return { title, status, owner, created, errors };
}

/** Body text (after frontmatter) split into level-2 sections. */
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

/** True when the lines hold nothing but whitespace, headings, list markers, or <placeholders>. */
function isEmptyContent(lines: string[]): boolean {
  return lines.every((raw) => {
    const line = raw.replace(/<[^>]*>/g, '').trim();
    if (line === '') return true;
    if (/^#+\s/.test(line) || /^#+$/.test(line)) return true;
    if (/^(\d+\.|[-*+])\s*$/.test(line)) return true;
    return false;
  });
}

export function checkBrdStructure(markdown: string): BrdStructureResult {
  const frontmatterErrors = parseBrdFrontmatter(markdown).errors;
  const found = splitSections(markdown);
  const describe = (heading: string, required: boolean): BrdSection => {
    const lines = found.get(heading.toLowerCase());
    const present = lines !== undefined;
    const empty = !present || isEmptyContent(lines);
    return { heading, required, present, empty };
  };
  const sections = [
    ...BRD_REQUIRED_SECTIONS.map((h) => describe(h, true)),
    ...BRD_OPTIONAL_SECTIONS.map((h) => describe(h, false)),
  ];
  const ok = frontmatterErrors.length === 0 && sections.every((s) => !s.required || (s.present && !s.empty));
  return { ok, sections, frontmatterErrors };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/shared/brd/__tests__/structure.test.ts src/main/ai/skills/ && npm run typecheck`
Expected: PASS; no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/shared/frontmatter.ts apps/desktop/src/main/ai/skills/frontmatter.ts apps/desktop/src/shared/types/brd.ts apps/desktop/src/shared/types/index.ts apps/desktop/src/shared/brd/structure.ts apps/desktop/src/shared/brd/__tests__/structure.test.ts
git commit -m "feat(brd): add shared BRD types, frontmatter, and structure check

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Template file and resolver

**Files:**
- Create: `templates/brd-template.md`
- Create: `src/main/brd/templates.ts`
- Modify: `package.json` (`build.extraResources`)
- Test: `src/main/brd/__tests__/templates.test.ts`

**Interfaces:**
- Produces: `resolveTemplatesDir(): string`, `loadTemplate(name: string): string` (throws when missing), `renderBrdTemplate(title: string, createdIso: string): string`.

- [ ] **Step 1: Write the template**

```markdown
---
title: <Title>
status: draft
owner:
created: <YYYY-MM-DD>
---

# <Title>

## Summary

<One paragraph: what this is and why now.>

## Problem and goals

<What problem exists today and what outcomes this BRD targets.>

## Success metrics

<How we will know it worked.>

## Users and stakeholders

<Who uses it and who cares about it.>

## Scope

### In scope

<What is included.>

### Out of scope

<What is explicitly excluded.>

## Functional requirements

### <Feature area>

1. <Requirement>

## Non-functional requirements

<Performance, security, accessibility, compliance.>

## Milestones

### Milestone 1: <Name>

<What this milestone includes. No dates or durations.>

## Constraints and assumptions

<Technical, legal, or organizational constraints and the assumptions made.>

## Open questions

<Anything still undecided.>
```

Save it as `apps/desktop/templates/brd-template.md`.

- [ ] **Step 2: Add to packaging**

In `apps/desktop/package.json`, inside `build.extraResources`, right after `{ "from": "prompts", "to": "prompts" }`, add:

```json
      { "from": "templates", "to": "templates" },
```

- [ ] **Step 3: Write the failing test**

```ts
// apps/desktop/src/main/brd/__tests__/templates.test.ts
import { describe, it, expect } from 'vitest';
import { loadTemplate, renderBrdTemplate, resolveTemplatesDir } from '../templates';
import { checkBrdStructure } from '../../../shared/brd/structure';

describe('templates', () => {
  it('resolves the templates directory in dev', () => {
    expect(resolveTemplatesDir()).toMatch(/templates$/);
  });

  it('loads the BRD template and it contains every section heading', () => {
    const t = loadTemplate('brd-template');
    for (const h of ['## Summary', '## Problem and goals', '## Scope', '## Functional requirements', '## Milestones', '## Open questions']) {
      expect(t).toContain(h);
    }
  });

  it('throws for an unknown template', () => {
    expect(() => loadTemplate('nope')).toThrow(/Template file not found/);
  });

  it('renderBrdTemplate fills title and date; the result is structurally present but empty', () => {
    const md = renderBrdTemplate('Customer Onboarding', '2026-09-20');
    expect(md.startsWith('---\ntitle: Customer Onboarding\nstatus: draft\nowner:\ncreated: 2026-09-20\n---')).toBe(true);
    expect(md).toContain('# Customer Onboarding');
    const r = checkBrdStructure(md);
    expect(r.frontmatterErrors).toEqual([]);
    expect(r.sections.filter((s) => s.required).every((s) => s.present && s.empty)).toBe(true);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/main/brd/__tests__/templates.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 5: Write `src/main/brd/templates.ts`**

```ts
// apps/desktop/src/main/brd/templates.ts
/**
 * Template files shipped with the app (apps/desktop/templates/).
 * Resolution mirrors prompts/prompt-loader.ts: process.resourcesPath when
 * packaged, otherwise the first candidate containing brd-template.md.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM-compatible __dirname (the main bundle is ESM; see changelog-service.ts)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let resolved: string | null = null;

export function resolveTemplatesDir(): string {
  if (resolved) return resolved;
  try {
    const { app } = require('electron') as typeof import('electron');
    if (app?.isPackaged) {
      resolved = join(process.resourcesPath, 'templates');
      return resolved;
    }
  } catch {
    // Not in the Electron main process (tests, workers)
  }
  const candidates = [
    join(__dirname, '..', '..', '..', 'templates'),
    join(__dirname, '..', '..', 'templates'),
    join(__dirname, '..', 'templates'),
    join(__dirname, 'templates'),
    join(__dirname, '..', '..', '..', '..', 'apps', 'desktop', 'templates'),
  ];
  resolved = candidates.find((c) => existsSync(join(c, 'brd-template.md'))) ?? candidates[0];
  return resolved;
}

export function loadTemplate(name: string): string {
  const dir = resolveTemplatesDir();
  const file = join(dir, `${name}.md`);
  if (!existsSync(file)) {
    throw new Error(`Template file not found: ${file}\nTemplates directory resolved to: ${dir}`);
  }
  return readFileSync(file, 'utf-8');
}

export function renderBrdTemplate(title: string, createdIso: string): string {
  return loadTemplate('brd-template').replace(/<Title>/g, title).replace(/<YYYY-MM-DD>/g, createdIso);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/main/brd/__tests__/templates.test.ts`
Expected: PASS (4 tests). If `resolveTemplatesDir` picks the wrong candidate under Vitest, `__dirname` for `src/main/brd/templates.ts` is `apps/desktop/src/main/brd`, so `join(__dirname, '..', '..', '..', 'templates')` is the match.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/templates/brd-template.md apps/desktop/src/main/brd/templates.ts apps/desktop/package.json apps/desktop/src/main/brd/__tests__/templates.test.ts
git commit -m "feat(brd): ship BRD template with dev/packaged resolver

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: BRD file access

**Files:**
- Create: `src/main/brd/brd-files.ts`
- Test: `src/main/brd/__tests__/brd-files.test.ts`

**Interfaces:**
- Consumes: Task 1 (`parseBrdFrontmatter`, `slugify`), Task 2 (`renderBrdTemplate`).
- Produces: `BRD_DIR = 'docs/brd'`, `brdPath(projectDir, slug)`, `listBrds(projectDir)`, `readBrd(projectDir, slug)`, `writeBrd(projectDir, slug, content)`, `createBrd(projectDir, title, now?)`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/desktop/src/main/brd/__tests__/brd-files.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, symlinkSync, existsSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { brdPath, listBrds, readBrd, writeBrd, createBrd } from '../brd-files';

const doc = (title: string, extra = '') => `---\ntitle: ${title}\nstatus: review\ncreated: 2026-09-01\n---\n# ${title}\n\n## Summary\n\nText.\n${extra}`;

describe('brd-files', () => {
  let projectDir: string;
  let brdDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(path.join(tmpdir(), 'brd-files-'));
    brdDir = path.join(projectDir, 'docs', 'brd');
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('brdPath validates the slug and stays inside docs/brd', async () => {
    expect(await brdPath(projectDir, 'my-brd')).toBe(path.join(realpathSync(projectDir), 'docs', 'brd', 'my-brd.md'));
    await expect(brdPath(projectDir, '../x')).rejects.toThrow(/Invalid BRD slug/);
    await expect(brdPath(projectDir, 'Upper')).rejects.toThrow(/Invalid BRD slug/);
    await expect(brdPath(projectDir, '')).rejects.toThrow(/Invalid BRD slug/);
  });

  it('brdPath rejects a symlinked docs/brd that escapes the project', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'brd-outside-'));
    mkdirSync(path.join(projectDir, 'docs'), { recursive: true });
    symlinkSync(outside, brdDir, 'dir');
    await expect(brdPath(projectDir, 'x')).rejects.toThrow(/outside the project/);
    rmSync(outside, { recursive: true, force: true });
  });

  it('listBrds returns an empty list when the folder is missing', async () => {
    expect(await listBrds(projectDir)).toEqual([]);
  });

  it('listBrds reads frontmatter, warns on missing title, ignores non-md, sorts by modifiedAt desc', async () => {
    mkdirSync(brdDir, { recursive: true });
    writeFileSync(path.join(brdDir, 'older.md'), doc('Older'));
    await new Promise((r) => setTimeout(r, 20));
    writeFileSync(path.join(brdDir, 'notes.txt'), 'ignored');
    writeFileSync(path.join(brdDir, 'untitled.md'), '# no frontmatter');
    await new Promise((r) => setTimeout(r, 20));
    writeFileSync(path.join(brdDir, 'newer.md'), doc('Newer'));
    const list = await listBrds(projectDir);
    expect(list.map((b) => b.slug)).toEqual(['newer', 'untitled', 'older']);
    expect(list[0]).toMatchObject({ title: 'Newer', status: 'review', created: '2026-09-01' });
    expect(list[1]).toMatchObject({ title: 'untitled', warning: expect.stringContaining('Frontmatter') });
  });

  it('readBrd returns summary and content; missing file errors', async () => {
    mkdirSync(brdDir, { recursive: true });
    writeFileSync(path.join(brdDir, 'a.md'), doc('A'));
    const r = await readBrd(projectDir, 'a');
    expect(r.summary.title).toBe('A');
    expect(r.content).toContain('## Summary');
    await expect(readBrd(projectDir, 'missing')).rejects.toThrow(/not found/);
  });

  it('writeBrd creates the folder, writes atomically, and returns the new summary', async () => {
    const s = await writeBrd(projectDir, 'b', doc('B'));
    expect(s).toMatchObject({ slug: 'b', title: 'B' });
    expect(readdirSync(brdDir)).toEqual(['b.md']); // no temp file left behind
  });

  it('createBrd renders the template, derives the slug, and suffixes on collision', async () => {
    const first = await createBrd(projectDir, 'Customer Onboarding', new Date('2026-09-20T10:00:00Z'));
    expect(first).toMatchObject({ slug: 'customer-onboarding', title: 'Customer Onboarding', status: 'draft', created: '2026-09-20' });
    const second = await createBrd(projectDir, 'Customer Onboarding', new Date('2026-09-20T10:00:00Z'));
    expect(second.slug).toBe('customer-onboarding-2');
    expect(existsSync(path.join(brdDir, 'customer-onboarding-2.md'))).toBe(true);
    const content = (await readBrd(projectDir, 'customer-onboarding')).content;
    expect(content).toContain('title: Customer Onboarding');
    expect(content).toContain('created: 2026-09-20');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/main/brd/__tests__/brd-files.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/main/brd/brd-files.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/main/brd/`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/brd/brd-files.ts apps/desktop/src/main/brd/__tests__/brd-files.test.ts
git commit -m "feat(brd): add contained BRD file access

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: AI draft runner and prompt

**Files:**
- Create: `prompts/brd_writer.md`
- Create: `src/main/ai/runners/brd-writer.ts`
- Test: `src/main/ai/runners/__tests__/brd-writer.test.ts`

**Interfaces:**
- Consumes: `loadTemplate` (Task 2), `tryLoadPrompt` from `prompts/prompt-loader`, `createSimpleClient` from `client/factory`, `streamText` from `ai`.
- Produces:

```ts
export interface BrdWriterConfig {
  projectDir: string;
  mode: BrdDraftMode;
  notes: string;
  existing?: string;
  title?: string;
  modelShorthand?: string;
  thinkingLevel?: ThinkingLevel;
  abortSignal?: AbortSignal;
}
export type BrdWriterEvent = { type: 'text-delta'; text: string } | { type: 'done'; text: string } | { type: 'error'; error: string };
export function buildBrdWriterPrompts(config: BrdWriterConfig, template: string, projectContext: string): { system: string; prompt: string };
export function loadBrdProjectContext(projectDir: string): string;
export async function runBrdWriter(config: BrdWriterConfig, onEvent: (e: BrdWriterEvent) => void): Promise<void>;
```

- [ ] **Step 1: Write the prompt**

```markdown
# BRD Writer

You write Business Requirements Documents (BRDs) for a software product team. You produce Markdown only, following the TEMPLATE exactly: same frontmatter fields, same level-2 section order, same heading text.

Rules:
- Fill every section. Where the input gives no information, write a short, reasonable proposal and mark it with "(assumption)" so the product owner can confirm it.
- Functional requirements are numbered items grouped under level-3 feature-area headings. Each item is one testable statement.
- Milestones are level-3 headings named "Milestone N: <Name>" in delivery order, each describing what is included. Never write dates, durations, sprint counts, or time estimates.
- Keep frontmatter: title as given, status "draft", created as given, owner as given or empty.
- Do not add sections that are not in the template. Do not wrap the document in code fences. Output the document and nothing else.

In DRAFT mode you receive the product owner's notes and write the whole document.
In REVISE mode you receive the current document and instructions; apply the instructions, keep everything else unchanged, and return the complete document.
```

Save as `apps/desktop/prompts/brd_writer.md`.

- [ ] **Step 2: Write the failing tests**

```ts
// apps/desktop/src/main/ai/runners/__tests__/brd-writer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const { streamText, createSimpleClient } = vi.hoisted(() => ({ streamText: vi.fn(), createSimpleClient: vi.fn() }));
vi.mock('ai', () => ({ streamText }));
vi.mock('../../client/factory', () => ({ createSimpleClient }));
vi.mock('../../prompts/prompt-loader', () => ({ tryLoadPrompt: () => 'SYSTEM RULES' }));
vi.mock('../../../brd/templates', () => ({ loadTemplate: () => '---\ntitle: <Title>\n---\n## Summary\n' }));

import { buildBrdWriterPrompts, loadBrdProjectContext, runBrdWriter } from '../brd-writer';

async function* parts(items: Array<Record<string, unknown>>) {
  for (const p of items) yield p;
}

describe('buildBrdWriterPrompts', () => {
  it('draft mode embeds template, context, title, and notes', () => {
    const { system, prompt } = buildBrdWriterPrompts(
      { projectDir: '/p', mode: 'draft', notes: 'Users churn.', title: 'Onboarding' },
      'TEMPLATE BODY',
      'Project: Acme',
    );
    expect(system).toContain('SYSTEM RULES');
    expect(system).toContain('## TEMPLATE\n\nTEMPLATE BODY');
    expect(system).toContain('## PROJECT CONTEXT\n\nProject: Acme');
    expect(prompt).toContain('MODE: DRAFT');
    expect(prompt).toContain('Title: Onboarding');
    expect(prompt).toContain('Users churn.');
  });

  it('revise mode includes the existing document and instructions', () => {
    const { prompt } = buildBrdWriterPrompts(
      { projectDir: '/p', mode: 'revise', notes: 'Split milestone 2.', existing: '# Doc' },
      'T',
      '',
    );
    expect(prompt).toContain('MODE: REVISE');
    expect(prompt).toContain('# Doc');
    expect(prompt).toContain('Split milestone 2.');
  });
});

describe('loadBrdProjectContext', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'brd-ctx-'));
  });
  it('summarizes project_index.json when present and is empty otherwise', () => {
    expect(loadBrdProjectContext(dir)).toBe('');
    mkdirSync(path.join(dir, '.auto-claude'), { recursive: true });
    writeFileSync(
      path.join(dir, '.auto-claude', 'project_index.json'),
      JSON.stringify({ project_root: '/x/acme', project_type: 'web', services: [{ name: 'api', language: 'ts' }, { name: 'web', language: 'ts' }] }),
    );
    const ctx = loadBrdProjectContext(dir);
    expect(ctx).toContain('acme');
    expect(ctx).toContain('web');
    expect(ctx).toContain('api');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('runBrdWriter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSimpleClient.mockResolvedValue({ model: { modelId: 'claude-sonnet' }, systemPrompt: 'S', tools: {}, maxSteps: 1 });
  });

  it('streams deltas then emits done with the full text', async () => {
    streamText.mockReturnValue({ fullStream: parts([{ type: 'text-delta', text: 'Hel' }, { type: 'text-delta', text: 'lo' }]) });
    const events: unknown[] = [];
    await runBrdWriter({ projectDir: '/p', mode: 'draft', notes: 'n', title: 't' }, (e) => events.push(e));
    expect(events).toEqual([
      { type: 'text-delta', text: 'Hel' },
      { type: 'text-delta', text: 'lo' },
      { type: 'done', text: 'Hello' },
    ]);
    expect(createSimpleClient).toHaveBeenCalledWith(expect.objectContaining({ maxSteps: 1, tools: {} }));
    expect(streamText).toHaveBeenCalledWith(expect.objectContaining({ system: expect.stringContaining('SYSTEM RULES') }));
  });

  it('emits error on a stream error part and on a thrown error', async () => {
    streamText.mockReturnValue({ fullStream: parts([{ type: 'error', error: new Error('boom') }]) });
    const events: unknown[] = [];
    await runBrdWriter({ projectDir: '/p', mode: 'draft', notes: 'n' }, (e) => events.push(e));
    expect(events).toEqual([{ type: 'error', error: 'boom' }]);

    streamText.mockImplementation(() => { throw new Error('no model'); });
    const events2: unknown[] = [];
    await runBrdWriter({ projectDir: '/p', mode: 'draft', notes: 'n' }, (e) => events2.push(e));
    expect(events2).toEqual([{ type: 'error', error: 'no model' }]);
  });

  it('uses provider instructions instead of system for codex models', async () => {
    createSimpleClient.mockResolvedValue({ model: { modelId: 'gpt-5-codex' }, systemPrompt: 'S', tools: {}, maxSteps: 1 });
    streamText.mockReturnValue({ fullStream: parts([]) });
    await runBrdWriter({ projectDir: '/p', mode: 'draft', notes: 'n' }, () => {});
    const call = streamText.mock.calls[0][0] as { system?: string; providerOptions?: { openai?: { instructions?: string } } };
    expect(call.system).toBeUndefined();
    expect(call.providerOptions?.openai?.instructions).toContain('SYSTEM RULES');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/main/ai/runners/__tests__/brd-writer.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Write `src/main/ai/runners/brd-writer.ts`**

```ts
// apps/desktop/src/main/ai/runners/brd-writer.ts
/**
 * BRD writer — drafts or revises a Business Requirements Document as Markdown.
 * Streams text only; never writes files. Modeled on runners/insights.ts.
 */
import { streamText } from 'ai';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadTemplate } from '../../brd/templates';
import type { BrdDraftMode } from '../../../shared/types/brd';
import { safeParseJson } from '../../utils/json-repair';
import { createSimpleClient } from '../client/factory';
import type { ThinkingLevel } from '../config/types';
import { tryLoadPrompt } from '../prompts/prompt-loader';

export interface BrdWriterConfig {
  projectDir: string;
  mode: BrdDraftMode;
  notes: string;
  existing?: string;
  title?: string;
  modelShorthand?: string;
  thinkingLevel?: ThinkingLevel;
  abortSignal?: AbortSignal;
}

export type BrdWriterEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; error: string };

const FALLBACK_SYSTEM =
  'You write Business Requirements Documents in Markdown following the TEMPLATE exactly. Output the document only.';

interface ProjectIndexLike {
  project_root?: string;
  project_type?: string;
  services?: Array<{ name?: string; language?: string; framework?: string }>;
}

/** Compact project summary from .auto-claude/project_index.json, or '' when absent. */
export function loadBrdProjectContext(projectDir: string): string {
  const indexPath = join(projectDir, '.auto-claude', 'project_index.json');
  if (!existsSync(indexPath)) return '';
  const parsed = safeParseJson<ProjectIndexLike>(readFileSync(indexPath, 'utf-8'));
  if (!parsed) return '';
  const lines: string[] = [];
  if (parsed.project_root) lines.push(`Project: ${parsed.project_root.split(/[\\/]/).pop()}`);
  if (parsed.project_type) lines.push(`Type: ${parsed.project_type}`);
  const services = (parsed.services ?? [])
    .map((s) => [s.name, s.language, s.framework].filter(Boolean).join(' / '))
    .filter(Boolean);
  if (services.length > 0) lines.push(`Services: ${services.join(', ')}`);
  return lines.join('\n');
}

export function buildBrdWriterPrompts(
  config: BrdWriterConfig,
  template: string,
  projectContext: string,
): { system: string; prompt: string } {
  const rules = tryLoadPrompt('brd_writer') ?? FALLBACK_SYSTEM;
  const system =
    `${rules.trim()}\n\n## TEMPLATE\n\n${template.trim()}\n` +
    (projectContext ? `\n## PROJECT CONTEXT\n\n${projectContext.trim()}\n` : '');

  const prompt =
    config.mode === 'draft'
      ? `MODE: DRAFT\n\nTitle: ${config.title ?? 'Untitled'}\nCreated: ${new Date().toISOString().slice(0, 10)}\n\nProduct owner notes:\n${config.notes.trim()}\n\nWrite the complete BRD now.`
      : `MODE: REVISE\n\nCurrent document:\n\n${(config.existing ?? '').trim()}\n\nInstructions:\n${config.notes.trim()}\n\nReturn the complete revised BRD now.`;

  return { system, prompt };
}

export async function runBrdWriter(config: BrdWriterConfig, onEvent: (e: BrdWriterEvent) => void): Promise<void> {
  const { system, prompt } = buildBrdWriterPrompts(config, loadTemplate('brd-template'), loadBrdProjectContext(config.projectDir));
  let text = '';
  try {
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
        const error = part.error instanceof Error ? part.error.message : String(part.error);
        onEvent({ type: 'error', error });
        return;
      }
    }
    onEvent({ type: 'done', text });
  } catch (err: unknown) {
    onEvent({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/main/ai/runners/__tests__/brd-writer.test.ts && npm run typecheck`
Expected: PASS (6 tests); no type errors. If `safeParseJson` has a different generic signature, adjust the call to match `src/main/utils/json-repair.ts` (the Insights runner uses it the same way).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/prompts/brd_writer.md apps/desktop/src/main/ai/runners/brd-writer.ts apps/desktop/src/main/ai/runners/__tests__/brd-writer.test.ts
git commit -m "feat(brd): add streaming BRD writer runner and prompt

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: IPC channels, handlers, preload API, shared types, mock

**Files:**
- Modify: `src/shared/constants/ipc.ts`
- Create: `src/main/ipc-handlers/brd-handlers.ts`
- Modify: `src/main/ipc-handlers/index.ts`
- Create: `src/preload/api/modules/brd-api.ts`
- Modify: `src/preload/api/agent-api.ts`
- Modify: `src/shared/types/ipc.ts`
- Modify: `src/renderer/lib/browser-mock.ts`
- Test: `src/main/ipc-handlers/__tests__/brd-handlers.test.ts`

**Interfaces:**
- Consumes: Tasks 3 and 4; `projectStore.getProject`, `safeSendToRenderer` from `ipc-handlers/utils`, `getActiveProviderFeatureSettings` from `ipc-handlers/feature-settings-helper`.
- Produces: channels and preload methods listed in the spec.

- [ ] **Step 1: Add channels**

In `src/shared/constants/ipc.ts`, after the `// Project skills` block add:

```ts
  // BRD workspace
  BRD_LIST: 'brd:list',
  BRD_READ: 'brd:read',
  BRD_WRITE: 'brd:write',
  BRD_CREATE: 'brd:create',
  BRD_DRAFT: 'brd:draft',
  BRD_DRAFT_CANCEL: 'brd:draft-cancel',
  BRD_DRAFT_CHUNK: 'brd:draft-chunk',
  BRD_DRAFT_DONE: 'brd:draft-done',
  BRD_DRAFT_ERROR: 'brd:draft-error',
```

- [ ] **Step 2: Write the failing handler test**

```ts
// apps/desktop/src/main/ipc-handlers/__tests__/brd-handlers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { handlers, sent, getProject, files, runBrdWriter, featureSettings } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  sent: [] as unknown[][],
  getProject: vi.fn(),
  files: { listBrds: vi.fn(), readBrd: vi.fn(), writeBrd: vi.fn(), createBrd: vi.fn() },
  runBrdWriter: vi.fn(),
  featureSettings: vi.fn(() => ({ model: 'sonnet', thinkingLevel: 'medium' })),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn((c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn)) },
}));
vi.mock('../utils', () => ({ safeSendToRenderer: vi.fn((_get: unknown, ...args: unknown[]) => { sent.push(args); return true; }) }));
vi.mock('../../project-store', () => ({ projectStore: { getProject } }));
vi.mock('../../brd/brd-files', () => files);
vi.mock('../../ai/runners/brd-writer', () => ({ runBrdWriter }));
vi.mock('../feature-settings-helper', () => ({ getActiveProviderFeatureSettings: featureSettings }));

import { registerBrdHandlers } from '../brd-handlers';

describe('brd handlers', () => {
  beforeEach(() => {
    handlers.clear();
    sent.length = 0;
    vi.clearAllMocks();
    getProject.mockReturnValue({ id: 'p1', path: '/repo' });
    registerBrdHandlers(() => null);
  });

  it('list/read/write/create delegate with the project path', async () => {
    files.listBrds.mockResolvedValue([{ slug: 'a' }]);
    expect(await handlers.get('brd:list')!({}, 'p1')).toEqual({ success: true, data: [{ slug: 'a' }] });
    expect(files.listBrds).toHaveBeenCalledWith('/repo');

    files.readBrd.mockResolvedValue({ summary: { slug: 'a' }, content: '#' });
    expect(await handlers.get('brd:read')!({}, 'p1', 'a')).toEqual({ success: true, data: { summary: { slug: 'a' }, content: '#' } });

    files.writeBrd.mockResolvedValue({ slug: 'a' });
    await handlers.get('brd:write')!({}, 'p1', 'a', 'content');
    expect(files.writeBrd).toHaveBeenCalledWith('/repo', 'a', 'content');

    files.createBrd.mockResolvedValue({ slug: 'new-one' });
    expect(await handlers.get('brd:create')!({}, 'p1', 'New one')).toEqual({ success: true, data: { slug: 'new-one' } });
  });

  it('returns error results for unknown projects and thrown errors', async () => {
    getProject.mockReturnValue(undefined);
    expect(await handlers.get('brd:list')!({}, 'nope')).toEqual({ success: false, error: 'Project not found: nope' });
    getProject.mockReturnValue({ id: 'p1', path: '/repo' });
    files.readBrd.mockRejectedValue(new Error('BRD not found: x'));
    expect(await handlers.get('brd:read')!({}, 'p1', 'x')).toEqual({ success: false, error: 'BRD not found: x' });
  });

  it('draft starts a run, forwards events with the runId, and clears the run on done', async () => {
    runBrdWriter.mockImplementation(async (_cfg: unknown, onEvent: (e: unknown) => void) => {
      onEvent({ type: 'text-delta', text: 'a' });
      onEvent({ type: 'done', text: 'a' });
    });
    const r = (await handlers.get('brd:draft')!({}, 'p1', { mode: 'draft', notes: 'n', title: 'T' })) as { success: boolean; data: { runId: string } };
    expect(r.success).toBe(true);
    await new Promise((res) => setTimeout(res, 10));
    expect(runBrdWriter).toHaveBeenCalledWith(
      expect.objectContaining({ projectDir: '/repo', mode: 'draft', notes: 'n', title: 'T', modelShorthand: 'sonnet', thinkingLevel: 'medium' }),
      expect.any(Function),
    );
    expect(sent).toEqual([
      ['brd:draft-chunk', { runId: r.data.runId, text: 'a' }],
      ['brd:draft-done', { runId: r.data.runId, text: 'a' }],
    ]);
    // a new run is allowed after done
    const r2 = (await handlers.get('brd:draft')!({}, 'p1', { mode: 'draft', notes: 'n' })) as { success: boolean };
    expect(r2.success).toBe(true);
    await new Promise((res) => setTimeout(res, 10)); // let the deferred run finish so it does not leak into the next test
  });

  it('revise reads the existing BRD and passes it to the runner', async () => {
    files.readBrd.mockResolvedValue({ summary: { slug: 'a' }, content: '# Existing' });
    runBrdWriter.mockImplementation(async (_c: unknown, onEvent: (e: unknown) => void) => onEvent({ type: 'done', text: 'x' }));
    await handlers.get('brd:draft')!({}, 'p1', { mode: 'revise', notes: 'fix', slug: 'a' });
    await new Promise((res) => setTimeout(res, 10));
    expect(runBrdWriter).toHaveBeenCalledWith(expect.objectContaining({ mode: 'revise', existing: '# Existing' }), expect.any(Function));
  });

  it('rejects a second concurrent draft for the same project and supports cancel', async () => {
    let release: () => void = () => {};
    runBrdWriter.mockImplementation((cfg: { abortSignal?: AbortSignal }, onEvent: (e: unknown) => void) =>
      new Promise<void>((resolve) => {
        cfg.abortSignal?.addEventListener('abort', () => { onEvent({ type: 'error', error: 'aborted' }); resolve(); });
        release = resolve;
      }),
    );
    const first = (await handlers.get('brd:draft')!({}, 'p1', { mode: 'draft', notes: 'n' })) as { success: boolean; data: { runId: string } };
    const second = await handlers.get('brd:draft')!({}, 'p1', { mode: 'draft', notes: 'n' });
    expect(second).toEqual({ success: false, error: 'A draft is already running for this project' });
    expect(await handlers.get('brd:draft-cancel')!({}, first.data.runId)).toEqual({ success: true });
    await new Promise((res) => setTimeout(res, 10));
    expect(sent.at(-1)).toEqual(['brd:draft-error', { runId: first.data.runId, error: 'cancelled' }]);
    expect(await handlers.get('brd:draft-cancel')!({}, 'unknown')).toEqual({ success: false, error: 'No running draft with id unknown' });
    release();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/main/ipc-handlers/__tests__/brd-handlers.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Write `src/main/ipc-handlers/brd-handlers.ts`**

```ts
// apps/desktop/src/main/ipc-handlers/brd-handlers.ts
import { randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import type { BrdDraftRequest, BrdSummary } from '../../shared/types/brd';
import { runBrdWriter } from '../ai/runners/brd-writer';
import type { ThinkingLevel } from '../ai/config/types';
import { createBrd, listBrds, readBrd, writeBrd } from '../brd/brd-files';
import { projectStore } from '../project-store';
import { getActiveProviderFeatureSettings } from './feature-settings-helper';
import { safeSendToRenderer } from './utils';

interface ActiveRun { runId: string; projectId: string; controller: AbortController }

const activeRuns = new Map<string, ActiveRun>(); // keyed by projectId

async function withProject<T>(projectId: string, fn: (projectPath: string) => Promise<T>): Promise<IPCResult<T>> {
  const project = projectStore.getProject(projectId);
  if (!project) return { success: false, error: `Project not found: ${projectId}` };
  try {
    return { success: true, data: await fn(project.path) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function registerBrdHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC_CHANNELS.BRD_LIST, (_e, projectId: string) => withProject(projectId, (p) => listBrds(p)));
  ipcMain.handle(IPC_CHANNELS.BRD_READ, (_e, projectId: string, slug: string) => withProject(projectId, (p) => readBrd(p, slug)));
  ipcMain.handle(IPC_CHANNELS.BRD_WRITE, (_e, projectId: string, slug: string, content: string) =>
    withProject<BrdSummary>(projectId, (p) => writeBrd(p, slug, content)),
  );
  ipcMain.handle(IPC_CHANNELS.BRD_CREATE, (_e, projectId: string, title: string) =>
    withProject<BrdSummary>(projectId, (p) => createBrd(p, title)),
  );

  ipcMain.handle(IPC_CHANNELS.BRD_DRAFT, async (_e, projectId: string, request: BrdDraftRequest): Promise<IPCResult<{ runId: string }>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    if (activeRuns.has(projectId)) return { success: false, error: 'A draft is already running for this project' };

    let existing: string | undefined;
    if (request.mode === 'revise' && request.slug) {
      try {
        existing = (await readBrd(project.path, request.slug)).content;
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    const runId = randomUUID();
    const controller = new AbortController();
    activeRuns.set(projectId, { runId, projectId, controller });
    const { model, thinkingLevel } = getActiveProviderFeatureSettings('roadmap');

    // Defer past the invoke reply so the renderer knows the runId before any event arrives.
    setTimeout(() => {
      if (controller.signal.aborted) {
        activeRuns.delete(projectId);
        safeSendToRenderer(getMainWindow, IPC_CHANNELS.BRD_DRAFT_ERROR, { runId, error: 'cancelled' });
        return;
      }
      void runBrdWriter(
      {
        projectDir: project.path,
        mode: request.mode,
        notes: request.notes,
        existing,
        title: request.title,
        modelShorthand: model,
        thinkingLevel: thinkingLevel as ThinkingLevel,
        abortSignal: controller.signal,
      },
      (event) => {
        if (event.type === 'text-delta') {
          safeSendToRenderer(getMainWindow, IPC_CHANNELS.BRD_DRAFT_CHUNK, { runId, text: event.text });
          return;
        }
        if (activeRuns.get(projectId)?.runId === runId) activeRuns.delete(projectId);
        if (event.type === 'done') {
          safeSendToRenderer(getMainWindow, IPC_CHANNELS.BRD_DRAFT_DONE, { runId, text: event.text });
        } else {
          safeSendToRenderer(getMainWindow, IPC_CHANNELS.BRD_DRAFT_ERROR, { runId, error: event.error });
        }
      },
    );
    }, 0);

    return { success: true, data: { runId } };
  });

  ipcMain.handle(IPC_CHANNELS.BRD_DRAFT_CANCEL, (_e, runId: string): IPCResult => {
    const run = [...activeRuns.values()].find((r) => r.runId === runId);
    if (!run) return { success: false, error: `No running draft with id ${runId}` };
    run.controller.abort();
    return { success: true };
  });
}
```

Register it in `src/main/ipc-handlers/index.ts`: import `registerBrdHandlers` from `./brd-handlers` and call `registerBrdHandlers(getMainWindow);` right after `registerInsightsHandlers(getMainWindow);`.

- [ ] **Step 5: Run the handler test**

Run: `cd apps/desktop && npx vitest run src/main/ipc-handlers/__tests__/brd-handlers.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Preload module**

```ts
// apps/desktop/src/preload/api/modules/brd-api.ts
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import type { BrdDraftChunk, BrdDraftDone, BrdDraftError, BrdDraftRequest, BrdSummary } from '../../../shared/types/brd';
import { createIpcListener, invokeIpc, type IpcListenerCleanup } from './ipc-utils';

export interface BrdAPI {
  brdList: (projectId: string) => Promise<IPCResult<BrdSummary[]>>;
  brdRead: (projectId: string, slug: string) => Promise<IPCResult<{ summary: BrdSummary; content: string }>>;
  brdWrite: (projectId: string, slug: string, content: string) => Promise<IPCResult<BrdSummary>>;
  brdCreate: (projectId: string, title: string) => Promise<IPCResult<BrdSummary>>;
  brdDraft: (projectId: string, request: BrdDraftRequest) => Promise<IPCResult<{ runId: string }>>;
  brdDraftCancel: (runId: string) => Promise<IPCResult>;
  onBrdDraftChunk: (callback: (chunk: BrdDraftChunk) => void) => IpcListenerCleanup;
  onBrdDraftDone: (callback: (done: BrdDraftDone) => void) => IpcListenerCleanup;
  onBrdDraftError: (callback: (error: BrdDraftError) => void) => IpcListenerCleanup;
}

export const createBrdAPI = (): BrdAPI => ({
  brdList: (projectId) => invokeIpc(IPC_CHANNELS.BRD_LIST, projectId),
  brdRead: (projectId, slug) => invokeIpc(IPC_CHANNELS.BRD_READ, projectId, slug),
  brdWrite: (projectId, slug, content) => invokeIpc(IPC_CHANNELS.BRD_WRITE, projectId, slug, content),
  brdCreate: (projectId, title) => invokeIpc(IPC_CHANNELS.BRD_CREATE, projectId, title),
  brdDraft: (projectId, request) => invokeIpc(IPC_CHANNELS.BRD_DRAFT, projectId, request),
  brdDraftCancel: (runId) => invokeIpc(IPC_CHANNELS.BRD_DRAFT_CANCEL, runId),
  onBrdDraftChunk: (callback) => createIpcListener<[BrdDraftChunk]>(IPC_CHANNELS.BRD_DRAFT_CHUNK, callback),
  onBrdDraftDone: (callback) => createIpcListener<[BrdDraftDone]>(IPC_CHANNELS.BRD_DRAFT_DONE, callback),
  onBrdDraftError: (callback) => createIpcListener<[BrdDraftError]>(IPC_CHANNELS.BRD_DRAFT_ERROR, callback),
});
```

In `src/preload/api/agent-api.ts`: import `{ BrdAPI, createBrdAPI } from './modules/brd-api'`, add `BrdAPI` to the `AgentAPI` intersection/extends list the way `InsightsAPI` is included, create `const brdAPI = createBrdAPI();` next to `insightsAPI`, and spread `...brdAPI` in the returned object.

In `src/shared/types/ipc.ts`, next to the Insights declarations, add (import the BRD types from `./brd`):

```ts
  // BRD workspace
  brdList: (projectId: string) => Promise<IPCResult<BrdSummary[]>>;
  brdRead: (projectId: string, slug: string) => Promise<IPCResult<{ summary: BrdSummary; content: string }>>;
  brdWrite: (projectId: string, slug: string, content: string) => Promise<IPCResult<BrdSummary>>;
  brdCreate: (projectId: string, title: string) => Promise<IPCResult<BrdSummary>>;
  brdDraft: (projectId: string, request: BrdDraftRequest) => Promise<IPCResult<{ runId: string }>>;
  brdDraftCancel: (runId: string) => Promise<IPCResult>;
  onBrdDraftChunk: (callback: (chunk: BrdDraftChunk) => void) => () => void;
  onBrdDraftDone: (callback: (done: BrdDraftDone) => void) => () => void;
  onBrdDraftError: (callback: (error: BrdDraftError) => void) => () => void;
```

In `src/renderer/lib/browser-mock.ts`, next to the `listSkills`/`refreshSkills` stubs add:

```ts
  brdList: async () => ({ success: true, data: [] }),
  brdRead: async () => ({ success: false, error: 'Not available in browser mock' }),
  brdWrite: async () => ({ success: false, error: 'Not available in browser mock' }),
  brdCreate: async () => ({ success: false, error: 'Not available in browser mock' }),
  brdDraft: async () => ({ success: false, error: 'Not available in browser mock' }),
  brdDraftCancel: async () => ({ success: false, error: 'Not available in browser mock' }),
  onBrdDraftChunk: () => () => {},
  onBrdDraftDone: () => () => {},
  onBrdDraftError: () => () => {},
```

- [ ] **Step 7: Typecheck, lint, commit**

Run: `cd apps/desktop && npm run typecheck && npm run lint`
Expected: clean.

```bash
git add apps/desktop/src/shared/constants/ipc.ts apps/desktop/src/main/ipc-handlers/brd-handlers.ts apps/desktop/src/main/ipc-handlers/index.ts apps/desktop/src/preload/api/modules/brd-api.ts apps/desktop/src/preload/api/agent-api.ts apps/desktop/src/shared/types/ipc.ts apps/desktop/src/renderer/lib/browser-mock.ts apps/desktop/src/main/ipc-handlers/__tests__/brd-handlers.test.ts
git commit -m "feat(brd): add BRD IPC handlers, preload API, and draft run management

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: i18n namespace, view registration, and store

**Files:**
- Create: `src/shared/i18n/locales/en/requirements.json`, `src/shared/i18n/locales/fr/requirements.json`
- Modify: `src/shared/i18n/index.ts`, `locales/{en,fr}/navigation.json`
- Modify: `src/renderer/components/Sidebar.tsx`, `src/renderer/App.tsx`
- Create: `src/renderer/stores/brd-store.ts`
- Create: `src/renderer/components/requirements/RequirementsView.tsx` (placeholder shell, filled in Task 7)
- Test: `src/renderer/stores/__tests__/brd-store.test.ts`

**Interfaces:**
- Produces: `useBrdStore`, `setupBrdListeners(): () => void`, `RequirementsView({ projectId })`.

- [ ] **Step 1: i18n files**

`src/shared/i18n/locales/en/requirements.json`:

```json
{
  "title": "Requirements",
  "subtitle": "Business requirements documents stored in docs/brd",
  "list": {
    "newBrd": "New BRD",
    "empty": "No BRDs yet. Create one to get started.",
    "warning": "Needs attention"
  },
  "status": { "draft": "Draft", "review": "In review", "approved": "Approved" },
  "newDialog": {
    "title": "New BRD",
    "description": "A Markdown file will be created under docs/brd from the template.",
    "titleLabel": "Title",
    "titlePlaceholder": "Customer onboarding",
    "create": "Create",
    "cancel": "Cancel"
  },
  "editor": {
    "noSelection": "Select a BRD or create a new one.",
    "save": "Save",
    "saving": "Saving…",
    "unsaved": "Unsaved changes",
    "saved": "Saved",
    "preview": "Preview",
    "markdown": "Markdown",
    "loadError": "Could not load this BRD: {{error}}",
    "saveError": "Could not save: {{error}}"
  },
  "unsavedDialog": {
    "title": "Discard unsaved changes?",
    "description": "You have unsaved changes in the current BRD. Switching will discard them.",
    "discard": "Discard changes",
    "cancel": "Keep editing"
  },
  "structure": {
    "title": "Structure",
    "ok": "All required sections are filled",
    "missing": "Missing",
    "emptySection": "Empty",
    "optional": "optional",
    "frontmatter": "Frontmatter"
  },
  "assist": {
    "title": "AI assist",
    "notesLabel": "Notes or instructions",
    "notesPlaceholderDraft": "Paste rough notes, goals, and constraints. The agent drafts the whole BRD.",
    "notesPlaceholderRevise": "Describe what to change, for example: split milestone 2 into two.",
    "draft": "Draft from notes",
    "revise": "Revise with instructions",
    "streaming": "Writing…",
    "cancel": "Cancel",
    "proposalTitle": "Proposed document",
    "accept": "Accept into editor",
    "discard": "Discard",
    "error": "The assistant failed: {{error}}"
  }
}
```

`src/shared/i18n/locales/fr/requirements.json`:

```json
{
  "title": "Exigences",
  "subtitle": "Documents d'exigences métier stockés dans docs/brd",
  "list": {
    "newBrd": "Nouveau BRD",
    "empty": "Aucun BRD pour l'instant. Créez-en un pour commencer.",
    "warning": "À vérifier"
  },
  "status": { "draft": "Brouillon", "review": "En relecture", "approved": "Approuvé" },
  "newDialog": {
    "title": "Nouveau BRD",
    "description": "Un fichier Markdown sera créé sous docs/brd à partir du modèle.",
    "titleLabel": "Titre",
    "titlePlaceholder": "Onboarding client",
    "create": "Créer",
    "cancel": "Annuler"
  },
  "editor": {
    "noSelection": "Sélectionnez un BRD ou créez-en un nouveau.",
    "save": "Enregistrer",
    "saving": "Enregistrement…",
    "unsaved": "Modifications non enregistrées",
    "saved": "Enregistré",
    "preview": "Aperçu",
    "markdown": "Markdown",
    "loadError": "Impossible de charger ce BRD : {{error}}",
    "saveError": "Impossible d'enregistrer : {{error}}"
  },
  "unsavedDialog": {
    "title": "Abandonner les modifications ?",
    "description": "Le BRD actuel contient des modifications non enregistrées. Changer de document les supprimera.",
    "discard": "Abandonner",
    "cancel": "Continuer l'édition"
  },
  "structure": {
    "title": "Structure",
    "ok": "Toutes les sections obligatoires sont remplies",
    "missing": "Manquante",
    "emptySection": "Vide",
    "optional": "optionnelle",
    "frontmatter": "En-tête"
  },
  "assist": {
    "title": "Assistant IA",
    "notesLabel": "Notes ou instructions",
    "notesPlaceholderDraft": "Collez des notes brutes, objectifs et contraintes. L'agent rédige tout le BRD.",
    "notesPlaceholderRevise": "Décrivez le changement souhaité, par exemple : scinder le jalon 2 en deux.",
    "draft": "Rédiger à partir des notes",
    "revise": "Réviser selon les instructions",
    "streaming": "Rédaction…",
    "cancel": "Annuler",
    "proposalTitle": "Document proposé",
    "accept": "Accepter dans l'éditeur",
    "discard": "Rejeter",
    "error": "L'assistant a échoué : {{error}}"
  }
}
```

In `src/shared/i18n/index.ts`: add `import enRequirements from './locales/en/requirements.json';` and `import frRequirements from './locales/fr/requirements.json';`, add `requirements: enRequirements` / `requirements: frRequirements` to the `resources` objects, and append `'requirements'` to the `ns` array.

In `locales/en/navigation.json` `items` add `"requirements": "Requirements"`; in `fr` add `"requirements": "Exigences"`.

- [ ] **Step 2: Sidebar and router**

In `src/renderer/components/Sidebar.tsx`: extend `SidebarView` with `| 'requirements'`, import `ClipboardList` from `lucide-react`, and insert `{ id: 'requirements', labelKey: 'navigation:items.requirements', icon: ClipboardList, shortcut: 'Q' },` right after the `roadmap` entry in `baseNavItems`.

In `src/renderer/App.tsx`: add `import { RequirementsView } from './components/requirements/RequirementsView';` next to the `Roadmap` import, and after the roadmap branch add:

```tsx
                  {activeView === 'requirements' && (activeProjectId || selectedProjectId) && (
                    <ErrorBoundary>
                      <RequirementsView projectId={activeProjectId || selectedProjectId!} />
                    </ErrorBoundary>
                  )}
```

Create a placeholder `src/renderer/components/requirements/RequirementsView.tsx` so the app compiles (Task 7 replaces it):

```tsx
// apps/desktop/src/renderer/components/requirements/RequirementsView.tsx
import { useTranslation } from 'react-i18next';

export function RequirementsView({ projectId }: { projectId: string }) {
  const { t } = useTranslation('requirements');
  return <div className="p-6 text-sm text-muted-foreground" data-project-id={projectId}>{t('title')}</div>;
}
```

- [ ] **Step 3: Write the failing store test**

```ts
// apps/desktop/src/renderer/stores/__tests__/brd-store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useBrdStore, setupBrdListeners } from '../brd-store';

const api = {
  brdList: vi.fn(),
  brdRead: vi.fn(),
  brdWrite: vi.fn(),
  brdCreate: vi.fn(),
  brdDraft: vi.fn(),
  brdDraftCancel: vi.fn(),
  onBrdDraftChunk: vi.fn(),
  onBrdDraftDone: vi.fn(),
  onBrdDraftError: vi.fn(),
};
type Listener<T> = (payload: T) => void;
let chunkCb: Listener<{ runId: string; text: string }> = () => {};
let doneCb: Listener<{ runId: string; text: string }> = () => {};
let errorCb: Listener<{ runId: string; error: string }> = () => {};

const summary = { slug: 'a', title: 'A', status: 'draft' as const, modifiedAt: 't' };
const doc = '---\ntitle: A\nstatus: draft\ncreated: 2026-09-20\n---\n# A\n\n## Summary\n\nText\n';

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { window: unknown }).window = { electronAPI: api };
  api.onBrdDraftChunk.mockImplementation((cb) => { chunkCb = cb; return () => {}; });
  api.onBrdDraftDone.mockImplementation((cb) => { doneCb = cb; return () => {}; });
  api.onBrdDraftError.mockImplementation((cb) => { errorCb = cb; return () => {}; });
  useBrdStore.getState().reset();
});

describe('brd-store', () => {
  it('load lists BRDs', async () => {
    api.brdList.mockResolvedValue({ success: true, data: [summary] });
    await useBrdStore.getState().load('p1');
    expect(useBrdStore.getState().brds).toEqual([summary]);
  });

  it('select reads content and computes structure; refuses when dirty unless forced', async () => {
    api.brdRead.mockResolvedValue({ success: true, data: { summary, content: doc } });
    await useBrdStore.getState().select('p1', 'a');
    const s = useBrdStore.getState();
    expect(s.selectedSlug).toBe('a');
    expect(s.content).toBe(doc);
    expect(s.structure?.sections.find((x) => x.heading === 'Summary')?.present).toBe(true);

    s.setContent(`${doc}\nmore`);
    expect(useBrdStore.getState().isDirty()).toBe(true);
    expect(await useBrdStore.getState().select('p1', 'b')).toBe(false);
    expect(useBrdStore.getState().selectedSlug).toBe('a');
    api.brdRead.mockResolvedValue({ success: true, data: { summary: { ...summary, slug: 'b' }, content: doc } });
    expect(await useBrdStore.getState().select('p1', 'b', { force: true })).toBe(true);
    expect(useBrdStore.getState().selectedSlug).toBe('b');
  });

  it('save writes content, clears dirty, and refreshes the list entry', async () => {
    api.brdRead.mockResolvedValue({ success: true, data: { summary, content: doc } });
    api.brdList.mockResolvedValue({ success: true, data: [summary] });
    await useBrdStore.getState().load('p1');
    await useBrdStore.getState().select('p1', 'a');
    useBrdStore.getState().setContent(`${doc}\nmore`);
    api.brdWrite.mockResolvedValue({ success: true, data: { ...summary, title: 'A2' } });
    await useBrdStore.getState().save('p1');
    expect(api.brdWrite).toHaveBeenCalledWith('p1', 'a', `${doc}\nmore`);
    expect(useBrdStore.getState().isDirty()).toBe(false);
    expect(useBrdStore.getState().brds[0].title).toBe('A2');
  });

  it('save failure keeps content dirty and stores the error', async () => {
    api.brdRead.mockResolvedValue({ success: true, data: { summary, content: doc } });
    await useBrdStore.getState().select('p1', 'a');
    useBrdStore.getState().setContent('x');
    api.brdWrite.mockResolvedValue({ success: false, error: 'disk full' });
    await useBrdStore.getState().save('p1');
    expect(useBrdStore.getState().isDirty()).toBe(true);
    expect(useBrdStore.getState().error).toBe('disk full');
  });

  it('create adds the BRD, selects it, and returns the slug', async () => {
    api.brdCreate.mockResolvedValue({ success: true, data: { ...summary, slug: 'new' } });
    api.brdRead.mockResolvedValue({ success: true, data: { summary: { ...summary, slug: 'new' }, content: doc } });
    expect(await useBrdStore.getState().create('p1', 'New')).toBe('new');
    expect(useBrdStore.getState().brds[0].slug).toBe('new');
    expect(useBrdStore.getState().selectedSlug).toBe('new');
  });

  it('draft streams into a proposal, accept replaces content and marks dirty, discard clears', async () => {
    const stop = setupBrdListeners();
    api.brdRead.mockResolvedValue({ success: true, data: { summary, content: doc } });
    await useBrdStore.getState().select('p1', 'a');
    api.brdDraft.mockResolvedValue({ success: true, data: { runId: 'r1' } });
    await useBrdStore.getState().startDraft('p1', 'revise', 'shorter');
    expect(api.brdDraft).toHaveBeenCalledWith('p1', { mode: 'revise', notes: 'shorter', slug: 'a', title: 'A' });
    expect(useBrdStore.getState().draft.status).toBe('streaming');
    chunkCb({ runId: 'r1', text: 'NEW ' });
    chunkCb({ runId: 'other', text: 'IGNORED' });
    chunkCb({ runId: 'r1', text: 'DOC' });
    expect(useBrdStore.getState().draft.text).toBe('NEW DOC');
    doneCb({ runId: 'r1', text: 'NEW DOC' });
    expect(useBrdStore.getState().draft.status).toBe('proposal');
    useBrdStore.getState().acceptDraft();
    expect(useBrdStore.getState().content).toBe('NEW DOC');
    expect(useBrdStore.getState().isDirty()).toBe(true);
    expect(useBrdStore.getState().draft.status).toBe('idle');

    api.brdDraft.mockResolvedValue({ success: true, data: { runId: 'r2' } });
    await useBrdStore.getState().startDraft('p1', 'revise', 'again');
    errorCb({ runId: 'r2', error: 'boom' });
    expect(useBrdStore.getState().draft).toMatchObject({ status: 'idle', error: 'boom' });
    useBrdStore.getState().discardDraft();
    expect(useBrdStore.getState().draft.text).toBe('');
    stop();
  });

  it('cancelDraft calls the API with the run id', async () => {
    setupBrdListeners();
    api.brdDraft.mockResolvedValue({ success: true, data: { runId: 'r9' } });
    api.brdDraftCancel.mockResolvedValue({ success: true });
    await useBrdStore.getState().startDraft('p1', 'draft', 'notes');
    await useBrdStore.getState().cancelDraft();
    expect(api.brdDraftCancel).toHaveBeenCalledWith('r9');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/renderer/stores/__tests__/brd-store.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 5: Write `src/renderer/stores/brd-store.ts`**

```ts
// apps/desktop/src/renderer/stores/brd-store.ts
import { create } from 'zustand';

import { checkBrdStructure } from '../../shared/brd/structure';
import type { BrdDraftMode, BrdStructureResult, BrdSummary } from '../../shared/types/brd';

export type DraftStatus = 'idle' | 'streaming' | 'proposal';

interface DraftState {
  status: DraftStatus;
  runId?: string;
  text: string;
  error?: string;
}

interface BrdState {
  brds: BrdSummary[];
  selectedSlug: string | null;
  selectedSummary: BrdSummary | null;
  content: string;
  savedContent: string;
  structure: BrdStructureResult | null;
  draft: DraftState;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  isDirty: () => boolean;
  reset: () => void;
  load: (projectId: string) => Promise<void>;
  select: (projectId: string, slug: string, opts?: { force?: boolean }) => Promise<boolean>;
  setContent: (content: string) => void;
  save: (projectId: string) => Promise<void>;
  create: (projectId: string, title: string) => Promise<string | null>;
  startDraft: (projectId: string, mode: BrdDraftMode, notes: string) => Promise<void>;
  cancelDraft: () => Promise<void>;
  acceptDraft: () => void;
  discardDraft: () => void;
}

const idleDraft: DraftState = { status: 'idle', text: '' };

const initial = {
  brds: [] as BrdSummary[],
  selectedSlug: null as string | null,
  selectedSummary: null as BrdSummary | null,
  content: '',
  savedContent: '',
  structure: null as BrdStructureResult | null,
  draft: idleDraft,
  isLoading: false,
  isSaving: false,
  error: null as string | null,
};

export const useBrdStore = create<BrdState>((set, get) => ({
  ...initial,

  isDirty: () => get().content !== get().savedContent,

  reset: () => set({ ...initial, draft: { ...idleDraft } }),

  load: async (projectId) => {
    set({ isLoading: true, error: null });
    const result = await window.electronAPI.brdList(projectId);
    if (result.success && result.data) set({ brds: result.data, isLoading: false });
    else set({ error: result.error ?? 'Unknown error', isLoading: false });
  },

  select: async (projectId, slug, opts) => {
    if (get().isDirty() && !opts?.force) return false;
    set({ isLoading: true, error: null, draft: { ...idleDraft } });
    const result = await window.electronAPI.brdRead(projectId, slug);
    if (!result.success || !result.data) {
      set({ error: result.error ?? 'Unknown error', isLoading: false });
      return false;
    }
    const { summary, content } = result.data;
    set({
      selectedSlug: slug,
      selectedSummary: summary,
      content,
      savedContent: content,
      structure: checkBrdStructure(content),
      isLoading: false,
    });
    return true;
  },

  setContent: (content) => set({ content, structure: checkBrdStructure(content) }),

  save: async (projectId) => {
    const { selectedSlug, content } = get();
    if (!selectedSlug) return;
    set({ isSaving: true, error: null });
    const result = await window.electronAPI.brdWrite(projectId, selectedSlug, content);
    if (!result.success || !result.data) {
      set({ error: result.error ?? 'Unknown error', isSaving: false });
      return;
    }
    const summary = result.data;
    set((s) => ({
      savedContent: content,
      selectedSummary: summary,
      brds: s.brds.some((b) => b.slug === summary.slug)
        ? s.brds.map((b) => (b.slug === summary.slug ? summary : b))
        : [summary, ...s.brds],
      isSaving: false,
    }));
  },

  create: async (projectId, title) => {
    set({ error: null });
    const result = await window.electronAPI.brdCreate(projectId, title);
    if (!result.success || !result.data) {
      set({ error: result.error ?? 'Unknown error' });
      return null;
    }
    const summary = result.data;
    set((s) => ({ brds: [summary, ...s.brds] }));
    await get().select(projectId, summary.slug, { force: true });
    return summary.slug;
  },

  startDraft: async (projectId, mode, notes) => {
    const { selectedSlug, selectedSummary } = get();
    set({ draft: { status: 'streaming', text: '' } });
    const result = await window.electronAPI.brdDraft(projectId, {
      mode,
      notes,
      ...(selectedSlug ? { slug: selectedSlug } : {}),
      ...(selectedSummary?.title ? { title: selectedSummary.title } : {}),
    });
    if (!result.success || !result.data) {
      set({ draft: { status: 'idle', text: '', error: result.error ?? 'Unknown error' } });
      return;
    }
    set({ draft: { status: 'streaming', runId: result.data.runId, text: '' } });
  },

  cancelDraft: async () => {
    const { runId } = get().draft;
    if (runId) await window.electronAPI.brdDraftCancel(runId);
  },

  acceptDraft: () => {
    const { draft } = get();
    if (draft.status !== 'proposal') return;
    set({ content: draft.text, structure: checkBrdStructure(draft.text), draft: { ...idleDraft } });
  },

  discardDraft: () => set({ draft: { ...idleDraft } }),
}));

/** Subscribe to draft stream events. Returns an unsubscribe function. */
export function setupBrdListeners(): () => void {
  const store = useBrdStore;
  const isCurrent = (runId: string) => store.getState().draft.runId === runId;

  const offChunk = window.electronAPI.onBrdDraftChunk(({ runId, text }) => {
    if (!isCurrent(runId)) return;
    store.setState((s) => ({ draft: { ...s.draft, text: s.draft.text + text } }));
  });
  const offDone = window.electronAPI.onBrdDraftDone(({ runId, text }) => {
    if (!isCurrent(runId)) return;
    store.setState({ draft: { status: 'proposal', runId, text } });
  });
  const offError = window.electronAPI.onBrdDraftError(({ runId, error }) => {
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

Note on the streaming test: `startDraft` sets `runId` only after the IPC promise resolves, so listeners compare against the stored `runId`; chunks for other run ids are ignored, which the test checks.

- [ ] **Step 6: Run tests, typecheck, lint, commit**

Run: `cd apps/desktop && npx vitest run src/renderer/stores/__tests__/brd-store.test.ts && npm run typecheck && npm run lint`
Expected: PASS (7 tests); clean.

```bash
git add apps/desktop/src/shared/i18n apps/desktop/src/renderer/components/Sidebar.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/stores/brd-store.ts apps/desktop/src/renderer/stores/__tests__/brd-store.test.ts apps/desktop/src/renderer/components/requirements/RequirementsView.tsx
git commit -m "feat(brd): add requirements view registration, i18n, and BRD store

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Requirements view components

**Files:**
- Replace: `src/renderer/components/requirements/RequirementsView.tsx`
- Create: `src/renderer/components/requirements/BrdList.tsx`, `NewBrdDialog.tsx`, `BrdEditor.tsx`, `StructureChecklist.tsx`, `BrdAssistPanel.tsx`
- Test: `src/renderer/components/requirements/__tests__/BrdEditor.test.tsx`, `__tests__/RequirementsView.test.tsx`

**Interfaces:**
- Consumes: `useBrdStore`, `setupBrdListeners`, UI primitives (`Button`, `Badge`, `Input`, `Textarea`, `Dialog*`, `AlertDialog*`, `ScrollArea`), `ReactMarkdown` + `remarkGfm`.

- [ ] **Step 1: Write the failing component tests**

```tsx
/**
 * @vitest-environment jsdom
 */
// apps/desktop/src/renderer/components/requirements/__tests__/BrdEditor.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrdEditor } from '../BrdEditor';
import { useBrdStore } from '../../../stores/brd-store';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.error ? `${k}:${o.error}` : k), i18n: { language: 'en' } }),
}));
vi.mock('react-markdown', () => ({ default: ({ children }: { children: string }) => <div data-testid="preview">{children}</div> }));
vi.mock('remark-gfm', () => ({ default: () => null }));

const doc = '---\ntitle: A\nstatus: draft\ncreated: 2026-09-20\n---\n# A\n\n## Summary\n\nText\n';
const api = { brdWrite: vi.fn(), brdDraft: vi.fn(), brdDraftCancel: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  useBrdStore.getState().reset();
  useBrdStore.setState({
    selectedSlug: 'a',
    selectedSummary: { slug: 'a', title: 'A', status: 'draft', modifiedAt: 't' },
    content: doc,
    savedContent: doc,
    structure: useBrdStore.getState().structure,
  });
  useBrdStore.getState().setContent(doc);
});

describe('BrdEditor', () => {
  it('shows the checklist with required sections and marks missing ones', () => {
    render(<BrdEditor projectId="p1" />);
    expect(screen.getByText('Summary')).toBeInTheDocument();
    expect(screen.getAllByText('structure.missing').length).toBeGreaterThan(0); // Problem and goals etc. are missing
    expect(screen.getByTestId('preview')).toHaveTextContent('# A');
  });

  it('typing marks the document dirty and Save writes it', async () => {
    api.brdWrite.mockResolvedValue({ success: true, data: { slug: 'a', title: 'A', status: 'draft', modifiedAt: 't2' } });
    render(<BrdEditor projectId="p1" />);
    fireEvent.change(screen.getByRole('textbox', { name: 'editor.markdown' }), { target: { value: `${doc}\nmore` } });
    expect(screen.getByText('editor.unsaved')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'editor.save' }));
    await screen.findByText('editor.saved');
    expect(api.brdWrite).toHaveBeenCalledWith('p1', 'a', `${doc}\nmore`);
  });

  it('assist panel enables Revise for a non-empty document and shows a proposal to accept', async () => {
    api.brdDraft.mockResolvedValue({ success: true, data: { runId: 'r1' } });
    render(<BrdEditor projectId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: 'assist.title' }));
    const revise = screen.getByRole('button', { name: 'assist.revise' });
    expect(revise).toBeDisabled(); // no notes yet
    fireEvent.change(screen.getByRole('textbox', { name: 'assist.notesLabel' }), { target: { value: 'shorter' } });
    expect(revise).toBeEnabled();
    fireEvent.click(revise);
    await screen.findByText('assist.streaming');
    useBrdStore.setState({ draft: { status: 'proposal', runId: 'r1', text: 'PROPOSED' } });
    fireEvent.click(await screen.findByRole('button', { name: 'assist.accept' }));
    expect(useBrdStore.getState().content).toBe('PROPOSED');
    expect(screen.getByText('editor.unsaved')).toBeInTheDocument();
  });
});
```

```tsx
/**
 * @vitest-environment jsdom
 */
// apps/desktop/src/renderer/components/requirements/__tests__/RequirementsView.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RequirementsView } from '../RequirementsView';
import { useBrdStore } from '../../../stores/brd-store';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }) }));
vi.mock('react-markdown', () => ({ default: ({ children }: { children: string }) => <div>{children}</div> }));
vi.mock('remark-gfm', () => ({ default: () => null }));

const api = {
  brdList: vi.fn(),
  brdRead: vi.fn(),
  brdCreate: vi.fn(),
  onBrdDraftChunk: vi.fn(() => () => undefined),
  onBrdDraftDone: vi.fn(() => () => undefined),
  onBrdDraftError: vi.fn(() => () => undefined),
};
const doc = '---\ntitle: A\nstatus: draft\ncreated: 2026-09-20\n---\n# A\n';

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  useBrdStore.getState().reset();
});

describe('RequirementsView', () => {
  it('lists BRDs on mount and opens one on click', async () => {
    api.brdList.mockResolvedValue({ success: true, data: [{ slug: 'a', title: 'A', status: 'review', modifiedAt: 't' }] });
    api.brdRead.mockResolvedValue({ success: true, data: { summary: { slug: 'a', title: 'A', status: 'review', modifiedAt: 't' }, content: doc } });
    render(<RequirementsView projectId="p1" />);
    expect(await screen.findByText('A')).toBeInTheDocument();
    expect(screen.getByText('status.review')).toBeInTheDocument();
    fireEvent.click(screen.getByText('A'));
    await waitFor(() => expect(api.brdRead).toHaveBeenCalledWith('p1', 'a'));
    expect(await screen.findByRole('textbox', { name: 'editor.markdown' })).toHaveValue(doc);
  });

  it('shows the empty state and creates a BRD through the dialog', async () => {
    api.brdList.mockResolvedValue({ success: true, data: [] });
    api.brdCreate.mockResolvedValue({ success: true, data: { slug: 'onboarding', title: 'Onboarding', status: 'draft', modifiedAt: 't' } });
    api.brdRead.mockResolvedValue({ success: true, data: { summary: { slug: 'onboarding', title: 'Onboarding', status: 'draft', modifiedAt: 't' }, content: doc } });
    render(<RequirementsView projectId="p1" />);
    expect(await screen.findByText('list.empty')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'list.newBrd' }));
    fireEvent.change(await screen.findByLabelText('newDialog.titleLabel'), { target: { value: 'Onboarding' } });
    fireEvent.click(screen.getByRole('button', { name: 'newDialog.create' }));
    await waitFor(() => expect(api.brdCreate).toHaveBeenCalledWith('p1', 'Onboarding'));
    expect((await screen.findAllByText('Onboarding')).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/renderer/components/requirements/`
Expected: FAIL (components missing; the placeholder view renders only the title).

- [ ] **Step 3: Write the components**

`StructureChecklist.tsx`:

```tsx
// apps/desktop/src/renderer/components/requirements/StructureChecklist.tsx
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertCircle, Circle } from 'lucide-react';

import type { BrdStructureResult } from '../../../shared/types/brd';
import { cn } from '../../lib/utils';

export function StructureChecklist({ result }: { result: BrdStructureResult | null }) {
  const { t } = useTranslation('requirements');
  if (!result) return null;
  return (
    <div className="rounded-md border border-border p-3 text-xs">
      <div className="mb-2 font-medium">{t('structure.title')}</div>
      {result.frontmatterErrors.length > 0 && (
        <div className="mb-2 flex items-start gap-2 text-amber-600">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {t('structure.frontmatter')}: {result.frontmatterErrors.join('; ')}
          </span>
        </div>
      )}
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
        {result.sections.map((s) => {
          const good = s.present && !s.empty;
          const Icon = good ? CheckCircle2 : s.required ? AlertCircle : Circle;
          return (
            <li key={s.heading} className={cn('flex items-center gap-2', good ? 'text-foreground' : s.required ? 'text-amber-600' : 'text-muted-foreground')}>
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{s.heading}</span>
              {!s.required && <span className="text-muted-foreground">({t('structure.optional')})</span>}
              {!good && s.required && (
                <span className="flex items-center gap-1">
                  <span aria-hidden="true">·</span>
                  <span>{s.present ? t('structure.emptySection') : t('structure.missing')}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {result.ok && <div className="mt-2 text-green-600">{t('structure.ok')}</div>}
    </div>
  );
}
```

`BrdAssistPanel.tsx`:

```tsx
// apps/desktop/src/renderer/components/requirements/BrdAssistPanel.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Sparkles, Loader2 } from 'lucide-react';

import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { cn } from '../../lib/utils';
import { useBrdStore } from '../../stores/brd-store';

export function BrdAssistPanel({ projectId, documentIsEmpty }: { projectId: string; documentIsEmpty: boolean }) {
  const { t } = useTranslation('requirements');
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const { draft, startDraft, cancelDraft, acceptDraft, discardDraft } = useBrdStore();
  const streaming = draft.status === 'streaming';
  const canRun = notes.trim().length > 0 && !streaming;

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
        <label className="block text-xs font-medium" htmlFor="brd-assist-notes">
          {t('assist.notesLabel')}
        </label>
        <Textarea
          id="brd-assist-notes"
          aria-label={t('assist.notesLabel')}
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={documentIsEmpty ? t('assist.notesPlaceholderDraft') : t('assist.notesPlaceholderRevise')}
          disabled={streaming}
        />
        <div className="flex items-center gap-2">
          {documentIsEmpty ? (
            <Button size="sm" disabled={!canRun} onClick={() => void startDraft(projectId, 'draft', notes)}>
              {t('assist.draft')}
            </Button>
          ) : (
            <Button size="sm" disabled={!canRun} onClick={() => void startDraft(projectId, 'revise', notes)}>
              {t('assist.revise')}
            </Button>
          )}
          {streaming && (
            <>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('assist.streaming')}
              </span>
              <Button size="sm" variant="ghost" onClick={() => void cancelDraft()}>
                {t('assist.cancel')}
              </Button>
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
                <Button size="sm" onClick={acceptDraft}>{t('assist.accept')}</Button>
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

`BrdEditor.tsx`:

```tsx
// apps/desktop/src/renderer/components/requirements/BrdEditor.tsx
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Save } from 'lucide-react';

import { parseFrontmatter } from '../../../shared/frontmatter';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { useBrdStore } from '../../stores/brd-store';
import { BrdAssistPanel } from './BrdAssistPanel';
import { StructureChecklist } from './StructureChecklist';

/** A document counts as empty when every required section is empty (fresh template). */
function documentIsEmpty(structure: ReturnType<typeof useBrdStore.getState>['structure']): boolean {
  if (!structure) return true;
  return structure.sections.filter((s) => s.required).every((s) => s.empty);
}

export function BrdEditor({ projectId }: { projectId: string }) {
  const { t } = useTranslation('requirements');
  const { selectedSummary, content, setContent, structure, save, isSaving, error } = useBrdStore();
  const dirty = useBrdStore((s) => s.content !== s.savedContent);
  if (!selectedSummary) return null;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{selectedSummary.title}</h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{t(`status.${selectedSummary.status}`)}</Badge>
            <span>{dirty ? t('editor.unsaved') : t('editor.saved')}</span>
            {error && <span className="text-destructive">{t('editor.saveError', { error })}</span>}
          </div>
        </div>
        <Button size="sm" disabled={!dirty || isSaving} onClick={() => void save(projectId)}>
          <Save className="mr-2 h-4 w-4" />
          {isSaving ? t('editor.saving') : t('editor.save')}
        </Button>
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

      <BrdAssistPanel projectId={projectId} documentIsEmpty={documentIsEmpty(structure)} />
    </div>
  );
}
```

`NewBrdDialog.tsx`:

```tsx
// apps/desktop/src/renderer/components/requirements/NewBrdDialog.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

interface NewBrdDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (title: string) => Promise<void>;
}

export function NewBrdDialog({ open, onOpenChange, onCreate }: NewBrdDialogProps) {
  const { t } = useTranslation('requirements');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onCreate(title.trim());
      setTitle('');
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('newDialog.title')}</DialogTitle>
          <DialogDescription>{t('newDialog.description')}</DialogDescription>
        </DialogHeader>
        <label className="text-sm font-medium" htmlFor="brd-title">{t('newDialog.titleLabel')}</label>
        <Input
          id="brd-title"
          value={title}
          placeholder={t('newDialog.titlePlaceholder')}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t('newDialog.cancel')}</Button>
          <Button onClick={() => void submit()} disabled={busy || !title.trim()}>{t('newDialog.create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`BrdList.tsx`:

```tsx
// apps/desktop/src/renderer/components/requirements/BrdList.tsx
import { useTranslation } from 'react-i18next';
import { Plus, AlertTriangle } from 'lucide-react';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';
import type { BrdSummary } from '../../../shared/types/brd';

interface BrdListProps {
  brds: BrdSummary[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  onNew: () => void;
}

export function BrdList({ brds, selectedSlug, onSelect, onNew }: BrdListProps) {
  const { t } = useTranslation('requirements');
  return (
    <div className="flex h-full flex-col border-r border-border">
      <div className="flex items-center justify-between p-3">
        <div>
          <h1 className="text-base font-semibold">{t('title')}</h1>
          <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button size="sm" onClick={onNew}>
          <Plus className="mr-1 h-4 w-4" />
          {t('list.newBrd')}
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {brds.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">{t('list.empty')}</p>
        ) : (
          <ul className="px-2 pb-2">
            {brds.map((b) => (
              <li key={b.slug}>
                <button
                  type="button"
                  onClick={() => onSelect(b.slug)}
                  className={cn(
                    'flex w-full flex-col items-start gap-1 rounded-md px-2 py-2 text-left hover:bg-muted/60',
                    b.slug === selectedSlug && 'bg-muted',
                  )}
                >
                  <span className="w-full truncate text-sm font-medium">{b.title}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{t(`status.${b.status}`)}</Badge>
                    {b.warning && (
                      <span className="flex items-center gap-1 text-amber-600" title={b.warning}>
                        <AlertTriangle className="h-3 w-3" />
                        {t('list.warning')}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
```

`RequirementsView.tsx` (replace the placeholder):

```tsx
// apps/desktop/src/renderer/components/requirements/RequirementsView.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../ui/alert-dialog';
import { setupBrdListeners, useBrdStore } from '../../stores/brd-store';
import { BrdEditor } from './BrdEditor';
import { BrdList } from './BrdList';
import { NewBrdDialog } from './NewBrdDialog';

export function RequirementsView({ projectId }: { projectId: string }) {
  const { t } = useTranslation('requirements');
  const { brds, selectedSlug, load, select, create, reset, error } = useBrdStore();
  const [showNew, setShowNew] = useState(false);
  /** Slug to open after the user discards changes; '__new__' opens the New BRD dialog. */
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);

  useEffect(() => {
    const stop = setupBrdListeners();
    reset();
    void load(projectId);
    return () => {
      stop();
    };
  }, [projectId, load, reset]);

  const handleSelect = async (slug: string) => {
    const ok = await select(projectId, slug);
    if (!ok && useBrdStore.getState().isDirty()) setPendingSlug(slug);
  };

  return (
    <div className="grid h-full grid-cols-[280px_1fr]">
      <BrdList
        brds={brds}
        selectedSlug={selectedSlug}
        onSelect={(s) => void handleSelect(s)}
        onNew={() => (useBrdStore.getState().isDirty() ? setPendingSlug('__new__') : setShowNew(true))}
      />
      <div className="min-h-0">
        {error && !selectedSlug && <p className="px-4 pt-4 text-sm text-destructive">{error}</p>}
        {selectedSlug ? (
          <BrdEditor projectId={projectId} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('editor.noSelection')}</div>
        )}
      </div>

      <NewBrdDialog
        open={showNew}
        onOpenChange={setShowNew}
        onCreate={async (title) => {
          await create(projectId, title);
        }}
      />

      <AlertDialog open={pendingSlug !== null} onOpenChange={(open) => !open && setPendingSlug(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('unsavedDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('unsavedDialog.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('unsavedDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const slug = pendingSlug;
                setPendingSlug(null);
                if (slug === '__new__') {
                  useBrdStore.setState((s) => ({ content: s.savedContent, structure: s.structure }));
                  setShowNew(true);
                } else if (slug) {
                  void select(projectId, slug, { force: true });
                }
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

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `cd apps/desktop && npx vitest run src/renderer/components/requirements/ src/renderer/stores/__tests__/brd-store.test.ts && npm run lint && npm run typecheck`
Expected: PASS (5 component tests plus the store tests); clean. If the `prose` classes are not available (no typography plugin), drop them; the preview still renders.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/requirements
git commit -m "feat(brd): add Requirements view with BRD list, editor, checklist, and AI assist

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Full gate and manual check

- [ ] **Step 1: Full suite, lint, typecheck**

Run: `cd apps/desktop && npm test && npm run lint && npm run typecheck`
Expected: all green.

- [ ] **Step 2: Manual check in the running app**

1. `nvm use 24 && npm run dev:mcp` from the repo root.
2. Open a project, press `Q` or click Requirements. Click New BRD, enter "Customer onboarding", Create. Confirm the editor opens with the template, the checklist shows every required section as Empty, and `docs/brd/customer-onboarding.md` exists in the project.
3. Open AI assist, paste three lines of notes, click Draft from notes. Confirm text streams into the proposal box, Accept fills the editor and shows Unsaved changes, and the checklist turns green as sections fill.
4. Click Save. Confirm the file on disk contains the drafted content and the status badge reads Draft.
5. Edit a line, click another BRD or New BRD, and confirm the unsaved-changes dialog appears.
6. With the document non-empty, use Revise with instructions ("rename milestone 1 to Foundations") and confirm a proposal arrives and can be discarded.

- [ ] **Step 3: Commit any fixes from the manual check**

Commit with a `fix(brd): ...` message describing what the manual run exposed.

---

## Spec coverage checklist (self-review)

| Spec section | Task |
|---|---|
| Files in the project repository, slug rules | 3 |
| Template and frontmatter fields | 1, 2 |
| Structure check | 1 |
| `brd-files`, `brd-structure` | 1, 3 |
| Runner (draft/revise, streaming, no file writes, Codex handling) | 4 |
| IPC channels, one run per project, cancel, preload, ElectronAPI, mock | 5 |
| View registration, i18n namespace, store | 6 |
| Components, dirty guard, assist panel, proposal flow | 7 |
| Error handling table | 3, 5, 6, 7 |
| Testing list, manual check | every task; 8 |
