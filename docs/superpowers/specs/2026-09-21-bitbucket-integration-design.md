# Bitbucket Integration (3b) — Design

**Date:** 2026-09-21
**Status:** Approved

Sub-project 3b of the company SDLC platform roadmap. Follows [Jira integration (3a)](2026-09-21-jira-integration-design.md). Followed by sub-project 4 (design stage).

## 1. Goal and scope

Appswave already opens GitHub pull requests for finished tasks through the `gh` CLI, and writes BRDs to `docs/brd/` without ever committing them. This sub-project adds:

1. **Pull requests on Bitbucket Cloud** from finished tasks: the existing "Create PR" action pushes the worktree branch and opens a Bitbucket pull request with the AI-written body, storing the PR URL on the task.
2. **BRD commits** from the Requirements view: a Commit button stages `docs/brd`, commits on the current branch, and pushes to origin.

Decisions taken with the user:

- Bitbucket **Cloud** only (`bitbucket.org`), authenticated with an Atlassian **API token** (email + token, basic auth). Data Center is out of scope.
- "Bitbucket PRs" means **creating** PRs from tasks. No PR list or AI review view in this sub-project.
- BRD commits go to the **current branch and push to origin**. No document branches or PRs.
- Approach A: a dedicated `src/main/bitbucket/` module mirroring `src/main/jira/`, plus a provider split in the task PR handler. No generic code-host abstraction.

Out of scope: Bitbucket PR list/review, Bitbucket issues, GitLab task PRs, Bitbucket Data Center, AI-suggested BRD commit messages.

## 2. Configuration, detection, and data

### 2.1 Project env keys

Stored in the project's `.auto-claude/.env` like the Jira keys, through `src/main/bitbucket/env.ts` (`BITBUCKET_ENV_KEYS`, `readBitbucketEnv(vars)`, `bitbucketEnvUpdates(config)`), wired into `env-handlers.ts` the same way as `jira/env.ts`:

| Key | Meaning |
|---|---|
| `BITBUCKET_ENABLED` | `true`/`false`. Enabled when a token is present and this is not `false`. |
| `BITBUCKET_EMAIL` | Atlassian account email. |
| `BITBUCKET_API_TOKEN` | Atlassian API token scoped to Bitbucket. |
| `BITBUCKET_WORKSPACE` | Workspace id, e.g. `meccasoft`. |
| `BITBUCKET_REPO_SLUG` | Repository slug, e.g. `todo`. |

`ProjectEnvConfig` gains `bitbucketEnabled`, `bitbucketEmail`, `bitbucketApiToken`, `bitbucketWorkspace`, `bitbucketRepoSlug`. The settings form prefills the email from `jiraEmail` when the Bitbucket email is blank.

`getBitbucketConfig(project)` in `src/main/bitbucket/config.ts` returns `{ email, apiToken, workspace, repoSlug } | null` (null when disabled or token missing). Workspace and slug may be blank; callers fall back to detection (2.2).

### 2.2 Repository detection

`src/shared/bitbucket/remote.ts` exports the pure `parseBitbucketRemote(url: string): { workspace: string; repoSlug: string } | null`, accepting:

- `git@bitbucket.org:ws/repo.git`
- `ssh://git@bitbucket.org/ws/repo.git`
- `https://bitbucket.org/ws/repo` and `https://user@bitbucket.org/ws/repo.git`

Anything not on `bitbucket.org` returns null. `src/main/bitbucket/remote.ts` exports `detectBitbucketRepo(projectPath)`, which runs `git remote get-url origin` with `getIsolatedGitEnv()` and returns `{ ...parsed, remoteUrl } | null`. It is also exposed as `bitbucket:detectRepo` for the settings "Detect from remote" button.

### 2.3 Provider choice for task PRs

The task PR handler decides by the origin host, after validating options:

- origin is `bitbucket.org` → Bitbucket path. Requires `getBitbucketConfig(project)`; otherwise it returns `Bitbucket is not configured for this project` before pushing anything.
- any other host → the existing GitHub (`gh`) path, unchanged.

### 2.4 Data

The task's existing `metadata.prUrl` holds the Bitbucket PR link, written by the same `updateTaskStatusAfterPRCreation` as GitHub, so Kanban, task detail, and the batch "Create PRs" action need no changes. BRD commits leave no app-side record; git history is the record.

## 3. Bitbucket client and PR flow

### 3.1 Client

`src/main/bitbucket/client.ts`:

```ts
export class BitbucketApiError extends Error { constructor(public status: number, message: string) }
export function extractBitbucketError(status: number, body: unknown): string
// body.error.message, plus "field: detail" for body.error.fields, deduped; else "Bitbucket request failed with HTTP <status>"

export class BitbucketClient {
  constructor(cfg: { email: string; apiToken: string }, fetchImpl = globalThis.fetch)
  user(): Promise<{ displayName: string }>                                   // GET /2.0/user
  repository(ws, slug): Promise<{ name: string; fullName: string; mainBranch?: string }> // GET /2.0/repositories/{ws}/{slug}
  findOpenPullRequest(ws, slug, sourceBranch): Promise<{ id: number; url: string } | null>
  // GET /2.0/repositories/{ws}/{slug}/pullrequests?q=source.branch.name="<b>" AND state="OPEN"
  createPullRequest(ws, slug, input: { title; description; sourceBranch; destinationBranch }): Promise<{ id: number; url: string }>
  // POST /2.0/repositories/{ws}/{slug}/pullrequests with close_source_branch: false; url = links.html.href
}
```

Base URL `https://api.bitbucket.org/2.0`. Headers: `Authorization: Basic base64(email:token)`, `Accept: application/json`, `Accept-Language: en`, `Content-Type: application/json` on writes. One retry on 429 honoring `Retry-After` (default 2 s). Non-2xx throws `BitbucketApiError`.

### 3.2 Shared PR helpers

`pushBranch`, `gatherPRContext`, `generatePRBody`, and `extractSpecSummary` move from `src/main/ai/runners/github/pr-creator.ts` to `src/main/ai/runners/pr-common.ts` and are exported. `createPR` (GitHub) keeps its behavior and imports them. `CreatePRResult` moves to `pr-common.ts` and is re-exported from `pr-creator.ts`.

`pushBranch(worktreePath, gitPath, branchName, auth?: PushAuth)` gains the retry described in 3.3, where `export interface PushAuth { remoteUrl: string; header: string }` lives in `pr-common.ts` and `header` is the full `Authorization: Basic <base64 email:token>` value.

### 3.3 Push credentials

The branch is pushed with the user's ambient git credentials first. If the push fails with an authentication error (`Authentication failed`, `could not read Username`, `403`, `401`, `Permission denied` on an HTTPS remote) and the origin URL is HTTPS, the push is retried once with `-c http.extraheader=Authorization: Basic <base64 email:token>`. SSH remotes never retry; the original error is returned. The header is passed as a git config argument, never through the shell, and never logged.

### 3.4 Bitbucket PR creation

`src/main/bitbucket/create-pr.ts`:

```ts
export interface CreateBitbucketPRConfig {
  projectDir; worktreePath; specId; branchName; baseBranch; title;
  gitPath; config: BitbucketConfig; workspace: string; repoSlug: string;
  modelShorthand?; thinkingLevel?;
}
export async function createBitbucketPR(cfg): Promise<CreatePRResult>
```

Steps: push (3.3) → gather context → AI body or spec summary → `findOpenPullRequest` (if found: `{ success: true, prUrl, alreadyExists: true }`) → `createPullRequest` with `destinationBranch` stripped of any `origin/` prefix → `{ success: true, prUrl }`. Errors return `{ success: false, error }` with the client's message. Draft PRs are not supported on Bitbucket; the `draft` option is ignored.

### 3.5 Task handler change

In `TASK_WORKTREE_CREATE_PR` (`worktree-handlers.ts`), after computing `baseBranch`, `branchName`, `prTitle`:

1. `const detected = detectBitbucketRepo(project.path)`.
2. If detected: `const cfg = getBitbucketConfig(project)`; if null → `{ success: false, error: 'Bitbucket is not configured for this project' }`. Workspace and slug come from the config when set, else from `detected`. Call `createBitbucketPR`.
3. Else: resolve `gh` and call `createPR` as today (the `gh` lookup moves inside this branch so Bitbucket users do not need `gh`).
4. Success handling is shared and unchanged.

### 3.6 Settings IPC

- `bitbucket:checkConnection(projectId)` → `{ accountName, repoName? }`: `user()` then, when workspace and slug are known, `repository()`; a repo lookup failure is reported as the error.
- `bitbucket:detectRepo(projectId)` → `{ workspace, repoSlug } | null`.

Channels live in `IPC_CHANNELS` as `BITBUCKET_CHECK_CONNECTION` and `BITBUCKET_DETECT_REPO`; preload module `bitbucket-api.ts` exposes `bitbucketCheckConnection` and `bitbucketDetectRepo`; the browser mock stubs them.

### 3.7 Error handling

| Situation | Behavior |
|---|---|
| origin is Bitbucket, integration not configured | `Bitbucket is not configured for this project`; nothing pushed |
| push fails (after optional retry) | `Failed to push branch: <git stderr>` |
| open PR already exists on the branch | success with `alreadyExists: true`, existing URL |
| 401/403 from Bitbucket | client message, e.g. `Bitbucket request failed with HTTP 401` |
| destination branch missing | Bitbucket's message (`... does not exist`) surfaced verbatim |
| repository not found for workspace/slug | Bitbucket's message; settings test shows it |

All errors surface in the existing PR dialog error slot.

## 4. BRD commit and push

### 4.1 Git service

`src/main/brd/brd-git.ts`, using `getIsolatedGitEnv()` and the project root:

```ts
export type BrdFileStatus = 'added' | 'modified' | 'deleted' | 'untracked';
export interface BrdChanges { branch: string; files: Array<{ path: string; status: BrdFileStatus }> }
export function brdChanges(projectDir: string): BrdChanges          // git status --porcelain -- docs/brd
export interface BrdCommitResult { commit: string; pushed: boolean; pushError?: string }
export async function commitBrd(projectDir: string, message: string, push: boolean, auth?: PushAuth): Promise<BrdCommitResult>
```

`commitBrd` runs `git add -A -- docs/brd`, `git commit -m <message>` (message validated non-empty and passed as an argument), then when `push` is true `git push origin <branch>` with the same one-time HTTPS token retry as 3.3 when Bitbucket is configured. A push failure after a successful commit returns `pushed: false, pushError` alongside the commit hash. Both functions throw `Not a git repository` when `git rev-parse --is-inside-work-tree` fails. `parsePorcelain(output)` is a pure exported helper.

### 4.2 Commit message

Prefilled deterministically: `docs(brd): update <slug1>, <slug2>` from the changed file names (slug = file name without `.md` / `.requirements.json`, deduped, sorted); `docs(brd): add <slug>` when every change is untracked/added. Computed in the renderer from the changes list. Editable.

### 4.3 IPC

`brd:changes(projectId)` → `IPCResult<BrdChanges>` and `brd:commit(projectId, message, push)` → `IPCResult<BrdCommitResult>`, added to `brd-handlers.ts`, the preload `brd-api.ts`, `ElectronAPI`, and the browser mock. `brd:commit` acquires no lock; git itself serializes.

### 4.4 Renderer

- `brd-store` gains `changes: BrdChanges | null`, `isCommitting`, `refreshChanges(projectId)`, `commit(projectId, message, push)`. `refreshChanges` is called on view mount, after BRD save, after requirements save/approve/release, and after a commit.
- `BrdList` header gets a "Commit" button next to "New BRD" with a count badge when `changes.files.length > 0`; hidden when `changes` is null (not a git repo). Disabled when there are no changes.
- `BrdCommitDialog`: file list with status icons, message textarea (prefilled per 4.2), "Push to origin" switch (default on; last choice kept in `localStorage` key `brd.commit.push`), Commit button, result line: `Committed <short hash>` plus `and pushed` or the push warning in amber.

## 5. Settings section and i18n

`src/renderer/components/settings/integrations/BitbucketIntegration.tsx` (`{ projectId, envConfig, updateEnvConfig }`): enable switch; when enabled: email (prefilled from `jiraEmail` on first enable), API token (`PasswordInput`), workspace, repo slug, "Detect from remote" (fills the two fields), "Test connection" (shows `Connected as <name>` or `Connected as <name>, repository <repo>` or the error). `ProjectSettingsSection` gains `'bitbucket'`; nav item after Jira with the `GitPullRequest` icon; `SectionRouter` case wraps it in `InitializationGuard` like Jira.

i18n: new namespace `bitbucket` (`en`/`fr`) with `settings.*` and `pr.*` (error strings); `settings.json` gains `projectSections.bitbucket` (title, description, integrationTitle, integrationDescription, syncDescription); the Commit dialog strings live under `requirements.commit.*` because the dialog is not Bitbucket-specific.

## 6. Testing

Unit:
- `parseBitbucketRemote` (SSH, ssh://, HTTPS with and without user and `.git`, non-Bitbucket → null).
- `readBitbucketEnv` / `bitbucketEnvUpdates` round trip; enabled rules.
- `BitbucketClient` with a mocked fetch: auth and language headers, `user`, `repository`, `findOpenPullRequest` query and null on empty, `createPullRequest` body and URL extraction, `extractBitbucketError` shapes, 429 retry once.
- `createBitbucketPR`: existing PR short-circuits, push failure returns error, success returns URL (helpers mocked).
- `pushBranch` retry: only on HTTPS + auth error, header passed via `-c`, SSH never retries.
- `parsePorcelain`; `commitBrd` with mocked `execFileSync`: stages only `docs/brd`, push warning shape, not-a-repo error.

Handlers:
- Task PR handler provider split: bitbucket.org origin without config → not-configured error and no push; with config → `createBitbucketPR` called and status updated; non-Bitbucket origin → `createPR` called (existing tests keep passing).
- `bitbucket:checkConnection`, `bitbucket:detectRepo`, `brd:changes`, `brd:commit`.

Renderer:
- `BitbucketIntegration`: test connection success/error, detect fills fields, toggle.
- `BrdList` Commit button badge and hidden state; `BrdCommitDialog` prefilled message, push switch persisted, commit call and result line.
- `brd-store` `refreshChanges`/`commit`.

Manual check (needs a Bitbucket Cloud repo and API token): connect and detect in settings; create a PR from a finished task in a Bitbucket-hosted project and open the URL; change a BRD, commit with push, confirm on Bitbucket; commit with push off, then confirm the branch is ahead.

## 7. File map

New:
- `src/shared/bitbucket/remote.ts`
- `src/main/bitbucket/{env,config,remote,client,create-pr}.ts`
- `src/main/ai/runners/pr-common.ts`
- `src/main/ipc-handlers/bitbucket/index.ts`
- `src/main/brd/brd-git.ts`
- `src/preload/api/modules/bitbucket-api.ts`
- `src/renderer/components/settings/integrations/BitbucketIntegration.tsx`
- `src/renderer/components/requirements/BrdCommitDialog.tsx`
- `src/shared/i18n/locales/{en,fr}/bitbucket.json`

Modified:
- `src/shared/types/project.ts`, `src/shared/types/ipc.ts`, `src/shared/constants/ipc.ts`
- `src/main/ipc-handlers/env-handlers.ts`, `src/main/ipc-handlers/index.ts`, `src/main/ipc-handlers/brd-handlers.ts`, `src/main/ipc-handlers/task/worktree-handlers.ts`
- `src/main/ai/runners/github/pr-creator.ts`
- `src/preload/api/modules/brd-api.ts`, `src/preload/api/agent-api.ts`, `src/renderer/lib/browser-mock.ts`, `src/renderer/lib/mocks/integration-mock.ts`
- `src/renderer/stores/brd-store.ts`, `src/renderer/components/requirements/{BrdList,RequirementsView}.tsx`
- `src/renderer/components/settings/{AppSettings,ProjectSettingsContent}.tsx`, `settings/sections/SectionRouter.tsx`, `settings/integrations/index.ts`
- `src/shared/i18n/index.ts`, `locales/{en,fr}/{settings,requirements}.json`
