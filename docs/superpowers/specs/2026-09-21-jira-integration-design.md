# Jira Integration — Design

Date: 2026-09-21
Status: Approved design, pending implementation plan
Sub-project 3a of the company SDLC platform roadmap. Follows [milestone release and traceability (2c)](2026-09-21-milestone-release-design.md). Sub-project 3b (Bitbucket: pull requests from tasks and BRD commits) follows and is specified separately.

## Goal

Connect a project to a Jira Cloud project so that released milestones appear in Jira as an Epic with one issue per task, task status changes flow to Jira, and existing Jira issues can be imported as Kanban tasks. Jira keys are visible on tasks and in the Requirements tab, and pushes are retryable without duplicates.

## Non-goals (this version)

- Jira Data Center or Server (REST v2, personal access tokens).
- OAuth 2.0 sign-in; credentials are an email and API token per project.
- Pulling status changes from Jira back into the Kanban.
- Syncing comments, attachments, assignees, sprints, or custom fields.
- Bitbucket (3b).
- Any AI involvement; every Jira operation is deterministic.

## Definitions

- **Linked task**: a Kanban task whose metadata has a `jiraKey`.
- **Pushed milestone**: a released milestone whose release record has a `jira` block with an epic key and an issue key for every released task.
- **Partially pushed**: a `jira` block exists but some released tasks have no issue key.
- **Status map**: the per-project mapping from Kanban status to a Jira status name.
- **Transition**: the Jira workflow step that moves an issue to a status; only transitions Jira offers for the issue can be posted.

## Configuration (`ProjectEnvConfig`, written to the project `.env`)

| Field | Env var | Notes |
|---|---|---|
| `jiraEnabled: boolean` | `JIRA_ENABLED` | gates the view, the release push, and the status hook |
| `jiraBaseUrl?: string` | `JIRA_BASE_URL` | e.g. `https://acme.atlassian.net`, no trailing slash |
| `jiraEmail?: string` | `JIRA_EMAIL` | Atlassian account email |
| `jiraApiToken?: string` | `JIRA_API_TOKEN` | masked in the UI like other tokens |
| `jiraProjectKey?: string` | `JIRA_PROJECT_KEY` | e.g. `ACME` |
| `jiraIssueType?: string` | `JIRA_ISSUE_TYPE` | default `Task` |
| `jiraEpicIssueType?: string` | `JIRA_EPIC_ISSUE_TYPE` | default `Epic` |
| `jiraStatusMap?: Record<TaskStatus, string \| null>` | `JIRA_STATUS_MAP` (JSON) | see defaults below; `null` means "not synced" |

Default status map: `backlog` and `queue` → `To Do`; `in_progress`, `ai_review`, `human_review` → `In Progress`; `done`, `pr_created` → `Done`; `error` → `null`.

The env writer and reader in `src/main/ipc-handlers/env-handlers.ts` gain these keys following the GitHub and Linear entries. Credentials are read per call from the project's env, never cached in renderer state beyond the settings form.

## Data model

`TaskMetadata` (`src/shared/types/task.ts`) gains:

```ts
sourceType?: ... | 'jira';
jiraKey?: string;        // "ACME-123"
jiraUrl?: string;        // browse URL
jiraEpicKey?: string;    // epic the issue belongs to (released tasks)
jiraSyncError?: string;  // last transition failure; cleared on success
jiraSyncedStatus?: string; // Jira status name last confirmed by a transition
```

`MilestoneRelease` (`src/shared/types/requirements.ts`) gains an optional `jira` block:

```ts
interface MilestoneJiraRelease {
  epicKey: string;
  issues: Record<string, string>;   // proposedTaskId → issue key
  pushedAt: string;                 // ISO of the last successful batch
}
interface MilestoneRelease {
  releasedAt: string;
  tasks: ReleasedTask[];
  jira?: MilestoneJiraRelease;
}
```

The Zod schema in `src/shared/brd/requirements.ts` accepts the block; existing files load unchanged. `mergeRefinement` carries `releases` (including `jira`) over as before.

### Pure helpers (`src/shared/jira/`)

- `adf.ts`: `markdownToAdf(markdown: string): AdfDocument` — headings (levels 1 to 3), paragraphs, bullet lists, task-list items (`- [ ]`, `- [x]`) as bullet items with the marker text, inline code and links as plain text. Everything else becomes paragraphs. No external dependency.
- `status-map.ts`: `DEFAULT_JIRA_STATUS_MAP`, `parseStatusMap(json: string | undefined): Record<TaskStatus, string | null>` (defaults for missing or invalid input), `targetStatusFor(map, status): string | null`.
- `push.ts`: `pendingPushTasks(set, milestoneId): ReleasedTask[]` (released tasks without an issue key), `isMilestonePushed(set, milestoneId): boolean`, `buildIssueFields(...)` for epic and task issues (summary, description ADF, issue type, parent).

## Jira client (`src/main/jira/client.ts`)

A thin REST v3 client constructed from `{ baseUrl, email, apiToken }`:

- `myself()`: `GET /rest/api/3/myself` → `{ accountId, displayName }`.
- `project(key)`: `GET /rest/api/3/project/{key}` → `{ id, key, name, issueTypes: [{ id, name, subtask, hierarchyLevel }] }`.
- `statuses(projectKey)`: `GET /rest/api/3/project/{key}/statuses` → deduplicated `{ id, name }[]`.
- `search({ jql, nextPageToken?, maxResults })`: `POST /rest/api/3/search/jql` → `{ issues, isLast, nextPageToken? }`, fields `summary, status, issuetype, assignee, updated`. This endpoint pages by token; there is no total count.
- `createIssue(fields)`: `POST /rest/api/3/issue` → `{ key, id }`.
- `createIssues(fields[])`: `POST /rest/api/3/issue/bulk` (≤ 50 per call) → `{ issues: [{ key }], errors }`.
- `transitions(key)`: `GET /rest/api/3/issue/{key}/transitions` → `[{ id, name, to: { name } }]`.
- `transition(key, transitionId)`: `POST /rest/api/3/issue/{key}/transitions`.
- `issue(key)`: `GET /rest/api/3/issue/{key}` with `fields=summary,status`.

Every call sets `Authorization: Basic base64(email:token)`, `Accept: application/json`, and a `User-Agent` naming Appswave. A non-2xx response throws `JiraApiError { status, message }` where `message` joins Jira's `errorMessages` and `errors` values. A 429 is retried once after `Retry-After` seconds (default 2), then thrown. Browse URLs are `${baseUrl}/browse/${key}`.

## Main process

### Handlers (`src/main/ipc-handlers/jira/`)

| Channel | Args | Returns |
|---|---|---|
| `jira:checkConnection` | projectId | `IPCResult<{ accountName: string; projectName?: string }>` — `myself`, then `project(key)` when a key is configured |
| `jira:getMetadata` | projectId | `IPCResult<{ issueTypes: string[]; statuses: string[] }>` |
| `jira:searchIssues` | projectId, `{ jql?: string; status?: string; pageToken?: string }` | `IPCResult<{ issues: JiraIssueSummary[]; nextPageToken?: string }>`; `JiraIssueSummary = { key, summary, status, issueType, assignee?, updated, url, imported: boolean }`; JQL is `project = KEY` plus the status clause plus the user's JQL joined with `AND`, ordered by `updated DESC`; `imported` is true when any task in the project has that `jiraKey` |
| `jira:importIssues` | projectId, keys: string[] | `IPCResult<{ imported: number; skipped: string[]; failed: Array<{ key: string; error: string }>; tasks: Task[] }>`; skips keys already linked; description is the issue summary as title, the issue description rendered to Markdown-ish text (ADF text nodes joined), plus a `Source:` line with the URL; metadata `{ sourceType: 'jira', jiraKey, jiraUrl, category: 'feature' }`; tasks created with `createTaskInProject` |
| `jira:pushMilestone` | projectId, slug, milestoneId | `IPCResult<{ set: RequirementsSet; warnings: string[] }>`; see below |
| `jira:retrySync` | projectId, taskId | `IPCResult<{ status: string }>`; runs the transition for the task's current status and clears or sets `jiraSyncError` |

**Push behavior** (`pushMilestone`), under the same per-slug lock as generation and release:

1. Read the set and the milestone's release entry; refuse when the milestone is not released ("Release the milestone before pushing it to Jira").
2. If the entry has no `jira.epicKey`: create the Epic (summary = milestone name, description = milestone description as ADF, issue type = `jiraEpicIssueType`), write the entry with `epicKey`, `issues: {}`, `pushedAt`.
3. For released tasks without an issue key, in `order`, in batches of up to 50: read each task's spec (`implementation_plan.json` description) to build the description ADF, create with `parent: { key: epicKey }` and issue type `jiraIssueType`; after each batch, record the returned keys under `issues`, write the set, and stamp each task's `task_metadata.json` with `jiraKey`, `jiraUrl`, `jiraEpicKey`.
4. Bulk-create partial failures (Jira returns per-issue errors) are recorded as warnings naming the proposed task; successes are still recorded.
5. Return the updated set and warnings.

**Release hook**: after the 2c release handler writes its record, if `jiraEnabled` is on it calls the push logic in-process (not through IPC) and returns `{ set, tasks, warnings }`; a push failure becomes a warning, never a release failure. The renderer shows warnings under the milestone header.

**Status hook** (`src/main/jira/status-sync.ts`): `TaskStateManager.emitStatus` also calls `scheduleJiraSync(projectId, taskId, status)`. The scheduler debounces per task (500 ms), then: read the task's metadata; return if no `jiraKey` or Jira is disabled; resolve the target status through the map; return if `null`; fetch transitions; pick the one whose `to.name` equals the target (case-insensitive); post it; write `jiraSyncedStatus` and clear `jiraSyncError`, or write `jiraSyncError` with the message ("No transition to 'Done' is available from the current status" when none matches). Failures are logged with `console.warn` and never propagate to the state machine.

### Preload and API

`src/preload/api/modules/jira-api.ts` exposes `jiraCheckConnection`, `jiraGetMetadata`, `jiraSearchIssues`, `jiraImportIssues`, `jiraPushMilestone`, `jiraRetrySync`; declared on `ElectronAPI`, composed into the agent API, stubbed in the browser mock.

## Renderer

- **Settings**: `components/project-settings/JiraIntegrationSection.tsx` inside `IntegrationSettings`, after GitLab: enable switch, base URL, email, API token (`PasswordInput`), "Test connection" with a `ConnectionStatus` badge and the account and project names, project key, issue type and epic type selects fed by `jira:getMetadata` (free-text fallback when metadata fails), and a status mapping table with one row per Kanban status and a select of project statuses plus "Not synced". Saving writes through the existing env update path.
- **Jira Issues view**: `SidebarView` gains `'jira-issues'` (label "Jira Issues", shortcut J, shown when `jiraEnabled`); `components/jira-issues/JiraIssuesView.tsx` with a status filter select, a JQL input, a search box (adds `summary ~ "..."`), a list with checkboxes and a "Load more" button while a next page token exists, an "Imported" badge on linked issues, and an Import button. Store `stores/jira/issues-store.ts`: `issues`, `nextPageToken`, `filters`, `selection`, `isLoading`, `error`, actions `load` (first page), `loadMore` (appends the next page), `toggle`, `importSelected` (adds returned tasks to the task store).
- **Requirements tab**: the milestone header (2c) gains a Jira chip: epic key link when pushed; "Partially pushed" badge plus "Push to Jira" when some tasks lack keys; "Push to Jira" alone when released but not pushed and Jira is enabled; nothing when Jira is disabled. Released task rows show the issue key as a link chip next to the status chip. The requirements store gains `pushToJira(projectId, milestoneId)` which installs the returned set and shows warnings.
- **Kanban card**: a small `ACME-123` badge when `jiraKey` is set.
- **Task detail** (`TaskMetadata` or a new `TaskJira.tsx`): key link, epic key, last synced status, `jiraSyncError` in red with a "Retry sync" button calling `jira:retrySync`.
- **i18n**: new `jira` namespace (settings, view, chips, errors) and `navigation:items.jiraIssues`, both locales.

## Error handling

| Condition | Behavior |
|---|---|
| Bad URL, email, or token | Settings test shows Jira's message and status; handlers refuse with the same message; nothing written |
| Project key not found or no permission | Test shows "Project ACME not found or not accessible"; push refused |
| Push fails on the Epic | Warning under the header; nothing recorded; retry creates the Epic |
| Epic created, issues fail midway | `epicKey` already recorded; failed tasks stay unkeyed; warning names them; retry skips keyed tasks |
| Bulk response has per-issue errors | Successes recorded, failures warned, no duplicate creation on retry |
| Transition unavailable or status unmapped | `jiraSyncError` recorded (or nothing when unmapped); Kanban unaffected; Retry in task detail |
| 429 from Jira | One retry after `Retry-After`; then the error surfaces where the call originated |
| Import: key already linked | Skipped and listed in `skipped` |
| Import: one issue fails | Counted in `failed` with the message; batch continues |
| Jira disabled later | Badges and links remain; no calls; header chips hidden |

## Testing

- `shared/jira/adf`: headings, paragraphs, bullets, checklists, fallback for unknown constructs.
- `shared/jira/status-map`: defaults, invalid JSON, `null` entries, case handling.
- `shared/jira/push`: pending tasks, pushed detection, issue field building with parent and types.
- `main/jira/client`: auth header, URL building, error message extraction, 429 retry once, bulk chunking at 50 (with `fetch` mocked).
- Handlers: connection check with and without project key; metadata; search JQL composition and `imported` flag; import skipping, failures, task creation metadata; push epic then issues with per-batch record writes, partial retry, bulk partial errors; retry sync.
- Release hook: push failure yields a warning and a successful release.
- Status sync: debounce collapses rapid changes to one transition; unmapped status posts nothing; missing transition records the error.
- Renderer: settings section (test button states, mapping table), Jira Issues view (filters, selection, import, imported badge), milestone header chip states, card badge, task detail retry.
- Manual, on the todo project against a real Jira Cloud project: connect and test; release milestone 2 and confirm the Epic and issues with the right parent; move a task and confirm the transition; import two issues and confirm the tasks and the Imported badge; set a bad mapping, move a task, confirm the recorded error and Retry.
