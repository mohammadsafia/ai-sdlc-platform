# Requirements Generation and Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a structured requirements set (requirements, milestones, proposed tasks) from a BRD, let the product owner review, edit, refine with AI, and approve it, saved as `docs/brd/<slug>.requirements.json`.

**Architecture:** Pure schema and merge logic in `src/shared/brd/requirements.ts` shared by main and renderer. Main adds a file module, a structured-output runner (`Output.object` with `parseLLMJson` fallback and one retry), and one IPC module with run management. The renderer adds a Requirements tab inside the 2a BRD editor, a store with live integrity warnings, and an assist box with targeted or whole-set refinement using the 2a proposal pattern.

**Tech Stack:** TypeScript strict, Electron 40, Vercel AI SDK v6 (`generateText` + `Output.object`), Zod (root `zod` import to match `parseLLMJson`), React 19, Zustand 5, react-i18next, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-20-requirements-generation-design.md`

## Global Constraints

- Work under `apps/desktop/`, Node 24 (`nvm use 24`). No `process.platform`; no `console.log` in production paths.
- Renderer text through `react-i18next`; every key in both `en` and `fr` under the existing `requirements` namespace.
- File: `<project>/docs/brd/<slug>.requirements.json`, slug rule `/^[a-z0-9]+(-[a-z0-9]+)*$/`, atomic writes, path-contained to `docs/brd`.
- IDs: `R<n>`, `M<n>`, `T<n>`; stable once assigned; never renumbered.
- Integrity warning rules, approval gating, staleness by sha256 of the BRD content, and "no dates or durations" are verbatim from the spec.
- Feature model settings: `getActiveProviderFeatureSettings('roadmap')`. One run per BRD slug at a time.
- Component tests start with the `@vitest-environment jsdom` docblock and `import '@testing-library/jest-dom/vitest';`, and mock `react-i18next` with `{ t, i18n: { language: 'en' } }`.
- Commit after each task on branch `feat/requirements-set`; messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File Structure

New (under `apps/desktop/`):

| Path | Responsibility |
|---|---|
| `src/shared/types/requirements.ts` | Types for the set and run events |
| `src/shared/brd/requirements.ts` | Zod schemas, `validateRequirementsSet`, `nextId`, `assignIds`, `mergeRefinement`, `diffSets`, `brdHash` |
| `src/main/brd/requirements-files.ts` | read/write/exists with containment |
| `src/main/ai/runners/requirements-generator.ts` | structured-output runner |
| `prompts/requirements_generator.md` | runner prompt |
| `src/main/ipc-handlers/requirements-handlers.ts` | channels, gate, run management, post-processing |
| `src/preload/api/modules/requirements-api.ts` | preload API |
| `src/renderer/stores/requirements-store.ts` | working set, selection, warnings, run state |
| `src/renderer/components/requirements/set/RequirementsTab.tsx`, `RequirementsSetEditor.tsx`, `RequirementsAssist.tsx` | UI |

Modified: `src/shared/constants/ipc.ts`, `src/shared/types/ipc.ts`, `src/shared/types/index.ts`, `src/preload/api/agent-api.ts`, `src/main/ipc-handlers/index.ts`, `src/renderer/lib/browser-mock.ts`, `locales/{en,fr}/requirements.json`, `src/renderer/components/requirements/BrdEditor.tsx` (tab strip), `RequirementsView.tsx` (dirty guard consults the requirements store).

---

### Task 1: Shared types, schema, and pure helpers

**Files:**
- Create: `src/shared/types/requirements.ts`
- Modify: `src/shared/types/index.ts` (`export * from './requirements';`)
- Create: `src/shared/brd/requirements.ts`
- Test: `src/shared/brd/__tests__/requirements.test.ts`

**Interfaces:**
- Produces the types below and: `GeneratedBodySchema`, `RequirementsSetSchema`, `validateRequirementsSet(set): string[]`, `nextId(prefix, existing): string`, `assignIds(body, previous?): { requirements; milestones; tasks; warnings }`, `mergeRefinement(previous, body, selection?): { set; warnings }`, `diffSets(a, b): SectionDiff`.

- [ ] **Step 1: Write `src/shared/types/requirements.ts`**

```ts
// apps/desktop/src/shared/types/requirements.ts
export type RequirementsStatus = 'draft' | 'approved';
export type ProposedTaskCategory = 'feature' | 'bug' | 'refactor' | 'docs';
export const PROPOSED_TASK_CATEGORIES: readonly ProposedTaskCategory[] = ['feature', 'bug', 'refactor', 'docs'];

export interface Requirement {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  area: string;
  needsDesign: boolean;
  included: boolean;
}

export interface Milestone {
  id: string;
  name: string;
  description: string;
  order: number;
  included: boolean;
}

export interface ProposedTask {
  id: string;
  title: string;
  description: string;
  milestoneId: string;
  requirementIds: string[];
  category: ProposedTaskCategory;
  order: number;
  included: boolean;
}

export interface RequirementsSet {
  version: 1;
  brdSlug: string;
  brdHash: string;
  status: RequirementsStatus;
  generatedAt: string;
  approvedAt?: string;
  requirements: Requirement[];
  milestones: Milestone[];
  tasks: ProposedTask[];
}

/** Model output before post-processing. Ids are optional (echoed back during refinement). */
export interface GeneratedBody {
  requirements: Array<Omit<Requirement, 'id' | 'included'> & { id?: string }>;
  milestones: Array<Omit<Milestone, 'id' | 'included'> & { id?: string }>;
  tasks: Array<Omit<ProposedTask, 'id' | 'included'> & { id?: string }>;
  changeSummary?: string;
}

export interface SectionCounts { added: number; changed: number; removed: number }
export interface SectionDiff { requirements: SectionCounts; milestones: SectionCounts; tasks: SectionCounts }

export type RequirementsRunMode = 'generate' | 'refine';
export interface RequirementsGenerateRequest {
  slug: string;
  mode: RequirementsRunMode;
  feedback?: string;
  selection?: string[];
}
export type RequirementsRunPhase = 'started' | 'parsing' | 'repairing';
export interface RequirementsProgress { runId: string; phase: RequirementsRunPhase }
export interface RequirementsDone { runId: string; set: RequirementsSet; changeSummary?: string; warnings: string[] }
export interface RequirementsError { runId: string; error: string }
```

Add `export * from './requirements';` to `src/shared/types/index.ts` after the `brd` export.

- [ ] **Step 2: Write the failing tests**

```ts
// apps/desktop/src/shared/brd/__tests__/requirements.test.ts
import { describe, it, expect } from 'vitest';
import {
  GeneratedBodySchema, RequirementsSetSchema, validateRequirementsSet, nextId, assignIds, mergeRefinement, diffSets,
} from '../requirements';
import type { GeneratedBody, RequirementsSet } from '../../types/requirements';

const req = (id: string, over: Partial<RequirementsSet['requirements'][number]> = {}) => ({
  id, title: `Req ${id}`, description: 'd', acceptanceCriteria: ['ac'], area: 'General', needsDesign: false, included: true, ...over,
});
const ms = (id: string, order: number, over: Partial<RequirementsSet['milestones'][number]> = {}) => ({
  id, name: `MS ${id}`, description: 'd', order, included: true, ...over,
});
const task = (id: string, milestoneId: string, requirementIds: string[], order = 1, over: Partial<RequirementsSet['tasks'][number]> = {}) => ({
  id, title: `Task ${id}`, description: 'd', milestoneId, requirementIds, category: 'feature' as const, order, included: true, ...over,
});
const set = (over: Partial<RequirementsSet> = {}): RequirementsSet => ({
  version: 1, brdSlug: 'x', brdHash: 'h', status: 'draft', generatedAt: 't',
  requirements: [req('R1'), req('R2')],
  milestones: [ms('M1', 1)],
  tasks: [task('T1', 'M1', ['R1']), task('T2', 'M1', ['R2'], 2)],
  ...over,
});

describe('schemas', () => {
  it('accepts a valid set and rejects a bad category', () => {
    expect(RequirementsSetSchema.safeParse(set()).success).toBe(true);
    expect(RequirementsSetSchema.safeParse(set({ tasks: [{ ...task('T1', 'M1', ['R1']), category: 'chore' as never }] })).success).toBe(false);
  });
  it('GeneratedBodySchema allows missing ids and changeSummary', () => {
    const body: GeneratedBody = {
      requirements: [{ title: 'a', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: true }],
      milestones: [{ name: 'm', description: 'd', order: 1 }],
      tasks: [{ title: 't', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'docs', order: 1 }],
    };
    expect(GeneratedBodySchema.safeParse(body).success).toBe(true);
  });
});

describe('validateRequirementsSet', () => {
  it('returns no warnings for a consistent set', () => {
    expect(validateRequirementsSet(set())).toEqual([]);
  });
  it('flags every rule', () => {
    const bad = set({
      requirements: [req('R1'), req('R2', { acceptanceCriteria: [] }), req('R3'), req('R3')],
      milestones: [ms('M1', 1), ms('M2', 1), ms('M3', 3, { included: false })],
      tasks: [
        task('T1', 'M9', ['R1']),           // milestone not found
        task('T2', 'M3', ['R1'], 2),        // excluded milestone
        task('T3', 'M1', [], 3),            // no requirements
        task('T4', 'M1', ['R7'], 3),        // unknown requirement + duplicate order 3
      ],
    });
    const w = validateRequirementsSet(bad);
    expect(w.join('\n')).toContain('T1');
    expect(w.join('\n')).toContain('M9');
    expect(w.join('\n')).toContain('T2');
    expect(w.join('\n')).toContain('T3');
    expect(w.join('\n')).toContain('R7');
    expect(w.join('\n')).toContain('R2');   // no acceptance criteria and uncovered
    expect(w.join('\n')).toContain('R3');   // duplicate id
    expect(w.join('\n')).toMatch(/order 1/); // duplicate milestone order
    expect(w.join('\n')).toMatch(/order 3/); // duplicate task order in M1
  });
  it('ignores excluded items when checking coverage', () => {
    expect(validateRequirementsSet(set({ requirements: [req('R1'), req('R2', { included: false })], tasks: [task('T1', 'M1', ['R1'])] }))).toEqual([]);
  });
});

describe('nextId / assignIds', () => {
  it('nextId continues from the max numeric suffix', () => {
    expect(nextId('R', [{ id: 'R1' }, { id: 'R7' }, { id: 'M3' }])).toBe('R8');
    expect(nextId('T', [])).toBe('T1');
  });
  it('assignIds gives fresh ids, included=true, and drops unknown links with warnings', () => {
    const body: GeneratedBody = {
      requirements: [{ title: 'a', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: false }],
      milestones: [{ name: 'm', description: 'd', order: 1 }],
      tasks: [{ title: 't', description: 'd', milestoneId: 'M1', requirementIds: ['R1', 'R9'], category: 'feature', order: 1 }],
    };
    const r = assignIds(body);
    expect(r.requirements[0]).toMatchObject({ id: 'R1', included: true });
    expect(r.milestones[0]).toMatchObject({ id: 'M1', included: true });
    expect(r.tasks[0]).toMatchObject({ id: 'T1', requirementIds: ['R1'] });
    expect(r.warnings[0]).toContain('R9');
  });
  it('assignIds keeps echoed ids that exist in previous and copies their included flag', () => {
    const prev = set({ requirements: [req('R1', { included: false }), req('R2')] });
    const body: GeneratedBody = {
      requirements: [
        { id: 'R2', title: 'kept', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: false },
        { title: 'new', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: false },
      ],
      milestones: [{ id: 'M1', name: 'm', description: 'd', order: 1 }],
      tasks: [{ id: 'T1', title: 't', description: 'd', milestoneId: 'M1', requirementIds: ['R2'], category: 'feature', order: 1 }],
    };
    const r = assignIds(body, prev);
    expect(r.requirements.map((x) => x.id)).toEqual(['R2', 'R3']);
    expect(r.requirements[0].included).toBe(true);
  });
});

describe('mergeRefinement', () => {
  const prev = set();
  it('targeted: only selected ids change, everything else is verbatim from previous', () => {
    const body: GeneratedBody = {
      requirements: [
        { id: 'R1', title: 'R1 changed', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: true },
        { id: 'R2', title: 'R2 attempted change', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: true },
      ],
      milestones: [{ id: 'M1', name: 'renamed', description: 'd', order: 1 }],
      tasks: [
        { id: 'T1', title: 'Task T1', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 1 },
        { id: 'T2', title: 'Task T2', description: 'd', milestoneId: 'M1', requirementIds: ['R2'], category: 'feature', order: 2 },
      ],
      changeSummary: 'Changed R1',
    };
    const { set: merged } = mergeRefinement(prev, body, ['R1']);
    expect(merged.requirements[0]).toMatchObject({ id: 'R1', title: 'R1 changed', needsDesign: true });
    expect(merged.requirements[1]).toEqual(prev.requirements[1]);
    expect(merged.milestones[0]).toEqual(prev.milestones[0]);
    expect(merged.status).toBe('draft');
    expect(merged.brdHash).toBe('h');
  });
  it('whole-set: body applies, removed items disappear, new items get ids', () => {
    const body: GeneratedBody = {
      requirements: [{ id: 'R1', title: 'Req R1', description: 'd', acceptanceCriteria: ['ac'], area: 'General', needsDesign: false }],
      milestones: [{ id: 'M1', name: 'MS M1', description: 'd', order: 1 }, { name: 'M new', description: 'd', order: 2 }],
      tasks: [{ id: 'T1', title: 'Task T1', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 1 }],
    };
    const { set: merged } = mergeRefinement(prev, body);
    expect(merged.requirements.map((r) => r.id)).toEqual(['R1']);
    expect(merged.milestones.map((m) => m.id)).toEqual(['M1', 'M2']);
    expect(merged.tasks.map((t) => t.id)).toEqual(['T1']);
  });
});

describe('diffSets', () => {
  it('counts added, changed, removed per section', () => {
    const a = set();
    const b = set({ requirements: [{ ...req('R1'), title: 'edited' }, req('R3')], tasks: [task('T1', 'M1', ['R1'])] });
    expect(diffSets(a, b)).toEqual({
      requirements: { added: 1, changed: 1, removed: 1 },
      milestones: { added: 0, changed: 0, removed: 0 },
      tasks: { added: 0, changed: 0, removed: 1 },
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/shared/brd/__tests__/requirements.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Write `src/shared/brd/requirements.ts`**

The renderer cannot use `node:crypto`, so `brdHash` lives in `src/main/brd/requirements-files.ts` (Task 2) and reaches the renderer through `requirements:read` as `currentBrdHash`. This shared module stays free of Node imports.

```ts
// apps/desktop/src/shared/brd/requirements.ts
import { z } from 'zod';

import {
  PROPOSED_TASK_CATEGORIES,
  type GeneratedBody,
  type Milestone,
  type ProposedTask,
  type Requirement,
  type RequirementsSet,
  type SectionCounts,
  type SectionDiff,
} from '../types/requirements';

const idSchema = z.string().regex(/^[RMT]\d+$/);

const requirementBody = z.object({
  id: idSchema.optional(),
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string().min(1)),
  area: z.string().min(1),
  needsDesign: z.boolean(),
});
const milestoneBody = z.object({
  id: idSchema.optional(),
  name: z.string().min(1),
  description: z.string(),
  order: z.number().int().positive(),
});
const taskBody = z.object({
  id: idSchema.optional(),
  title: z.string().min(1),
  description: z.string(),
  milestoneId: z.string().min(1),
  requirementIds: z.array(z.string()),
  category: z.enum(PROPOSED_TASK_CATEGORIES as [string, ...string[]]),
  order: z.number().int().positive(),
});

export const GeneratedBodySchema = z.object({
  requirements: z.array(requirementBody),
  milestones: z.array(milestoneBody),
  tasks: z.array(taskBody),
  changeSummary: z.string().optional(),
});

export const RequirementsSetSchema = z.object({
  version: z.literal(1),
  brdSlug: z.string().min(1),
  brdHash: z.string().min(1),
  status: z.enum(['draft', 'approved']),
  generatedAt: z.string().min(1),
  approvedAt: z.string().optional(),
  requirements: z.array(requirementBody.extend({ id: idSchema, included: z.boolean() })),
  milestones: z.array(milestoneBody.extend({ id: idSchema, included: z.boolean() })),
  tasks: z.array(taskBody.extend({ id: idSchema, included: z.boolean() })),
});

export function nextId(prefix: 'R' | 'M' | 'T', existing: Array<{ id: string }>): string {
  let max = 0;
  for (const { id } of existing) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

export function validateRequirementsSet(set: RequirementsSet): string[] {
  const w: string[] = [];
  const dupes = (items: Array<{ id: string }>) => {
    const seen = new Set<string>();
    for (const { id } of items) {
      if (seen.has(id)) w.push(`Duplicate id ${id}`);
      seen.add(id);
    }
  };
  dupes(set.requirements);
  dupes(set.milestones);
  dupes(set.tasks);

  const includedReq = new Map(set.requirements.filter((r) => r.included).map((r) => [r.id, r]));
  const includedMs = new Map(set.milestones.filter((m) => m.included).map((m) => [m.id, m]));
  const allReq = new Set(set.requirements.map((r) => r.id));
  const allMs = new Set(set.milestones.map((m) => m.id));

  for (const r of set.requirements) {
    if (r.included && r.acceptanceCriteria.length === 0) w.push(`Requirement ${r.id} has no acceptance criteria`);
  }

  const covered = new Set<string>();
  for (const t of set.tasks.filter((t) => t.included)) {
    if (!allMs.has(t.milestoneId)) w.push(`Task ${t.id} points at milestone ${t.milestoneId}, which does not exist`);
    else if (!includedMs.has(t.milestoneId)) w.push(`Task ${t.id} points at milestone ${t.milestoneId}, which is excluded`);
    if (t.requirementIds.length === 0) w.push(`Task ${t.id} covers no requirement`);
    for (const rid of t.requirementIds) {
      if (!allReq.has(rid)) w.push(`Task ${t.id} references requirement ${rid}, which does not exist`);
      else if (!includedReq.has(rid)) w.push(`Task ${t.id} references requirement ${rid}, which is excluded`);
      else covered.add(rid);
    }
  }
  for (const r of includedReq.values()) {
    if (!covered.has(r.id)) w.push(`Requirement ${r.id} is not covered by any included task`);
  }

  const msOrders = new Map<number, string>();
  for (const m of includedMs.values()) {
    const prev = msOrders.get(m.order);
    if (prev) w.push(`Milestones ${prev} and ${m.id} share order ${m.order}`);
    msOrders.set(m.order, m.id);
  }
  const taskOrders = new Map<string, string>();
  for (const t of set.tasks.filter((t) => t.included)) {
    const key = `${t.milestoneId}:${t.order}`;
    const prev = taskOrders.get(key);
    if (prev) w.push(`Tasks ${prev} and ${t.id} share order ${t.order} in milestone ${t.milestoneId}`);
    taskOrders.set(key, t.id);
  }
  return w;
}

interface Assigned {
  requirements: Requirement[];
  milestones: Milestone[];
  tasks: ProposedTask[];
  warnings: string[];
}

/** Give every item an id (keeping echoed ids that exist in `previous`), set/copy `included`, drop unknown links. */
export function assignIds(body: GeneratedBody, previous?: RequirementsSet): Assigned {
  const warnings: string[] = [];
  const prevReq = new Map(previous?.requirements.map((r) => [r.id, r]) ?? []);
  const prevMs = new Map(previous?.milestones.map((m) => [m.id, m]) ?? []);
  const prevTask = new Map(previous?.tasks.map((t) => [t.id, t]) ?? []);

  const requirements: Requirement[] = [];
  for (const r of body.requirements) {
    const keep = r.id && prevReq.has(r.id) ? prevReq.get(r.id) : undefined;
    const id = keep ? keep.id : nextId('R', [...requirements, ...prevReq.values()]);
    requirements.push({ ...r, id, included: keep ? keep.included : true });
  }
  const milestones: Milestone[] = [];
  for (const m of body.milestones) {
    const keep = m.id && prevMs.has(m.id) ? prevMs.get(m.id) : undefined;
    const id = keep ? keep.id : nextId('M', [...milestones, ...prevMs.values()]);
    milestones.push({ ...m, id, included: keep ? keep.included : true });
  }
  const reqIds = new Set(requirements.map((r) => r.id));
  const msIds = new Set(milestones.map((m) => m.id));
  const tasks: ProposedTask[] = [];
  for (const t of body.tasks) {
    const keep = t.id && prevTask.has(t.id) ? prevTask.get(t.id) : undefined;
    const id = keep ? keep.id : nextId('T', [...tasks, ...prevTask.values()]);
    const requirementIds = t.requirementIds.filter((rid) => {
      if (reqIds.has(rid)) return true;
      warnings.push(`Task ${id} referenced unknown requirement ${rid}; the link was dropped`);
      return false;
    });
    if (!msIds.has(t.milestoneId)) warnings.push(`Task ${id} points at unknown milestone ${t.milestoneId}`);
    tasks.push({ ...t, id, requirementIds, category: t.category as ProposedTask['category'], included: keep ? keep.included : true });
  }
  return { requirements, milestones, tasks, warnings };
}

/**
 * Apply a refinement body to `previous`. With `selection`, only those ids may change;
 * all other items come verbatim from `previous`. Without it, the body replaces the set.
 */
export function mergeRefinement(
  previous: RequirementsSet,
  body: GeneratedBody,
  selection?: string[],
): { set: RequirementsSet; warnings: string[] } {
  const assigned = assignIds(body, previous);
  const warnings = [...assigned.warnings];

  let requirements = assigned.requirements;
  let milestones = assigned.milestones;
  let tasks = assigned.tasks;

  if (selection && selection.length > 0) {
    const sel = new Set(selection);
    const pick = <T extends { id: string }>(prevItems: T[], nextItems: T[]): T[] => {
      const nextById = new Map(nextItems.map((i) => [i.id, i]));
      const out: T[] = prevItems.map((p) => (sel.has(p.id) && nextById.has(p.id) ? (nextById.get(p.id) as T) : p));
      for (const n of nextItems) if (!prevItems.some((p) => p.id === n.id)) out.push(n); // brand-new items are always allowed
      return out;
    };
    requirements = pick(previous.requirements, requirements);
    milestones = pick(previous.milestones, milestones);
    tasks = pick(previous.tasks, tasks);
  }

  const set: RequirementsSet = {
    version: 1,
    brdSlug: previous.brdSlug,
    brdHash: previous.brdHash,
    status: 'draft',
    generatedAt: previous.generatedAt,
    requirements,
    milestones,
    tasks,
  };
  return { set, warnings };
}

function countDiff<T extends { id: string }>(a: T[], b: T[]): SectionCounts {
  const aBy = new Map(a.map((i) => [i.id, i]));
  const bBy = new Map(b.map((i) => [i.id, i]));
  let added = 0;
  let changed = 0;
  let removed = 0;
  for (const [id, item] of bBy) {
    if (!aBy.has(id)) added++;
    else if (JSON.stringify(aBy.get(id)) !== JSON.stringify(item)) changed++;
  }
  for (const id of aBy.keys()) if (!bBy.has(id)) removed++;
  return { added, changed, removed };
}

export function diffSets(a: RequirementsSet, b: RequirementsSet): SectionDiff {
  return {
    requirements: countDiff(a.requirements, b.requirements),
    milestones: countDiff(a.milestones, b.milestones),
    tasks: countDiff(a.tasks, b.tasks),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/shared/brd/__tests__/requirements.test.ts && npm run typecheck`
Expected: PASS (10 tests); no type errors. If `z.enum(PROPOSED_TASK_CATEGORIES as [string, ...string[]])` complains under the installed Zod, use `z.enum(['feature', 'bug', 'refactor', 'docs'])` directly.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/shared/types/requirements.ts apps/desktop/src/shared/types/index.ts apps/desktop/src/shared/brd/requirements.ts apps/desktop/src/shared/brd/__tests__/requirements.test.ts
git commit -m "feat(requirements): add shared schema, integrity validation, and merge helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Requirements file access and BRD hash

**Files:**
- Create: `src/main/brd/requirements-files.ts`
- Test: `src/main/brd/__tests__/requirements-files.test.ts`

**Interfaces:**
- Produces: `requirementsPath(projectDir, slug): Promise<string>`, `readRequirements(projectDir, slug): Promise<RequirementsSet | null>`, `writeRequirements(projectDir, slug, set): Promise<RequirementsSet>`, `brdHash(markdown): string`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/src/main/brd/__tests__/requirements-files.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { requirementsPath, readRequirements, writeRequirements, brdHash } from '../requirements-files';
import type { RequirementsSet } from '../../../shared/types/requirements';

const set: RequirementsSet = {
  version: 1, brdSlug: 'a', brdHash: 'h', status: 'draft', generatedAt: 't',
  requirements: [{ id: 'R1', title: 'r', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: false, included: true }],
  milestones: [{ id: 'M1', name: 'm', description: 'd', order: 1, included: true }],
  tasks: [{ id: 'T1', title: 't', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 1, included: true }],
};

describe('requirements-files', () => {
  let projectDir: string;
  beforeEach(() => {
    projectDir = mkdtempSync(path.join(tmpdir(), 'req-files-'));
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('requirementsPath validates the slug and stays under docs/brd', async () => {
    expect(await requirementsPath(projectDir, 'a')).toBe(path.join(realpathSync(projectDir), 'docs', 'brd', 'a.requirements.json'));
    await expect(requirementsPath(projectDir, '../x')).rejects.toThrow(/Invalid BRD slug/);
  });

  it('read returns null when missing, write round-trips atomically, invalid JSON reads as null', async () => {
    expect(await readRequirements(projectDir, 'a')).toBeNull();
    await writeRequirements(projectDir, 'a', set);
    expect(readdirSync(path.join(projectDir, 'docs', 'brd'))).toEqual(['a.requirements.json']);
    expect(await readRequirements(projectDir, 'a')).toEqual(set);
    writeFileSync(path.join(projectDir, 'docs', 'brd', 'b.requirements.json'), '{ nope');
    expect(await readRequirements(projectDir, 'b')).toBeNull();
  });

  it('read rejects a file that fails the schema', async () => {
    mkdirSync(path.join(projectDir, 'docs', 'brd'), { recursive: true });
    writeFileSync(path.join(projectDir, 'docs', 'brd', 'c.requirements.json'), JSON.stringify({ ...set, status: 'weird' }));
    await expect(readRequirements(projectDir, 'c')).rejects.toThrow(/invalid/i);
  });

  it('brdHash is stable sha256 hex', () => {
    expect(brdHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/main/brd/__tests__/requirements-files.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/main/brd/requirements-files.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/main/brd/`
Expected: PASS (all brd tests including the 4 new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/brd/requirements-files.ts apps/desktop/src/main/brd/__tests__/requirements-files.test.ts
git commit -m "feat(requirements): add requirements set file access and BRD hashing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Runner and prompt

**Files:**
- Create: `prompts/requirements_generator.md`
- Create: `src/main/ai/runners/requirements-generator.ts`
- Test: `src/main/ai/runners/__tests__/requirements-generator.test.ts`

**Interfaces:**
- Consumes: `GeneratedBodySchema` (Task 1), `createSimpleClient`, `generateText` + `Output` from `ai`, `parseLLMJson`, `buildValidationRetryPrompt`, `formatZodErrors` from `schema/structured-output`, `tryLoadPrompt`, `loadBrdProjectContext` from `runners/brd-writer`.
- Produces:

```ts
export interface RequirementsRunConfig {
  projectDir: string;
  mode: RequirementsRunMode;
  brdMarkdown: string;
  previous?: RequirementsSet;
  feedback?: string;
  selection?: string[];
  modelShorthand?: string;
  thinkingLevel?: ThinkingLevel;
  abortSignal?: AbortSignal;
}
export type RequirementsRunEvent =
  | { type: 'progress'; phase: RequirementsRunPhase }
  | { type: 'done'; body: GeneratedBody }
  | { type: 'error'; error: string };
export function buildRequirementsPrompts(config: RequirementsRunConfig, projectContext: string): { system: string; prompt: string };
export async function runRequirementsGenerator(config, onEvent): Promise<void>;
```

- [ ] **Step 1: Write the prompt**

```markdown
# Requirements Generator

You turn a Business Requirements Document (BRD) into a structured requirements set for a software team. You answer with JSON only, matching this shape exactly:

{
  "requirements": [ { "id"?: "R1", "title": "...", "description": "...", "acceptanceCriteria": ["..."], "area": "...", "needsDesign": true|false } ],
  "milestones":   [ { "id"?: "M1", "name": "...", "description": "...", "order": 1 } ],
  "tasks":        [ { "id"?: "T1", "title": "...", "description": "...", "milestoneId": "M1", "requirementIds": ["R1"], "category": "feature"|"bug"|"refactor"|"docs", "order": 1 } ],
  "changeSummary"?: "..."
}

Rules:
- Requirements come from the BRD's functional and non-functional requirements. Each has at least one acceptance criterion, and every criterion is a single testable statement. `area` is the feature-area heading the requirement came from, or "General".
- `needsDesign` is true when the requirement introduces or changes a user-facing screen or flow.
- Milestones follow the BRD's milestones in delivery order. `order` starts at 1. Never include dates, durations, sprint counts, or time estimates anywhere.
- Tasks are single coherent changes an engineer can implement and verify on their own. Each task belongs to one milestone, covers at least one requirement, and has an `order` starting at 1 within its milestone. Every requirement must be covered by at least one task. Prefer several focused tasks over one large task.
- Use only the four categories listed.

In GENERATE mode you receive the BRD and produce the whole set. Omit ids.
In REFINE mode you receive the CURRENT SET, the FEEDBACK, and optionally a SELECTION of ids. Return the complete set. Keep the ids of every item you keep. When a SELECTION is given, change only the listed items and echo every other item unchanged with its id; you may still add new items without ids. Always fill `changeSummary` with a short list of what you changed and why.
```

Save as `apps/desktop/prompts/requirements_generator.md`.

- [ ] **Step 2: Write the failing tests**

```ts
// apps/desktop/src/main/ai/runners/__tests__/requirements-generator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateText, createSimpleClient } = vi.hoisted(() => ({ generateText: vi.fn(), createSimpleClient: vi.fn() }));
vi.mock('ai', () => ({ generateText, Output: { object: ({ schema }: { schema: unknown }) => ({ kind: 'object', schema }) } }));
vi.mock('../../client/factory', () => ({ createSimpleClient }));
vi.mock('../../prompts/prompt-loader', () => ({ tryLoadPrompt: () => 'RULES' }));
vi.mock('../brd-writer', () => ({ loadBrdProjectContext: () => 'Project: Acme' }));

import { buildRequirementsPrompts, runRequirementsGenerator } from '../requirements-generator';
import type { RequirementsSet } from '../../../../shared/types/requirements';

const validBody = {
  requirements: [{ title: 'r', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: false }],
  milestones: [{ name: 'm', description: 'd', order: 1 }],
  tasks: [{ title: 't', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 1 }],
};
const previous: RequirementsSet = {
  version: 1, brdSlug: 'a', brdHash: 'h', status: 'draft', generatedAt: 't',
  requirements: [{ id: 'R1', title: 'r', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: false, included: true }],
  milestones: [{ id: 'M1', name: 'm', description: 'd', order: 1, included: true }],
  tasks: [{ id: 'T1', title: 't', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 1, included: true }],
};

describe('buildRequirementsPrompts', () => {
  it('generate mode includes rules, context, and the BRD', () => {
    const { system, prompt } = buildRequirementsPrompts({ projectDir: '/p', mode: 'generate', brdMarkdown: '# BRD BODY' }, 'Project: Acme');
    expect(system).toContain('RULES');
    expect(system).toContain('## PROJECT CONTEXT\n\nProject: Acme');
    expect(prompt).toContain('MODE: GENERATE');
    expect(prompt).toContain('## BRD\n\n# BRD BODY');
  });
  it('refine mode includes current set, feedback, and selection', () => {
    const { prompt } = buildRequirementsPrompts(
      { projectDir: '/p', mode: 'refine', brdMarkdown: '# B', previous, feedback: 'Split R1', selection: ['R1', 'T1'] },
      '',
    );
    expect(prompt).toContain('MODE: REFINE');
    expect(prompt).toContain('## CURRENT SET');
    expect(prompt).toContain('"id": "R1"');
    expect(prompt).toContain('## FEEDBACK\n\nSplit R1');
    expect(prompt).toContain('## SELECTION\n\nR1, T1');
    expect(prompt).toContain('change only');
  });
});

describe('runRequirementsGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSimpleClient.mockResolvedValue({ model: { modelId: 'claude-sonnet' }, systemPrompt: 'S', tools: {}, maxSteps: 1 });
  });

  it('uses Output.object output when present', async () => {
    generateText.mockResolvedValue({ output: validBody, text: '' });
    const events: unknown[] = [];
    await runRequirementsGenerator({ projectDir: '/p', mode: 'generate', brdMarkdown: '#' }, (e) => events.push(e));
    expect(events[0]).toEqual({ type: 'progress', phase: 'started' });
    expect(events.at(-1)).toEqual({ type: 'done', body: validBody });
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText.mock.calls[0][0]).toMatchObject({ output: { kind: 'object' } });
  });

  it('falls back to parsing the text when output is missing', async () => {
    generateText.mockResolvedValue({ output: undefined, text: `Here you go:\n\`\`\`json\n${JSON.stringify(validBody)}\n\`\`\`` });
    const events: unknown[] = [];
    await runRequirementsGenerator({ projectDir: '/p', mode: 'generate', brdMarkdown: '#' }, (e) => events.push(e));
    expect(events).toContainEqual({ type: 'progress', phase: 'parsing' });
    expect(events.at(-1)).toEqual({ type: 'done', body: validBody });
  });

  it('retries once with validation errors, then errors out', async () => {
    generateText
      .mockResolvedValueOnce({ output: undefined, text: '{"requirements": "nope"}' })
      .mockResolvedValueOnce({ output: undefined, text: 'still bad' });
    const events: unknown[] = [];
    await runRequirementsGenerator({ projectDir: '/p', mode: 'generate', brdMarkdown: '#' }, (e) => events.push(e));
    expect(events).toContainEqual({ type: 'progress', phase: 'repairing' });
    expect(generateText).toHaveBeenCalledTimes(2);
    const retryPrompt = (generateText.mock.calls[1][0] as { prompt: string }).prompt;
    expect(retryPrompt).toContain('STRUCTURED OUTPUT VALIDATION ERRORS');
    expect(events.at(-1)).toMatchObject({ type: 'error' });
  });

  it('reports thrown errors', async () => {
    generateText.mockRejectedValue(new Error('no model'));
    const events: unknown[] = [];
    await runRequirementsGenerator({ projectDir: '/p', mode: 'generate', brdMarkdown: '#' }, (e) => events.push(e));
    expect(events.at(-1)).toEqual({ type: 'error', error: 'no model' });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/main/ai/runners/__tests__/requirements-generator.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Write `src/main/ai/runners/requirements-generator.ts`**

```ts
// apps/desktop/src/main/ai/runners/requirements-generator.ts
/**
 * Requirements generator — turns a BRD into a structured requirements set
 * (generate) or revises an existing set from feedback (refine).
 * Structured output via Output.object with parseLLMJson fallback and one
 * validation retry. Never writes files.
 */
import { generateText, Output } from 'ai';

import { GeneratedBodySchema } from '../../../shared/brd/requirements';
import type { GeneratedBody, RequirementsRunMode, RequirementsRunPhase, RequirementsSet } from '../../../shared/types/requirements';
import { createSimpleClient } from '../client/factory';
import type { ThinkingLevel } from '../config/types';
import { tryLoadPrompt } from '../prompts/prompt-loader';
import { buildValidationRetryPrompt, formatZodErrors, parseLLMJson } from '../schema/structured-output';
import { loadBrdProjectContext } from './brd-writer';

export interface RequirementsRunConfig {
  projectDir: string;
  mode: RequirementsRunMode;
  brdMarkdown: string;
  previous?: RequirementsSet;
  feedback?: string;
  selection?: string[];
  modelShorthand?: string;
  thinkingLevel?: ThinkingLevel;
  abortSignal?: AbortSignal;
}

export type RequirementsRunEvent =
  | { type: 'progress'; phase: RequirementsRunPhase }
  | { type: 'done'; body: GeneratedBody }
  | { type: 'error'; error: string };

const FALLBACK_SYSTEM = 'You turn a BRD into a JSON requirements set with requirements, milestones, and tasks. Output JSON only.';

function stripMeta(set: RequirementsSet): GeneratedBody {
  return {
    requirements: set.requirements.map(({ included: _i, ...r }) => r),
    milestones: set.milestones.map(({ included: _i, ...m }) => m),
    tasks: set.tasks.map(({ included: _i, ...t }) => t),
  };
}

export function buildRequirementsPrompts(config: RequirementsRunConfig, projectContext: string): { system: string; prompt: string } {
  const rules = tryLoadPrompt('requirements_generator') ?? FALLBACK_SYSTEM;
  const system = `${rules.trim()}\n` + (projectContext ? `\n## PROJECT CONTEXT\n\n${projectContext.trim()}\n` : '');

  const parts: string[] = [];
  if (config.mode === 'generate') {
    parts.push('MODE: GENERATE', '', '## BRD', '', config.brdMarkdown.trim(), '', 'Produce the complete requirements set as JSON now.');
  } else {
    parts.push('MODE: REFINE', '', '## BRD', '', config.brdMarkdown.trim(), '', '## CURRENT SET', '', JSON.stringify(config.previous ? stripMeta(config.previous) : {}, null, 2));
    parts.push('', '## FEEDBACK', '', (config.feedback ?? '').trim());
    if (config.selection && config.selection.length > 0) {
      parts.push('', '## SELECTION', '', config.selection.join(', '), '', 'Apply the feedback and change only the items listed in SELECTION. Echo every other item unchanged with its id. New items may be added without ids.');
    } else {
      parts.push('', 'Apply the feedback to the whole set. Keep the ids of items you keep.');
    }
    parts.push('', 'Return the complete revised set as JSON with a changeSummary.');
  }
  return { system, prompt: parts.join('\n') };
}

export async function runRequirementsGenerator(
  config: RequirementsRunConfig,
  onEvent: (e: RequirementsRunEvent) => void,
): Promise<void> {
  onEvent({ type: 'progress', phase: 'started' });
  try {
    const { system, prompt } = buildRequirementsPrompts(config, loadBrdProjectContext(config.projectDir));
    const client = await createSimpleClient({
      systemPrompt: system,
      modelShorthand: config.modelShorthand ?? 'sonnet',
      thinkingLevel: config.thinkingLevel ?? 'medium',
      maxSteps: 1,
      tools: {},
    });

    const call = async (userPrompt: string) => {
      const result = await generateText({
        model: client.model,
        system,
        prompt: userPrompt,
        abortSignal: config.abortSignal,
        output: Output.object({ schema: GeneratedBodySchema }),
      });
      // biome-ignore lint/suspicious/noExplicitAny: result.output type varies with the OUTPUT generic
      const anyResult = result as any;
      const direct = anyResult.output != null ? GeneratedBodySchema.safeParse(anyResult.output) : null;
      if (direct?.success) return { body: direct.data as GeneratedBody, text: String(anyResult.text ?? '') };
      onEvent({ type: 'progress', phase: 'parsing' });
      const text = String(anyResult.text ?? '');
      const parsed = parseLLMJson(text, GeneratedBodySchema);
      return { body: parsed ? (parsed as GeneratedBody) : null, text };
    };

    const first = await call(prompt);
    if (first.body) {
      onEvent({ type: 'done', body: first.body });
      return;
    }

    onEvent({ type: 'progress', phase: 'repairing' });
    const validation = GeneratedBodySchema.safeParse(safeJson(first.text));
    const errors = validation.success ? ['Output was not valid JSON'] : formatZodErrors(validation.error);
    const retry = await call(`${prompt}\n\n${buildValidationRetryPrompt('requirements set', errors)}`);
    if (retry.body) {
      onEvent({ type: 'done', body: retry.body });
      return;
    }
    onEvent({ type: 'error', error: 'The model did not return a valid requirements set after one retry' });
  } catch (err: unknown) {
    onEvent({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/main/ai/runners/__tests__/requirements-generator.test.ts && npm run typecheck`
Expected: PASS (6 tests); no type errors. If `formatZodErrors` expects a `ZodError` from a different Zod entry point than the one `GeneratedBodySchema` produces, replace `formatZodErrors(validation.error)` with `validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)`.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/prompts/requirements_generator.md apps/desktop/src/main/ai/runners/requirements-generator.ts apps/desktop/src/main/ai/runners/__tests__/requirements-generator.test.ts
git commit -m "feat(requirements): add structured-output requirements generator runner

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: IPC channels, handlers, preload API, types, mock

**Files:**
- Modify: `src/shared/constants/ipc.ts`, `src/shared/types/ipc.ts`, `src/renderer/lib/browser-mock.ts`, `src/preload/api/agent-api.ts`, `src/main/ipc-handlers/index.ts`
- Create: `src/main/ipc-handlers/requirements-handlers.ts`, `src/preload/api/modules/requirements-api.ts`
- Test: `src/main/ipc-handlers/__tests__/requirements-handlers.test.ts`

**Interfaces:**
- Produces channels `REQUIREMENTS_READ/WRITE/APPROVE/GENERATE/CANCEL/PROGRESS/DONE/ERROR` and preload methods `requirementsRead(projectId, slug)`, `requirementsWrite(projectId, slug, set)`, `requirementsApprove(projectId, slug, set)`, `requirementsGenerate(projectId, request)`, `requirementsCancel(runId)`, `onRequirementsProgress/Done/Error(cb)`.

- [ ] **Step 1: Channels**

In `src/shared/constants/ipc.ts` after the BRD block:

```ts
  // Requirements set
  REQUIREMENTS_READ: 'requirements:read',
  REQUIREMENTS_WRITE: 'requirements:write',
  REQUIREMENTS_APPROVE: 'requirements:approve',
  REQUIREMENTS_GENERATE: 'requirements:generate',
  REQUIREMENTS_CANCEL: 'requirements:cancel',
  REQUIREMENTS_PROGRESS: 'requirements:progress',
  REQUIREMENTS_DONE: 'requirements:done',
  REQUIREMENTS_ERROR: 'requirements:error',
```

- [ ] **Step 2: Write the failing handler test**

```ts
// apps/desktop/src/main/ipc-handlers/__tests__/requirements-handlers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequirementsSet } from '../../../shared/types/requirements';

const { handlers, sent, getProject, files, brd, run, featureSettings } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  sent: [] as unknown[][],
  getProject: vi.fn(),
  files: { readRequirements: vi.fn(), writeRequirements: vi.fn(), brdHash: vi.fn(() => 'HASH') },
  brd: { readBrd: vi.fn() },
  run: vi.fn(),
  featureSettings: vi.fn(() => ({ model: 'sonnet', thinkingLevel: 'medium' })),
}));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn((c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn)) } }));
vi.mock('../utils', () => ({ safeSendToRenderer: vi.fn((_g: unknown, ...args: unknown[]) => { sent.push(args); return true; }) }));
vi.mock('../../project-store', () => ({ projectStore: { getProject } }));
vi.mock('../../brd/requirements-files', () => files);
vi.mock('../../brd/brd-files', () => brd);
vi.mock('../../ai/runners/requirements-generator', () => ({ runRequirementsGenerator: run }));
vi.mock('../feature-settings-helper', () => ({ getActiveProviderFeatureSettings: featureSettings }));

import { registerRequirementsHandlers } from '../requirements-handlers';

const goodBrd = '---\ntitle: A\nstatus: draft\ncreated: 2026-09-20\n---\n# A\n\n## Summary\n\ns\n\n## Problem and goals\n\np\n\n## Scope\n\n### In scope\n\nx\n\n## Functional requirements\n\n### F\n\n1. r\n\n## Milestones\n\n### Milestone 1: One\n\nm\n';
const set: RequirementsSet = {
  version: 1, brdSlug: 'a', brdHash: 'HASH', status: 'draft', generatedAt: 't',
  requirements: [{ id: 'R1', title: 'r', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: false, included: true }],
  milestones: [{ id: 'M1', name: 'm', description: 'd', order: 1, included: true }],
  tasks: [{ id: 'T1', title: 't', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 1, included: true }],
};
const body = {
  requirements: [{ title: 'r', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: false }],
  milestones: [{ name: 'm', description: 'd', order: 1 }],
  tasks: [{ title: 't', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature' as const, order: 1 }],
};
const tick = () => new Promise((r) => setTimeout(r, 10));

describe('requirements handlers', () => {
  beforeEach(() => {
    handlers.clear(); sent.length = 0; vi.clearAllMocks();
    getProject.mockReturnValue({ id: 'p1', path: '/repo' });
    brd.readBrd.mockResolvedValue({ summary: { slug: 'a' }, content: goodBrd });
    registerRequirementsHandlers(() => null);
  });

  it('read returns the set and the current BRD hash', async () => {
    files.readRequirements.mockResolvedValue(set);
    expect(await handlers.get('requirements:read')!({}, 'p1', 'a')).toEqual({ success: true, data: { set, currentBrdHash: 'HASH' } });
  });

  it('write forces draft and strips approvedAt', async () => {
    files.writeRequirements.mockImplementation(async (_p: string, _s: string, s: RequirementsSet) => s);
    const r = (await handlers.get('requirements:write')!({}, 'p1', 'a', { ...set, status: 'approved', approvedAt: 'x' })) as { data: RequirementsSet };
    expect(r.data.status).toBe('draft');
    expect(r.data.approvedAt).toBeUndefined();
  });

  it('approve refuses with warnings and otherwise writes approved', async () => {
    files.writeRequirements.mockImplementation(async (_p: string, _s: string, s: RequirementsSet) => s);
    const bad = { ...set, tasks: [] };
    const refused = await handlers.get('requirements:approve')!({}, 'p1', 'a', bad);
    expect(refused).toMatchObject({ success: false, error: expect.stringContaining('R1') });
    const ok = (await handlers.get('requirements:approve')!({}, 'p1', 'a', set)) as { data: RequirementsSet };
    expect(ok.data.status).toBe('approved');
    expect(ok.data.approvedAt).toBeTruthy();
  });

  it('generate is refused when the BRD fails the structure check', async () => {
    brd.readBrd.mockResolvedValue({ summary: { slug: 'a' }, content: '---\ntitle: A\ncreated: 2026-01-01\n---\n# A\n' });
    const r = await handlers.get('requirements:generate')!({}, 'p1', { slug: 'a', mode: 'generate' });
    expect(r).toMatchObject({ success: false, error: expect.stringContaining('Summary') });
  });

  it('generate post-processes the body into a set with ids and hash, and emits done', async () => {
    files.readRequirements.mockResolvedValue(null);
    run.mockImplementation(async (_c: unknown, onEvent: (e: unknown) => void) => {
      onEvent({ type: 'progress', phase: 'started' });
      onEvent({ type: 'done', body });
    });
    const r = (await handlers.get('requirements:generate')!({}, 'p1', { slug: 'a', mode: 'generate' })) as { data: { runId: string } };
    await tick();
    expect(sent[0]).toEqual(['requirements:progress', { runId: r.data.runId, phase: 'started' }]);
    const done = sent[1][1] as { runId: string; set: RequirementsSet; warnings: string[] };
    expect(sent[1][0]).toBe('requirements:done');
    expect(done.set).toMatchObject({ brdSlug: 'a', brdHash: 'HASH', status: 'draft', version: 1 });
    expect(done.set.requirements[0]).toMatchObject({ id: 'R1', included: true });
    expect(done.set.tasks[0]).toMatchObject({ id: 'T1', requirementIds: ['R1'] });
  });

  it('refine requires an existing set and merges with selection', async () => {
    files.readRequirements.mockResolvedValue(null);
    expect(await handlers.get('requirements:generate')!({}, 'p1', { slug: 'a', mode: 'refine', feedback: 'x' })).toMatchObject({ success: false });
    files.readRequirements.mockResolvedValue(set);
    run.mockImplementation(async (cfg: { previous?: RequirementsSet; selection?: string[] }, onEvent: (e: unknown) => void) => {
      expect(cfg.previous).toEqual(set);
      expect(cfg.selection).toEqual(['R1']);
      onEvent({ type: 'done', body: { ...body, requirements: [{ id: 'R1', ...body.requirements[0], title: 'changed' }], changeSummary: 'renamed R1' } });
    });
    await handlers.get('requirements:generate')!({}, 'p1', { slug: 'a', mode: 'refine', feedback: 'x', selection: ['R1'] });
    await tick();
    const done = sent.at(-1)![1] as { set: RequirementsSet; changeSummary?: string };
    expect(done.set.requirements[0].title).toBe('changed');
    expect(done.changeSummary).toBe('renamed R1');
  });

  it('rejects a concurrent run for the same slug and supports cancel', async () => {
    files.readRequirements.mockResolvedValue(null);
    run.mockImplementation((cfg: { abortSignal?: AbortSignal }, onEvent: (e: unknown) => void) =>
      new Promise<void>((resolve) => cfg.abortSignal?.addEventListener('abort', () => { onEvent({ type: 'error', error: 'cancelled' }); resolve(); })),
    );
    const first = (await handlers.get('requirements:generate')!({}, 'p1', { slug: 'a', mode: 'generate' })) as { data: { runId: string } };
    expect(await handlers.get('requirements:generate')!({}, 'p1', { slug: 'a', mode: 'generate' })).toEqual({ success: false, error: 'A run is already in progress for this BRD' });
    expect(await handlers.get('requirements:cancel')!({}, first.data.runId)).toEqual({ success: true });
    await tick();
    expect(sent.at(-1)).toEqual(['requirements:error', { runId: first.data.runId, error: 'cancelled' }]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/main/ipc-handlers/__tests__/requirements-handlers.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Write `src/main/ipc-handlers/requirements-handlers.ts`**

```ts
// apps/desktop/src/main/ipc-handlers/requirements-handlers.ts
import { randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

import { assignIds, mergeRefinement, validateRequirementsSet } from '../../shared/brd/requirements';
import { checkBrdStructure } from '../../shared/brd/structure';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import type { RequirementsGenerateRequest, RequirementsSet } from '../../shared/types/requirements';
import type { ThinkingLevel } from '../ai/config/types';
import { runRequirementsGenerator } from '../ai/runners/requirements-generator';
import { readBrd } from '../brd/brd-files';
import { brdHash, readRequirements, writeRequirements } from '../brd/requirements-files';
import { projectStore } from '../project-store';
import { getActiveProviderFeatureSettings } from './feature-settings-helper';
import { safeSendToRenderer } from './utils';

interface ActiveRun { runId: string; slug: string; controller: AbortController }
const activeRuns = new Map<string, ActiveRun>(); // keyed by `${projectId}:${slug}`

function fail(error: unknown): IPCResult<never> {
  return { success: false, error: error instanceof Error ? error.message : String(error) };
}

export function registerRequirementsHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC_CHANNELS.REQUIREMENTS_READ, async (_e, projectId: string, slug: string) => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    try {
      const [set, brd] = await Promise.all([readRequirements(project.path, slug), readBrd(project.path, slug)]);
      return { success: true, data: { set, currentBrdHash: brdHash(brd.content) } };
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(IPC_CHANNELS.REQUIREMENTS_WRITE, async (_e, projectId: string, slug: string, set: RequirementsSet) => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    try {
      const { approvedAt: _a, ...rest } = set;
      const data = await writeRequirements(project.path, slug, { ...rest, status: 'draft' });
      return { success: true, data };
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(IPC_CHANNELS.REQUIREMENTS_APPROVE, async (_e, projectId: string, slug: string, set: RequirementsSet) => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    const warnings = validateRequirementsSet(set);
    if (warnings.length > 0) return { success: false, error: `Cannot approve: ${warnings.join('; ')}` };
    try {
      const data = await writeRequirements(project.path, slug, { ...set, status: 'approved', approvedAt: new Date().toISOString() });
      return { success: true, data };
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(IPC_CHANNELS.REQUIREMENTS_GENERATE, async (_e, projectId: string, request: RequirementsGenerateRequest): Promise<IPCResult<{ runId: string }>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    const key = `${projectId}:${request.slug}`;
    if (activeRuns.has(key)) return { success: false, error: 'A run is already in progress for this BRD' };

    let brdMarkdown: string;
    let previous: RequirementsSet | null;
    try {
      brdMarkdown = (await readBrd(project.path, request.slug)).content;
      previous = await readRequirements(project.path, request.slug);
    } catch (err) {
      return fail(err);
    }
    const structure = checkBrdStructure(brdMarkdown);
    if (!structure.ok) {
      const missing = structure.sections.filter((s) => s.required && (!s.present || s.empty)).map((s) => s.heading);
      const fm = structure.frontmatterErrors;
      return { success: false, error: `The BRD is not ready: ${[...missing.map((m) => `${m} is missing or empty`), ...fm].join('; ')}` };
    }
    if (request.mode === 'refine' && !previous) return { success: false, error: 'Generate a requirements set before refining it' };

    const runId = randomUUID();
    const controller = new AbortController();
    activeRuns.set(key, { runId, slug: request.slug, controller });
    const { model, thinkingLevel } = getActiveProviderFeatureSettings('roadmap');
    const hash = brdHash(brdMarkdown);

    // Defer past the invoke reply so the renderer knows the runId before any event arrives.
    setTimeout(() => {
      if (controller.signal.aborted) {
        activeRuns.delete(key);
        safeSendToRenderer(getMainWindow, IPC_CHANNELS.REQUIREMENTS_ERROR, { runId, error: 'cancelled' });
        return;
      }
      void runRequirementsGenerator(
      {
        projectDir: project.path,
        mode: request.mode,
        brdMarkdown,
        previous: previous ?? undefined,
        feedback: request.feedback,
        selection: request.selection,
        modelShorthand: model,
        thinkingLevel: thinkingLevel as ThinkingLevel,
        abortSignal: controller.signal,
      },
      (event) => {
        if (event.type === 'progress') {
          safeSendToRenderer(getMainWindow, IPC_CHANNELS.REQUIREMENTS_PROGRESS, { runId, phase: event.phase });
          return;
        }
        if (activeRuns.get(key)?.runId === runId) activeRuns.delete(key);
        if (event.type === 'error') {
          safeSendToRenderer(getMainWindow, IPC_CHANNELS.REQUIREMENTS_ERROR, { runId, error: event.error });
          return;
        }
        if (request.mode === 'refine' && previous) {
          const { set, warnings } = mergeRefinement(previous, event.body, request.selection);
          safeSendToRenderer(getMainWindow, IPC_CHANNELS.REQUIREMENTS_DONE, { runId, set, changeSummary: event.body.changeSummary, warnings });
        } else {
          const assigned = assignIds(event.body);
          const set: RequirementsSet = {
            version: 1,
            brdSlug: request.slug,
            brdHash: hash,
            status: 'draft',
            generatedAt: new Date().toISOString(),
            requirements: assigned.requirements,
            milestones: assigned.milestones,
            tasks: assigned.tasks,
          };
          safeSendToRenderer(getMainWindow, IPC_CHANNELS.REQUIREMENTS_DONE, { runId, set, warnings: assigned.warnings });
        }
      },
    );
    }, 0);
    return { success: true, data: { runId } };
  });

  ipcMain.handle(IPC_CHANNELS.REQUIREMENTS_CANCEL, (_e, runId: string): IPCResult => {
    const run = [...activeRuns.values()].find((r) => r.runId === runId);
    if (!run) return { success: false, error: `No running generation with id ${runId}` };
    run.controller.abort();
    return { success: true };
  });
}
```

Register in `src/main/ipc-handlers/index.ts` next to the BRD handler: import `registerRequirementsHandlers` from `./requirements-handlers` and call `registerRequirementsHandlers(getMainWindow);` after `registerBrdHandlers(getMainWindow);`.

- [ ] **Step 5: Run the handler test**

Run: `cd apps/desktop && npx vitest run src/main/ipc-handlers/__tests__/requirements-handlers.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Preload, ElectronAPI, mock**

```ts
// apps/desktop/src/preload/api/modules/requirements-api.ts
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import type {
  RequirementsDone, RequirementsError, RequirementsGenerateRequest, RequirementsProgress, RequirementsSet,
} from '../../../shared/types/requirements';
import { createIpcListener, invokeIpc, type IpcListenerCleanup } from './ipc-utils';

export interface RequirementsAPI {
  requirementsRead: (projectId: string, slug: string) => Promise<IPCResult<{ set: RequirementsSet | null; currentBrdHash: string }>>;
  requirementsWrite: (projectId: string, slug: string, set: RequirementsSet) => Promise<IPCResult<RequirementsSet>>;
  requirementsApprove: (projectId: string, slug: string, set: RequirementsSet) => Promise<IPCResult<RequirementsSet>>;
  requirementsGenerate: (projectId: string, request: RequirementsGenerateRequest) => Promise<IPCResult<{ runId: string }>>;
  requirementsCancel: (runId: string) => Promise<IPCResult>;
  onRequirementsProgress: (callback: (p: RequirementsProgress) => void) => IpcListenerCleanup;
  onRequirementsDone: (callback: (d: RequirementsDone) => void) => IpcListenerCleanup;
  onRequirementsError: (callback: (e: RequirementsError) => void) => IpcListenerCleanup;
}

export const createRequirementsAPI = (): RequirementsAPI => ({
  requirementsRead: (projectId, slug) => invokeIpc(IPC_CHANNELS.REQUIREMENTS_READ, projectId, slug),
  requirementsWrite: (projectId, slug, set) => invokeIpc(IPC_CHANNELS.REQUIREMENTS_WRITE, projectId, slug, set),
  requirementsApprove: (projectId, slug, set) => invokeIpc(IPC_CHANNELS.REQUIREMENTS_APPROVE, projectId, slug, set),
  requirementsGenerate: (projectId, request) => invokeIpc(IPC_CHANNELS.REQUIREMENTS_GENERATE, projectId, request),
  requirementsCancel: (runId) => invokeIpc(IPC_CHANNELS.REQUIREMENTS_CANCEL, runId),
  onRequirementsProgress: (callback) => createIpcListener<[RequirementsProgress]>(IPC_CHANNELS.REQUIREMENTS_PROGRESS, callback),
  onRequirementsDone: (callback) => createIpcListener<[RequirementsDone]>(IPC_CHANNELS.REQUIREMENTS_DONE, callback),
  onRequirementsError: (callback) => createIpcListener<[RequirementsError]>(IPC_CHANNELS.REQUIREMENTS_ERROR, callback),
});
```

In `src/preload/api/agent-api.ts`: import `{ createRequirementsAPI, RequirementsAPI } from './modules/requirements-api'`, add `RequirementsAPI` wherever `BrdAPI` is listed (the extends list and the export list), create `const requirementsAPI = createRequirementsAPI();` next to `brdAPI`, and spread `...requirementsAPI`.

In `src/shared/types/ipc.ts`, after the BRD declarations (import the types from `./requirements`):

```ts
  // Requirements set
  requirementsRead: (projectId: string, slug: string) => Promise<IPCResult<{ set: RequirementsSet | null; currentBrdHash: string }>>;
  requirementsWrite: (projectId: string, slug: string, set: RequirementsSet) => Promise<IPCResult<RequirementsSet>>;
  requirementsApprove: (projectId: string, slug: string, set: RequirementsSet) => Promise<IPCResult<RequirementsSet>>;
  requirementsGenerate: (projectId: string, request: RequirementsGenerateRequest) => Promise<IPCResult<{ runId: string }>>;
  requirementsCancel: (runId: string) => Promise<IPCResult>;
  onRequirementsProgress: (callback: (p: RequirementsProgress) => void) => () => void;
  onRequirementsDone: (callback: (d: RequirementsDone) => void) => () => void;
  onRequirementsError: (callback: (e: RequirementsError) => void) => () => void;
```

In `src/renderer/lib/browser-mock.ts` after the BRD stubs:

```ts
  requirementsRead: async () => ({ success: true, data: { set: null, currentBrdHash: '' } }),
  requirementsWrite: async () => ({ success: false, error: 'Not available in browser mock' }),
  requirementsApprove: async () => ({ success: false, error: 'Not available in browser mock' }),
  requirementsGenerate: async () => ({ success: false, error: 'Not available in browser mock' }),
  requirementsCancel: async () => ({ success: false, error: 'Not available in browser mock' }),
  onRequirementsProgress: () => () => undefined,
  onRequirementsDone: () => () => undefined,
  onRequirementsError: () => () => undefined,
```

- [ ] **Step 7: Typecheck, lint, commit**

Run: `cd apps/desktop && npm run typecheck && npm run lint`
Expected: clean.

```bash
git add apps/desktop/src/shared/constants/ipc.ts apps/desktop/src/shared/types/ipc.ts apps/desktop/src/renderer/lib/browser-mock.ts apps/desktop/src/preload/api/agent-api.ts apps/desktop/src/preload/api/modules/requirements-api.ts apps/desktop/src/main/ipc-handlers/index.ts apps/desktop/src/main/ipc-handlers/requirements-handlers.ts apps/desktop/src/main/ipc-handlers/__tests__/requirements-handlers.test.ts
git commit -m "feat(requirements): add IPC handlers, preload API, and run management

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: i18n keys and the requirements store

**Files:**
- Modify: `src/shared/i18n/locales/en/requirements.json`, `src/shared/i18n/locales/fr/requirements.json` (add a `set` block)
- Create: `src/renderer/stores/requirements-store.ts`
- Test: `src/renderer/stores/__tests__/requirements-store.test.ts`

**Interfaces:**
- Produces: `useRequirementsStore`, `setupRequirementsListeners(): () => void`.

- [ ] **Step 1: i18n keys**

Add to `en/requirements.json` as a new top-level `"set"` object:

```json
  "set": {
    "tab": "Requirements",
    "documentTab": "Document",
    "none": "No requirements set yet.",
    "generate": "Generate requirements",
    "notReady": "The BRD is not ready to split:",
    "running": "Generating…",
    "phase": { "started": "Asking the model", "parsing": "Parsing the answer", "repairing": "Repairing the answer" },
    "cancel": "Cancel",
    "sections": { "requirements": "Requirements", "milestones": "Milestones", "tasks": "Tasks" },
    "fields": {
      "title": "Title", "description": "Description", "area": "Area", "acceptance": "Acceptance criteria",
      "addCriterion": "Add criterion", "needsDesign": "Needs design", "included": "Included", "select": "Select for refinement",
      "name": "Name", "category": "Category", "milestone": "Milestone", "requirements": "Covers", "moveUp": "Move up", "moveDown": "Move down"
    },
    "category": { "feature": "Feature", "bug": "Bug", "refactor": "Refactor", "docs": "Docs" },
    "status": { "draft": "Draft", "approved": "Approved" },
    "warnings": "Integrity warnings",
    "stale": "The BRD changed since this set was generated.",
    "regenerate": "Regenerate from BRD",
    "save": "Save",
    "saving": "Saving…",
    "approve": "Approve",
    "approving": "Approving…",
    "unsaved": "Unsaved changes",
    "saved": "Saved",
    "assist": {
      "title": "AI refinement",
      "feedbackLabel": "Feedback",
      "feedbackPlaceholder": "What should change? Select items above to limit the change to them.",
      "refineSelected": "Refine selected ({{count}})",
      "refineSet": "Refine set",
      "proposalTitle": "Proposed changes",
      "changeSummary": "Change summary",
      "counts": "{{added}} added, {{changed}} changed, {{removed}} removed",
      "accept": "Accept",
      "discard": "Discard",
      "error": "Refinement failed: {{error}}"
    },
    "error": "Something went wrong: {{error}}"
  }
```

And to `fr/requirements.json`:

```json
  "set": {
    "tab": "Exigences",
    "documentTab": "Document",
    "none": "Aucun ensemble d'exigences pour l'instant.",
    "generate": "Générer les exigences",
    "notReady": "Le BRD n'est pas prêt à être découpé :",
    "running": "Génération…",
    "phase": { "started": "Interrogation du modèle", "parsing": "Analyse de la réponse", "repairing": "Correction de la réponse" },
    "cancel": "Annuler",
    "sections": { "requirements": "Exigences", "milestones": "Jalons", "tasks": "Tâches" },
    "fields": {
      "title": "Titre", "description": "Description", "area": "Domaine", "acceptance": "Critères d'acceptation",
      "addCriterion": "Ajouter un critère", "needsDesign": "Design requis", "included": "Inclus", "select": "Sélectionner pour l'affinage",
      "name": "Nom", "category": "Catégorie", "milestone": "Jalon", "requirements": "Couvre", "moveUp": "Monter", "moveDown": "Descendre"
    },
    "category": { "feature": "Fonctionnalité", "bug": "Bug", "refactor": "Refactorisation", "docs": "Docs" },
    "status": { "draft": "Brouillon", "approved": "Approuvé" },
    "warnings": "Avertissements d'intégrité",
    "stale": "Le BRD a changé depuis la génération de cet ensemble.",
    "regenerate": "Régénérer depuis le BRD",
    "save": "Enregistrer",
    "saving": "Enregistrement…",
    "approve": "Approuver",
    "approving": "Approbation…",
    "unsaved": "Modifications non enregistrées",
    "saved": "Enregistré",
    "assist": {
      "title": "Affinage IA",
      "feedbackLabel": "Retour",
      "feedbackPlaceholder": "Que faut-il changer ? Sélectionnez des éléments ci-dessus pour limiter le changement.",
      "refineSelected": "Affiner la sélection ({{count}})",
      "refineSet": "Affiner l'ensemble",
      "proposalTitle": "Modifications proposées",
      "changeSummary": "Résumé des changements",
      "counts": "{{added}} ajoutés, {{changed}} modifiés, {{removed}} supprimés",
      "accept": "Accepter",
      "discard": "Rejeter",
      "error": "L'affinage a échoué : {{error}}"
    },
    "error": "Une erreur est survenue : {{error}}"
  }
```

Insert each block before the file's closing brace, after the existing `assist` block, with a comma.

- [ ] **Step 2: Write the failing store test**

```ts
// apps/desktop/src/renderer/stores/__tests__/requirements-store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRequirementsStore, setupRequirementsListeners } from '../requirements-store';
import type { RequirementsSet } from '../../../shared/types/requirements';

const api = {
  requirementsRead: vi.fn(), requirementsWrite: vi.fn(), requirementsApprove: vi.fn(),
  requirementsGenerate: vi.fn(), requirementsCancel: vi.fn(),
  onRequirementsProgress: vi.fn(), onRequirementsDone: vi.fn(), onRequirementsError: vi.fn(),
};
let progressCb: (p: { runId: string; phase: string }) => void = () => {};
let doneCb: (d: { runId: string; set: RequirementsSet; changeSummary?: string; warnings: string[] }) => void = () => {};
let errorCb: (e: { runId: string; error: string }) => void = () => {};

const set: RequirementsSet = {
  version: 1, brdSlug: 'a', brdHash: 'H', status: 'draft', generatedAt: 't',
  requirements: [{ id: 'R1', title: 'r', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: false, included: true }],
  milestones: [{ id: 'M1', name: 'm', description: 'd', order: 1, included: true }, { id: 'M2', name: 'n', description: 'd', order: 2, included: true }],
  tasks: [{ id: 'T1', title: 't', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 1, included: true }],
};

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { window: unknown }).window = { electronAPI: api };
  api.onRequirementsProgress.mockImplementation((cb) => { progressCb = cb; return () => {}; });
  api.onRequirementsDone.mockImplementation((cb) => { doneCb = cb; return () => {}; });
  api.onRequirementsError.mockImplementation((cb) => { errorCb = cb; return () => {}; });
  useRequirementsStore.getState().reset();
});

describe('requirements-store', () => {
  it('load reads the set and hash and computes warnings', async () => {
    api.requirementsRead.mockResolvedValue({ success: true, data: { set, currentBrdHash: 'H' } });
    await useRequirementsStore.getState().load('p1', 'a');
    const s = useRequirementsStore.getState();
    expect(s.set).toEqual(set);
    expect(s.isStale()).toBe(false);
    expect(s.warnings).toEqual([]);
  });

  it('toggleInclude, edit, and moveMilestone mark dirty and recompute warnings', async () => {
    api.requirementsRead.mockResolvedValue({ success: true, data: { set, currentBrdHash: 'OTHER' } });
    await useRequirementsStore.getState().load('p1', 'a');
    expect(useRequirementsStore.getState().isStale()).toBe(true);
    useRequirementsStore.getState().toggleInclude('tasks', 'T1');
    expect(useRequirementsStore.getState().isDirty()).toBe(true);
    expect(useRequirementsStore.getState().warnings.join(' ')).toContain('R1');
    useRequirementsStore.getState().edit('requirements', 'R1', { title: 'Renamed' });
    expect(useRequirementsStore.getState().set?.requirements[0].title).toBe('Renamed');
    useRequirementsStore.getState().moveMilestone('M2', 'up');
    expect(useRequirementsStore.getState().set?.milestones.map((m) => [m.id, m.order])).toEqual([['M2', 1], ['M1', 2]]);
  });

  it('save writes and clears dirty; approve is refused when dirty or with warnings, else stores approved', async () => {
    api.requirementsRead.mockResolvedValue({ success: true, data: { set, currentBrdHash: 'H' } });
    await useRequirementsStore.getState().load('p1', 'a');
    useRequirementsStore.getState().edit('requirements', 'R1', { title: 'x' });
    expect(useRequirementsStore.getState().canApprove()).toBe(false);
    api.requirementsWrite.mockImplementation(async (_p: string, _s: string, s: RequirementsSet) => ({ success: true, data: s }));
    await useRequirementsStore.getState().save('p1');
    expect(useRequirementsStore.getState().isDirty()).toBe(false);
    expect(useRequirementsStore.getState().canApprove()).toBe(true);
    api.requirementsApprove.mockImplementation(async (_p: string, _s: string, s: RequirementsSet) => ({ success: true, data: { ...s, status: 'approved', approvedAt: 'now' } }));
    await useRequirementsStore.getState().approve('p1');
    expect(useRequirementsStore.getState().set?.status).toBe('approved');
    useRequirementsStore.getState().toggleInclude('tasks', 'T1');
    expect(useRequirementsStore.getState().canApprove()).toBe(false);
  });

  it('generate → progress → done becomes a proposal; accept installs it, discard drops it', async () => {
    const stop = setupRequirementsListeners();
    api.requirementsRead.mockResolvedValue({ success: true, data: { set: null, currentBrdHash: 'H' } });
    await useRequirementsStore.getState().load('p1', 'a');
    api.requirementsGenerate.mockResolvedValue({ success: true, data: { runId: 'r1' } });
    await useRequirementsStore.getState().generate('p1');
    expect(api.requirementsGenerate).toHaveBeenCalledWith('p1', { slug: 'a', mode: 'generate' });
    progressCb({ runId: 'r1', phase: 'parsing' });
    expect(useRequirementsStore.getState().run).toMatchObject({ status: 'running', phase: 'parsing' });
    doneCb({ runId: 'r1', set, warnings: ['w'] });
    expect(useRequirementsStore.getState().run.status).toBe('proposal');
    useRequirementsStore.getState().accept();
    expect(useRequirementsStore.getState().set).toEqual(set);
    expect(useRequirementsStore.getState().isDirty()).toBe(true);
    expect(useRequirementsStore.getState().run.status).toBe('idle');

    api.requirementsGenerate.mockResolvedValue({ success: true, data: { runId: 'r2' } });
    useRequirementsStore.getState().toggleSelect('R1');
    await useRequirementsStore.getState().refine('p1', 'shorter');
    expect(api.requirementsGenerate).toHaveBeenLastCalledWith('p1', { slug: 'a', mode: 'refine', feedback: 'shorter', selection: ['R1'] });
    doneCb({ runId: 'r2', set: { ...set, requirements: [{ ...set.requirements[0], title: 'S' }] }, changeSummary: 'shortened', warnings: [] });
    expect(useRequirementsStore.getState().run.proposal?.changeSummary).toBe('shortened');
    useRequirementsStore.getState().discard();
    expect(useRequirementsStore.getState().set?.requirements[0].title).toBe('r');

    api.requirementsGenerate.mockResolvedValue({ success: true, data: { runId: 'r3' } });
    await useRequirementsStore.getState().refine('p1', 'x');
    errorCb({ runId: 'r3', error: 'boom' });
    expect(useRequirementsStore.getState().run).toMatchObject({ status: 'idle', error: 'boom' });
    stop();
  });

  it('cancel calls the API with the run id', async () => {
    setupRequirementsListeners();
    api.requirementsRead.mockResolvedValue({ success: true, data: { set: null, currentBrdHash: 'H' } });
    await useRequirementsStore.getState().load('p1', 'a');
    api.requirementsGenerate.mockResolvedValue({ success: true, data: { runId: 'r9' } });
    api.requirementsCancel.mockResolvedValue({ success: true });
    await useRequirementsStore.getState().generate('p1');
    await useRequirementsStore.getState().cancel();
    expect(api.requirementsCancel).toHaveBeenCalledWith('r9');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/renderer/stores/__tests__/requirements-store.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Write `src/renderer/stores/requirements-store.ts`**

```ts
// apps/desktop/src/renderer/stores/requirements-store.ts
import { create } from 'zustand';

import { validateRequirementsSet } from '../../shared/brd/requirements';
import type {
  Milestone, ProposedTask, Requirement, RequirementsRunPhase, RequirementsSet,
} from '../../shared/types/requirements';

type Section = 'requirements' | 'milestones' | 'tasks';
type ItemOf<S extends Section> = S extends 'requirements' ? Requirement : S extends 'milestones' ? Milestone : ProposedTask;

interface Proposal { set: RequirementsSet; changeSummary?: string; warnings: string[] }
interface RunState { status: 'idle' | 'running' | 'proposal'; runId?: string; phase?: RequirementsRunPhase; proposal?: Proposal; error?: string }

interface RequirementsState {
  slug: string | null;
  set: RequirementsSet | null;
  savedSet: RequirementsSet | null;
  currentBrdHash: string;
  warnings: string[];
  selection: string[];
  run: RunState;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  isDirty: () => boolean;
  isStale: () => boolean;
  canApprove: () => boolean;
  reset: () => void;
  load: (projectId: string, slug: string) => Promise<void>;
  edit: <S extends Section>(section: S, id: string, patch: Partial<ItemOf<S>>) => void;
  toggleInclude: (section: Section, id: string) => void;
  toggleSelect: (id: string) => void;
  moveMilestone: (id: string, direction: 'up' | 'down') => void;
  save: (projectId: string) => Promise<void>;
  approve: (projectId: string) => Promise<void>;
  generate: (projectId: string) => Promise<void>;
  refine: (projectId: string, feedback: string) => Promise<void>;
  regenerate: (projectId: string) => Promise<void>;
  cancel: () => Promise<void>;
  accept: () => void;
  discard: () => void;
}

const idle: RunState = { status: 'idle' };
const initial = {
  slug: null as string | null,
  set: null as RequirementsSet | null,
  savedSet: null as RequirementsSet | null,
  currentBrdHash: '',
  warnings: [] as string[],
  selection: [] as string[],
  run: idle,
  isLoading: false,
  isSaving: false,
  error: null as string | null,
};

const same = (a: RequirementsSet | null, b: RequirementsSet | null) => JSON.stringify(a) === JSON.stringify(b);

export const useRequirementsStore = create<RequirementsState>((set, get) => {
  const update = (mutate: (s: RequirementsSet) => RequirementsSet) => {
    const current = get().set;
    if (!current) return;
    const next = mutate(current);
    set({ set: next, warnings: validateRequirementsSet(next) });
  };
  const startRun = async (projectId: string, request: Parameters<typeof window.electronAPI.requirementsGenerate>[1]) => {
    set({ run: { status: 'running', phase: 'started' } });
    const result = await window.electronAPI.requirementsGenerate(projectId, request);
    if (!result.success || !result.data) {
      set({ run: { status: 'idle', error: result.error ?? 'Unknown error' } });
      return;
    }
    set({ run: { status: 'running', runId: result.data.runId, phase: 'started' } });
  };

  return {
    ...initial,

    isDirty: () => !same(get().set, get().savedSet),
    isStale: () => {
      const current = get().set;
      return !!current && current.brdHash !== get().currentBrdHash;
    },
    canApprove: () => {
      const { set: s, warnings } = get();
      return !!s && s.status !== 'approved' && !get().isDirty() && warnings.length === 0;
    },

    reset: () => set({ ...initial, run: { ...idle } }),

    load: async (projectId, slug) => {
      set({ isLoading: true, error: null, slug, selection: [], run: { ...idle } });
      const result = await window.electronAPI.requirementsRead(projectId, slug);
      if (!result.success || !result.data) {
        set({ error: result.error ?? 'Unknown error', isLoading: false });
        return;
      }
      const { set: loaded, currentBrdHash } = result.data;
      set({ set: loaded, savedSet: loaded, currentBrdHash, warnings: loaded ? validateRequirementsSet(loaded) : [], isLoading: false });
    },

    edit: (section, id, patch) =>
      update((s) => ({
        ...s,
        [section]: (s[section] as Array<{ id: string }>).map((item) => (item.id === id ? { ...item, ...patch } : item)),
      })),

    toggleInclude: (section, id) =>
      update((s) => ({
        ...s,
        [section]: (s[section] as Array<{ id: string; included: boolean }>).map((item) =>
          item.id === id ? { ...item, included: !item.included } : item,
        ),
      })),

    toggleSelect: (id) =>
      set((s) => ({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] })),

    moveMilestone: (id, direction) =>
      update((s) => {
        const sorted = [...s.milestones].sort((a, b) => a.order - b.order);
        const i = sorted.findIndex((m) => m.id === id);
        const j = direction === 'up' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= sorted.length) return s;
        [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
        const reordered = sorted.map((m, idx) => ({ ...m, order: idx + 1 }));
        return { ...s, milestones: reordered };
      }),

    save: async (projectId) => {
      const { slug, set: s } = get();
      if (!slug || !s) return;
      set({ isSaving: true, error: null });
      const result = await window.electronAPI.requirementsWrite(projectId, slug, s);
      if (!result.success || !result.data) {
        set({ error: result.error ?? 'Unknown error', isSaving: false });
        return;
      }
      set({ set: result.data, savedSet: result.data, warnings: validateRequirementsSet(result.data), isSaving: false });
    },

    approve: async (projectId) => {
      const { slug, set: s } = get();
      if (!slug || !s || !get().canApprove()) return;
      set({ isSaving: true, error: null });
      const result = await window.electronAPI.requirementsApprove(projectId, slug, s);
      if (!result.success || !result.data) {
        set({ error: result.error ?? 'Unknown error', isSaving: false });
        return;
      }
      set({ set: result.data, savedSet: result.data, isSaving: false });
    },

    generate: async (projectId) => {
      const { slug } = get();
      if (!slug) return;
      await startRun(projectId, { slug, mode: 'generate' });
    },

    refine: async (projectId, feedback) => {
      const { slug, selection } = get();
      if (!slug) return;
      await startRun(projectId, { slug, mode: 'refine', feedback, ...(selection.length > 0 ? { selection } : {}) });
    },

    regenerate: async (projectId) => {
      const { slug } = get();
      if (!slug) return;
      await startRun(projectId, { slug, mode: 'refine', feedback: 'The BRD changed; update the set to match it. Keep ids of items that still apply.' });
    },

    cancel: async () => {
      const { runId } = get().run;
      if (runId) await window.electronAPI.requirementsCancel(runId);
    },

    accept: () => {
      const { run } = get();
      if (run.status !== 'proposal' || !run.proposal) return;
      const next = run.proposal.set;
      set({ set: next, warnings: validateRequirementsSet(next), selection: [], run: { ...idle } });
    },

    discard: () => set({ run: { ...idle } }),
  };
});

export function setupRequirementsListeners(): () => void {
  const store = useRequirementsStore;
  const isCurrent = (runId: string) => store.getState().run.runId === runId;
  const offProgress = window.electronAPI.onRequirementsProgress(({ runId, phase }) => {
    if (!isCurrent(runId)) return;
    store.setState((s) => ({ run: { ...s.run, phase } }));
  });
  const offDone = window.electronAPI.onRequirementsDone(({ runId, set: proposed, changeSummary, warnings }) => {
    if (!isCurrent(runId)) return;
    store.setState({ run: { status: 'proposal', runId, proposal: { set: proposed, changeSummary, warnings } } });
  });
  const offError = window.electronAPI.onRequirementsError(({ runId, error }) => {
    if (!isCurrent(runId)) return;
    store.setState({ run: { status: 'idle', error } });
  });
  return () => {
    offProgress();
    offDone();
    offError();
  };
}
```

- [ ] **Step 5: Run tests, typecheck, lint, commit**

Run: `cd apps/desktop && npx vitest run src/renderer/stores/__tests__/requirements-store.test.ts && npm run typecheck && npm run lint`
Expected: PASS (5 tests); clean.

```bash
git add apps/desktop/src/shared/i18n/locales/en/requirements.json apps/desktop/src/shared/i18n/locales/fr/requirements.json apps/desktop/src/renderer/stores/requirements-store.ts apps/desktop/src/renderer/stores/__tests__/requirements-store.test.ts
git commit -m "feat(requirements): add requirements store and i18n keys

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Requirements tab components and editor integration

**Files:**
- Create: `src/renderer/components/requirements/set/RequirementsTab.tsx`, `RequirementsSetEditor.tsx`, `RequirementsAssist.tsx`
- Modify: `src/renderer/components/requirements/BrdEditor.tsx` (tab strip), `RequirementsView.tsx` (dirty guard + listeners)
- Test: `src/renderer/components/requirements/set/__tests__/RequirementsTab.test.tsx`

- [ ] **Step 1: Write the failing component test**

```tsx
/**
 * @vitest-environment jsdom
 */
// apps/desktop/src/renderer/components/requirements/set/__tests__/RequirementsTab.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RequirementsTab } from '../RequirementsTab';
import { useRequirementsStore } from '../../../../stores/requirements-store';
import type { RequirementsSet } from '../../../../../shared/types/requirements';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && Object.keys(o).length > 0 ? `${k}:${Object.values(o).join(',')}` : k),
    i18n: { language: 'en' },
  }),
}));

const set: RequirementsSet = {
  version: 1, brdSlug: 'a', brdHash: 'H', status: 'draft', generatedAt: 't',
  requirements: [{ id: 'R1', title: 'Signup wizard', description: 'd', acceptanceCriteria: ['Has 3 steps'], area: 'Onboarding', needsDesign: true, included: true }],
  milestones: [{ id: 'M1', name: 'Foundations', description: 'd', order: 1, included: true }],
  tasks: [{ id: 'T1', title: 'Build wizard', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 1, included: true }],
};
const api = { requirementsGenerate: vi.fn(), requirementsWrite: vi.fn(), requirementsApprove: vi.fn(), requirementsCancel: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  useRequirementsStore.getState().reset();
  useRequirementsStore.setState({ slug: 'a', currentBrdHash: 'H' });
});

describe('RequirementsTab', () => {
  it('shows the empty state with Generate, and the structure gate message when the BRD is not ready', () => {
    const { rerender } = render(<RequirementsTab projectId="p1" brdReady={true} missingSections={[]} />);
    expect(screen.getByText('set.none')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'set.generate' })).toBeEnabled();
    rerender(<RequirementsTab projectId="p1" brdReady={false} missingSections={['Milestones']} />);
    expect(screen.getByRole('button', { name: 'set.generate' })).toBeDisabled();
    expect(screen.getByText(/Milestones/)).toBeInTheDocument();
  });

  it('shows the running state with phase and cancel', () => {
    useRequirementsStore.setState({ run: { status: 'running', runId: 'r1', phase: 'parsing' } });
    render(<RequirementsTab projectId="p1" brdReady={true} missingSections={[]} />);
    expect(screen.getByText('set.phase.parsing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'set.cancel' })).toBeInTheDocument();
  });

  it('renders the set, blocks Approve while warnings exist, and toggles the refine label with selection', async () => {
    useRequirementsStore.setState({ set, savedSet: set, warnings: [] });
    render(<RequirementsTab projectId="p1" brdReady={true} missingSections={[]} />);
    expect(screen.getByDisplayValue('Signup wizard')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Foundations')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Build wizard')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'set.approve' })).toBeEnabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'set.fields.included T1' }));
    expect(screen.getByText('set.warnings')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'set.approve' })).toBeDisabled();

    expect(screen.getByRole('button', { name: 'set.assist.refineSet' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'set.fields.select R1' }));
    expect(screen.getByRole('button', { name: 'set.assist.refineSelected:1' })).toBeInTheDocument();
  });

  it('shows a proposal with counts and accept installs it', () => {
    const proposed = { ...set, requirements: [{ ...set.requirements[0], title: 'Renamed' }] };
    useRequirementsStore.setState({ set, savedSet: set, warnings: [], run: { status: 'proposal', runId: 'r1', proposal: { set: proposed, changeSummary: 'renamed', warnings: [] } } });
    render(<RequirementsTab projectId="p1" brdReady={true} missingSections={[]} />);
    expect(screen.getByText('renamed')).toBeInTheDocument();
    expect(screen.getAllByText(/set\.assist\.counts:/).length).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: 'set.assist.accept' }));
    expect(useRequirementsStore.getState().set?.requirements[0].title).toBe('Renamed');
    expect(screen.getByText('set.unsaved')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/renderer/components/requirements/set/`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the components**

`RequirementsAssist.tsx`:

```tsx
// apps/desktop/src/renderer/components/requirements/set/RequirementsAssist.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';

import { diffSets } from '../../../../shared/brd/requirements';
import { Button } from '../../ui/button';
import { Textarea } from '../../ui/textarea';
import { useRequirementsStore } from '../../../stores/requirements-store';

export function RequirementsAssist({ projectId }: { projectId: string }) {
  const { t } = useTranslation('requirements');
  const [feedback, setFeedback] = useState('');
  const { set, selection, run, refine, accept, discard } = useRequirementsStore();
  if (!set) return null;
  const busy = run.status === 'running';
  const proposal = run.status === 'proposal' ? run.proposal : undefined;
  const counts = proposal ? diffSets(set, proposal.set) : null;

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="h-4 w-4" />
        {t('set.assist.title')}
      </div>
      <label className="block text-xs font-medium" htmlFor="req-feedback">{t('set.assist.feedbackLabel')}</label>
      <Textarea id="req-feedback" aria-label={t('set.assist.feedbackLabel')} rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder={t('set.assist.feedbackPlaceholder')} disabled={busy} />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy || feedback.trim().length === 0} onClick={() => void refine(projectId, feedback)}>
          {selection.length > 0 ? t('set.assist.refineSelected', { count: selection.length }) : t('set.assist.refineSet')}
        </Button>
        {run.error && <span className="text-xs text-destructive">{t('set.assist.error', { error: run.error })}</span>}
      </div>
      {proposal && counts && (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
          <div className="font-medium">{t('set.assist.proposalTitle')}</div>
          {proposal.changeSummary && (
            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
              <span className="font-medium">{t('set.assist.changeSummary')}: </span>
              {proposal.changeSummary}
            </p>
          )}
          <ul className="mt-2 text-xs text-muted-foreground">
            {(['requirements', 'milestones', 'tasks'] as const).map((s) => (
              <li key={s}>
                {t(`set.sections.${s}`)}: {t('set.assist.counts', { added: counts[s].added, changed: counts[s].changed, removed: counts[s].removed })}
              </li>
            ))}
          </ul>
          {proposal.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-amber-600">{proposal.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          )}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={accept}>{t('set.assist.accept')}</Button>
            <Button size="sm" variant="outline" onClick={discard}>{t('set.assist.discard')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

`RequirementsSetEditor.tsx`:

```tsx
// apps/desktop/src/renderer/components/requirements/set/RequirementsSetEditor.tsx
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';

import { PROPOSED_TASK_CATEGORIES, type Milestone, type ProposedTask, type Requirement } from '../../../../shared/types/requirements';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Input } from '../../ui/input';
import { Textarea } from '../../ui/textarea';
import { cn } from '../../../lib/utils';
import { useRequirementsStore } from '../../../stores/requirements-store';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="text-xs">
      <span className="mb-1 block font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function ItemFrame({ id, included, selected, onInclude, onSelect, children }: {
  id: string; included: boolean; selected: boolean; onInclude: () => void; onSelect: () => void; children: React.ReactNode;
}) {
  const { t } = useTranslation('requirements');
  return (
    <div className={cn('rounded-md border border-border p-3 space-y-2', !included && 'opacity-60')}>
      <div className="flex items-center gap-3 text-xs">
        <span className="font-mono font-medium">{id}</span>
        <span className="flex items-center gap-1">
          <Checkbox aria-label={`${t('set.fields.included')} ${id}`} checked={included} onCheckedChange={onInclude} />
          {t('set.fields.included')}
        </span>
        <span className="flex items-center gap-1">
          <Checkbox aria-label={`${t('set.fields.select')} ${id}`} checked={selected} onCheckedChange={onSelect} />
          {t('set.fields.select')}
        </span>
      </div>
      {children}
    </div>
  );
}

export function RequirementsSetEditor() {
  const { t } = useTranslation('requirements');
  const { set, selection, edit, toggleInclude, toggleSelect, moveMilestone } = useRequirementsStore();
  if (!set) return null;
  const milestones = [...set.milestones].sort((a, b) => a.order - b.order);
  const isSelected = (id: string) => selection.includes(id);

  const requirementCard = (r: Requirement) => (
    <ItemFrame key={r.id} id={r.id} included={r.included} selected={isSelected(r.id)} onInclude={() => toggleInclude('requirements', r.id)} onSelect={() => toggleSelect(r.id)}>
      <Field label={t('set.fields.title')}><Input value={r.title} onChange={(e) => edit('requirements', r.id, { title: e.target.value })} /></Field>
      <Field label={t('set.fields.description')}><Textarea rows={2} value={r.description} onChange={(e) => edit('requirements', r.id, { description: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('set.fields.area')}><Input value={r.area} onChange={(e) => edit('requirements', r.id, { area: e.target.value })} /></Field>
        <span className="flex items-end gap-2 pb-2 text-xs">
          <Checkbox aria-label={`${t('set.fields.needsDesign')} ${r.id}`} checked={r.needsDesign} onCheckedChange={() => edit('requirements', r.id, { needsDesign: !r.needsDesign })} />
          {t('set.fields.needsDesign')}
        </span>
      </div>
      <div className="text-xs">
        <span className="mb-1 block font-medium text-muted-foreground">{t('set.fields.acceptance')}</span>
        {r.acceptanceCriteria.map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: criteria are plain strings without ids
          <div key={`${r.id}-ac-${i}`} className="mb-1 flex gap-1">
            <Input value={c} onChange={(e) => edit('requirements', r.id, { acceptanceCriteria: r.acceptanceCriteria.map((x, j) => (j === i ? e.target.value : x)) })} />
            <Button size="icon" variant="ghost" aria-label="remove" onClick={() => edit('requirements', r.id, { acceptanceCriteria: r.acceptanceCriteria.filter((_, j) => j !== i) })}><X className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => edit('requirements', r.id, { acceptanceCriteria: [...r.acceptanceCriteria, ''] })}><Plus className="mr-1 h-3.5 w-3.5" />{t('set.fields.addCriterion')}</Button>
      </div>
    </ItemFrame>
  );

  const milestoneCard = (m: Milestone, index: number) => (
    <ItemFrame key={m.id} id={m.id} included={m.included} selected={isSelected(m.id)} onInclude={() => toggleInclude('milestones', m.id)} onSelect={() => toggleSelect(m.id)}>
      <div className="flex items-end gap-2">
        <div className="flex-1"><Field label={t('set.fields.name')}><Input value={m.name} onChange={(e) => edit('milestones', m.id, { name: e.target.value })} /></Field></div>
        <Button size="icon" variant="ghost" aria-label={t('set.fields.moveUp')} disabled={index === 0} onClick={() => moveMilestone(m.id, 'up')}><ArrowUp className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" aria-label={t('set.fields.moveDown')} disabled={index === milestones.length - 1} onClick={() => moveMilestone(m.id, 'down')}><ArrowDown className="h-4 w-4" /></Button>
      </div>
      <Field label={t('set.fields.description')}><Textarea rows={2} value={m.description} onChange={(e) => edit('milestones', m.id, { description: e.target.value })} /></Field>
    </ItemFrame>
  );

  const taskCard = (task: ProposedTask) => (
    <ItemFrame key={task.id} id={task.id} included={task.included} selected={isSelected(task.id)} onInclude={() => toggleInclude('tasks', task.id)} onSelect={() => toggleSelect(task.id)}>
      <Field label={t('set.fields.title')}><Input value={task.title} onChange={(e) => edit('tasks', task.id, { title: e.target.value })} /></Field>
      <Field label={t('set.fields.description')}><Textarea rows={2} value={task.description} onChange={(e) => edit('tasks', task.id, { description: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('set.fields.category')}>
          <select className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" value={task.category} onChange={(e) => edit('tasks', task.id, { category: e.target.value as ProposedTask['category'] })}>
            {PROPOSED_TASK_CATEGORIES.map((c) => <option key={c} value={c}>{t(`set.category.${c}`)}</option>)}
          </select>
        </Field>
        <Field label={t('set.fields.milestone')}>
          <select className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" value={task.milestoneId} onChange={(e) => edit('tasks', task.id, { milestoneId: e.target.value })}>
            {milestones.map((m) => <option key={m.id} value={m.id}>{m.id} · {m.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="text-xs">
        <span className="mb-1 block font-medium text-muted-foreground">{t('set.fields.requirements')}</span>
        <div className="flex flex-wrap gap-1">
          {set.requirements.map((r) => {
            const on = task.requirementIds.includes(r.id);
            return (
              <button key={r.id} type="button" onClick={() => edit('tasks', task.id, { requirementIds: on ? task.requirementIds.filter((x) => x !== r.id) : [...task.requirementIds, r.id] })}>
                <Badge variant={on ? 'default' : 'outline'} title={r.title}>{r.id}</Badge>
              </button>
            );
          })}
        </div>
      </div>
    </ItemFrame>
  );

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold">{t('set.sections.requirements')}</h3>
        <div className="space-y-2">{set.requirements.map(requirementCard)}</div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">{t('set.sections.milestones')}</h3>
        <div className="space-y-2">{milestones.map(milestoneCard)}</div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">{t('set.sections.tasks')}</h3>
        {milestones.map((m) => (
          <div key={m.id} className="mb-3">
            <div className="mb-1 text-xs font-medium text-muted-foreground">{m.id} · {m.name}</div>
            <div className="space-y-2">
              {[...set.tasks].filter((x) => x.milestoneId === m.id).sort((a, b) => a.order - b.order).map(taskCard)}
            </div>
          </div>
        ))}
        {set.tasks.filter((x) => !milestones.some((m) => m.id === x.milestoneId)).map(taskCard)}
      </section>
    </div>
  );
}
```

`RequirementsTab.tsx`:

```tsx
// apps/desktop/src/renderer/components/requirements/set/RequirementsTab.tsx
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { useRequirementsStore } from '../../../stores/requirements-store';
import { RequirementsAssist } from './RequirementsAssist';
import { RequirementsSetEditor } from './RequirementsSetEditor';

interface RequirementsTabProps {
  projectId: string;
  brdReady: boolean;
  missingSections: string[];
}

export function RequirementsTab({ projectId, brdReady, missingSections }: RequirementsTabProps) {
  const { t } = useTranslation('requirements');
  const store = useRequirementsStore();
  const { set, warnings, run, isSaving, error, generate, regenerate, cancel, save, approve } = store;
  const dirty = useRequirementsStore((s) => JSON.stringify(s.set) !== JSON.stringify(s.savedSet));
  const stale = useRequirementsStore((s) => !!s.set && s.set.brdHash !== s.currentBrdHash);
  const canApprove = !!set && set.status !== 'approved' && !dirty && warnings.length === 0;

  if (run.status === 'running') {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <div>{t('set.running')}</div>
        <div>{run.phase ? t(`set.phase.${run.phase}`) : null}</div>
        <Button size="sm" variant="outline" onClick={() => void cancel()}>{t('set.cancel')}</Button>
      </div>
    );
  }

  if (!set) {
    return (
      <div className="space-y-3 p-6 text-sm">
        <p className="text-muted-foreground">{t('set.none')}</p>
        {!brdReady && (
          <p className="text-amber-600">{t('set.notReady')} {missingSections.join(', ')}</p>
        )}
        {run.error && <p className="text-destructive">{t('set.error', { error: run.error })}</p>}
        <Button size="sm" disabled={!brdReady} onClick={() => void generate(projectId)}>{t('set.generate')}</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {stale && (
        <div className="flex items-center justify-between rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
          <span>{t('set.stale')}</span>
          <Button size="sm" variant="outline" onClick={() => void regenerate(projectId)}>{t('set.regenerate')}</Button>
        </div>
      )}
      {(error || run.error) && <p className="text-xs text-destructive">{t('set.error', { error: error ?? run.error })}</p>}

      <div className="min-h-0 flex-1 overflow-auto pr-1">
        <RequirementsSetEditor />
        <div className="mt-4"><RequirementsAssist projectId={projectId} /></div>
      </div>

      <div className="sticky bottom-0 space-y-2 border-t border-border bg-background pt-3">
        {warnings.length > 0 && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
            <div className="flex items-center gap-1 font-medium"><AlertTriangle className="h-3.5 w-3.5" />{t('set.warnings')}</div>
            <ul className="mt-1 list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{t(`set.status.${set.status}`)}</Badge>
            <span>{dirty ? t('set.unsaved') : t('set.saved')}</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={!dirty || isSaving} onClick={() => void save(projectId)}>{isSaving ? t('set.saving') : t('set.save')}</Button>
            <Button size="sm" disabled={!canApprove || isSaving} onClick={() => void approve(projectId)}>{isSaving ? t('set.approving') : t('set.approve')}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Integrate into `BrdEditor` and `RequirementsView`**

In `BrdEditor.tsx`:
- Import `Tabs, TabsList, TabsTrigger, TabsContent` from `'../ui/tabs'`, `RequirementsTab` from `'./set/RequirementsTab'`, and `useRequirementsStore` from `'../../stores/requirements-store'`.
- Add `useEffect` (import from react) that loads the set when the selected slug changes: `useEffect(() => { if (selectedSummary) void useRequirementsStore.getState().load(projectId, selectedSummary.slug); }, [projectId, selectedSummary?.slug]);` (place it before the early `return null`; guard inside).
- Compute `const missingSections = structure ? structure.sections.filter((s) => s.required && (!s.present || s.empty)).map((s) => s.heading) : [];` and `const brdReady = !!structure?.ok && !dirty;` (a dirty document must be saved before splitting).
- Wrap the existing body: keep the header block as is, then replace everything from `<StructureChecklist ...>` through `<BrdAssistPanel ... />` with:

```tsx
      <Tabs defaultValue="document" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="w-fit">
          <TabsTrigger value="document">{t('set.documentTab')}</TabsTrigger>
          <TabsTrigger value="requirements">{t('set.tab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="document" className="flex min-h-0 flex-1 flex-col gap-3 data-[state=inactive]:hidden">
          <StructureChecklist result={structure} />
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
            {/* existing textarea + preview unchanged */}
          </div>
          <BrdAssistPanel projectId={projectId} documentIsEmpty={documentIsEmpty(structure)} />
        </TabsContent>
        <TabsContent value="requirements" className="min-h-0 flex-1 data-[state=inactive]:hidden">
          <RequirementsTab projectId={projectId} brdReady={brdReady} missingSections={missingSections} />
        </TabsContent>
      </Tabs>
```

(Move the existing textarea and preview markup verbatim into the marked spot.)

In `RequirementsView.tsx`:
- Import `setupRequirementsListeners, useRequirementsStore` from `'../../stores/requirements-store'`.
- In the mount effect, also call `const stopReq = setupRequirementsListeners();` and `useRequirementsStore.getState().reset();`, and return both cleanups.
- Extend the dirty checks: define `const anyDirty = () => useBrdStore.getState().isDirty() || useRequirementsStore.getState().isDirty();` and use it in `handleSelect` (`if (!ok && anyDirty())` — and make `select` refuse when the requirements store is dirty by checking `anyDirty()` before calling `select`: `if (anyDirty()) { setPendingSlug(slug); return; }`), in `onNew`, and reset the requirements store when discarding (`useRequirementsStore.getState().reset()` inside the discard handler before selecting).

Update the existing `BrdEditor.test.tsx` mocks: add `requirementsRead: vi.fn().mockResolvedValue({ success: true, data: { set: null, currentBrdHash: 'x' } })` to its `api` object, and to `RequirementsView.test.tsx` add `requirementsRead` plus `onRequirementsProgress/Done/Error: vi.fn(() => () => undefined)`.

- [ ] **Step 5: Run tests, lint, typecheck**

Run: `cd apps/desktop && npx vitest run src/renderer/components/requirements/ src/renderer/stores/__tests__/ && npm run lint && npm run typecheck`
Expected: PASS (4 new tests plus all existing requirements tests); clean. If `getByRole('checkbox', { name })` cannot find the Radix checkbox by aria-label, the `Checkbox` primitive renders a `button role="checkbox"`; `aria-label` on it is supported, so check the label string matches `${t('set.fields.included')} ${id}` exactly.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/requirements
git commit -m "feat(requirements): add Requirements tab with set editor, assist, and approval

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Full gate and manual check

- [ ] **Step 1: Full suite, lint, typecheck**

Run: `cd apps/desktop && npm test && npm run lint && npm run typecheck`
Expected: all green.

- [ ] **Step 2: Manual check in the running app**

1. `nvm use 24 && npm run dev:mcp` from the repo root.
2. Open the fixture project, Requirements, select "Customer onboarding". Fill the five required sections in the Document tab (short sentences are enough) and Save.
3. Switch to the Requirements tab. Confirm the empty state and an enabled Generate button. Click Generate. Confirm the running state shows phases and, when done, a proposal appears; Accept it, confirm cards render and status shows Draft, Save. Confirm `docs/brd/customer-onboarding.requirements.json` exists.
4. Untick Included on the only task covering some requirement; confirm the integrity warning appears and Approve is disabled. Re-tick it.
5. Edit a requirement title, select that requirement, type feedback, click "Refine selected (1)". Confirm the proposal lists counts and a change summary; Accept, Save, Approve; confirm status Approved and `approvedAt` in the file.
6. Edit a title again and Save; confirm status returns to Draft.
7. Edit the BRD text in the Document tab and Save; return to Requirements and confirm the staleness banner appears with Regenerate.

If the machine has no account for the roadmap feature model, steps 3, 5, and 7 will show the assistant error inline; verify the error path and the rest of the flow using the store-level tests as evidence for generation.

- [ ] **Step 3: Commit fixes from the manual check**

Commit with `fix(requirements): ...` describing what the run exposed.

---

## Spec coverage checklist (self-review)

| Spec section | Task |
|---|---|
| File, schema, pure helpers (validation, ids, merge, diff, hash) | 1, 2 |
| Runner (structured output, fallback, retry, events, prompt rules) | 3 |
| Main: files, IPC table, gate, post-processing, one run per slug, preload, ElectronAPI, mock | 2, 4 |
| Renderer: tabs, three states, set editor, assist, footer, staleness, store, guard, i18n | 5, 6 |
| Error handling table | 4, 5, 6 |
| Testing list, manual | every task; 7 |
