# Bitbucket Integration (3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open Bitbucket Cloud pull requests from finished tasks and commit/push `docs/brd` changes from the Requirements view.

**Architecture:** A `src/main/bitbucket/` module (env, config, remote detection, REST client, PR creation) mirrors `src/main/jira/`. The GitHub PR creator's push/context/body helpers move to a shared `pr-common.ts`; a small dispatcher picks Bitbucket or GitHub by the origin host and the task PR handler calls it. A `brd-git.ts` service stages, commits, and pushes `docs/brd`, driven by a Commit dialog in the BRD list.

**Tech Stack:** Electron main + preload + React renderer, TypeScript strict, Zustand, react-i18next, Vitest, Biome. Bitbucket Cloud REST 2.0 with basic auth (email + Atlassian API token).

**Spec:** `docs/superpowers/specs/2026-09-21-bitbucket-integration-design.md`

## Global Constraints

- All paths below are relative to `apps/desktop/`. Run commands from `apps/desktop/`.
- Work directly on `develop` (same as sub-projects 2 and 3a). Commit per task.
- No `@anthropic-ai/sdk`; AI calls stay in the existing `pr-common` helper via the `ai` package.
- Every user-facing string uses `react-i18next`; add keys to both `en` and `fr`.
- No `process.platform`; git runs through `execFileSync` with `getIsolatedGitEnv()`; tokens are passed as arguments, never through a shell, never logged.
- Bitbucket Cloud only. Base URL `https://api.bitbucket.org/2.0`. Draft PRs are ignored.
- Env keys: `BITBUCKET_ENABLED`, `BITBUCKET_EMAIL`, `BITBUCKET_API_TOKEN`, `BITBUCKET_WORKSPACE`, `BITBUCKET_REPO_SLUG`.
- Error strings: `Bitbucket is not configured for this project`, `Bitbucket request failed with HTTP <status>`, `Not a git repository`, `Failed to push branch: <stderr>`.

---

### Task 1: Env, config, remote parser, and type wiring

**Files:**
- Create: `src/shared/bitbucket/remote.ts`, `src/main/bitbucket/env.ts`, `src/main/bitbucket/config.ts`, `src/main/bitbucket/remote.ts`
- Modify: `src/shared/types/project.ts` (after the `jiraStatusMap` field), `src/main/ipc-handlers/env-handlers.ts` (three sites), `src/renderer/lib/mocks/integration-mock.ts` (after `jiraEnabled: false,`)
- Test: `src/shared/bitbucket/__tests__/remote.test.ts`, `src/main/bitbucket/__tests__/env.test.ts`

**Interfaces:**
- Produces: `parseBitbucketRemote(url): { workspace; repoSlug } | null`; `BITBUCKET_ENV_KEYS`, `readBitbucketEnv(vars)`, `bitbucketEnvUpdates(config)`; `BitbucketProjectConfig { email; apiToken; workspace: string; repoSlug: string }`, `getBitbucketConfig(project)`; `detectBitbucketRepo(projectPath): { workspace; repoSlug; remoteUrl } | null`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/desktop/src/shared/bitbucket/__tests__/remote.test.ts
import { describe, it, expect } from 'vitest';
import { parseBitbucketRemote } from '../remote';

describe('parseBitbucketRemote', () => {
  it.each([
    ['git@bitbucket.org:acme/todo.git', { workspace: 'acme', repoSlug: 'todo' }],
    ['ssh://git@bitbucket.org/acme/todo.git', { workspace: 'acme', repoSlug: 'todo' }],
    ['https://bitbucket.org/acme/todo', { workspace: 'acme', repoSlug: 'todo' }],
    ['https://ann@bitbucket.org/acme/todo.git', { workspace: 'acme', repoSlug: 'todo' }],
    ['https://bitbucket.org/acme/todo/', { workspace: 'acme', repoSlug: 'todo' }],
  ])('parses %s', (url, expected) => {
    expect(parseBitbucketRemote(url)).toEqual(expected);
  });

  it('returns null for other hosts and malformed urls', () => {
    expect(parseBitbucketRemote('git@github.com:acme/todo.git')).toBeNull();
    expect(parseBitbucketRemote('https://gitlab.com/acme/todo.git')).toBeNull();
    expect(parseBitbucketRemote('https://bitbucket.org/acme')).toBeNull();
    expect(parseBitbucketRemote('')).toBeNull();
  });
});
```

```ts
// apps/desktop/src/main/bitbucket/__tests__/env.test.ts
import { describe, it, expect } from 'vitest';
import { BITBUCKET_ENV_KEYS, bitbucketEnvUpdates, readBitbucketEnv } from '../env';

describe('bitbucket env', () => {
  it('is enabled only with a token and not explicitly disabled', () => {
    expect(readBitbucketEnv({})).toEqual({ bitbucketEnabled: false });
    expect(readBitbucketEnv({ BITBUCKET_API_TOKEN: 't' })).toMatchObject({ bitbucketEnabled: true, bitbucketApiToken: 't' });
    expect(readBitbucketEnv({ BITBUCKET_API_TOKEN: 't', BITBUCKET_ENABLED: 'false' })).toMatchObject({ bitbucketEnabled: false });
  });

  it('reads and trims the remaining fields', () => {
    expect(readBitbucketEnv({ BITBUCKET_API_TOKEN: 't', BITBUCKET_EMAIL: ' a@b.c ', BITBUCKET_WORKSPACE: 'Acme', BITBUCKET_REPO_SLUG: 'todo ' }))
      .toMatchObject({ bitbucketEmail: 'a@b.c', bitbucketWorkspace: 'acme', bitbucketRepoSlug: 'todo' });
  });

  it('serializes only the provided fields', () => {
    expect(bitbucketEnvUpdates({ bitbucketEnabled: true, bitbucketWorkspace: 'Acme' })).toEqual({
      [BITBUCKET_ENV_KEYS.ENABLED]: 'true',
      [BITBUCKET_ENV_KEYS.WORKSPACE]: 'acme',
    });
    expect(bitbucketEnvUpdates({})).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/bitbucket src/main/bitbucket`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the modules**

```ts
// apps/desktop/src/shared/bitbucket/remote.ts
export interface BitbucketRepoRef {
  workspace: string;
  repoSlug: string;
}

const SSH_SCP = /^git@bitbucket\.org:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;
const SSH_URL = /^ssh:\/\/git@bitbucket\.org\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;
const HTTPS = /^https?:\/\/(?:[^@/]+@)?bitbucket\.org\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;

/** Workspace and repo slug from a bitbucket.org remote URL, or null for any other host. */
export function parseBitbucketRemote(url: string): BitbucketRepoRef | null {
  const trimmed = url.trim();
  for (const re of [SSH_SCP, SSH_URL, HTTPS]) {
    const m = trimmed.match(re);
    if (m) return { workspace: m[1].toLowerCase(), repoSlug: m[2].toLowerCase() };
  }
  return null;
}
```

```ts
// apps/desktop/src/main/bitbucket/env.ts
import type { ProjectEnvConfig } from '../../shared/types';

export const BITBUCKET_ENV_KEYS = {
  ENABLED: 'BITBUCKET_ENABLED',
  EMAIL: 'BITBUCKET_EMAIL',
  API_TOKEN: 'BITBUCKET_API_TOKEN',
  WORKSPACE: 'BITBUCKET_WORKSPACE',
  REPO_SLUG: 'BITBUCKET_REPO_SLUG',
} as const;

type BitbucketEnvConfig = Pick<ProjectEnvConfig, 'bitbucketEnabled' | 'bitbucketEmail' | 'bitbucketApiToken' | 'bitbucketWorkspace' | 'bitbucketRepoSlug'>;

/** Bitbucket config from parsed .env vars. Enabled when a token exists and BITBUCKET_ENABLED is not "false". */
export function readBitbucketEnv(vars: Record<string, string>): BitbucketEnvConfig {
  const out: BitbucketEnvConfig = { bitbucketEnabled: false };
  const token = vars[BITBUCKET_ENV_KEYS.API_TOKEN]?.trim();
  if (token) {
    out.bitbucketApiToken = token;
    out.bitbucketEnabled = vars[BITBUCKET_ENV_KEYS.ENABLED]?.toLowerCase() !== 'false';
  }
  const email = vars[BITBUCKET_ENV_KEYS.EMAIL]?.trim();
  if (email) out.bitbucketEmail = email;
  const workspace = vars[BITBUCKET_ENV_KEYS.WORKSPACE]?.trim();
  if (workspace) out.bitbucketWorkspace = workspace.toLowerCase();
  const slug = vars[BITBUCKET_ENV_KEYS.REPO_SLUG]?.trim();
  if (slug) out.bitbucketRepoSlug = slug.toLowerCase();
  return out;
}

/** Env var updates for the provided Bitbucket fields only. */
export function bitbucketEnvUpdates(config: Partial<ProjectEnvConfig>): Record<string, string> {
  const u: Record<string, string> = {};
  if (config.bitbucketEnabled !== undefined) u[BITBUCKET_ENV_KEYS.ENABLED] = config.bitbucketEnabled ? 'true' : 'false';
  if (config.bitbucketEmail !== undefined) u[BITBUCKET_ENV_KEYS.EMAIL] = config.bitbucketEmail;
  if (config.bitbucketApiToken !== undefined) u[BITBUCKET_ENV_KEYS.API_TOKEN] = config.bitbucketApiToken;
  if (config.bitbucketWorkspace !== undefined) u[BITBUCKET_ENV_KEYS.WORKSPACE] = config.bitbucketWorkspace.trim().toLowerCase();
  if (config.bitbucketRepoSlug !== undefined) u[BITBUCKET_ENV_KEYS.REPO_SLUG] = config.bitbucketRepoSlug.trim().toLowerCase();
  return u;
}
```

```ts
// apps/desktop/src/main/bitbucket/config.ts
import { loadProjectEnvVars } from '../ipc-handlers/context/utils';
import { readBitbucketEnv } from './env';

export interface BitbucketProjectConfig {
  email: string;
  apiToken: string;
  /** May be blank; callers fall back to detectBitbucketRepo(). */
  workspace: string;
  repoSlug: string;
}

/** Resolved Bitbucket config for a project, or null when disabled or missing credentials. */
export function getBitbucketConfig(project: { path: string; autoBuildPath?: string }): BitbucketProjectConfig | null {
  const env = readBitbucketEnv(loadProjectEnvVars(project.path, project.autoBuildPath));
  if (!env.bitbucketEnabled || !env.bitbucketEmail || !env.bitbucketApiToken) return null;
  return {
    email: env.bitbucketEmail,
    apiToken: env.bitbucketApiToken,
    workspace: env.bitbucketWorkspace ?? '',
    repoSlug: env.bitbucketRepoSlug ?? '',
  };
}
```

```ts
// apps/desktop/src/main/bitbucket/remote.ts
import { execFileSync } from 'node:child_process';

import { type BitbucketRepoRef, parseBitbucketRemote } from '../../shared/bitbucket/remote';
import { getToolPath } from '../cli-tool-manager';
import { getIsolatedGitEnv } from '../utils/git-isolation';

export interface DetectedBitbucketRepo extends BitbucketRepoRef {
  remoteUrl: string;
}

/** Reads `origin` and returns the Bitbucket workspace/slug, or null when origin is missing or not on bitbucket.org. */
export function detectBitbucketRepo(projectPath: string, gitPath: string = getToolPath('git')): DetectedBitbucketRepo | null {
  let remoteUrl: string;
  try {
    remoteUrl = execFileSync(gitPath, ['remote', 'get-url', 'origin'], {
      cwd: projectPath,
      env: getIsolatedGitEnv(),
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
  } catch {
    return null;
  }
  const parsed = parseBitbucketRemote(remoteUrl);
  return parsed ? { ...parsed, remoteUrl } : null;
}
```

- [ ] **Step 4: Wire the type, env handlers, and mock**

`src/shared/types/project.ts`, after `jiraStatusMap?: JiraStatusMap;`:

```ts
  // Bitbucket Integration (Bitbucket Cloud, API token)
  bitbucketEnabled: boolean;
  bitbucketEmail?: string;
  bitbucketApiToken?: string;
  bitbucketWorkspace?: string;  // acme
  bitbucketRepoSlug?: string;   // todo
```

`src/main/ipc-handlers/env-handlers.ts`:
- Import: `import { BITBUCKET_ENV_KEYS, bitbucketEnvUpdates, readBitbucketEnv } from '../bitbucket/env';` after the Jira import.
- After `Object.assign(existingVars, jiraEnvUpdates(config));` add `// Bitbucket Integration` + `Object.assign(existingVars, bitbucketEnvUpdates(config));`.
- In the template, after the JIRA block's `STATUS_MAP` line and blank line, before `# GIT/WORKTREE SETTINGS`, add:

```
# =============================================================================
# BITBUCKET INTEGRATION (OPTIONAL, Bitbucket Cloud)
# =============================================================================
${existingVars[BITBUCKET_ENV_KEYS.ENABLED] !== undefined ? `${BITBUCKET_ENV_KEYS.ENABLED}=${existingVars[BITBUCKET_ENV_KEYS.ENABLED]}` : `# ${BITBUCKET_ENV_KEYS.ENABLED}=true`}
${envLine(existingVars, BITBUCKET_ENV_KEYS.EMAIL)}
${envLine(existingVars, BITBUCKET_ENV_KEYS.API_TOKEN)}
${envLine(existingVars, BITBUCKET_ENV_KEYS.WORKSPACE, 'acme')}
${envLine(existingVars, BITBUCKET_ENV_KEYS.REPO_SLUG, 'todo')}

```
- Default config literal: after `jiraEnabled: false,` add `bitbucketEnabled: false,`.
- Parse: after `Object.assign(config, readJiraEnv(vars));` add `// Bitbucket config` + `Object.assign(config, readBitbucketEnv(vars));`.

`src/renderer/lib/mocks/integration-mock.ts`: after `jiraEnabled: false,` add `bitbucketEnabled: false,`.

- [ ] **Step 5: Run tests, typecheck, commit**

Run: `npx vitest run src/shared/bitbucket src/main/bitbucket src/main/ipc-handlers/__tests__/env-handlers.test.ts && npx biome check src/shared/bitbucket src/main/bitbucket && npx tsc --noEmit -p tsconfig.json`
Expected: PASS. If typecheck reports another `ProjectEnvConfig` literal missing `bitbucketEnabled`, add `bitbucketEnabled: false` there.

```bash
git add src/shared/bitbucket src/main/bitbucket src/shared/types/project.ts src/main/ipc-handlers/env-handlers.ts src/renderer/lib/mocks/integration-mock.ts
git commit -m "feat(bitbucket): project env config, remote parser, and config resolution"
```

---

### Task 2: Bitbucket REST client

**Files:**
- Create: `src/main/bitbucket/client.ts`
- Test: `src/main/bitbucket/__tests__/client.test.ts`

**Interfaces:**
- Produces: `BitbucketApiError`, `extractBitbucketError(status, body)`, `BitbucketClient` with `user()`, `repository(ws, slug)`, `findOpenPullRequest(ws, slug, sourceBranch)`, `createPullRequest(ws, slug, input)`, `createBitbucketClient(config)`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/desktop/src/main/bitbucket/__tests__/client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { BitbucketApiError, BitbucketClient, extractBitbucketError } from '../client';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function client(fetchImpl: typeof fetch) {
  return new BitbucketClient({ email: 'a@b.c', apiToken: 'tok' }, fetchImpl);
}

describe('BitbucketClient', () => {
  it('sends basic auth and JSON headers to the 2.0 endpoint', async () => {
    const f = vi.fn().mockResolvedValue(json(200, { display_name: 'Ann' }));
    expect(await client(f as unknown as typeof fetch).user()).toEqual({ displayName: 'Ann' });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.bitbucket.org/2.0/user');
    const h = new Headers(init.headers);
    expect(h.get('authorization')).toBe(`Basic ${Buffer.from('a@b.c:tok').toString('base64')}`);
    expect(h.get('accept')).toBe('application/json');
    expect(h.get('accept-language')).toBe('en');
  });

  it('reads a repository', async () => {
    const f = vi.fn().mockResolvedValue(json(200, { name: 'Todo', full_name: 'acme/todo', mainbranch: { name: 'develop' } }));
    expect(await client(f as unknown as typeof fetch).repository('acme', 'todo')).toEqual({ name: 'Todo', fullName: 'acme/todo', mainBranch: 'develop' });
    expect(f.mock.calls[0][0]).toBe('https://api.bitbucket.org/2.0/repositories/acme/todo');
  });

  it('finds an open pull request by source branch, or null', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { values: [{ id: 7, links: { html: { href: 'https://bitbucket.org/acme/todo/pull-requests/7' } } }] }))
      .mockResolvedValueOnce(json(200, { values: [] }));
    const c = client(f as unknown as typeof fetch);
    expect(await c.findOpenPullRequest('acme', 'todo', 'auto-claude/001-x')).toEqual({ id: 7, url: 'https://bitbucket.org/acme/todo/pull-requests/7' });
    const url = new URL(f.mock.calls[0][0]);
    expect(url.pathname).toBe('/2.0/repositories/acme/todo/pullrequests');
    expect(url.searchParams.get('q')).toBe('source.branch.name = "auto-claude/001-x" AND state = "OPEN"');
    expect(await c.findOpenPullRequest('acme', 'todo', 'auto-claude/001-x')).toBeNull();
  });

  it('creates a pull request and returns its html link', async () => {
    const f = vi.fn().mockResolvedValue(json(201, { id: 9, links: { html: { href: 'https://bitbucket.org/acme/todo/pull-requests/9' } } }));
    const r = await client(f as unknown as typeof fetch).createPullRequest('acme', 'todo', {
      title: 'T', description: 'D', sourceBranch: 'auto-claude/001-x', destinationBranch: 'develop',
    });
    expect(r).toEqual({ id: 9, url: 'https://bitbucket.org/acme/todo/pull-requests/9' });
    const [, init] = f.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      title: 'T', description: 'D', source: { branch: { name: 'auto-claude/001-x' } }, destination: { branch: { name: 'develop' } }, close_source_branch: false,
    });
  });

  it('throws BitbucketApiError with the API message on non-2xx', async () => {
    const f = vi.fn().mockResolvedValue(json(400, { type: 'error', error: { message: 'Bad request', fields: { destination: ['Branch not found'] } } }));
    await expect(client(f as unknown as typeof fetch).user()).rejects.toMatchObject({ status: 400, message: 'Bad request; destination: Branch not found' });
    await expect(client(f as unknown as typeof fetch).user()).rejects.toBeInstanceOf(BitbucketApiError);
  });

  it('retries once on 429 using Retry-After', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(429, {}, { 'retry-after': '0' })).mockResolvedValueOnce(json(200, { display_name: 'Ann' }));
    await expect(client(f as unknown as typeof fetch).user()).resolves.toEqual({ displayName: 'Ann' });
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('extractBitbucketError', () => {
  it('falls back to the HTTP status', () => {
    expect(extractBitbucketError(502, 'gateway')).toBe('Bitbucket request failed with HTTP 502');
    expect(extractBitbucketError(401, { error: {} })).toBe('Bitbucket request failed with HTTP 401');
  });
  it('joins message and field errors without repeating text', () => {
    expect(extractBitbucketError(400, { error: { message: 'X', fields: { a: ['X'], b: ['Y', 'Z'] } } })).toBe('X; b: Y, Z');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/bitbucket/__tests__/client.test.ts`
Expected: FAIL, cannot find `../client`.

- [ ] **Step 3: Write the client**

```ts
// apps/desktop/src/main/bitbucket/client.ts
import type { BitbucketProjectConfig } from './config';

const BASE_URL = 'https://api.bitbucket.org/2.0';

export class BitbucketApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'BitbucketApiError';
  }
}

/** Human-readable message from a Bitbucket error body, falling back to the HTTP status. */
export function extractBitbucketError(status: number, body: unknown): string {
  const parts: string[] = [];
  if (body && typeof body === 'object') {
    const err = (body as { error?: { message?: unknown; fields?: unknown } }).error;
    if (err && typeof err === 'object') {
      if (typeof err.message === 'string' && err.message.trim()) parts.push(err.message.trim());
      if (err.fields && typeof err.fields === 'object') {
        for (const [field, value] of Object.entries(err.fields as Record<string, unknown>)) {
          const msgs = (Array.isArray(value) ? value : [value]).map(String).filter((m) => !parts.includes(m));
          if (msgs.length > 0) parts.push(`${field}: ${msgs.join(', ')}`);
        }
      }
    }
  }
  return parts.length > 0 ? parts.join('; ') : `Bitbucket request failed with HTTP ${status}`;
}

export interface BitbucketUser { displayName: string }
export interface BitbucketRepository { name: string; fullName: string; mainBranch?: string }
export interface BitbucketPullRequestRef { id: number; url: string }
export interface CreatePullRequestInput {
  title: string;
  description: string;
  sourceBranch: string;
  destinationBranch: string;
}

export class BitbucketClient {
  constructor(
    private readonly cfg: { email: string; apiToken: string },
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, attempt = 0): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${this.cfg.email}:${this.cfg.apiToken}`).toString('base64')}`,
      Accept: 'application/json',
      'Accept-Language': 'en',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await this.fetchImpl(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 429 && attempt === 0) {
      const wait = Number(res.headers.get('retry-after') ?? '2');
      await new Promise((r) => setTimeout(r, Math.max(0, wait) * 1000));
      return this.request<T>(method, path, body, 1);
    }
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) throw new BitbucketApiError(res.status, extractBitbucketError(res.status, parsed));
    return parsed as T;
  }

  async user(): Promise<BitbucketUser> {
    const u = await this.request<{ display_name?: string; username?: string }>('GET', '/user');
    return { displayName: u.display_name ?? u.username ?? '' };
  }

  async repository(workspace: string, repoSlug: string): Promise<BitbucketRepository> {
    const r = await this.request<{ name: string; full_name: string; mainbranch?: { name?: string } }>(
      'GET',
      `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}`,
    );
    return { name: r.name, fullName: r.full_name, mainBranch: r.mainbranch?.name };
  }

  async findOpenPullRequest(workspace: string, repoSlug: string, sourceBranch: string): Promise<BitbucketPullRequestRef | null> {
    const q = `source.branch.name = "${sourceBranch.replace(/"/g, '\\"')}" AND state = "OPEN"`;
    const page = await this.request<{ values?: Array<{ id: number; links?: { html?: { href?: string } } }> }>(
      'GET',
      `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/pullrequests?q=${encodeURIComponent(q)}&pagelen=1`,
    );
    const first = page.values?.[0];
    if (!first) return null;
    return { id: first.id, url: first.links?.html?.href ?? '' };
  }

  async createPullRequest(workspace: string, repoSlug: string, input: CreatePullRequestInput): Promise<BitbucketPullRequestRef> {
    const pr = await this.request<{ id: number; links?: { html?: { href?: string } } }>(
      'POST',
      `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/pullrequests`,
      {
        title: input.title,
        description: input.description,
        source: { branch: { name: input.sourceBranch } },
        destination: { branch: { name: input.destinationBranch } },
        close_source_branch: false,
      },
    );
    return { id: pr.id, url: pr.links?.html?.href ?? '' };
  }
}

export function createBitbucketClient(config: BitbucketProjectConfig): BitbucketClient {
  return new BitbucketClient({ email: config.email, apiToken: config.apiToken });
}
```

- [ ] **Step 4: Run tests, lint, commit**

Run: `npx vitest run src/main/bitbucket && npx biome check src/main/bitbucket`
Expected: PASS.

```bash
git add src/main/bitbucket
git commit -m "feat(bitbucket): REST client for user, repository, and pull requests"
```

---

### Task 3: Shared PR helpers, Bitbucket PR creation, and the provider dispatcher

**Files:**
- Create: `src/main/ai/runners/pr-common.ts`, `src/main/bitbucket/create-pr.ts`, `src/main/ipc-handlers/task/create-task-pr.ts`
- Modify: `src/main/ai/runners/github/pr-creator.ts` (remove moved helpers, import them), `src/main/ipc-handlers/task/worktree-handlers.ts:3044-3061`
- Test: `src/main/ai/runners/__tests__/pr-common.test.ts`, `src/main/bitbucket/__tests__/create-pr.test.ts`, `src/main/ipc-handlers/task/__tests__/create-task-pr.test.ts`

**Interfaces:**
- Consumes: `BitbucketClient`, `getBitbucketConfig`, `detectBitbucketRepo` (Tasks 1-2).
- Produces: `pr-common.ts` exports `CreatePRResult`, `PushAuth { remoteUrl: string; header: string }`, `basicAuthHeader(email, token)`, `isAuthPushError(stderr)`, `pushBranch(worktreePath, gitPath, branchName, auth?)`, `gatherPRContext`, `generatePRBody`, `extractSpecSummary`. `createBitbucketPR(config): Promise<CreatePRResult>`. `createTaskPR(request, deps?): Promise<CreatePRResult>`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/desktop/src/main/ai/runners/__tests__/pr-common.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync }));
vi.mock('../../client/factory', () => ({ createSimpleClient: vi.fn() }));

import { basicAuthHeader, isAuthPushError, pushBranch } from '../pr-common';

const authFail = () => Object.assign(new Error('fail'), { stderr: 'fatal: Authentication failed for https://bitbucket.org/acme/todo.git' });

beforeEach(() => vi.clearAllMocks());

describe('pushBranch', () => {
  it('pushes with upstream and returns undefined on success', () => {
    execFileSync.mockReturnValue('');
    expect(pushBranch('/wt', 'git', 'auto-claude/001-x')).toBeUndefined();
    expect(execFileSync).toHaveBeenCalledWith('git', ['push', '--set-upstream', 'origin', 'auto-claude/001-x'], expect.objectContaining({ cwd: '/wt' }));
  });

  it('retries once with the auth header on an HTTPS auth failure', () => {
    execFileSync.mockImplementationOnce(() => { throw authFail(); }).mockReturnValueOnce('');
    const auth = { remoteUrl: 'https://bitbucket.org/acme/todo.git', header: basicAuthHeader('a@b.c', 'tok') };
    expect(pushBranch('/wt', 'git', 'b', auth)).toBeUndefined();
    expect(execFileSync).toHaveBeenCalledTimes(2);
    expect(execFileSync.mock.calls[1][1]).toEqual(['-c', `http.extraheader=${auth.header}`, 'push', '--set-upstream', 'origin', 'b']);
  });

  it('does not retry for SSH remotes or non-auth errors', () => {
    execFileSync.mockImplementation(() => { throw authFail(); });
    expect(pushBranch('/wt', 'git', 'b', { remoteUrl: 'git@bitbucket.org:acme/todo.git', header: 'x' })).toContain('Authentication failed');
    expect(execFileSync).toHaveBeenCalledTimes(1);
    execFileSync.mockImplementation(() => { throw Object.assign(new Error('x'), { stderr: 'error: failed to push some refs' }); });
    expect(pushBranch('/wt', 'git', 'b', { remoteUrl: 'https://bitbucket.org/acme/todo.git', header: 'x' })).toContain('failed to push');
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });
});

describe('helpers', () => {
  it('builds the basic auth header and classifies auth errors', () => {
    expect(basicAuthHeader('a@b.c', 'tok')).toBe(`Authorization: Basic ${Buffer.from('a@b.c:tok').toString('base64')}`);
    expect(isAuthPushError('fatal: Authentication failed')).toBe(true);
    expect(isAuthPushError('could not read Username for')).toBe(true);
    expect(isAuthPushError('The requested URL returned error: 403')).toBe(true);
    expect(isAuthPushError('rejected: non-fast-forward')).toBe(false);
  });
});
```

```ts
// apps/desktop/src/main/bitbucket/__tests__/create-pr.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const common = vi.hoisted(() => ({
  pushBranch: vi.fn(),
  gatherPRContext: vi.fn(() => ({ diffSummary: 'd', commitLog: 'c' })),
  generatePRBody: vi.fn(async () => 'AI body'),
  extractSpecSummary: vi.fn(() => 'Spec body'),
  basicAuthHeader: vi.fn(() => 'Authorization: Basic x'),
}));
vi.mock('../../ai/runners/pr-common', () => common);

const client = vi.hoisted(() => ({ findOpenPullRequest: vi.fn(), createPullRequest: vi.fn() }));
vi.mock('../client', () => ({ createBitbucketClient: () => client }));

import { createBitbucketPR } from '../create-pr';

const cfg = {
  projectDir: '/p', worktreePath: '/wt', specId: '001-x', branchName: 'auto-claude/001-x', baseBranch: 'origin/develop', title: 'T',
  gitPath: 'git', config: { email: 'a@b.c', apiToken: 'tok', workspace: '', repoSlug: '' }, workspace: 'acme', repoSlug: 'todo', remoteUrl: 'https://bitbucket.org/acme/todo.git',
};

beforeEach(() => {
  vi.clearAllMocks();
  common.pushBranch.mockReturnValue(undefined);
  client.findOpenPullRequest.mockResolvedValue(null);
  client.createPullRequest.mockResolvedValue({ id: 3, url: 'https://bitbucket.org/acme/todo/pull-requests/3' });
});

describe('createBitbucketPR', () => {
  it('pushes with auth, strips origin/ from the destination, and returns the PR url', async () => {
    const r = await createBitbucketPR(cfg);
    expect(r).toEqual({ success: true, prUrl: 'https://bitbucket.org/acme/todo/pull-requests/3', alreadyExists: false });
    expect(common.pushBranch).toHaveBeenCalledWith('/wt', 'git', 'auto-claude/001-x', { remoteUrl: cfg.remoteUrl, header: 'Authorization: Basic x' });
    expect(client.createPullRequest).toHaveBeenCalledWith('acme', 'todo', { title: 'T', description: 'AI body', sourceBranch: 'auto-claude/001-x', destinationBranch: 'develop' });
  });

  it('returns the existing PR when one is open for the branch', async () => {
    client.findOpenPullRequest.mockResolvedValue({ id: 1, url: 'https://x/1' });
    expect(await createBitbucketPR(cfg)).toEqual({ success: true, prUrl: 'https://x/1', alreadyExists: true });
    expect(client.createPullRequest).not.toHaveBeenCalled();
  });

  it('fails on push errors and surfaces API errors', async () => {
    common.pushBranch.mockReturnValue('denied');
    expect(await createBitbucketPR(cfg)).toEqual({ success: false, error: 'Failed to push branch: denied' });
    common.pushBranch.mockReturnValue(undefined);
    client.createPullRequest.mockRejectedValue(new Error('destination: Branch not found'));
    expect(await createBitbucketPR(cfg)).toEqual({ success: false, error: 'destination: Branch not found' });
  });

  it('uses the spec summary when the AI body is empty', async () => {
    common.generatePRBody.mockResolvedValueOnce(null);
    await createBitbucketPR(cfg);
    expect(client.createPullRequest.mock.calls[0][2].description).toBe('Spec body');
  });
});
```

```ts
// apps/desktop/src/main/ipc-handlers/task/__tests__/create-task-pr.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTaskPR, type TaskPRDeps } from '../create-task-pr';

const deps = (): TaskPRDeps => ({
  detect: vi.fn(() => null),
  getConfig: vi.fn(() => null),
  bitbucket: vi.fn(async () => ({ success: true, prUrl: 'https://bb/1' })),
  github: vi.fn(async () => ({ success: true, prUrl: 'https://gh/1' })),
  toolPath: vi.fn((name: string) => `/bin/${name}`),
});
const req = { project: { path: '/p' }, worktreePath: '/wt', specId: '001-x', branchName: 'auto-claude/001-x', baseBranch: 'develop', title: 'T', draft: false };

beforeEach(() => vi.clearAllMocks());

describe('createTaskPR', () => {
  it('uses GitHub for non-Bitbucket origins', async () => {
    const d = deps();
    expect(await createTaskPR(req, d)).toEqual({ success: true, prUrl: 'https://gh/1' });
    expect(d.github).toHaveBeenCalledWith(expect.objectContaining({ ghPath: '/bin/gh', gitPath: '/bin/git', branchName: 'auto-claude/001-x' }));
    expect(d.bitbucket).not.toHaveBeenCalled();
  });

  it('refuses a Bitbucket origin without config and never resolves gh', async () => {
    const d = deps();
    (d.detect as ReturnType<typeof vi.fn>).mockReturnValue({ workspace: 'acme', repoSlug: 'todo', remoteUrl: 'https://bitbucket.org/acme/todo.git' });
    expect(await createTaskPR(req, d)).toEqual({ success: false, error: 'Bitbucket is not configured for this project' });
    expect(d.toolPath).not.toHaveBeenCalledWith('gh');
  });

  it('uses Bitbucket with saved workspace/slug over detected ones', async () => {
    const d = deps();
    (d.detect as ReturnType<typeof vi.fn>).mockReturnValue({ workspace: 'acme', repoSlug: 'todo', remoteUrl: 'https://bitbucket.org/acme/todo.git' });
    (d.getConfig as ReturnType<typeof vi.fn>).mockReturnValue({ email: 'a', apiToken: 't', workspace: 'other', repoSlug: '' });
    expect(await createTaskPR(req, d)).toEqual({ success: true, prUrl: 'https://bb/1' });
    expect(d.bitbucket).toHaveBeenCalledWith(expect.objectContaining({ workspace: 'other', repoSlug: 'todo', remoteUrl: 'https://bitbucket.org/acme/todo.git', gitPath: '/bin/git' }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/ai/runners/__tests__/pr-common.test.ts src/main/bitbucket/__tests__/create-pr.test.ts src/main/ipc-handlers/task/__tests__/create-task-pr.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Create `pr-common.ts` and slim `pr-creator.ts`**

```ts
// apps/desktop/src/main/ai/runners/pr-common.ts
/**
 * Provider-independent pieces of pull request creation: pushing the branch,
 * gathering diff/log context, and writing the description with AI.
 * Used by the GitHub (gh) and Bitbucket (REST) creators.
 */
import { generateText } from 'ai';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createSimpleClient } from '../client/factory';
import type { ModelShorthand, ThinkingLevel } from '../config/types';

export interface CreatePRResult {
  success: boolean;
  prUrl?: string;
  alreadyExists?: boolean;
  error?: string;
}

/** Credentials for a one-time HTTPS push retry. `header` is the full Authorization header value line. */
export interface PushAuth {
  remoteUrl: string;
  header: string;
}

const SYSTEM_PROMPT = `You are a senior software engineer writing a Pull Request description.
Write a clear, professional PR description that explains WHAT was changed, WHY it was changed, and HOW to test it.

Format your response in Markdown with these sections:
## Summary
(1-3 bullet points describing the main changes)

## Changes
(Bulleted list of specific changes made)

## Testing
(How to verify the changes work correctly)

Keep the description concise but informative. Focus on the business value and technical impact.
Do not include any preamble — output only the Markdown body.`;

export function basicAuthHeader(email: string, token: string): string {
  return `Authorization: Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

export function isAuthPushError(stderr: string): boolean {
  return /authentication failed|could not read username|permission denied|returned error: 40[13]|\b40[13]\b/i.test(stderr);
}

function stderrOf(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { stderr?: string };
  return (e && typeof e === 'object' && 'stderr' in e && e.stderr ? String(e.stderr) : String(err)) || 'Push failed';
}

/**
 * Push the branch to origin. Returns an error string on failure, undefined on success.
 * With `auth`, an HTTPS remote is retried once with the credentials passed as a git config argument.
 */
export function pushBranch(worktreePath: string, gitPath: string, branchName: string, auth?: PushAuth): string | undefined {
  const args = ['push', '--set-upstream', 'origin', branchName];
  try {
    execFileSync(gitPath, args, { cwd: worktreePath, encoding: 'utf-8', stdio: 'pipe' });
    return undefined;
  } catch (err) {
    const stderr = stderrOf(err);
    if (!auth || !/^https?:\/\//i.test(auth.remoteUrl) || !isAuthPushError(stderr)) return stderr;
    try {
      execFileSync(gitPath, ['-c', `http.extraheader=${auth.header}`, ...args], { cwd: worktreePath, encoding: 'utf-8', stdio: 'pipe' });
      return undefined;
    } catch (retryErr) {
      return stderrOf(retryErr);
    }
  }
}

export function gatherPRContext(worktreePath: string, gitPath: string, baseBranch: string): { diffSummary: string; commitLog: string } {
  // (move the existing function body verbatim from pr-creator.ts)
}

export function extractSpecSummary(projectDir: string, specId: string): string {
  // (move verbatim)
}

export async function generatePRBody(
  specId: string, title: string, baseBranch: string, branchName: string,
  diffSummary: string, commitLog: string, modelShorthand: ModelShorthand, thinkingLevel: ThinkingLevel,
): Promise<string | null> {
  // (move verbatim; replace "GitHub Pull Request" in the prompt text with "Pull Request")
}
```

Then in `pr-creator.ts`: delete `SYSTEM_PROMPT`, `gatherPRContext`, `extractSpecSummary`, `generatePRBody`, `pushBranch`, and the `CreatePRResult` interface; delete the now-unused imports (`generateText`, `existsSync`, `readFileSync`, `join`, `createSimpleClient`); add

```ts
import { extractSpecSummary, gatherPRContext, generatePRBody, pushBranch, type CreatePRResult } from '../pr-common';
export type { CreatePRResult } from '../pr-common';
```

`createPR`'s body is unchanged (it calls the same names). Keep `getExistingPRUrl` and the `gh` loop.

- [ ] **Step 4: Write `create-pr.ts` and `create-task-pr.ts`**

```ts
// apps/desktop/src/main/bitbucket/create-pr.ts
import type { ModelShorthand, ThinkingLevel } from '../ai/config/types';
import { basicAuthHeader, extractSpecSummary, gatherPRContext, generatePRBody, pushBranch, type CreatePRResult } from '../ai/runners/pr-common';
import { createBitbucketClient } from './client';
import type { BitbucketProjectConfig } from './config';

export interface CreateBitbucketPRConfig {
  projectDir: string;
  worktreePath: string;
  specId: string;
  branchName: string;
  baseBranch: string;
  title: string;
  gitPath: string;
  config: BitbucketProjectConfig;
  workspace: string;
  repoSlug: string;
  remoteUrl: string;
  modelShorthand?: ModelShorthand;
  thinkingLevel?: ThinkingLevel;
}

/** Push the worktree branch and open a Bitbucket Cloud pull request with an AI-written description. */
export async function createBitbucketPR(cfg: CreateBitbucketPRConfig): Promise<CreatePRResult> {
  const { modelShorthand = 'haiku', thinkingLevel = 'low' } = cfg;
  const auth = { remoteUrl: cfg.remoteUrl, header: basicAuthHeader(cfg.config.email, cfg.config.apiToken) };
  const pushError = pushBranch(cfg.worktreePath, cfg.gitPath, cfg.branchName, auth);
  if (pushError && !/up.to.date/i.test(pushError)) return { success: false, error: `Failed to push branch: ${pushError}` };

  const destination = cfg.baseBranch.startsWith('origin/') ? cfg.baseBranch.slice('origin/'.length) : cfg.baseBranch;
  const { diffSummary, commitLog } = gatherPRContext(cfg.worktreePath, cfg.gitPath, destination);
  const body = (await generatePRBody(cfg.specId, cfg.title, destination, cfg.branchName, diffSummary, commitLog, modelShorthand, thinkingLevel))
    || extractSpecSummary(cfg.projectDir, cfg.specId);

  try {
    const client = createBitbucketClient(cfg.config);
    const existing = await client.findOpenPullRequest(cfg.workspace, cfg.repoSlug, cfg.branchName);
    if (existing) return { success: true, prUrl: existing.url, alreadyExists: true };
    const pr = await client.createPullRequest(cfg.workspace, cfg.repoSlug, {
      title: cfg.title,
      description: body,
      sourceBranch: cfg.branchName,
      destinationBranch: destination,
    });
    return { success: true, prUrl: pr.url, alreadyExists: false };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

```ts
// apps/desktop/src/main/ipc-handlers/task/create-task-pr.ts
import type { CreatePRResult } from '../../ai/runners/pr-common';
import { createPR } from '../../ai/runners/github/pr-creator';
import { getBitbucketConfig } from '../../bitbucket/config';
import { createBitbucketPR } from '../../bitbucket/create-pr';
import { detectBitbucketRepo } from '../../bitbucket/remote';
import { getToolPath } from '../../cli-tool-manager';

export interface TaskPRRequest {
  project: { path: string; autoBuildPath?: string };
  worktreePath: string;
  specId: string;
  branchName: string;
  baseBranch: string;
  title: string;
  draft?: boolean;
}

export interface TaskPRDeps {
  detect: typeof detectBitbucketRepo;
  getConfig: typeof getBitbucketConfig;
  bitbucket: typeof createBitbucketPR;
  github: typeof createPR;
  toolPath: (name: string) => string;
}

const defaultDeps: TaskPRDeps = {
  detect: detectBitbucketRepo,
  getConfig: getBitbucketConfig,
  bitbucket: createBitbucketPR,
  github: createPR,
  toolPath: getToolPath,
};

/** Route PR creation to Bitbucket when origin is on bitbucket.org, else to the GitHub (gh) creator. */
export async function createTaskPR(req: TaskPRRequest, deps: TaskPRDeps = defaultDeps): Promise<CreatePRResult> {
  const detected = deps.detect(req.project.path);
  const common = {
    projectDir: req.project.path,
    worktreePath: req.worktreePath,
    specId: req.specId,
    branchName: req.branchName,
    baseBranch: req.baseBranch,
    title: req.title,
  };
  if (detected) {
    const config = deps.getConfig(req.project);
    if (!config) return { success: false, error: 'Bitbucket is not configured for this project' };
    return deps.bitbucket({
      ...common,
      gitPath: deps.toolPath('git'),
      config,
      workspace: config.workspace || detected.workspace,
      repoSlug: config.repoSlug || detected.repoSlug,
      remoteUrl: detected.remoteUrl,
    });
  }
  return deps.github({ ...common, draft: req.draft, ghPath: deps.toolPath('gh'), gitPath: deps.toolPath('git') });
}
```

- [ ] **Step 5: Call the dispatcher from the task handler**

In `src/main/ipc-handlers/task/worktree-handlers.ts` replace the import `import { createPR } from '../../ai/runners/github/pr-creator';` with `import { createTaskPR } from './create-task-pr';`, and replace this exact block:

```ts
        // Get tool paths
        const ghPath = getToolPath('gh');
        const gitPath = getToolPath('git');

        debug('Creating PR via TypeScript runner:', { branchName, baseBranch, prTitle });

        // Run the TypeScript PR creator
        const result = await createPR({
          projectDir: project.path,
          worktreePath,
          specId: task.specId,
          branchName,
          baseBranch,
          title: prTitle,
          draft: options?.draft,
          ghPath,
          gitPath,
        });
```

with

```ts
        debug('Creating PR via TypeScript runner:', { branchName, baseBranch, prTitle });

        // Bitbucket when origin is on bitbucket.org, otherwise GitHub via gh
        const result = await createTaskPR({
          project,
          worktreePath,
          specId: task.specId,
          branchName,
          baseBranch,
          title: prTitle,
          draft: options?.draft,
        });
```

`getToolPath` stays imported (used elsewhere in the file).

- [ ] **Step 6: Run tests, lint, typecheck, commit**

Run: `npx vitest run src/main/ai/runners src/main/bitbucket src/main/ipc-handlers/task && npx biome check src/main/ai/runners/pr-common.ts src/main/ai/runners/github/pr-creator.ts src/main/bitbucket src/main/ipc-handlers/task/create-task-pr.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

```bash
git add src/main/ai/runners/pr-common.ts src/main/ai/runners/github/pr-creator.ts src/main/ai/runners/__tests__/pr-common.test.ts src/main/bitbucket src/main/ipc-handlers/task/create-task-pr.ts src/main/ipc-handlers/task/__tests__/create-task-pr.test.ts src/main/ipc-handlers/task/worktree-handlers.ts
git commit -m "feat(bitbucket): pull requests from finished tasks with shared push and body helpers"
```

---

### Task 4: Bitbucket settings handlers, preload, types, mock

**Files:**
- Create: `src/main/ipc-handlers/bitbucket/index.ts`, `src/preload/api/modules/bitbucket-api.ts`
- Modify: `src/shared/constants/ipc.ts` (after `JIRA_RETRY_SYNC`), `src/shared/types/integrations.ts` (end), `src/shared/types/ipc.ts` (after `jiraRetrySync`), `src/preload/api/agent-api.ts` (mirror the four Jira lines), `src/renderer/lib/browser-mock.ts` (after `jiraRetrySync`), `src/main/ipc-handlers/index.ts` (mirror `registerJiraHandlers`)
- Test: `src/main/ipc-handlers/__tests__/bitbucket-handlers.test.ts`

**Interfaces:**
- Produces: channels `BITBUCKET_CHECK_CONNECTION: 'bitbucket:checkConnection'`, `BITBUCKET_DETECT_REPO: 'bitbucket:detectRepo'`; types `BitbucketConnectionStatus { accountName: string; repoName?: string }`, `BitbucketRepoRef` (re-export from shared/bitbucket/remote); ElectronAPI `bitbucketCheckConnection(projectId)`, `bitbucketDetectRepo(projectId)`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/src/main/ipc-handlers/__tests__/bitbucket-handlers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { handlers, getProject, cfg, client, detect } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getProject: vi.fn(),
  cfg: { getBitbucketConfig: vi.fn() },
  client: { user: vi.fn(), repository: vi.fn() },
  detect: vi.fn(),
}));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn((c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn)) } }));
vi.mock('../../project-store', () => ({ projectStore: { getProject } }));
vi.mock('../../bitbucket/config', () => cfg);
vi.mock('../../bitbucket/client', () => ({ createBitbucketClient: () => client }));
vi.mock('../../bitbucket/remote', () => ({ detectBitbucketRepo: detect }));

import { registerBitbucketHandlers } from '../bitbucket';

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  getProject.mockReturnValue({ id: 'p1', path: '/repo' });
  registerBitbucketHandlers();
});

describe('bitbucket handlers', () => {
  it('checkConnection reports the user and repository', async () => {
    cfg.getBitbucketConfig.mockReturnValue({ email: 'a', apiToken: 't', workspace: 'acme', repoSlug: 'todo' });
    client.user.mockResolvedValue({ displayName: 'Ann' });
    client.repository.mockResolvedValue({ name: 'Todo', fullName: 'acme/todo' });
    expect(await handlers.get('bitbucket:checkConnection')!({}, 'p1')).toEqual({ success: true, data: { accountName: 'Ann', repoName: 'acme/todo' } });
  });

  it('checkConnection falls back to detection for the repo and reports errors', async () => {
    cfg.getBitbucketConfig.mockReturnValue({ email: 'a', apiToken: 't', workspace: '', repoSlug: '' });
    detect.mockReturnValue({ workspace: 'acme', repoSlug: 'todo', remoteUrl: 'u' });
    client.user.mockResolvedValue({ displayName: 'Ann' });
    client.repository.mockRejectedValue(new Error('Bitbucket request failed with HTTP 404'));
    expect(await handlers.get('bitbucket:checkConnection')!({}, 'p1')).toEqual({ success: false, error: 'Bitbucket request failed with HTTP 404' });
    expect(client.repository).toHaveBeenCalledWith('acme', 'todo');
  });

  it('checkConnection refuses when not configured; detectRepo returns the parsed remote or null', async () => {
    cfg.getBitbucketConfig.mockReturnValue(null);
    expect(await handlers.get('bitbucket:checkConnection')!({}, 'p1')).toEqual({ success: false, error: 'Bitbucket is not configured for this project' });
    detect.mockReturnValue({ workspace: 'acme', repoSlug: 'todo', remoteUrl: 'u' });
    expect(await handlers.get('bitbucket:detectRepo')!({}, 'p1')).toEqual({ success: true, data: { workspace: 'acme', repoSlug: 'todo' } });
    detect.mockReturnValue(null);
    expect(await handlers.get('bitbucket:detectRepo')!({}, 'p1')).toEqual({ success: true, data: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ipc-handlers/__tests__/bitbucket-handlers.test.ts`
Expected: FAIL, cannot find `../bitbucket`.

- [ ] **Step 3: Constants, types, handler, preload, mock, registration**

`src/shared/constants/ipc.ts`, after `JIRA_RETRY_SYNC: 'jira:retrySync',`:

```ts
  BITBUCKET_CHECK_CONNECTION: 'bitbucket:checkConnection',
  BITBUCKET_DETECT_REPO: 'bitbucket:detectRepo',
```

`src/shared/types/integrations.ts`, at the end:

```ts
// Bitbucket
export type { BitbucketRepoRef } from '../bitbucket/remote';
export interface BitbucketConnectionStatus { accountName: string; repoName?: string }
```

```ts
// apps/desktop/src/main/ipc-handlers/bitbucket/index.ts
import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import type { BitbucketConnectionStatus, BitbucketRepoRef } from '../../../shared/types/integrations';
import { createBitbucketClient } from '../../bitbucket/client';
import { getBitbucketConfig } from '../../bitbucket/config';
import { detectBitbucketRepo } from '../../bitbucket/remote';
import { projectStore } from '../../project-store';

const NOT_CONFIGURED = 'Bitbucket is not configured for this project';

function fail(err: unknown): IPCResult<never> {
  return { success: false, error: err instanceof Error ? err.message : String(err) };
}

export function registerBitbucketHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.BITBUCKET_CHECK_CONNECTION, async (_e, projectId: string): Promise<IPCResult<BitbucketConnectionStatus>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    const config = getBitbucketConfig(project);
    if (!config) return { success: false, error: NOT_CONFIGURED };
    try {
      const client = createBitbucketClient(config);
      const data: BitbucketConnectionStatus = { accountName: (await client.user()).displayName };
      const detected = config.workspace && config.repoSlug ? null : detectBitbucketRepo(project.path);
      const workspace = config.workspace || detected?.workspace;
      const repoSlug = config.repoSlug || detected?.repoSlug;
      if (workspace && repoSlug) data.repoName = (await client.repository(workspace, repoSlug)).fullName;
      return { success: true, data };
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(IPC_CHANNELS.BITBUCKET_DETECT_REPO, async (_e, projectId: string): Promise<IPCResult<BitbucketRepoRef | null>> => {
    const project = projectStore.getProject(projectId);
    if (!project) return { success: false, error: `Project not found: ${projectId}` };
    const detected = detectBitbucketRepo(project.path);
    return { success: true, data: detected ? { workspace: detected.workspace, repoSlug: detected.repoSlug } : null };
  });
}
```

```ts
// apps/desktop/src/preload/api/modules/bitbucket-api.ts
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import type { BitbucketConnectionStatus, BitbucketRepoRef } from '../../../shared/types/integrations';
import { invokeIpc } from './ipc-utils';

export interface BitbucketAPI {
  bitbucketCheckConnection: (projectId: string) => Promise<IPCResult<BitbucketConnectionStatus>>;
  bitbucketDetectRepo: (projectId: string) => Promise<IPCResult<BitbucketRepoRef | null>>;
}

export const createBitbucketAPI = (): BitbucketAPI => ({
  bitbucketCheckConnection: (projectId) => invokeIpc(IPC_CHANNELS.BITBUCKET_CHECK_CONNECTION, projectId),
  bitbucketDetectRepo: (projectId) => invokeIpc(IPC_CHANNELS.BITBUCKET_DETECT_REPO, projectId),
});
```

- `agent-api.ts`: add `import { createBitbucketAPI, BitbucketAPI } from './modules/bitbucket-api';`, include `BitbucketAPI` in the combined type union/intersection next to `JiraAPI`, `const bitbucketAPI = createBitbucketAPI();`, spread `...bitbucketAPI,` after `...jiraAPI,`, and add `BitbucketAPI` to the type re-export list.
- `src/shared/types/ipc.ts`: import `BitbucketConnectionStatus, BitbucketRepoRef` from `./integrations` (add to the existing multi-line import) and after `jiraRetrySync` add:

```ts
  bitbucketCheckConnection: (projectId: string) => Promise<IPCResult<BitbucketConnectionStatus>>;
  bitbucketDetectRepo: (projectId: string) => Promise<IPCResult<BitbucketRepoRef | null>>;
```

- `browser-mock.ts` after `jiraRetrySync`: `bitbucketCheckConnection: async () => ({ success: false, error: 'Not available in browser mock' }),` and `bitbucketDetectRepo: async () => ({ success: true, data: null }),`.
- `src/main/ipc-handlers/index.ts`: `import { registerBitbucketHandlers } from './bitbucket';`, call `registerBitbucketHandlers();` right after `registerJiraHandlers();`, and add it to the export list next to `registerJiraHandlers`.

- [ ] **Step 4: Run tests, lint, typecheck, commit**

Run: `npx vitest run src/main/ipc-handlers/__tests__/bitbucket-handlers.test.ts src/preload && npx biome check src/main/ipc-handlers/bitbucket src/preload/api/modules/bitbucket-api.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

```bash
git add src/main/ipc-handlers/bitbucket src/main/ipc-handlers/__tests__/bitbucket-handlers.test.ts src/main/ipc-handlers/index.ts src/preload src/shared/constants/ipc.ts src/shared/types/integrations.ts src/shared/types/ipc.ts src/renderer/lib/browser-mock.ts
git commit -m "feat(bitbucket): connection check and repo detection handlers with preload API"
```

---

### Task 5: BRD git service and handlers

**Files:**
- Create: `src/main/brd/brd-git.ts`
- Modify: `src/main/ipc-handlers/brd-handlers.ts`, `src/shared/constants/ipc.ts` (after `BRD_DRAFT_ERROR`), `src/shared/types/brd.ts` (end), `src/preload/api/modules/brd-api.ts`, `src/shared/types/ipc.ts` (after `brdDraftCancel`), `src/renderer/lib/browser-mock.ts` (after `brdDraftCancel`)
- Test: `src/main/brd/__tests__/brd-git.test.ts`, extend `src/main/ipc-handlers/__tests__/brd-handlers.test.ts`

**Interfaces:**
- Consumes: `pushBranch`, `basicAuthHeader`, `PushAuth` (Task 3); `getBitbucketConfig`, `detectBitbucketRepo` (Task 1).
- Produces: types in `shared/types/brd.ts`: `BrdFileStatus`, `BrdChangedFile { path; status }`, `BrdChanges { branch; files }`, `BrdCommitResult { commit; pushed; pushError? }`. `parsePorcelain(output)`, `brdChanges(projectDir, gitPath?)`, `commitBrd(projectDir, message, push, auth?, gitPath?)`. Channels `BRD_CHANGES: 'brd:changes'`, `BRD_COMMIT: 'brd:commit'`. ElectronAPI `brdChanges(projectId)`, `brdCommit(projectId, message, push)`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/desktop/src/main/brd/__tests__/brd-git.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { execFileSync, pushBranch } = vi.hoisted(() => ({ execFileSync: vi.fn(), pushBranch: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync }));
vi.mock('../../ai/runners/pr-common', () => ({ pushBranch }));

import { brdChanges, commitBrd, parsePorcelain } from '../brd-git';

const calls = () => execFileSync.mock.calls.map((c) => (c[1] as string[]).join(' '));

beforeEach(() => vi.clearAllMocks());

describe('parsePorcelain', () => {
  it('maps status codes and renames', () => {
    expect(parsePorcelain(' M docs/brd/a.md\n?? docs/brd/b.md\nA  docs/brd/c.md\n D docs/brd/d.md\nR  docs/brd/e.md -> docs/brd/f.md\nMM docs/brd/g.md\n')).toEqual([
      { path: 'docs/brd/a.md', status: 'modified' },
      { path: 'docs/brd/b.md', status: 'untracked' },
      { path: 'docs/brd/c.md', status: 'added' },
      { path: 'docs/brd/d.md', status: 'deleted' },
      { path: 'docs/brd/f.md', status: 'modified' },
      { path: 'docs/brd/g.md', status: 'modified' },
    ]);
  });
});

describe('brdChanges', () => {
  it('returns the branch and files scoped to docs/brd', () => {
    execFileSync.mockReturnValueOnce('true\n').mockReturnValueOnce('develop\n').mockReturnValueOnce(' M docs/brd/a.md\n');
    expect(brdChanges('/repo', 'git')).toEqual({ branch: 'develop', files: [{ path: 'docs/brd/a.md', status: 'modified' }] });
    expect(calls()[2]).toBe('status --porcelain -- docs/brd');
  });

  it('throws when not a git repository', () => {
    execFileSync.mockImplementationOnce(() => { throw new Error('fatal: not a git repository'); });
    expect(() => brdChanges('/repo', 'git')).toThrow('Not a git repository');
  });
});

describe('commitBrd', () => {
  it('stages docs/brd, commits with the message, pushes, and returns the short hash', async () => {
    execFileSync.mockReturnValueOnce('true\n').mockReturnValueOnce('develop\n').mockReturnValueOnce('').mockReturnValueOnce('').mockReturnValueOnce('abc1234\n');
    pushBranch.mockReturnValue(undefined);
    const auth = { remoteUrl: 'https://bitbucket.org/a/b.git', header: 'Authorization: Basic x' };
    expect(await commitBrd('/repo', 'docs(brd): update a', true, auth, 'git')).toEqual({ commit: 'abc1234', pushed: true });
    expect(calls().slice(2, 5)).toEqual(['add -A -- docs/brd', 'commit -m docs(brd): update a -- docs/brd', 'rev-parse --short HEAD']);
    expect(pushBranch).toHaveBeenCalledWith('/repo', 'git', 'develop', auth);
  });

  it('reports a push failure as a warning after committing, and skips the push when asked', async () => {
    execFileSync.mockReturnValueOnce('true\n').mockReturnValueOnce('develop\n').mockReturnValueOnce('').mockReturnValueOnce('').mockReturnValueOnce('abc1234\n');
    pushBranch.mockReturnValue('rejected');
    expect(await commitBrd('/repo', 'm', true, undefined, 'git')).toEqual({ commit: 'abc1234', pushed: false, pushError: 'rejected' });
    execFileSync.mockReturnValueOnce('true\n').mockReturnValueOnce('develop\n').mockReturnValueOnce('').mockReturnValueOnce('').mockReturnValueOnce('abc1234\n');
    expect(await commitBrd('/repo', 'm', false, undefined, 'git')).toEqual({ commit: 'abc1234', pushed: false });
    expect(pushBranch).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty message', async () => {
    await expect(commitBrd('/repo', '   ', false, undefined, 'git')).rejects.toThrow('Commit message is required');
  });
});
```

Append to `src/main/ipc-handlers/__tests__/brd-handlers.test.ts`: add `brdGit: { brdChanges: vi.fn(), commitBrd: vi.fn() }` and `bb: { getBitbucketConfig: vi.fn(() => null as unknown), detectBitbucketRepo: vi.fn(() => null as unknown) }` to the hoisted object, plus

```ts
vi.mock('../../brd/brd-git', () => brdGit);
vi.mock('../../bitbucket/config', () => ({ getBitbucketConfig: bb.getBitbucketConfig }));
vi.mock('../../bitbucket/remote', () => ({ detectBitbucketRepo: bb.detectBitbucketRepo }));
```

and the tests:

```ts
  it('changes and commit delegate to the git service, passing Bitbucket auth when configured', async () => {
    brdGit.brdChanges.mockReturnValue({ branch: 'develop', files: [] });
    expect(await handlers.get('brd:changes')!({}, 'p1')).toEqual({ success: true, data: { branch: 'develop', files: [] } });

    brdGit.commitBrd.mockResolvedValue({ commit: 'abc', pushed: true });
    expect(await handlers.get('brd:commit')!({}, 'p1', 'msg', true)).toEqual({ success: true, data: { commit: 'abc', pushed: true } });
    expect(brdGit.commitBrd).toHaveBeenLastCalledWith('/repo', 'msg', true, undefined);

    bb.getBitbucketConfig.mockReturnValue({ email: 'a@b.c', apiToken: 't', workspace: '', repoSlug: '' });
    bb.detectBitbucketRepo.mockReturnValue({ workspace: 'w', repoSlug: 's', remoteUrl: 'https://bitbucket.org/w/s.git' });
    await handlers.get('brd:commit')!({}, 'p1', 'msg', true);
    expect(brdGit.commitBrd).toHaveBeenLastCalledWith('/repo', 'msg', true, {
      remoteUrl: 'https://bitbucket.org/w/s.git',
      header: `Authorization: Basic ${Buffer.from('a@b.c:t').toString('base64')}`,
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/brd/__tests__/brd-git.test.ts src/main/ipc-handlers/__tests__/brd-handlers.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the service, types, handlers, preload, mock**

`src/shared/types/brd.ts`, at the end:

```ts
/** Git state of docs/brd (see main/brd/brd-git.ts). */
export type BrdFileStatus = 'added' | 'modified' | 'deleted' | 'untracked';
export interface BrdChangedFile { path: string; status: BrdFileStatus }
export interface BrdChanges { branch: string; files: BrdChangedFile[] }
export interface BrdCommitResult { commit: string; pushed: boolean; pushError?: string }
```

```ts
// apps/desktop/src/main/brd/brd-git.ts
import { execFileSync } from 'node:child_process';

import type { BrdChangedFile, BrdChanges, BrdCommitResult, BrdFileStatus } from '../../shared/types/brd';
import { type PushAuth, pushBranch } from '../ai/runners/pr-common';
import { getToolPath } from '../cli-tool-manager';
import { getIsolatedGitEnv } from '../utils/git-isolation';

const BRD_PATHSPEC = 'docs/brd';

function git(gitPath: string, cwd: string, args: string[]): string {
  return execFileSync(gitPath, args, { cwd, env: getIsolatedGitEnv(), encoding: 'utf-8', stdio: 'pipe' });
}

function assertRepo(gitPath: string, cwd: string): void {
  try {
    git(gitPath, cwd, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    throw new Error('Not a git repository');
  }
}

function statusOf(code: string): BrdFileStatus {
  if (code === '??') return 'untracked';
  if (code.includes('D')) return 'deleted';
  if (code.includes('A')) return 'added';
  return 'modified';
}

/** Parse `git status --porcelain` output into changed files (renames report the new path). */
export function parsePorcelain(output: string): BrdChangedFile[] {
  const files: BrdChangedFile[] = [];
  for (const line of output.split('\n')) {
    if (line.length < 4) continue;
    const code = line.slice(0, 2);
    let path = line.slice(3).trim();
    const arrow = path.indexOf(' -> ');
    if (arrow >= 0) path = path.slice(arrow + 4);
    files.push({ path, status: statusOf(code) });
  }
  return files;
}

export function brdChanges(projectDir: string, gitPath: string = getToolPath('git')): BrdChanges {
  assertRepo(gitPath, projectDir);
  const branch = git(gitPath, projectDir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const files = parsePorcelain(git(gitPath, projectDir, ['status', '--porcelain', '--', BRD_PATHSPEC]));
  return { branch, files };
}

/** Stage and commit docs/brd only, then optionally push the current branch. A failed push is returned as a warning. */
export async function commitBrd(
  projectDir: string,
  message: string,
  push: boolean,
  auth?: PushAuth,
  gitPath: string = getToolPath('git'),
): Promise<BrdCommitResult> {
  const trimmed = message.trim();
  if (!trimmed) throw new Error('Commit message is required');
  assertRepo(gitPath, projectDir);
  const branch = git(gitPath, projectDir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  git(gitPath, projectDir, ['add', '-A', '--', BRD_PATHSPEC]);
  git(gitPath, projectDir, ['commit', '-m', trimmed, '--', BRD_PATHSPEC]);
  const commit = git(gitPath, projectDir, ['rev-parse', '--short', 'HEAD']).trim();
  if (!push) return { commit, pushed: false };
  const pushError = pushBranch(projectDir, gitPath, branch, auth);
  return pushError ? { commit, pushed: false, pushError } : { commit, pushed: true };
}
```

`src/shared/constants/ipc.ts`, after `BRD_DRAFT_ERROR: 'brd:draft-error',`: `BRD_CHANGES: 'brd:changes',` and `BRD_COMMIT: 'brd:commit',`.

`brd-handlers.ts`: add imports

```ts
import type { BrdChanges, BrdCommitResult } from '../../shared/types/brd';
import { basicAuthHeader, type PushAuth } from '../ai/runners/pr-common';
import { getBitbucketConfig } from '../bitbucket/config';
import { detectBitbucketRepo } from '../bitbucket/remote';
import { brdChanges, commitBrd } from '../brd/brd-git';
```

and, inside `registerBrdHandlers` after the `BRD_CREATE` handler:

```ts
  ipcMain.handle(IPC_CHANNELS.BRD_CHANGES, (_e, projectId: string) =>
    withProject<BrdChanges>(projectId, async (p) => brdChanges(p.path)),
  );
  ipcMain.handle(IPC_CHANNELS.BRD_COMMIT, (_e, projectId: string, message: string, push: boolean) =>
    withProject<BrdCommitResult>(projectId, (p) => commitBrd(p.path, message, push, bitbucketPushAuth(p))),
  );
```

with this module-level helper:

```ts
/** Credentials for the HTTPS push retry when the project is a configured Bitbucket repo. */
function bitbucketPushAuth(project: { path: string; autoBuildPath?: string }): PushAuth | undefined {
  const config = getBitbucketConfig(project);
  const detected = config ? detectBitbucketRepo(project.path) : null;
  return config && detected ? { remoteUrl: detected.remoteUrl, header: basicAuthHeader(config.email, config.apiToken) } : undefined;
}
```

`withProject` currently passes `project.path`; change it to pass the project object (`fn: (project: Project) => Promise<T>`, called with `project`, import `Project` from `'../../shared/types'`) and update the four existing handlers to `(p) => listBrds(p.path)`, `readBrd(p.path, slug)`, `writeBrd(p.path, slug, content)`, `createBrd(p.path, title)`. The existing brd-handlers tests keep passing because they assert on `'/repo'`.

`brd-api.ts`: add to `BrdAPI` and the factory:

```ts
  brdChanges: (projectId: string) => Promise<IPCResult<BrdChanges>>;
  brdCommit: (projectId: string, message: string, push: boolean) => Promise<IPCResult<BrdCommitResult>>;
  // factory
  brdChanges: (projectId) => invokeIpc(IPC_CHANNELS.BRD_CHANGES, projectId),
  brdCommit: (projectId, message, push) => invokeIpc(IPC_CHANNELS.BRD_COMMIT, projectId, message, push),
```

(import `BrdChanges, BrdCommitResult` from `../../../shared/types/brd`). Same two signatures in `ElectronAPI` (`src/shared/types/ipc.ts`, import the types). `browser-mock.ts`: `brdChanges: async () => ({ success: true, data: { branch: 'main', files: [] } }),` and `brdCommit: async () => ({ success: false, error: 'Not available in browser mock' }),`.

- [ ] **Step 4: Run tests, lint, typecheck, commit**

Run: `npx vitest run src/main/brd src/main/ipc-handlers/__tests__/brd-handlers.test.ts && npx biome check src/main/brd/brd-git.ts src/main/ipc-handlers/brd-handlers.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

```bash
git add src/main/brd src/main/ipc-handlers/brd-handlers.ts src/main/ipc-handlers/__tests__/brd-handlers.test.ts src/shared/constants/ipc.ts src/shared/types/brd.ts src/shared/types/ipc.ts src/preload/api/modules/brd-api.ts src/renderer/lib/browser-mock.ts
git commit -m "feat(brd): git status and commit/push of docs/brd with Bitbucket push auth"
```

---

### Task 6: Bitbucket settings section and i18n

**Files:**
- Create: `src/renderer/components/settings/integrations/BitbucketIntegration.tsx`, `src/shared/i18n/locales/en/bitbucket.json`, `src/shared/i18n/locales/fr/bitbucket.json`
- Modify: `src/renderer/components/settings/integrations/index.ts`, `src/renderer/components/settings/ProjectSettingsContent.tsx`, `src/renderer/components/settings/AppSettings.tsx`, `src/renderer/components/settings/sections/SectionRouter.tsx`, `src/shared/i18n/index.ts`, `src/shared/i18n/locales/{en,fr}/settings.json`, `src/shared/i18n/locales/{en,fr}/requirements.json` (commit strings, used in Task 7)
- Test: `src/renderer/components/settings/integrations/__tests__/BitbucketIntegration.test.tsx`

- [ ] **Step 1: i18n files**

`en/bitbucket.json`:

```json
{
  "settings": {
    "enable": "Enable Bitbucket",
    "enableHint": "Open pull requests on Bitbucket Cloud for finished tasks",
    "email": "Atlassian account email",
    "apiToken": "API token",
    "apiTokenHint": "Create one at id.atlassian.com under Security, API tokens, scoped to Bitbucket",
    "workspace": "Workspace",
    "repoSlug": "Repository slug",
    "detect": "Detect from remote",
    "detectNone": "The origin remote is not a bitbucket.org repository",
    "test": "Test connection",
    "testing": "Testing…",
    "connected": "Connected as {{name}}",
    "connectedRepo": "Connected as {{name}}, repository {{repo}}"
  }
}
```

`fr/bitbucket.json`:

```json
{
  "settings": {
    "enable": "Activer Bitbucket",
    "enableHint": "Ouvrir des pull requests sur Bitbucket Cloud pour les tâches terminées",
    "email": "E-mail du compte Atlassian",
    "apiToken": "Jeton d'API",
    "apiTokenHint": "Créez-en un sur id.atlassian.com, rubrique Sécurité, jetons d'API, avec l'accès Bitbucket",
    "workspace": "Espace de travail",
    "repoSlug": "Identifiant du dépôt",
    "detect": "Détecter depuis le remote",
    "detectNone": "Le remote origin n'est pas un dépôt bitbucket.org",
    "test": "Tester la connexion",
    "testing": "Test…",
    "connected": "Connecté en tant que {{name}}",
    "connectedRepo": "Connecté en tant que {{name}}, dépôt {{repo}}"
  }
}
```

`src/shared/i18n/index.ts`: import `enBitbucket`/`frBitbucket`, add `bitbucket: enBitbucket` / `bitbucket: frBitbucket` to the resources, and `'bitbucket'` to `ns`.

`settings.json` both locales, inside `projectSections` after `jira`:

```json
    "bitbucket": {
      "title": "Bitbucket",
      "description": "Bitbucket Cloud pull requests",
      "integrationTitle": "Bitbucket Integration",
      "integrationDescription": "Open pull requests on Bitbucket Cloud for finished tasks",
      "syncDescription": "Connect to Bitbucket"
    },
```

French: `"title": "Bitbucket", "description": "Pull requests Bitbucket Cloud", "integrationTitle": "Intégration Bitbucket", "integrationDescription": "Ouvrir des pull requests sur Bitbucket Cloud pour les tâches terminées", "syncDescription": "Se connecter à Bitbucket"`.

`requirements.json` both locales, new top-level `commit` section:

```json
  "commit": {
    "button": "Commit",
    "title": "Commit BRD changes",
    "description": "Commits changes under docs/brd on branch {{branch}}",
    "message": "Commit message",
    "push": "Push to origin",
    "empty": "No changes under docs/brd",
    "cancel": "Cancel",
    "commit": "Commit",
    "committing": "Committing…",
    "done": "Committed {{commit}}",
    "donePushed": "Committed {{commit}} and pushed",
    "pushFailed": "Committed {{commit}}, but the push failed: {{error}}",
    "status": { "added": "Added", "modified": "Modified", "deleted": "Deleted", "untracked": "New" }
  }
```

French: `"button": "Valider", "title": "Valider les modifications des BRD", "description": "Valide les modifications sous docs/brd sur la branche {{branch}}", "message": "Message de commit", "push": "Pousser vers origin", "empty": "Aucune modification sous docs/brd", "cancel": "Annuler", "commit": "Valider", "committing": "Validation…", "done": "Commit {{commit}} créé", "donePushed": "Commit {{commit}} créé et poussé", "pushFailed": "Commit {{commit}} créé, mais le push a échoué : {{error}}", "status": { "added": "Ajouté", "modified": "Modifié", "deleted": "Supprimé", "untracked": "Nouveau" }`.

- [ ] **Step 2: Write the failing component test**

```tsx
/**
 * @vitest-environment jsdom
 */
// apps/desktop/src/renderer/components/settings/integrations/__tests__/BitbucketIntegration.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BitbucketIntegration } from '../BitbucketIntegration';
import type { ProjectEnvConfig } from '../../../../../shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && Object.keys(o).length ? `${k}:${Object.values(o).join(',')}` : k),
    i18n: { language: 'en' },
  }),
}));

const api = { bitbucketCheckConnection: vi.fn(), bitbucketDetectRepo: vi.fn() };
const env = (over: Partial<ProjectEnvConfig> = {}): ProjectEnvConfig =>
  ({ jiraEnabled: false, jiraEmail: 'jira@b.c', bitbucketEnabled: true, bitbucketEmail: 'a@b.c', bitbucketApiToken: 't', bitbucketWorkspace: 'acme', bitbucketRepoSlug: 'todo', ...over }) as ProjectEnvConfig;

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
});

describe('BitbucketIntegration', () => {
  it('tests the connection and shows the account and repository', async () => {
    api.bitbucketCheckConnection.mockResolvedValue({ success: true, data: { accountName: 'Ann', repoName: 'acme/todo' } });
    render(<BitbucketIntegration projectId="p1" envConfig={env()} updateEnvConfig={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.test' }));
    expect(await screen.findByText('settings.connectedRepo:Ann,acme/todo')).toBeInTheDocument();
  });

  it('shows the error from a failed test', async () => {
    api.bitbucketCheckConnection.mockResolvedValue({ success: false, error: 'HTTP 401' });
    render(<BitbucketIntegration projectId="p1" envConfig={env()} updateEnvConfig={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.test' }));
    expect(await screen.findByText('HTTP 401')).toBeInTheDocument();
  });

  it('detects the repository from the remote or explains that it is not Bitbucket', async () => {
    const update = vi.fn();
    api.bitbucketDetectRepo.mockResolvedValueOnce({ success: true, data: { workspace: 'acme', repoSlug: 'todo' } }).mockResolvedValueOnce({ success: true, data: null });
    render(<BitbucketIntegration projectId="p1" envConfig={env({ bitbucketWorkspace: '', bitbucketRepoSlug: '' })} updateEnvConfig={update} />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.detect' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ bitbucketWorkspace: 'acme', bitbucketRepoSlug: 'todo' }));
    fireEvent.click(screen.getByRole('button', { name: 'settings.detect' }));
    expect(await screen.findByText('settings.detectNone')).toBeInTheDocument();
  });

  it('hides the form when disabled and prefills the email from Jira on enable', () => {
    const update = vi.fn();
    render(<BitbucketIntegration projectId="p1" envConfig={env({ bitbucketEnabled: false, bitbucketEmail: undefined })} updateEnvConfig={update} />);
    expect(screen.queryByLabelText('settings.workspace')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch'));
    expect(update).toHaveBeenCalledWith({ bitbucketEnabled: true, bitbucketEmail: 'jira@b.c' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/settings/integrations/__tests__/BitbucketIntegration.test.tsx`
Expected: FAIL, cannot find `../BitbucketIntegration`.

- [ ] **Step 4: Write the component and wire the section**

```tsx
// apps/desktop/src/renderer/components/settings/integrations/BitbucketIntegration.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Loader2, Search } from 'lucide-react';

import type { ProjectEnvConfig } from '../../../../shared/types';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { PasswordInput } from '../../project-settings/PasswordInput';

interface BitbucketIntegrationProps {
  projectId: string;
  envConfig: ProjectEnvConfig | null;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;
}

export function BitbucketIntegration({ projectId, envConfig, updateEnvConfig }: BitbucketIntegrationProps) {
  const { t } = useTranslation('bitbucket');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectMessage, setDetectMessage] = useState<string | null>(null);

  const enabled = envConfig?.bitbucketEnabled ?? false;

  const toggle = (checked: boolean) => {
    const updates: Partial<ProjectEnvConfig> = { bitbucketEnabled: checked };
    if (checked && !envConfig?.bitbucketEmail && envConfig?.jiraEmail) updates.bitbucketEmail = envConfig.jiraEmail;
    updateEnvConfig(updates);
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    const r = await window.electronAPI.bitbucketCheckConnection(projectId);
    setTesting(false);
    if (!r.success || !r.data) {
      setTestResult({ ok: false, message: r.error ?? 'Unknown error' });
      return;
    }
    setTestResult({
      ok: true,
      message: r.data.repoName
        ? t('settings.connectedRepo', { name: r.data.accountName, repo: r.data.repoName })
        : t('settings.connected', { name: r.data.accountName }),
    });
  };

  const detect = async () => {
    setDetecting(true);
    setDetectMessage(null);
    const r = await window.electronAPI.bitbucketDetectRepo(projectId);
    setDetecting(false);
    if (!r.success) {
      setDetectMessage(r.error ?? 'Unknown error');
      return;
    }
    if (!r.data) {
      setDetectMessage(t('settings.detectNone'));
      return;
    }
    updateEnvConfig({ bitbucketWorkspace: r.data.workspace, bitbucketRepoSlug: r.data.repoSlug });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="font-normal text-foreground">{t('settings.enable')}</Label>
          <p className="text-xs text-muted-foreground">{t('settings.enableHint')}</p>
        </div>
        <Switch checked={enabled} onCheckedChange={toggle} />
      </div>

      {enabled && (
        <>
          <div className="space-y-2">
            <Label htmlFor="bitbucket-email">{t('settings.email')}</Label>
            <Input id="bitbucket-email" value={envConfig?.bitbucketEmail ?? ''} onChange={(e) => updateEnvConfig({ bitbucketEmail: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>{t('settings.apiToken')}</Label>
            <p className="text-xs text-muted-foreground">{t('settings.apiTokenHint')}</p>
            <PasswordInput value={envConfig?.bitbucketApiToken ?? ''} onChange={(value) => updateEnvConfig({ bitbucketApiToken: value })} placeholder="ATATT3x…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="bitbucket-workspace">{t('settings.workspace')}</Label>
              <Input id="bitbucket-workspace" value={envConfig?.bitbucketWorkspace ?? ''} placeholder="acme" onChange={(e) => updateEnvConfig({ bitbucketWorkspace: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bitbucket-repo">{t('settings.repoSlug')}</Label>
              <Input id="bitbucket-repo" value={envConfig?.bitbucketRepoSlug ?? ''} placeholder="todo" onChange={(e) => updateEnvConfig({ bitbucketRepoSlug: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="ghost" disabled={detecting} onClick={() => void detect()}>
              <Search className="mr-2 h-3.5 w-3.5" />
              {t('settings.detect')}
            </Button>
            {detectMessage && <span className="text-xs text-muted-foreground">{detectMessage}</span>}
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
        </>
      )}
    </div>
  );
}
```

Wiring, mirroring Jira exactly:
- `integrations/index.ts`: `export { BitbucketIntegration } from './BitbucketIntegration';`
- `ProjectSettingsContent.tsx`: `'jira' | 'bitbucket' | 'memory'`.
- `AppSettings.tsx`: import `GitPullRequest` from `lucide-react` (add to the list if not already imported) and `{ id: 'bitbucket', icon: GitPullRequest },` after the jira entry.
- `SectionRouter.tsx`: import `BitbucketIntegration` and add a `case 'bitbucket':` after `'jira'` with `projectSections.bitbucket.*` keys and `<BitbucketIntegration projectId={project.id} envConfig={envConfig} updateEnvConfig={updateEnvConfig} />` inside the same `SettingsSection` + `InitializationGuard` structure.

- [ ] **Step 5: Run tests, lint, typecheck, commit**

Run: `npx vitest run src/renderer/components/settings src/shared/i18n && npx biome check src/renderer/components/settings/integrations/BitbucketIntegration.tsx src/shared/i18n/locales/en/bitbucket.json src/shared/i18n/locales/fr/bitbucket.json && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

```bash
git add src/renderer/components/settings src/shared/i18n
git commit -m "feat(bitbucket): project settings section with detection and connection test"
```

---

### Task 7: Commit dialog, BRD list button, store, and view wiring

**Files:**
- Create: `src/renderer/components/requirements/BrdCommitDialog.tsx`
- Modify: `src/renderer/stores/brd-store.ts`, `src/renderer/components/requirements/BrdList.tsx`, `src/renderer/components/requirements/RequirementsView.tsx`
- Test: extend `src/renderer/stores/__tests__/brd-store.test.ts`, create `src/renderer/components/requirements/__tests__/BrdCommitDialog.test.tsx`, extend `src/renderer/components/requirements/__tests__/RequirementsView.test.tsx`

**Interfaces:**
- Consumes: `brdChanges`, `brdCommit` (Task 5), `requirements.commit.*` strings (Task 6).
- Produces: store fields `changes: BrdChanges | null`, `isCommitting`, `lastCommit: BrdCommitResult | null`, `commitError: string | null`; actions `refreshChanges(projectId)`, `commit(projectId, message, push): Promise<boolean>`. `BrdList` props gain `changeCount?: number`, `onCommit?: () => void`. `BrdCommitDialog({ open, onOpenChange, projectId })`. Pure `defaultCommitMessage(files)` exported from `BrdCommitDialog.tsx`.

- [ ] **Step 1: Write the failing tests**

Append to `brd-store.test.ts` (add `brdChanges: vi.fn(), brdCommit: vi.fn()` to `api`):

```ts
describe('brd-store commits', () => {
  it('refreshChanges stores changes, or null when the project is not a repo', async () => {
    api.brdChanges.mockResolvedValueOnce({ success: true, data: { branch: 'develop', files: [{ path: 'docs/brd/a.md', status: 'modified' }] } });
    await useBrdStore.getState().refreshChanges('p1');
    expect(useBrdStore.getState().changes?.files).toHaveLength(1);
    api.brdChanges.mockResolvedValueOnce({ success: false, error: 'Not a git repository' });
    await useBrdStore.getState().refreshChanges('p1');
    expect(useBrdStore.getState().changes).toBeNull();
  });

  it('commit records the result, refreshes changes, and reports errors', async () => {
    api.brdCommit.mockResolvedValueOnce({ success: true, data: { commit: 'abc1234', pushed: true } });
    api.brdChanges.mockResolvedValue({ success: true, data: { branch: 'develop', files: [] } });
    expect(await useBrdStore.getState().commit('p1', 'msg', true)).toBe(true);
    expect(api.brdCommit).toHaveBeenCalledWith('p1', 'msg', true);
    expect(useBrdStore.getState().lastCommit).toEqual({ commit: 'abc1234', pushed: true });
    expect(useBrdStore.getState().changes?.files).toEqual([]);
    api.brdCommit.mockResolvedValueOnce({ success: false, error: 'nothing to commit' });
    expect(await useBrdStore.getState().commit('p1', 'msg', false)).toBe(false);
    expect(useBrdStore.getState().commitError).toBe('nothing to commit');
  });
});
```

```tsx
/**
 * @vitest-environment jsdom
 */
// apps/desktop/src/renderer/components/requirements/__tests__/BrdCommitDialog.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrdCommitDialog, defaultCommitMessage } from '../BrdCommitDialog';
import { useBrdStore } from '../../../stores/brd-store';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && Object.keys(o).length ? `${k}:${Object.values(o).join(',')}` : k),
    i18n: { language: 'en' },
  }),
}));

const api = { brdCommit: vi.fn(), brdChanges: vi.fn() };
const files = [
  { path: 'docs/brd/todo-app.md', status: 'modified' as const },
  { path: 'docs/brd/todo-app.requirements.json', status: 'untracked' as const },
  { path: 'docs/brd/onboarding.md', status: 'untracked' as const },
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  useBrdStore.getState().reset();
  useBrdStore.setState({ changes: { branch: 'develop', files } });
  api.brdChanges.mockResolvedValue({ success: true, data: { branch: 'develop', files: [] } });
});

describe('defaultCommitMessage', () => {
  it('lists slugs once, sorted, and says add when everything is new', () => {
    expect(defaultCommitMessage(files)).toBe('docs(brd): update onboarding, todo-app');
    expect(defaultCommitMessage(files.slice(1))).toBe('docs(brd): add onboarding, todo-app');
  });
});

describe('BrdCommitDialog', () => {
  it('lists files, prefills the message, commits with push, and shows the result', async () => {
    api.brdCommit.mockResolvedValue({ success: true, data: { commit: 'abc1234', pushed: true } });
    render(<BrdCommitDialog open onOpenChange={vi.fn()} projectId="p1" />);
    expect(screen.getByText('docs/brd/todo-app.md')).toBeInTheDocument();
    expect(screen.getByLabelText('commit.message')).toHaveValue('docs(brd): update onboarding, todo-app');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'commit.commit' }));
    await waitFor(() => expect(api.brdCommit).toHaveBeenCalledWith('p1', 'docs(brd): update onboarding, todo-app', true));
    expect(await screen.findByText('commit.donePushed:abc1234')).toBeInTheDocument();
  });

  it('remembers the push choice and shows a push warning', async () => {
    api.brdCommit.mockResolvedValue({ success: true, data: { commit: 'abc1234', pushed: false, pushError: 'rejected' } });
    render(<BrdCommitDialog open onOpenChange={vi.fn()} projectId="p1" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(localStorage.getItem('brd.commit.push')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'commit.commit' }));
    await waitFor(() => expect(api.brdCommit).toHaveBeenCalledWith('p1', expect.any(String), false));
    expect(await screen.findByText('commit.pushFailed:abc1234,rejected')).toBeInTheDocument();
  });
});
```

Append to `RequirementsView.test.tsx` (add `brdChanges: vi.fn().mockResolvedValue({ success: true, data: { branch: 'develop', files: [{ path: 'docs/brd/a.md', status: 'modified' }] } })` to `api`):

```tsx
  it('shows the Commit button with the change count and refreshes after a save', async () => {
    api.brdList.mockResolvedValue({ success: true, data: [] });
    render(<RequirementsView projectId="p1" />);
    expect(await screen.findByRole('button', { name: /commit.button/ })).toHaveTextContent('1');
    expect(api.brdChanges).toHaveBeenCalledTimes(1);
    useBrdStore.setState({ savedContent: 'changed' });
    await waitFor(() => expect(api.brdChanges).toHaveBeenCalledTimes(2));
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/stores/__tests__/brd-store.test.ts src/renderer/components/requirements`
Expected: FAIL.

- [ ] **Step 3: Store additions**

In `brd-store.ts`: import `BrdChanges, BrdCommitResult` from `'../../shared/types/brd'`; add to `BrdState`:

```ts
  changes: BrdChanges | null;
  isCommitting: boolean;
  lastCommit: BrdCommitResult | null;
  commitError: string | null;
  refreshChanges: (projectId: string) => Promise<void>;
  commit: (projectId: string, message: string, push: boolean) => Promise<boolean>;
```

to `initial`: `changes: null as BrdChanges | null, isCommitting: false, lastCommit: null as BrdCommitResult | null, commitError: null as string | null,`; and the actions:

```ts
  refreshChanges: async (projectId) => {
    const result = await window.electronAPI.brdChanges(projectId);
    set({ changes: result.success && result.data ? result.data : null });
  },

  commit: async (projectId, message, push) => {
    set({ isCommitting: true, commitError: null, lastCommit: null });
    const result = await window.electronAPI.brdCommit(projectId, message, push);
    if (!result.success || !result.data) {
      set({ commitError: result.error ?? 'Unknown error', isCommitting: false });
      return false;
    }
    set({ lastCommit: result.data, isCommitting: false });
    await get().refreshChanges(projectId);
    return true;
  },
```

- [ ] **Step 4: Dialog, list button, view wiring**

```tsx
// apps/desktop/src/renderer/components/requirements/BrdCommitDialog.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileMinus, FilePen, FilePlus, Loader2 } from 'lucide-react';

import type { BrdChangedFile } from '../../../shared/types/brd';
import { useBrdStore } from '../../stores/brd-store';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';

const PUSH_KEY = 'brd.commit.push';

function slugOf(path: string): string {
  return path.split('/').pop()?.replace(/\.requirements\.json$/, '').replace(/\.md$/, '') ?? path;
}

/** `docs(brd): update a, b`, or `add` when every change is new. */
export function defaultCommitMessage(files: BrdChangedFile[]): string {
  const slugs = Array.from(new Set(files.map((f) => slugOf(f.path)))).sort();
  const allNew = files.length > 0 && files.every((f) => f.status === 'untracked' || f.status === 'added');
  return `docs(brd): ${allNew ? 'add' : 'update'} ${slugs.join(', ')}`;
}

function readPushPreference(): boolean {
  try {
    return localStorage.getItem(PUSH_KEY) !== 'false';
  } catch {
    return true;
  }
}

const icons = { added: FilePlus, untracked: FilePlus, modified: FilePen, deleted: FileMinus } as const;

interface BrdCommitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export function BrdCommitDialog({ open, onOpenChange, projectId }: BrdCommitDialogProps) {
  const { t } = useTranslation('requirements');
  const { changes, commit, isCommitting, lastCommit, commitError } = useBrdStore();
  const files = changes?.files ?? [];
  const [message, setMessage] = useState('');
  const [push, setPush] = useState(readPushPreference);

  useEffect(() => {
    if (open) {
      setMessage(defaultCommitMessage(files));
      useBrdStore.setState({ lastCommit: null, commitError: null });
    }
    // Prefill once per open; the user edits the message afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const togglePush = (value: boolean) => {
    setPush(value);
    try {
      localStorage.setItem(PUSH_KEY, String(value));
    } catch {
      // per-viewer convenience only
    }
  };

  const resultLine = lastCommit
    ? lastCommit.pushed
      ? t('commit.donePushed', { commit: lastCommit.commit })
      : lastCommit.pushError
        ? t('commit.pushFailed', { commit: lastCommit.commit, error: lastCommit.pushError })
        : t('commit.done', { commit: lastCommit.commit })
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('commit.title')}</DialogTitle>
          <DialogDescription>{t('commit.description', { branch: changes?.branch ?? '' })}</DialogDescription>
        </DialogHeader>
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('commit.empty')}</p>
        ) : (
          <ul className="max-h-40 space-y-1 overflow-auto text-sm">
            {files.map((f) => {
              const Icon = icons[f.status];
              return (
                <li key={f.path} className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.path}</span>
                  <span className="text-xs text-muted-foreground">{t(`commit.status.${f.status}`)}</span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="space-y-2">
          <Label htmlFor="brd-commit-message">{t('commit.message')}</Label>
          <Textarea id="brd-commit-message" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="brd-commit-push">{t('commit.push')}</Label>
          <Switch id="brd-commit-push" checked={push} onCheckedChange={togglePush} />
        </div>
        {commitError && <p className="text-xs text-destructive">{commitError}</p>}
        {resultLine && <p className={`text-xs ${lastCommit?.pushError ? 'text-amber-600' : 'text-muted-foreground'}`}>{resultLine}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCommitting}>{t('commit.cancel')}</Button>
          <Button onClick={() => void commit(projectId, message, push)} disabled={isCommitting || files.length === 0 || !message.trim()}>
            {isCommitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isCommitting ? t('commit.committing') : t('commit.commit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`BrdList.tsx`: add props `changeCount?: number; onCommit?: () => void;`, import `GitCommitHorizontal` from `lucide-react`, and render before the New BRD button, inside a `flex items-center gap-2` wrapper:

```tsx
        {onCommit && (
          <Button size="sm" variant="outline" onClick={onCommit} disabled={!changeCount}>
            <GitCommitHorizontal className="mr-1 h-4 w-4" />
            {t('commit.button')}
            {changeCount ? <Badge variant="secondary" className="ml-1">{changeCount}</Badge> : null}
          </Button>
        )}
```

`RequirementsView.tsx`:
- import `BrdCommitDialog`; read `changes`, `refreshChanges` from `useBrdStore()`; `const [showCommit, setShowCommit] = useState(false);`
- in the mount effect, after `void load(projectId)...` add `void refreshChanges(projectId);` and add `refreshChanges` to the deps.
- refresh after saves:

```tsx
  const savedContent = useBrdStore((s) => s.savedContent);
  const savedSet = useRequirementsStore((s) => s.savedSet);
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    void refreshChanges(projectId);
  }, [savedContent, savedSet, projectId, refreshChanges]);
```

(import `useRef`.)
- pass `changeCount={changes?.files.length}` and `onCommit={changes ? () => setShowCommit(true) : undefined}` to `BrdList`; render `<BrdCommitDialog open={showCommit} onOpenChange={setShowCommit} projectId={projectId} />` next to `NewBrdDialog`.

- [ ] **Step 5: Run tests, lint, typecheck, commit**

Run: `npx vitest run src/renderer/stores/__tests__/brd-store.test.ts src/renderer/components/requirements && npx biome check src/renderer/components/requirements src/renderer/stores/brd-store.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

```bash
git add src/renderer/stores/brd-store.ts src/renderer/stores/__tests__/brd-store.test.ts src/renderer/components/requirements
git commit -m "feat(brd): commit dialog with change list, push switch, and result line"
```

---

### Task 8: Full gate and manual check

- [ ] **Step 1: Full suite, lint, typecheck**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all green (pre-existing lint warnings only).

- [ ] **Step 2: Manual check in the running app**

Kill leftover Electron processes, then `nvm use 24 && npm run dev:mcp` from the repo root. Drive with the Playwright-over-CDP helper.

Without credentials (todo project, origin not on Bitbucket):
1. Settings, Bitbucket: section renders; enabling prefills the email from Jira; "Detect from remote" reports the origin is not Bitbucket; Save persists `BITBUCKET_*` in `.auto-claude/.env`.
2. Requirements: the Commit button shows the change count; edit and save a BRD, the count updates; open the dialog, message is prefilled, turn push off, Commit; the dialog shows `Committed <hash>`; `git log -1 -- docs/brd` in the todo repo shows the commit; the count drops.
3. Task detail, Create PR on a finished task still follows the GitHub path (unchanged behavior; can end in a gh error when gh is not authenticated, which is pre-existing).

With a Bitbucket Cloud repo and token (needs the user): connect and test in settings, create a PR from a finished task and open the URL, commit a BRD change with push and confirm the commit on Bitbucket.

- [ ] **Step 3: Commit fixes from the manual check**

Commit with `fix(bitbucket): ...` or `fix(brd): ...` describing what the run exposed.

---

## Spec coverage checklist (self-review)

| Spec section | Task |
|---|---|
| 2.1 env keys, 2.2 detection, 2.3 provider choice, 2.4 data | 1, 3 |
| 3.1 client | 2 |
| 3.2 shared helpers, 3.3 push credentials, 3.4 Bitbucket PR creation, 3.5 handler | 3 |
| 3.6 settings IPC, preload, mock | 4 |
| 3.7 error handling | 2, 3, 4 |
| 4 BRD git service, IPC, renderer | 5, 7 |
| 5 settings section and i18n | 6 |
| 6 testing, manual check | every task; 8 |
