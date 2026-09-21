# Milestone Release and Traceability — Design

Date: 2026-09-21
Status: Approved design, pending implementation plan
Sub-project 2c of the company SDLC platform roadmap. Follows [requirements generation (2b)](2026-09-20-requirements-generation-design.md). Followed by sub-project 3 (Jira/Bitbucket).

## Goal

Turn an approved requirements set into real work, one milestone at a time. Releasing a milestone creates one Kanban task per included proposed task, each carrying links back to its requirements, milestone, and BRD. From then on the Requirements tab shows what was released and how far each task and requirement has progressed, and a task shows where it came from.

## Non-goals (this version)

- Syncing tasks to Jira, Bitbucket, or any external tracker (sub-project 3).
- Starting, queueing, or merging tasks automatically; released tasks land in Backlog and the PO starts them from the board.
- Rewriting a Kanban task when the set changes after release; released items are locked instead.
- AI involvement of any kind; task content is assembled deterministically.
- Releasing milestones out of order.

## Definitions

- **Release**: the act of creating Kanban tasks for one milestone of an approved set.
- **Release entry**: the record of a release stored in the set file, keyed by milestone id.
- **Released**: a milestone with a release entry, or a task or requirement covered by one.
- **Locked**: a released item; read-only in the set editor and untouchable by refinement.
- **Next milestone**: the lowest-`order` included milestone without a release entry.
- **Spec id**: the Kanban task's directory name under `.auto-claude/specs/`, e.g. `007-build-signup-flow`; it doubles as the task id.

## File

Same file as 2b: `<project>/docs/brd/<slug>.requirements.json`. Kanban tasks live in `.auto-claude/specs/`, which is gitignored and therefore per machine. The release entry is committed with the set, so every machine sees that a milestone was released and which spec ids it produced; only the machine holding those specs shows live Kanban status.

## Schema changes (`src/shared/brd/requirements.ts`)

`RequirementsSet` stays `version: 1` and gains one optional field. Existing files load unchanged.

```ts
interface ReleasedTask {
  proposedTaskId: string;   // "T3"
  specId: string;           // Kanban task id / spec directory name
}

interface MilestoneRelease {
  releasedAt: string;       // ISO, time of the first successful task creation
  tasks: ReleasedTask[];    // in proposed-task order; may be partial after a failure
}

interface RequirementsSet {
  // ... 2b fields unchanged ...
  releases?: Record<string, MilestoneRelease>;  // keyed by milestone id
}
```

`TaskMetadata` (`src/shared/types/task.ts`) gains:

```ts
sourceType?: ... | 'requirements';
brdSlug?: string;
milestoneId?: string;        // "M1"
requirementIds?: string[];   // ["R1", "R4"]
proposedTaskId?: string;     // "T3"
```

Category maps one to one: `feature → feature`, `bug → bug_fix`, `refactor → refactoring`, `docs → documentation`. Acceptance criteria of the covered requirements go into the existing `acceptanceCriteria` metadata field.

### Pure helpers (shared, `src/shared/brd/release.ts`)

- `nextReleasableMilestone(set): Milestone | null` — lowest-`order` included milestone with no entry in `releases`.
- `isMilestoneComplete(set, milestoneId): boolean` — every included task of the milestone has a spec id in the entry.
- `lockedIds(set): Set<string>` — ids of released milestones, tasks with a spec id, and included requirements whose every included covering task is released.
- `requirementRollup(set, statuses: Map<specId, TaskStatus>): Record<requirementId, { released: number; done: number }>` — counts released tasks covering the requirement and how many are `done`.
- `buildReleaseTaskInput(set, task, brdTitle): { title; description; metadata }` — title is the proposed task title; description is Markdown: the task description, a `## Requirements covered` section with each requirement's id, title, description, and acceptance criteria as a checklist, and a `Source:` line naming `docs/brd/<slug>.md` and `<slug>.requirements.json`; metadata carries the link fields, `sourceType: 'requirements'`, the mapped category, and the acceptance criteria.
- `releaseGate(set, savedSet, currentBrdHash, milestoneId): string | null` — returns the first failing reason as a message key, or null: set missing, not approved, differs from saved, BRD hash mismatch, milestone not the next one, milestone already complete.

## Main process

### Task creation helper (`src/main/ipc-handlers/task/create-task.ts`)

The body of the `task:create` handler moves into `createTaskInProject(project, { title, description, metadata }): Promise<Task>`: next spec number, slugified spec id, spec directory, `implementation_plan.json`, `task_metadata.json`, `requirements.json`, image attachments, cache invalidation. The `task:create` handler and the roadmap convert-to-spec handler call it; their observable output (files and returned task) does not change.

### IPC (`src/main/ipc-handlers/requirements-handlers.ts`)

| Channel | Args | Returns |
|---|---|---|
| `requirements:release` | projectId, slug, milestoneId | `IPCResult<{ set: RequirementsSet; tasks: Task[] }>` |

Behavior, in order:

1. Take the per-slug lock shared with generation runs; refuse with "a run is in progress for this BRD" if held.
2. Read the stored set and the BRD. Evaluate `releaseGate` against the stored set (the renderer never sends a set; unsaved edits are detected because the renderer refuses to release while dirty and the handler works only from disk).
3. For each included task of the milestone that has no spec id yet, in `order`: build the input, call `createTaskInProject`, append `{ proposedTaskId, specId }` to the entry (creating it with `releasedAt` on the first success), and write the set file. A creation failure stops the loop and returns the error naming the proposed task; the entry written so far stays.
4. Return the updated set and the created tasks.

Existing channels are unchanged. `requirements:write` and `requirements:approve` preserve `releases` as sent; `mergeRefinement` copies `releases` from `previous`.

Preload: `requirementsRelease(projectId, slug, milestoneId)` on the requirements API module, `ElectronAPI`, and the browser mock.

## Renderer

- Store (`stores/requirements-store.ts`): `release(projectId, milestoneId)` calls the IPC, installs the returned set as `set` and `savedSet`, and adds the returned tasks to the task store. Derived selectors: `nextMilestone`, `lockedIds`, `rollup` (joined with the task store by spec id). `refine` and `regenerate` pass `lockedIds` as an exclusion so the merge keeps them verbatim; targeted refinement drops locked ids from the selection.
- `RequirementsSetEditor`: each milestone section header shows either a Release button (next milestone; disabled with the gate reason beside it) or a "Released <date>" badge. Locked items render read-only: inputs disabled, Included and Select checkboxes disabled, move buttons hidden. Released task rows show a status chip: the Kanban status when the spec exists on this machine, else "not on this machine". Requirement rows show "n of m tasks done" when at least one covering task is released.
- Task detail (`components/task-detail/TaskRequirements.tsx`): rendered when `metadata.brdSlug` is set. Shows the BRD title as a link that opens the Requirements view on that BRD, the milestone name, and the covered requirements with titles, read once per detail open via `requirementsRead`. Hidden without error when the BRD or set is missing.
- i18n: keys under `requirements` (`release.*`, `set.locked`, `set.rollup`, `set.statusUnavailable`) and `tasks` (`detail.requirements.*`), both locales.

## Error handling

| Condition | Behavior |
|---|---|
| Set not approved, dirty, or stale | Release button disabled with the reason; handler refuses if called anyway |
| Milestone is not the next one | Handler refuses; only the next milestone renders a Release button |
| Run in progress for the slug | Handler refuses; button disabled while the tab shows a running state |
| Task creation fails midway | Loop stops; entry keeps the created tasks; error names the failed proposed task; Release stays available and re-release skips tasks that already have a spec id |
| Set write fails after creation | Error lists the spec ids that now exist so nothing is lost silently |
| Spec missing on this machine | Status chip reads "not on this machine"; rollup counts it as released but not done |
| BRD or set missing for a task | Task detail hides the Requirements section |

## Testing

- `shared/brd/release`: next milestone with excluded and released milestones; completeness; locked ids across all three sections; rollup with done, active, and missing specs; task input content and category mapping; every gate reason.
- `task/create-task`: the extracted helper produces the same spec directory layout and task object as before; the create handler and roadmap handler tests keep passing against it.
- handlers: each gate refusal; happy path writes the entry and returns tasks; midway failure keeps a partial entry; re-release skips existing spec ids; lock contention.
- store: release installs the set and pushes tasks; locked ids are excluded from refinement and dropped from selection.
- components: Release button enablement and reason text; read-only rendering of locked items; status chips including "not on this machine"; rollup text; task detail section present, linked, and hidden when data is missing.
- Manual, on the todo project: release milestone 1, confirm the tasks in Backlog with status chips in the tab, open one task and confirm the Requirements section links back, start one task and confirm the chip and rollup update, then release milestone 2.
