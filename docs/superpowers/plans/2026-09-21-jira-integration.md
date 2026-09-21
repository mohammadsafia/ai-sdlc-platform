# Jira Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect a project to Jira Cloud so released milestones become an Epic with one issue per task, task status changes transition the issues, and Jira issues can be imported as Kanban tasks.

**Architecture:** Credentials live in the project `.env`. A small REST v3 client in the main process serves a `jira` handler group. The 2c release handler calls the push in-process; the task state manager schedules a debounced transition on every status change. The renderer adds a settings section, a Jira Issues view, and key chips in the Requirements tab, task cards, and task detail. No AI anywhere.

**Tech Stack:** TypeScript strict, Electron IPC, Zod 4, Zustand 5, React 19, react-i18next, Vitest + React Testing Library (jsdom), `fetch` for Jira.

**Spec:** `docs/superpowers/specs/2026-09-21-jira-integration-design.md`

## Global Constraints

- Every user-facing string goes through `react-i18next`; new keys land in both `en` and `fr` locale files.
- No `console.log` in production code (`console.warn`/`console.error` are the codebase's convention for main-process diagnostics).
- No new dependencies; the ADF converter is hand-written.
- Jira Cloud REST v3 only; auth is `Basic base64(email:token)`.
- Status sync is one way (Appswave to Jira) and must never block or revert a Kanban move.
- Retrying a push never creates duplicate issues: only tasks without an issue key are created.
- Bulk creation sends at most 50 issues per request.
- Status map env format: `status:Jira Name;status:Jira Name;...` with an empty name meaning "not synced" (compact form instead of JSON, because the env parser strips quotes).
- All commands run from `apps/desktop/`. Tests: `npx vitest run <path>`. Gate: `npm test && npm run lint && npm run typecheck`. Commit after each task; target `develop`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/types/project.ts` (modify) | Jira fields on `ProjectEnvConfig` |
| `src/shared/types/task.ts` (modify) | `'jira'` source type and Jira fields on `TaskMetadata` |
| `src/shared/types/requirements.ts`, `src/shared/brd/requirements.ts` (modify) | `jira` block on `MilestoneRelease` |
| `src/shared/types/integrations.ts` (modify) | Jira IPC result types |
| `src/shared/jira/status-map.ts` (create) | default map, compact parse/serialize, target lookup |
| `src/shared/jira/adf.ts` (create) | Markdown → ADF and ADF → text |
| `src/shared/jira/push.ts` (create) | pending tasks, pushed check, issue field builders |
| `src/main/jira/env.ts` (create) | env keys, read from vars, updates from config |
| `src/main/ipc-handlers/env-handlers.ts` (modify) | wire Jira env read/write/template |
| `src/main/jira/client.ts` (create) | REST v3 client |
| `src/main/jira/config.ts` (create) | `getJiraConfig(project)` |
| `src/main/jira/push-milestone.ts` (create) | push logic shared by release and the push handler |
| `src/main/jira/status-sync.ts` (create) | debounced transition on status change |
| `src/main/ipc-handlers/jira/index.ts` (create) | handler group |
| `src/main/ipc-handlers/requirements-handlers.ts` (modify) | slug lock export, release push hook, warnings |
| `src/main/task-state-manager.ts` (modify) | call `scheduleJiraSync` from `emitStatus` |
| `src/shared/constants/ipc.ts`, `src/shared/types/ipc.ts`, `src/preload/api/modules/jira-api.ts`, `src/preload/api/agent-api.ts`, `src/renderer/lib/browser-mock.ts`, `src/main/ipc-handlers/index.ts` | channels, API, wiring |
| `src/renderer/components/settings/integrations/JiraIntegration.tsx` (create) + router/nav/type edits | settings section |
| `src/renderer/stores/jira/issues-store.ts`, `src/renderer/components/JiraIssues.tsx` (create) + `Sidebar.tsx`, `App.tsx` | Jira Issues view |
| `src/renderer/stores/requirements-store.ts`, `.../set/RequirementsSetEditor.tsx`, `.../set/RequirementsTab.tsx` (modify) | push action, chips, warnings |
| `src/renderer/components/TaskCard.tsx`, `src/renderer/components/task-detail/TaskJira.tsx` (create), `TaskDetailModal.tsx` | badges and detail block |
| `src/shared/i18n/locales/{en,fr}/jira.json` (create), `settings.json`, `navigation.json`, `requirements.json`, `src/shared/i18n/index.ts` | i18n |

---

### Task 1: Configuration, types, schema, and status map

**Files:**
- Modify: `src/shared/types/project.ts` (after `gitlabAutoSync`), `src/shared/types/task.ts` (`TaskMetadata`), `src/shared/types/requirements.ts` (`MilestoneRelease`), `src/shared/brd/requirements.ts` (schema)
- Create: `src/shared/jira/status-map.ts`, `src/main/jira/env.ts`
- Modify: `src/main/ipc-handlers/env-handlers.ts` (write block after GitLab, template after GitLab, parse after GitLab)
- Test: `src/shared/jira/__tests__/status-map.test.ts`, `src/main/jira/__tests__/env.test.ts`, `src/shared/brd/__tests__/requirements.test.ts`

**Interfaces:**
- Produces: `JiraStatusMap`, `DEFAULT_JIRA_STATUS_MAP`, `TASK_STATUSES`, `parseStatusMap(text)`, `serializeStatusMap(map)`, `targetStatusFor(map, status)`; `JIRA_ENV_KEYS`, `readJiraEnv(vars)`, `jiraEnvUpdates(config)`; `ProjectEnvConfig.jira*` fields; `TaskMetadata.jiraKey/jiraUrl/jiraEpicKey/jiraSyncError/jiraSyncedStatus`; `MilestoneJiraRelease` and `MilestoneRelease.jira?`.

- [ ] **Step 1: Write the failing tests**

`src/shared/jira/__tests__/status-map.test.ts`:

```ts
// apps/desktop/src/shared/jira/__tests__/status-map.test.ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_JIRA_STATUS_MAP, parseStatusMap, serializeStatusMap, targetStatusFor } from '../status-map';

describe('status map', () => {
  it('defaults when text is missing or malformed', () => {
    expect(parseStatusMap(undefined)).toEqual(DEFAULT_JIRA_STATUS_MAP);
    expect(parseStatusMap('garbage')).toEqual(DEFAULT_JIRA_STATUS_MAP);
  });
  it('parses the compact form, empty name means not synced, unknown statuses ignored', () => {
    const map = parseStatusMap('backlog:Selected for Development;done:Closed;error:;bogus:X');
    expect(map.backlog).toBe('Selected for Development');
    expect(map.done).toBe('Closed');
    expect(map.error).toBeNull();
    expect(map.in_progress).toBe('In Progress');
  });
  it('round-trips through serialize', () => {
    const map = { ...DEFAULT_JIRA_STATUS_MAP, human_review: 'In Review', error: null };
    expect(parseStatusMap(serializeStatusMap(map))).toEqual(map);
  });
  it('targetStatusFor returns the mapped name or null', () => {
    expect(targetStatusFor(DEFAULT_JIRA_STATUS_MAP, 'done')).toBe('Done');
    expect(targetStatusFor(DEFAULT_JIRA_STATUS_MAP, 'error')).toBeNull();
  });
});
```

`src/main/jira/__tests__/env.test.ts`:

```ts
// apps/desktop/src/main/jira/__tests__/env.test.ts
import { describe, it, expect } from 'vitest';
import { jiraEnvUpdates, readJiraEnv } from '../env';

describe('jira env', () => {
  it('reads enabled config from vars with defaults', () => {
    const c = readJiraEnv({ JIRA_BASE_URL: 'https://acme.atlassian.net/', JIRA_EMAIL: 'a@b.c', JIRA_API_TOKEN: 't', JIRA_PROJECT_KEY: 'acme' });
    expect(c).toMatchObject({ jiraEnabled: true, jiraBaseUrl: 'https://acme.atlassian.net', jiraEmail: 'a@b.c', jiraApiToken: 't', jiraProjectKey: 'ACME', jiraIssueType: 'Task', jiraEpicIssueType: 'Epic' });
    expect(c.jiraStatusMap?.done).toBe('Done');
  });
  it('is disabled without a token or when JIRA_ENABLED=false', () => {
    expect(readJiraEnv({}).jiraEnabled).toBe(false);
    expect(readJiraEnv({ JIRA_API_TOKEN: 't', JIRA_ENABLED: 'false' }).jiraEnabled).toBe(false);
  });
  it('produces env updates only for provided fields and serializes the map', () => {
    const u = jiraEnvUpdates({ jiraEnabled: true, jiraProjectKey: 'ACME', jiraStatusMap: { backlog: 'To Do', queue: 'To Do', in_progress: 'Doing', ai_review: 'Doing', human_review: 'Doing', done: 'Done', pr_created: 'Done', error: null } });
    expect(u).toEqual({ JIRA_ENABLED: 'true', JIRA_PROJECT_KEY: 'ACME', JIRA_STATUS_MAP: 'backlog:To Do;queue:To Do;in_progress:Doing;ai_review:Doing;human_review:Doing;done:Done;pr_created:Done;error:' });
    expect(jiraEnvUpdates({})).toEqual({});
  });
});
```

Append to `src/shared/brd/__tests__/requirements.test.ts` inside `describe('releases', ...)`:

```ts
  it('accepts a jira block on a release entry', () => {
    const withJira = { M1: { releasedAt: 't', tasks: [{ proposedTaskId: 'T1', specId: 's' }], jira: { epicKey: 'ACME-1', issues: { T1: 'ACME-2' }, pushedAt: 't' } } };
    expect(RequirementsSetSchema.safeParse(set({ releases: withJira })).success).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/jira src/main/jira src/shared/brd/__tests__/requirements.test.ts`
Expected: the two new files fail to import; the jira block test fails (unknown key stripped only if strict; if it passes, continue, the schema step below still applies).

- [ ] **Step 3: Types**

`src/shared/types/project.ts`, after `gitlabAutoSync?: boolean; ...`:

```ts
  // Jira Integration (Jira Cloud, email + API token)
  jiraEnabled: boolean;
  jiraBaseUrl?: string;      // https://acme.atlassian.net
  jiraEmail?: string;
  jiraApiToken?: string;
  jiraProjectKey?: string;   // ACME
  jiraIssueType?: string;    // default Task
  jiraEpicIssueType?: string; // default Epic
  jiraStatusMap?: JiraStatusMap;
```

and add at the top of the file: `import type { JiraStatusMap } from '../jira/status-map';`. Every object literal typed as `ProjectEnvConfig` that lists `gitlabEnabled: false` must also list `jiraEnabled: false` (the default config in `env-handlers.ts` and any test fixtures; run typecheck to find them).

`src/shared/types/task.ts`, in `TaskMetadata`: extend the `sourceType` union with `| 'jira'` and add after `proposedTaskId?: string;`:

```ts
  // Jira links (released tasks pushed to Jira, or imported issues)
  jiraKey?: string;          // "ACME-123"
  jiraUrl?: string;
  jiraEpicKey?: string;
  jiraSyncError?: string;    // last transition failure; cleared on success
  jiraSyncedStatus?: string; // Jira status name last confirmed by a transition
```

`src/shared/types/requirements.ts`, before `MilestoneRelease`:

```ts
/** Jira issues created for a released milestone; may be partial after a failure midway. */
export interface MilestoneJiraRelease {
  epicKey: string;
  issues: Record<string, string>;   // proposedTaskId → issue key
  pushedAt: string;                 // ISO of the last successful batch
}
```

and inside `MilestoneRelease`: `jira?: MilestoneJiraRelease;`.

`src/shared/brd/requirements.ts`: replace `milestoneReleaseSchema` with

```ts
const milestoneJiraSchema = z.object({ epicKey: z.string().min(1), issues: z.record(z.string(), z.string().min(1)), pushedAt: z.string().min(1) });
const milestoneReleaseSchema = z.object({ releasedAt: z.string().min(1), tasks: z.array(releasedTaskSchema), jira: milestoneJiraSchema.optional() });
```

- [ ] **Step 4: Status map module**

Create `src/shared/jira/status-map.ts`:

```ts
// apps/desktop/src/shared/jira/status-map.ts
import type { TaskStatus } from '../types/task';

export type JiraStatusMap = Record<TaskStatus, string | null>;

export const TASK_STATUSES: readonly TaskStatus[] = ['backlog', 'queue', 'in_progress', 'ai_review', 'human_review', 'done', 'pr_created', 'error'];

export const DEFAULT_JIRA_STATUS_MAP: JiraStatusMap = {
  backlog: 'To Do',
  queue: 'To Do',
  in_progress: 'In Progress',
  ai_review: 'In Progress',
  human_review: 'In Progress',
  done: 'Done',
  pr_created: 'Done',
  error: null,
};

/** Parse the compact env form `status:Name;status:Name`; an empty name means not synced. Unknown or malformed input keeps defaults. */
export function parseStatusMap(text: string | undefined | null): JiraStatusMap {
  const out: JiraStatusMap = { ...DEFAULT_JIRA_STATUS_MAP };
  if (!text || !text.includes(':')) return out;
  for (const pair of text.split(';')) {
    const idx = pair.indexOf(':');
    if (idx < 0) continue;
    const status = pair.slice(0, idx).trim() as TaskStatus;
    if (!TASK_STATUSES.includes(status)) continue;
    const name = pair.slice(idx + 1).trim();
    out[status] = name.length > 0 ? name : null;
  }
  return out;
}

export function serializeStatusMap(map: JiraStatusMap): string {
  return TASK_STATUSES.map((s) => `${s}:${map[s] ?? ''}`).join(';');
}

export function targetStatusFor(map: JiraStatusMap, status: TaskStatus): string | null {
  return map[status] ?? null;
}
```

- [ ] **Step 5: Env module and wiring**

Create `src/main/jira/env.ts`:

```ts
// apps/desktop/src/main/jira/env.ts
import { parseStatusMap, serializeStatusMap } from '../../shared/jira/status-map';
import type { ProjectEnvConfig } from '../../shared/types';

export const JIRA_ENV_KEYS = {
  ENABLED: 'JIRA_ENABLED',
  BASE_URL: 'JIRA_BASE_URL',
  EMAIL: 'JIRA_EMAIL',
  API_TOKEN: 'JIRA_API_TOKEN',
  PROJECT_KEY: 'JIRA_PROJECT_KEY',
  ISSUE_TYPE: 'JIRA_ISSUE_TYPE',
  EPIC_ISSUE_TYPE: 'JIRA_EPIC_ISSUE_TYPE',
  STATUS_MAP: 'JIRA_STATUS_MAP',
} as const;

type JiraEnvConfig = Pick<ProjectEnvConfig, 'jiraEnabled' | 'jiraBaseUrl' | 'jiraEmail' | 'jiraApiToken' | 'jiraProjectKey' | 'jiraIssueType' | 'jiraEpicIssueType' | 'jiraStatusMap'>;

/** Jira config from parsed .env vars. Enabled when a token exists and JIRA_ENABLED is not "false". */
export function readJiraEnv(vars: Record<string, string>): JiraEnvConfig {
  const out: JiraEnvConfig = { jiraEnabled: false };
  const token = vars[JIRA_ENV_KEYS.API_TOKEN]?.trim();
  if (token) {
    out.jiraApiToken = token;
    out.jiraEnabled = vars[JIRA_ENV_KEYS.ENABLED]?.toLowerCase() !== 'false';
  }
  const baseUrl = vars[JIRA_ENV_KEYS.BASE_URL]?.trim();
  if (baseUrl) out.jiraBaseUrl = baseUrl.replace(/\/+$/, '');
  const email = vars[JIRA_ENV_KEYS.EMAIL]?.trim();
  if (email) out.jiraEmail = email;
  const key = vars[JIRA_ENV_KEYS.PROJECT_KEY]?.trim();
  if (key) out.jiraProjectKey = key.toUpperCase();
  out.jiraIssueType = vars[JIRA_ENV_KEYS.ISSUE_TYPE]?.trim() || 'Task';
  out.jiraEpicIssueType = vars[JIRA_ENV_KEYS.EPIC_ISSUE_TYPE]?.trim() || 'Epic';
  out.jiraStatusMap = parseStatusMap(vars[JIRA_ENV_KEYS.STATUS_MAP]);
  return out;
}

/** Env var updates for the provided Jira fields only. */
export function jiraEnvUpdates(config: Partial<ProjectEnvConfig>): Record<string, string> {
  const u: Record<string, string> = {};
  if (config.jiraEnabled !== undefined) u[JIRA_ENV_KEYS.ENABLED] = config.jiraEnabled ? 'true' : 'false';
  if (config.jiraBaseUrl !== undefined) u[JIRA_ENV_KEYS.BASE_URL] = config.jiraBaseUrl.replace(/\/+$/, '');
  if (config.jiraEmail !== undefined) u[JIRA_ENV_KEYS.EMAIL] = config.jiraEmail;
  if (config.jiraApiToken !== undefined) u[JIRA_ENV_KEYS.API_TOKEN] = config.jiraApiToken;
  if (config.jiraProjectKey !== undefined) u[JIRA_ENV_KEYS.PROJECT_KEY] = config.jiraProjectKey.toUpperCase();
  if (config.jiraIssueType !== undefined) u[JIRA_ENV_KEYS.ISSUE_TYPE] = config.jiraIssueType;
  if (config.jiraEpicIssueType !== undefined) u[JIRA_ENV_KEYS.EPIC_ISSUE_TYPE] = config.jiraEpicIssueType;
  if (config.jiraStatusMap !== undefined) u[JIRA_ENV_KEYS.STATUS_MAP] = serializeStatusMap(config.jiraStatusMap);
  return u;
}
```

In `src/main/ipc-handlers/env-handlers.ts`:
- import: `import { JIRA_ENV_KEYS, jiraEnvUpdates, readJiraEnv } from '../jira/env';`
- in `generateEnvContent`, after the GitLab block: `Object.assign(existingVars, jiraEnvUpdates(config));`
- in the template, after the GitLab section:

```ts
# =============================================================================
# JIRA INTEGRATION (OPTIONAL, Jira Cloud)
# =============================================================================
${existingVars[JIRA_ENV_KEYS.ENABLED] !== undefined ? `${JIRA_ENV_KEYS.ENABLED}=${existingVars[JIRA_ENV_KEYS.ENABLED]}` : `# ${JIRA_ENV_KEYS.ENABLED}=true`}
${envLine(existingVars, JIRA_ENV_KEYS.BASE_URL, 'https://yourcompany.atlassian.net')}
${envLine(existingVars, JIRA_ENV_KEYS.EMAIL)}
${envLine(existingVars, JIRA_ENV_KEYS.API_TOKEN)}
${envLine(existingVars, JIRA_ENV_KEYS.PROJECT_KEY, 'ACME')}
${envLine(existingVars, JIRA_ENV_KEYS.ISSUE_TYPE, 'Task')}
${envLine(existingVars, JIRA_ENV_KEYS.EPIC_ISSUE_TYPE, 'Epic')}
${envLine(existingVars, JIRA_ENV_KEYS.STATUS_MAP, 'backlog:To Do;queue:To Do;in_progress:In Progress;ai_review:In Progress;human_review:In Progress;done:Done;pr_created:Done;error:')}
```

- in the default config object add `jiraEnabled: false,`; in the parse section after GitLab: `Object.assign(config, readJiraEnv(vars));`

- [ ] **Step 6: Run tests, typecheck, commit**

Run: `npx vitest run src/shared/jira src/main/jira src/shared/brd && npx tsc --noEmit -p tsconfig.json`
Expected: all pass; fix any fixture that now needs `jiraEnabled: false`.

```bash
git add src/shared/types/project.ts src/shared/types/task.ts src/shared/types/requirements.ts src/shared/brd/requirements.ts src/shared/brd/__tests__/requirements.test.ts src/shared/jira/status-map.ts src/shared/jira/__tests__/status-map.test.ts src/main/jira/env.ts src/main/jira/__tests__/env.test.ts src/main/ipc-handlers/env-handlers.ts
git commit -m "feat(jira): project env config, task and release link fields, status map"
```

---

### Task 2: ADF conversion and push helpers

**Files:**
- Create: `src/shared/jira/adf.ts`, `src/shared/jira/push.ts`
- Test: `src/shared/jira/__tests__/adf.test.ts`, `src/shared/jira/__tests__/push.test.ts`

**Interfaces:**
- Produces: `AdfDocument`, `markdownToAdf(markdown)`, `adfToText(doc)`; `pendingPushTasks(set, milestoneId): ReleasedTask[]`, `isMilestonePushed(set, milestoneId)`, `buildEpicFields(projectKey, epicType, milestone)`, `buildTaskFields(projectKey, issueType, epicKey, summary, markdown)`; `JiraIssueFields = { fields: { project: { key }, summary, issuetype: { name }, description: AdfDocument, parent?: { key } } }`.

- [ ] **Step 1: Write the failing tests**

`src/shared/jira/__tests__/adf.test.ts`:

```ts
// apps/desktop/src/shared/jira/__tests__/adf.test.ts
import { describe, it, expect } from 'vitest';
import { adfToText, markdownToAdf } from '../adf';

describe('markdownToAdf', () => {
  it('converts headings, paragraphs, bullets and checklists', () => {
    const doc = markdownToAdf('# Title\n\nFirst para line one\nline two\n\n## Sub\n- [ ] a\n- [x] b\n* plain `code` and [link](http://x)\n\nLast');
    expect(doc.type).toBe('doc');
    const types = doc.content.map((n) => n.type);
    expect(types).toEqual(['heading', 'paragraph', 'heading', 'bulletList', 'paragraph']);
    expect(doc.content[0].attrs).toEqual({ level: 1 });
    expect(doc.content[1].content?.[0].text).toBe('First para line one line two');
    const items = doc.content[3].content ?? [];
    expect(items).toHaveLength(3);
    expect(items[0].content?.[0].content?.[0].text).toBe('[ ] a');
    expect(items[2].content?.[0].content?.[0].text).toBe('plain code and link');
  });
  it('returns an empty paragraph for empty input', () => {
    expect(markdownToAdf('   ').content).toEqual([{ type: 'paragraph', content: [] }]);
  });
});

describe('adfToText', () => {
  it('flattens text nodes with line breaks per block and bullets per list item', () => {
    const doc = markdownToAdf('# T\n\npara\n- one\n- two');
    expect(adfToText(doc)).toBe('T\npara\n- one\n- two');
    expect(adfToText(null)).toBe('');
  });
});
```

`src/shared/jira/__tests__/push.test.ts`:

```ts
// apps/desktop/src/shared/jira/__tests__/push.test.ts
import { describe, it, expect } from 'vitest';
import type { RequirementsSet } from '../../types/requirements';
import { buildEpicFields, buildTaskFields, isMilestonePushed, pendingPushTasks } from '../push';

const set = (jira?: { epicKey: string; issues: Record<string, string>; pushedAt: string }): RequirementsSet => ({
  version: 1, brdSlug: 'a', brdHash: 'H', status: 'approved', generatedAt: 't',
  requirements: [], tasks: [],
  milestones: [{ id: 'M1', name: 'Core', description: 'Core UI', order: 1, included: true }],
  releases: { M1: { releasedAt: 't', tasks: [{ proposedTaskId: 'T1', specId: '001-a' }, { proposedTaskId: 'T2', specId: '002-b' }], ...(jira ? { jira } : {}) } },
});

describe('push helpers', () => {
  it('lists released tasks without an issue key and detects a complete push', () => {
    expect(pendingPushTasks(set(), 'M1').map((t) => t.specId)).toEqual(['001-a', '002-b']);
    const partial = set({ epicKey: 'ACME-1', issues: { T1: 'ACME-2' }, pushedAt: 't' });
    expect(pendingPushTasks(partial, 'M1').map((t) => t.specId)).toEqual(['002-b']);
    expect(isMilestonePushed(partial, 'M1')).toBe(false);
    expect(isMilestonePushed(set({ epicKey: 'ACME-1', issues: { T1: 'ACME-2', T2: 'ACME-3' }, pushedAt: 't' }), 'M1')).toBe(true);
    expect(pendingPushTasks(set(), 'M9')).toEqual([]);
  });
  it('builds epic and task fields', () => {
    const epic = buildEpicFields('ACME', 'Epic', set().milestones[0]);
    expect(epic.fields).toMatchObject({ project: { key: 'ACME' }, summary: 'Core', issuetype: { name: 'Epic' } });
    expect(epic.fields.parent).toBeUndefined();
    const task = buildTaskFields('ACME', 'Task', 'ACME-1', 'Build form', '# Do it');
    expect(task.fields).toMatchObject({ project: { key: 'ACME' }, summary: 'Build form', issuetype: { name: 'Task' }, parent: { key: 'ACME-1' } });
    expect(task.fields.description.content[0].type).toBe('heading');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/jira`
Expected: both new files fail to import.

- [ ] **Step 3: Write `adf.ts`**

```ts
// apps/desktop/src/shared/jira/adf.ts
export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
}
export interface AdfDocument { version: 1; type: 'doc'; content: AdfNode[] }

const text = (t: string): AdfNode => ({ type: 'text', text: t });
const paragraph = (t: string): AdfNode => ({ type: 'paragraph', content: t ? [text(t)] : [] });

/** Strip the inline Markdown we do not render: code spans, links, emphasis. */
function inline(s: string): string {
  return s
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/__([^_]*)__/g, '$1')
    .trim();
}

/** Markdown subset → ADF: headings 1-3, paragraphs, bullet lists (task markers kept as text). */
export function markdownToAdf(markdown: string): AdfDocument {
  const content: AdfNode[] = [];
  let para: string[] = [];
  let list: AdfNode[] = [];
  const flushPara = () => { if (para.length) { content.push(paragraph(para.join(' '))); para = []; } };
  const flushList = () => { if (list.length) { content.push({ type: 'bulletList', content: list }); list = []; } };

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (heading) {
      flushPara(); flushList();
      content.push({ type: 'heading', attrs: { level: heading[1].length }, content: [text(inline(heading[2]))] });
    } else if (bullet) {
      flushPara();
      list.push({ type: 'listItem', content: [paragraph(inline(bullet[1]))] });
    } else if (line.trim() === '') {
      flushPara(); flushList();
    } else {
      flushList();
      para.push(inline(line));
    }
  }
  flushPara(); flushList();
  if (content.length === 0) content.push(paragraph(''));
  return { version: 1, type: 'doc', content };
}

/** ADF → plain text: one line per block, "- " before list items. Tolerates any input. */
export function adfToText(doc: unknown): string {
  const lines: string[] = [];
  const walk = (node: unknown, prefix: string): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as AdfNode;
    if (n.type === 'text') { lines[lines.length - 1] = (lines[lines.length - 1] ?? '') + (n.text ?? ''); return; }
    if (n.type === 'paragraph' || n.type === 'heading') lines.push(prefix);
    const childPrefix = n.type === 'listItem' ? '- ' : '';
    for (const child of n.content ?? []) walk(child, n.type === 'listItem' ? childPrefix : '');
  };
  walk(doc, '');
  return lines.map((l) => l.trimEnd()).filter((l) => l.length > 0).join('\n');
}
```

Note on `walk`: a `listItem` passes `"- "` as the prefix of its first paragraph; nested paragraphs inside the item start a new line with that prefix. This satisfies the test (`- one`, `- two`).

- [ ] **Step 4: Write `push.ts`**

```ts
// apps/desktop/src/shared/jira/push.ts
import type { Milestone, ReleasedTask, RequirementsSet } from '../types/requirements';
import { type AdfDocument, markdownToAdf } from './adf';

export interface JiraIssueFields {
  fields: {
    project: { key: string };
    summary: string;
    issuetype: { name: string };
    description: AdfDocument;
    parent?: { key: string };
  };
}

/** Released tasks of the milestone that have no Jira issue yet. */
export function pendingPushTasks(set: RequirementsSet, milestoneId: string): ReleasedTask[] {
  const entry = set.releases?.[milestoneId];
  if (!entry) return [];
  const issues = entry.jira?.issues ?? {};
  return entry.tasks.filter((t) => !issues[t.proposedTaskId]);
}

/** True when the milestone has an epic and every released task has an issue key. */
export function isMilestonePushed(set: RequirementsSet, milestoneId: string): boolean {
  const entry = set.releases?.[milestoneId];
  if (!entry?.jira) return false;
  return entry.tasks.every((t) => !!entry.jira?.issues[t.proposedTaskId]);
}

export function buildEpicFields(projectKey: string, epicType: string, milestone: Milestone): JiraIssueFields {
  return { fields: { project: { key: projectKey }, summary: milestone.name, issuetype: { name: epicType }, description: markdownToAdf(milestone.description) } };
}

export function buildTaskFields(projectKey: string, issueType: string, epicKey: string, summary: string, markdown: string): JiraIssueFields {
  return { fields: { project: { key: projectKey }, summary, issuetype: { name: issueType }, description: markdownToAdf(markdown), parent: { key: epicKey } } };
}
```

- [ ] **Step 5: Run tests, lint, typecheck, commit**

Run: `npx vitest run src/shared/jira && npx biome check src/shared/jira && npx tsc --noEmit -p tsconfig.json`

```bash
git add src/shared/jira
git commit -m "feat(jira): ADF conversion and push helpers"
```

---

### Task 3: Jira REST client

**Files:**
- Create: `src/main/jira/client.ts`
- Test: `src/main/jira/__tests__/client.test.ts`

**Interfaces:**
- Produces: `JiraApiError { status, message }`, `JiraClient` with `myself()`, `project(key)`, `statuses(key)`, `search({ jql, nextPageToken?, maxResults? })`, `createIssue(fields)`, `createIssues(list)`, `transitions(key)`, `transition(key, id)`, `issue(key)`, `browseUrl(key)`; `JiraIssueRaw`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/desktop/src/main/jira/__tests__/client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { JiraApiError, JiraClient } from '../client';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function client(fetchImpl: typeof fetch) {
  return new JiraClient({ baseUrl: 'https://acme.atlassian.net', email: 'a@b.c', apiToken: 'tok' }, fetchImpl);
}

describe('JiraClient', () => {
  it('sends basic auth and JSON headers to the v3 endpoint', async () => {
    const f = vi.fn().mockResolvedValue(json(200, { accountId: '1', displayName: 'Ann' }));
    const me = await client(f as unknown as typeof fetch).myself();
    expect(me).toEqual({ accountId: '1', displayName: 'Ann' });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://acme.atlassian.net/rest/api/3/myself');
    expect(new Headers(init.headers).get('authorization')).toBe(`Basic ${Buffer.from('a@b.c:tok').toString('base64')}`);
    expect(new Headers(init.headers).get('accept')).toBe('application/json');
  });

  it('throws JiraApiError with Jira messages on non-2xx', async () => {
    const f = vi.fn().mockResolvedValue(json(400, { errorMessages: ['Bad'], errors: { summary: 'required' } }));
    await expect(client(f as unknown as typeof fetch).project('ACME')).rejects.toMatchObject({ status: 400, message: 'Bad; summary: required' });
    await expect(client(f as unknown as typeof fetch).project('ACME')).rejects.toBeInstanceOf(JiraApiError);
  });

  it('retries once on 429 using Retry-After', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(429, {}, { 'retry-after': '0' })).mockResolvedValueOnce(json(200, { accountId: '1', displayName: 'Ann' }));
    await expect(client(f as unknown as typeof fetch).myself()).resolves.toMatchObject({ displayName: 'Ann' });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('dedupes statuses across issue types and chunks bulk creation at 50', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, [{ statuses: [{ name: 'To Do' }, { name: 'Done' }] }, { statuses: [{ name: 'Done' }] }]))
      .mockResolvedValueOnce(json(201, { issues: Array.from({ length: 50 }, (_, i) => ({ key: `A-${i}` })), errors: [] }))
      .mockResolvedValueOnce(json(201, { issues: [{ key: 'A-50' }], errors: [] }));
    const c = client(f as unknown as typeof fetch);
    expect(await c.statuses('ACME')).toEqual(['To Do', 'Done']);
    const list = Array.from({ length: 51 }, (_, i) => ({ fields: { project: { key: 'ACME' }, summary: `s${i}`, issuetype: { name: 'Task' }, description: { version: 1 as const, type: 'doc' as const, content: [] } } }));
    const r = await c.createIssues(list);
    expect(f).toHaveBeenCalledTimes(3);
    expect(JSON.parse(f.mock.calls[1][1].body).issueUpdates).toHaveLength(50);
    expect(r.created).toHaveLength(51);
    expect(r.created[50]).toEqual({ index: 50, key: 'A-50' });
  });

  it('maps bulk per-element errors back to input indexes', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(201, { issues: [{ key: 'A-1' }], errors: [{ status: 400, failedElementNumber: 0, elementErrors: { errorMessages: ['nope'], errors: {} } }] }));
    const c = client(f as unknown as typeof fetch);
    const mk = (s: string) => ({ fields: { project: { key: 'ACME' }, summary: s, issuetype: { name: 'Task' }, description: { version: 1 as const, type: 'doc' as const, content: [] } } });
    const r = await c.createIssues([mk('a'), mk('b')]);
    expect(r.created).toEqual([{ index: 1, key: 'A-1' }]);
    expect(r.failed).toEqual([{ index: 0, error: 'nope' }]);
  });

  it('search posts JQL with a page token and builds browse URLs', async () => {
    const f = vi.fn().mockResolvedValue(json(200, { issues: [], isLast: true }));
    const c = client(f as unknown as typeof fetch);
    await c.search({ jql: 'project = ACME', nextPageToken: 'p2' });
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body).toMatchObject({ jql: 'project = ACME', nextPageToken: 'p2', maxResults: 50 });
    expect(body.fields).toContain('summary');
    expect(c.browseUrl('ACME-1')).toBe('https://acme.atlassian.net/browse/ACME-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/jira/__tests__/client.test.ts`
Expected: FAIL, cannot find `../client`.

- [ ] **Step 3: Write the client**

```ts
// apps/desktop/src/main/jira/client.ts
import type { JiraIssueFields } from '../../shared/jira/push';

export class JiraApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'JiraApiError';
    this.status = status;
  }
}

export interface JiraClientConfig { baseUrl: string; email: string; apiToken: string }

export interface JiraIssueRaw {
  key: string;
  fields: {
    summary: string;
    status?: { name: string };
    issuetype?: { name: string };
    assignee?: { displayName?: string } | null;
    updated?: string;
    description?: unknown;
  };
}

export interface JiraTransition { id: string; name: string; to: { name: string } }

const SEARCH_FIELDS = ['summary', 'status', 'issuetype', 'assignee', 'updated'];
const BULK_CHUNK = 50;

/** Extract a readable message from a Jira error body. */
export function extractJiraError(status: number, body: unknown): string {
  const parts: string[] = [];
  if (body && typeof body === 'object') {
    const b = body as { errorMessages?: unknown; errors?: unknown; message?: unknown };
    if (Array.isArray(b.errorMessages)) parts.push(...b.errorMessages.map(String));
    if (b.errors && typeof b.errors === 'object') for (const [k, v] of Object.entries(b.errors as Record<string, unknown>)) parts.push(`${k}: ${String(v)}`);
    if (typeof b.message === 'string') parts.push(b.message);
  }
  return parts.length > 0 ? parts.join('; ') : `Jira request failed with HTTP ${status}`;
}

export class JiraClient {
  private readonly base: string;
  constructor(private readonly cfg: JiraClientConfig, private readonly fetchImpl: typeof fetch = globalThis.fetch) {
    this.base = cfg.baseUrl.replace(/\/+$/, '');
  }

  browseUrl(key: string): string {
    return `${this.base}/browse/${key}`;
  }

  private async request<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${this.cfg.email}:${this.cfg.apiToken}`).toString('base64')}`,
      Accept: 'application/json',
      'User-Agent': 'Appswave',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await this.fetchImpl(`${this.base}/rest/api/3${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 429 && attempt === 0) {
      const wait = Number(res.headers.get('retry-after') ?? '2');
      await new Promise((r) => setTimeout(r, Math.max(0, wait) * 1000));
      return this.request<T>(method, path, body, 1);
    }
    if (!res.ok) {
      let parsed: unknown = null;
      try { parsed = await res.json(); } catch { /* no body */ }
      throw new JiraApiError(res.status, extractJiraError(res.status, parsed));
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  myself(): Promise<{ accountId: string; displayName: string }> {
    return this.request('GET', '/myself');
  }

  project(key: string): Promise<{ id: string; key: string; name: string; issueTypes: Array<{ id: string; name: string; subtask: boolean; hierarchyLevel?: number }> }> {
    return this.request('GET', `/project/${encodeURIComponent(key)}`);
  }

  async statuses(projectKey: string): Promise<string[]> {
    const raw = await this.request<Array<{ statuses: Array<{ name: string }> }>>('GET', `/project/${encodeURIComponent(projectKey)}/statuses`);
    const names: string[] = [];
    for (const t of raw) for (const s of t.statuses) if (!names.includes(s.name)) names.push(s.name);
    return names;
  }

  search(params: { jql: string; nextPageToken?: string; maxResults?: number }): Promise<{ issues: JiraIssueRaw[]; isLast: boolean; nextPageToken?: string }> {
    return this.request('POST', '/search/jql', { jql: params.jql, fields: SEARCH_FIELDS, maxResults: params.maxResults ?? 50, ...(params.nextPageToken ? { nextPageToken: params.nextPageToken } : {}) });
  }

  createIssue(fields: JiraIssueFields): Promise<{ key: string; id: string }> {
    return this.request('POST', '/issue', fields);
  }

  /** Bulk create in chunks of 50. Returns created keys by input index and per-index failures. */
  async createIssues(list: JiraIssueFields[]): Promise<{ created: Array<{ index: number; key: string }>; failed: Array<{ index: number; error: string }> }> {
    const created: Array<{ index: number; key: string }> = [];
    const failed: Array<{ index: number; error: string }> = [];
    for (let start = 0; start < list.length; start += BULK_CHUNK) {
      const chunk = list.slice(start, start + BULK_CHUNK);
      const res = await this.request<{ issues: Array<{ key: string }>; errors: Array<{ status: number; failedElementNumber?: number; elementErrors?: unknown }> }>('POST', '/issue/bulk', { issueUpdates: chunk });
      const failedIdx = new Set<number>();
      for (const e of res.errors ?? []) {
        const i = e.failedElementNumber ?? -1;
        if (i >= 0) { failedIdx.add(i); failed.push({ index: start + i, error: extractJiraError(e.status, e.elementErrors) }); }
      }
      let next = 0;
      for (let i = 0; i < chunk.length; i++) {
        if (failedIdx.has(i)) continue;
        const issue = res.issues?.[next++];
        if (issue) created.push({ index: start + i, key: issue.key });
      }
    }
    return { created, failed };
  }

  transitions(key: string): Promise<JiraTransition[]> {
    return this.request<{ transitions: JiraTransition[] }>('GET', `/issue/${encodeURIComponent(key)}/transitions`).then((r) => r.transitions ?? []);
  }

  transition(key: string, transitionId: string): Promise<void> {
    return this.request('POST', `/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: transitionId } });
  }

  issue(key: string): Promise<JiraIssueRaw> {
    return this.request('GET', `/issue/${encodeURIComponent(key)}?fields=summary,status,issuetype,description`);
  }
}
```

- [ ] **Step 4: Run tests, lint, typecheck, commit**

Run: `npx vitest run src/main/jira && npx biome check src/main/jira && npx tsc --noEmit -p tsconfig.json`

```bash
git add src/main/jira/client.ts src/main/jira/__tests__/client.test.ts
git commit -m "feat(jira): REST v3 client with bulk creation, transitions, and retry"
```

---

### Task 4: Config resolution, push logic, status sync, handlers, preload, and wiring

**Files:**
- Create: `src/main/jira/config.ts`, `src/main/jira/push-milestone.ts`, `src/main/jira/status-sync.ts`, `src/main/ipc-handlers/jira/index.ts`, `src/preload/api/modules/jira-api.ts`
- Modify: `src/shared/types/integrations.ts` (append), `src/shared/constants/ipc.ts` (after `REQUIREMENTS_RELEASE`), `src/shared/types/ipc.ts` (after `requirementsRelease`), `src/preload/api/agent-api.ts`, `src/renderer/lib/browser-mock.ts` (after `requirementsRelease`), `src/main/ipc-handlers/index.ts`, `src/main/ipc-handlers/requirements-handlers.ts` (export the slug lock)
- Test: `src/main/jira/__tests__/push-milestone.test.ts`, `src/main/jira/__tests__/status-sync.test.ts`, `src/main/ipc-handlers/jira/__tests__/handlers.test.ts`

**Interfaces:**
- Consumes: `JiraClient` (Task 3), helpers (Tasks 1, 2), `createTaskInProject`, `readRequirements`/`writeRequirements`, `loadProjectEnvVars` from `src/main/ipc-handlers/context/utils.ts`, `projectStore.getProject/getTasks`.
- Produces:
  - `getJiraConfig(project): JiraProjectConfig | null` where `JiraProjectConfig = { baseUrl; email; apiToken; projectKey; issueType; epicIssueType; statusMap }` (null when disabled or credentials incomplete)
  - `createJiraClient(config): JiraClient`
  - `pushMilestoneToJira(project, slug, milestoneId, deps?): Promise<{ set: RequirementsSet; warnings: string[] }>`
  - `syncTaskStatus(projectId, taskId, status): Promise<{ synced: boolean; error?: string }>`, `scheduleJiraSync(projectId, taskId, status, delayMs = 500)`
  - `tryAcquireSlugLock(projectId, slug): (() => void) | null` exported from `requirements-handlers.ts`
  - channels `JIRA_CHECK_CONNECTION 'jira:checkConnection'`, `JIRA_GET_METADATA 'jira:getMetadata'`, `JIRA_SEARCH_ISSUES 'jira:searchIssues'`, `JIRA_IMPORT_ISSUES 'jira:importIssues'`, `JIRA_PUSH_MILESTONE 'jira:pushMilestone'`, `JIRA_RETRY_SYNC 'jira:retrySync'`
  - preload `jiraCheckConnection(projectId)`, `jiraGetMetadata(projectId)`, `jiraSearchIssues(projectId, params)`, `jiraImportIssues(projectId, keys)`, `jiraPushMilestone(projectId, slug, milestoneId)`, `jiraRetrySync(projectId, taskId)`
  - types `JiraConnectionStatus`, `JiraMetadata`, `JiraIssueSummary`, `JiraSearchParams`, `JiraSearchResult`, `JiraImportResult`

- [ ] **Step 1: Types and channels**

Append to `src/shared/types/integrations.ts`:

```ts
// ============================================
// Jira Integration Types
// ============================================

export interface JiraConnectionStatus { accountName: string; projectName?: string }
export interface JiraMetadata { issueTypes: string[]; statuses: string[] }
export interface JiraIssueSummary {
  key: string; summary: string; status: string; issueType: string; assignee?: string; updated: string; url: string; imported: boolean;
}
export interface JiraSearchParams { jql?: string; status?: string; pageToken?: string }
export interface JiraSearchResult { issues: JiraIssueSummary[]; nextPageToken?: string }
export interface JiraImportResult { imported: number; skipped: string[]; failed: Array<{ key: string; error: string }>; tasks: import('./task').Task[] }
```

(Use a normal `import type { Task } from './task';` at the top of the file if it does not already import it.)

`src/shared/constants/ipc.ts`, after `REQUIREMENTS_RELEASE`:

```ts
  // Jira integration
  JIRA_CHECK_CONNECTION: 'jira:checkConnection',
  JIRA_GET_METADATA: 'jira:getMetadata',
  JIRA_SEARCH_ISSUES: 'jira:searchIssues',
  JIRA_IMPORT_ISSUES: 'jira:importIssues',
  JIRA_PUSH_MILESTONE: 'jira:pushMilestone',
  JIRA_RETRY_SYNC: 'jira:retrySync',
```

- [ ] **Step 2: Write the failing tests**

`src/main/jira/__tests__/push-milestone.test.ts`:

```ts
// apps/desktop/src/main/jira/__tests__/push-milestone.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequirementsSet } from '../../../shared/types/requirements';

const { files, cfg, clientMock, fsMock } = vi.hoisted(() => ({
  files: { readRequirements: vi.fn(), writeRequirements: vi.fn() },
  cfg: { getJiraConfig: vi.fn(), createJiraClient: vi.fn() },
  clientMock: { createIssue: vi.fn(), createIssues: vi.fn(), browseUrl: (k: string) => `https://j/browse/${k}` },
  fsMock: { readFileSync: vi.fn(), writeFileSync: vi.fn(), existsSync: vi.fn(() => true) },
}));
vi.mock('../../brd/requirements-files', () => files);
vi.mock('../config', () => cfg);
vi.mock('node:fs', () => fsMock);

import { pushMilestoneToJira } from '../push-milestone';

const project = { id: 'p1', path: '/repo', autoBuildPath: '.auto-claude' };
const base: RequirementsSet = {
  version: 1, brdSlug: 'a', brdHash: 'H', status: 'approved', generatedAt: 't', requirements: [],
  milestones: [{ id: 'M1', name: 'Core', description: 'd', order: 1, included: true }],
  tasks: [
    { id: 'T1', title: 'One', description: 'd', milestoneId: 'M1', requirementIds: [], category: 'feature', order: 1, included: true },
    { id: 'T2', title: 'Two', description: 'd', milestoneId: 'M1', requirementIds: [], category: 'feature', order: 2, included: true },
  ],
  releases: { M1: { releasedAt: 't', tasks: [{ proposedTaskId: 'T1', specId: '001-one' }, { proposedTaskId: 'T2', specId: '002-two' }] } },
};

beforeEach(() => {
  vi.clearAllMocks();
  cfg.getJiraConfig.mockReturnValue({ baseUrl: 'https://j', email: 'e', apiToken: 't', projectKey: 'ACME', issueType: 'Task', epicIssueType: 'Epic', statusMap: {} });
  cfg.createJiraClient.mockReturnValue(clientMock);
  files.writeRequirements.mockImplementation(async (_p: string, _s: string, s: RequirementsSet) => s);
  fsMock.readFileSync.mockImplementation((p: string) => (String(p).endsWith('implementation_plan.json') ? JSON.stringify({ description: '# Body' }) : JSON.stringify({ sourceType: 'requirements' })));
});

describe('pushMilestoneToJira', () => {
  it('creates the epic, then issues in bulk, records keys, and stamps task metadata', async () => {
    files.readRequirements.mockResolvedValue(base);
    clientMock.createIssue.mockResolvedValue({ key: 'ACME-1', id: '1' });
    clientMock.createIssues.mockResolvedValue({ created: [{ index: 0, key: 'ACME-2' }, { index: 1, key: 'ACME-3' }], failed: [] });
    const r = await pushMilestoneToJira(project, 'a', 'M1');
    expect(clientMock.createIssue.mock.calls[0][0].fields).toMatchObject({ summary: 'Core', issuetype: { name: 'Epic' }, project: { key: 'ACME' } });
    expect(clientMock.createIssues.mock.calls[0][0][0].fields).toMatchObject({ summary: 'One', parent: { key: 'ACME-1' } });
    expect(r.set.releases?.M1.jira).toMatchObject({ epicKey: 'ACME-1', issues: { T1: 'ACME-2', T2: 'ACME-3' } });
    expect(r.warnings).toEqual([]);
    const stamped = fsMock.writeFileSync.mock.calls.filter(([p]) => String(p).endsWith('task_metadata.json'));
    expect(stamped).toHaveLength(2);
    expect(JSON.parse(stamped[0][1] as string)).toMatchObject({ jiraKey: 'ACME-2', jiraEpicKey: 'ACME-1', jiraUrl: 'https://j/browse/ACME-2' });
    expect(files.writeRequirements).toHaveBeenCalledTimes(2); // after epic, after batch
  });

  it('reuses an existing epic, skips keyed tasks, and warns on per-issue failures', async () => {
    const partial: RequirementsSet = { ...base, releases: { M1: { ...base.releases!.M1, jira: { epicKey: 'ACME-1', issues: { T1: 'ACME-2' }, pushedAt: 't' } } } };
    files.readRequirements.mockResolvedValue(partial);
    clientMock.createIssues.mockResolvedValue({ created: [], failed: [{ index: 0, error: 'nope' }] });
    const r = await pushMilestoneToJira(project, 'a', 'M1');
    expect(clientMock.createIssue).not.toHaveBeenCalled();
    expect(clientMock.createIssues.mock.calls[0][0]).toHaveLength(1);
    expect(r.warnings).toEqual(['Could not create a Jira issue for T2 (Two): nope']);
    expect(r.set.releases?.M1.jira?.issues).toEqual({ T1: 'ACME-2' });
  });

  it('refuses when Jira is not configured or the milestone is not released', async () => {
    files.readRequirements.mockResolvedValue(base);
    cfg.getJiraConfig.mockReturnValueOnce(null);
    await expect(pushMilestoneToJira(project, 'a', 'M1')).rejects.toThrow('Jira is not configured for this project');
    await expect(pushMilestoneToJira(project, 'a', 'M9')).rejects.toThrow('Release the milestone before pushing it to Jira');
  });
});
```

`src/main/jira/__tests__/status-sync.test.ts`:

```ts
// apps/desktop/src/main/jira/__tests__/status-sync.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { cfg, clientMock, fsMock, store } = vi.hoisted(() => ({
  cfg: { getJiraConfig: vi.fn(), createJiraClient: vi.fn() },
  clientMock: { transitions: vi.fn(), transition: vi.fn() },
  fsMock: { readFileSync: vi.fn(), writeFileSync: vi.fn(), existsSync: vi.fn(() => true) },
  store: { getProject: vi.fn(() => ({ id: 'p1', path: '/repo', autoBuildPath: '.auto-claude' })) },
}));
vi.mock('../config', () => cfg);
vi.mock('node:fs', () => fsMock);
vi.mock('../../project-store', () => ({ projectStore: store }));

import { scheduleJiraSync, syncTaskStatus } from '../status-sync';

beforeEach(() => {
  vi.clearAllMocks();
  cfg.getJiraConfig.mockReturnValue({ baseUrl: 'https://j', email: 'e', apiToken: 't', projectKey: 'ACME', issueType: 'Task', epicIssueType: 'Epic', statusMap: { backlog: 'To Do', queue: 'To Do', in_progress: 'In Progress', ai_review: 'In Progress', human_review: 'In Progress', done: 'Done', pr_created: 'Done', error: null } });
  cfg.createJiraClient.mockReturnValue(clientMock);
  fsMock.readFileSync.mockReturnValue(JSON.stringify({ jiraKey: 'ACME-2' }));
  clientMock.transitions.mockResolvedValue([{ id: '11', name: 'Start', to: { name: 'In Progress' } }, { id: '31', name: 'Finish', to: { name: 'Done' } }]);
  clientMock.transition.mockResolvedValue(undefined);
});

describe('syncTaskStatus', () => {
  it('posts the transition whose target matches the mapped status and records it', async () => {
    const r = await syncTaskStatus('p1', '001-t', 'done');
    expect(r).toEqual({ synced: true });
    expect(clientMock.transition).toHaveBeenCalledWith('ACME-2', '31');
    const written = JSON.parse(fsMock.writeFileSync.mock.calls[0][1] as string);
    expect(written).toMatchObject({ jiraKey: 'ACME-2', jiraSyncedStatus: 'Done' });
    expect(written.jiraSyncError).toBeUndefined();
  });
  it('does nothing for unlinked tasks, unmapped statuses, or disabled Jira', async () => {
    fsMock.readFileSync.mockReturnValueOnce(JSON.stringify({}));
    expect(await syncTaskStatus('p1', '001-t', 'done')).toEqual({ synced: false });
    expect(await syncTaskStatus('p1', '001-t', 'error')).toEqual({ synced: false });
    cfg.getJiraConfig.mockReturnValueOnce(null);
    expect(await syncTaskStatus('p1', '001-t', 'done')).toEqual({ synced: false });
    expect(clientMock.transition).not.toHaveBeenCalled();
  });
  it('records an error when no transition leads to the target', async () => {
    clientMock.transitions.mockResolvedValueOnce([{ id: '11', name: 'Start', to: { name: 'In Progress' } }]);
    const r = await syncTaskStatus('p1', '001-t', 'done');
    expect(r.synced).toBe(false);
    expect(r.error).toBe("No transition to 'Done' is available from the issue's current status");
    expect(JSON.parse(fsMock.writeFileSync.mock.calls[0][1] as string).jiraSyncError).toBe(r.error);
  });
  it('debounces rapid status changes into one transition', async () => {
    vi.useFakeTimers();
    scheduleJiraSync('p1', '001-t', 'in_progress', 50);
    scheduleJiraSync('p1', '001-t', 'done', 50);
    await vi.advanceTimersByTimeAsync(60);
    expect(clientMock.transitions).toHaveBeenCalledTimes(1);
    expect(clientMock.transition).toHaveBeenCalledWith('ACME-2', '31');
    vi.useRealTimers();
  });
});
```

`src/main/ipc-handlers/jira/__tests__/handlers.test.ts`:

```ts
// apps/desktop/src/main/ipc-handlers/jira/__tests__/handlers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { handlers, store, cfg, clientMock, createTask, push, sync } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  store: { getProject: vi.fn(), getTasks: vi.fn(() => []) },
  cfg: { getJiraConfig: vi.fn(), createJiraClient: vi.fn() },
  clientMock: { myself: vi.fn(), project: vi.fn(), statuses: vi.fn(), search: vi.fn(), issue: vi.fn(), browseUrl: (k: string) => `https://j/browse/${k}` },
  createTask: vi.fn(),
  push: { pushMilestoneToJira: vi.fn() },
  sync: { syncTaskStatus: vi.fn() },
}));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn((c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn)) } }));
vi.mock('../../../project-store', () => ({ projectStore: store }));
vi.mock('../../../jira/config', () => cfg);
vi.mock('../../task/create-task', () => ({ createTaskInProject: createTask }));
vi.mock('../../../jira/push-milestone', () => push);
vi.mock('../../../jira/status-sync', () => sync);
vi.mock('../../requirements-handlers', () => ({ tryAcquireSlugLock: vi.fn(() => () => undefined) }));

import { registerJiraHandlers } from '../index';

beforeEach(() => {
  handlers.clear(); vi.clearAllMocks();
  store.getProject.mockReturnValue({ id: 'p1', path: '/repo', autoBuildPath: '.auto-claude' });
  cfg.getJiraConfig.mockReturnValue({ baseUrl: 'https://j', email: 'e', apiToken: 't', projectKey: 'ACME', issueType: 'Task', epicIssueType: 'Epic', statusMap: {} });
  cfg.createJiraClient.mockReturnValue(clientMock);
  registerJiraHandlers();
});

describe('jira handlers', () => {
  it('checkConnection returns account and project names', async () => {
    clientMock.myself.mockResolvedValue({ accountId: '1', displayName: 'Ann' });
    clientMock.project.mockResolvedValue({ id: '1', key: 'ACME', name: 'Acme', issueTypes: [] });
    expect(await handlers.get('jira:checkConnection')!({}, 'p1')).toEqual({ success: true, data: { accountName: 'Ann', projectName: 'Acme' } });
  });
  it('refuses when Jira is not configured', async () => {
    cfg.getJiraConfig.mockReturnValueOnce(null);
    expect(await handlers.get('jira:checkConnection')!({}, 'p1')).toEqual({ success: false, error: 'Jira is not configured for this project' });
  });
  it('getMetadata lists non-subtask issue types and statuses', async () => {
    clientMock.project.mockResolvedValue({ id: '1', key: 'ACME', name: 'Acme', issueTypes: [{ id: '1', name: 'Task', subtask: false }, { id: '2', name: 'Sub-task', subtask: true }, { id: '3', name: 'Epic', subtask: false }] });
    clientMock.statuses.mockResolvedValue(['To Do', 'Done']);
    expect(await handlers.get('jira:getMetadata')!({}, 'p1')).toEqual({ success: true, data: { issueTypes: ['Task', 'Epic'], statuses: ['To Do', 'Done'] } });
  });
  it('searchIssues composes JQL and flags imported keys', async () => {
    store.getTasks.mockReturnValue([{ id: 'x', metadata: { jiraKey: 'ACME-2' } }]);
    clientMock.search.mockResolvedValue({ isLast: false, nextPageToken: 'n', issues: [{ key: 'ACME-2', fields: { summary: 'S', status: { name: 'To Do' }, issuetype: { name: 'Task' }, assignee: { displayName: 'Ann' }, updated: 'u' } }] });
    const r = (await handlers.get('jira:searchIssues')!({}, 'p1', { status: 'To Do', jql: 'labels = x' })) as { data: { issues: unknown[]; nextPageToken?: string } };
    expect(clientMock.search.mock.calls[0][0].jql).toBe('project = "ACME" AND status = "To Do" AND (labels = x) ORDER BY updated DESC');
    expect(r.data.issues[0]).toEqual({ key: 'ACME-2', summary: 'S', status: 'To Do', issueType: 'Task', assignee: 'Ann', updated: 'u', url: 'https://j/browse/ACME-2', imported: true });
    expect(r.data.nextPageToken).toBe('n');
  });
  it('importIssues skips linked keys, creates tasks, and reports failures', async () => {
    store.getTasks.mockReturnValue([{ id: 'x', metadata: { jiraKey: 'ACME-1' } }]);
    clientMock.issue.mockImplementation(async (key: string) => { if (key === 'ACME-3') throw new Error('boom'); return { key, fields: { summary: `Sum ${key}`, description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] } } }; });
    createTask.mockImplementation((_p: unknown, input: { title: string; metadata: unknown }) => ({ id: 's', specId: 's', title: input.title, metadata: input.metadata }));
    const r = (await handlers.get('jira:importIssues')!({}, 'p1', ['ACME-1', 'ACME-2', 'ACME-3'])) as { data: { imported: number; skipped: string[]; failed: unknown[]; tasks: unknown[] } };
    expect(r.data.imported).toBe(1);
    expect(r.data.skipped).toEqual(['ACME-1']);
    expect(r.data.failed).toEqual([{ key: 'ACME-3', error: 'boom' }]);
    const input = createTask.mock.calls[0][1];
    expect(input.title).toBe('Sum ACME-2');
    expect(input.description).toContain('Body');
    expect(input.description).toContain('Source: https://j/browse/ACME-2');
    expect(input.metadata).toEqual({ sourceType: 'jira', jiraKey: 'ACME-2', jiraUrl: 'https://j/browse/ACME-2', category: 'feature' });
  });
  it('pushMilestone delegates under the slug lock and retrySync delegates', async () => {
    push.pushMilestoneToJira.mockResolvedValue({ set: { version: 1 }, warnings: ['w'] });
    expect(await handlers.get('jira:pushMilestone')!({}, 'p1', 'a', 'M1')).toEqual({ success: true, data: { set: { version: 1 }, warnings: ['w'] } });
    sync.syncTaskStatus.mockResolvedValue({ synced: true });
    store.getTasks.mockReturnValue([{ id: '001-t', specId: '001-t', status: 'done' }]);
    expect(await handlers.get('jira:retrySync')!({}, 'p1', '001-t')).toEqual({ success: true, data: { synced: true } });
    expect(sync.syncTaskStatus).toHaveBeenCalledWith('p1', '001-t', 'done');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/main/jira src/main/ipc-handlers/jira`
Expected: three files fail to import their modules.

- [ ] **Step 4: Config and lock**

Create `src/main/jira/config.ts`:

```ts
// apps/desktop/src/main/jira/config.ts
import type { JiraStatusMap } from '../../shared/jira/status-map';
import { loadProjectEnvVars } from '../ipc-handlers/context/utils';
import { JiraClient } from './client';
import { readJiraEnv } from './env';

export interface JiraProjectConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueType: string;
  epicIssueType: string;
  statusMap: JiraStatusMap;
}

/** Resolved Jira config for a project, or null when disabled or incomplete. */
export function getJiraConfig(project: { path: string; autoBuildPath?: string }): JiraProjectConfig | null {
  const env = readJiraEnv(loadProjectEnvVars(project.path, project.autoBuildPath));
  if (!env.jiraEnabled || !env.jiraBaseUrl || !env.jiraEmail || !env.jiraApiToken || !env.jiraStatusMap) return null;
  return {
    baseUrl: env.jiraBaseUrl,
    email: env.jiraEmail,
    apiToken: env.jiraApiToken,
    projectKey: env.jiraProjectKey ?? '',
    issueType: env.jiraIssueType ?? 'Task',
    epicIssueType: env.jiraEpicIssueType ?? 'Epic',
    statusMap: env.jiraStatusMap,
  };
}

export function createJiraClient(config: JiraProjectConfig): JiraClient {
  return new JiraClient({ baseUrl: config.baseUrl, email: config.email, apiToken: config.apiToken });
}
```

In `src/main/ipc-handlers/requirements-handlers.ts`, add after the `activeRuns` map:

```ts
/** Take the per-slug lock shared by generation, release, and Jira pushes. Returns a release function, or null when busy. */
export function tryAcquireSlugLock(projectId: string, slug: string): (() => void) | null {
  const key = `${projectId}:${slug}`;
  if (activeRuns.has(key)) return null;
  activeRuns.set(key, { runId: randomUUID(), slug, controller: new AbortController() });
  return () => activeRuns.delete(key);
}
```

and make the release handler use it: replace its `if (activeRuns.has(key)) return ...; activeRuns.set(key, ...)` pair with `const unlock = tryAcquireSlugLock(projectId, slug); if (!unlock) return { success: false, error: 'A run is already in progress for this BRD' };` and its `finally { activeRuns.delete(key); }` with `finally { unlock(); }`.

- [ ] **Step 5: Push logic**

Create `src/main/jira/push-milestone.ts`:

```ts
// apps/desktop/src/main/jira/push-milestone.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { buildEpicFields, buildTaskFields, pendingPushTasks } from '../../shared/jira/push';
import { getSpecsDir } from '../../shared/constants';
import type { MilestoneJiraRelease, RequirementsSet } from '../../shared/types/requirements';
import type { TaskMetadata } from '../../shared/types/task';
import { readRequirements, writeRequirements } from '../brd/requirements-files';
import { createJiraClient, getJiraConfig } from './config';

type ProjectRef = { id: string; path: string; autoBuildPath: string };

function specDir(project: ProjectRef, specId: string): string {
  return path.join(project.path, getSpecsDir(project.autoBuildPath), specId);
}

function taskDescription(project: ProjectRef, specId: string, fallback: string): string {
  const plan = path.join(specDir(project, specId), 'implementation_plan.json');
  try {
    const parsed = JSON.parse(readFileSync(plan, 'utf-8')) as { description?: string };
    return typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description : fallback;
  } catch {
    return fallback;
  }
}

function stampTaskMetadata(project: ProjectRef, specId: string, patch: Partial<TaskMetadata>): void {
  const file = path.join(specDir(project, specId), 'task_metadata.json');
  let current: TaskMetadata = {};
  try { if (existsSync(file)) current = JSON.parse(readFileSync(file, 'utf-8')) as TaskMetadata; } catch { /* rewrite below */ }
  writeFileSync(file, JSON.stringify({ ...current, ...patch }, null, 2), 'utf-8');
}

/**
 * Create the Epic and one issue per released task that has no key yet, recording
 * progress in the set after the epic and after each batch. Never creates duplicates.
 */
export async function pushMilestoneToJira(
  project: ProjectRef,
  slug: string,
  milestoneId: string,
): Promise<{ set: RequirementsSet; warnings: string[] }> {
  const config = getJiraConfig(project);
  if (!config) throw new Error('Jira is not configured for this project');
  if (!config.projectKey) throw new Error('Set a Jira project key before pushing');
  const stored = await readRequirements(project.path, slug);
  const entry = stored?.releases?.[milestoneId];
  if (!stored || !entry) throw new Error('Release the milestone before pushing it to Jira');
  const milestone = stored.milestones.find((m) => m.id === milestoneId);
  if (!milestone) throw new Error(`Milestone ${milestoneId} not found`);

  const client = createJiraClient(config);
  const warnings: string[] = [];
  let current = stored;

  const persist = async (jira: MilestoneJiraRelease): Promise<void> => {
    const rel = current.releases?.[milestoneId];
    if (!rel) return;
    current = await writeRequirements(project.path, slug, { ...current, releases: { ...(current.releases ?? {}), [milestoneId]: { ...rel, jira } } });
  };

  let jira: MilestoneJiraRelease | undefined = entry.jira;
  if (!jira) {
    const epic = await client.createIssue(buildEpicFields(config.projectKey, config.epicIssueType, milestone));
    jira = { epicKey: epic.key, issues: {}, pushedAt: new Date().toISOString() };
    await persist(jira);
  }

  const pending = pendingPushTasks(current, milestoneId);
  if (pending.length === 0) return { set: current, warnings };
  const byProposed = new Map(current.tasks.map((t) => [t.id, t]));
  const inputs = pending.map((p) => {
    const proposed = byProposed.get(p.proposedTaskId);
    const title = proposed?.title ?? p.specId;
    return buildTaskFields(config.projectKey, config.issueType, jira.epicKey, title, taskDescription(project, p.specId, proposed?.description ?? title));
  });
  const result = await client.createIssues(inputs);
  for (const f of result.failed) {
    const p = pending[f.index];
    const proposed = byProposed.get(p.proposedTaskId);
    warnings.push(`Could not create a Jira issue for ${p.proposedTaskId} (${proposed?.title ?? p.specId}): ${f.error}`);
  }
  if (result.created.length > 0) {
    const issues = { ...jira.issues };
    for (const c of result.created) {
      const p = pending[c.index];
      issues[p.proposedTaskId] = c.key;
      stampTaskMetadata(project, p.specId, { jiraKey: c.key, jiraUrl: client.browseUrl(c.key), jiraEpicKey: jira.epicKey });
    }
    jira = { ...jira, issues, pushedAt: new Date().toISOString() };
    await persist(jira);
  }
  return { set: current, warnings };
}
```

- [ ] **Step 6: Status sync**

Create `src/main/jira/status-sync.ts`:

```ts
// apps/desktop/src/main/jira/status-sync.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { getSpecsDir } from '../../shared/constants';
import { targetStatusFor } from '../../shared/jira/status-map';
import type { TaskMetadata, TaskStatus } from '../../shared/types/task';
import { projectStore } from '../project-store';
import { createJiraClient, getJiraConfig } from './config';

const timers = new Map<string, NodeJS.Timeout>();

function metadataPath(projectPath: string, autoBuildPath: string, taskId: string): string {
  return path.join(projectPath, getSpecsDir(autoBuildPath), taskId, 'task_metadata.json');
}

/** Transition the linked Jira issue to the status mapped from the Kanban status. Never throws. */
export async function syncTaskStatus(projectId: string, taskId: string, status: TaskStatus): Promise<{ synced: boolean; error?: string }> {
  const project = projectStore.getProject(projectId);
  if (!project) return { synced: false };
  const config = getJiraConfig(project);
  if (!config) return { synced: false };
  const file = metadataPath(project.path, project.autoBuildPath, taskId);
  let metadata: TaskMetadata = {};
  try { if (existsSync(file)) metadata = JSON.parse(readFileSync(file, 'utf-8')) as TaskMetadata; } catch { return { synced: false }; }
  if (!metadata.jiraKey) return { synced: false };
  const target = targetStatusFor(config.statusMap, status);
  if (!target) return { synced: false };

  const write = (patch: Partial<TaskMetadata>) => writeFileSync(file, JSON.stringify({ ...metadata, ...patch }, null, 2), 'utf-8');
  try {
    const client = createJiraClient(config);
    const transitions = await client.transitions(metadata.jiraKey);
    const match = transitions.find((t) => t.to.name.toLowerCase() === target.toLowerCase());
    if (!match) {
      const error = `No transition to '${target}' is available from the issue's current status`;
      write({ jiraSyncError: error });
      return { synced: false, error };
    }
    await client.transition(metadata.jiraKey, match.id);
    const { jiraSyncError: _cleared, ...rest } = metadata;
    metadata = rest;
    write({ jiraSyncedStatus: target });
    return { synced: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(`[JiraSync] ${taskId}: ${error}`);
    write({ jiraSyncError: error });
    return { synced: false, error };
  }
}

/** Debounced sync: rapid status changes for one task send a single transition for the last status. */
export function scheduleJiraSync(projectId: string, taskId: string, status: TaskStatus, delayMs = 500): void {
  const key = `${projectId}:${taskId}`;
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    void syncTaskStatus(projectId, taskId, status);
  }, delayMs));
}
```

- [ ] **Step 7: Handlers**

Create `src/main/ipc-handlers/jira/index.ts`:

```ts
// apps/desktop/src/main/ipc-handlers/jira/index.ts
import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/constants';
import { adfToText } from '../../../shared/jira/adf';
import type { IPCResult, Task } from '../../../shared/types';
import type { JiraConnectionStatus, JiraImportResult, JiraMetadata, JiraSearchParams, JiraSearchResult } from '../../../shared/types/integrations';
import type { RequirementsSet } from '../../../shared/types/requirements';
import { createJiraClient, getJiraConfig } from '../../jira/config';
import { pushMilestoneToJira } from '../../jira/push-milestone';
import { syncTaskStatus } from '../../jira/status-sync';
import { projectStore } from '../../project-store';
import { tryAcquireSlugLock } from '../requirements-handlers';
import { createTaskInProject } from '../task/create-task';

const NOT_CONFIGURED = 'Jira is not configured for this project';

function fail(err: unknown): IPCResult<never> {
  return { success: false, error: err instanceof Error ? err.message : String(err) };
}

function linkedKeys(projectId: string): Set<string> {
  const keys = new Set<string>();
  for (const t of projectStore.getTasks(projectId)) if (t.metadata?.jiraKey) keys.add(t.metadata.jiraKey);
  return keys;
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function registerJiraHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.JIRA_CHECK_CONNECTION, async (_e, projectId: string): Promise<IPCResult<JiraConnectionStatus>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    const config = getJiraConfig(project);
    if (!config) return { success: false, error: NOT_CONFIGURED };
    try {
      const client = createJiraClient(config);
      const me = await client.myself();
      const data: JiraConnectionStatus = { accountName: me.displayName };
      if (config.projectKey) data.projectName = (await client.project(config.projectKey)).name;
      return { success: true, data };
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(IPC_CHANNELS.JIRA_GET_METADATA, async (_e, projectId: string): Promise<IPCResult<JiraMetadata>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    const config = getJiraConfig(project);
    if (!config) return { success: false, error: NOT_CONFIGURED };
    if (!config.projectKey) return { success: false, error: 'Set a Jira project key first' };
    try {
      const client = createJiraClient(config);
      const [proj, statuses] = await Promise.all([client.project(config.projectKey), client.statuses(config.projectKey)]);
      return { success: true, data: { issueTypes: proj.issueTypes.filter((t) => !t.subtask).map((t) => t.name), statuses } };
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(IPC_CHANNELS.JIRA_SEARCH_ISSUES, async (_e, projectId: string, params: JiraSearchParams = {}): Promise<IPCResult<JiraSearchResult>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    const config = getJiraConfig(project);
    if (!config) return { success: false, error: NOT_CONFIGURED };
    if (!config.projectKey) return { success: false, error: 'Set a Jira project key first' };
    try {
      const clauses = [`project = ${quote(config.projectKey)}`];
      if (params.status) clauses.push(`status = ${quote(params.status)}`);
      if (params.jql?.trim()) clauses.push(`(${params.jql.trim()})`);
      const client = createJiraClient(config);
      const page = await client.search({ jql: `${clauses.join(' AND ')} ORDER BY updated DESC`, nextPageToken: params.pageToken });
      const linked = linkedKeys(projectId);
      const issues = page.issues.map((i) => ({
        key: i.key,
        summary: i.fields.summary,
        status: i.fields.status?.name ?? '',
        issueType: i.fields.issuetype?.name ?? '',
        assignee: i.fields.assignee?.displayName,
        updated: i.fields.updated ?? '',
        url: client.browseUrl(i.key),
        imported: linked.has(i.key),
      }));
      return { success: true, data: { issues, ...(page.isLast ? {} : { nextPageToken: page.nextPageToken }) } };
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(IPC_CHANNELS.JIRA_IMPORT_ISSUES, async (_e, projectId: string, keys: string[]): Promise<IPCResult<JiraImportResult>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    const config = getJiraConfig(project);
    if (!config) return { success: false, error: NOT_CONFIGURED };
    const client = createJiraClient(config);
    const linked = linkedKeys(projectId);
    const result: JiraImportResult = { imported: 0, skipped: [], failed: [], tasks: [] };
    for (const key of keys) {
      if (linked.has(key)) { result.skipped.push(key); continue; }
      try {
        const issue = await client.issue(key);
        const url = client.browseUrl(key);
        const body = adfToText(issue.fields.description);
        const description = `${body ? `${body}\n\n` : ''}Source: ${url}`;
        const task: Task = createTaskInProject(project, {
          title: issue.fields.summary,
          description,
          metadata: { sourceType: 'jira', jiraKey: key, jiraUrl: url, category: 'feature' },
        });
        result.tasks.push(task);
        result.imported++;
        linked.add(key);
      } catch (err) {
        result.failed.push({ key, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { success: true, data: result };
  });

  ipcMain.handle(IPC_CHANNELS.JIRA_PUSH_MILESTONE, async (_e, projectId: string, slug: string, milestoneId: string): Promise<IPCResult<{ set: RequirementsSet; warnings: string[] }>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    const unlock = tryAcquireSlugLock(projectId, slug);
    if (!unlock) return { success: false, error: 'A run is already in progress for this BRD' };
    try {
      const data = await pushMilestoneToJira(project, slug, milestoneId);
      return { success: true, data };
    } catch (err) {
      return fail(err);
    } finally {
      unlock();
    }
  });

  ipcMain.handle(IPC_CHANNELS.JIRA_RETRY_SYNC, async (_e, projectId: string, taskId: string): Promise<IPCResult<{ synced: boolean; error?: string }>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    const task = projectStore.getTasks(projectId).find((t) => t.id === taskId || t.specId === taskId);
    if (!task) return { success: false, error: `Task not found: ${taskId}` };
    const data = await syncTaskStatus(projectId, task.specId ?? task.id, task.status);
    return { success: true, data };
  });
}
```

- [ ] **Step 8: Preload, ElectronAPI, mock, registration**

Create `src/preload/api/modules/jira-api.ts`:

```ts
// apps/desktop/src/preload/api/modules/jira-api.ts
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import type { JiraConnectionStatus, JiraImportResult, JiraMetadata, JiraSearchParams, JiraSearchResult } from '../../../shared/types/integrations';
import type { RequirementsSet } from '../../../shared/types/requirements';
import { invokeIpc } from './ipc-utils';

export interface JiraAPI {
  jiraCheckConnection: (projectId: string) => Promise<IPCResult<JiraConnectionStatus>>;
  jiraGetMetadata: (projectId: string) => Promise<IPCResult<JiraMetadata>>;
  jiraSearchIssues: (projectId: string, params: JiraSearchParams) => Promise<IPCResult<JiraSearchResult>>;
  jiraImportIssues: (projectId: string, keys: string[]) => Promise<IPCResult<JiraImportResult>>;
  jiraPushMilestone: (projectId: string, slug: string, milestoneId: string) => Promise<IPCResult<{ set: RequirementsSet; warnings: string[] }>>;
  jiraRetrySync: (projectId: string, taskId: string) => Promise<IPCResult<{ synced: boolean; error?: string }>>;
}

export const createJiraAPI = (): JiraAPI => ({
  jiraCheckConnection: (projectId) => invokeIpc(IPC_CHANNELS.JIRA_CHECK_CONNECTION, projectId),
  jiraGetMetadata: (projectId) => invokeIpc(IPC_CHANNELS.JIRA_GET_METADATA, projectId),
  jiraSearchIssues: (projectId, params) => invokeIpc(IPC_CHANNELS.JIRA_SEARCH_ISSUES, projectId, params),
  jiraImportIssues: (projectId, keys) => invokeIpc(IPC_CHANNELS.JIRA_IMPORT_ISSUES, projectId, keys),
  jiraPushMilestone: (projectId, slug, milestoneId) => invokeIpc(IPC_CHANNELS.JIRA_PUSH_MILESTONE, projectId, slug, milestoneId),
  jiraRetrySync: (projectId, taskId) => invokeIpc(IPC_CHANNELS.JIRA_RETRY_SYNC, projectId, taskId),
});
```

`src/preload/api/agent-api.ts`: import `createJiraAPI, JiraAPI`, add `JiraAPI` to the `AgentAPI extends` list, create `const jiraAPI = createJiraAPI();` and spread `...jiraAPI` into the returned object, and re-export the `JiraAPI` type alongside the others.

`src/shared/types/ipc.ts`, after the `requirementsRelease` line, add the six methods with the same signatures as `JiraAPI` (import the Jira types from `./integrations`).

`src/renderer/lib/browser-mock.ts`, after `requirementsRelease`:

```ts
  jiraCheckConnection: async () => ({ success: false, error: 'Not available in browser mock' }),
  jiraGetMetadata: async () => ({ success: false, error: 'Not available in browser mock' }),
  jiraSearchIssues: async () => ({ success: true, data: { issues: [] } }),
  jiraImportIssues: async () => ({ success: false, error: 'Not available in browser mock' }),
  jiraPushMilestone: async () => ({ success: false, error: 'Not available in browser mock' }),
  jiraRetrySync: async () => ({ success: false, error: 'Not available in browser mock' }),
```

`src/main/ipc-handlers/index.ts`: `import { registerJiraHandlers } from './jira';` and call `registerJiraHandlers();` right after `registerRequirementsHandlers(getMainWindow);`; add it to the re-export list if the file re-exports registrars.

- [ ] **Step 9: Run tests, lint, typecheck, commit**

Run: `npx vitest run src/main/jira src/main/ipc-handlers/jira src/main/ipc-handlers/__tests__/requirements-handlers.test.ts && npx biome check src/main/jira src/main/ipc-handlers/jira src/preload/api/modules/jira-api.ts && npx tsc --noEmit -p tsconfig.json`
Expected: all pass.

```bash
git add src/shared/types/integrations.ts src/shared/constants/ipc.ts src/shared/types/ipc.ts src/main/jira src/main/ipc-handlers/jira src/main/ipc-handlers/requirements-handlers.ts src/preload/api/modules/jira-api.ts src/preload/api/agent-api.ts src/renderer/lib/browser-mock.ts src/main/ipc-handlers/index.ts
git commit -m "feat(jira): config, push milestone, status sync, handlers, and preload API"
```

---

### Task 5: Release push hook, status hook, and warnings in the Requirements tab

**Files:**
- Modify: `src/main/ipc-handlers/requirements-handlers.ts` (release handler), `src/main/task-state-manager.ts` (`emitStatus`), `src/preload/api/modules/requirements-api.ts` and `src/shared/types/ipc.ts` (release result gains `warnings`), `src/renderer/stores/requirements-store.ts`, `src/renderer/components/requirements/set/RequirementsTab.tsx`
- Test: `src/main/ipc-handlers/__tests__/requirements-handlers.test.ts`, `src/renderer/stores/__tests__/requirements-store.test.ts`

**Interfaces:**
- Release IPC result becomes `{ set: RequirementsSet; tasks: Task[]; warnings: string[] }`.
- Store gains `releaseWarnings: string[]`, `pushToJira(projectId, milestoneId)`, `isPushing: boolean`.

- [ ] **Step 1: Write the failing tests**

In `requirements-handlers.test.ts`, extend the hoisted block with `jiraPush: { pushMilestoneToJira: vi.fn() }, jiraCfg: { getJiraConfig: vi.fn(() => null) }`, add `vi.mock('../../jira/push-milestone', () => jiraPush); vi.mock('../../jira/config', () => jiraCfg);`, and append:

```ts
  it('release pushes to Jira when configured and turns push failures into warnings', async () => {
    files.readRequirements.mockResolvedValue(approved);
    files.writeRequirements.mockImplementation(async (_p: string, _s: string, s: RequirementsSet) => s);
    createTask.mockReturnValueOnce(madeTask('001-t'));
    jiraCfg.getJiraConfig.mockReturnValueOnce({ projectKey: 'ACME' });
    jiraPush.pushMilestoneToJira.mockRejectedValueOnce(new Error('Jira down'));
    const r = (await handlers.get('requirements:release')!({}, 'p1', 'a', 'M1')) as { success: boolean; data: { warnings: string[]; set: RequirementsSet } };
    expect(r.success).toBe(true);
    expect(r.data.warnings).toEqual(['Jira push failed: Jira down']);
    expect(r.data.set.releases?.M1.tasks).toHaveLength(1);
  });

  it('release without Jira returns no warnings', async () => {
    files.readRequirements.mockResolvedValue(approved);
    files.writeRequirements.mockImplementation(async (_p: string, _s: string, s: RequirementsSet) => s);
    createTask.mockReturnValueOnce(madeTask('001-t'));
    const r = (await handlers.get('requirements:release')!({}, 'p1', 'a', 'M1')) as { data: { warnings: string[] } };
    expect(r.data.warnings).toEqual([]);
    expect(jiraPush.pushMilestoneToJira).not.toHaveBeenCalled();
  });
```

In `requirements-store.test.ts`, add `jiraPushMilestone: vi.fn()` to `api`, and append:

```ts
  it('release keeps warnings and pushToJira installs the returned set', async () => {
    api.requirementsRead.mockResolvedValue({ success: true, data: { set: approved, currentBrdHash: 'H' } });
    await useRequirementsStore.getState().load('p1', 'a');
    api.requirementsRelease.mockResolvedValue({ success: true, data: { set: released, tasks: [], warnings: ['Jira push failed: x'] } });
    await useRequirementsStore.getState().release('p1', 'M1');
    expect(useRequirementsStore.getState().releaseWarnings).toEqual(['Jira push failed: x']);
    const pushed = { ...released, releases: { M1: { ...released.releases!.M1, jira: { epicKey: 'ACME-1', issues: { T1: 'ACME-2' }, pushedAt: 't' } } } };
    api.jiraPushMilestone.mockResolvedValue({ success: true, data: { set: pushed, warnings: [] } });
    await useRequirementsStore.getState().pushToJira('p1', 'M1');
    expect(api.jiraPushMilestone).toHaveBeenCalledWith('p1', 'a', 'M1');
    const s = useRequirementsStore.getState();
    expect(s.set?.releases?.M1.jira?.epicKey).toBe('ACME-1');
    expect(s.releaseWarnings).toEqual([]);
    expect(s.isPushing).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/ipc-handlers/__tests__/requirements-handlers.test.ts src/renderer/stores/__tests__/requirements-store.test.ts`
Expected: the three new tests fail.

- [ ] **Step 3: Release hook**

In `requirements-handlers.ts`: import `getJiraConfig` from `'../jira/config'` and `pushMilestoneToJira` from `'../jira/push-milestone'`; change the release handler's return type to `IPCResult<{ set: RequirementsSet; tasks: Task[]; warnings: string[] }>` and replace its final `return { success: true, data: { set: current, tasks: created } };` with:

```ts
        const warnings: string[] = [];
        if (created.length > 0 && getJiraConfig(project)) {
          try {
            // The lock is already held by this handler; push reads and writes the set file directly.
            const pushed = await pushMilestoneToJira(project, slug, milestoneId);
            current = pushed.set;
            warnings.push(...pushed.warnings);
          } catch (err) {
            warnings.push(`Jira push failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return { success: true, data: { set: current, tasks: created, warnings } };
```

Update the `requirementsRelease` signature in `requirements-api.ts` and `src/shared/types/ipc.ts` to the new result shape.

- [ ] **Step 4: Status hook**

In `src/main/task-state-manager.ts`: `import { scheduleJiraSync } from './jira/status-sync';` and at the end of `emitStatus` (after `safeSendToRenderer(...)`) add:

```ts
    if (projectId) scheduleJiraSync(projectId, taskId, status);
```

If `task-state-manager` has tests that mock its imports, add `vi.mock('../jira/status-sync', () => ({ scheduleJiraSync: vi.fn() }))` there.

- [ ] **Step 5: Store and tab**

In `requirements-store.ts`: add to state `releaseWarnings: string[]` and `isPushing: boolean` (initial `[]` and `false`), `pushToJira: (projectId: string, milestoneId: string) => Promise<void>` to the interface; in `release` on success set `releaseWarnings: result.data.warnings ?? []` (and `[]` on the failure path before the error); add:

```ts
    pushToJira: async (projectId, milestoneId) => {
      const { slug } = get();
      if (!slug) return;
      set({ isPushing: true, error: null });
      const result = await window.electronAPI.jiraPushMilestone(projectId, slug, milestoneId);
      if (!result.success || !result.data) {
        set({ error: result.error ?? 'Unknown error', isPushing: false });
        return;
      }
      const next = result.data.set;
      set({ set: next, savedSet: next, warnings: validateRequirementsSet(next), releaseWarnings: result.data.warnings, isPushing: false });
    },
```

In `RequirementsTab.tsx`, under the existing error line, render the warnings:

```tsx
      {releaseWarnings.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-amber-600">{releaseWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}
```

(destructure `releaseWarnings` from the store).

- [ ] **Step 6: Run tests, typecheck, commit**

Run: `npx vitest run src/main/ipc-handlers/__tests__/requirements-handlers.test.ts src/renderer/stores src/renderer/components/requirements src/main/__tests__ && npx tsc --noEmit -p tsconfig.json`

```bash
git add src/main/ipc-handlers/requirements-handlers.ts src/main/ipc-handlers/__tests__/requirements-handlers.test.ts src/main/task-state-manager.ts src/preload/api/modules/requirements-api.ts src/shared/types/ipc.ts src/renderer/stores/requirements-store.ts src/renderer/stores/__tests__/requirements-store.test.ts src/renderer/components/requirements/set/RequirementsTab.tsx
git commit -m "feat(jira): push on release with warnings and transition on task status change"
```

---

### Task 6: Settings section and i18n

**Files:**
- Create: `src/renderer/components/settings/integrations/JiraIntegration.tsx`, `src/shared/i18n/locales/en/jira.json`, `src/shared/i18n/locales/fr/jira.json`
- Modify: `src/renderer/components/settings/integrations/index.ts`, `src/renderer/components/settings/ProjectSettingsContent.tsx` (type), `src/renderer/components/settings/AppSettings.tsx` (nav item), `src/renderer/components/settings/sections/SectionRouter.tsx` (case), `src/shared/i18n/index.ts`, `src/shared/i18n/locales/{en,fr}/settings.json` (`projectSections.jira`), `src/shared/i18n/locales/{en,fr}/navigation.json` (`items.jiraIssues`)
- Test: `src/renderer/components/settings/integrations/__tests__/JiraIntegration.test.tsx`

**Interfaces:**
- `JiraIntegration({ projectId, envConfig, updateEnvConfig })`; `ProjectSettingsSection` gains `'jira'`; i18n namespace `jira`.

- [ ] **Step 1: i18n files**

`src/shared/i18n/locales/en/jira.json`:

```json
{
  "settings": {
    "enable": "Enable Jira",
    "enableHint": "Push released milestones to Jira and import Jira issues as tasks",
    "baseUrl": "Site URL",
    "baseUrlPlaceholder": "https://yourcompany.atlassian.net",
    "email": "Atlassian account email",
    "apiToken": "API token",
    "apiTokenHint": "Create one at id.atlassian.com under Security, API tokens",
    "test": "Test connection",
    "testing": "Testing…",
    "connected": "Connected as {{name}}",
    "connectedProject": "Connected as {{name}}, project {{project}}",
    "projectKey": "Project key",
    "issueType": "Issue type for tasks",
    "epicIssueType": "Issue type for milestones",
    "loadMetadata": "Load from Jira",
    "statusMap": "Status mapping",
    "statusMapHint": "Which Jira status each Kanban status moves the issue to",
    "notSynced": "Not synced",
    "kanbanStatus": {
      "backlog": "Backlog", "queue": "Queued", "in_progress": "In progress", "ai_review": "AI review",
      "human_review": "Human review", "done": "Done", "pr_created": "PR created", "error": "Error"
    }
  },
  "view": {
    "title": "Jira Issues",
    "subtitle": "Import issues from {{project}} as tasks",
    "notConnected": "Connect Jira in project settings to browse issues.",
    "openSettings": "Open Jira settings",
    "statusFilter": "Status",
    "anyStatus": "Any status",
    "jql": "JQL filter",
    "jqlPlaceholder": "labels = backend AND priority = High",
    "search": "Search summaries",
    "refresh": "Refresh",
    "loadMore": "Load more",
    "empty": "No issues match.",
    "imported": "Imported",
    "import": "Import {{count}} selected",
    "importing": "Importing…",
    "importResult": "{{imported}} imported, {{skipped}} skipped, {{failed}} failed"
  },
  "chip": {
    "push": "Push to Jira",
    "pushing": "Pushing…",
    "partial": "Partially pushed",
    "epic": "Epic {{key}}"
  },
  "detail": {
    "title": "Jira",
    "issue": "Issue",
    "epic": "Epic",
    "syncedStatus": "Last synced status",
    "syncError": "Sync error",
    "retry": "Retry sync",
    "retrying": "Retrying…"
  }
}
```

`src/shared/i18n/locales/fr/jira.json`:

```json
{
  "settings": {
    "enable": "Activer Jira",
    "enableHint": "Publier les jalons dans Jira et importer des tickets Jira comme tâches",
    "baseUrl": "URL du site",
    "baseUrlPlaceholder": "https://votresociete.atlassian.net",
    "email": "E-mail du compte Atlassian",
    "apiToken": "Jeton d'API",
    "apiTokenHint": "Créez-en un sur id.atlassian.com, rubrique Sécurité, jetons d'API",
    "test": "Tester la connexion",
    "testing": "Test…",
    "connected": "Connecté en tant que {{name}}",
    "connectedProject": "Connecté en tant que {{name}}, projet {{project}}",
    "projectKey": "Clé du projet",
    "issueType": "Type de ticket pour les tâches",
    "epicIssueType": "Type de ticket pour les jalons",
    "loadMetadata": "Charger depuis Jira",
    "statusMap": "Correspondance des statuts",
    "statusMapHint": "Vers quel statut Jira chaque statut Kanban déplace le ticket",
    "notSynced": "Non synchronisé",
    "kanbanStatus": {
      "backlog": "Backlog", "queue": "En file d'attente", "in_progress": "En cours", "ai_review": "Revue IA",
      "human_review": "Revue humaine", "done": "Terminé", "pr_created": "PR créée", "error": "Erreur"
    }
  },
  "view": {
    "title": "Tickets Jira",
    "subtitle": "Importer des tickets de {{project}} comme tâches",
    "notConnected": "Connectez Jira dans les paramètres du projet pour parcourir les tickets.",
    "openSettings": "Ouvrir les paramètres Jira",
    "statusFilter": "Statut",
    "anyStatus": "Tous les statuts",
    "jql": "Filtre JQL",
    "jqlPlaceholder": "labels = backend AND priority = High",
    "search": "Rechercher dans les résumés",
    "refresh": "Actualiser",
    "loadMore": "Charger plus",
    "empty": "Aucun ticket ne correspond.",
    "imported": "Importé",
    "import": "Importer {{count}} sélectionné(s)",
    "importing": "Importation…",
    "importResult": "{{imported}} importé(s), {{skipped}} ignoré(s), {{failed}} en échec"
  },
  "chip": {
    "push": "Publier dans Jira",
    "pushing": "Publication…",
    "partial": "Partiellement publié",
    "epic": "Epic {{key}}"
  },
  "detail": {
    "title": "Jira",
    "issue": "Ticket",
    "epic": "Epic",
    "syncedStatus": "Dernier statut synchronisé",
    "syncError": "Erreur de synchronisation",
    "retry": "Réessayer",
    "retrying": "Nouvelle tentative…"
  }
}
```

`src/shared/i18n/index.ts`: import `enJira`/`frJira` from the two files, add `jira: enJira` / `jira: frJira` to the resources, and add `'jira'` to the `ns` array.

`settings.json` (both locales), inside `projectSections` after `gitlab`:

```json
    "jira": {
      "title": "Jira",
      "description": "Jira Cloud sync",
      "integrationTitle": "Jira Integration",
      "integrationDescription": "Push milestones and import issues from Jira Cloud",
      "syncDescription": "Sync with Jira"
    },
```

French: `"title": "Jira", "description": "Synchronisation Jira Cloud", "integrationTitle": "Intégration Jira", "integrationDescription": "Publier les jalons et importer des tickets depuis Jira Cloud", "syncDescription": "Synchroniser avec Jira"`.

`navigation.json` (both): add `"jiraIssues": "Jira Issues"` (fr: `"Tickets Jira"`) next to `gitlabIssues`.

- [ ] **Step 2: Write the failing component test**

```tsx
/**
 * @vitest-environment jsdom
 */
// apps/desktop/src/renderer/components/settings/integrations/__tests__/JiraIntegration.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { JiraIntegration } from '../JiraIntegration';
import type { ProjectEnvConfig } from '../../../../../shared/types';
import { DEFAULT_JIRA_STATUS_MAP } from '../../../../../shared/jira/status-map';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o && Object.keys(o).length ? `${k}:${Object.values(o).join(',')}` : k) }) }));

const api = { jiraCheckConnection: vi.fn(), jiraGetMetadata: vi.fn() };
const env = (over: Partial<ProjectEnvConfig> = {}): ProjectEnvConfig => ({
  linearEnabled: false, githubEnabled: false, gitlabEnabled: false, memoryEnabled: false, enableFancyUi: true, openaiKeyIsGlobal: false,
  jiraEnabled: true, jiraBaseUrl: 'https://acme.atlassian.net', jiraEmail: 'a@b.c', jiraApiToken: 't', jiraProjectKey: 'ACME', jiraStatusMap: DEFAULT_JIRA_STATUS_MAP,
  ...over,
} as ProjectEnvConfig);

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
});

describe('JiraIntegration', () => {
  it('tests the connection and shows the account and project', async () => {
    api.jiraCheckConnection.mockResolvedValue({ success: true, data: { accountName: 'Ann', projectName: 'Acme' } });
    render(<JiraIntegration projectId="p1" envConfig={env()} updateEnvConfig={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.test' }));
    expect(await screen.findByText('settings.connectedProject:Ann,Acme')).toBeInTheDocument();
    expect(api.jiraCheckConnection).toHaveBeenCalledWith('p1');
  });

  it('shows the error from a failed test', async () => {
    api.jiraCheckConnection.mockResolvedValue({ success: false, error: 'HTTP 401' });
    render(<JiraIntegration projectId="p1" envConfig={env()} updateEnvConfig={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.test' }));
    expect(await screen.findByText('HTTP 401')).toBeInTheDocument();
  });

  it('loads metadata into the selects and updates the status map', async () => {
    api.jiraGetMetadata.mockResolvedValue({ success: true, data: { issueTypes: ['Task', 'Story', 'Epic'], statuses: ['To Do', 'In Review', 'Done'] } });
    const update = vi.fn();
    render(<JiraIntegration projectId="p1" envConfig={env()} updateEnvConfig={update} />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.loadMetadata' }));
    await waitFor(() => expect(screen.getByLabelText('settings.issueType')).toHaveDisplayValue('Task'));
    fireEvent.change(screen.getByLabelText('settings.issueType'), { target: { value: 'Story' } });
    expect(update).toHaveBeenCalledWith({ jiraIssueType: 'Story' });
    fireEvent.change(screen.getByLabelText('settings.kanbanStatus.human_review'), { target: { value: 'In Review' } });
    expect(update).toHaveBeenCalledWith({ jiraStatusMap: { ...DEFAULT_JIRA_STATUS_MAP, human_review: 'In Review' } });
    fireEvent.change(screen.getByLabelText('settings.kanbanStatus.error'), { target: { value: '' } });
    expect(update).toHaveBeenLastCalledWith({ jiraStatusMap: { ...DEFAULT_JIRA_STATUS_MAP, error: null } });
  });

  it('hides the form when disabled and toggles the flag', () => {
    const update = vi.fn();
    render(<JiraIntegration projectId="p1" envConfig={env({ jiraEnabled: false })} updateEnvConfig={update} />);
    expect(screen.queryByLabelText('settings.baseUrl')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch'));
    expect(update).toHaveBeenCalledWith({ jiraEnabled: true });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/settings/integrations/__tests__/JiraIntegration.test.tsx`
Expected: FAIL, cannot find `../JiraIntegration`.

- [ ] **Step 4: Write the component**

```tsx
// apps/desktop/src/renderer/components/settings/integrations/JiraIntegration.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertCircle, Loader2, RefreshCw } from 'lucide-react';

import { DEFAULT_JIRA_STATUS_MAP, TASK_STATUSES, type JiraStatusMap } from '../../../../shared/jira/status-map';
import type { ProjectEnvConfig } from '../../../../shared/types';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Separator } from '../../ui/separator';
import { Switch } from '../../ui/switch';
import { PasswordInput } from '../../project-settings/PasswordInput';

interface JiraIntegrationProps {
  projectId: string;
  envConfig: ProjectEnvConfig | null;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;
}

const selectClass = 'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm';

export function JiraIntegration({ projectId, envConfig, updateEnvConfig }: JiraIntegrationProps) {
  const { t } = useTranslation('jira');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [meta, setMeta] = useState<{ issueTypes: string[]; statuses: string[] } | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const enabled = envConfig?.jiraEnabled ?? false;
  const statusMap: JiraStatusMap = envConfig?.jiraStatusMap ?? DEFAULT_JIRA_STATUS_MAP;
  const issueType = envConfig?.jiraIssueType ?? 'Task';
  const epicType = envConfig?.jiraEpicIssueType ?? 'Epic';

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    const r = await window.electronAPI.jiraCheckConnection(projectId);
    setTesting(false);
    if (!r.success || !r.data) { setTestResult({ ok: false, message: r.error ?? 'Unknown error' }); return; }
    setTestResult({ ok: true, message: r.data.projectName ? t('settings.connectedProject', { name: r.data.accountName, project: r.data.projectName }) : t('settings.connected', { name: r.data.accountName }) });
  };

  const loadMeta = async () => {
    setLoadingMeta(true);
    setMetaError(null);
    const r = await window.electronAPI.jiraGetMetadata(projectId);
    setLoadingMeta(false);
    if (!r.success || !r.data) { setMetaError(r.error ?? 'Unknown error'); return; }
    setMeta(r.data);
  };

  const setStatus = (status: (typeof TASK_STATUSES)[number], value: string) => {
    updateEnvConfig({ jiraStatusMap: { ...statusMap, [status]: value === '' ? null : value } });
  };

  const typeOptions = (current: string) => Array.from(new Set([current, ...(meta?.issueTypes ?? [])]));
  const statusOptions = (current: string | null) => Array.from(new Set([...(current ? [current] : []), ...(meta?.statuses ?? [])]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="font-normal text-foreground">{t('settings.enable')}</Label>
          <p className="text-xs text-muted-foreground">{t('settings.enableHint')}</p>
        </div>
        <Switch checked={enabled} onCheckedChange={(checked) => updateEnvConfig({ jiraEnabled: checked })} />
      </div>

      {enabled && (
        <>
          <div className="space-y-2">
            <Label htmlFor="jira-base-url">{t('settings.baseUrl')}</Label>
            <Input id="jira-base-url" value={envConfig?.jiraBaseUrl ?? ''} placeholder={t('settings.baseUrlPlaceholder')} onChange={(e) => updateEnvConfig({ jiraBaseUrl: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="jira-email">{t('settings.email')}</Label>
            <Input id="jira-email" value={envConfig?.jiraEmail ?? ''} onChange={(e) => updateEnvConfig({ jiraEmail: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>{t('settings.apiToken')}</Label>
            <p className="text-xs text-muted-foreground">{t('settings.apiTokenHint')}</p>
            <PasswordInput value={envConfig?.jiraApiToken ?? ''} onChange={(value) => updateEnvConfig({ jiraApiToken: value })} placeholder="ATATT3x…" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="jira-project-key">{t('settings.projectKey')}</Label>
            <Input id="jira-project-key" value={envConfig?.jiraProjectKey ?? ''} placeholder="ACME" onChange={(e) => updateEnvConfig({ jiraProjectKey: e.target.value.toUpperCase() })} />
          </div>

          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" disabled={testing} onClick={() => void test()}>
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {testing ? t('settings.testing') : t('settings.test')}
            </Button>
            {testResult && (
              <span className={`flex items-center gap-1 text-xs ${testResult.ok ? 'text-success' : 'text-destructive'}`}>
                {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                {testResult.message}
              </span>
            )}
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <Label className="font-medium">{t('settings.statusMap')}</Label>
            <Button size="sm" variant="ghost" disabled={loadingMeta} onClick={() => void loadMeta()}>
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loadingMeta ? 'animate-spin' : ''}`} />
              {t('settings.loadMetadata')}
            </Button>
          </div>
          {metaError && <p className="text-xs text-destructive">{metaError}</p>}

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs">
              <span className="mb-1 block text-muted-foreground">{t('settings.issueType')}</span>
              <select aria-label={t('settings.issueType')} className={selectClass} value={issueType} onChange={(e) => updateEnvConfig({ jiraIssueType: e.target.value })}>
                {typeOptions(issueType).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-muted-foreground">{t('settings.epicIssueType')}</span>
              <select aria-label={t('settings.epicIssueType')} className={selectClass} value={epicType} onChange={(e) => updateEnvConfig({ jiraEpicIssueType: e.target.value })}>
                {typeOptions(epicType).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          </div>

          <p className="text-xs text-muted-foreground">{t('settings.statusMapHint')}</p>
          <div className="grid grid-cols-2 gap-2">
            {TASK_STATUSES.map((status) => (
              <label key={status} className="block text-xs">
                <span className="mb-1 block text-muted-foreground">{t(`settings.kanbanStatus.${status}`)}</span>
                <select aria-label={t(`settings.kanbanStatus.${status}`)} className={selectClass} value={statusMap[status] ?? ''} onChange={(e) => setStatus(status, e.target.value)}>
                  <option value="">{t('settings.notSynced')}</option>
                  {statusOptions(statusMap[status]).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

Export it from `integrations/index.ts`: `export { JiraIntegration } from './JiraIntegration';`.

- [ ] **Step 5: Wire the section**

- `ProjectSettingsContent.tsx`: `export type ProjectSettingsSection = 'general' | 'linear' | 'github' | 'gitlab' | 'jira' | 'memory' | 'skills';`
- `AppSettings.tsx`: import `Ticket` from `lucide-react` and add `{ id: 'jira', icon: Ticket },` after the gitlab entry in `projectNavItemsConfig`.
- `SectionRouter.tsx`: import `JiraIntegration` from `'../integrations/JiraIntegration'` and add a case after `'gitlab'`:

```tsx
    case 'jira':
      return (
        <SettingsSection
          title={t('projectSections.jira.integrationTitle')}
          description={t('projectSections.jira.integrationDescription')}
        >
          <InitializationGuard
            initialized={!!project.autoBuildPath}
            title={t('projectSections.jira.integrationTitle')}
            description={t('projectSections.jira.syncDescription')}
          >
            <JiraIntegration projectId={project.id} envConfig={envConfig} updateEnvConfig={updateEnvConfig} />
          </InitializationGuard>
        </SettingsSection>
      );
```

If `AppSettings` derives nav labels from `projectSections.<id>.title`, the new keys cover it; check with typecheck and a quick render test run.

- [ ] **Step 6: Run tests, lint, typecheck, commit**

Run: `npx vitest run src/renderer/components/settings src/shared/i18n && npx biome check src/renderer/components/settings/integrations/JiraIntegration.tsx src/shared/i18n/locales/en/jira.json src/shared/i18n/locales/fr/jira.json && npx tsc --noEmit -p tsconfig.json`

```bash
git add src/renderer/components/settings src/shared/i18n
git commit -m "feat(jira): project settings section with connection test and status mapping"
```

---

### Task 7: Jira Issues view

**Files:**
- Create: `src/renderer/stores/jira/issues-store.ts`, `src/renderer/components/JiraIssues.tsx`
- Modify: `src/renderer/components/Sidebar.tsx` (view type, nav item, gating), `src/renderer/App.tsx` (route)
- Test: `src/renderer/stores/jira/__tests__/issues-store.test.ts`, `src/renderer/components/__tests__/JiraIssues.test.tsx`

**Interfaces:**
- Store: `issues: JiraIssueSummary[]`, `nextPageToken?: string`, `filters: { status: string; jql: string; search: string }`, `selection: string[]`, `isLoading`, `isImporting`, `error: string | null`, `lastImport: JiraImportResult | null`; actions `setFilter(patch)`, `load(projectId)`, `loadMore(projectId)`, `toggle(key)`, `clearSelection()`, `importSelected(projectId)`, `reset()`.
- `JiraIssues({ onOpenSettings })` component; `SidebarView` gains `'jira-issues'`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/stores/jira/__tests__/issues-store.test.ts`:

```ts
// apps/desktop/src/renderer/stores/jira/__tests__/issues-store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useJiraIssuesStore } from '../issues-store';

const { addTask } = vi.hoisted(() => ({ addTask: vi.fn() }));
vi.mock('../../task-store', () => ({ useTaskStore: { getState: () => ({ addTask }) } }));

const api = { jiraSearchIssues: vi.fn(), jiraImportIssues: vi.fn() };
const issue = (key: string, imported = false) => ({ key, summary: `S ${key}`, status: 'To Do', issueType: 'Task', updated: 'u', url: `https://j/${key}`, imported });

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { window: unknown }).window = { electronAPI: api };
  useJiraIssuesStore.getState().reset();
});

describe('jira issues store', () => {
  it('load applies filters, loadMore appends with the page token', async () => {
    api.jiraSearchIssues.mockResolvedValueOnce({ success: true, data: { issues: [issue('A-1')], nextPageToken: 'n' } });
    useJiraIssuesStore.getState().setFilter({ status: 'To Do', jql: 'labels = x' });
    await useJiraIssuesStore.getState().load('p1');
    expect(api.jiraSearchIssues).toHaveBeenCalledWith('p1', { status: 'To Do', jql: 'labels = x' });
    api.jiraSearchIssues.mockResolvedValueOnce({ success: true, data: { issues: [issue('A-2')] } });
    await useJiraIssuesStore.getState().loadMore('p1');
    expect(api.jiraSearchIssues).toHaveBeenLastCalledWith('p1', { status: 'To Do', jql: 'labels = x', pageToken: 'n' });
    const s = useJiraIssuesStore.getState();
    expect(s.issues.map((i) => i.key)).toEqual(['A-1', 'A-2']);
    expect(s.nextPageToken).toBeUndefined();
  });
  it('search filters summaries locally without a request', async () => {
    api.jiraSearchIssues.mockResolvedValueOnce({ success: true, data: { issues: [issue('A-1'), { ...issue('A-2'), summary: 'Login page' }] } });
    await useJiraIssuesStore.getState().load('p1');
    useJiraIssuesStore.getState().setFilter({ search: 'login' });
    expect(useJiraIssuesStore.getState().visibleIssues().map((i) => i.key)).toEqual(['A-2']);
  });
  it('importSelected imports, marks issues imported, pushes tasks, and keeps the result', async () => {
    api.jiraSearchIssues.mockResolvedValueOnce({ success: true, data: { issues: [issue('A-1'), issue('A-2')] } });
    await useJiraIssuesStore.getState().load('p1');
    useJiraIssuesStore.getState().toggle('A-1');
    useJiraIssuesStore.getState().toggle('A-2');
    useJiraIssuesStore.getState().toggle('A-2');
    api.jiraImportIssues.mockResolvedValue({ success: true, data: { imported: 1, skipped: [], failed: [], tasks: [{ id: 't', specId: 't' }] } });
    await useJiraIssuesStore.getState().importSelected('p1');
    expect(api.jiraImportIssues).toHaveBeenCalledWith('p1', ['A-1']);
    expect(addTask).toHaveBeenCalledTimes(1);
    const s = useJiraIssuesStore.getState();
    expect(s.issues.find((i) => i.key === 'A-1')?.imported).toBe(true);
    expect(s.selection).toEqual([]);
    expect(s.lastImport?.imported).toBe(1);
  });
  it('surfaces API errors', async () => {
    api.jiraSearchIssues.mockResolvedValueOnce({ success: false, error: 'HTTP 401' });
    await useJiraIssuesStore.getState().load('p1');
    expect(useJiraIssuesStore.getState().error).toBe('HTTP 401');
  });
});
```

`src/renderer/components/__tests__/JiraIssues.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
// apps/desktop/src/renderer/components/__tests__/JiraIssues.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { JiraIssues } from '../JiraIssues';
import { useJiraIssuesStore } from '../../stores/jira/issues-store';
import { useProjectStore } from '../../stores/project-store';
import { useProjectEnvStore } from '../../stores/project-env-store';
import type { ProjectEnvConfig } from '../../../shared/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o && Object.keys(o).length ? `${k}:${Object.values(o).join(',')}` : k) }) }));
vi.mock('../../stores/task-store', () => ({ useTaskStore: { getState: () => ({ addTask: vi.fn() }) } }));

const api = { jiraSearchIssues: vi.fn(), jiraImportIssues: vi.fn() };
const issue = (key: string, imported = false) => ({ key, summary: `Sum ${key}`, status: 'To Do', issueType: 'Task', updated: '2026-09-21T00:00:00Z', url: `https://j/${key}`, imported });

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  useJiraIssuesStore.getState().reset();
  useProjectStore.setState({ projects: [{ id: 'p1', name: 'todo', path: '/p' }] as never, selectedProjectId: 'p1' } as never);
  useProjectEnvStore.setState({ projectId: 'p1', envConfig: { jiraEnabled: true, jiraProjectKey: 'ACME' } as ProjectEnvConfig });
});

describe('JiraIssues', () => {
  it('shows the not-connected state when Jira is disabled', () => {
    useProjectEnvStore.setState({ envConfig: { jiraEnabled: false } as ProjectEnvConfig });
    const onOpenSettings = vi.fn();
    render(<JiraIssues onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByRole('button', { name: 'view.openSettings' }));
    expect(onOpenSettings).toHaveBeenCalled();
  });
  it('loads issues, marks imported ones, selects, and imports', async () => {
    api.jiraSearchIssues.mockResolvedValue({ success: true, data: { issues: [issue('ACME-1'), issue('ACME-2', true)] } });
    api.jiraImportIssues.mockResolvedValue({ success: true, data: { imported: 1, skipped: [], failed: [], tasks: [] } });
    render(<JiraIssues onOpenSettings={vi.fn()} />);
    expect(await screen.findByText('Sum ACME-1')).toBeInTheDocument();
    expect(screen.getByText('view.imported')).toBeInTheDocument();
    expect(screen.getByLabelText('ACME-2')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('ACME-1'));
    fireEvent.click(screen.getByRole('button', { name: 'view.import:1' }));
    await waitFor(() => expect(api.jiraImportIssues).toHaveBeenCalledWith('p1', ['ACME-1']));
    expect(await screen.findByText('view.importResult:1,0,0')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/stores/jira src/renderer/components/__tests__/JiraIssues.test.tsx`
Expected: both fail to import.

- [ ] **Step 3: Write the store**

```ts
// apps/desktop/src/renderer/stores/jira/issues-store.ts
import { create } from 'zustand';

import type { JiraImportResult, JiraIssueSummary } from '../../../shared/types/integrations';
import { useTaskStore } from '../task-store';

interface Filters { status: string; jql: string; search: string }

interface JiraIssuesState {
  issues: JiraIssueSummary[];
  nextPageToken?: string;
  filters: Filters;
  selection: string[];
  isLoading: boolean;
  isImporting: boolean;
  error: string | null;
  lastImport: JiraImportResult | null;

  visibleIssues: () => JiraIssueSummary[];
  setFilter: (patch: Partial<Filters>) => void;
  load: (projectId: string) => Promise<void>;
  loadMore: (projectId: string) => Promise<void>;
  toggle: (key: string) => void;
  clearSelection: () => void;
  importSelected: (projectId: string) => Promise<void>;
  reset: () => void;
}

const initial = {
  issues: [] as JiraIssueSummary[],
  nextPageToken: undefined as string | undefined,
  filters: { status: '', jql: '', search: '' } as Filters,
  selection: [] as string[],
  isLoading: false,
  isImporting: false,
  error: null as string | null,
  lastImport: null as JiraImportResult | null,
};

export const useJiraIssuesStore = create<JiraIssuesState>((set, get) => {
  const params = (pageToken?: string) => {
    const { status, jql } = get().filters;
    return { ...(status ? { status } : {}), ...(jql.trim() ? { jql: jql.trim() } : {}), ...(pageToken ? { pageToken } : {}) };
  };
  const fetchPage = async (projectId: string, pageToken?: string) => {
    set({ isLoading: true, error: null });
    const result = await window.electronAPI.jiraSearchIssues(projectId, params(pageToken));
    if (!result.success || !result.data) {
      set({ error: result.error ?? 'Unknown error', isLoading: false });
      return null;
    }
    set({ isLoading: false });
    return result.data;
  };

  return {
    ...initial,
    visibleIssues: () => {
      const q = get().filters.search.trim().toLowerCase();
      return q ? get().issues.filter((i) => i.summary.toLowerCase().includes(q) || i.key.toLowerCase().includes(q)) : get().issues;
    },
    setFilter: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
    load: async (projectId) => {
      const page = await fetchPage(projectId);
      if (page) set({ issues: page.issues, nextPageToken: page.nextPageToken, selection: [] });
    },
    loadMore: async (projectId) => {
      const token = get().nextPageToken;
      if (!token) return;
      const page = await fetchPage(projectId, token);
      if (page) set((s) => ({ issues: [...s.issues, ...page.issues], nextPageToken: page.nextPageToken }));
    },
    toggle: (key) => set((s) => ({ selection: s.selection.includes(key) ? s.selection.filter((k) => k !== key) : [...s.selection, key] })),
    clearSelection: () => set({ selection: [] }),
    importSelected: async (projectId) => {
      const keys = get().selection;
      if (keys.length === 0) return;
      set({ isImporting: true, error: null });
      const result = await window.electronAPI.jiraImportIssues(projectId, keys);
      if (!result.success || !result.data) {
        set({ error: result.error ?? 'Unknown error', isImporting: false });
        return;
      }
      for (const task of result.data.tasks) useTaskStore.getState().addTask(task);
      const done = new Set([...result.data.tasks.map((t) => t.metadata?.jiraKey).filter(Boolean), ...result.data.skipped]);
      set((s) => ({
        issues: s.issues.map((i) => (done.has(i.key) ? { ...i, imported: true } : i)),
        selection: [],
        isImporting: false,
        lastImport: result.data,
      }));
    },
    reset: () => set({ ...initial, filters: { ...initial.filters } }),
  };
});
```

- [ ] **Step 4: Write the view**

```tsx
// apps/desktop/src/renderer/components/JiraIssues.tsx
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Import, Loader2, RefreshCw, Settings } from 'lucide-react';

import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { useJiraIssuesStore } from '../stores/jira/issues-store';
import { useProjectEnvStore } from '../stores/project-env-store';
import { useProjectStore } from '../stores/project-store';

interface JiraIssuesProps { onOpenSettings: () => void }

export function JiraIssues({ onOpenSettings }: JiraIssuesProps) {
  const { t } = useTranslation('jira');
  const projectId = useProjectStore((s) => s.selectedProjectId);
  const envConfig = useProjectEnvStore((s) => s.envConfig);
  const store = useJiraIssuesStore();
  const { issues, filters, selection, isLoading, isImporting, error, lastImport, nextPageToken } = store;
  const enabled = !!envConfig?.jiraEnabled;
  const visible = store.visibleIssues();

  useEffect(() => {
    if (projectId && enabled) void store.load(projectId);
    return () => store.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, enabled]);

  if (!enabled) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-sm text-muted-foreground">
        <p>{t('view.notConnected')}</p>
        <Button size="sm" variant="outline" onClick={onOpenSettings}><Settings className="mr-2 h-4 w-4" />{t('view.openSettings')}</Button>
      </div>
    );
  }
  if (!projectId) return null;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('view.title')}</h2>
          <p className="text-xs text-muted-foreground">{t('view.subtitle', { project: envConfig?.jiraProjectKey ?? '' })}</p>
        </div>
        <Button size="sm" variant="outline" disabled={isLoading} onClick={() => void store.load(projectId)}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />{t('view.refresh')}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Input aria-label={t('view.statusFilter')} placeholder={t('view.anyStatus')} value={filters.status} onChange={(e) => store.setFilter({ status: e.target.value })} onBlur={() => void store.load(projectId)} />
        <Input aria-label={t('view.jql')} placeholder={t('view.jqlPlaceholder')} value={filters.jql} onChange={(e) => store.setFilter({ jql: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void store.load(projectId); }} />
        <Input aria-label={t('view.search')} placeholder={t('view.search')} value={filters.search} onChange={(e) => store.setFilter({ search: e.target.value })} />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
      {lastImport && <p className="text-xs text-muted-foreground">{t('view.importResult', { imported: lastImport.imported, skipped: lastImport.skipped.length, failed: lastImport.failed.length })}</p>}

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        {visible.length === 0 && !isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">{t('view.empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((issue) => (
              <li key={issue.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Checkbox aria-label={issue.key} checked={selection.includes(issue.key)} disabled={issue.imported} onCheckedChange={() => store.toggle(issue.key)} />
                <span className="w-24 shrink-0 font-mono text-xs">{issue.key}</span>
                <span className="min-w-0 flex-1 truncate">{issue.summary}</span>
                <Badge variant="outline">{issue.status}</Badge>
                {issue.imported && <Badge variant="secondary">{t('view.imported')}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between">
        <Button size="sm" variant="ghost" disabled={!nextPageToken || isLoading} onClick={() => void store.loadMore(projectId)}>{t('view.loadMore')}</Button>
        <Button size="sm" disabled={selection.length === 0 || isImporting} onClick={() => void store.importSelected(projectId)}>
          {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Import className="mr-2 h-4 w-4" />}
          {isImporting ? t('view.importing') : t('view.import', { count: selection.length })}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Sidebar and App**

`Sidebar.tsx`: add `'jira-issues'` to `SidebarView`; add `const jiraNavItems: NavItem[] = [{ id: 'jira-issues', labelKey: 'navigation:items.jiraIssues', icon: Ticket, shortcut: 'J' }];` (import `Ticket` from `lucide-react`); read `const jiraEnabled = useProjectEnvStore((state) => state.envConfig?.jiraEnabled ?? false);` and push `jiraNavItems` in `visibleNavItems` when enabled, adding `jiraEnabled` to the memo deps.

`App.tsx`: import `JiraIssues` and render after the GitLab issues block:

```tsx
                {activeView === 'jira-issues' && (activeProjectId || selectedProjectId) && (
                  <JiraIssues
                    onOpenSettings={() => {
                      setSettingsInitialProjectSection('jira');
                      setIsSettingsDialogOpen(true);
                    }}
                  />
                )}
```

If keyboard shortcuts are mapped from nav items automatically, nothing else is needed; otherwise mirror how `'G'` opens GitHub issues for `'J'`.

- [ ] **Step 6: Run tests, lint, typecheck, commit**

Run: `npx vitest run src/renderer/stores/jira src/renderer/components/__tests__/JiraIssues.test.tsx src/renderer/components/Sidebar.test.tsx && npx biome check src/renderer/stores/jira src/renderer/components/JiraIssues.tsx src/renderer/components/Sidebar.tsx && npx tsc --noEmit -p tsconfig.json`
(Skip the Sidebar test path if that file does not exist.)

```bash
git add src/renderer/stores/jira src/renderer/components/JiraIssues.tsx src/renderer/components/__tests__/JiraIssues.test.tsx src/renderer/components/Sidebar.tsx src/renderer/App.tsx
git commit -m "feat(jira): Jira Issues view with filters, paging, and import"
```

---

### Task 8: Jira chips in the Requirements tab, task card badge, and task detail block

**Files:**
- Modify: `src/renderer/components/requirements/set/RequirementsSetEditor.tsx` (milestone header, task rows), `src/renderer/components/TaskCard.tsx` (badge and memo), `src/renderer/components/task-detail/TaskDetailModal.tsx`
- Create: `src/renderer/components/task-detail/TaskJira.tsx`
- Test: `src/renderer/components/requirements/set/__tests__/RequirementsSetEditor.test.tsx` (extend), `src/renderer/components/task-detail/__tests__/TaskJira.test.tsx`

**Interfaces:**
- `TaskJira({ task })`; editor reads `useProjectEnvStore` for `jiraEnabled` and the store's `pushToJira`, `isPushing`.

- [ ] **Step 1: Write the failing tests**

Append to `RequirementsSetEditor.test.tsx` (add `import { useProjectEnvStore } from '../../../../stores/project-env-store';` and `jiraPushMilestone: vi.fn()` to `api`):

```tsx
describe('RequirementsSetEditor Jira chips', () => {
  const pushed = { ...released, releases: { M1: { ...released.releases!.M1, jira: { epicKey: 'ACME-1', issues: { T1: 'ACME-2' }, pushedAt: 't' } } } };

  it('shows Push to Jira on a released, unpushed milestone when Jira is enabled and calls the store', () => {
    useProjectEnvStore.setState({ envConfig: { jiraEnabled: true } as never });
    useRequirementsStore.setState({ slug: 'a', set: released, savedSet: released, currentBrdHash: 'H' });
    api.jiraPushMilestone.mockResolvedValue({ success: true, data: { set: pushed, warnings: [] } });
    render(<RequirementsSetEditor projectId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: 'chip.push' }));
    expect(api.jiraPushMilestone).toHaveBeenCalledWith('p1', 'a', 'M1');
  });

  it('shows the epic link and issue chips when pushed, and nothing when Jira is disabled', () => {
    useProjectEnvStore.setState({ envConfig: { jiraEnabled: true, jiraBaseUrl: 'https://j' } as never });
    useRequirementsStore.setState({ slug: 'a', set: pushed, savedSet: pushed, currentBrdHash: 'H' });
    const { unmount } = render(<RequirementsSetEditor projectId="p1" />);
    expect(screen.getByText('chip.epic:ACME-1')).toBeInTheDocument();
    expect(screen.getByText('ACME-2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'chip.push' })).not.toBeInTheDocument();
    unmount();
    useProjectEnvStore.setState({ envConfig: { jiraEnabled: false } as never });
    render(<RequirementsSetEditor projectId="p1" />);
    expect(screen.queryByText('chip.epic:ACME-1')).not.toBeInTheDocument();
  });
});
```

The editor test's i18n mock must serve both namespaces; since `t` returns the key, `useTranslation('jira')` keys appear as `chip.push` etc. Keep the existing mock.

`src/renderer/components/task-detail/__tests__/TaskJira.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
// apps/desktop/src/renderer/components/task-detail/__tests__/TaskJira.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TaskJira } from '../TaskJira';
import type { Task } from '../../../../shared/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const api = { jiraRetrySync: vi.fn(), openExternal: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
});

describe('TaskJira', () => {
  it('renders nothing without a key', () => {
    const { container } = render(<TaskJira task={{ id: 't', projectId: 'p1', metadata: {} } as unknown as Task} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('shows key, epic, synced status, error, and retries', async () => {
    api.jiraRetrySync.mockResolvedValue({ success: true, data: { synced: true } });
    const task = { id: '001-t', specId: '001-t', projectId: 'p1', status: 'done', metadata: { jiraKey: 'ACME-2', jiraUrl: 'https://j/browse/ACME-2', jiraEpicKey: 'ACME-1', jiraSyncedStatus: 'In Progress', jiraSyncError: 'No transition' } } as unknown as Task;
    render(<TaskJira task={task} />);
    expect(screen.getByText('ACME-2')).toBeInTheDocument();
    expect(screen.getByText('ACME-1')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('No transition')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ACME-2'));
    expect(api.openExternal).toHaveBeenCalledWith('https://j/browse/ACME-2');
    fireEvent.click(screen.getByRole('button', { name: 'detail.retry' }));
    await waitFor(() => expect(api.jiraRetrySync).toHaveBeenCalledWith('p1', '001-t'));
    await waitFor(() => expect(screen.queryByText('No transition')).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/components/requirements/set src/renderer/components/task-detail/__tests__/TaskJira.test.tsx`
Expected: the new tests fail.

- [ ] **Step 3: Editor chips**

In `RequirementsSetEditor.tsx`:
- imports: `import { ExternalLink } from 'lucide-react';` (add to the existing lucide import), `import { isMilestonePushed } from '../../../../shared/jira/push';`, `import { useProjectEnvStore } from '../../../stores/project-env-store';`.
- a second translator: `const { t: tj } = useTranslation('jira');`
- destructure `pushToJira, isPushing` from the store; read `const jiraEnabled = useProjectEnvStore((s) => s.envConfig?.jiraEnabled ?? false);` and `const jiraBaseUrl = useProjectEnvStore((s) => s.envConfig?.jiraBaseUrl ?? '');`
- helper: `const jiraLink = (key: string) => (jiraBaseUrl ? `${jiraBaseUrl.replace(/\/+$/, '')}/browse/${key}` : undefined);`
- in `milestoneHeader`, when `entry && complete`, return a fragment with the Released badge plus the Jira chip:

```tsx
    if (entry && complete) {
      const jira = entry.jira;
      return (
        <span className="flex items-center gap-2">
          <Badge variant="secondary">{t('release.released', { date: fmtDate(entry.releasedAt) })}</Badge>
          {jiraEnabled && jira && (
            <a className="inline-flex items-center gap-1 text-xs text-info hover:underline" href={jiraLink(jira.epicKey) ?? '#'} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3" />{tj('chip.epic', { key: jira.epicKey })}
            </a>
          )}
          {jiraEnabled && jira && !isMilestonePushed(set, m.id) && <Badge variant="outline">{tj('chip.partial')}</Badge>}
          {jiraEnabled && (!jira || !isMilestonePushed(set, m.id)) && (
            <Button size="sm" variant="outline" disabled={isPushing} onClick={() => void pushToJira(projectId, m.id)}>
              {isPushing ? tj('chip.pushing') : tj('chip.push')}
            </Button>
          )}
        </span>
      );
    }
```

- in `statusChip`, after computing `status`, also render the issue key when present:

```tsx
    const issueKey = set.releases?.[/* milestone of this task */ set.tasks.find((x) => x.id === proposedTaskId)?.milestoneId ?? '']?.jira?.issues[proposedTaskId];
    return (
      <span className="flex items-center gap-1">
        {jiraEnabled && issueKey && (
          <a className="font-mono text-xs text-info hover:underline" href={jiraLink(issueKey) ?? '#'} target="_blank" rel="noopener noreferrer">{issueKey}</a>
        )}
        <Badge variant="outline" title={specId}>{status ? t(`release.status.${status}`) : t('release.statusUnavailable')}</Badge>
      </span>
    );
```

- [ ] **Step 4: Task card badge and detail block**

`TaskCard.tsx`: in the memo comparator add `prevTask.metadata?.jiraKey === nextTask.metadata?.jiraKey &&`; in the badge row, after the archived badge:

```tsx
            {task.metadata?.jiraKey && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 font-mono bg-info/10 text-info border-info/30">
                {task.metadata.jiraKey}
              </Badge>
            )}
```

Create `src/renderer/components/task-detail/TaskJira.tsx`:

```tsx
// apps/desktop/src/renderer/components/task-detail/TaskJira.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, RefreshCw } from 'lucide-react';

import type { Task } from '../../../shared/types';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

/** Jira link, epic, last synced status, and a retry for a failed transition. */
export function TaskJira({ task }: { task: Task }) {
  const { t } = useTranslation('jira');
  const key = task.metadata?.jiraKey;
  const [retrying, setRetrying] = useState(false);
  const [syncError, setSyncError] = useState<string | undefined>(task.metadata?.jiraSyncError);
  if (!key) return null;

  const retry = async () => {
    setRetrying(true);
    const r = await window.electronAPI.jiraRetrySync(task.projectId, task.specId ?? task.id);
    setRetrying(false);
    if (r.success && r.data) setSyncError(r.data.synced ? undefined : r.data.error);
    else setSyncError(r.error);
  };

  return (
    <div className="rounded-lg border border-border p-4 space-y-2 text-sm">
      <div className="font-medium">{t('detail.title')}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">{t('detail.issue')}</dt>
        <dd>
          <button type="button" className="inline-flex items-center gap-1 font-mono text-info hover:underline" onClick={() => task.metadata?.jiraUrl && void window.electronAPI.openExternal(task.metadata.jiraUrl)}>
            {key}<ExternalLink className="h-3 w-3" />
          </button>
        </dd>
        {task.metadata?.jiraEpicKey && (<><dt className="text-muted-foreground">{t('detail.epic')}</dt><dd className="font-mono">{task.metadata.jiraEpicKey}</dd></>)}
        {task.metadata?.jiraSyncedStatus && (<><dt className="text-muted-foreground">{t('detail.syncedStatus')}</dt><dd><Badge variant="outline">{task.metadata.jiraSyncedStatus}</Badge></dd></>)}
        {syncError && (
          <>
            <dt className="text-muted-foreground">{t('detail.syncError')}</dt>
            <dd className="flex items-center gap-2 text-destructive">
              <span>{syncError}</span>
              <Button size="sm" variant="outline" disabled={retrying} onClick={() => void retry()}>
                <RefreshCw className={`mr-1 h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} />{retrying ? t('detail.retrying') : t('detail.retry')}
              </Button>
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
```

`TaskDetailModal.tsx`: import `TaskJira` and render `<TaskJira task={task} />` right after `<TaskRequirements ... />` in the overview.

- [ ] **Step 5: Run tests, lint, typecheck, commit**

Run: `npx vitest run src/renderer/components/requirements src/renderer/components/task-detail src/renderer/components/TaskCard.test.tsx && npx biome check src/renderer/components/requirements/set src/renderer/components/TaskCard.tsx src/renderer/components/task-detail/TaskJira.tsx && npx tsc --noEmit -p tsconfig.json`
(Skip the TaskCard test path if that file does not exist.)

```bash
git add src/renderer/components/requirements/set src/renderer/components/TaskCard.tsx src/renderer/components/task-detail/TaskJira.tsx src/renderer/components/task-detail/__tests__/TaskJira.test.tsx src/renderer/components/task-detail/TaskDetailModal.tsx
git commit -m "feat(jira): Jira chips in the Requirements tab, task card badge, and task detail block"
```

---

### Task 9: Full gate and manual check

- [ ] **Step 1: Full suite, lint, typecheck**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all green (pre-existing lint warnings only).

- [ ] **Step 2: Manual check in the running app**

Needs a Jira Cloud site, an API token, and a project key with default issue types (Task, Epic). Kill leftover Electron processes, then `nvm use 24 && npm run dev:mcp` from the repo root.

1. Open the `todo` project settings, Jira: enable, fill site URL, email, token, project key; Test connection shows the account and project. Load from Jira fills the issue type selects and the status mapping options. Save.
2. Sidebar shows "Jira Issues" (J). Open it: issues list with status chips; tick two, Import; confirm the result line and two Backlog tasks whose cards show the key badge; the issues now show "Imported" and their checkboxes are disabled.
3. Requirements, Todo app, Requirements tab: milestone 1 (released earlier) shows "Push to Jira". Click it: the Epic chip appears with the key, each M1 task shows its issue key, and Jira shows the Epic with six child issues.
4. Release milestone 2: tasks appear in Backlog and the Jira chips appear on M2 without a manual push.
5. Start one released task, wait for it to reach Human review, open the task: the Jira block shows the key, epic, and "Last synced status: In Progress"; the Jira issue is In Progress.
6. In settings, map `human_review` to a status the workflow cannot reach from In Progress (or an invented name), save, move another task; task detail shows the sync error; fix the mapping and Retry sync clears it.
7. Confirm `docs/brd/todo-app.requirements.json` contains `releases.M1.jira` and `releases.M2.jira` with epic and issue keys, and `task_metadata.json` of a pushed task has `jiraKey`, `jiraUrl`, `jiraEpicKey`.

- [ ] **Step 3: Commit fixes from the manual check**

Commit with `fix(jira): ...` describing what the run exposed.

---

## Spec coverage checklist (self-review)

| Spec section | Task |
|---|---|
| Configuration and env keys | 1 |
| Data model (task metadata, release jira block, schema) | 1 |
| Pure helpers (ADF, status map, push) | 1, 2 |
| Jira client | 3 |
| Handlers, push behavior, release hook, status hook | 4, 5 |
| Preload, ElectronAPI, mock | 4 |
| Settings section, Jira Issues view, chips, badge, detail | 6, 7, 8 |
| i18n | 6 |
| Error handling table | 3, 4, 5, 8 |
| Testing list, manual check | every task; 9 |
