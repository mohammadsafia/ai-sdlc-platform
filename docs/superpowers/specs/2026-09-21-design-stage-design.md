# Design Stage (4) — Design

**Date:** 2026-09-21
**Status:** Approved

Sub-project 4 of the company SDLC platform roadmap. Follows [Bitbucket integration (3b)](2026-09-21-bitbucket-integration-design.md). Followed by sub-project 5 (QA stage).

## 1. Goal and scope

Requirements generation (2b) flags each requirement with `needsDesign` when it introduces or changes a user-facing screen or flow, but nothing consumes the flag. This sub-project adds the design stage:

1. **AI design briefs**, one Markdown file per `needsDesign` requirement, drafted by an agent and reviewed by a designer in a new Design view.
2. **Approval** as an explicit status. Only approved briefs reach the build.
3. **Prompt injection**: approved briefs are appended to the spec, planner, coder, and QA reviewer prompts of every task that covers the requirement, at build time.
4. **Release warning**: releasing a milestone lists its `needsDesign` requirements that have no approved brief. Release is not blocked.

Decisions taken with the user:

- Storage: Markdown files in `docs/design/`, mirrored on the BRD workspace (Approach A). Not inside the requirements set, not a pipeline phase.
- Granularity: one brief per `needsDesign` requirement, grouped by BRD.
- Gate: warn, do not block.
- Injection at build time, not a snapshot at release time, so briefs approved after release still reach the build.
- A separate sidebar view "Design", not a tab inside Requirements.

Out of scope: Figma links, image or mockup generation, review comments, per-screen files, design-system enforcement beyond project skills, briefs for requirements without `needsDesign` (a designer can still create one manually through the view; the list shows only `needsDesign` requirements).

## 2. Files, template, and data model

### 2.1 Files

`docs/design/<brd-slug>/<requirement-id>.md`, for example `docs/design/todo-app/R3.md`. Frontmatter:

```yaml
---
brd: todo-app
requirement: R3
title: Filter todos by status
status: draft          # draft | approved
updated: 2026-09-21
---
```

Nothing is written until a designer creates or drafts a brief. `requirement-id` is validated against `^R\d+$` and `brd-slug` against the BRD slug rule; paths are containment-checked under `docs/design` like `brd-files.ts` does for `docs/brd`.

### 2.2 Template

`templates/design-brief-template.md`, shipped with the app next to the BRD template and loaded through the same `resolveTemplatesDir()`:

```markdown
---
title: {{title}}
brd: {{brd}}
requirement: {{requirement}}
status: draft
updated: {{updated}}
---
# {{title}}

## Summary

## User flows

## Screens

### <Screen name>
Layout:
States: empty, loading, error, success
Interactions:

## Components

## Copy

## Accessibility

## Open questions
```

Required level-2 sections: Summary, User flows, Screens, Components. Optional: Copy, Accessibility, Open questions. The structure check (`src/shared/design/structure.ts`, same shape as `shared/brd/structure.ts`) reports each section as filled, empty, or missing.

### 2.3 Lifecycle

`none` (no file) → `draft` → `approved`, with explicit Approve and Unapprove actions that rewrite only the `status` frontmatter field and bump `updated`. Saving content never changes the status. AI revise on an approved brief keeps it approved until the designer unapproves. No "edited after approval" tracking (YAGNI).

### 2.4 Data model

`src/shared/types/design.ts`:

```ts
export type DesignBriefStatus = 'draft' | 'approved';
export interface DesignBriefSummary {
  brdSlug: string;
  requirementId: string;
  title: string;
  status: DesignBriefStatus;
  modifiedAt: string;
  /** Present when the frontmatter is unreadable; the brief still lists. */
  warning?: string;
}
export type DesignDraftMode = 'draft' | 'revise';
export interface DesignDraftRequest { brdSlug: string; requirementId: string; mode: DesignDraftMode; notes: string }
export interface DesignDraftChunk { runId: string; text: string }
export interface DesignDraftDone { runId: string; text: string }
export interface DesignDraftError { runId: string; error: string }
```

Requirements set and task metadata are unchanged. The link from a task to its briefs is `metadata.brdSlug` + `metadata.requirementIds`, which released tasks already carry.

## 3. Main process

### 3.1 Files module

`src/main/design/design-files.ts`:

```ts
export const DESIGN_DIR = 'docs/design';
export function designBriefPath(projectDir, brdSlug, requirementId): string   // validated + contained
export async function listDesignBriefs(projectDir): Promise<DesignBriefSummary[]>
export async function readDesignBrief(projectDir, brdSlug, requirementId): Promise<{ summary; content }>
export async function writeDesignBrief(projectDir, brdSlug, requirementId, content): Promise<DesignBriefSummary>
export async function createDesignBrief(projectDir, brdSlug, requirement: { id; title }, now = new Date()): Promise<DesignBriefSummary>
export async function setDesignBriefStatus(projectDir, brdSlug, requirementId, status): Promise<DesignBriefSummary>
export async function approvedBriefs(projectDir, brdSlug, requirementIds: string[]): Promise<Array<{ requirementId; title; body }>>
```

`listDesignBriefs` walks `docs/design/*/R*.md`; unreadable frontmatter yields a summary with `warning` and `status: 'draft'`. `createDesignBrief` refuses when the file exists. `setDesignBriefStatus` replaces the `status:` line and the `updated:` line inside the frontmatter and leaves the body byte-identical. `approvedBriefs` returns bodies (frontmatter stripped) of approved briefs only, in `requirementIds` order.

### 3.2 AI writer

`src/main/ai/runners/design-writer.ts`, prompt `apps/desktop/prompts/design_writer.md`, same streaming contract as `brd-writer.ts` (`text-delta`, `done`, `error`; abort signal; `modelShorthand` from the `roadmap` feature settings like the BRD writer).

Config: `{ projectDir, mode, notes, brdSlug, requirement: { id, title, description, acceptanceCriteria, area }, siblingTitles: string[], brdBody: string, existing?: string, modelShorthand?, thinkingLevel?, abortSignal? }`.

Prompt rules: follow the template exactly (same frontmatter fields with the given title, brd, requirement, `status: draft`, `updated` as given; same level-2 order); every screen lists the four states; mark guesses "(assumption)"; do not invent requirements or acceptance criteria; stay neutral about colors, fonts, and spacing (the project's design system is applied by the coder through project skills); no dates or estimates; in REVISE mode apply the notes and return the full document. Like the BRD writer, this standalone runner gets no project-skills injection; the skills spec lists skills for standalone runners as a later change.

### 3.3 IPC

Channels (`IPC_CHANNELS`): `DESIGN_LIST 'design:list'`, `DESIGN_READ 'design:read'`, `DESIGN_WRITE 'design:write'`, `DESIGN_CREATE 'design:create'`, `DESIGN_SET_STATUS 'design:setStatus'`, `DESIGN_DRAFT 'design:draft'`, `DESIGN_DRAFT_CANCEL 'design:draft-cancel'`, events `DESIGN_DRAFT_CHUNK`, `DESIGN_DRAFT_DONE`, `DESIGN_DRAFT_ERROR`.

Handler module `src/main/ipc-handlers/design-handlers.ts` (`registerDesignHandlers(getMainWindow)`), mirroring `brd-handlers.ts`: `withProject`, one active draft per project, deferred start past the invoke reply, cancel by runId. `design:draft` loads the BRD body with `readBrd`, the requirement from `readRequirements(project.path, brdSlug)`, and the existing brief in revise mode; it fails with `Requirement R9 not found in todo-app` when the id is missing.

Preload `design-api.ts` (`designList`, `designRead`, `designWrite`, `designCreate`, `designSetStatus`, `designDraft`, `designDraftCancel`, `onDesignDraftChunk/Done/Error`), `ElectronAPI` additions, browser-mock stubs, registration in `ipc-handlers/index.ts`.

### 3.4 Prompt injection

`src/main/ai/agent/design-prompt.ts`:

```ts
export const DESIGN_AGENT_TYPES = new Set(['spec_gatherer', 'spec_researcher', 'spec_writer', 'planner', 'coder', 'qa_reviewer']);
export const DESIGN_SECTION_CAP = 40 * 1024;
export async function buildDesignSectionForAgent(projectDir: string, specDir: string, agentType: string): Promise<string>
```

Reads `<specDir>/task_metadata.json`; returns `''` unless the agent type is in the set and the metadata has `brdSlug` and a non-empty `requirementIds`. Loads `approvedBriefs(...)`, renders:

```
# Approved design briefs

These briefs were approved by the design team for the requirements this task covers. Follow them for screens, flows, states, components, and copy. Where the code cannot match a brief, say so in your output instead of inventing a different design.

## R3: Filter todos by status
<body>
```

Bodies are appended in order until the cap; the remainder is replaced by `(N more briefs omitted: <ids>)`. Any read error yields `''` and a log line; injection never fails a run.

`PromptContext` in `src/main/ai/prompts/prompt-loader.ts` gains `designSection?: string`, and `injectContext` appends it as its own section right after the skills section. `worker.ts` `assemblePrompt` calls `buildDesignSectionForAgent(session.projectDir, session.specDir, effectiveAgentType)` after the skills section and passes the result; `postLog` reports the injected size.

### 3.5 Release warning

In the release handler, after tasks are created: `const missing = needsDesignWithoutApprovedBrief(set, milestoneId, summaries)` (pure helper in `src/shared/design/release.ts`, given the milestone's included tasks' requirement ids, the set's requirements, and the brief summaries) → warning `No approved design brief for R3, R5`. Added to the existing `warnings` array the Requirements tab already renders.

### 3.6 Commit

`brd-git.ts` pathspecs become `['docs/brd', 'docs/design']` for status, add, and commit. `defaultCommitMessage` uses `docs(brd)` when only BRD files changed, `docs(design)` when only design files changed, and `docs` when mixed; slugs for design files are `<brd-slug>/<R-id>`.

## 4. Renderer

### 4.1 Design view

Sidebar item `design` (label `navigation:items.design`, icon `PenTool`, shortcut `E`, always shown, after Requirements). `App.tsx` renders `<DesignView projectId>` for `activeView === 'design'`.

Layout `grid-cols-[300px_1fr]`:

- Left (`DesignBriefList`): BRDs that have a requirements set, each expandable to its `needsDesign` requirements as rows `R3 · Filter todos by status` with a status chip: `none` (outline), `draft` (secondary), `approved` (success). Sets are read through the existing `requirementsRead` per BRD when the view loads.
- Right, no brief yet (`DesignBriefEmpty`): requirement title, description, acceptance criteria; a notes textarea; buttons "Create from template" and "Draft with AI". Drafting streams into a proposal panel with Accept (writes the file as draft) and Discard.
- Right, brief exists (`DesignBriefEditor`): Markdown and Preview tabs (`react-markdown` + `remark-gfm`), the structure checklist, Save, Approve/Unapprove, and `DesignAssistPanel` with a notes field and "Revise with AI" streaming a proposal to accept into the editor or discard. Unsaved-changes guard on selection change (same AlertDialog pattern as Requirements).

### 4.2 Store

`src/renderer/stores/design-store.ts` (`useDesignStore`): `briefs`, `requirementsBySlug: Record<slug, { title; requirements: Requirement[] }>`, `selected: { brdSlug; requirementId } | null`, `content`, `savedContent`, `structure`, `draft` (idle/streaming/proposal like the BRD store), `isLoading`, `isSaving`, `error`, `pendingOpen`. Actions: `isDirty`, `reset`, `requestOpen(brdSlug, requirementId)`, `load(projectId)`, `select(projectId, brdSlug, requirementId, { force })`, `setContent`, `save`, `create`, `setStatus`, `startDraft(mode, notes)`, `cancelDraft`, `acceptDraft` (in the no-brief case, accept writes the file through `designWrite` after `designCreate`, then selects it), `discardDraft`. `setupDesignListeners()` wires the three events. After save, create, or status change, `useBrdStore.getState().refreshChanges(projectId)` runs so the Commit badge updates.

### 4.3 Cross-links

- Navigation: `App.tsx` owns `activeView`. It provides `DesignNavigationContext` (`src/renderer/contexts/DesignNavigationContext.tsx`, value `(brdSlug, requirementId) => void`) that calls `useDesignStore.getState().requestOpen(brdSlug, requirementId)`, closes the task detail if open, and sets the view to `design`. Chips read it with `useDesignNavigation()`; outside the provider (tests) the chip renders without a click action.
- Requirements tab: each `needsDesign` requirement row shows `DesignStatusChip` (`none/draft/approved`) using that context.
- Task detail `TaskRequirements`: the same chip next to each covered requirement when `needsDesign`.
- Brief summaries for the chips come from `useDesignStore().briefs`, loaded lazily (`load` is idempotent per project).

### 4.4 Commit dialog

Unchanged UI; it lists design files because the pathspec widened. The BRD list button badge counts both.

## 5. i18n

Namespace `design` (`en`, `fr`): `view.title`, `view.subtitle`, `list.empty`, `list.noSets`, `status.{none,draft,approved}`, `empty.{createFromTemplate,draftWithAi,notes,notesPlaceholder}`, `editor.{save,saving,saved,unsaved,approve,unapprove,markdown,preview,loadError,saveError}`, `assist.{title,notes,revise,streaming,accept,discard,cancel,error}`, `structure.{title,filled,empty,missing,allFilled}`, `sections.{summary,userFlows,screens,components,copy,accessibility,openQuestions}`, `unsavedDialog.{title,description,cancel,discard}`. `navigation.items.design`. `requirements.release.designWarning` is not needed because the warning text comes from the handler; add `requirements.set.designChip` for the chip label prefix.

## 6. Testing

Unit: `design-files` (list, read, write containment, create refuses existing, status rewrite keeps body identical, `approvedBriefs` order and filtering), `shared/design/structure`, `shared/design/release` helper, `design-writer` prompt builders (draft vs revise, template inclusion, requirement block), `design-prompt` (no metadata → '', unlinked task → '', agent type filter, only approved, cap and omission note, read error → ''), `brd-git` pathspec and `defaultCommitMessage` variants.

Handlers: every `design:*` channel, draft run forwarding events with the runId, cancel, missing requirement error.

Renderer: `design-store` (load, select guard, save, setStatus, draft accept in both cases, listeners), `DesignView` (list chips, create from template, draft proposal accept, approve toggle, unsaved guard), `DesignStatusChip` in the Requirements tab and task detail (navigation call), Commit dialog listing design files.

Manual check (todo project): open Design, draft a brief for a `needsDesign` requirement with AI, accept, approve; confirm `docs/design/todo-app/<R>.md` with `status: approved`; release milestone 2 and confirm the warning names only unapproved requirements; start a released task and confirm the run log shows the design section injected for spec and coder phases; Commit dialog lists both BRD and design files and commits them.

## 7. File map

New: `templates/design-brief-template.md`, `prompts/design_writer.md`, `src/shared/types/design.ts`, `src/shared/design/{structure,release}.ts`, `src/main/design/design-files.ts`, `src/main/ai/runners/design-writer.ts`, `src/main/ai/agent/design-prompt.ts`, `src/main/ipc-handlers/design-handlers.ts`, `src/preload/api/modules/design-api.ts`, `src/renderer/contexts/DesignNavigationContext.tsx`, `src/renderer/stores/design-store.ts`, `src/renderer/components/design/{DesignView,DesignBriefList,DesignBriefEmpty,DesignBriefEditor,DesignAssistPanel,DesignStatusChip}.tsx`, `src/shared/i18n/locales/{en,fr}/design.json`.

Modified: `src/shared/constants/ipc.ts`, `src/shared/types/ipc.ts`, `src/preload/api/agent-api.ts`, `src/renderer/lib/browser-mock.ts`, `src/main/ipc-handlers/index.ts`, `src/main/ai/agent/worker.ts`, `src/main/ai/prompts/prompt-loader.ts`, `src/main/brd/brd-git.ts`, `src/main/ipc-handlers/requirements-handlers.ts`, `src/renderer/components/Sidebar.tsx`, `src/renderer/App.tsx`, `src/renderer/components/requirements/set/RequirementsSetEditor.tsx`, `src/renderer/components/requirements/BrdCommitDialog.tsx`, `src/renderer/components/task-detail/TaskRequirements.tsx`, `src/shared/i18n/index.ts`, `locales/{en,fr}/{navigation,requirements}.json`.
