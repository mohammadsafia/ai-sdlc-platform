# QA Stage (5) — Design

**Date:** 2026-09-22
**Status:** Approved

Sub-project 5 of the company SDLC platform roadmap. Follows [design stage (4)](2026-09-21-design-stage-design.md). Followed by sub-project 6 (DevOps stage).

## 1. Goal and scope

Today each task ends in an AI QA loop (`qa_reviewer` then `qa_fixer`, `src/main/ai/orchestration/qa-loop.ts`) whose verdict comes from `implementation_plan.json.qa_signoff`. The reviewer sees acceptance criteria only as free text inside `spec.md`, nothing records which criteria were actually verified, and human review has no QA sign-off. This sub-project adds:

1. **Test plans**: one structured plan per BRD with test cases derived from each requirement's acceptance criteria, generated milestone by milestone by an agent, edited in a table, and approved by QA.
2. **Case-level AI results**: the QA reviewer receives the task's approved cases and reports a result per case; the loop stores them on the task.
3. **Human QA sign-off**: a panel in task review to mark each case passed, failed, or skipped with notes; stored on the task.
4. **Warning, not a gate**: Merge and Mark as Done warn when cases are unsigned.
5. **Rollup**: per-requirement case results in the Requirements tab.

Decisions taken with the user:

- One JSON plan per BRD at `docs/qa/<brd-slug>.testplan.json`, cases grouped by requirement, generated per milestone (Approach A).
- Human sign-off warns on merge and done; it never blocks.
- Placement: a "Test plan" tab in the BRD editor next to Document and Requirements.
- Injection into both `qa_reviewer` and `qa_fixer`.

Out of scope: automated execution of cases with screenshots by the reviewer, test-management integrations, a QA role concept beyond the sign-off block, locking cases of released milestones.

## 2. Data model and files

### 2.1 Types (`src/shared/types/qa.ts`)

```ts
export type TestCaseKind = 'automated' | 'manual';
export interface TestCase {
  id: string;             // "TC1"
  requirementId: string;  // "R3"
  title: string;
  preconditions?: string;
  steps: string[];
  expected: string;
  kind: TestCaseKind;
  included: boolean;
}
export type TestPlanStatus = 'draft' | 'approved';
export interface TestPlan {
  version: 1;
  brdSlug: string;
  status: TestPlanStatus;
  generatedAt: string;
  approvedAt?: string;
  cases: TestCase[];
}
export type CaseResultStatus = 'passed' | 'failed' | 'skipped';
export interface CaseResult { caseId: string; status: CaseResultStatus; note?: string }
export interface TaskQaResults { at: string; results: CaseResult[]; note?: string }
export interface TaskQa { ai?: TaskQaResults; human?: TaskQaResults }

export type TestPlanRunPhase = 'started' | 'parsing' | 'repairing';
export interface TestPlanGenerateRequest { slug: string; milestoneId: string }
export interface TestPlanProgress { runId: string; phase: TestPlanRunPhase }
export interface TestPlanDone { runId: string; plan: TestPlan; warnings: string[] }
export interface TestPlanError { runId: string; error: string }
```

`TaskMetadata` (`src/shared/types/task.ts`) gains `qa?: TaskQa`. The file is `<specDir>/task_metadata.json` (and its worktree copy), the same place `prUrl` and the Jira fields live.

### 2.2 Schema and helpers (`src/shared/qa/testplan.ts`)

- `TestPlanSchema` (Zod, strict on disk) and `GeneratedCasesSchema` for the model: `{ cases: [{ id: string | null, requirementId, title, preconditions: string | null, steps: string[], expected, kind }] }` — nullable rather than optional for OpenAI strict mode, as in `shared/brd/requirements.ts`.
- `nextCaseId(existing)` → `TC<n+1>`.
- `assignCaseIds(generated, existing)`: keeps ids the model echoed when they exist in `existing`, assigns fresh ids otherwise, sets `included: true`, drops cases whose `requirementId` is not in the allowed list (returned as warnings).
- `mergeMilestoneCases(plan, allowedRequirementIds, generated)`: removes cases whose `requirementId` is in the allowed list, appends the assigned new ones, sorts by requirement order (given) then numeric id.
- `validateTestPlan(plan, set)`: warnings for cases without steps or expected, cases whose requirement is missing from the set, and included requirements with `acceptanceCriteria` but no case.
- `casesForTask(plan, requirementIds)`: included cases of an approved plan for those requirements, in plan order.
- `mergedResults(task)`: `Map<caseId, CaseResult>` from `metadata.qa.ai` overlaid by `metadata.qa.human`.
- `qaRollup(plan, tasks: Array<{ metadata?: TaskMetadata }>)`: `Record<requirementId, { total; passed; failed }>` where each case counts once using its latest merged result across the tasks whose `requirementIds` include the requirement (a case seen in several tasks takes the first human result, else the most recent AI result by `at`); `total` counts included cases of the requirement.

### 2.3 Files (`src/main/qa/testplan-files.ts`)

`testPlanPath(projectDir, slug)` → `docs/qa/<slug>.testplan.json` after `brdPath` slug validation and the same containment check pattern as `brd-files.ts` (folder `docs/qa`). `readTestPlan` returns null when absent, throws on invalid JSON (schema message), `writeTestPlan(projectDir, slug, plan)` atomic write. Handlers force `status: 'draft'` and strip `approvedAt` on write; approve sets both.

## 3. Generation

### 3.1 Runner (`src/main/ai/runners/testplan-generator.ts`, prompt `prompts/testplan_generator.md`)

Config: `{ projectDir, brdMarkdown, requirements: Requirement[] (the milestone's included requirements), briefs: Array<{ requirementId; body }> (approved design briefs for those requirements), existingCases: TestCase[] (the plan's cases for those requirements, for regeneration), modelShorthand?, thinkingLevel?, abortSignal? }`.

Events: `progress` (`started | parsing | repairing`), `done` (`{ cases }`), `error`. Uses `generateText` with `Output.object({ schema: GeneratedCasesSchema })`, falls back to `parseLLMJson`, retries once with `buildValidationRetryPrompt('test plan', errors)` exactly like the requirements generator.

Prompt rules: at least one case per acceptance criterion and every criterion covered; a case is one scenario with concrete steps and one observable expected result; include the main negative or edge case per requirement when the criteria imply one; `kind` is `automated` when the check can run in a test runner or browser automation without a person's judgement, else `manual`; use the design brief's screens, copy, and states when present; no dates or estimates; never invent requirements; echo an existing case's `id` when you keep it, otherwise `id: null`; output JSON only.

### 3.2 Handler flow (`testplan:generate`)

`src/main/ipc-handlers/testplan-handlers.ts` (`registerTestPlanHandlers(getMainWindow)`): one active run per `projectId:slug` through the existing `tryAcquireSlugLock` from `requirements-handlers.ts` (shared with generation, release, and Jira push), so a plan cannot be generated while the set is being regenerated. Reads the BRD, the requirements set (must exist and contain the milestone), approved briefs via `approvedBriefs(project.path, slug, requirementIds)`, and the current plan. Deferred start past the invoke reply; on done: `assignCaseIds` → `mergeMilestoneCases` → `TestPlanDone { plan (status draft, generatedAt now), warnings }`. Cancel by runId.

## 4. Per-task results

### 4.1 Prompt injection (`src/main/ai/agent/qa-prompt.ts`)

`buildQaSectionForAgent(projectDir, specDir, agentType)` for `qa_reviewer` and `qa_fixer` only: reads `task_metadata.json` links (`brdSlug`, `requirementIds`), loads the plan, returns `''` unless the plan is approved and `casesForTask` is non-empty. Renders:

```
# Test cases to verify

The QA team approved these cases for the requirements this task covers. Verify each one and record the outcome in implementation_plan.json under qa_signoff.case_results as an array of { "case": "TC3", "status": "passed" | "failed" | "skipped", "note": "..." }. A failed case is an issue to report; a skipped case needs a note saying why.

## TC3 (R3): Filter shows only active todos [automated]
Preconditions: ...
Steps:
1. ...
Expected: ...
```

Cap 40 KB with an omission note, like the design section. `PromptContext` gains `qaSection?: string`, appended after the design section by `injectContext`; `assemblePrompt` in `worker.ts` builds it beside the design section.

`prompts/qa_reviewer.md` and `qa_fixer.md`: the sign-off JSON examples gain `"case_results": [ { "case": "TC1", "status": "passed", "note": "" } ]` with one sentence saying it is required whenever a "Test cases to verify" section is present. The key is `case_results`, not `test_results`, because `coerceSignoff` in `src/main/ai/schema/qa-signoff.ts` already maps `test_results` to `tests_passed`.

### 4.2 Schema and loop

`QASignoffSchema` gains `case_results: z.array(z.preprocess(coerceCaseResult, z.object({ case: z.string(), status: z.enum(['passed','failed','skipped']), note: z.string().optional() }))).optional()` where `coerceCaseResult` accepts `caseId`/`id` as aliases for `case` and normalizes `pass/ok → passed`, `fail → failed`, `skip/n/a → skipped`.

`qa-loop.ts`: after each reviewer session (`iteration` branch where `signoff` is read), `writeAiCaseResults(specDir, signoff)` maps `case_results` to `CaseResult[]` and writes `metadata.qa.ai = { at, results }` through a new `updateTaskMetadataQa(metadataPath, patch)` in `plan-file-utils.ts` (same read-merge-write pattern as `updateTaskMetadataPrUrl`), for the spec dir metadata file and the worktree copy when present. Results with unknown case ids are kept as-is (the renderer ignores ids not in the plan). Failure to write is logged, never fatal.

### 4.3 Human sign-off

IPC `qa:casesForTask(projectId, taskId)` → `{ cases: TestCase[]; ai?: TaskQaResults; human?: TaskQaResults }` (empty cases when the task has no links, no approved plan, or no matching cases). IPC `qa:signoff(projectId, taskId, results: CaseResult[], note?: string)` validates that every case id belongs to the task's cases and every status is valid, writes `metadata.qa.human = { at: now, results, note }` to the spec dir and worktree metadata, calls `projectStore.invalidateTasksCache(projectId)` so the next `getTasks` re-reads the files, and returns the refreshed task from `projectStore.getTasks(projectId)`; the renderer applies it with `useTaskStore.getState().updateTask(taskId, { metadata })`.

Renderer `QASignoffPanel` (in `task-detail/task-review/`) rendered by `TaskReview` above the feedback section when `cases.length > 0`: per case the title, kind, steps, expected, AI badge (`passed/failed/skipped/—`), a three-way toggle, and a note input; an overall note; "Sign off" (disabled until every case has a status). After signing: signed-at line and "Edit". The panel loads through `qa:casesForTask` on mount and after sign-off.

### 4.4 Warning on merge and done

`TaskDetailModal`: before `handleMerge` and before the status change to done, `unsignedCases(cases, task)` (pure helper in `src/shared/qa/testplan.ts`: included cases with no human result) is computed from the panel's loaded cases (the modal holds them in state via a callback from the panel, or reloads through `qa:casesForTask`). When non-empty, an `AlertDialog` lists the case ids and titles with "Proceed anyway" and "Cancel". Kanban drag-to-done is unchanged (out of scope).

### 4.5 Rollup

`RequirementsSetEditor` shows, next to the existing task rollup, `QA: {{passed}} of {{total}} cases passed` (plus `, {{failed}} failed` when failed > 0) using `qaRollup(plan, tasks)` where `plan` comes from the test-plan store (loaded by the BRD editor alongside the set) and `tasks` from the task store. Hidden when the plan is missing or the requirement has no cases.

## 5. Renderer

- `src/renderer/stores/testplan-store.ts` (`useTestPlanStore`): `slug`, `plan`, `savedPlan`, `warnings`, `run` (`idle | running | proposal` with `runId`, `phase`, `proposal { plan; warnings }`, `error`), `isLoading`, `isSaving`, `error`; actions `reset`, `load(projectId, slug)`, `editCase(id, patch)`, `toggleInclude(id)`, `addCase(requirementId)`, `removeCase(id)`, `save`, `approve`, `generate(projectId, milestoneId)`, `cancel`, `accept`, `discard`, `isDirty`, `canApprove`. `setupTestPlanListeners()` wires the three events. `warnings` are recomputed from `validateTestPlan(plan, set)` on every change using the requirements store's set.
- `BrdEditor`: third tab `Test plan` (`set.testPlanTab` label), loads the plan with the set. `TestPlanTab` shows: when no requirements set, a hint; a milestone select (included milestones) plus "Generate cases" (disabled while running; label "Regenerate cases" when the milestone already has cases); the running state with cancel; the proposal panel (counts of added, replaced, kept cases; Accept, Discard); the table grouped by requirement with columns id, title, kind, steps (multi-line), expected, included, and remove; "Add case" per requirement; warnings; Save and Approve footer like the Requirements tab. Cases whose requirement is missing from the set render under "Unlinked".
- `QASignoffPanel` and the merge/done `AlertDialog` as in 4.3 and 4.4.
- Rollup line in `RequirementsSetEditor` as in 4.5.

## 6. IPC summary

Channels: `TESTPLAN_READ 'testplan:read'`, `TESTPLAN_WRITE 'testplan:write'`, `TESTPLAN_APPROVE 'testplan:approve'`, `TESTPLAN_GENERATE 'testplan:generate'`, `TESTPLAN_CANCEL 'testplan:cancel'`, events `TESTPLAN_PROGRESS`, `TESTPLAN_DONE`, `TESTPLAN_ERROR`; `QA_CASES_FOR_TASK 'qa:casesForTask'`, `QA_SIGNOFF 'qa:signoff'`. Preload module `testplan-api.ts` (`testPlanRead/Write/Approve/Generate/Cancel`, `onTestPlanProgress/Done/Error`, `qaCasesForTask`, `qaSignoff`), `ElectronAPI` additions, browser-mock stubs, registration in `ipc-handlers/index.ts`.

## 7. i18n

Namespace `qa` (`en`, `fr`): `tab`, `none`, `noSet`, `milestone`, `generate`, `regenerate`, `running`, `phase.{started,parsing,repairing}`, `cancel`, `proposal.{title,added,replaced,kept,accept,discard}`, `table.{id,title,kind,steps,expected,included,remove,addCase,unlinked}`, `kind.{automated,manual}`, `status.{draft,approved}`, `save`, `saving`, `approve`, `approving`, `unsaved`, `saved`, `warnings`, `error`, `signoff.{title,ai,human,passed,failed,skipped,none,note,overallNote,signOff,signedAt,edit,submitting}`, `warn.{title,description,proceed,cancel}`, `rollup`. `requirements.set.testPlanTab`.

## 8. Testing

Unit: `shared/qa/testplan` (schema, `assignCaseIds`, `mergeMilestoneCases`, `validateTestPlan`, `casesForTask`, `mergedResults`, `qaRollup`, `unsignedCases`), `testplan-files`, `testplan-generator` prompts and parsing (direct output, text fallback, retry, error), `qa-prompt` (agent filter, draft plan ignored, cap), `qa-signoff` schema `case_results` coercion, `plan-file-utils.updateTaskMetadataQa`, `qa-loop` writes `qa.ai` after a reviewer session (existing loop tests extended with a spec dir fixture).

Handlers: every `testplan:*` channel including generate with the lock, cancel, missing milestone; `qa:casesForTask` for linked and unlinked tasks; `qa:signoff` validation and write.

Renderer: `testplan-store` (load, edit, generate proposal accept and discard, save forces draft, approve), `TestPlanTab` (milestone picker, generate, table edits, footer), `QASignoffPanel` (toggles, disabled sign-off until complete, submit), `TaskDetailModal` merge warning dialog, rollup line in the editor.

Manual check (todo project): open the Todo app BRD, Test plan tab, generate cases for milestone 2, edit one, approve; open a milestone 2 task in Human Review and sign off two cases; Requirements tab shows the rollup; Merge on a task with unsigned cases shows the warning; `docs/qa/todo-app.testplan.json` and the task's `task_metadata.json` hold the data.

## 9. File map

New: `src/shared/types/qa.ts`, `src/shared/qa/testplan.ts`, `src/main/qa/testplan-files.ts`, `src/main/ai/runners/testplan-generator.ts`, `prompts/testplan_generator.md`, `src/main/ai/agent/qa-prompt.ts`, `src/main/ipc-handlers/testplan-handlers.ts`, `src/preload/api/modules/testplan-api.ts`, `src/renderer/stores/testplan-store.ts`, `src/renderer/components/requirements/testplan/{TestPlanTab,TestPlanTable,TestPlanProposal}.tsx`, `src/renderer/components/task-detail/task-review/QASignoffPanel.tsx`, `src/shared/i18n/locales/{en,fr}/qa.json`.

Modified: `src/shared/types/task.ts`, `src/shared/constants/ipc.ts`, `src/shared/types/ipc.ts`, `src/preload/api/agent-api.ts`, `src/renderer/lib/browser-mock.ts`, `src/main/ipc-handlers/index.ts`, `src/main/ai/schema/qa-signoff.ts`, `src/main/ai/orchestration/qa-loop.ts`, `src/main/ipc-handlers/task/plan-file-utils.ts`, `src/main/ai/prompts/{types,prompt-loader}.ts`, `src/main/ai/agent/worker.ts`, `prompts/qa_reviewer.md`, `prompts/qa_fixer.md`, `src/renderer/components/requirements/BrdEditor.tsx`, `src/renderer/components/requirements/set/RequirementsSetEditor.tsx`, `src/renderer/components/task-detail/{TaskReview,TaskDetailModal}.tsx`, `src/shared/i18n/index.ts`, `locales/{en,fr}/requirements.json`.
