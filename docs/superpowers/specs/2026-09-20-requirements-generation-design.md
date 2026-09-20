# Requirements Generation and Review — Design

Date: 2026-09-20
Status: Approved design, pending implementation plan
Sub-project 2b of the company SDLC platform roadmap. Follows [BRD workspace (2a)](2026-09-20-brd-workspace-design.md). Followed by 2c (milestone release and traceability).

## Goal

Turn an approved-quality BRD into a structured, reviewable requirements set: numbered requirements with acceptance criteria, ordered milestones, and proposed tasks linked to both. The product owner includes, excludes, edits in place, refines with AI feedback (targeted or whole-set), and approves. The approved set is the input for 2c, which creates tasks from it milestone by milestone.

## Non-goals (this version)

- Creating tasks, touching the Kanban, or feeding agents (2c).
- Design hand-off; only the `needsDesign` flag is captured (sub-project 5).
- Editing the BRD itself from the Requirements tab (use the Document tab from 2a).
- Committing to git from the app.

## Definitions

- **Requirements set** (or set): the JSON artifact for one BRD.
- **Item**: a requirement, milestone, or proposed task.
- **Included**: an item flag; excluded items stay in the file but are ignored downstream.
- **Integrity warning**: a cross-item consistency problem reported by `validateRequirementsSet`.
- **Targeted refinement**: refinement where only selected item IDs may change.
- **Proposal**: a runner result the PO accepts or discards; never written to disk automatically.

## File

`<project>/docs/brd/<slug>.requirements.json`, one per BRD, committed with it. Written atomically (temp + rename) and path-contained to `docs/brd` with the same slug rule as 2a.

## Schema (`src/shared/brd/requirements.ts`, Zod + types)

```ts
type RequirementsStatus = 'draft' | 'approved';
type TaskCategory = 'feature' | 'bug' | 'refactor' | 'docs';

interface Requirement {
  id: string;                  // "R1", "R2", ... stable once assigned
  title: string;
  description: string;
  acceptanceCriteria: string[]; // testable statements, at least one
  area: string;                // feature area from the BRD's level-3 headings, or "General"
  needsDesign: boolean;
  included: boolean;
}

interface Milestone {
  id: string;                  // "M1", ...
  name: string;
  description: string;
  order: number;               // 1-based, unique among included milestones
  included: boolean;
}

interface ProposedTask {
  id: string;                  // "T1", ...
  title: string;
  description: string;
  milestoneId: string;
  requirementIds: string[];    // at least one
  category: TaskCategory;
  order: number;               // 1-based within its milestone
  included: boolean;
}

interface RequirementsSet {
  version: 1;
  brdSlug: string;
  brdHash: string;             // sha256 hex of the BRD content used for generation
  status: RequirementsStatus;
  generatedAt: string;         // ISO
  approvedAt?: string;         // ISO
  requirements: Requirement[];
  milestones: Milestone[];
  tasks: ProposedTask[];
}

/** What the model returns (no ids/flags/meta; those are added by post-processing). */
interface GeneratedBody {
  requirements: Array<Omit<Requirement, 'id' | 'included'> & { id?: string }>;
  milestones: Array<Omit<Milestone, 'id' | 'included'> & { id?: string }>;
  tasks: Array<Omit<ProposedTask, 'id' | 'included'> & { id?: string }>;
  changeSummary?: string;      // refinement only
}
```

### Pure helpers (shared)

- `validateRequirementsSet(set): string[]` — warnings, each a sentence naming the item:
  - included task → milestone not found or excluded
  - included task → any requirement ID not found or excluded, or no requirement IDs
  - included requirement covered by no included task
  - duplicate `order` among included milestones; duplicate `order` among included tasks of one milestone
  - requirement with zero acceptance criteria
  - duplicate IDs of any kind
- `nextId(prefix: 'R' | 'M' | 'T', existing: Array<{ id: string }>): string` — max numeric suffix + 1.
- `assignIds(body: GeneratedBody, previous?: RequirementsSet): { requirements, milestones, tasks }` — keeps ids the model echoed back when they exist in `previous`; assigns fresh ids otherwise; sets `included: true` for new items and copies `included` from `previous` for kept ones; drops task links to unknown ids and records a warning per drop.
- `mergeRefinement(previous: RequirementsSet, body: GeneratedBody, selection?: string[]): { set: RequirementsSet; warnings: string[] }` — with a selection, items outside the selection are taken verbatim from `previous` (the model's versions of them are ignored); with no selection, the whole body applies. Meta fields (`brdSlug`, `brdHash`, `generatedAt`) are preserved; `status` becomes `draft`.
- `brdHash(markdown: string): string` — sha256 hex (also exported from main for file access).
- `diffSets(a, b): { added: number; changed: number; removed: number }` per section, for the proposal panel.

## Runner (`src/main/ai/runners/requirements-generator.ts`)

```ts
interface RequirementsRunConfig {
  projectDir: string;
  mode: 'generate' | 'refine';
  brdMarkdown: string;
  previous?: RequirementsSet;   // refine
  feedback?: string;            // refine
  selection?: string[];         // refine, targeted
  modelShorthand?: string; thinkingLevel?: ThinkingLevel; abortSignal?: AbortSignal;
}
type RequirementsRunEvent =
  | { type: 'progress'; phase: 'started' | 'parsing' | 'repairing' }
  | { type: 'done'; body: GeneratedBody }
  | { type: 'error'; error: string };
runRequirementsGenerator(config, onEvent): Promise<void>
```

- Prompt: `prompts/requirements_generator.md` plus a `## BRD` block and the 2a project context; refine mode adds `## CURRENT SET` (JSON), `## FEEDBACK`, and, when targeted, `## SELECTION` with the rule that only listed IDs may change and all other items must be echoed unchanged with their IDs.
- Model call: `createSimpleClient` (feature `roadmap`) then `generateText` with `output: Output.object({ schema: GeneratedBodySchema })`. If the SDK output is absent or invalid, `parseLLMJson(text, GeneratedBodySchema)`; if still null, one retry whose prompt appends `buildValidationRetryPrompt(...)` with the Zod errors; then `error`.
- Emits `progress` at start, before parsing, and before the retry; `done` with the raw body. Post-processing (`assignIds` / `mergeRefinement`) happens in the handler so it stays pure and testable.
- Never writes files.

Prompt rules: acceptance criteria are testable single statements; tasks are single coherent changes implementable and verifiable on their own and each covers at least one requirement; every included requirement is covered; milestones are delivery-ordered with no dates, durations, sprint counts, or estimates; `needsDesign` is true for anything with new user-facing screens or flows; task `category` from the fixed list; output JSON only.

## Main process

### `src/main/brd/requirements-files.ts`

`requirementsPath(projectDir, slug)`, `readRequirements(projectDir, slug): Promise<RequirementsSet | null>`, `writeRequirements(projectDir, slug, set)`, `brdHash(markdown)`. Reuses `brdPath`-style containment from 2a.

### IPC (`src/main/ipc-handlers/requirements-handlers.ts`)

| Channel | Args | Returns |
|---|---|---|
| `requirements:read` | projectId, slug | `IPCResult<{ set: RequirementsSet \| null; currentBrdHash: string }>` |
| `requirements:write` | projectId, slug, set | `IPCResult<RequirementsSet>` — forces `status: 'draft'`, strips `approvedAt` |
| `requirements:approve` | projectId, slug, set | `IPCResult<RequirementsSet>` — refuses with the warnings if `validateRequirementsSet` is non-empty; else writes `status: 'approved'`, `approvedAt` |
| `requirements:generate` | projectId, `{ slug, mode, feedback?, selection? }` | `IPCResult<{ runId }>` — reads BRD; refuses when `checkBrdStructure` is not ok (error lists missing sections); refine requires an existing set |
| `requirements:cancel` | runId | `IPCResult` |

Events: `requirements:progress` `{ runId, phase }`, `requirements:done` `{ runId, set, changeSummary?, warnings }` (already post-processed: `assignIds` for generate with `brdSlug/brdHash/generatedAt/status:'draft'`; `mergeRefinement` for refine), `requirements:error` `{ runId, error }`. One run per BRD slug at a time.

Preload: `src/preload/api/modules/requirements-api.ts` (`requirementsRead/Write/Approve/Generate/Cancel`, `onRequirementsProgress/Done/Error`), composed into the agent API, declared on `ElectronAPI`, stubbed in the browser mock.

## Renderer

- `BrdEditor` gains a tab strip: **Document** (existing) and **Requirements**.
- `components/requirements/set/RequirementsTab.tsx` with states: none (Generate button; gate message when the BRD structure check fails), running (phase + Cancel), set (editor below).
- `RequirementsSetEditor.tsx`: sections Requirements, Milestones, Tasks; item cards as described; sticky footer with warnings, Save, Approve (disabled when dirty or warnings), status badge, staleness banner (current BRD hash ≠ set hash) with Regenerate (whole-set refine seeded with the set and feedback "The BRD changed; update the set to match it").
- `RequirementsAssist.tsx`: feedback textarea, Refine selected / Refine set, progress + Cancel, proposal panel with change summary and per-section added/changed/removed counts, Accept / Discard.
- Store `stores/requirements-store.ts`: `set`, `savedSet`, `isDirty`, `selection: Set<string>`, `warnings` (recomputed on edit), `currentBrdHash`, `run: { status: 'idle' | 'running' | 'proposal'; runId?; phase?; proposal?: { set; changeSummary?; warnings } ; error? }`, actions `load`, `edit(updater)`, `toggleInclude`, `toggleSelect`, `moveMilestone`, `save`, `approve`, `generate`, `refine`, `cancel`, `accept`, `discard`, `reset`; `setupRequirementsListeners()`.
- Unsaved-changes guard: switching BRD with a dirty set uses the 2a dialog (the BRD store's guard is extended to consult the requirements store).
- i18n: keys under the existing `requirements` namespace (`set.*`), both locales.

## Error handling

| Condition | Behavior |
|---|---|
| BRD fails structure check | Generate refused; tab shows the missing sections |
| No set exists and mode is refine | IPC error |
| Run already active for the slug | IPC error shown in the tab |
| Model output unparsable after retry | `requirements:error`; tab shows it; previous set untouched |
| Integrity warnings present | Approve disabled in UI and refused by the handler |
| BRD hash changed | Staleness banner; Regenerate offered; nothing automatic |
| Save/approve failure | Inline error; set stays dirty |
| Cancel | Abort signal; `requirements:error` with "cancelled"; tab returns to the previous state |

## Testing

- `shared/brd/requirements`: schema accepts/rejects fixtures; `validateRequirementsSet` covers every warning rule; `nextId`; `assignIds` new vs echoed ids, included copying, unknown-link drops; `mergeRefinement` targeted (outside items verbatim) and whole-set; `diffSets`.
- `main/brd/requirements-files`: round trip, null when missing, containment, hash stability.
- runner: prompt assembly for generate, refine, and targeted refine; `Output.object` success; fallback to `parseLLMJson`; retry on invalid; abort → error.
- handlers: gate on structure check, refine without set, concurrent run, approve refused with warnings, write forces draft, event forwarding with post-processing.
- store: edit → warnings, toggles, move milestone, save/approve gating, generate → proposal → accept/discard, staleness.
- components: three tab states, warnings block Approve, Refine button label switches with selection, proposal counts render.
- Manual: generate from "Customer onboarding", exclude one task (warning appears if it was a requirement's only task), edit a requirement, select it and refine with feedback, accept, save, approve, edit again → status draft.
