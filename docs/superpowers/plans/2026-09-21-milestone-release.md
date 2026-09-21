# Milestone Release and Traceability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release an approved requirements set one milestone at a time into Kanban tasks that link back to their requirements, milestone, and BRD, and show that traceability in both the Requirements tab and task detail.

**Architecture:** A `releases` record on the set file tracks what was released. A single main-process IPC (`requirements:release`) checks the gate, creates tasks through a task-creation helper extracted from the existing create handler, and writes the record after each task. The renderer derives locked ids, the next releasable milestone, and per-requirement rollups from the set plus the task store; task detail reads the set once to show its origin. No AI calls anywhere.

**Tech Stack:** TypeScript strict, Zod 4, Electron IPC, Zustand 5, React 19, react-i18next, Vitest + React Testing Library (jsdom for renderer tests).

**Spec:** `docs/superpowers/specs/2026-09-21-milestone-release-design.md`

## Global Constraints

- All user-facing text goes through `react-i18next`; every new key is added to both `src/shared/i18n/locales/en/*.json` and `src/shared/i18n/locales/fr/*.json`.
- No `console.log` in production code.
- No `process.platform`; no new dependencies.
- The requirements set file stays `version: 1`; `releases` is optional so existing files load unchanged.
- Category mapping is fixed: `feature → feature`, `bug → bug_fix`, `refactor → refactoring`, `docs → documentation`.
- Milestones release strictly in order: only the lowest-`order` included milestone that is not complete can be released.
- Released items are read-only in the editor and untouchable by refinement.
- Every command below runs from `apps/desktop/` unless stated otherwise. Tests: `npx vitest run <path>`. Gate: `npm test && npm run lint && npm run typecheck`.
- Commit after every task with the message given in the task; always target `develop`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/types/requirements.ts` (modify) | `ReleasedTask`, `MilestoneRelease`, `releases?` on `RequirementsSet` |
| `src/shared/types/task.ts` (modify) | `'requirements'` source type and the four link fields on `TaskMetadata` |
| `src/shared/brd/requirements.ts` (modify) | Zod schema for `releases`; `mergeRefinement` carries `releases` over |
| `src/shared/brd/release.ts` (create) | Pure helpers: completeness, next milestone, locked ids, rollup, gate, task input builder, category map |
| `src/main/ipc-handlers/task/create-task.ts` (create) | `createTaskInProject()` and `sanitizeThinkingLevels()` extracted from the create handler |
| `src/main/ipc-handlers/task/crud-handlers.ts` (modify) | `task:create` delegates to the helper |
| `src/main/ipc-handlers/roadmap-handlers.ts` (modify) | `roadmap:convertToSpec` delegates to the helper |
| `src/shared/constants/ipc.ts` (modify) | `REQUIREMENTS_RELEASE` channel |
| `src/main/ipc-handlers/requirements-handlers.ts` (modify) | `requirements:release` handler |
| `src/preload/api/modules/requirements-api.ts` (modify) | `requirementsRelease` |
| `src/renderer/lib/browser-mock.ts` (modify) | mock entry |
| `src/renderer/stores/requirements-store.ts` (modify) | `release`, `lockedIds`, `nextMilestone`, `releaseReason`, refinement exclusions |
| `src/renderer/stores/brd-store.ts` (modify) | `pendingOpenSlug` + `requestOpen` for navigation from task detail |
| `src/renderer/components/requirements/set/RequirementsSetEditor.tsx` (modify) | milestone header with Release/Released, locked rendering, status chips, rollup |
| `src/renderer/components/requirements/RequirementsView.tsx` (modify) | opens a pending slug after load |
| `src/renderer/components/task-detail/TaskRequirements.tsx` (create) | "Requirements" section in task detail |
| `src/renderer/components/task-detail/TaskDetailModal.tsx` (modify) | renders the section; `onNavigateToRequirements` prop |
| `src/renderer/App.tsx` (modify) | wires `onNavigateToRequirements` |
| `src/shared/i18n/locales/{en,fr}/requirements.json`, `{en,fr}/tasks.json` (modify) | new keys |

---

### Task 1: Schema and types for the release record and task links

**Files:**
- Modify: `src/shared/types/requirements.ts`
- Modify: `src/shared/types/task.ts:181-196`
- Modify: `src/shared/brd/requirements.ts:56-66` and `:203-212`
- Test: `src/shared/brd/__tests__/requirements.test.ts`

**Interfaces:**
- Produces: `ReleasedTask { proposedTaskId: string; specId: string }`, `MilestoneRelease { releasedAt: string; tasks: ReleasedTask[] }`, `RequirementsSet.releases?: Record<string, MilestoneRelease>`, `TaskMetadata.sourceType` accepts `'requirements'`, `TaskMetadata.brdSlug/milestoneId/requirementIds/proposedTaskId`.

- [ ] **Step 1: Write the failing tests**

Append to `src/shared/brd/__tests__/requirements.test.ts` (inside the file, after the `mergeRefinement` describe block):

```ts
describe('releases', () => {
  const releases = { M1: { releasedAt: '2026-09-21T00:00:00.000Z', tasks: [{ proposedTaskId: 'T1', specId: '001-task-t1' }] } };

  it('RequirementsSetSchema accepts a set with releases and one without', () => {
    expect(RequirementsSetSchema.safeParse(set()).success).toBe(true);
    expect(RequirementsSetSchema.safeParse(set({ releases })).success).toBe(true);
  });

  it('RequirementsSetSchema rejects a release entry with a bad proposed task id', () => {
    const bad = { M1: { releasedAt: 't', tasks: [{ proposedTaskId: 'X1', specId: 's' }] } };
    expect(RequirementsSetSchema.safeParse(set({ releases: bad as never })).success).toBe(false);
  });

  it('mergeRefinement carries releases over from previous', () => {
    const previous = set({ releases });
    const body: GeneratedBody = {
      requirements: [{ id: 'R1', title: 'r', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: false }],
      milestones: [{ id: 'M1', name: 'm', description: 'd', order: 1 }],
      tasks: [{ id: 'T1', title: 't', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 1 }],
      changeSummary: null,
    };
    expect(mergeRefinement(previous, body).set.releases).toEqual(releases);
    expect(mergeRefinement(set(), body).set.releases).toBeUndefined();
  });
});
```

The existing `set()` helper in that test file builds a valid `RequirementsSet` and merges overrides; check its name at the top of the file (it is `const set = (over: Partial<RequirementsSet> = {}): RequirementsSet => ({ ... })`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/brd/__tests__/requirements.test.ts`
Expected: the two schema tests fail (unknown key is stripped, so "rejects" passes trivially only if the schema knows the key; the "carries releases" test fails with `undefined` not equal to the object). At least two failures.

- [ ] **Step 3: Add the types**

In `src/shared/types/requirements.ts`, before `export interface RequirementsSet`:

```ts
/** One Kanban task created from a proposed task. */
export interface ReleasedTask {
  proposedTaskId: string;   // "T3"
  specId: string;           // Kanban task id and spec directory name
}

/** Release record for one milestone; may be partial after a failure midway. */
export interface MilestoneRelease {
  releasedAt: string;       // ISO, first successful task creation
  tasks: ReleasedTask[];
}
```

In `RequirementsSet`, after `tasks: ProposedTask[];`:

```ts
  /** Keyed by milestone id. Absent until the first release. */
  releases?: Record<string, MilestoneRelease>;
```

In `src/shared/types/task.ts`, change the `sourceType` union and add the link fields right after it:

```ts
  sourceType?: 'ideation' | 'manual' | 'imported' | 'insights' | 'roadmap' | 'linear' | 'github' | 'gitlab' | 'requirements';
  // Requirements set links (sourceType 'requirements')
  brdSlug?: string;          // docs/brd/<slug>.md
  milestoneId?: string;      // "M1"
  requirementIds?: string[]; // ["R1", "R4"]
  proposedTaskId?: string;   // "T3"
```

- [ ] **Step 4: Add the schema and carry releases through refinement**

In `src/shared/brd/requirements.ts`, before `export const RequirementsSetSchema`:

```ts
const releasedTaskSchema = z.object({ proposedTaskId: idSchema, specId: z.string().min(1) });
const milestoneReleaseSchema = z.object({ releasedAt: z.string().min(1), tasks: z.array(releasedTaskSchema) });
```

Inside `RequirementsSetSchema`, after the `tasks:` line:

```ts
  releases: z.record(z.string(), milestoneReleaseSchema).optional(),
```

In `mergeRefinement`, the returned `set` object gains one line after `tasks,`:

```ts
    ...(previous.releases ? { releases: previous.releases } : {}),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/shared/brd src/main/brd src/main/ipc-handlers/__tests__/requirements-handlers.test.ts`
Expected: all pass.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

```bash
git add src/shared/types/requirements.ts src/shared/types/task.ts src/shared/brd/requirements.ts src/shared/brd/__tests__/requirements.test.ts
git commit -m "feat(release): add release record to the requirements set and task link metadata"
```

---

### Task 2: Pure release helpers

**Files:**
- Create: `src/shared/brd/release.ts`
- Test: `src/shared/brd/__tests__/release.test.ts`

**Interfaces:**
- Consumes: `RequirementsSet`, `Milestone`, `ProposedTask`, `MilestoneRelease` from Task 1; `TaskCategory`, `TaskMetadata`, `TaskStatus` from `src/shared/types/task.ts`.
- Produces:
  - `type ReleaseGateReason = 'noSet' | 'notApproved' | 'dirty' | 'stale' | 'notNext' | 'complete'`
  - `RELEASE_CATEGORY: Record<ProposedTask['category'], TaskCategory>`
  - `includedTasksOf(set, milestoneId): ProposedTask[]` (included, sorted by order)
  - `releasedTaskSpecIds(set): Map<string, string>` (proposedTaskId → specId)
  - `isMilestoneComplete(set, milestoneId): boolean`
  - `nextReleasableMilestone(set): Milestone | null`
  - `lockedIds(set): Set<string>`
  - `requirementRollup(set, statuses: Map<string, TaskStatus>): Record<string, { released: number; done: number }>`
  - `releaseGate(set: RequirementsSet | null, savedSet: RequirementsSet | null, currentBrdHash: string, milestoneId: string): ReleaseGateReason | null`
  - `buildReleaseTaskInput(set, task, brdTitle): { title: string; description: string; metadata: TaskMetadata }`

- [ ] **Step 1: Write the failing tests**

Create `src/shared/brd/__tests__/release.test.ts`:

```ts
// apps/desktop/src/shared/brd/__tests__/release.test.ts
import { describe, it, expect } from 'vitest';
import type { RequirementsSet } from '../../types/requirements';
import type { TaskStatus } from '../../types/task';
import {
  buildReleaseTaskInput, includedTasksOf, isMilestoneComplete, lockedIds, nextReleasableMilestone,
  releaseGate, releasedTaskSpecIds, requirementRollup, RELEASE_CATEGORY,
} from '../release';

const base = (over: Partial<RequirementsSet> = {}): RequirementsSet => ({
  version: 1, brdSlug: 'todo-app', brdHash: 'H', status: 'approved', generatedAt: 't', approvedAt: 't',
  requirements: [
    { id: 'R1', title: 'Add todos', description: 'Users add todos.', acceptanceCriteria: ['Form validates', 'Item appears'], area: 'Core', needsDesign: false, included: true },
    { id: 'R2', title: 'Persist', description: 'Persist locally.', acceptanceCriteria: ['Survives reload'], area: 'Storage', needsDesign: false, included: true },
    { id: 'R3', title: 'Excluded', description: 'x', acceptanceCriteria: ['y'], area: 'Core', needsDesign: false, included: false },
  ],
  milestones: [
    { id: 'M1', name: 'Core', description: 'Core UI', order: 1, included: true },
    { id: 'M2', name: 'Storage', description: 'Persistence', order: 2, included: true },
    { id: 'M3', name: 'Skipped', description: 'excluded', order: 3, included: false },
  ],
  tasks: [
    { id: 'T1', title: 'Build form', description: 'Form and list.', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 2, included: true },
    { id: 'T2', title: 'Refactor state', description: 'State.', milestoneId: 'M1', requirementIds: ['R1'], category: 'refactor', order: 1, included: true },
    { id: 'T3', title: 'Excluded task', description: 'x', milestoneId: 'M1', requirementIds: ['R1'], category: 'bug', order: 3, included: false },
    { id: 'T4', title: 'Save to storage', description: 'Persist.', milestoneId: 'M2', requirementIds: ['R2'], category: 'feature', order: 1, included: true },
  ],
  ...over,
});
const fullM1 = { M1: { releasedAt: 't', tasks: [{ proposedTaskId: 'T2', specId: '001-refactor-state' }, { proposedTaskId: 'T1', specId: '002-build-form' }] } };
const partialM1 = { M1: { releasedAt: 't', tasks: [{ proposedTaskId: 'T2', specId: '001-refactor-state' }] } };

describe('includedTasksOf / releasedTaskSpecIds', () => {
  it('returns included tasks of a milestone sorted by order', () => {
    expect(includedTasksOf(base(), 'M1').map((t) => t.id)).toEqual(['T2', 'T1']);
  });
  it('maps released proposed tasks to spec ids across milestones', () => {
    const m = releasedTaskSpecIds(base({ releases: { ...fullM1, M2: { releasedAt: 't', tasks: [{ proposedTaskId: 'T4', specId: '003-save' }] } } }));
    expect([...m.entries()]).toEqual([['T2', '001-refactor-state'], ['T1', '002-build-form'], ['T4', '003-save']]);
  });
});

describe('isMilestoneComplete / nextReleasableMilestone', () => {
  it('is complete only when every included task has a spec id', () => {
    expect(isMilestoneComplete(base(), 'M1')).toBe(false);
    expect(isMilestoneComplete(base({ releases: partialM1 }), 'M1')).toBe(false);
    expect(isMilestoneComplete(base({ releases: fullM1 }), 'M1')).toBe(true);
  });
  it('next is the lowest-order included incomplete milestone, skipping excluded ones', () => {
    expect(nextReleasableMilestone(base())?.id).toBe('M1');
    expect(nextReleasableMilestone(base({ releases: partialM1 }))?.id).toBe('M1');
    expect(nextReleasableMilestone(base({ releases: fullM1 }))?.id).toBe('M2');
    const all = { ...fullM1, M2: { releasedAt: 't', tasks: [{ proposedTaskId: 'T4', specId: '003-save' }] } };
    expect(nextReleasableMilestone(base({ releases: all }))).toBeNull();
  });
});

describe('lockedIds', () => {
  it('locks released tasks, milestones with an entry, and fully covered requirements', () => {
    expect([...lockedIds(base())]).toEqual([]);
    const partial = lockedIds(base({ releases: partialM1 }));
    expect(partial.has('T2')).toBe(true);
    expect(partial.has('M1')).toBe(true);
    expect(partial.has('T1')).toBe(false);
    expect(partial.has('R1')).toBe(false); // T1 still covers R1 and is not released
    const full = lockedIds(base({ releases: fullM1 }));
    expect(full.has('R1')).toBe(true);
    expect(full.has('R2')).toBe(false);
    expect(full.has('T3')).toBe(false); // excluded tasks never lock
  });
});

describe('requirementRollup', () => {
  it('counts released covering tasks and how many are done', () => {
    const statuses = new Map<string, TaskStatus>([['001-refactor-state', 'done'], ['002-build-form', 'in_progress']]);
    expect(requirementRollup(base({ releases: fullM1 }), statuses)).toEqual({ R1: { released: 2, done: 1 } });
    expect(requirementRollup(base(), statuses)).toEqual({});
  });
  it('counts a released task with no local status as released but not done', () => {
    expect(requirementRollup(base({ releases: partialM1 }), new Map())).toEqual({ R1: { released: 1, done: 0 } });
  });
});

describe('releaseGate', () => {
  const ok = base();
  it('returns null when everything holds', () => {
    expect(releaseGate(ok, ok, 'H', 'M1')).toBeNull();
  });
  it('reports each failing reason in priority order', () => {
    expect(releaseGate(null, null, 'H', 'M1')).toBe('noSet');
    expect(releaseGate(base({ status: 'draft' }), base({ status: 'draft' }), 'H', 'M1')).toBe('notApproved');
    expect(releaseGate({ ...ok, tasks: [...ok.tasks] }, base({ requirements: [] }), 'H', 'M1')).toBe('dirty');
    expect(releaseGate(ok, ok, 'OTHER', 'M1')).toBe('stale');
    expect(releaseGate(ok, ok, 'H', 'M2')).toBe('notNext');
    const done = base({ releases: fullM1 });
    expect(releaseGate(done, done, 'H', 'M1')).toBe('complete');
    expect(releaseGate(done, done, 'H', 'M2')).toBeNull();
  });
});

describe('buildReleaseTaskInput', () => {
  it('assembles title, description, and link metadata', () => {
    const set = base();
    const input = buildReleaseTaskInput(set, set.tasks[0], 'Todo app');
    expect(input.title).toBe('Build form');
    expect(input.description).toContain('Form and list.');
    expect(input.description).toContain('## Requirements covered');
    expect(input.description).toContain('### R1: Add todos');
    expect(input.description).toContain('- [ ] Form validates');
    expect(input.description).toContain('Source: BRD "Todo app" (docs/brd/todo-app.md), milestone Core, requirements set docs/brd/todo-app.requirements.json');
    expect(input.metadata).toEqual({
      sourceType: 'requirements', brdSlug: 'todo-app', milestoneId: 'M1', requirementIds: ['R1'], proposedTaskId: 'T1',
      category: 'feature', acceptanceCriteria: ['Form validates', 'Item appears'],
    });
  });
  it('maps every proposed category', () => {
    expect(RELEASE_CATEGORY).toEqual({ feature: 'feature', bug: 'bug_fix', refactor: 'refactoring', docs: 'documentation' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/brd/__tests__/release.test.ts`
Expected: FAIL, "Cannot find module '../release'".

- [ ] **Step 3: Write the helpers**

Create `src/shared/brd/release.ts`:

```ts
// apps/desktop/src/shared/brd/release.ts
import type { Milestone, ProposedTask, RequirementsSet } from '../types/requirements';
import type { TaskCategory, TaskMetadata, TaskStatus } from '../types/task';

export type ReleaseGateReason = 'noSet' | 'notApproved' | 'dirty' | 'stale' | 'notNext' | 'complete';

/** Proposed task category → Kanban task category. */
export const RELEASE_CATEGORY: Record<ProposedTask['category'], TaskCategory> = {
  feature: 'feature',
  bug: 'bug_fix',
  refactor: 'refactoring',
  docs: 'documentation',
};

/** Included tasks of one milestone, in release order. */
export function includedTasksOf(set: RequirementsSet, milestoneId: string): ProposedTask[] {
  return set.tasks.filter((t) => t.included && t.milestoneId === milestoneId).sort((a, b) => a.order - b.order);
}

/** proposedTaskId → specId for every released task, across milestones. */
export function releasedTaskSpecIds(set: RequirementsSet): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of Object.values(set.releases ?? {})) {
    for (const t of entry.tasks) out.set(t.proposedTaskId, t.specId);
  }
  return out;
}

/** True when every included task of the milestone has a spec id. */
export function isMilestoneComplete(set: RequirementsSet, milestoneId: string): boolean {
  const entry = set.releases?.[milestoneId];
  if (!entry) return false;
  const released = new Set(entry.tasks.map((t) => t.proposedTaskId));
  return includedTasksOf(set, milestoneId).every((t) => released.has(t.id));
}

/** The lowest-order included milestone that is not complete, or null when everything is released. */
export function nextReleasableMilestone(set: RequirementsSet): Milestone | null {
  const candidates = set.milestones
    .filter((m) => m.included && !isMilestoneComplete(set, m.id))
    .sort((a, b) => a.order - b.order);
  return candidates[0] ?? null;
}

/** Ids that must not change anymore: released tasks, milestones with an entry, and requirements whose every included covering task is released. */
export function lockedIds(set: RequirementsSet): Set<string> {
  const specs = releasedTaskSpecIds(set);
  const locked = new Set<string>(specs.keys());
  for (const m of set.milestones) if (set.releases?.[m.id]) locked.add(m.id);
  for (const r of set.requirements) {
    if (!r.included) continue;
    const covering = set.tasks.filter((t) => t.included && t.requirementIds.includes(r.id));
    if (covering.length > 0 && covering.every((t) => specs.has(t.id))) locked.add(r.id);
  }
  return locked;
}

/** Per requirement: how many covering tasks were released and how many of those are done on this machine. */
export function requirementRollup(
  set: RequirementsSet,
  statuses: Map<string, TaskStatus>,
): Record<string, { released: number; done: number }> {
  const specs = releasedTaskSpecIds(set);
  const out: Record<string, { released: number; done: number }> = {};
  for (const r of set.requirements) {
    let released = 0;
    let done = 0;
    for (const t of set.tasks) {
      if (!t.included || !t.requirementIds.includes(r.id)) continue;
      const specId = specs.get(t.id);
      if (!specId) continue;
      released++;
      if (statuses.get(specId) === 'done') done++;
    }
    if (released > 0) out[r.id] = { released, done };
  }
  return out;
}

/** First failing release precondition, or null when the milestone can be released. */
export function releaseGate(
  set: RequirementsSet | null,
  savedSet: RequirementsSet | null,
  currentBrdHash: string,
  milestoneId: string,
): ReleaseGateReason | null {
  if (!set) return 'noSet';
  if (set.status !== 'approved') return 'notApproved';
  if (JSON.stringify(set) !== JSON.stringify(savedSet)) return 'dirty';
  if (set.brdHash !== currentBrdHash) return 'stale';
  if (isMilestoneComplete(set, milestoneId)) return 'complete';
  const next = nextReleasableMilestone(set);
  if (!next || next.id !== milestoneId) return 'notNext';
  return null;
}

/** Deterministic Kanban task content for one proposed task. */
export function buildReleaseTaskInput(
  set: RequirementsSet,
  task: ProposedTask,
  brdTitle: string,
): { title: string; description: string; metadata: TaskMetadata } {
  const requirements = set.requirements.filter((r) => task.requirementIds.includes(r.id));
  const milestone = set.milestones.find((m) => m.id === task.milestoneId);
  const lines: string[] = [task.description.trim(), '', '## Requirements covered', ''];
  for (const r of requirements) {
    lines.push(`### ${r.id}: ${r.title}`, r.description.trim(), '', 'Acceptance criteria:');
    for (const c of r.acceptanceCriteria) lines.push(`- [ ] ${c}`);
    lines.push('');
  }
  lines.push(
    `Source: BRD "${brdTitle}" (docs/brd/${set.brdSlug}.md), milestone ${milestone?.name ?? task.milestoneId}, requirements set docs/brd/${set.brdSlug}.requirements.json`,
  );
  return {
    title: task.title,
    description: lines.join('\n'),
    metadata: {
      sourceType: 'requirements',
      brdSlug: set.brdSlug,
      milestoneId: task.milestoneId,
      requirementIds: [...task.requirementIds],
      proposedTaskId: task.id,
      category: RELEASE_CATEGORY[task.category],
      acceptanceCriteria: requirements.flatMap((r) => r.acceptanceCriteria),
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/brd/__tests__/release.test.ts`
Expected: all pass.

- [ ] **Step 5: Lint, typecheck, commit**

Run: `npx biome check src/shared/brd/release.ts src/shared/brd/__tests__/release.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

```bash
git add src/shared/brd/release.ts src/shared/brd/__tests__/release.test.ts
git commit -m "feat(release): add pure helpers for gate, locking, rollup, and task input"
```

---

### Task 3: Extract the task creation helper and use it from both existing handlers

**Files:**
- Create: `src/main/ipc-handlers/task/create-task.ts`
- Modify: `src/main/ipc-handlers/task/crud-handlers.ts` (`task:create` handler, lines 150-335; `sanitizeThinkingLevels` at lines 20-42)
- Modify: `src/main/ipc-handlers/roadmap-handlers.ts` (`ROADMAP_CONVERT_TO_SPEC` handler, lines 467-620)
- Test: `src/main/ipc-handlers/task/__tests__/create-task.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface CreateTaskInput { title: string; description: string; metadata?: TaskMetadata; specMarkdown?: string }
  function createTaskInProject(project: { id: string; path: string; autoBuildPath: string }, input: CreateTaskInput): Task
  function sanitizeThinkingLevels(metadata: TaskMetadata): void   // moved, same behavior
  ```
  The returned `Task` has `id === specId`, `status: 'backlog'`, `specsPath` set, and `metadata` with `sourceType` defaulting to `'manual'`.

- [ ] **Step 1: Write the failing test**

Create `src/main/ipc-handlers/task/__tests__/create-task.test.ts`:

```ts
// apps/desktop/src/main/ipc-handlers/task/__tests__/create-task.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { invalidate } = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock('../../../project-store', () => ({ projectStore: { invalidateTasksCache: invalidate } }));

import { createTaskInProject } from '../create-task';

let dir: string;
beforeEach(() => {
  vi.clearAllMocks();
  dir = mkdtempSync(path.join(tmpdir(), 'create-task-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const project = () => ({ id: 'p1', path: dir, autoBuildPath: '.auto-claude' });

describe('createTaskInProject', () => {
  it('creates the spec directory with plan, metadata, and requirements files and returns a backlog task', () => {
    const task = createTaskInProject(project(), { title: 'Build Signup Flow!', description: 'Do it.', metadata: { category: 'feature' } });
    expect(task.specId).toBe('001-build-signup-flow');
    expect(task.id).toBe(task.specId);
    expect(task.status).toBe('backlog');
    expect(task.projectId).toBe('p1');
    expect(task.metadata).toEqual({ sourceType: 'manual', category: 'feature' });
    const specDir = path.join(dir, '.auto-claude', 'specs', '001-build-signup-flow');
    expect(task.specsPath).toBe(specDir);
    const plan = JSON.parse(readFileSync(path.join(specDir, 'implementation_plan.json'), 'utf-8'));
    expect(plan).toMatchObject({ feature: 'Build Signup Flow!', description: 'Do it.', status: 'pending', phases: [] });
    expect(JSON.parse(readFileSync(path.join(specDir, 'task_metadata.json'), 'utf-8'))).toEqual({ sourceType: 'manual', category: 'feature' });
    expect(JSON.parse(readFileSync(path.join(specDir, 'requirements.json'), 'utf-8'))).toEqual({ task_description: 'Do it.', workflow_type: 'feature' });
    expect(existsSync(path.join(specDir, 'spec.md'))).toBe(false);
    expect(invalidate).toHaveBeenCalledWith('p1');
  });

  it('numbers after the highest existing spec and keeps an explicit source type', () => {
    mkdirSync(path.join(dir, '.auto-claude', 'specs', '007-old'), { recursive: true });
    const task = createTaskInProject(project(), { title: 'Next', description: 'd', metadata: { sourceType: 'requirements', brdSlug: 'a' } });
    expect(task.specId).toBe('008-next');
    expect(task.metadata?.sourceType).toBe('requirements');
  });

  it('writes spec.md when specMarkdown is given and sanitizes thinking levels', () => {
    const task = createTaskInProject(project(), {
      title: 'Roadmap item', description: 'd', specMarkdown: '# Spec',
      metadata: { sourceType: 'roadmap', thinkingLevel: 'ultrathink' as never },
    });
    const specDir = path.join(dir, '.auto-claude', 'specs', task.specId);
    expect(readFileSync(path.join(specDir, 'spec.md'), 'utf-8')).toBe('# Spec');
    expect(task.metadata?.thinkingLevel).toBe('high');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ipc-handlers/task/__tests__/create-task.test.ts`
Expected: FAIL, "Cannot find module '../create-task'".

- [ ] **Step 3: Write the helper**

Create `src/main/ipc-handlers/task/create-task.ts`. This is the body of today's `task:create` handler (minus title generation, which stays in the handler) with `specMarkdown` added for the roadmap path:

```ts
// apps/desktop/src/main/ipc-handlers/task/create-task.ts
import path from 'path';
import { existsSync, mkdirSync, readdirSync, writeFileSync, type Dirent } from 'fs';

import { AUTO_BUILD_PATHS, getSpecsDir, VALID_THINKING_LEVELS, sanitizeThinkingLevel } from '../../../shared/constants';
import type { Task, TaskMetadata } from '../../../shared/types';
import { projectStore } from '../../project-store';

const ALLOWED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml'];

/**
 * Sanitize thinking levels in task metadata in-place.
 * Maps legacy values (e.g. 'ultrathink' → 'high') and defaults unknown values to 'medium'.
 */
export function sanitizeThinkingLevels(metadata: TaskMetadata): void {
  const isValid = (val: string): boolean => VALID_THINKING_LEVELS.includes(val as (typeof VALID_THINKING_LEVELS)[number]);

  if (metadata.thinkingLevel && !isValid(metadata.thinkingLevel)) {
    const mapped = sanitizeThinkingLevel(metadata.thinkingLevel);
    console.warn(`[TASK_CRUD] Sanitized invalid thinkingLevel "${metadata.thinkingLevel}" to "${mapped}"`);
    metadata.thinkingLevel = mapped as TaskMetadata['thinkingLevel'];
  }

  if (metadata.phaseThinking) {
    for (const phase of Object.keys(metadata.phaseThinking) as Array<keyof typeof metadata.phaseThinking>) {
      if (!isValid(metadata.phaseThinking[phase])) {
        const mapped = sanitizeThinkingLevel(metadata.phaseThinking[phase]);
        console.warn(`[TASK_CRUD] Sanitized invalid phaseThinking.${phase} "${metadata.phaseThinking[phase]}" to "${mapped}"`);
        metadata.phaseThinking[phase] = mapped as (typeof metadata.phaseThinking)[typeof phase];
      }
    }
  }
}

export interface CreateTaskInput {
  title: string;
  description: string;
  metadata?: TaskMetadata;
  /** When set, also written as spec.md (roadmap conversions do this). */
  specMarkdown?: string;
}

/** Next spec number in the project: highest existing numeric prefix + 1, or 1. */
function nextSpecNumber(specsDir: string): number {
  if (!existsSync(specsDir)) return 1;
  const numbers = readdirSync(specsDir, { withFileTypes: true })
    .filter((d: Dirent) => d.isDirectory())
    .map((d: Dirent) => {
      const match = d.name.match(/^(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter((n) => n > 0);
  return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 50);
}

/** Save base64 attachments under <specDir>/attachments and rewrite metadata to relative paths. */
function saveAttachedImages(specDir: string, metadata: TaskMetadata): void {
  if (!metadata.attachedImages || metadata.attachedImages.length === 0) return;
  const attachmentsDir = path.join(specDir, 'attachments');
  mkdirSync(attachmentsDir, { recursive: true });
  const resolvedAttachmentsDir = path.resolve(attachmentsDir);
  const saved: NonNullable<TaskMetadata['attachedImages']> = [];
  for (const image of metadata.attachedImages) {
    if (!image.data) continue;
    if (!image.mimeType || !ALLOWED_IMAGE_MIME_TYPES.includes(image.mimeType)) {
      console.warn(`[TASK_CREATE] Skipping image with missing or disallowed MIME type: ${image.mimeType}`);
      continue;
    }
    const sanitizedFilename = path.basename(image.filename);
    if (!sanitizedFilename || sanitizedFilename === '.' || sanitizedFilename === '..') {
      console.warn(`[TASK_CREATE] Skipping image with invalid filename: ${image.filename}`);
      continue;
    }
    const imagePath = path.join(attachmentsDir, sanitizedFilename);
    if (!path.resolve(imagePath).startsWith(resolvedAttachmentsDir + path.sep)) {
      console.warn(`[TASK_CREATE] Skipping image with path traversal attempt: ${image.filename}`);
      continue;
    }
    try {
      writeFileSync(imagePath, Buffer.from(image.data, 'base64'));
      saved.push({ id: image.id, filename: sanitizedFilename, mimeType: image.mimeType, size: image.size, path: `attachments/${sanitizedFilename}` });
    } catch (err) {
      console.error(`Failed to save image ${sanitizedFilename}:`, err);
    }
  }
  metadata.attachedImages = saved;
}

/**
 * Create a Kanban task on disk: spec directory, implementation_plan.json, task_metadata.json,
 * requirements.json, optional spec.md and attachments. Returns the task in `backlog`.
 * Throws on filesystem errors; callers turn that into an IPC error.
 */
export function createTaskInProject(
  project: { id: string; path: string; autoBuildPath: string },
  input: CreateTaskInput,
): Task {
  const specsDir = path.join(project.path, getSpecsDir(project.autoBuildPath));
  const specId = `${String(nextSpecNumber(specsDir)).padStart(3, '0')}-${slugify(input.title)}`;
  const specDir = path.join(specsDir, specId);
  mkdirSync(specDir, { recursive: true });

  const metadata: TaskMetadata = { sourceType: 'manual', ...input.metadata };
  saveAttachedImages(specDir, metadata);
  sanitizeThinkingLevels(metadata);

  const now = new Date().toISOString();
  writeFileSync(
    path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN),
    JSON.stringify({ feature: input.title, description: input.description, created_at: now, updated_at: now, status: 'pending', phases: [] }, null, 2),
    'utf-8',
  );
  writeFileSync(path.join(specDir, 'task_metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');

  const requirements: Record<string, unknown> = { task_description: input.description, workflow_type: metadata.category || 'feature' };
  if (metadata.attachedImages && metadata.attachedImages.length > 0) {
    requirements.attached_images = metadata.attachedImages.map((img) => ({ filename: img.filename, path: img.path, description: '' }));
  }
  writeFileSync(path.join(specDir, AUTO_BUILD_PATHS.REQUIREMENTS), JSON.stringify(requirements, null, 2), 'utf-8');
  if (input.specMarkdown !== undefined) {
    writeFileSync(path.join(specDir, AUTO_BUILD_PATHS.SPEC_FILE), input.specMarkdown, 'utf-8');
  }

  projectStore.invalidateTasksCache(project.id);

  return {
    id: specId,
    specId,
    projectId: project.id,
    title: input.title,
    description: input.description,
    status: 'backlog',
    subtasks: [],
    logs: [],
    metadata,
    specsPath: specDir,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
```

- [ ] **Step 4: Run the helper test**

Run: `npx vitest run src/main/ipc-handlers/task/__tests__/create-task.test.ts`
Expected: all pass. If `VALID_THINKING_LEVELS` or `sanitizeThinkingLevel` fail to import, copy the import line exactly from the top of `crud-handlers.ts`.

- [ ] **Step 5: Switch the create handler to the helper**

In `src/main/ipc-handlers/task/crud-handlers.ts`:

1. Delete the local `sanitizeThinkingLevels` function (lines 20-42) and add `import { createTaskInProject, sanitizeThinkingLevels } from './create-task';`. Remove now-unused imports (`nativeImage` stays only if used elsewhere in the file; check with the linter).
2. Replace everything in the `task:create` handler after the title block with a single call. The handler becomes:

```ts
  ipcMain.handle(
    IPC_CHANNELS.TASK_CREATE,
    async (_, projectId: string, title: string, description: string, metadata?: TaskMetadata): Promise<IPCResult<Task>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      // Auto-generate title if empty using Claude AI
      let finalTitle = title;
      if (!title || !title.trim()) {
        console.warn('[TASK_CREATE] Title is empty, generating with Claude AI...');
        finalTitle = await generateTitleWithFallback(description, 'TASK_CREATE');
      }

      try {
        const task = createTaskInProject(project, { title: finalTitle, description, metadata });
        console.warn(`[TASK_CREATE] [Fast Mode] ${task.metadata?.fastMode ? 'ENABLED' : 'disabled'} — written to task_metadata.json for spec ${task.specId}`);
        return { success: true, data: task };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );
```

- [ ] **Step 6: Switch the roadmap converter to the helper**

In `src/main/ipc-handlers/roadmap-handlers.ts`, inside `ROADMAP_CONVERT_TO_SPEC`, keep the roadmap read, the `withFileLock`, the feature lookup, and the `taskDescription` template. Replace the block from "Generate proper spec directory" through the `const task: Task = { ... }` object with:

```ts
        const task = createTaskInProject(project, {
          title: feature.title,
          description: taskDescription,
          specMarkdown: taskDescription,
          metadata: { sourceType: 'roadmap', featureId: feature.id, category: 'feature' },
        });
        const specId = task.specId;

        // Update feature with linked spec
        feature.status = 'planned';
        feature.linked_spec_id = specId;
        roadmap.metadata = roadmap.metadata || {};
        roadmap.metadata.updated_at = new Date().toISOString();
        await writeFileWithRetry(roadmapPath, JSON.stringify(roadmap, null, 2), { encoding: 'utf-8' });

        return { success: true, data: task };
```

Add `import { createTaskInProject } from './task/create-task';` and remove imports the file no longer uses (`mkdirSync`, `readdirSync`, `existsSync` if nothing else uses them; `AUTO_BUILD_PATHS` stays for `ROADMAP_DIR`).

- [ ] **Step 7: Run the affected tests, lint, typecheck**

Run: `npx vitest run src/main/ipc-handlers && npx biome check src/main/ipc-handlers/task/create-task.ts src/main/ipc-handlers/task/crud-handlers.ts src/main/ipc-handlers/roadmap-handlers.ts && npx tsc --noEmit -p tsconfig.json`
Expected: all pass, no lint errors (warnings that existed before are fine), no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/main/ipc-handlers/task/create-task.ts src/main/ipc-handlers/task/__tests__/create-task.test.ts src/main/ipc-handlers/task/crud-handlers.ts src/main/ipc-handlers/roadmap-handlers.ts
git commit -m "refactor(tasks): extract createTaskInProject and use it from task create and roadmap convert"
```

---

### Task 4: Release IPC handler, channel, preload, and mock

**Files:**
- Modify: `src/shared/constants/ipc.ts:37` (after `REQUIREMENTS_ERROR`)
- Modify: `src/main/ipc-handlers/requirements-handlers.ts`
- Modify: `src/preload/api/modules/requirements-api.ts`
- Modify: `src/renderer/lib/browser-mock.ts:245` (after `requirementsCancel`)
- Test: `src/main/ipc-handlers/__tests__/requirements-handlers.test.ts`

**Interfaces:**
- Consumes: `createTaskInProject` (Task 3), `releaseGate`, `includedTasksOf`, `buildReleaseTaskInput` (Task 2), `readBrd` (returns `{ summary: { title, ... }, content }`), `readRequirements`, `writeRequirements`, `brdHash`.
- Produces: channel `REQUIREMENTS_RELEASE: 'requirements:release'`; handler `(projectId, slug, milestoneId) => IPCResult<{ set: RequirementsSet; tasks: Task[] }>`; preload `requirementsRelease(projectId, slug, milestoneId)`.

- [ ] **Step 1: Write the failing handler tests**

In `src/main/ipc-handlers/__tests__/requirements-handlers.test.ts`, extend the hoisted mocks and add a mock for the helper. Change the `vi.hoisted` block to also return `createTask: vi.fn()`, then add after the other `vi.mock` lines:

```ts
vi.mock('../task/create-task', () => ({ createTaskInProject: createTask }));
```

(and destructure `createTask` from the hoisted result). Append these tests inside the `describe('requirements handlers', ...)` block:

```ts
  const approved: RequirementsSet = { ...set, status: 'approved', approvedAt: 't' };
  const madeTask = (specId: string) => ({ id: specId, specId, projectId: 'p1', title: 't', description: 'd', status: 'backlog', subtasks: [], logs: [], metadata: {}, createdAt: new Date(), updatedAt: new Date() });

  it('release refuses when the gate fails and creates nothing', async () => {
    files.readRequirements.mockResolvedValue(set); // draft
    const r = await handlers.get('requirements:release')!({}, 'p1', 'a', 'M1');
    expect(r).toEqual({ success: false, error: 'Approve the requirements set before releasing a milestone' });
    expect(createTask).not.toHaveBeenCalled();
  });

  it('release creates one task per included proposed task, records each, and returns them', async () => {
    files.readRequirements.mockResolvedValue(approved);
    files.writeRequirements.mockImplementation(async (_p: string, _s: string, s: RequirementsSet) => s);
    createTask.mockReturnValueOnce(madeTask('001-t'));
    const r = (await handlers.get('requirements:release')!({}, 'p1', 'a', 'M1')) as { success: boolean; data: { set: RequirementsSet; tasks: unknown[] } };
    expect(r.success).toBe(true);
    expect(createTask).toHaveBeenCalledTimes(1);
    const [, input] = createTask.mock.calls[0];
    expect(input.title).toBe('t');
    expect(input.metadata).toMatchObject({ sourceType: 'requirements', brdSlug: 'a', milestoneId: 'M1', requirementIds: ['R1'], proposedTaskId: 'T1' });
    expect(r.data.tasks).toHaveLength(1);
    expect(r.data.set.releases?.M1.tasks).toEqual([{ proposedTaskId: 'T1', specId: '001-t' }]);
    expect(r.data.set.releases?.M1.releasedAt).toBeTruthy();
    expect(files.writeRequirements).toHaveBeenCalledTimes(1);
  });

  it('release stops at the first creation failure, keeps the partial record, and skips done tasks on retry', async () => {
    const two: RequirementsSet = {
      ...approved,
      tasks: [
        approved.tasks[0],
        { id: 'T2', title: 'u', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 2, included: true },
      ],
    };
    files.readRequirements.mockResolvedValue(two);
    files.writeRequirements.mockImplementation(async (_p: string, _s: string, s: RequirementsSet) => s);
    createTask.mockReturnValueOnce(madeTask('001-t')).mockImplementationOnce(() => { throw new Error('disk full'); });
    const r = (await handlers.get('requirements:release')!({}, 'p1', 'a', 'M1')) as { success: boolean; error: string };
    expect(r.success).toBe(false);
    expect(r.error).toBe('Could not create a task for T2 (u): disk full');
    const written = files.writeRequirements.mock.calls.at(-1)?.[2] as RequirementsSet;
    expect(written.releases?.M1.tasks).toEqual([{ proposedTaskId: 'T1', specId: '001-t' }]);

    // Retry: T1 already has a spec id and is skipped
    files.readRequirements.mockResolvedValue(written);
    createTask.mockReset();
    createTask.mockReturnValueOnce(madeTask('002-u'));
    const again = (await handlers.get('requirements:release')!({}, 'p1', 'a', 'M1')) as { success: boolean; data: { set: RequirementsSet } };
    expect(again.success).toBe(true);
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(again.data.set.releases?.M1.tasks.map((t) => t.proposedTaskId)).toEqual(['T1', 'T2']);
  });

  it('release refuses while a generation run is active for the slug', async () => {
    files.readRequirements.mockResolvedValue(null);
    const g = await handlers.get('requirements:generate')!({}, 'p1', { slug: 'a', mode: 'generate' });
    expect(g).toMatchObject({ success: true });
    const r = await handlers.get('requirements:release')!({}, 'p1', 'a', 'M1');
    expect(r).toEqual({ success: false, error: 'A run is already in progress for this BRD' });
    await tick();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/ipc-handlers/__tests__/requirements-handlers.test.ts`
Expected: the four new tests fail ("handlers.get(...) is not a function" or equivalent).

- [ ] **Step 3: Add the channel**

In `src/shared/constants/ipc.ts`, after `REQUIREMENTS_ERROR: 'requirements:error',`:

```ts
  REQUIREMENTS_RELEASE: 'requirements:release',
```

- [ ] **Step 4: Write the handler**

In `src/main/ipc-handlers/requirements-handlers.ts`, add imports:

```ts
import type { Task } from '../../shared/types';
import { buildReleaseTaskInput, includedTasksOf, releaseGate, type ReleaseGateReason } from '../../shared/brd/release';
import { createTaskInProject } from './task/create-task';
```

Add above `registerRequirementsHandlers`:

```ts
const RELEASE_GATE_MESSAGES: Record<ReleaseGateReason, string> = {
  noSet: 'Generate and approve a requirements set before releasing a milestone',
  notApproved: 'Approve the requirements set before releasing a milestone',
  dirty: 'Save the requirements set before releasing a milestone',
  stale: 'The BRD changed since this set was generated; regenerate and approve it first',
  notNext: 'Release earlier milestones first',
  complete: 'This milestone is already released',
};
```

Register the handler inside `registerRequirementsHandlers`, after the cancel handler:

```ts
  ipcMain.handle(
    IPC_CHANNELS.REQUIREMENTS_RELEASE,
    async (_e, projectId: string, slug: string, milestoneId: string): Promise<IPCResult<{ set: RequirementsSet; tasks: Task[] }>> => {
      const project = projectStore.getProject(projectId);
      if (!project) return { success: false, error: `Project not found: ${projectId}` };
      const key = `${projectId}:${slug}`;
      if (activeRuns.has(key)) return { success: false, error: 'A run is already in progress for this BRD' };
      activeRuns.set(key, { runId: randomUUID(), slug, controller: new AbortController() });
      try {
        const [stored, brd] = await Promise.all([readRequirements(project.path, slug), readBrd(project.path, slug)]);
        const reason = releaseGate(stored, stored, brdHash(brd.content), milestoneId);
        if (reason || !stored) return { success: false, error: RELEASE_GATE_MESSAGES[reason ?? 'noSet'] };

        let current: RequirementsSet = stored;
        const created: Task[] = [];
        const alreadyDone = new Set((current.releases?.[milestoneId]?.tasks ?? []).map((t) => t.proposedTaskId));
        for (const proposed of includedTasksOf(current, milestoneId)) {
          if (alreadyDone.has(proposed.id)) continue;
          let task: Task;
          try {
            task = createTaskInProject(project, buildReleaseTaskInput(current, proposed, brd.summary.title));
          } catch (err) {
            return { success: false, error: `Could not create a task for ${proposed.id} (${proposed.title}): ${err instanceof Error ? err.message : String(err)}` };
          }
          created.push(task);
          const entry = current.releases?.[milestoneId] ?? { releasedAt: new Date().toISOString(), tasks: [] };
          current = {
            ...current,
            releases: { ...(current.releases ?? {}), [milestoneId]: { ...entry, tasks: [...entry.tasks, { proposedTaskId: proposed.id, specId: task.specId }] } },
          };
          try {
            current = await writeRequirements(project.path, slug, current);
          } catch (err) {
            const ids = created.map((t) => t.specId).join(', ');
            return { success: false, error: `Tasks ${ids} were created but the release record could not be saved: ${err instanceof Error ? err.message : String(err)}` };
          }
        }
        return { success: true, data: { set: current, tasks: created } };
      } catch (err) {
        return fail(err);
      } finally {
        activeRuns.delete(key);
      }
    },
  );
```

Note `writeRequirements` is called once per created task, so the record on disk is truthful after a crash between tasks. The `activeRuns` entry doubles as the per-slug lock shared with generation; `requirements:cancel` will find it but aborting the controller has no effect on a release, which is acceptable because a release finishes in milliseconds per task.

- [ ] **Step 5: Run the handler tests**

Run: `npx vitest run src/main/ipc-handlers/__tests__/requirements-handlers.test.ts`
Expected: all pass. If the "stops at the first creation failure" test sees two `writeRequirements` calls, check that the failure path returns before the write, as written above.

- [ ] **Step 6: Preload and mock**

In `src/preload/api/modules/requirements-api.ts`, add `Task` to the type imports (`import type { IPCResult, Task } from '../../../shared/types';`), then add to the interface:

```ts
  requirementsRelease: (projectId: string, slug: string, milestoneId: string) => Promise<IPCResult<{ set: RequirementsSet; tasks: Task[] }>>;
```

and to `createRequirementsAPI`:

```ts
  requirementsRelease: (projectId, slug, milestoneId) => invokeIpc(IPC_CHANNELS.REQUIREMENTS_RELEASE, projectId, slug, milestoneId),
```

In `src/renderer/lib/browser-mock.ts`, after the `requirementsCancel` line:

```ts
  requirementsRelease: async () => ({ success: false, error: 'Not available in browser mock' }),
```

- [ ] **Step 7: Lint, typecheck, commit**

Run: `npx biome check src/main/ipc-handlers/requirements-handlers.ts src/preload/api/modules/requirements-api.ts src/renderer/lib/browser-mock.ts && npx tsc --noEmit -p tsconfig.json`
Expected: clean.

```bash
git add src/shared/constants/ipc.ts src/main/ipc-handlers/requirements-handlers.ts src/main/ipc-handlers/__tests__/requirements-handlers.test.ts src/preload/api/modules/requirements-api.ts src/renderer/lib/browser-mock.ts
git commit -m "feat(release): add requirements:release IPC that creates Kanban tasks and records the release"
```

---

### Task 5: Store actions, refinement exclusions, and i18n keys

**Files:**
- Modify: `src/renderer/stores/requirements-store.ts`
- Modify: `src/shared/i18n/locales/en/requirements.json`, `src/shared/i18n/locales/fr/requirements.json`
- Modify: `src/shared/i18n/locales/en/tasks.json`, `src/shared/i18n/locales/fr/tasks.json`
- Test: `src/renderer/stores/__tests__/requirements-store.test.ts`

**Interfaces:**
- Consumes: `requirementsRelease` (Task 4), helpers from Task 2, `useTaskStore.getState().addTask(task)` from `src/renderer/stores/task-store.ts`.
- Produces on the store: `isReleasing: boolean`, `lockedIds(): Set<string>`, `nextMilestone(): Milestone | null`, `releaseReason(milestoneId): ReleaseGateReason | 'running' | null`, `release(projectId, milestoneId): Promise<void>`. `refine` and `regenerate` now pass a selection that excludes locked ids.

- [ ] **Step 1: Write the failing store tests**

In `src/renderer/stores/__tests__/requirements-store.test.ts`, add `requirementsRelease: vi.fn()` to the `api` object, and mock the task store at the top of the file (after the imports):

```ts
const addTask = vi.fn();
vi.mock('../task-store', () => ({ useTaskStore: { getState: () => ({ addTask }) } }));
```

Append inside `describe('requirements-store', ...)`:

```ts
  const approved: RequirementsSet = { ...set, status: 'approved', approvedAt: 't' };
  const released: RequirementsSet = { ...approved, releases: { M1: { releasedAt: 't', tasks: [{ proposedTaskId: 'T1', specId: '001-t' }] } } };

  it('release calls the API, installs the returned set as saved, and pushes tasks to the task store', async () => {
    api.requirementsRead.mockResolvedValue({ success: true, data: { set: approved, currentBrdHash: 'H' } });
    await useRequirementsStore.getState().load('p1', 'a');
    const task = { id: '001-t', specId: '001-t', status: 'backlog' };
    api.requirementsRelease.mockResolvedValue({ success: true, data: { set: released, tasks: [task] } });
    await useRequirementsStore.getState().release('p1', 'M1');
    expect(api.requirementsRelease).toHaveBeenCalledWith('p1', 'a', 'M1');
    expect(addTask).toHaveBeenCalledWith(task);
    const s = useRequirementsStore.getState();
    expect(s.set).toEqual(released);
    expect(s.isDirty()).toBe(false);
    expect(s.isReleasing).toBe(false);
    expect(s.error).toBeNull();
  });

  it('release surfaces the error and reloads the set so a partial record shows', async () => {
    api.requirementsRead.mockResolvedValue({ success: true, data: { set: approved, currentBrdHash: 'H' } });
    await useRequirementsStore.getState().load('p1', 'a');
    api.requirementsRead.mockResolvedValue({ success: true, data: { set: released, currentBrdHash: 'H' } });
    api.requirementsRelease.mockResolvedValue({ success: false, error: 'Could not create a task for T2 (u): disk full' });
    await useRequirementsStore.getState().release('p1', 'M1');
    const s = useRequirementsStore.getState();
    expect(s.error).toBe('Could not create a task for T2 (u): disk full');
    expect(s.set?.releases?.M1.tasks).toHaveLength(1);
  });

  it('releaseReason reflects the gate, dirty edits, and a running run', async () => {
    api.requirementsRead.mockResolvedValue({ success: true, data: { set: approved, currentBrdHash: 'H' } });
    await useRequirementsStore.getState().load('p1', 'a');
    expect(useRequirementsStore.getState().releaseReason('M1')).toBeNull();
    expect(useRequirementsStore.getState().releaseReason('M2')).toBe('notNext');
    useRequirementsStore.getState().edit('requirements', 'R1', { title: 'x' });
    expect(useRequirementsStore.getState().releaseReason('M1')).toBe('dirty');
    useRequirementsStore.setState({ set: approved, run: { status: 'running', runId: 'r' } });
    expect(useRequirementsStore.getState().releaseReason('M1')).toBe('running');
  });

  it('lockedIds and nextMilestone derive from the set', async () => {
    api.requirementsRead.mockResolvedValue({ success: true, data: { set: released, currentBrdHash: 'H' } });
    await useRequirementsStore.getState().load('p1', 'a');
    expect([...useRequirementsStore.getState().lockedIds()].sort()).toEqual(['M1', 'R1', 'T1']);
    expect(useRequirementsStore.getState().nextMilestone()?.id).toBe('M2');
  });

  it('refine excludes locked ids: whole-set refinement selects only unlocked ids, targeted drops locked ones', async () => {
    api.requirementsRead.mockResolvedValue({ success: true, data: { set: released, currentBrdHash: 'H' } });
    await useRequirementsStore.getState().load('p1', 'a');
    api.requirementsGenerate.mockResolvedValue({ success: true, data: { runId: 'r1' } });
    await useRequirementsStore.getState().refine('p1', 'tighten');
    expect(api.requirementsGenerate).toHaveBeenLastCalledWith('p1', { slug: 'a', mode: 'refine', feedback: 'tighten', selection: ['M2'] });
    useRequirementsStore.getState().toggleSelect('T1');
    useRequirementsStore.getState().toggleSelect('M2');
    await useRequirementsStore.getState().refine('p1', 'again');
    expect(api.requirementsGenerate).toHaveBeenLastCalledWith('p1', { slug: 'a', mode: 'refine', feedback: 'again', selection: ['M2'] });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/stores/__tests__/requirements-store.test.ts`
Expected: the five new tests fail (`release is not a function`, etc.).

- [ ] **Step 3: Implement the store changes**

In `src/renderer/stores/requirements-store.ts`:

Add imports:

```ts
import { lockedIds as computeLockedIds, nextReleasableMilestone, releaseGate, type ReleaseGateReason } from '../../shared/brd/release';
import { useTaskStore } from './task-store';
```

Extend the state interface (after `isSaving: boolean;`):

```ts
  isReleasing: boolean;
```

and after `canApprove`:

```ts
  lockedIds: () => Set<string>;
  nextMilestone: () => Milestone | null;
  releaseReason: (milestoneId: string) => ReleaseGateReason | 'running' | null;
  release: (projectId: string, milestoneId: string) => Promise<void>;
```

Add `isReleasing: false,` to `initial`.

Add a helper above `return {` inside the store factory:

```ts
  /** Ids the model may change: everything not locked. Empty when nothing is locked. */
  const unlockedSelection = (selection: string[]): string[] | undefined => {
    const current = get().set;
    if (!current) return selection.length > 0 ? selection : undefined;
    const locked = computeLockedIds(current);
    if (locked.size === 0) return selection.length > 0 ? selection : undefined;
    const candidates = selection.length > 0
      ? selection
      : [...current.requirements, ...current.milestones, ...current.tasks].map((i) => i.id);
    return candidates.filter((id) => !locked.has(id));
  };
```

Add the new members inside the returned object, after `canApprove`:

```ts
    lockedIds: () => {
      const current = get().set;
      return current ? computeLockedIds(current) : new Set<string>();
    },
    nextMilestone: () => {
      const current = get().set;
      return current ? nextReleasableMilestone(current) : null;
    },
    releaseReason: (milestoneId) => {
      if (get().run.status === 'running' || get().isReleasing) return 'running';
      return releaseGate(get().set, get().savedSet, get().currentBrdHash, milestoneId);
    },
    release: async (projectId, milestoneId) => {
      const { slug } = get();
      if (!slug || get().releaseReason(milestoneId)) return;
      set({ isReleasing: true, error: null });
      const result = await window.electronAPI.requirementsRelease(projectId, slug, milestoneId);
      if (!result.success || !result.data) {
        // Reload first (a partial record may exist on disk), then surface the error, because load clears it.
        await get().load(projectId, slug);
        set({ error: result.error ?? 'Unknown error', isReleasing: false });
        return;
      }
      for (const task of result.data.tasks) useTaskStore.getState().addTask(task);
      const next = result.data.set;
      set({ set: next, savedSet: next, warnings: validateRequirementsSet(next), isReleasing: false });
    },
```

Replace `refine` and `regenerate`:

```ts
    refine: async (projectId, feedback) => {
      const { slug, selection } = get();
      if (!slug) return;
      const scoped = unlockedSelection(selection);
      await startRun(projectId, { slug, mode: 'refine', feedback, ...(scoped && scoped.length > 0 ? { selection: scoped } : {}) });
    },

    regenerate: async (projectId) => {
      const { slug } = get();
      if (!slug) return;
      const scoped = unlockedSelection([]);
      await startRun(projectId, {
        slug,
        mode: 'refine',
        feedback: 'The BRD changed; update the set to match it. Keep ids of items that still apply.',
        ...(scoped && scoped.length > 0 ? { selection: scoped } : {}),
      });
    },
```

Note: `load` clears `error` and does not touch `isReleasing`; on the failure path `release` reloads first and then sets both `error` and `isReleasing: false` (as written above), so the message survives and the flag never sticks.

- [ ] **Step 4: Add the i18n keys**

`src/shared/i18n/locales/en/requirements.json`, add a top-level `"release"` object (sibling of `"set"`):

```json
  "release": {
    "button": "Release milestone",
    "releasing": "Releasing…",
    "released": "Released {{date}}",
    "partial": "Partially released",
    "locked": "Released",
    "reason": {
      "noSet": "No requirements set",
      "notApproved": "Approve the set first",
      "dirty": "Save your edits first",
      "stale": "The BRD changed; regenerate and approve first",
      "notNext": "Release earlier milestones first",
      "complete": "Already released",
      "running": "Wait for the current run to finish"
    },
    "rollup": "{{done}} of {{released}} tasks done",
    "statusUnavailable": "not on this machine",
    "status": {
      "backlog": "Backlog",
      "queue": "Queued",
      "in_progress": "In progress",
      "ai_review": "AI review",
      "human_review": "Human review",
      "done": "Done",
      "pr_created": "PR created",
      "error": "Error"
    },
    "error": "Release failed: {{error}}"
  }
```

`src/shared/i18n/locales/fr/requirements.json`, same shape:

```json
  "release": {
    "button": "Publier le jalon",
    "releasing": "Publication…",
    "released": "Publié le {{date}}",
    "partial": "Partiellement publié",
    "locked": "Publié",
    "reason": {
      "noSet": "Aucun ensemble d'exigences",
      "notApproved": "Approuvez d'abord l'ensemble",
      "dirty": "Enregistrez d'abord vos modifications",
      "stale": "Le BRD a changé ; régénérez et approuvez d'abord",
      "notNext": "Publiez d'abord les jalons précédents",
      "complete": "Déjà publié",
      "running": "Attendez la fin de l'exécution en cours"
    },
    "rollup": "{{done}} tâche(s) sur {{released}} terminée(s)",
    "statusUnavailable": "absent de cette machine",
    "status": {
      "backlog": "Backlog",
      "queue": "En file d'attente",
      "in_progress": "En cours",
      "ai_review": "Revue IA",
      "human_review": "Revue humaine",
      "done": "Terminé",
      "pr_created": "PR créée",
      "error": "Erreur"
    },
    "error": "Échec de la publication : {{error}}"
  }
```

`src/shared/i18n/locales/en/tasks.json`, add a top-level `"requirementsSection"` object:

```json
  "requirementsSection": {
    "title": "Requirements",
    "brd": "BRD",
    "openBrd": "Open in Requirements",
    "milestone": "Milestone",
    "covers": "Covers"
  }
```

`src/shared/i18n/locales/fr/tasks.json`:

```json
  "requirementsSection": {
    "title": "Exigences",
    "brd": "BRD",
    "openBrd": "Ouvrir dans Exigences",
    "milestone": "Jalon",
    "covers": "Couvre"
  }
```

Keep the JSON valid (commas between siblings).

- [ ] **Step 5: Run tests, lint, typecheck, commit**

Run: `npx vitest run src/renderer/stores/__tests__/requirements-store.test.ts src/renderer/components/requirements && npx biome check src/renderer/stores/requirements-store.ts src/shared/i18n/locales/en/requirements.json src/shared/i18n/locales/fr/requirements.json src/shared/i18n/locales/en/tasks.json src/shared/i18n/locales/fr/tasks.json && npx tsc --noEmit -p tsconfig.json`
Expected: all pass, clean.

```bash
git add src/renderer/stores/requirements-store.ts src/renderer/stores/__tests__/requirements-store.test.ts src/shared/i18n/locales/en/requirements.json src/shared/i18n/locales/fr/requirements.json src/shared/i18n/locales/en/tasks.json src/shared/i18n/locales/fr/tasks.json
git commit -m "feat(release): store release action, locked-aware refinement, and i18n keys"
```

---

### Task 6: Set editor: release controls, locked rendering, status chips, rollup

**Files:**
- Modify: `src/renderer/components/requirements/set/RequirementsSetEditor.tsx`
- Test: `src/renderer/components/requirements/set/__tests__/RequirementsSetEditor.test.tsx` (create)

**Interfaces:**
- Consumes: store members from Task 5, `releasedTaskSpecIds`, `requirementRollup`, `isMilestoneComplete` from Task 2, `useTaskStore((s) => s.tasks)`.

- [ ] **Step 1: Write the failing component test**

Create `src/renderer/components/requirements/set/__tests__/RequirementsSetEditor.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
// apps/desktop/src/renderer/components/requirements/set/__tests__/RequirementsSetEditor.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RequirementsSetEditor } from '../RequirementsSetEditor';
import { useRequirementsStore } from '../../../../stores/requirements-store';
import { useTaskStore } from '../../../../stores/task-store';
import type { RequirementsSet } from '../../../../../shared/types/requirements';
import type { Task } from '../../../../../shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && Object.keys(o).length > 0 ? `${k}:${Object.values(o).join(',')}` : k),
    i18n: { language: 'en' },
  }),
}));

const set: RequirementsSet = {
  version: 1, brdSlug: 'a', brdHash: 'H', status: 'approved', generatedAt: 't', approvedAt: 't',
  requirements: [{ id: 'R1', title: 'Signup wizard', description: 'd', acceptanceCriteria: ['Has 3 steps'], area: 'Onboarding', needsDesign: true, included: true }],
  milestones: [
    { id: 'M1', name: 'Foundations', description: 'd', order: 1, included: true },
    { id: 'M2', name: 'Growth', description: 'd', order: 2, included: true },
  ],
  tasks: [
    { id: 'T1', title: 'Build wizard', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 1, included: true },
    { id: 'T2', title: 'Add invites', description: 'd', milestoneId: 'M2', requirementIds: ['R1'], category: 'feature', order: 1, included: true },
  ],
};
const released: RequirementsSet = { ...set, releases: { M1: { releasedAt: '2026-09-21T10:00:00.000Z', tasks: [{ proposedTaskId: 'T1', specId: '001-build-wizard' }] } } };
const api = { requirementsRelease: vi.fn(), requirementsGenerate: vi.fn(), requirementsWrite: vi.fn(), requirementsApprove: vi.fn(), requirementsCancel: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  useRequirementsStore.getState().reset();
  useTaskStore.setState({ tasks: [] });
});

describe('RequirementsSetEditor release controls', () => {
  it('shows an enabled Release button on the next milestone only and calls release', async () => {
    useRequirementsStore.setState({ slug: 'a', set, savedSet: set, currentBrdHash: 'H' });
    api.requirementsRelease.mockResolvedValue({ success: true, data: { set: released, tasks: [] } });
    render(<RequirementsSetEditor projectId="p1" />);
    const buttons = screen.getAllByRole('button', { name: 'release.button' });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toBeEnabled();
    expect(buttons[1]).toBeDisabled();
    expect(screen.getByText('release.reason.notNext')).toBeInTheDocument();
    fireEvent.click(buttons[0]);
    expect(api.requirementsRelease).toHaveBeenCalledWith('p1', 'a', 'M1');
  });

  it('shows the gate reason when the set is not approved', () => {
    const draft = { ...set, status: 'draft' as const };
    useRequirementsStore.setState({ slug: 'a', set: draft, savedSet: draft, currentBrdHash: 'H' });
    render(<RequirementsSetEditor projectId="p1" />);
    expect(screen.getAllByRole('button', { name: 'release.button' })[0]).toBeDisabled();
    // Status is checked before ordering, so every milestone reports the same reason
    expect(screen.getAllByText('release.reason.notApproved')).toHaveLength(2);
  });

  it('renders released items read-only with a badge, a status chip, and a rollup', () => {
    useRequirementsStore.setState({ slug: 'a', set: released, savedSet: released, currentBrdHash: 'H' });
    useTaskStore.setState({ tasks: [{ id: '001-build-wizard', specId: '001-build-wizard', status: 'in_progress' } as unknown as Task] });
    render(<RequirementsSetEditor projectId="p1" />);
    expect(screen.getByText(/release\.released:/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Build wizard')).toBeDisabled();
    expect(screen.getByDisplayValue('Foundations')).toBeDisabled();
    expect(screen.getByLabelText('set.fields.included T1')).toBeDisabled();
    expect(screen.getByLabelText('set.fields.select T1')).toBeDisabled();
    expect(screen.getByDisplayValue('Add invites')).toBeEnabled();
    expect(screen.getByText('release.status.in_progress')).toBeInTheDocument();
    expect(screen.getByText('release.rollup:0,1')).toBeInTheDocument();
    // M1 is locked so its move arrows are hidden; M2 still has its pair
    expect(screen.getAllByLabelText('set.fields.moveUp')).toHaveLength(1);
  });

  it('shows "not on this machine" when the released spec has no local task', () => {
    useRequirementsStore.setState({ slug: 'a', set: released, savedSet: released, currentBrdHash: 'H' });
    render(<RequirementsSetEditor projectId="p1" />);
    expect(screen.getByText('release.statusUnavailable')).toBeInTheDocument();
  });
});
```

Also update the existing `RequirementsTab.tsx` call site: `<RequirementsSetEditor projectId={projectId} />` (the editor now needs the project id to release).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/requirements/set/__tests__/RequirementsSetEditor.test.tsx`
Expected: FAIL (no Release buttons; props type error at typecheck time).

- [ ] **Step 3: Implement the editor changes**

Rewrite `src/renderer/components/requirements/set/RequirementsSetEditor.tsx` as follows (whole file; it keeps every existing behavior and adds the release UI):

```tsx
// apps/desktop/src/renderer/components/requirements/set/RequirementsSetEditor.tsx
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Lock, Plus, Rocket, X } from 'lucide-react';

import { isMilestoneComplete, lockedIds as computeLockedIds, releasedTaskSpecIds, requirementRollup } from '../../../../shared/brd/release';
import { PROPOSED_TASK_CATEGORIES, type Milestone, type ProposedTask, type Requirement } from '../../../../shared/types/requirements';
import type { TaskStatus } from '../../../../shared/types/task';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Input } from '../../ui/input';
import { Textarea } from '../../ui/textarea';
import { cn } from '../../../lib/utils';
import { useRequirementsStore } from '../../../stores/requirements-store';
import { useTaskStore } from '../../../stores/task-store';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: children is always a native input, textarea, or select, so wrapping it names the control
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ItemFrame({ id, included, selected, locked, trailing, onInclude, onSelect, children }: {
  id: string; included: boolean; selected: boolean; locked: boolean; trailing?: React.ReactNode;
  onInclude: () => void; onSelect: () => void; children: React.ReactNode;
}) {
  const { t } = useTranslation('requirements');
  return (
    <div className={cn('rounded-md border border-border p-3 space-y-2', !included && 'opacity-60', locked && 'bg-muted/30')}>
      <div className="flex items-center gap-3 text-xs">
        <span className="font-mono font-medium">{id}</span>
        <span className="flex items-center gap-1">
          <Checkbox aria-label={`${t('set.fields.included')} ${id}`} checked={included} disabled={locked} onCheckedChange={onInclude} />
          {t('set.fields.included')}
        </span>
        <span className="flex items-center gap-1">
          <Checkbox aria-label={`${t('set.fields.select')} ${id}`} checked={selected} disabled={locked} onCheckedChange={onSelect} />
          {t('set.fields.select')}
        </span>
        {locked && <Badge variant="secondary" className="gap-1"><Lock className="h-3 w-3" />{t('release.locked')}</Badge>}
        {trailing}
      </div>
      {children}
    </div>
  );
}

export function RequirementsSetEditor({ projectId }: { projectId: string }) {
  const { t } = useTranslation('requirements');
  const { set, selection, edit, toggleInclude, toggleSelect, moveMilestone, release, releaseReason, isReleasing } = useRequirementsStore();
  const tasks = useTaskStore((s) => s.tasks);
  // Derived once per set: a selector returning a fresh Set each render would loop.
  const locked = useMemo(() => (set ? computeLockedIds(set) : new Set<string>()), [set]);
  if (!set) return null;

  const milestones = [...set.milestones].sort((a, b) => a.order - b.order);
  const isSelected = (id: string) => selection.includes(id);
  const specIds = releasedTaskSpecIds(set);
  const statusBySpec = new Map<string, TaskStatus>(tasks.map((task) => [task.specId, task.status]));
  const rollup = requirementRollup(set, statusBySpec);
  const isLocked = (id: string) => locked.has(id);
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString();

  const statusChip = (proposedTaskId: string) => {
    const specId = specIds.get(proposedTaskId);
    if (!specId) return null;
    const status = statusBySpec.get(specId);
    return (
      <Badge variant="outline" title={specId}>
        {status ? t(`release.status.${status}`) : t('release.statusUnavailable')}
      </Badge>
    );
  };

  const requirementCard = (r: Requirement) => {
    const lockedR = isLocked(r.id);
    const roll = rollup[r.id];
    return (
      <ItemFrame
        key={r.id} id={r.id} included={r.included} selected={isSelected(r.id)} locked={lockedR}
        trailing={roll ? <span className="text-muted-foreground">{t('release.rollup', { done: roll.done, released: roll.released })}</span> : undefined}
        onInclude={() => toggleInclude('requirements', r.id)} onSelect={() => toggleSelect(r.id)}
      >
        <Field label={t('set.fields.title')}><Input value={r.title} disabled={lockedR} onChange={(e) => edit('requirements', r.id, { title: e.target.value })} /></Field>
        <Field label={t('set.fields.description')}><Textarea rows={2} value={r.description} disabled={lockedR} onChange={(e) => edit('requirements', r.id, { description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('set.fields.area')}><Input value={r.area} disabled={lockedR} onChange={(e) => edit('requirements', r.id, { area: e.target.value })} /></Field>
          <span className="flex items-end gap-2 pb-2 text-xs">
            <Checkbox aria-label={`${t('set.fields.needsDesign')} ${r.id}`} checked={r.needsDesign} disabled={lockedR} onCheckedChange={() => edit('requirements', r.id, { needsDesign: !r.needsDesign })} />
            {t('set.fields.needsDesign')}
          </span>
        </div>
        <div className="text-xs">
          <span className="mb-1 block font-medium text-muted-foreground">{t('set.fields.acceptance')}</span>
          {r.acceptanceCriteria.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: criteria are plain strings without ids
            <div key={`${r.id}-ac-${i}`} className="mb-1 flex gap-1">
              <Input value={c} disabled={lockedR} onChange={(e) => edit('requirements', r.id, { acceptanceCriteria: r.acceptanceCriteria.map((x, j) => (j === i ? e.target.value : x)) })} />
              {!lockedR && (
                <Button size="icon" variant="ghost" aria-label="remove" onClick={() => edit('requirements', r.id, { acceptanceCriteria: r.acceptanceCriteria.filter((_, j) => j !== i) })}><X className="h-3.5 w-3.5" /></Button>
              )}
            </div>
          ))}
          {!lockedR && (
            <Button size="sm" variant="outline" onClick={() => edit('requirements', r.id, { acceptanceCriteria: [...r.acceptanceCriteria, ''] })}><Plus className="mr-1 h-3.5 w-3.5" />{t('set.fields.addCriterion')}</Button>
          )}
        </div>
      </ItemFrame>
    );
  };

  const milestoneCard = (m: Milestone, index: number) => {
    const lockedM = isLocked(m.id);
    return (
      <ItemFrame key={m.id} id={m.id} included={m.included} selected={isSelected(m.id)} locked={lockedM} onInclude={() => toggleInclude('milestones', m.id)} onSelect={() => toggleSelect(m.id)}>
        <div className="flex items-end gap-2">
          <div className="flex-1"><Field label={t('set.fields.name')}><Input value={m.name} disabled={lockedM} onChange={(e) => edit('milestones', m.id, { name: e.target.value })} /></Field></div>
          {!lockedM && (
            <>
              <Button size="icon" variant="ghost" aria-label={t('set.fields.moveUp')} disabled={index === 0} onClick={() => moveMilestone(m.id, 'up')}><ArrowUp className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" aria-label={t('set.fields.moveDown')} disabled={index === milestones.length - 1} onClick={() => moveMilestone(m.id, 'down')}><ArrowDown className="h-4 w-4" /></Button>
            </>
          )}
        </div>
        <Field label={t('set.fields.description')}><Textarea rows={2} value={m.description} disabled={lockedM} onChange={(e) => edit('milestones', m.id, { description: e.target.value })} /></Field>
      </ItemFrame>
    );
  };

  const taskCard = (task: ProposedTask) => {
    const lockedT = isLocked(task.id);
    return (
      <ItemFrame key={task.id} id={task.id} included={task.included} selected={isSelected(task.id)} locked={lockedT} trailing={statusChip(task.id)} onInclude={() => toggleInclude('tasks', task.id)} onSelect={() => toggleSelect(task.id)}>
        <Field label={t('set.fields.title')}><Input value={task.title} disabled={lockedT} onChange={(e) => edit('tasks', task.id, { title: e.target.value })} /></Field>
        <Field label={t('set.fields.description')}><Textarea rows={2} value={task.description} disabled={lockedT} onChange={(e) => edit('tasks', task.id, { description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('set.fields.category')}>
            <select className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" value={task.category} disabled={lockedT} onChange={(e) => edit('tasks', task.id, { category: e.target.value as ProposedTask['category'] })}>
              {PROPOSED_TASK_CATEGORIES.map((c) => <option key={c} value={c}>{t(`set.category.${c}`)}</option>)}
            </select>
          </Field>
          <Field label={t('set.fields.milestone')}>
            <select className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" value={task.milestoneId} disabled={lockedT} onChange={(e) => edit('tasks', task.id, { milestoneId: e.target.value })}>
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
                <button key={r.id} type="button" disabled={lockedT} onClick={() => edit('tasks', task.id, { requirementIds: on ? task.requirementIds.filter((x) => x !== r.id) : [...task.requirementIds, r.id] })}>
                  <Badge variant={on ? 'default' : 'outline'} title={r.title}>{r.id}</Badge>
                </button>
              );
            })}
          </div>
        </div>
      </ItemFrame>
    );
  };

  const milestoneHeader = (m: Milestone) => {
    const entry = set.releases?.[m.id];
    const complete = isMilestoneComplete(set, m.id);
    const reason = releaseReason(m.id);
    if (entry && complete) {
      return <Badge variant="secondary">{t('release.released', { date: fmtDate(entry.releasedAt) })}</Badge>;
    }
    return (
      <span className="flex items-center gap-2">
        {entry && <Badge variant="outline">{t('release.partial')}</Badge>}
        {reason && <span className="text-muted-foreground">{t(`release.reason.${reason}`)}</span>}
        <Button size="sm" variant="outline" disabled={!!reason || isReleasing} onClick={() => void release(projectId, m.id)}>
          <Rocket className="mr-1 h-3.5 w-3.5" />{isReleasing ? t('release.releasing') : t('release.button')}
        </Button>
      </span>
    );
  };

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
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium text-muted-foreground">{m.id} · {m.name}</span>
              {m.included && milestoneHeader(m)}
            </div>
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

In `src/renderer/components/requirements/set/RequirementsTab.tsx`, change `<RequirementsSetEditor />` to `<RequirementsSetEditor projectId={projectId} />` and make the tab show release errors: the existing `{(error || run.error) && ...}` line already renders `error`, which `release` sets, so nothing else changes.

- [ ] **Step 4: Run the component tests**

Run: `npx vitest run src/renderer/components/requirements`
Expected: all pass, including the older `RequirementsTab` tests. If `Rocket` or `Lock` icons are missing from `lucide-react`, use `Send` and `LockKeyhole` instead.

- [ ] **Step 5: Lint, typecheck, commit**

Run: `npx biome check src/renderer/components/requirements/set && npx tsc --noEmit -p tsconfig.json`
Expected: clean.

```bash
git add src/renderer/components/requirements/set
git commit -m "feat(release): release controls, locked items, status chips, and rollups in the set editor"
```

---

### Task 7: Task detail "Requirements" section and navigation back to the BRD

**Files:**
- Create: `src/renderer/components/task-detail/TaskRequirements.tsx`
- Modify: `src/renderer/components/task-detail/TaskDetailModal.tsx:49-57` (props) and `:511-516` (overview)
- Modify: `src/renderer/App.tsx:977-983`
- Modify: `src/renderer/stores/brd-store.ts` (state + `requestOpen`)
- Modify: `src/renderer/components/requirements/RequirementsView.tsx:22-32`
- Test: `src/renderer/components/task-detail/__tests__/TaskRequirements.test.tsx` (create), `src/renderer/components/requirements/__tests__/RequirementsView.test.tsx` (extend)

**Interfaces:**
- Consumes: `window.electronAPI.brdRead(projectId, slug)` → `IPCResult<{ summary: { slug; title; status; modifiedAt }; content }>`, `window.electronAPI.requirementsRead`.
- Produces: `TaskRequirements({ task, onOpenBrd? })`; `TaskDetailModalProps.onNavigateToRequirements?: (slug: string) => void`; brd store `pendingOpenSlug: string | null` and `requestOpen(slug: string): void`.

- [ ] **Step 1: Write the failing component test**

Create `src/renderer/components/task-detail/__tests__/TaskRequirements.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
// apps/desktop/src/renderer/components/task-detail/__tests__/TaskRequirements.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskRequirements } from '../TaskRequirements';
import type { Task } from '../../../../shared/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const brdRead = vi.fn();
const requirementsRead = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = { brdRead, requirementsRead };
});

const set = {
  version: 1, brdSlug: 'todo-app', brdHash: 'H', status: 'approved', generatedAt: 't',
  requirements: [
    { id: 'R1', title: 'Add todos', description: 'd', acceptanceCriteria: ['x'], area: 'Core', needsDesign: false, included: true },
    { id: 'R2', title: 'Persist', description: 'd', acceptanceCriteria: ['y'], area: 'Storage', needsDesign: false, included: true },
  ],
  milestones: [{ id: 'M1', name: 'Core', description: 'd', order: 1, included: true }],
  tasks: [],
};
const task = {
  id: '001-x', projectId: 'p1',
  metadata: { sourceType: 'requirements', brdSlug: 'todo-app', milestoneId: 'M1', requirementIds: ['R1'], proposedTaskId: 'T1' },
} as unknown as Task;

describe('TaskRequirements', () => {
  it('shows the BRD title, milestone, and covered requirements, and opens the BRD', async () => {
    brdRead.mockResolvedValue({ success: true, data: { summary: { slug: 'todo-app', title: 'Todo app', status: 'draft', modifiedAt: 't' }, content: '' } });
    requirementsRead.mockResolvedValue({ success: true, data: { set, currentBrdHash: 'H' } });
    const onOpenBrd = vi.fn();
    render(<TaskRequirements task={task} onOpenBrd={onOpenBrd} />);
    expect(await screen.findByText('Todo app')).toBeInTheDocument();
    expect(brdRead).toHaveBeenCalledWith('p1', 'todo-app');
    expect(screen.getByText('Core')).toBeInTheDocument();
    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.getByText('Add todos')).toBeInTheDocument();
    expect(screen.queryByText('Persist')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'tasks:requirementsSection.openBrd' }));
    expect(onOpenBrd).toHaveBeenCalledWith('todo-app');
  });

  it('renders nothing for tasks without a BRD link or when the BRD is missing', async () => {
    const { container } = render(<TaskRequirements task={{ id: 't', projectId: 'p1', metadata: {} } as unknown as Task} />);
    expect(container).toBeEmptyDOMElement();
    brdRead.mockResolvedValue({ success: false, error: 'BRD not found: todo-app' });
    requirementsRead.mockResolvedValue({ success: true, data: { set: null, currentBrdHash: '' } });
    const { container: c2 } = render(<TaskRequirements task={task} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(c2).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/task-detail/__tests__/TaskRequirements.test.tsx`
Expected: FAIL, "Cannot find module '../TaskRequirements'".

- [ ] **Step 3: Write the component**

Create `src/renderer/components/task-detail/TaskRequirements.tsx`:

```tsx
// apps/desktop/src/renderer/components/task-detail/TaskRequirements.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList, ExternalLink } from 'lucide-react';

import type { Task } from '../../../shared/types';
import type { RequirementsSet } from '../../../shared/types/requirements';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

interface TaskRequirementsProps {
  task: Task;
  onOpenBrd?: (slug: string) => void;
}

interface Loaded {
  brdTitle: string;
  set: RequirementsSet;
}

/** Where a released task came from: BRD, milestone, and the requirements it covers. */
export function TaskRequirements({ task, onOpenBrd }: TaskRequirementsProps) {
  const { t } = useTranslation('tasks');
  const slug = task.metadata?.brdSlug;
  const [data, setData] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    Promise.all([window.electronAPI.brdRead(task.projectId, slug), window.electronAPI.requirementsRead(task.projectId, slug)])
      .then(([brd, req]) => {
        if (cancelled) return;
        if (!brd.success || !brd.data || !req.success || !req.data?.set) {
          setData(null);
          return;
        }
        setData({ brdTitle: brd.data.summary.title, set: req.data.set });
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [task.projectId, slug]);

  if (!slug || !data) return null;

  const milestone = data.set.milestones.find((m) => m.id === task.metadata?.milestoneId);
  const covered = data.set.requirements.filter((r) => task.metadata?.requirementIds?.includes(r.id));

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ClipboardList className="h-4 w-4" />
          {t('tasks:requirementsSection.title')}
        </div>
        {onOpenBrd && (
          <Button size="sm" variant="outline" onClick={() => onOpenBrd(slug)}>
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            {t('tasks:requirementsSection.openBrd')}
          </Button>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t('tasks:requirementsSection.brd')}</dt>
        <dd>{data.brdTitle}</dd>
        {milestone && (
          <>
            <dt className="text-muted-foreground">{t('tasks:requirementsSection.milestone')}</dt>
            <dd>{milestone.name}</dd>
          </>
        )}
        <dt className="text-muted-foreground">{t('tasks:requirementsSection.covers')}</dt>
        <dd>
          <ul className="space-y-1">
            {covered.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono">{r.id}</Badge>
                <span>{r.title}</span>
              </li>
            ))}
          </ul>
        </dd>
      </dl>
    </div>
  );
}
```

- [ ] **Step 4: Run the component test**

Run: `npx vitest run src/renderer/components/task-detail/__tests__/TaskRequirements.test.tsx`
Expected: pass.

- [ ] **Step 5: Wire the modal, the app, and the BRD store**

`src/renderer/components/task-detail/TaskDetailModal.tsx`:
- Add `import { TaskRequirements } from './TaskRequirements';`
- Add `onNavigateToRequirements?: (slug: string) => void;` to `TaskDetailModalProps` and destructure it in the component signature.
- In the overview tab, right after `<TaskMetadata task={task} />`, add:

```tsx
                      {/* Origin in the requirements set (released tasks only) */}
                      <TaskRequirements task={task} onOpenBrd={onNavigateToRequirements} />
```

`src/renderer/stores/brd-store.ts`:
- In `interface BrdState`, after `error: string | null;` add:

```ts
  /** BRD to open once the Requirements view has loaded its list (set from task detail). */
  pendingOpenSlug: string | null;
```

  and after `reset: () => void;` add:

```ts
  requestOpen: (slug: string) => void;
```

- In the `initial` object, after `error: null as string | null,` add `pendingOpenSlug: null as string | null,`.
- Replace the `reset` line so a pending slug survives the view's mount-time reset:

```ts
  reset: () => set((s) => ({ ...initial, draft: { ...idleDraft }, pendingOpenSlug: s.pendingOpenSlug })),

  requestOpen: (slug) => set({ pendingOpenSlug: slug }),
```

`src/renderer/components/requirements/RequirementsView.tsx`, replace the load effect body:

```tsx
  useEffect(() => {
    const stop = setupBrdListeners();
    const stopRequirements = setupRequirementsListeners();
    reset();
    useRequirementsStore.getState().reset();
    void load(projectId).then(() => {
      const pending = useBrdStore.getState().pendingOpenSlug;
      if (!pending) return;
      useBrdStore.setState({ pendingOpenSlug: null });
      void select(projectId, pending, { force: true });
    });
    return () => {
      stop();
      stopRequirements();
    };
  }, [projectId, load, reset, select]);
```

`src/renderer/App.tsx`:
- Add `import { useBrdStore } from './stores/brd-store';` (check the relative path used by other store imports in `App.tsx` and match it).
- Pass the prop on `<TaskDetailModal ...>`:

```tsx
          onNavigateToRequirements={(slug) => {
            useBrdStore.getState().requestOpen(slug);
            handleCloseTaskDetail();
            setActiveView('requirements');
          }}
```

- [ ] **Step 6: Extend the RequirementsView test for the pending slug**

In `src/renderer/components/requirements/__tests__/RequirementsView.test.tsx`, add a test (mirror the existing setup in that file for mocking `electronAPI.brdList`/`brdRead`; the `select` action calls `brdRead`):

```tsx
  it('opens a pending slug after the list loads', async () => {
    useBrdStore.setState({ pendingOpenSlug: 'todo-app' });
    render(<RequirementsView projectId="p1" />);
    await waitFor(() => expect(api.brdRead).toHaveBeenCalledWith('p1', 'todo-app'));
    expect(useBrdStore.getState().pendingOpenSlug).toBeNull();
  });
```

Import `waitFor` from `@testing-library/react` if the file does not already, and make sure the file's `api` mock includes `brdRead` returning a success with a summary and content.

- [ ] **Step 7: Run tests, lint, typecheck, commit**

Run: `npx vitest run src/renderer/components/task-detail src/renderer/components/requirements src/renderer/stores && npx biome check src/renderer/components/task-detail/TaskRequirements.tsx src/renderer/components/task-detail/TaskDetailModal.tsx src/renderer/stores/brd-store.ts src/renderer/components/requirements/RequirementsView.tsx src/renderer/App.tsx && npx tsc --noEmit -p tsconfig.json`
Expected: all pass, clean.

```bash
git add src/renderer/components/task-detail/TaskRequirements.tsx src/renderer/components/task-detail/__tests__/TaskRequirements.test.tsx src/renderer/components/task-detail/TaskDetailModal.tsx src/renderer/App.tsx src/renderer/stores/brd-store.ts src/renderer/components/requirements/RequirementsView.tsx src/renderer/components/requirements/__tests__/RequirementsView.test.tsx
git commit -m "feat(release): show a task's BRD, milestone, and requirements in task detail with a link back"
```

---

### Task 8: Full gate and manual check

- [ ] **Step 1: Full suite, lint, typecheck**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all tests pass; lint reports no errors (pre-existing warnings are fine); no type errors.

- [ ] **Step 2: Manual check in the running app**

1. From the repo root: `nvm use 24 && npm run dev:mcp` (kill any leftover Electron first, or port 9222 will be busy and the app will not expose the debug port).
2. Open the `todo` project, Requirements, select "Todo app", Requirements tab. The set from 2b is approved with milestones M1 to M3. Confirm: M1's header shows an enabled "Release milestone" button; M2 and M3 show a disabled button with "Release earlier milestones first".
3. Edit any title. Confirm M1's reason switches to "Save your edits first" and the button is disabled. Save, approve again. (Editing an approved set returns it to draft, so the reason becomes "Approve the set first" until you approve.)
4. Click Release on M1. Confirm: the header shows "Released <today>", M1's tasks show a "Backlog" chip, R1-style requirements covered only by M1 tasks show "0 of n tasks done", M1 and its tasks are read-only (inputs disabled, no move arrows), and M2 now has the enabled Release button.
5. Open the Kanban board. Confirm one Backlog task per included M1 task with the proposed title. Open one; the overview shows a "Requirements" block with BRD "Todo app", milestone name, and covered requirements. Click "Open in Requirements" and confirm the Requirements view opens on the Todo app BRD.
6. Start one released task from the board, return to the Requirements tab, and confirm its chip reads "In progress".
7. In the Document tab, change the BRD text and save. Back in the Requirements tab, confirm M2's reason reads "The BRD changed; regenerate and approve first". Regenerate: confirm the proposal keeps M1 and its tasks unchanged (counts show 0 changed for them).
8. Check `docs/brd/todo-app.requirements.json` contains `releases.M1` with one `{ proposedTaskId, specId }` per task and the spec directories exist under `.auto-claude/specs/`.

- [ ] **Step 3: Commit fixes from the manual check**

Commit with `fix(release): ...` describing what the run exposed.

---

## Spec coverage checklist (self-review)

| Spec section | Task |
|---|---|
| Schema changes: `releases`, `TaskMetadata` links, category map | 1, 2 |
| Pure helpers in `release.ts` | 2 |
| Task creation helper and both existing handlers on it | 3 |
| `requirements:release` IPC, gate, partial record, re-release, lock | 4 |
| Preload, ElectronAPI, browser mock | 4 |
| Store: release, locked ids, next milestone, refinement exclusions | 5 |
| i18n keys, both locales | 5 |
| Set editor: Release button and reasons, Released badge, locked rendering, chips, rollup | 6 |
| Task detail section and navigation to the BRD | 7 |
| Error handling table | 4, 5, 6, 7 |
| Testing list, manual check | every task; 8 |
