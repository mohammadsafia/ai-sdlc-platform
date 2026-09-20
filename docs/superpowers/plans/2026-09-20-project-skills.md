# Project Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a project declare Agent Skills (local `.claude/skills/` plus central git repos) that Aperant discovers, shows in a read-only settings panel, and injects into the spec, planning, coding, and QA agents, with a `load_skill` tool for on-demand loading.

**Architecture:** A new pure-TypeScript module `apps/desktop/src/main/ai/skills/` does config loading, discovery, resolution, and central-repo sync in the main process and produces a serializable `SkillsSnapshot`. The snapshot travels to the agent worker inside the existing serialized tool context; the worker builds a `## PROJECT SKILLS` prompt section from it (no network) and exposes a `load_skill` tool. A small IPC surface, Zustand store, and settings tab show the resolved skills.

**Tech Stack:** TypeScript strict, Electron 40 main process + worker_threads, Vercel AI SDK v6 tool definitions via `Tool.define`, Zod (`zod/v3` import to match existing tools), Vitest 4, React 19 + Zustand 5 + react-i18next, git CLI via `execFile`.

**Spec:** `docs/superpowers/specs/2026-09-20-project-skills-design.md`

## Global Constraints

- All code under `apps/desktop/`. Run commands from `apps/desktop/` with Node 24 (`nvm use 24`).
- Never use `process.platform` directly; import from `src/main/platform/`.
- No `console.log` in production code paths. Use the existing `debug`/`postLog` helpers where the touched file already uses them; otherwise omit logging.
- All renderer text goes through `react-i18next`; add every key to both `src/shared/i18n/locales/en/*.json` and `src/shared/i18n/locales/fr/*.json`.
- Import Zod as `import { z } from 'zod/v3';` in files under `src/main/ai/` (matches `tools/define.ts`).
- Shared files in the target project are `.claude/skills/`, `.claude/skills.json`, `.claude/skills.lock.json`. Nothing shared lives under `.auto-claude/` (the app gitignores it).
- Limits, verbatim from the spec: catalog description cap 200 characters; total pinned content per agent max 40,000 characters (blocking error, never truncate); `load_skill` file listing cap 200 entries; resource size cap 512 KB; git operation timeout 120 seconds; allowed repo URL schemes `https://`, `ssh://`, and `git@host:path`.
- Tests: `npx vitest run <path>` from `apps/desktop/`. Lint: `npm run lint`. Types: `npm run typecheck`.
- Commit after every task on branch `feat/project-skills`. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File Structure

New files:

| Path (under `apps/desktop/src/`) | Responsibility |
|---|---|
| `main/ai/skills/types.ts` | All skills types and constants |
| `main/ai/skills/config.ts` | Load/validate `skills.json`, load/write `skills.lock.json`, URL scheme check |
| `main/ai/skills/frontmatter.ts` | Minimal YAML frontmatter parser (`name`, `description`) |
| `main/ai/skills/discovery.ts` | Find `*/SKILL.md` under a directory → `SkillDefinition[]` + warnings |
| `main/ai/skills/skill-files.ts` | Read skill body, list bundled files, read a bundled resource safely, append usage record |
| `main/ai/skills/resolver.ts` | Pure merge/pin logic and agent→phase mapping |
| `main/ai/skills/sync.ts` | Mirror clone + immutable checkout per commit, refresh, injectable git runner |
| `main/ai/skills/resolve.ts` | `resolveSkills()` / `refreshSkills()` orchestration (main process) |
| `main/ai/skills/prompt-section.ts` | Build the `## PROJECT SKILLS` prompt section |
| `main/ai/skills/index.ts` | Re-exports |
| `main/ai/tools/builtin/load-skill.ts` | The `load_skill` tool |
| `main/ipc-handlers/skills-handlers.ts` | `skills:list`, `skills:refresh` |
| `renderer/stores/skills-store.ts` | Snapshot state for the panel |
| `renderer/components/project-settings/SkillsSettings.tsx` | Read-only Skills panel |
| `renderer/components/task-detail/TaskSkillsUsed.tsx` | "Skills used" list in task detail |
| Tests next to each module under `__tests__/` | |

Modified files:

| Path | Change |
|---|---|
| `main/ai/tools/types.ts` | `ToolContext.skillsSnapshot?` |
| `main/ai/agent/types.ts` | `SerializableSessionConfig.toolContext.skillsSnapshot?` |
| `main/ai/prompts/types.ts` | `PromptContext.skillsSection?` |
| `main/ai/prompts/prompt-loader.ts` | Insert skills section in `injectContext` |
| `main/ai/agent/worker.ts` | `assemblePrompt` takes agent type, builds section, records pins; `buildToolContext` copies snapshot |
| `main/ai/orchestration/subagent-executor.ts` | `loadPrompt(promptName, agentType)` |
| `main/ai/tools/build-registry.ts` | Register `load_skill` |
| `main/ai/config/agent-configs.ts` | Add `load_skill` to every config that has `Read` |
| `main/agent/agent-manager.ts` | Resolve snapshot before spawning; fail launch on snapshot error |
| `shared/constants/ipc.ts` | `SKILLS_LIST`, `SKILLS_REFRESH` |
| `main/ipc-handlers/index.ts` | Register skills handlers |
| `preload/api/project-api.ts` | `listSkills`, `refreshSkills` |
| `renderer/components/settings/ProjectSettingsContent.tsx` | Add `'skills'` to `ProjectSettingsSection` |
| `renderer/components/settings/AppSettings.tsx` | Nav item |
| `renderer/components/settings/sections/SectionRouter.tsx` | Route `'skills'` |
| `renderer/components/task-detail/TaskDetailModal.tsx` | Mount `TaskSkillsUsed` in Files tab |
| `shared/i18n/locales/{en,fr}/settings.json`, `tasks.json` | Keys |

---

### Task 1: Types and config loader

**Files:**
- Create: `apps/desktop/src/main/ai/skills/types.ts`
- Create: `apps/desktop/src/main/ai/skills/config.ts`
- Test: `apps/desktop/src/main/ai/skills/__tests__/config.test.ts`

**Interfaces:**
- Produces: every type below, `loadSkillsConfig(projectDir): Promise<ConfigLoadResult>`, `loadSkillsLock(projectDir): Promise<SkillsLock>`, `writeSkillsLock(projectDir, lock): Promise<void>`, `isAllowedRepoUrl(url, allowedSchemes?): boolean`, `DEFAULT_ALLOWED_SCHEMES`.

- [ ] **Step 1: Write `types.ts`**

```ts
// apps/desktop/src/main/ai/skills/types.ts
/**
 * Project Skills — shared types.
 * A skill is a folder with SKILL.md (Agent Skills standard).
 * See docs/superpowers/specs/2026-09-20-project-skills-design.md
 */

export const SKILLS_DIR = '.claude/skills';
export const SKILLS_CONFIG_FILE = '.claude/skills.json';
export const SKILLS_LOCK_FILE = '.claude/skills.lock.json';
/** Written inside the spec directory by prompt assembly and the load_skill tool. */
export const SKILLS_USAGE_FILE = 'skills_used.json';

export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_PINNED_CHARS = 40_000;
export const MAX_SKILL_FILES_LISTED = 200;
export const MAX_RESOURCE_BYTES = 512 * 1024;
export const GIT_TIMEOUT_MS = 120_000;

export const PHASE_GROUPS = ['spec', 'planning', 'coding', 'qa'] as const;
export type PhaseGroup = (typeof PHASE_GROUPS)[number];

export type SkillSource = 'local' | 'central';

export interface SkillDefinition {
  name: string;
  description: string;
  source: SkillSource;
  /** Central only */
  repoUrl?: string;
  /** Central only */
  commit?: string;
  /** Absolute path to the skill folder, symlinks resolved */
  dir: string;
  /** Set on a central skill shadowed by a local skill of the same name */
  overriddenBy?: 'local';
}

export interface CentralRepoConfig {
  url: string;
  ref?: string;
  /** Folder inside the repo holding skill folders. "." = repo root. */
  subpath: string;
  /** Allow-list of skill names from this repo */
  include?: string[];
}

export interface SkillsConfig {
  centralRepos: CentralRepoConfig[];
  /** target (agent type or phase group) → skill names */
  pins: Record<string, string[]>;
  disabled: string[];
}

export interface SkillsLockEntry {
  ref: string;
  commit: string;
  resolvedAt: string;
}

export interface SkillsLock {
  repos: Record<string, SkillsLockEntry>;
}

/** Serializable, read-only result of resolution. Crosses the worker boundary. */
export interface SkillsSnapshot {
  skills: SkillDefinition[];
  pins: Record<string, string[]>;
  warnings: string[];
  /** Blocking error. When set, pipeline start must fail with this message. */
  error?: string;
  lock: SkillsLock;
}

export interface AgentSkills {
  pinned: SkillDefinition[];
  catalog: SkillDefinition[];
}

export interface SkillUsageRecord {
  name: string;
  resource?: string;
  agentType: string;
  pinned: boolean;
  at: string;
}

export function emptySnapshot(): SkillsSnapshot {
  return { skills: [], pins: {}, warnings: [], lock: { repos: {} } };
}
```

- [ ] **Step 2: Write the failing tests for config**

```ts
// apps/desktop/src/main/ai/skills/__tests__/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  loadSkillsConfig,
  loadSkillsLock,
  writeSkillsLock,
  isAllowedRepoUrl,
} from '../config';

describe('skills config', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(path.join(tmpdir(), 'skills-config-'));
    mkdirSync(path.join(projectDir, '.claude'), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('returns empty config when file is missing', async () => {
    const result = await loadSkillsConfig(projectDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.exists).toBe(false);
    expect(result.config).toEqual({ centralRepos: [], pins: {}, disabled: [] });
  });

  it('parses a valid config and applies subpath default', async () => {
    writeFileSync(
      path.join(projectDir, '.claude', 'skills.json'),
      JSON.stringify({
        centralRepos: [{ url: 'https://github.com/acme/skills.git', include: ['a'] }],
        pins: { coder: ['a'] },
      }),
    );
    const result = await loadSkillsConfig(projectDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.exists).toBe(true);
    expect(result.config.centralRepos[0]).toEqual({
      url: 'https://github.com/acme/skills.git',
      subpath: 'skills',
      include: ['a'],
    });
    expect(result.config.pins).toEqual({ coder: ['a'] });
    expect(result.config.disabled).toEqual([]);
  });

  it('reports malformed JSON as an error', async () => {
    writeFileSync(path.join(projectDir, '.claude', 'skills.json'), '{ not json');
    const result = await loadSkillsConfig(projectDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('skills.json');
  });

  it('reports unknown fields and bad shapes as an error', async () => {
    writeFileSync(
      path.join(projectDir, '.claude', 'skills.json'),
      JSON.stringify({ centralRepos: 'nope', extra: 1 }),
    );
    const result = await loadSkillsConfig(projectDir);
    expect(result.ok).toBe(false);
  });

  it('rejects disallowed URL schemes', async () => {
    writeFileSync(
      path.join(projectDir, '.claude', 'skills.json'),
      JSON.stringify({ centralRepos: [{ url: 'file:///tmp/x' }] }),
    );
    const result = await loadSkillsConfig(projectDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('file:///tmp/x');
  });

  it('accepts https, ssh and scp-style urls', () => {
    expect(isAllowedRepoUrl('https://github.com/a/b.git')).toBe(true);
    expect(isAllowedRepoUrl('ssh://git@bitbucket.org/a/b.git')).toBe(true);
    expect(isAllowedRepoUrl('git@bitbucket.org:a/b.git')).toBe(true);
    expect(isAllowedRepoUrl('http://github.com/a/b.git')).toBe(false);
    expect(isAllowedRepoUrl('file:///tmp/x')).toBe(false);
    expect(isAllowedRepoUrl('/tmp/x')).toBe(false);
    expect(isAllowedRepoUrl('file:///tmp/x', ['file:'])).toBe(true);
  });

  it('loads an empty lock when missing and round-trips a written lock', async () => {
    expect(await loadSkillsLock(projectDir)).toEqual({ repos: {} });
    const lock = {
      repos: { 'https://x/y.git': { ref: 'main', commit: 'abc', resolvedAt: '2026-09-20T00:00:00.000Z' } },
    };
    await writeSkillsLock(projectDir, lock);
    expect(existsSync(path.join(projectDir, '.claude', 'skills.lock.json'))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(projectDir, '.claude', 'skills.lock.json'), 'utf-8'))).toEqual(lock);
    expect(await loadSkillsLock(projectDir)).toEqual(lock);
  });

  it('treats a malformed lock as empty', async () => {
    writeFileSync(path.join(projectDir, '.claude', 'skills.lock.json'), 'garbage');
    expect(await loadSkillsLock(projectDir)).toEqual({ repos: {} });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/main/ai/skills/__tests__/config.test.ts`
Expected: FAIL, cannot resolve `../config`.

- [ ] **Step 4: Write `config.ts`**

```ts
// apps/desktop/src/main/ai/skills/config.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod/v3';

import {
  SKILLS_CONFIG_FILE,
  SKILLS_LOCK_FILE,
  type SkillsConfig,
  type SkillsLock,
} from './types';

export const DEFAULT_ALLOWED_SCHEMES = ['https:', 'ssh:'] as const;

const SCP_STYLE_URL = /^[\w.-]+@[\w.-]+:[\w./~-]+$/;

/**
 * Accepts https://, ssh://, and scp-style git@host:path URLs.
 * `allowedSchemes` overrides the scheme list (tests pass ['file:']).
 */
export function isAllowedRepoUrl(
  url: string,
  allowedSchemes: readonly string[] = DEFAULT_ALLOWED_SCHEMES,
): boolean {
  if (SCP_STYLE_URL.test(url) && allowedSchemes.includes('ssh:')) return true;
  try {
    const parsed = new URL(url);
    return allowedSchemes.includes(parsed.protocol);
  } catch {
    return false;
  }
}

const centralRepoSchema = z
  .object({
    url: z.string().min(1),
    ref: z.string().min(1).optional(),
    subpath: z.string().min(1).default('skills'),
    include: z.array(z.string().min(1)).optional(),
  })
  .strict();

const skillsConfigSchema = z
  .object({
    centralRepos: z.array(centralRepoSchema).default([]),
    pins: z.record(z.array(z.string().min(1))).default({}),
    disabled: z.array(z.string().min(1)).default([]),
  })
  .strict();

const lockEntrySchema = z.object({
  ref: z.string().min(1),
  commit: z.string().min(1),
  resolvedAt: z.string().min(1),
});

const skillsLockSchema = z.object({
  repos: z.record(lockEntrySchema),
});

export type ConfigLoadResult =
  | { ok: true; config: SkillsConfig; exists: boolean }
  | { ok: false; error: string };

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function loadSkillsConfig(
  projectDir: string,
  allowedSchemes: readonly string[] = DEFAULT_ALLOWED_SCHEMES,
): Promise<ConfigLoadResult> {
  const filePath = path.join(projectDir, SKILLS_CONFIG_FILE);
  const raw = await readIfExists(filePath);
  if (raw === null) {
    return { ok: true, exists: false, config: { centralRepos: [], pins: {}, disabled: [] } };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `${SKILLS_CONFIG_FILE} is not valid JSON: ${message}` };
  }

  const parsed = skillsConfigSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return { ok: false, error: `${SKILLS_CONFIG_FILE} is invalid: ${issues}` };
  }

  for (const repo of parsed.data.centralRepos) {
    if (!isAllowedRepoUrl(repo.url, allowedSchemes)) {
      return {
        ok: false,
        error: `${SKILLS_CONFIG_FILE}: repository URL "${repo.url}" is not allowed. Use https://, ssh://, or git@host:path.`,
      };
    }
  }

  return { ok: true, exists: true, config: parsed.data };
}

export async function loadSkillsLock(projectDir: string): Promise<SkillsLock> {
  const raw = await readIfExists(path.join(projectDir, SKILLS_LOCK_FILE));
  if (raw === null) return { repos: {} };
  try {
    const parsed = skillsLockSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : { repos: {} };
  } catch {
    return { repos: {} };
  }
}

export async function writeSkillsLock(projectDir: string, lock: SkillsLock): Promise<void> {
  const filePath = path.join(projectDir, SKILLS_LOCK_FILE);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(lock, null, 2)}\n`, 'utf-8');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/main/ai/skills/__tests__/config.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/ai/skills/types.ts apps/desktop/src/main/ai/skills/config.ts apps/desktop/src/main/ai/skills/__tests__/config.test.ts
git commit -m "feat(skills): add skills types and config loader

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Frontmatter parser and discovery

**Files:**
- Create: `apps/desktop/src/main/ai/skills/frontmatter.ts`
- Create: `apps/desktop/src/main/ai/skills/discovery.ts`
- Test: `apps/desktop/src/main/ai/skills/__tests__/frontmatter.test.ts`
- Test: `apps/desktop/src/main/ai/skills/__tests__/discovery.test.ts`

**Interfaces:**
- Consumes: `SkillDefinition`, `SkillSource`, `MAX_DESCRIPTION_LENGTH` from Task 1.
- Produces: `parseFrontmatter(content): { fields: Record<string,string>; body: string } | null`; `discoverSkills(dir, source, origin?): Promise<DiscoveryResult>` where `DiscoveryResult = { skills: SkillDefinition[]; warnings: string[] }` and `origin = { repoUrl?: string; commit?: string }`; `SKILL_NAME_PATTERN`.

- [ ] **Step 1: Write the failing frontmatter tests**

```ts
// apps/desktop/src/main/ai/skills/__tests__/frontmatter.test.ts
import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../frontmatter';

describe('parseFrontmatter', () => {
  it('parses simple key: value pairs and returns the body', () => {
    const r = parseFrontmatter('---\nname: my-skill\ndescription: Does things\n---\n# Body\ntext');
    expect(r).toEqual({ fields: { name: 'my-skill', description: 'Does things' }, body: '# Body\ntext' });
  });

  it('strips single and double quotes', () => {
    const r = parseFrontmatter('---\nname: "a-b"\ndescription: \'x: y\'\n---\n');
    expect(r?.fields).toEqual({ name: 'a-b', description: 'x: y' });
  });

  it('folds block scalars (| and >) into one line', () => {
    const r = parseFrontmatter('---\nname: a\ndescription: >\n  first line\n  second line\n---\nbody');
    expect(r?.fields.description).toBe('first line second line');
    expect(r?.body).toBe('body');
  });

  it('ignores unknown keys but keeps them in fields', () => {
    const r = parseFrontmatter('---\nname: a\nlicense: MIT\ndescription: d\n---\n');
    expect(r?.fields.license).toBe('MIT');
  });

  it('returns null when there is no frontmatter block', () => {
    expect(parseFrontmatter('# just markdown')).toBeNull();
    expect(parseFrontmatter('---\nname: a\n')).toBeNull();
  });

  it('handles CRLF line endings', () => {
    const r = parseFrontmatter('---\r\nname: a\r\ndescription: d\r\n---\r\nbody');
    expect(r?.fields).toEqual({ name: 'a', description: 'd' });
    expect(r?.body).toBe('body');
  });
});
```

- [ ] **Step 2: Write the failing discovery tests**

```ts
// apps/desktop/src/main/ai/skills/__tests__/discovery.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { discoverSkills } from '../discovery';

function writeSkill(root: string, folder: string, frontmatter: string, body = '# Skill\n') {
  const dir = path.join(root, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}`);
  return dir;
}

describe('discoverSkills', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'skills-disc-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty result for a missing directory', async () => {
    const r = await discoverSkills(path.join(root, 'nope'), 'local');
    expect(r).toEqual({ skills: [], warnings: [] });
  });

  it('discovers valid skills sorted by name with resolved dir', async () => {
    writeSkill(root, 'zeta', 'name: zeta\ndescription: Z');
    writeSkill(root, 'alpha', 'name: alpha\ndescription: A');
    const r = await discoverSkills(root, 'local');
    expect(r.warnings).toEqual([]);
    expect(r.skills.map((s) => s.name)).toEqual(['alpha', 'zeta']);
    expect(r.skills[0]).toEqual({
      name: 'alpha',
      description: 'A',
      source: 'local',
      dir: realpathSync(path.join(root, 'alpha')),
    });
  });

  it('attaches repoUrl and commit for central skills', async () => {
    writeSkill(root, 'a', 'name: a\ndescription: A');
    const r = await discoverSkills(root, 'central', { repoUrl: 'https://x/y.git', commit: 'abc' });
    expect(r.skills[0].repoUrl).toBe('https://x/y.git');
    expect(r.skills[0].commit).toBe('abc');
    expect(r.skills[0].source).toBe('central');
  });

  it('skips folders without SKILL.md, without frontmatter, or with name mismatch', async () => {
    mkdirSync(path.join(root, 'empty'));
    mkdirSync(path.join(root, 'nofm'));
    writeFileSync(path.join(root, 'nofm', 'SKILL.md'), '# no frontmatter');
    writeSkill(root, 'folder', 'name: other\ndescription: D');
    writeSkill(root, 'missing-desc', 'name: missing-desc');
    writeFileSync(path.join(root, 'stray.md'), 'x');
    const r = await discoverSkills(root, 'local');
    expect(r.skills).toEqual([]);
    expect(r.warnings).toHaveLength(3);
    expect(r.warnings.join('\n')).toContain('nofm');
    expect(r.warnings.join('\n')).toContain('folder');
    expect(r.warnings.join('\n')).toContain('missing-desc');
  });

  it('rejects names that are not kebab-case', async () => {
    writeSkill(root, 'Bad_Name', 'name: Bad_Name\ndescription: D');
    const r = await discoverSkills(root, 'local');
    expect(r.skills).toEqual([]);
    expect(r.warnings[0]).toContain('Bad_Name');
  });

  it('caps long descriptions at 200 characters with a warning', async () => {
    writeSkill(root, 'long', `name: long\ndescription: ${'x'.repeat(250)}`);
    const r = await discoverSkills(root, 'local');
    expect(r.skills[0].description).toHaveLength(200);
    expect(r.warnings[0]).toContain('long');
  });

  it('follows a symlinked skill folder and records the real path', async () => {
    const real = writeSkill(root, 'real-target', 'name: linked\ndescription: L');
    symlinkSync(real, path.join(root, 'linked'), 'dir');
    const r = await discoverSkills(root, 'local');
    const linked = r.skills.find((s) => s.name === 'linked');
    expect(linked?.dir).toBe(realpathSync(real));
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/main/ai/skills/__tests__/frontmatter.test.ts src/main/ai/skills/__tests__/discovery.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Write `frontmatter.ts`**

```ts
// apps/desktop/src/main/ai/skills/frontmatter.ts
/**
 * Minimal YAML frontmatter reader. Supports only what SKILL.md needs:
 * top-level `key: value` lines, quoted scalars, and `|` / `>` block scalars
 * folded to a single line. Nested structures are ignored.
 */

export interface Frontmatter {
  fields: Record<string, string>;
  body: string;
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

export function parseFrontmatter(content: string): Frontmatter | null {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return null;

  const end = normalized.indexOf('\n---', 4);
  if (end === -1) return null;

  const block = normalized.slice(4, end);
  const afterClose = normalized.indexOf('\n', end + 1);
  const body = afterClose === -1 ? '' : normalized.slice(afterClose + 1);

  const lines = block.split('\n');
  const fields: Record<string, string> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    let value = match[2];

    if (value === '|' || value === '>') {
      const parts: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        parts.push(lines[i + 1].trim());
        i++;
      }
      value = parts.join(' ');
    } else {
      value = unquote(value);
    }
    fields[key] = value;
  }

  return { fields, body };
}
```

- [ ] **Step 5: Write `discovery.ts`**

```ts
// apps/desktop/src/main/ai/skills/discovery.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parseFrontmatter } from './frontmatter';
import { MAX_DESCRIPTION_LENGTH, type SkillDefinition, type SkillSource } from './types';

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface DiscoveryResult {
  skills: SkillDefinition[];
  warnings: string[];
}

export interface SkillOrigin {
  repoUrl?: string;
  commit?: string;
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Discover skills directly under `dir` (one level: `<dir>/<name>/SKILL.md`).
 * Invalid folders are skipped with a warning. Missing `dir` yields no skills.
 */
export async function discoverSkills(
  dir: string,
  source: SkillSource,
  origin: SkillOrigin = {},
): Promise<DiscoveryResult> {
  const skills: SkillDefinition[] = [];
  const warnings: string[] = [];

  if (!(await isDirectory(dir))) return { skills, warnings };

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const folder = path.join(dir, entry.name);
    if (!(entry.isDirectory() || entry.isSymbolicLink())) continue;
    if (!(await isDirectory(folder))) continue;

    const skillFile = path.join(folder, 'SKILL.md');
    let raw: string;
    try {
      raw = await fs.readFile(skillFile, 'utf-8');
    } catch {
      continue; // plain folder without SKILL.md — not a skill, not a warning
    }

    const fm = parseFrontmatter(raw);
    if (!fm) {
      warnings.push(`Skipped "${entry.name}": SKILL.md has no frontmatter block`);
      continue;
    }
    const name = fm.fields.name ?? '';
    let description = fm.fields.description ?? '';

    if (!name || name !== entry.name) {
      warnings.push(`Skipped "${entry.name}": frontmatter name "${name}" must equal the folder name`);
      continue;
    }
    if (!SKILL_NAME_PATTERN.test(name)) {
      warnings.push(`Skipped "${entry.name}": name must be kebab-case (a-z, 0-9, hyphens)`);
      continue;
    }
    if (!description) {
      warnings.push(`Skipped "${entry.name}": frontmatter description is required`);
      continue;
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      description = description.slice(0, MAX_DESCRIPTION_LENGTH);
      warnings.push(`Description of "${name}" was capped at ${MAX_DESCRIPTION_LENGTH} characters`);
    }

    skills.push({
      name,
      description,
      source,
      dir: await fs.realpath(folder),
      ...(origin.repoUrl ? { repoUrl: origin.repoUrl } : {}),
      ...(origin.commit ? { commit: origin.commit } : {}),
    });
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return { skills, warnings };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/main/ai/skills/__tests__/frontmatter.test.ts src/main/ai/skills/__tests__/discovery.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/ai/skills/frontmatter.ts apps/desktop/src/main/ai/skills/discovery.ts apps/desktop/src/main/ai/skills/__tests__/frontmatter.test.ts apps/desktop/src/main/ai/skills/__tests__/discovery.test.ts
git commit -m "feat(skills): add frontmatter parser and skill discovery

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Skill file helpers

**Files:**
- Create: `apps/desktop/src/main/ai/skills/skill-files.ts`
- Test: `apps/desktop/src/main/ai/skills/__tests__/skill-files.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter` (Task 2), `MAX_SKILL_FILES_LISTED`, `MAX_RESOURCE_BYTES`, `SKILLS_USAGE_FILE`, `SkillUsageRecord` (Task 1).
- Produces: `readSkillBody(dir): Promise<string>`, `listSkillFiles(dir): Promise<string[]>`, `readSkillResource(dir, resource): Promise<string>` (throws `Error` on escape/missing/too large), `appendSkillUsage(specDir, record): Promise<void>`, `readSkillUsage(specDir): Promise<SkillUsageRecord[]>`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/desktop/src/main/ai/skills/__tests__/skill-files.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  readSkillBody,
  listSkillFiles,
  readSkillResource,
  appendSkillUsage,
  readSkillUsage,
} from '../skill-files';

describe('skill-files', () => {
  let root: string;
  let skillDir: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'skill-files-'));
    skillDir = path.join(root, 'demo');
    mkdirSync(path.join(skillDir, 'references'), { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: demo\ndescription: D\n---\n# Demo\nBody text\n');
    writeFileSync(path.join(skillDir, 'references', 'guide.md'), 'guide');
    writeFileSync(path.join(skillDir, 'script.sh'), 'echo hi');
    writeFileSync(path.join(root, 'outside.txt'), 'secret');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('readSkillBody strips frontmatter', async () => {
    expect(await readSkillBody(skillDir)).toBe('# Demo\nBody text\n');
  });

  it('listSkillFiles lists bundled files as posix relative paths, excluding SKILL.md', async () => {
    expect(await listSkillFiles(skillDir)).toEqual(['references/guide.md', 'script.sh']);
  });

  it('listSkillFiles skips .git folders', async () => {
    mkdirSync(path.join(skillDir, '.git'));
    writeFileSync(path.join(skillDir, '.git', 'HEAD'), 'ref');
    expect(await listSkillFiles(skillDir)).toEqual(['references/guide.md', 'script.sh']);
  });

  it('readSkillResource reads a bundled file', async () => {
    expect(await readSkillResource(skillDir, 'references/guide.md')).toBe('guide');
  });

  it('readSkillResource rejects ../ escapes', async () => {
    await expect(readSkillResource(skillDir, '../outside.txt')).rejects.toThrow(/outside the skill folder/);
  });

  it('readSkillResource rejects absolute paths', async () => {
    await expect(readSkillResource(skillDir, path.join(root, 'outside.txt'))).rejects.toThrow(/outside the skill folder/);
  });

  it('readSkillResource rejects symlink escapes', async () => {
    symlinkSync(path.join(root, 'outside.txt'), path.join(skillDir, 'link.txt'));
    await expect(readSkillResource(skillDir, 'link.txt')).rejects.toThrow(/outside the skill folder/);
  });

  it('readSkillResource rejects missing files and oversized files', async () => {
    await expect(readSkillResource(skillDir, 'nope.md')).rejects.toThrow(/not found/);
    writeFileSync(path.join(skillDir, 'big.txt'), Buffer.alloc(512 * 1024 + 1, 97));
    await expect(readSkillResource(skillDir, 'big.txt')).rejects.toThrow(/too large/);
  });

  it('appendSkillUsage creates and appends to skills_used.json', async () => {
    const specDir = path.join(root, 'spec');
    mkdirSync(specDir);
    await appendSkillUsage(specDir, { name: 'demo', agentType: 'coder', pinned: true, at: 't1' });
    await appendSkillUsage(specDir, { name: 'demo', resource: 'script.sh', agentType: 'coder', pinned: false, at: 't2' });
    expect(await readSkillUsage(specDir)).toEqual([
      { name: 'demo', agentType: 'coder', pinned: true, at: 't1' },
      { name: 'demo', resource: 'script.sh', agentType: 'coder', pinned: false, at: 't2' },
    ]);
  });

  it('appendSkillUsage is a no-op when the spec dir does not exist', async () => {
    await expect(appendSkillUsage(path.join(root, 'missing'), { name: 'x', agentType: 'coder', pinned: false, at: 't' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/main/ai/skills/__tests__/skill-files.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `skill-files.ts`**

```ts
// apps/desktop/src/main/ai/skills/skill-files.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parseFrontmatter } from './frontmatter';
import {
  MAX_RESOURCE_BYTES,
  MAX_SKILL_FILES_LISTED,
  SKILLS_USAGE_FILE,
  type SkillUsageRecord,
} from './types';

/** SKILL.md content without the frontmatter block. */
export async function readSkillBody(skillDir: string): Promise<string> {
  const raw = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8');
  const fm = parseFrontmatter(raw);
  return fm ? fm.body : raw;
}

/** Bundled files (recursive) as posix-style paths relative to the skill folder. */
export async function listSkillFiles(skillDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string, rel: string): Promise<void> {
    if (out.length >= MAX_SKILL_FILES_LISTED) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= MAX_SKILL_FILES_LISTED) return;
      if (entry.name === '.git') continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(current, entry.name), relPath);
      } else if (entry.isFile() && relPath !== 'SKILL.md') {
        out.push(relPath);
      }
    }
  }
  await walk(skillDir, '');
  return out;
}

/**
 * Read one bundled file. The resolved real path must stay inside the skill
 * folder; symlinks pointing outside are rejected.
 */
export async function readSkillResource(skillDir: string, resource: string): Promise<string> {
  const realSkillDir = await fs.realpath(skillDir);
  const boundary = realSkillDir.endsWith(path.sep) ? realSkillDir : realSkillDir + path.sep;

  if (path.isAbsolute(resource)) {
    throw new Error(`Resource "${resource}" is outside the skill folder`);
  }
  const candidate = path.resolve(realSkillDir, resource);

  let real: string;
  try {
    real = await fs.realpath(candidate);
  } catch {
    if (!candidate.startsWith(boundary)) {
      throw new Error(`Resource "${resource}" is outside the skill folder`);
    }
    throw new Error(`Resource "${resource}" not found in skill`);
  }
  if (!real.startsWith(boundary)) {
    throw new Error(`Resource "${resource}" is outside the skill folder`);
  }

  const stat = await fs.stat(real);
  if (!stat.isFile()) throw new Error(`Resource "${resource}" not found in skill`);
  if (stat.size > MAX_RESOURCE_BYTES) {
    throw new Error(`Resource "${resource}" is too large (${stat.size} bytes, max ${MAX_RESOURCE_BYTES})`);
  }
  return fs.readFile(real, 'utf-8');
}

export async function readSkillUsage(specDir: string): Promise<SkillUsageRecord[]> {
  try {
    const raw = await fs.readFile(path.join(specDir, SKILLS_USAGE_FILE), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SkillUsageRecord[]) : [];
  } catch {
    return [];
  }
}

/** Append one record. Silently no-op when the spec dir does not exist. */
export async function appendSkillUsage(specDir: string, record: SkillUsageRecord): Promise<void> {
  try {
    if (!(await fs.stat(specDir)).isDirectory()) return;
  } catch {
    return;
  }
  const existing = await readSkillUsage(specDir);
  existing.push(record);
  await fs.writeFile(path.join(specDir, SKILLS_USAGE_FILE), `${JSON.stringify(existing, null, 2)}\n`, 'utf-8');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/main/ai/skills/__tests__/skill-files.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ai/skills/skill-files.ts apps/desktop/src/main/ai/skills/__tests__/skill-files.test.ts
git commit -m "feat(skills): add skill file helpers with contained resource reads

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Resolver (pure merge, pins, agent→phase mapping)

**Files:**
- Create: `apps/desktop/src/main/ai/skills/resolver.ts`
- Test: `apps/desktop/src/main/ai/skills/__tests__/resolver.test.ts`

**Interfaces:**
- Consumes: types from Task 1; `AGENT_CONFIGS` from `main/ai/config/agent-configs.ts` (an object keyed by agent type).
- Produces: `agentPhaseGroup(agentType: string): PhaseGroup | null`; `buildSnapshot(input: SnapshotInput): SkillsSnapshot`; `getSkillsForAgent(snapshot: SkillsSnapshot, agentType: string): AgentSkills`; `effectiveSkills(snapshot): SkillDefinition[]` (non-overridden entries); `findSkill(snapshot, name): SkillDefinition | undefined`.

```ts
export interface SnapshotInput {
  local: SkillDefinition[];
  central: Array<{ repo: CentralRepoConfig; skills: SkillDefinition[] }>;
  config: SkillsConfig;
  lock: SkillsLock;
  warnings: string[];
}
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/desktop/src/main/ai/skills/__tests__/resolver.test.ts
import { describe, it, expect } from 'vitest';
import { agentPhaseGroup, buildSnapshot, getSkillsForAgent, effectiveSkills, findSkill } from '../resolver';
import type { SkillDefinition, SkillsConfig, SkillsLock } from '../types';

const lock: SkillsLock = { repos: {} };
const cfg = (over: Partial<SkillsConfig> = {}): SkillsConfig => ({ centralRepos: [], pins: {}, disabled: [], ...over });
const skill = (name: string, source: 'local' | 'central', repoUrl?: string): SkillDefinition => ({
  name,
  description: `${name} desc`,
  source,
  dir: `/skills/${source}/${name}`,
  ...(repoUrl ? { repoUrl } : {}),
});
const repo = (url: string, include?: string[]) => ({ url, subpath: 'skills', ...(include ? { include } : {}) });

describe('agentPhaseGroup', () => {
  it('maps pipeline agents to phase groups', () => {
    expect(agentPhaseGroup('spec_writer')).toBe('spec');
    expect(agentPhaseGroup('spec_gatherer')).toBe('spec');
    expect(agentPhaseGroup('planner')).toBe('planning');
    expect(agentPhaseGroup('coder')).toBe('coding');
    expect(agentPhaseGroup('qa_reviewer')).toBe('qa');
    expect(agentPhaseGroup('qa_fixer')).toBe('qa');
    expect(agentPhaseGroup('insights')).toBeNull();
    expect(agentPhaseGroup('pr_reviewer')).toBeNull();
  });
});

describe('buildSnapshot', () => {
  it('orders local first then central, both by name', () => {
    const snap = buildSnapshot({
      local: [skill('b', 'local'), skill('a', 'local')],
      central: [{ repo: repo('u1'), skills: [skill('z', 'central', 'u1'), skill('c', 'central', 'u1')] }],
      config: cfg(),
      lock,
      warnings: [],
    });
    expect(snap.error).toBeUndefined();
    expect(snap.skills.map((s) => s.name)).toEqual(['a', 'b', 'c', 'z']);
  });

  it('local overrides central with the same name and keeps the shadowed entry flagged', () => {
    const snap = buildSnapshot({
      local: [skill('x', 'local')],
      central: [{ repo: repo('u1'), skills: [skill('x', 'central', 'u1')] }],
      config: cfg(),
      lock,
      warnings: [],
    });
    expect(snap.skills).toHaveLength(2);
    expect(snap.skills[0]).toMatchObject({ name: 'x', source: 'local' });
    expect(snap.skills[1]).toMatchObject({ name: 'x', source: 'central', overriddenBy: 'local' });
    expect(effectiveSkills(snap).map((s) => s.source)).toEqual(['local']);
    expect(findSkill(snap, 'x')?.source).toBe('local');
  });

  it('applies include filters per repo', () => {
    const snap = buildSnapshot({
      local: [],
      central: [{ repo: repo('u1', ['keep']), skills: [skill('keep', 'central', 'u1'), skill('drop', 'central', 'u1')] }],
      config: cfg(),
      lock,
      warnings: [],
    });
    expect(snap.skills.map((s) => s.name)).toEqual(['keep']);
  });

  it('warns when an include name does not exist in the repo', () => {
    const snap = buildSnapshot({
      local: [],
      central: [{ repo: repo('u1', ['ghost']), skills: [] }],
      config: cfg(),
      lock,
      warnings: [],
    });
    expect(snap.warnings[0]).toContain('ghost');
  });

  it('drops disabled skills from both sources', () => {
    const snap = buildSnapshot({
      local: [skill('a', 'local')],
      central: [{ repo: repo('u1'), skills: [skill('b', 'central', 'u1')] }],
      config: cfg({ disabled: ['a', 'b'] }),
      lock,
      warnings: [],
    });
    expect(snap.skills).toEqual([]);
  });

  it('errors when two central repos export the same name', () => {
    const snap = buildSnapshot({
      local: [],
      central: [
        { repo: repo('u1'), skills: [skill('dup', 'central', 'u1')] },
        { repo: repo('u2'), skills: [skill('dup', 'central', 'u2')] },
      ],
      config: cfg(),
      lock,
      warnings: [],
    });
    expect(snap.error).toContain('dup');
    expect(snap.error).toContain('u1');
    expect(snap.error).toContain('u2');
  });

  it('errors on unknown pin targets and unknown pinned skill names', () => {
    const base = { local: [skill('a', 'local')], central: [], lock, warnings: [] };
    expect(buildSnapshot({ ...base, config: cfg({ pins: { nobody: ['a'] } }) }).error).toContain('nobody');
    expect(buildSnapshot({ ...base, config: cfg({ pins: { coder: ['ghost'] } }) }).error).toContain('ghost');
    expect(buildSnapshot({ ...base, config: cfg({ pins: { coder: ['a'], qa: ['a'] } }) }).error).toBeUndefined();
  });

  it('errors when a pinned skill is disabled', () => {
    const snap = buildSnapshot({
      local: [skill('a', 'local')],
      central: [],
      config: cfg({ pins: { coder: ['a'] }, disabled: ['a'] }),
      lock,
      warnings: [],
    });
    expect(snap.error).toContain('a');
  });

  it('passes through warnings and lock', () => {
    const l: SkillsLock = { repos: { u1: { ref: 'main', commit: 'c', resolvedAt: 't' } } };
    const snap = buildSnapshot({ local: [], central: [], config: cfg(), lock: l, warnings: ['w'] });
    expect(snap.warnings).toEqual(['w']);
    expect(snap.lock).toBe(l);
  });
});

describe('getSkillsForAgent', () => {
  const snap = buildSnapshot({
    local: [skill('std', 'local'), skill('fe', 'local'), skill('tests', 'local'), skill('extra', 'local')],
    central: [],
    config: cfg({ pins: { coding: ['std'], coder: ['fe'], qa: ['tests'] } }),
    lock,
    warnings: [],
  });

  it('unions agent-type pins and phase-group pins, rest goes to catalog', () => {
    const r = getSkillsForAgent(snap, 'coder');
    expect(r.pinned.map((s) => s.name)).toEqual(['fe', 'std']);
    expect(r.catalog.map((s) => s.name)).toEqual(['extra', 'tests']);
  });

  it('agents outside the pipeline only get exact-type pins', () => {
    const r = getSkillsForAgent(snap, 'insights');
    expect(r.pinned).toEqual([]);
    expect(r.catalog).toHaveLength(4);
  });

  it('never returns overridden entries', () => {
    const s2 = buildSnapshot({
      local: [skill('x', 'local')],
      central: [{ repo: repo('u1'), skills: [skill('x', 'central', 'u1')] }],
      config: cfg({ pins: { coder: ['x'] } }),
      lock,
      warnings: [],
    });
    const r = getSkillsForAgent(s2, 'coder');
    expect(r.pinned).toHaveLength(1);
    expect(r.pinned[0].source).toBe('local');
    expect(r.catalog).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/main/ai/skills/__tests__/resolver.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `resolver.ts`**

```ts
// apps/desktop/src/main/ai/skills/resolver.ts
import { AGENT_CONFIGS } from '../config/agent-configs';
import {
  PHASE_GROUPS,
  type AgentSkills,
  type CentralRepoConfig,
  type PhaseGroup,
  type SkillDefinition,
  type SkillsConfig,
  type SkillsLock,
  type SkillsSnapshot,
} from './types';

export interface SnapshotInput {
  local: SkillDefinition[];
  central: Array<{ repo: CentralRepoConfig; skills: SkillDefinition[] }>;
  config: SkillsConfig;
  lock: SkillsLock;
  warnings: string[];
}

/** Pipeline agent → phase group. Non-pipeline agents return null. */
export function agentPhaseGroup(agentType: string): PhaseGroup | null {
  if (agentType.startsWith('spec_')) return 'spec';
  if (agentType === 'planner') return 'planning';
  if (agentType === 'coder') return 'coding';
  if (agentType === 'qa_reviewer' || agentType === 'qa_fixer') return 'qa';
  return null;
}

function isKnownPinTarget(target: string): boolean {
  return (PHASE_GROUPS as readonly string[]).includes(target) || target in AGENT_CONFIGS;
}

const byName = (a: SkillDefinition, b: SkillDefinition) => a.name.localeCompare(b.name);

export function buildSnapshot(input: SnapshotInput): SkillsSnapshot {
  const warnings = [...input.warnings];
  const disabled = new Set(input.config.disabled);
  const fail = (error: string): SkillsSnapshot => ({ skills: [], pins: {}, warnings, error, lock: input.lock });

  // Central: include filter, duplicate detection across repos
  const centralByName = new Map<string, SkillDefinition>();
  for (const { repo, skills } of input.central) {
    const include = repo.include ? new Set(repo.include) : null;
    if (include) {
      const present = new Set(skills.map((s) => s.name));
      for (const name of include) {
        if (!present.has(name)) warnings.push(`Repo ${repo.url}: included skill "${name}" was not found`);
      }
    }
    for (const s of skills) {
      if (include && !include.has(s.name)) continue;
      if (disabled.has(s.name)) continue;
      const existing = centralByName.get(s.name);
      if (existing) {
        return fail(
          `Skill "${s.name}" is provided by two central repos: ${existing.repoUrl ?? '?'} and ${repo.url}. Use "include" to pick one.`,
        );
      }
      centralByName.set(s.name, s);
    }
  }

  // Local wins on name; shadowed central stays, flagged
  const local = input.local.filter((s) => !disabled.has(s.name)).sort(byName);
  const localNames = new Set(local.map((s) => s.name));
  const central = [...centralByName.values()]
    .map((s) => (localNames.has(s.name) ? { ...s, overriddenBy: 'local' as const } : s))
    .sort(byName);
  const skills = [...local, ...central];
  const effectiveNames = new Set(skills.filter((s) => !s.overriddenBy).map((s) => s.name));

  // Pins validation
  for (const [target, names] of Object.entries(input.config.pins)) {
    if (!isKnownPinTarget(target)) {
      return fail(`Pin target "${target}" is not an agent type or phase group (${PHASE_GROUPS.join(', ')})`);
    }
    for (const name of names) {
      if (disabled.has(name)) return fail(`Pinned skill "${name}" (target "${target}") is listed in "disabled"`);
      if (!effectiveNames.has(name)) return fail(`Pinned skill "${name}" (target "${target}") does not exist`);
    }
  }

  return { skills, pins: input.config.pins, warnings, lock: input.lock };
}

export function effectiveSkills(snapshot: SkillsSnapshot): SkillDefinition[] {
  return snapshot.skills.filter((s) => !s.overriddenBy);
}

export function findSkill(snapshot: SkillsSnapshot, name: string): SkillDefinition | undefined {
  return effectiveSkills(snapshot).find((s) => s.name === name);
}

export function getSkillsForAgent(snapshot: SkillsSnapshot, agentType: string): AgentSkills {
  const group = agentPhaseGroup(agentType);
  const pinnedNames = new Set<string>([
    ...(snapshot.pins[agentType] ?? []),
    ...(group ? snapshot.pins[group] ?? [] : []),
  ]);
  const all = effectiveSkills(snapshot);
  return {
    pinned: all.filter((s) => pinnedNames.has(s.name)),
    catalog: all.filter((s) => !pinnedNames.has(s.name)),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/main/ai/skills/__tests__/resolver.test.ts`
Expected: PASS (13 tests). If importing `AGENT_CONFIGS` pulls in modules that need Electron, the existing `src/__mocks__/electron.ts` alias in `vitest.config.ts` covers it; if the test still fails on an unrelated import, add `vi.mock('../../config/agent-configs', () => ({ AGENT_CONFIGS: { coder: {}, qa_reviewer: {}, insights: {}, planner: {}, spec_writer: {} } }))` at the top of the test file.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ai/skills/resolver.ts apps/desktop/src/main/ai/skills/__tests__/resolver.test.ts
git commit -m "feat(skills): add resolver with local-over-central merge and pins

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Central repo sync with injectable git runner

**Files:**
- Create: `apps/desktop/src/main/ai/skills/sync.ts`
- Test: `apps/desktop/src/main/ai/skills/__tests__/sync.test.ts`

**Interfaces:**
- Consumes: `CentralRepoConfig`, `GIT_TIMEOUT_MS` (Task 1); `findExecutable` from `main/platform`.
- Produces:

```ts
export type GitRunner = (args: string[], options?: { cwd?: string }) => Promise<string>;
export interface SyncDeps { git: GitRunner; baseDir: string }
export function createGitRunner(): GitRunner;
export function repoKey(url: string): string;                                   // sha256 prefix
export function mirrorDir(deps: SyncDeps, url: string): string;                  // <baseDir>/skill-repos/<key>/mirror
export function checkoutDir(deps: SyncDeps, url: string, commit: string): string; // <baseDir>/skill-repos/<key>/<commit>
export async function ensureCheckout(deps: SyncDeps, url: string, commit: string): Promise<string>;
export async function refreshRepo(deps: SyncDeps, repo: CentralRepoConfig): Promise<{ ref: string; commit: string }>;
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/desktop/src/main/ai/skills/__tests__/sync.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { ensureCheckout, refreshRepo, repoKey, mirrorDir, checkoutDir, type GitRunner, type SyncDeps } from '../sync';

interface Call { args: string[]; cwd?: string }

function fakeGit(behavior: (args: string[]) => string | Error = () => ''): { git: GitRunner; calls: Call[] } {
  const calls: Call[] = [];
  const git: GitRunner = async (args, options) => {
    calls.push({ args, cwd: options?.cwd });
    const r = behavior(args);
    if (r instanceof Error) throw r;
    return r;
  };
  return { git, calls };
}

describe('sync', () => {
  let baseDir: string;
  const url = 'https://github.com/acme/skills.git';

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'skills-sync-'));
  });
  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('derives stable, filesystem-safe directories from the url', () => {
    const deps: SyncDeps = { git: fakeGit().git, baseDir };
    expect(repoKey(url)).toMatch(/^[a-f0-9]{16}$/);
    expect(repoKey(url)).toBe(repoKey(url));
    expect(mirrorDir(deps, url)).toBe(path.join(baseDir, 'skill-repos', repoKey(url), 'mirror'));
    expect(checkoutDir(deps, url, 'abc')).toBe(path.join(baseDir, 'skill-repos', repoKey(url), 'abc'));
  });

  it('ensureCheckout clones the mirror and adds a detached worktree when nothing exists', async () => {
    const { git, calls } = fakeGit();
    const deps: SyncDeps = { git, baseDir };
    const dir = await ensureCheckout(deps, url, 'abc123');
    expect(dir).toBe(checkoutDir(deps, url, 'abc123'));
    expect(calls.map((c) => c.args)).toEqual([
      ['clone', '--mirror', '--filter=blob:none', url, mirrorDir(deps, url)],
      ['--git-dir', mirrorDir(deps, url), 'cat-file', '-e', 'abc123^{commit}'],
      ['--git-dir', mirrorDir(deps, url), 'worktree', 'add', '--detach', dir, 'abc123'],
    ]);
  });

  it('ensureCheckout fetches when the commit is missing from an existing mirror', async () => {
    const deps: SyncDeps = { git: fakeGit().git, baseDir };
    mkdirSync(mirrorDir(deps, url), { recursive: true });
    const { git, calls } = fakeGit((args) => (args.includes('cat-file') ? new Error('missing') : ''));
    const dir = await ensureCheckout({ git, baseDir }, url, 'abc123');
    expect(calls.map((c) => c.args)).toEqual([
      ['--git-dir', mirrorDir(deps, url), 'cat-file', '-e', 'abc123^{commit}'],
      ['--git-dir', mirrorDir(deps, url), 'fetch', '--prune', 'origin'],
      ['--git-dir', mirrorDir(deps, url), 'worktree', 'add', '--detach', dir, 'abc123'],
    ]);
  });

  it('ensureCheckout is a no-op when the checkout already exists', async () => {
    const deps: SyncDeps = { git: fakeGit().git, baseDir };
    mkdirSync(checkoutDir(deps, url, 'abc123'), { recursive: true });
    const { git, calls } = fakeGit();
    await ensureCheckout({ git, baseDir }, url, 'abc123');
    expect(calls).toEqual([]);
  });

  it('refreshRepo resolves an explicit ref and returns its commit', async () => {
    const { git, calls } = fakeGit((args) => (args.includes('rev-parse') ? 'deadbeef\n' : ''));
    const deps: SyncDeps = { git, baseDir };
    const r = await refreshRepo(deps, { url, ref: 'release', subpath: 'skills' });
    expect(r).toEqual({ ref: 'release', commit: 'deadbeef' });
    expect(calls[0].args).toEqual(['clone', '--mirror', '--filter=blob:none', url, mirrorDir(deps, url)]);
    expect(calls[1].args).toEqual(['--git-dir', mirrorDir(deps, url), 'rev-parse', '--verify', 'release^{commit}']);
    expect(existsSync(path.join(baseDir, 'skill-repos'))).toBe(true);
  });

  it('refreshRepo fetches an existing mirror and uses the default branch when ref is absent', async () => {
    const deps0: SyncDeps = { git: fakeGit().git, baseDir };
    mkdirSync(mirrorDir(deps0, url), { recursive: true });
    const { git, calls } = fakeGit((args) => {
      if (args.includes('symbolic-ref')) return 'refs/heads/main\n';
      if (args.includes('rev-parse')) return 'c0ffee\n';
      return '';
    });
    const r = await refreshRepo({ git, baseDir }, { url, subpath: 'skills' });
    expect(r).toEqual({ ref: 'main', commit: 'c0ffee' });
    expect(calls.map((c) => c.args)).toEqual([
      ['--git-dir', mirrorDir(deps0, url), 'fetch', '--prune', 'origin'],
      ['--git-dir', mirrorDir(deps0, url), 'symbolic-ref', 'HEAD'],
      ['--git-dir', mirrorDir(deps0, url), 'rev-parse', '--verify', 'main^{commit}'],
      ['--git-dir', mirrorDir(deps0, url), 'cat-file', '-e', 'c0ffee^{commit}'],
      ['--git-dir', mirrorDir(deps0, url), 'worktree', 'add', '--detach', checkoutDir(deps0, url, 'c0ffee'), 'c0ffee'],
    ]);
  });

  it('refreshRepo surfaces git failures with the url in the message', async () => {
    const { git } = fakeGit(() => new Error('could not resolve host'));
    await expect(refreshRepo({ git, baseDir }, { url, subpath: 'skills' })).rejects.toThrow(url);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/main/ai/skills/__tests__/sync.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `sync.ts`**

```ts
// apps/desktop/src/main/ai/skills/sync.ts
/**
 * Central skill repos: one bare mirror per URL, one immutable checkout per commit.
 * Main process only. Git is run with argument arrays, never a shell string.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { findExecutable } from '../../platform';
import { GIT_TIMEOUT_MS, type CentralRepoConfig } from './types';

const execFileAsync = promisify(execFile);

export type GitRunner = (args: string[], options?: { cwd?: string }) => Promise<string>;

export interface SyncDeps {
  git: GitRunner;
  /** Usually app.getPath('userData') */
  baseDir: string;
}

export function createGitRunner(): GitRunner {
  const gitBin = findExecutable('git') ?? 'git';
  return async (args, options) => {
    const { stdout } = await execFileAsync(gitBin, args, {
      cwd: options?.cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
  };
}

export function repoKey(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

function repoRoot(deps: SyncDeps, url: string): string {
  return path.join(deps.baseDir, 'skill-repos', repoKey(url));
}

export function mirrorDir(deps: SyncDeps, url: string): string {
  return path.join(repoRoot(deps, url), 'mirror');
}

export function checkoutDir(deps: SyncDeps, url: string, commit: string): string {
  return path.join(repoRoot(deps, url), commit);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

function wrap(url: string, action: string, err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(`Skill repo ${url}: ${action} failed: ${message}`);
}

async function ensureMirror(deps: SyncDeps, url: string): Promise<{ mirror: string; created: boolean }> {
  const mirror = mirrorDir(deps, url);
  if (await exists(mirror)) return { mirror, created: false };
  await fs.mkdir(path.dirname(mirror), { recursive: true });
  try {
    // Blobless partial clone: refs + trees only. Blobs are fetched lazily when a
    // commit is checked out, which keeps large public skill collections fast.
    await deps.git(['clone', '--mirror', '--filter=blob:none', url, mirror]);
  } catch (err) {
    throw wrap(url, 'clone', err);
  }
  return { mirror, created: true };
}

async function hasCommit(deps: SyncDeps, mirror: string, commit: string): Promise<boolean> {
  try {
    await deps.git(['--git-dir', mirror, 'cat-file', '-e', `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** Make sure `<root>/<commit>` exists. Returns the checkout path. Never modifies an existing checkout. */
export async function ensureCheckout(deps: SyncDeps, url: string, commit: string): Promise<string> {
  const target = checkoutDir(deps, url, commit);
  if (await exists(target)) return target;

  const { mirror } = await ensureMirror(deps, url);
  if (!(await hasCommit(deps, mirror, commit))) {
    try {
      await deps.git(['--git-dir', mirror, 'fetch', '--prune', 'origin']);
    } catch (err) {
      throw wrap(url, 'fetch', err);
    }
  }
  try {
    await deps.git(['--git-dir', mirror, 'worktree', 'add', '--detach', target, commit]);
  } catch (err) {
    throw wrap(url, `checkout of ${commit}`, err);
  }
  return target;
}

/** Fetch, resolve `repo.ref` (or the default branch) to a commit, and ensure its checkout. */
export async function refreshRepo(deps: SyncDeps, repo: CentralRepoConfig): Promise<{ ref: string; commit: string }> {
  const { mirror, created } = await ensureMirror(deps, repo.url);
  if (!created) {
    try {
      await deps.git(['--git-dir', mirror, 'fetch', '--prune', 'origin']);
    } catch (err) {
      throw wrap(repo.url, 'fetch', err);
    }
  }

  let ref = repo.ref;
  if (!ref) {
    try {
      const head = (await deps.git(['--git-dir', mirror, 'symbolic-ref', 'HEAD'])).trim();
      ref = head.replace(/^refs\/heads\//, '');
    } catch (err) {
      throw wrap(repo.url, 'default branch lookup', err);
    }
  }

  let commit: string;
  try {
    commit = (await deps.git(['--git-dir', mirror, 'rev-parse', '--verify', `${ref}^{commit}`])).trim();
  } catch (err) {
    throw wrap(repo.url, `resolving ref "${ref}"`, err);
  }

  await ensureCheckout(deps, repo.url, commit);
  return { ref, commit };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/main/ai/skills/__tests__/sync.test.ts`
Expected: PASS (7 tests). Note the "clones the mirror" test: `ensureMirror` clones because the fake git does not create the folder, then `hasCommit` succeeds (fake returns ''), so no fetch call. This matches the expected call list.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ai/skills/sync.ts apps/desktop/src/main/ai/skills/__tests__/sync.test.ts
git commit -m "feat(skills): add central repo sync with immutable checkouts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `resolveSkills` / `refreshSkills` orchestration

**Files:**
- Create: `apps/desktop/src/main/ai/skills/resolve.ts`
- Create: `apps/desktop/src/main/ai/skills/index.ts`
- Test: `apps/desktop/src/main/ai/skills/__tests__/resolve.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 4, 5.
- Produces:

```ts
export interface ResolveOptions {
  userDataDir: string;
  git?: GitRunner;                       // default createGitRunner()
  allowedSchemes?: readonly string[];    // default DEFAULT_ALLOWED_SCHEMES; tests pass ['file:']
}
export async function resolveSkills(projectDir: string, options: ResolveOptions): Promise<SkillsSnapshot>;
export async function refreshSkills(projectDir: string, options: ResolveOptions): Promise<SkillsSnapshot>;
```

- [ ] **Step 1: Write the failing tests (uses real git with a local bare repo)**

```ts
// apps/desktop/src/main/ai/skills/__tests__/resolve.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { resolveSkills, refreshSkills } from '../resolve';
import { createGitRunner } from '../sync';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
}

function writeSkill(root: string, folder: string, description: string) {
  mkdirSync(path.join(root, folder), { recursive: true });
  writeFileSync(path.join(root, folder, 'SKILL.md'), `---\nname: ${folder}\ndescription: ${description}\n---\n# ${folder}\n`);
}

describe('resolveSkills / refreshSkills', () => {
  let tmp: string;
  let projectDir: string;
  let userDataDir: string;
  let remoteUrl: string;
  const opts = () => ({ userDataDir, git: createGitRunner(), allowedSchemes: ['file:'] as const });

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'skills-resolve-'));
    projectDir = path.join(tmp, 'project');
    userDataDir = path.join(tmp, 'userData');
    mkdirSync(path.join(projectDir, '.claude', 'skills'), { recursive: true });
    mkdirSync(userDataDir);

    // central repo: work tree → bare remote
    const work = path.join(tmp, 'central-work');
    mkdirSync(work);
    git(['init', '-q', '-b', 'main'], work);
    writeSkill(path.join(work, 'skills'), 'central-one', 'From central');
    writeSkill(path.join(work, 'skills'), 'shared', 'Central version');
    git(['add', '.'], work);
    git(['commit', '-q', '-m', 'init'], work);
    const bare = path.join(tmp, 'central.git');
    git(['clone', '-q', '--bare', work, bare], tmp);
    remoteUrl = `file://${bare}`;

    writeSkill(path.join(projectDir, '.claude', 'skills'), 'local-one', 'Local');
    writeSkill(path.join(projectDir, '.claude', 'skills'), 'shared', 'Local version');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('with no config resolves local skills only', async () => {
    const snap = await resolveSkills(projectDir, opts());
    expect(snap.error).toBeUndefined();
    expect(snap.skills.map((s) => s.name)).toEqual(['local-one', 'shared']);
  });

  it('returns a blocking error for malformed config', async () => {
    writeFileSync(path.join(projectDir, '.claude', 'skills.json'), '{');
    const snap = await resolveSkills(projectDir, opts());
    expect(snap.error).toContain('skills.json');
    expect(snap.skills).toEqual([]);
  });

  it('errors when a central repo has no lock entry and tells the user to refresh', async () => {
    writeFileSync(path.join(projectDir, '.claude', 'skills.json'), JSON.stringify({ centralRepos: [{ url: remoteUrl }] }));
    const snap = await resolveSkills(projectDir, opts());
    expect(snap.error).toContain('Refresh');
    expect(snap.error).toContain('skills.lock.json');
  });

  it('refreshSkills writes the lock and resolves central skills with local override', async () => {
    writeFileSync(
      path.join(projectDir, '.claude', 'skills.json'),
      JSON.stringify({ centralRepos: [{ url: remoteUrl }], pins: { coder: ['central-one'] } }),
    );
    const snap = await refreshSkills(projectDir, opts());
    expect(snap.error).toBeUndefined();

    const lock = JSON.parse(readFileSync(path.join(projectDir, '.claude', 'skills.lock.json'), 'utf-8'));
    expect(lock.repos[remoteUrl].ref).toBe('main');
    expect(lock.repos[remoteUrl].commit).toMatch(/^[0-9a-f]{40}$/);

    expect(snap.skills.map((s) => [s.name, s.source, s.overriddenBy ?? null])).toEqual([
      ['local-one', 'local', null],
      ['shared', 'local', null],
      ['central-one', 'central', null],
      ['shared', 'central', 'local'],
    ]);
    const central = snap.skills.find((s) => s.name === 'central-one');
    expect(central?.commit).toBe(lock.repos[remoteUrl].commit);
    expect(central?.dir).toContain(path.join('skill-repos'));
    expect(snap.pins).toEqual({ coder: ['central-one'] });

    // A second plain resolve uses the lock and the existing checkout
    const again = await resolveSkills(projectDir, opts());
    expect(again.error).toBeUndefined();
    expect(again.skills).toHaveLength(4);
  });

  it('rejects a subpath that escapes the checkout', async () => {
    writeFileSync(path.join(projectDir, '.claude', 'skills.json'), JSON.stringify({ centralRepos: [{ url: remoteUrl, subpath: '../..' }] }));
    const snap = await refreshSkills(projectDir, opts());
    expect(snap.error).toContain('subpath');
  });

  it('supports subpath "." for repos with skills at the root', async () => {
    const work = path.join(tmp, 'root-work');
    mkdirSync(work);
    git(['init', '-q', '-b', 'main'], work);
    writeSkill(work, 'root-skill', 'At root');
    git(['add', '.'], work);
    git(['commit', '-q', '-m', 'init'], work);
    const bare = path.join(tmp, 'root.git');
    git(['clone', '-q', '--bare', work, bare], tmp);
    writeFileSync(path.join(projectDir, '.claude', 'skills.json'), JSON.stringify({ centralRepos: [{ url: `file://${bare}`, subpath: '.' }] }));
    const snap = await refreshSkills(projectDir, opts());
    expect(snap.error).toBeUndefined();
    expect(snap.skills.map((s) => s.name)).toContain('root-skill');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/main/ai/skills/__tests__/resolve.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `resolve.ts`**

```ts
// apps/desktop/src/main/ai/skills/resolve.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { DEFAULT_ALLOWED_SCHEMES, loadSkillsConfig, loadSkillsLock, writeSkillsLock } from './config';
import { discoverSkills } from './discovery';
import { buildSnapshot } from './resolver';
import { createGitRunner, ensureCheckout, refreshRepo, type GitRunner, type SyncDeps } from './sync';
import {
  SKILLS_DIR,
  SKILLS_LOCK_FILE,
  emptySnapshot,
  type CentralRepoConfig,
  type SkillDefinition,
  type SkillsLock,
  type SkillsSnapshot,
} from './types';

export interface ResolveOptions {
  userDataDir: string;
  git?: GitRunner;
  allowedSchemes?: readonly string[];
}

function errorSnapshot(error: string, lock: SkillsLock = { repos: {} }): SkillsSnapshot {
  return { ...emptySnapshot(), error, lock };
}

/** Resolve `<checkout>/<subpath>` and make sure it stays inside the checkout. */
async function skillsRootInCheckout(checkout: string, repo: CentralRepoConfig): Promise<string> {
  const realCheckout = await fs.realpath(checkout);
  const candidate = path.resolve(realCheckout, repo.subpath);
  const boundary = realCheckout.endsWith(path.sep) ? realCheckout : realCheckout + path.sep;
  if (candidate !== realCheckout && !candidate.startsWith(boundary)) {
    throw new Error(`Skill repo ${repo.url}: subpath "${repo.subpath}" escapes the repository`);
  }
  return candidate;
}

async function resolveWithLock(
  projectDir: string,
  lock: SkillsLock,
  options: ResolveOptions,
): Promise<SkillsSnapshot> {
  const configResult = await loadSkillsConfig(projectDir, options.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES);
  if (!configResult.ok) return errorSnapshot(configResult.error, lock);
  const { config } = configResult;

  const deps: SyncDeps = { git: options.git ?? createGitRunner(), baseDir: options.userDataDir };
  const warnings: string[] = [];

  const local = await discoverSkills(path.join(projectDir, SKILLS_DIR), 'local');
  warnings.push(...local.warnings);

  const central: Array<{ repo: CentralRepoConfig; skills: SkillDefinition[] }> = [];
  for (const repo of config.centralRepos) {
    const entry = lock.repos[repo.url];
    if (!entry) {
      return errorSnapshot(
        `No lock entry for skill repo ${repo.url}. Open Project Settings > Skills and click Refresh, then commit ${SKILLS_LOCK_FILE}.`,
        lock,
      );
    }
    let checkout: string;
    try {
      checkout = await ensureCheckout(deps, repo.url, entry.commit);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorSnapshot(`${message}. If you are offline, reconnect and retry.`, lock);
    }
    let root: string;
    try {
      root = await skillsRootInCheckout(checkout, repo);
    } catch (err) {
      return errorSnapshot(err instanceof Error ? err.message : String(err), lock);
    }
    const found = await discoverSkills(root, 'central', { repoUrl: repo.url, commit: entry.commit });
    warnings.push(...found.warnings.map((w) => `${repo.url}: ${w}`));
    central.push({ repo, skills: found.skills });
  }

  return buildSnapshot({ local: local.skills, central, config, lock, warnings });
}

/** Resolve using the committed lockfile. Never writes files. */
export async function resolveSkills(projectDir: string, options: ResolveOptions): Promise<SkillsSnapshot> {
  const lock = await loadSkillsLock(projectDir);
  return resolveWithLock(projectDir, lock, options);
}

/** Fetch every central repo, rewrite the lockfile, then resolve. */
export async function refreshSkills(projectDir: string, options: ResolveOptions): Promise<SkillsSnapshot> {
  const configResult = await loadSkillsConfig(projectDir, options.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES);
  if (!configResult.ok) return errorSnapshot(configResult.error);
  const { config } = configResult;

  const deps: SyncDeps = { git: options.git ?? createGitRunner(), baseDir: options.userDataDir };
  const previous = await loadSkillsLock(projectDir);
  const lock: SkillsLock = { repos: {} };

  for (const repo of config.centralRepos) {
    try {
      const { ref, commit } = await refreshRepo(deps, repo);
      lock.repos[repo.url] = { ref, commit, resolvedAt: new Date().toISOString() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorSnapshot(`${message}. The previous lockfile was left unchanged.`, previous);
    }
  }

  if (config.centralRepos.length > 0 || Object.keys(previous.repos).length > 0) {
    await writeSkillsLock(projectDir, lock);
  }
  return resolveWithLock(projectDir, lock, options);
}
```

- [ ] **Step 4: Write `index.ts`**

```ts
// apps/desktop/src/main/ai/skills/index.ts
export * from './types';
export { loadSkillsConfig, loadSkillsLock, writeSkillsLock, isAllowedRepoUrl, DEFAULT_ALLOWED_SCHEMES } from './config';
export { discoverSkills } from './discovery';
export { parseFrontmatter } from './frontmatter';
export { readSkillBody, listSkillFiles, readSkillResource, appendSkillUsage, readSkillUsage } from './skill-files';
export { agentPhaseGroup, buildSnapshot, getSkillsForAgent, effectiveSkills, findSkill } from './resolver';
export { createGitRunner, ensureCheckout, refreshRepo } from './sync';
export type { GitRunner, SyncDeps } from './sync';
export { resolveSkills, refreshSkills } from './resolve';
export type { ResolveOptions } from './resolve';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/main/ai/skills/`
Expected: PASS for all skills tests. The resolve tests need a real `git` on PATH (present on CI and dev machines). If `git worktree add` refuses inside a `file://` mirror on some git versions, the error message will show in the test output; the fix is to run `git config --global protocol.file.allow always` in the test's `beforeEach` via `git(['config', '--global', 'protocol.file.allow', 'always'], tmp)` guarded by `process.env.CI`.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/ai/skills/resolve.ts apps/desktop/src/main/ai/skills/index.ts apps/desktop/src/main/ai/skills/__tests__/resolve.test.ts
git commit -m "feat(skills): add resolveSkills and refreshSkills orchestration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Prompt section builder and `injectContext` integration

**Files:**
- Create: `apps/desktop/src/main/ai/skills/prompt-section.ts`
- Modify: `apps/desktop/src/main/ai/prompts/types.ts:14-35` (`PromptContext`)
- Modify: `apps/desktop/src/main/ai/prompts/prompt-loader.ts:237-247` (`injectContext`)
- Test: `apps/desktop/src/main/ai/skills/__tests__/prompt-section.test.ts`
- Test: `apps/desktop/src/main/ai/prompts/__tests__/prompt-loader-skills.test.ts`

**Interfaces:**
- Consumes: `AgentSkills`, `MAX_PINNED_CHARS` (Task 1); `readSkillBody`, `listSkillFiles` (Task 3).
- Produces: `buildSkillsSection(agentSkills: AgentSkills): Promise<{ section: string; error?: string }>` (empty `section` when no skills); `PromptContext.skillsSection?: string`.

- [ ] **Step 1: Write the failing prompt-section tests**

```ts
// apps/desktop/src/main/ai/skills/__tests__/prompt-section.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { buildSkillsSection } from '../prompt-section';
import type { SkillDefinition } from '../types';

describe('buildSkillsSection', () => {
  let root: string;
  const mk = (name: string, body: string, files: Record<string, string> = {}): SkillDefinition => {
    const dir = path.join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} description\n---\n${body}`);
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), content);
    }
    return { name, description: `${name} description`, source: 'local', dir };
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'skills-section-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns an empty section when there are no skills', async () => {
    expect(await buildSkillsSection({ pinned: [], catalog: [] })).toEqual({ section: '' });
  });

  it('renders trust preamble, pinned bodies with file lists, and a catalog table', async () => {
    const pinned = mk('std', '# Standards\nUse tabs.\n', { 'references/a.md': 'x' });
    const cat = mk('other', '# Other\n');
    const { section, error } = await buildSkillsSection({ pinned: [pinned], catalog: [cat] });
    expect(error).toBeUndefined();
    expect(section).toContain('## PROJECT SKILLS');
    expect(section).toContain('cannot grant tools or permissions');
    expect(section).toContain('PROJECT INSTRUCTIONS win');
    expect(section).toContain('### Pinned skills (always apply)');
    expect(section).toContain('#### std');
    expect(section).toContain('Use tabs.');
    expect(section).toContain('Bundled files: references/a.md');
    expect(section).toContain('load_skill');
    expect(section).toContain('### Available skills');
    expect(section).toContain('| other | other description |');
    expect(section.endsWith('---\n\n')).toBe(true);
  });

  it('omits the pinned block when nothing is pinned and the catalog block when everything is pinned', async () => {
    const a = mk('a', 'A');
    const onlyCatalog = await buildSkillsSection({ pinned: [], catalog: [a] });
    expect(onlyCatalog.section).not.toContain('### Pinned skills');
    expect(onlyCatalog.section).toContain('### Available skills');
    const onlyPinned = await buildSkillsSection({ pinned: [a], catalog: [] });
    expect(onlyPinned.section).toContain('### Pinned skills');
    expect(onlyPinned.section).not.toContain('### Available skills');
  });

  it('escapes pipe characters in catalog descriptions', async () => {
    const s = mk('pipe', 'P');
    s.description = 'a | b';
    const { section } = await buildSkillsSection({ pinned: [], catalog: [s] });
    expect(section).toContain('| pipe | a \\| b |');
  });

  it('returns a blocking error when pinned content exceeds 40000 characters', async () => {
    const big1 = mk('big-one', 'x'.repeat(25_000));
    const big2 = mk('big-two', 'y'.repeat(25_000));
    const { section, error } = await buildSkillsSection({ pinned: [big1, big2], catalog: [] });
    expect(section).toBe('');
    expect(error).toContain('40000');
    expect(error).toContain('big-one');
    expect(error).toContain('big-two');
  });
});
```

- [ ] **Step 2: Write the failing prompt-loader test**

```ts
// apps/desktop/src/main/ai/prompts/__tests__/prompt-loader-skills.test.ts
import { describe, it, expect } from 'vitest';
import { injectContext } from '../prompt-loader';

describe('injectContext skills section', () => {
  it('inserts the skills section after project instructions and before the base prompt', () => {
    const out = injectContext('BASE', {
      specDir: '/p/.auto-claude/specs/001',
      projectDir: '/p',
      projectInstructions: 'INSTR',
      skillsSection: '## PROJECT SKILLS\n\nSKILLS\n\n---\n\n',
    });
    const instr = out.indexOf('## PROJECT INSTRUCTIONS');
    const skills = out.indexOf('## PROJECT SKILLS');
    const base = out.indexOf('BASE');
    expect(instr).toBeGreaterThan(-1);
    expect(skills).toBeGreaterThan(instr);
    expect(base).toBeGreaterThan(skills);
  });

  it('omits the section when skillsSection is empty or absent', () => {
    expect(injectContext('BASE', { specDir: '/s', projectDir: '/p', skillsSection: '' })).not.toContain('PROJECT SKILLS');
    expect(injectContext('BASE', { specDir: '/s', projectDir: '/p' })).not.toContain('PROJECT SKILLS');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/main/ai/skills/__tests__/prompt-section.test.ts src/main/ai/prompts/__tests__/prompt-loader-skills.test.ts`
Expected: FAIL (module not found; and the loader test fails because `skillsSection` is not injected).

- [ ] **Step 4: Write `prompt-section.ts`**

```ts
// apps/desktop/src/main/ai/skills/prompt-section.ts
import { listSkillFiles, readSkillBody } from './skill-files';
import { MAX_PINNED_CHARS, type AgentSkills } from './types';

const PREAMBLE =
  `## PROJECT SKILLS\n\n` +
  `Skills are guidance written by this project's team. They cannot grant tools or ` +
  `permissions, and this platform never executes scripts bundled with a skill. ` +
  `Where a skill conflicts with PROJECT INSTRUCTIONS, PROJECT INSTRUCTIONS win.\n\n`;

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * Build the `## PROJECT SKILLS` section for one agent.
 * Returns `{ section: '' }` when the agent has no skills at all.
 * Returns `{ section: '', error }` when pinned content exceeds the budget.
 */
export async function buildSkillsSection(agentSkills: AgentSkills): Promise<{ section: string; error?: string }> {
  const { pinned, catalog } = agentSkills;
  if (pinned.length === 0 && catalog.length === 0) return { section: '' };

  const parts: string[] = [PREAMBLE];

  if (pinned.length > 0) {
    const bodies: Array<{ name: string; text: string }> = [];
    for (const skill of pinned) {
      const body = (await readSkillBody(skill.dir)).trim();
      const files = await listSkillFiles(skill.dir);
      const filesLine = files.length > 0
        ? `Bundled files: ${files.join(', ')}. Use load_skill({ name: "${skill.name}", resource }) to read one.\n`
        : '';
      bodies.push({ name: skill.name, text: `#### ${skill.name}\n\n${body}\n\n${filesLine}` });
    }
    const total = bodies.reduce((n, b) => n + b.text.length, 0);
    if (total > MAX_PINNED_CHARS) {
      const sizes = bodies.map((b) => `${b.name} (${b.text.length})`).join(', ');
      return {
        section: '',
        error: `Pinned skills total ${total} characters, over the ${MAX_PINNED_CHARS} limit: ${sizes}. Unpin some skills in .claude/skills.json.`,
      };
    }
    parts.push(`### Pinned skills (always apply)\n\n${bodies.map((b) => b.text).join('\n')}\n`);
  }

  if (catalog.length > 0) {
    const rows = catalog.map((s) => `| ${s.name} | ${escapeCell(s.description)} |`).join('\n');
    parts.push(
      `### Available skills\n\n| name | description |\n|------|-------------|\n${rows}\n\n` +
      `Before doing work that a description covers, call load_skill({ name }) and follow the skill.\n\n`,
    );
  }

  parts.push(`---\n\n`);
  return { section: parts.join('') };
}
```

- [ ] **Step 5: Add `skillsSection` to `PromptContext` and inject it**

In `apps/desktop/src/main/ai/prompts/types.ts`, inside `PromptContext` after `projectInstructions?: string | null;` add:

```ts
  /** Pre-built `## PROJECT SKILLS` section (see ai/skills/prompt-section.ts). Empty/undefined = omit. */
  skillsSection?: string;
```

In `apps/desktop/src/main/ai/prompts/prompt-loader.ts`, directly after the `// 4. Project instructions` block (after its closing `}` and before `// 5. Base prompt`), add:

```ts
  // 4b. Project skills (pinned bodies + catalog), built by ai/skills/prompt-section.ts
  if (context.skillsSection) {
    sections.push(context.skillsSection);
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/main/ai/skills/__tests__/prompt-section.test.ts src/main/ai/prompts/__tests__/prompt-loader-skills.test.ts src/main/ai/prompts/`
Expected: PASS, including the existing prompt-loader tests.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/ai/skills/prompt-section.ts apps/desktop/src/main/ai/prompts/types.ts apps/desktop/src/main/ai/prompts/prompt-loader.ts apps/desktop/src/main/ai/skills/__tests__/prompt-section.test.ts apps/desktop/src/main/ai/prompts/__tests__/prompt-loader-skills.test.ts
git commit -m "feat(skills): build PROJECT SKILLS prompt section and inject it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `load_skill` tool, registry, and agent configs

**Files:**
- Create: `apps/desktop/src/main/ai/tools/builtin/load-skill.ts`
- Modify: `apps/desktop/src/main/ai/tools/types.ts:21-34` (`ToolContext`)
- Modify: `apps/desktop/src/main/ai/tools/build-registry.ts`
- Modify: `apps/desktop/src/main/ai/config/agent-configs.ts:24-36` and every entry listing `'Read'` literally
- Test: `apps/desktop/src/main/ai/tools/builtin/__tests__/load-skill.test.ts`
- Test: `apps/desktop/src/main/ai/config/__tests__/agent-configs-skills.test.ts`

**Interfaces:**
- Consumes: `SkillsSnapshot`, `findSkill`, `effectiveSkills`, `readSkillBody`, `listSkillFiles`, `readSkillResource`, `appendSkillUsage`.
- Produces: `ToolContext.skillsSnapshot?: SkillsSnapshot`; `ToolContext.agentType?: string`; `loadSkillTool` registered under the name `load_skill`.

- [ ] **Step 1: Extend `ToolContext`**

In `apps/desktop/src/main/ai/tools/types.ts`, add the import at the top (type-only, no runtime cycle):

```ts
import type { SkillsSnapshot } from '../skills/types';
```

and inside `ToolContext` after `allowedWritePaths?: string[];`:

```ts
  /** Resolved project skills for this session (read-only). Absent = no skills. */
  skillsSnapshot?: SkillsSnapshot;
  /** Agent type using this context; recorded in skill usage logs. */
  agentType?: string;
```

- [ ] **Step 2: Write the failing tool tests**

```ts
// apps/desktop/src/main/ai/tools/builtin/__tests__/load-skill.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { loadSkillTool } from '../load-skill';
import type { ToolContext } from '../../types';
import type { SkillsSnapshot } from '../../../skills/types';

describe('load_skill tool', () => {
  let root: string;
  let specDir: string;
  let snapshot: SkillsSnapshot;

  const ctx = (over: Partial<ToolContext> = {}): ToolContext =>
    ({
      cwd: root,
      projectDir: root,
      specDir,
      securityProfile: {} as ToolContext['securityProfile'],
      skillsSnapshot: snapshot,
      agentType: 'coder',
      ...over,
    }) as ToolContext;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'load-skill-'));
    specDir = path.join(root, 'spec');
    mkdirSync(specDir);
    const dir = path.join(root, 'skills', 'demo');
    mkdirSync(path.join(dir, 'ref'), { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: demo\ndescription: D\n---\n# Demo body\n');
    writeFileSync(path.join(dir, 'ref', 'notes.md'), 'notes content');
    snapshot = {
      skills: [
        { name: 'demo', description: 'D', source: 'local', dir },
        { name: 'shadow', description: 'S', source: 'central', dir: path.join(root, 'nowhere'), overriddenBy: 'local' },
      ],
      pins: {},
      warnings: [],
      lock: { repos: {} },
    };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('is named load_skill and read-only', () => {
    expect(loadSkillTool.metadata.name).toBe('load_skill');
    expect(loadSkillTool.metadata.permission).toBe('read_only');
  });

  it('returns body and file list without resource', async () => {
    const out = (await loadSkillTool.config.execute({ name: 'demo' }, ctx())) as string;
    expect(out).toContain('# Demo body');
    expect(out).toContain('Bundled files:');
    expect(out).toContain('ref/notes.md');
  });

  it('returns a resource with resource set', async () => {
    const out = (await loadSkillTool.config.execute({ name: 'demo', resource: 'ref/notes.md' }, ctx())) as string;
    expect(out).toBe('notes content');
  });

  it('errors on unknown or overridden names and lists valid names', async () => {
    const out = (await loadSkillTool.config.execute({ name: 'shadow' }, ctx())) as string;
    expect(out).toMatch(/^Error: Unknown skill "shadow"/);
    expect(out).toContain('demo');
  });

  it('errors when the resource escapes the skill folder', async () => {
    const out = (await loadSkillTool.config.execute({ name: 'demo', resource: '../../spec/x' }, ctx())) as string;
    expect(out).toMatch(/^Error: .*outside the skill folder/);
  });

  it('errors when no skills snapshot is present', async () => {
    const out = (await loadSkillTool.config.execute({ name: 'demo' }, ctx({ skillsSnapshot: undefined }))) as string;
    expect(out).toMatch(/^Error: No project skills/);
  });

  it('appends usage records to the spec dir', async () => {
    await loadSkillTool.config.execute({ name: 'demo' }, ctx());
    await loadSkillTool.config.execute({ name: 'demo', resource: 'ref/notes.md' }, ctx());
    const records = JSON.parse(readFileSync(path.join(specDir, 'skills_used.json'), 'utf-8'));
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ name: 'demo', agentType: 'coder', pinned: false });
    expect(records[1]).toMatchObject({ name: 'demo', resource: 'ref/notes.md' });
  });
});
```

- [ ] **Step 3: Write the failing agent-configs test**

```ts
// apps/desktop/src/main/ai/config/__tests__/agent-configs-skills.test.ts
import { describe, it, expect } from 'vitest';
import { AGENT_CONFIGS } from '../agent-configs';

describe('agent configs — load_skill availability', () => {
  it('every agent with Read also has load_skill, and no agent without Read has it', () => {
    for (const [agentType, config] of Object.entries(AGENT_CONFIGS)) {
      const tools = config.tools as readonly string[];
      const hasRead = tools.includes('Read');
      const hasLoadSkill = tools.includes('load_skill');
      expect({ agentType, hasLoadSkill }).toEqual({ agentType, hasLoadSkill: hasRead });
    }
  });

  it('tool-less agents stay tool-less', () => {
    expect(AGENT_CONFIGS.merge_resolver.tools).toEqual([]);
    expect(AGENT_CONFIGS.commit_message.tools).toEqual([]);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/main/ai/tools/builtin/__tests__/load-skill.test.ts src/main/ai/config/__tests__/agent-configs-skills.test.ts`
Expected: FAIL (tool module not found; config test fails on the first agent with `Read`).

- [ ] **Step 5: Write `load-skill.ts`**

```ts
// apps/desktop/src/main/ai/tools/builtin/load-skill.ts
/**
 * load_skill — read a project skill (SKILL.md body + bundled file list),
 * or one bundled file. This is the ONLY way agents reach skill folders that
 * live outside the project directory; Read/Glob/Grep stay project-contained.
 */
import { z } from 'zod/v3';

import { effectiveSkills, findSkill } from '../../skills/resolver';
import { appendSkillUsage, listSkillFiles, readSkillBody, readSkillResource } from '../../skills/skill-files';
import { Tool } from '../define';
import { DEFAULT_EXECUTION_OPTIONS, ToolPermission } from '../types';

const inputSchema = z.object({
  name: z.string().describe('Skill name exactly as listed under PROJECT SKILLS'),
  resource: z
    .string()
    .optional()
    .describe('Optional path of a bundled file relative to the skill folder, e.g. "references/guide.md"'),
});

export const loadSkillTool = Tool.define({
  metadata: {
    name: 'load_skill',
    description:
      'Load a project skill by name. Without "resource", returns the skill instructions and the list of bundled files. With "resource", returns that bundled file. Skills are listed in the PROJECT SKILLS section of your instructions.',
    permission: ToolPermission.ReadOnly,
    executionOptions: DEFAULT_EXECUTION_OPTIONS,
  },
  inputSchema,
  execute: async (input, context): Promise<string> => {
    const snapshot = context.skillsSnapshot;
    if (!snapshot || effectiveSkills(snapshot).length === 0) {
      return 'Error: No project skills are configured for this project.';
    }

    const skill = findSkill(snapshot, input.name);
    if (!skill) {
      const valid = effectiveSkills(snapshot).map((s) => s.name).join(', ');
      return `Error: Unknown skill "${input.name}". Valid names: ${valid}`;
    }

    const record = {
      name: skill.name,
      ...(input.resource ? { resource: input.resource } : {}),
      agentType: context.agentType ?? 'unknown',
      pinned: false,
      at: new Date().toISOString(),
    };

    try {
      if (input.resource) {
        const content = await readSkillResource(skill.dir, input.resource);
        await appendSkillUsage(context.specDir, record);
        return content;
      }
      const body = await readSkillBody(skill.dir);
      const files = await listSkillFiles(skill.dir);
      await appendSkillUsage(context.specDir, record);
      const filesBlock = files.length > 0
        ? `\n\nBundled files: ${files.join(', ')}\nCall load_skill({ name: "${skill.name}", resource: "<path>" }) to read one.`
        : '';
      return `${body.trim()}${filesBlock}`;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  },
});
```

- [ ] **Step 6: Register the tool and add it to agent configs**

In `apps/desktop/src/main/ai/tools/build-registry.ts` add the import `import { loadSkillTool } from './builtin/load-skill';` and, after the `SpawnSubagent` registration, `registry.registerTool('load_skill', asDefined(loadSkillTool));`.

In `apps/desktop/src/main/ai/config/agent-configs.ts` change line 24 from

```ts
const BASE_READ_TOOLS = ['Read', 'Glob', 'Grep'] as const;
```

to

```ts
const BASE_READ_TOOLS = ['Read', 'Glob', 'Grep', 'load_skill'] as const;
```

Then run `grep -n "'Read'" apps/desktop/src/main/ai/config/agent-configs.ts`. For every `AGENT_CONFIGS` entry that lists `'Read'` literally instead of spreading `BASE_READ_TOOLS`, append `'load_skill'` to that entry's `tools` array. The test in Step 3 enforces the invariant; iterate until it passes.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/main/ai/tools/builtin/__tests__/load-skill.test.ts src/main/ai/config/ src/main/ai/tools/`
Expected: PASS, including existing tool and config tests. If an existing config test snapshots exact tool lists for an agent, update that snapshot to include `load_skill`.

- [ ] **Step 8: Typecheck and commit**

Run: `cd apps/desktop && npm run typecheck`
Expected: no errors.

```bash
git add apps/desktop/src/main/ai/tools/builtin/load-skill.ts apps/desktop/src/main/ai/tools/types.ts apps/desktop/src/main/ai/tools/build-registry.ts apps/desktop/src/main/ai/config/agent-configs.ts apps/desktop/src/main/ai/tools/builtin/__tests__/load-skill.test.ts apps/desktop/src/main/ai/config/__tests__/agent-configs-skills.test.ts
git commit -m "feat(skills): add load_skill tool for agents with Read access

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Worker boundary, prompt assembly by agent type, and agent-manager wiring

**Files:**
- Modify: `apps/desktop/src/main/ai/agent/types.ts:81-88` (`SerializableSessionConfig.toolContext`)
- Modify: `apps/desktop/src/main/ai/agent/worker.ts:151-159` (`buildToolContext`), `:210-234` (`assemblePrompt`), call sites at `:571`, `:754`, `:859-861`, `:1027`
- Modify: `apps/desktop/src/main/ai/orchestration/subagent-executor.ts:88-101` (config type) and `:117-125` (`spawn`)
- Modify: `apps/desktop/src/main/agent/agent-manager.ts` — `startSpecCreation` (toolContext at `:403`), `startTaskExecution` (`:527`), `startQAProcess` (`:630`)
- Test: `apps/desktop/src/main/ai/agent/__tests__/worker-skills.test.ts`

**Interfaces:**
- Consumes: `SkillsSnapshot`, `getSkillsForAgent`, `buildSkillsSection`, `appendSkillUsage`, `resolveSkills`, `AGENT_CONFIGS`.
- Produces: `assemblePrompt(promptName, session, agentType?)`; `SubagentExecutorConfig.loadPrompt: (promptName: string, agentType?: string) => Promise<string>`; `SerializableSessionConfig.toolContext.skillsSnapshot?`.

- [ ] **Step 1: Extend the serialized session config**

In `apps/desktop/src/main/ai/agent/types.ts` add `import type { SkillsSnapshot } from '../skills/types';` and inside `toolContext` after `securityProfile?: SerializedSecurityProfile;`:

```ts
    /** Resolved project skills. Plain JSON, safe to post to the worker. */
    skillsSnapshot?: SkillsSnapshot;
```

- [ ] **Step 2: Write the failing worker helper test**

`assemblePrompt` is module-private in `worker.ts`, so extract the skills part into a small exported helper that the worker calls. Create `apps/desktop/src/main/ai/agent/skills-prompt.ts` and test it:

```ts
// apps/desktop/src/main/ai/agent/__tests__/worker-skills.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { buildSkillsSectionForAgent, resolveEffectiveAgentType } from '../skills-prompt';
import type { SkillsSnapshot } from '../../skills/types';

describe('resolveEffectiveAgentType', () => {
  it('prefers the explicit agent type, then a prompt name that is an agent type, then the session type', () => {
    expect(resolveEffectiveAgentType('coder', 'build_orchestrator', 'qa_fixer')).toBe('qa_fixer');
    expect(resolveEffectiveAgentType('coder', 'build_orchestrator')).toBe('coder');
    expect(resolveEffectiveAgentType('spec_orchestrator_agentic', 'spec_orchestrator')).toBe('spec_orchestrator');
  });
});

describe('buildSkillsSectionForAgent', () => {
  let root: string;
  let specDir: string;
  let snapshot: SkillsSnapshot;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'worker-skills-'));
    specDir = path.join(root, 'spec');
    mkdirSync(specDir);
    const dir = path.join(root, 'std');
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: std\ndescription: S\n---\nSTD BODY\n');
    snapshot = { skills: [{ name: 'std', description: 'S', source: 'local', dir }], pins: { coder: ['std'] }, warnings: [], lock: { repos: {} } };
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty string when there is no snapshot', async () => {
    expect(await buildSkillsSectionForAgent(undefined, 'coder', specDir)).toBe('');
  });

  it('builds the section and records pinned usage', async () => {
    const section = await buildSkillsSectionForAgent(snapshot, 'coder', specDir);
    expect(section).toContain('STD BODY');
    const records = JSON.parse(readFileSync(path.join(specDir, 'skills_used.json'), 'utf-8'));
    expect(records).toEqual([expect.objectContaining({ name: 'std', agentType: 'coder', pinned: true })]);
  });

  it('throws on a budget error', async () => {
    writeFileSync(path.join(root, 'std', 'SKILL.md'), `---\nname: std\ndescription: S\n---\n${'x'.repeat(41_000)}`);
    await expect(buildSkillsSectionForAgent(snapshot, 'coder', specDir)).rejects.toThrow(/40000/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/main/ai/agent/__tests__/worker-skills.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Write `skills-prompt.ts`**

```ts
// apps/desktop/src/main/ai/agent/skills-prompt.ts
import { AGENT_CONFIGS } from '../config/agent-configs';
import { buildSkillsSection } from '../skills/prompt-section';
import { getSkillsForAgent } from '../skills/resolver';
import { appendSkillUsage } from '../skills/skill-files';
import type { SkillsSnapshot } from '../skills/types';

/** The agent identity used for pins: explicit > prompt name if it is an agent type > session agent type. */
export function resolveEffectiveAgentType(promptName: string, sessionAgentType: string, explicit?: string): string {
  if (explicit) return explicit;
  if (promptName in AGENT_CONFIGS) return promptName;
  return sessionAgentType;
}

/**
 * Build the PROJECT SKILLS section for one agent and record pinned skills in
 * `<specDir>/skills_used.json`. Throws when the pinned budget is exceeded.
 */
export async function buildSkillsSectionForAgent(
  snapshot: SkillsSnapshot | undefined,
  agentType: string,
  specDir: string,
): Promise<string> {
  if (!snapshot) return '';
  const agentSkills = getSkillsForAgent(snapshot, agentType);
  const { section, error } = await buildSkillsSection(agentSkills);
  if (error) throw new Error(error);
  const at = new Date().toISOString();
  for (const skill of agentSkills.pinned) {
    await appendSkillUsage(specDir, { name: skill.name, agentType, pinned: true, at });
  }
  return section;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/main/ai/agent/__tests__/worker-skills.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Wire the worker**

In `apps/desktop/src/main/ai/agent/worker.ts`:

Add imports near the other `../` imports:

```ts
import { buildSkillsSectionForAgent, resolveEffectiveAgentType } from './skills-prompt';
```

Replace `buildToolContext` (lines 151-159) with:

```ts
function buildToolContext(session: SerializableSessionConfig, securityProfile: SecurityProfile): ToolContext {
  return {
    cwd: session.toolContext.cwd,
    projectDir: session.toolContext.projectDir,
    specDir: session.toolContext.specDir,
    securityProfile,
    abortSignal: abortController.signal,
    skillsSnapshot: session.toolContext.skillsSnapshot,
    agentType: session.agentType,
  };
}
```

Replace `assemblePrompt` (lines 210-234) with:

```ts
async function assemblePrompt(
  promptName: string,
  session: SerializableSessionConfig,
  agentType?: string,
): Promise<string> {
  const basePrompt = loadPrompt(promptName)
    ?? buildFallbackPrompt(promptName as AgentType, session.specDir, session.projectDir);

  if (cachedProjectInstructions === undefined) {
    const result = await loadProjectInstructions(session.projectDir);
    cachedProjectInstructions = result?.content ?? null;
    cachedProjectInstructionsSource = result?.source ?? null;
    if (result) {
      postLog(`Project instructions loaded from ${result.source} (${(result.content.length / 1024).toFixed(1)}KB)`);
    } else {
      postLog('No project instructions found (checked AGENTS.md, CLAUDE.md)');
    }
  }

  const effectiveAgentType = resolveEffectiveAgentType(promptName, session.agentType, agentType);
  const skillsSection = await buildSkillsSectionForAgent(
    session.toolContext.skillsSnapshot,
    effectiveAgentType,
    session.specDir,
  );
  if (skillsSection) {
    postLog(`Project skills injected for ${effectiveAgentType} (${(skillsSection.length / 1024).toFixed(1)}KB)`);
  }

  return injectContext(basePrompt, {
    specDir: session.specDir,
    projectDir: session.projectDir,
    projectInstructions: cachedProjectInstructions,
    skillsSection,
  });
}
```

Update the call sites:

- Line ~571 (build orchestrator `generatePrompt: async (agentType, _phase, context)`): change `assemblePrompt(promptName, session)` to `assemblePrompt(promptName, session, agentType)`.
- Line ~754 (QA `generatePrompt: async (agentType, _context)`): change to `assemblePrompt(promptName, session, agentType)`.
- Line ~859 (spec `generatePrompt: async (_agentType, phase, context)`): rename the first parameter to `agentType` and change to `assemblePrompt(promptName, session, agentType)`.
- Line ~1027 (`loadPrompt: async (promptName: string) => assemblePrompt(promptName, session)`): change to `loadPrompt: async (promptName: string, agentType?: string) => assemblePrompt(promptName, session, agentType)`.

Also, in the worker's tool-binding section for subagents, the `baseToolContext` passed to the subagent executor is the same `toolContext` built above, so it already carries `skillsSnapshot`.

- [ ] **Step 7: Wire the subagent executor**

In `apps/desktop/src/main/ai/orchestration/subagent-executor.ts`:

Change the config field (line ~95) from `loadPrompt: (promptName: string) => Promise<string>;` to:

```ts
  loadPrompt: (promptName: string, agentType?: string) => Promise<string>;
```

In `spawn()` change `const systemPrompt = await this.config.loadPrompt(promptName);` to:

```ts
      const systemPrompt = await this.config.loadPrompt(promptName, agentType);
```

and when building `subagentToolContext` set the agent type for usage logging:

```ts
        const subagentToolContext: ToolContext = {
          ...this.config.baseToolContext,
          abortSignal: this.config.abortSignal,
          agentType,
        };
```

- [ ] **Step 8: Wire the agent manager**

In `apps/desktop/src/main/agent/agent-manager.ts`:

Add imports:

```ts
import { app } from 'electron';
import { resolveSkills } from '../ai/skills/resolve';
import type { SkillsSnapshot } from '../ai/skills/types';
```

(If `app` is already imported from `'electron'` in that file, extend the existing import instead.)

Add a private method next to `serializeSecurityProfile`:

```ts
  /**
   * Resolve project skills for a launch. Returns null (after emitting an error)
   * when the snapshot carries a blocking error, so callers can bail out.
   */
  private async resolveSkillsForLaunch(taskId: string, projectDir: string): Promise<SkillsSnapshot | null> {
    const snapshot = await resolveSkills(projectDir, { userDataDir: app.getPath('userData') });
    if (snapshot.error) {
      this.emit('error', taskId, `Project skills error: ${snapshot.error}`);
      return null;
    }
    return snapshot;
  }
```

In `startTaskExecution` (toolContext at line ~527) and `startQAProcess` (toolContext at line ~630), immediately before the `const sessionConfig: SerializableSessionConfig = {` line, add:

```ts
      const skillsSnapshot = await this.resolveSkillsForLaunch(taskId, effectiveProjectDir);
      if (!skillsSnapshot) return;
```

In `startSpecCreation` (toolContext at line ~403, which uses `projectPath` as the project dir), add before its `const sessionConfig` line:

```ts
      const skillsSnapshot = await this.resolveSkillsForLaunch(taskId, projectPath);
      if (!skillsSnapshot) return;
```

Then inside each of the three `toolContext: { ... }` literals add `skillsSnapshot,` after the `securityProfile: ...` line.

- [ ] **Step 9: Typecheck, run the suite, commit**

Run: `cd apps/desktop && npm run typecheck && npx vitest run src/main/ai/ src/main/agent/`
Expected: no type errors; all tests pass.

```bash
git add apps/desktop/src/main/ai/agent/types.ts apps/desktop/src/main/ai/agent/worker.ts apps/desktop/src/main/ai/agent/skills-prompt.ts apps/desktop/src/main/ai/agent/__tests__/worker-skills.test.ts apps/desktop/src/main/ai/orchestration/subagent-executor.ts apps/desktop/src/main/agent/agent-manager.ts
git commit -m "feat(skills): pass skills snapshot to workers and inject per agent type

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: IPC handlers and preload API

**Files:**
- Modify: `apps/desktop/src/shared/constants/ipc.ts` (add channels)
- Create: `apps/desktop/src/main/ipc-handlers/skills-handlers.ts`
- Modify: `apps/desktop/src/main/ipc-handlers/index.ts` (register)
- Modify: `apps/desktop/src/preload/api/project-api.ts` (interface + impl)
- Test: `apps/desktop/src/main/ipc-handlers/__tests__/skills-handlers.test.ts`

**Interfaces:**
- Consumes: `resolveSkills`, `refreshSkills` (Task 6); `projectStore.getProject(projectId)` returning `Project | undefined` with `.path`.
- Produces: channels `IPC_CHANNELS.SKILLS_LIST = 'skills:list'`, `IPC_CHANNELS.SKILLS_REFRESH = 'skills:refresh'`; preload `listSkills(projectId): Promise<IPCResult<SkillsSnapshot>>`, `refreshSkills(projectId): Promise<IPCResult<SkillsSnapshot>>`.

- [ ] **Step 1: Add channel constants**

In `apps/desktop/src/shared/constants/ipc.ts`, inside `IPC_CHANNELS` add a block:

```ts
  // Project skills
  SKILLS_LIST: 'skills:list',
  SKILLS_REFRESH: 'skills:refresh',
```

- [ ] **Step 2: Write the failing handler test**

```ts
// apps/desktop/src/main/ipc-handlers/__tests__/skills-handlers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { handlers, resolveSkills, refreshSkills, getProject } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  resolveSkills: vi.fn(),
  refreshSkills: vi.fn(),
  getProject: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn)) },
  app: { getPath: vi.fn(() => '/tmp/userData') },
}));
vi.mock('../../ai/skills/resolve', () => ({ resolveSkills, refreshSkills }));
vi.mock('../../project-store', () => ({ projectStore: { getProject } }));

import { registerSkillsHandlers } from '../skills-handlers';

describe('skills handlers', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerSkillsHandlers();
  });

  it('skills:list resolves using the project path and userData dir', async () => {
    getProject.mockReturnValue({ id: 'p1', path: '/repo' });
    resolveSkills.mockResolvedValue({ skills: [], pins: {}, warnings: [], lock: { repos: {} } });
    const result = await handlers.get('skills:list')!({}, 'p1');
    expect(resolveSkills).toHaveBeenCalledWith('/repo', { userDataDir: '/tmp/userData' });
    expect(result).toEqual({ success: true, data: { skills: [], pins: {}, warnings: [], lock: { repos: {} } } });
  });

  it('skills:refresh calls refreshSkills', async () => {
    getProject.mockReturnValue({ id: 'p1', path: '/repo' });
    refreshSkills.mockResolvedValue({ skills: [], pins: {}, warnings: ['w'], lock: { repos: {} } });
    const result = (await handlers.get('skills:refresh')!({}, 'p1')) as { success: boolean; data: { warnings: string[] } };
    expect(refreshSkills).toHaveBeenCalledWith('/repo', { userDataDir: '/tmp/userData' });
    expect(result.data.warnings).toEqual(['w']);
  });

  it('returns an error result for an unknown project', async () => {
    getProject.mockReturnValue(undefined);
    const result = await handlers.get('skills:list')!({}, 'nope');
    expect(result).toEqual({ success: false, error: 'Project not found: nope' });
  });

  it('turns thrown errors into error results', async () => {
    getProject.mockReturnValue({ id: 'p1', path: '/repo' });
    refreshSkills.mockRejectedValue(new Error('boom'));
    const result = await handlers.get('skills:refresh')!({}, 'p1');
    expect(result).toEqual({ success: false, error: 'boom' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/main/ipc-handlers/__tests__/skills-handlers.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Write `skills-handlers.ts`**

```ts
// apps/desktop/src/main/ipc-handlers/skills-handlers.ts
import { app, ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import { refreshSkills, resolveSkills } from '../ai/skills/resolve';
import type { SkillsSnapshot } from '../ai/skills/types';
import { projectStore } from '../project-store';

type SnapshotFn = (projectDir: string, options: { userDataDir: string }) => Promise<SkillsSnapshot>;

async function withProject(projectId: string, fn: SnapshotFn): Promise<IPCResult<SkillsSnapshot>> {
  const project = projectStore.getProject(projectId);
  if (!project) return { success: false, error: `Project not found: ${projectId}` };
  try {
    const data = await fn(project.path, { userDataDir: app.getPath('userData') });
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function registerSkillsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SKILLS_LIST, (_event, projectId: string) => withProject(projectId, resolveSkills));
  ipcMain.handle(IPC_CHANNELS.SKILLS_REFRESH, (_event, projectId: string) => withProject(projectId, refreshSkills));
}
```

Register it in `apps/desktop/src/main/ipc-handlers/index.ts`: add `import { registerSkillsHandlers } from './skills-handlers';` next to the codex-auth import (line ~36) and call `registerSkillsHandlers();` right after `registerCodexAuthHandlers();` (line ~128).

- [ ] **Step 5: Expose in preload**

In `apps/desktop/src/preload/api/project-api.ts` add `import type { SkillsSnapshot } from '../../main/ai/skills/types';` (type-only; if the preload tsconfig forbids importing from `main/`, move `SkillsSnapshot` and its dependent types into `src/shared/types/skills.ts`, re-export them from `src/main/ai/skills/types.ts`, and import from `../../shared/types/skills` instead).

In the `ProjectAPI` interface after `checkProjectVersion`:

```ts
  // Project skills (read-only)
  listSkills: (projectId: string) => Promise<IPCResult<SkillsSnapshot>>;
  refreshSkills: (projectId: string) => Promise<IPCResult<SkillsSnapshot>>;
```

In `createProjectAPI()` after the `checkProjectVersion` implementation:

```ts
  listSkills: (projectId: string): Promise<IPCResult<SkillsSnapshot>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SKILLS_LIST, projectId),
  refreshSkills: (projectId: string): Promise<IPCResult<SkillsSnapshot>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SKILLS_REFRESH, projectId),
```

- [ ] **Step 6: Run tests, typecheck, commit**

Run: `cd apps/desktop && npx vitest run src/main/ipc-handlers/__tests__/skills-handlers.test.ts && npm run typecheck`
Expected: PASS; no type errors.

```bash
git add apps/desktop/src/shared/constants/ipc.ts apps/desktop/src/main/ipc-handlers/skills-handlers.ts apps/desktop/src/main/ipc-handlers/index.ts apps/desktop/src/preload/api/project-api.ts apps/desktop/src/main/ipc-handlers/__tests__/skills-handlers.test.ts
git commit -m "feat(skills): add skills list/refresh IPC and preload API

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

If `SkillsSnapshot` had to move to `src/shared/types/skills.ts`, include that file and the updated `src/main/ai/skills/types.ts` in the commit.

---

### Task 11: Skills store, settings tab, and i18n

**Files:**
- Create: `apps/desktop/src/renderer/stores/skills-store.ts`
- Create: `apps/desktop/src/renderer/components/project-settings/SkillsSettings.tsx`
- Modify: `apps/desktop/src/renderer/components/settings/ProjectSettingsContent.tsx:13`
- Modify: `apps/desktop/src/renderer/components/settings/AppSettings.tsx:8-23` (icon import) and `:72-97` (nav config)
- Modify: `apps/desktop/src/renderer/components/settings/sections/SectionRouter.tsx` (new case)
- Modify: `apps/desktop/src/shared/i18n/locales/en/settings.json`, `apps/desktop/src/shared/i18n/locales/fr/settings.json`
- Test: `apps/desktop/src/renderer/stores/__tests__/skills-store.test.ts`
- Test: `apps/desktop/src/renderer/components/project-settings/__tests__/SkillsSettings.test.tsx`

**Interfaces:**
- Consumes: `window.electronAPI.listSkills/refreshSkills` (Task 10), `SkillsSnapshot`.
- Produces: `useSkillsStore` with `{ snapshot, isLoading, error, load(projectId), refresh(projectId) }`; `SkillsSettings({ projectId })`.

- [ ] **Step 1: Write the failing store test**

```ts
// apps/desktop/src/renderer/stores/__tests__/skills-store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSkillsStore } from '../skills-store';

const listSkills = vi.fn();
const refreshSkills = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { window: unknown }).window = { electronAPI: { listSkills, refreshSkills } };
  useSkillsStore.setState({ snapshot: null, isLoading: false, error: null });
});

describe('skills-store', () => {
  it('load stores the snapshot', async () => {
    listSkills.mockResolvedValue({ success: true, data: { skills: [], pins: {}, warnings: [], lock: { repos: {} } } });
    await useSkillsStore.getState().load('p1');
    expect(listSkills).toHaveBeenCalledWith('p1');
    expect(useSkillsStore.getState().snapshot?.skills).toEqual([]);
    expect(useSkillsStore.getState().isLoading).toBe(false);
    expect(useSkillsStore.getState().error).toBeNull();
  });

  it('load stores an IPC error', async () => {
    listSkills.mockResolvedValue({ success: false, error: 'nope' });
    await useSkillsStore.getState().load('p1');
    expect(useSkillsStore.getState().error).toBe('nope');
  });

  it('refresh calls refreshSkills and stores the snapshot', async () => {
    refreshSkills.mockResolvedValue({ success: true, data: { skills: [], pins: {}, warnings: ['w'], lock: { repos: {} } } });
    await useSkillsStore.getState().refresh('p1');
    expect(refreshSkills).toHaveBeenCalledWith('p1');
    expect(useSkillsStore.getState().snapshot?.warnings).toEqual(['w']);
  });
});
```

- [ ] **Step 2: Write `skills-store.ts`**

```ts
// apps/desktop/src/renderer/stores/skills-store.ts
import { create } from 'zustand';
import type { SkillsSnapshot } from '../../main/ai/skills/types';

interface SkillsState {
  snapshot: SkillsSnapshot | null;
  isLoading: boolean;
  error: string | null;
  load: (projectId: string) => Promise<void>;
  refresh: (projectId: string) => Promise<void>;
}

async function run(
  set: (partial: Partial<SkillsState>) => void,
  call: () => Promise<{ success: boolean; data?: SkillsSnapshot; error?: string }>,
): Promise<void> {
  set({ isLoading: true, error: null });
  try {
    const result = await call();
    if (result.success && result.data) {
      set({ snapshot: result.data, isLoading: false });
    } else {
      set({ error: result.error ?? 'Unknown error', isLoading: false });
    }
  } catch (err) {
    set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
  }
}

export const useSkillsStore = create<SkillsState>((set) => ({
  snapshot: null,
  isLoading: false,
  error: null,
  load: (projectId) => run(set, () => window.electronAPI.listSkills(projectId)),
  refresh: (projectId) => run(set, () => window.electronAPI.refreshSkills(projectId)),
}));
```

(Use the same import path for `SkillsSnapshot` that Task 10 settled on: `../../main/ai/skills/types` or `../../shared/types/skills`.)

- [ ] **Step 3: Run the store test**

Run: `cd apps/desktop && npx vitest run src/renderer/stores/__tests__/skills-store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Add i18n keys**

In `apps/desktop/src/shared/i18n/locales/en/settings.json`, inside `projectSections` after `"gitlab": {...}` add:

```json
    "skills": {
      "title": "Skills",
      "description": "Agent skills shared with the team",
      "integrationTitle": "Project Skills",
      "integrationDescription": "Skills discovered from .claude/skills and central repositories. Read-only; edit .claude/skills.json in the repository to change pins or sources.",
      "refresh": "Refresh",
      "refreshing": "Refreshing…",
      "empty": "No skills found. Add a folder with SKILL.md under .claude/skills/ or declare central repositories in .claude/skills.json.",
      "blockingError": "Skills configuration error. Pipelines will not start until this is fixed.",
      "warnings": "Warnings",
      "columns": {
        "name": "Name",
        "description": "Description",
        "source": "Source",
        "pinned": "Pinned to",
        "status": "Status"
      },
      "source": {
        "local": "Local",
        "central": "Central"
      },
      "status": {
        "active": "Active",
        "overridden": "Overridden by local"
      },
      "repos": {
        "title": "Central repositories",
        "commit": "Commit {{commit}} on {{ref}}",
        "unlocked": "Not resolved yet. Click Refresh and commit .claude/skills.lock.json."
      },
      "howTo": "Add a skill: create .claude/skills/<name>/SKILL.md with name and description in its frontmatter. Pin skills or add central repositories in .claude/skills.json."
    }
```

In `apps/desktop/src/shared/i18n/locales/fr/settings.json`, same position:

```json
    "skills": {
      "title": "Compétences",
      "description": "Compétences d'agent partagées avec l'équipe",
      "integrationTitle": "Compétences du projet",
      "integrationDescription": "Compétences découvertes dans .claude/skills et les dépôts centraux. Lecture seule ; modifiez .claude/skills.json dans le dépôt pour changer les épingles ou les sources.",
      "refresh": "Actualiser",
      "refreshing": "Actualisation…",
      "empty": "Aucune compétence trouvée. Ajoutez un dossier avec SKILL.md sous .claude/skills/ ou déclarez des dépôts centraux dans .claude/skills.json.",
      "blockingError": "Erreur de configuration des compétences. Les pipelines ne démarreront pas tant que ce n'est pas corrigé.",
      "warnings": "Avertissements",
      "columns": {
        "name": "Nom",
        "description": "Description",
        "source": "Source",
        "pinned": "Épinglée à",
        "status": "Statut"
      },
      "source": {
        "local": "Locale",
        "central": "Centrale"
      },
      "status": {
        "active": "Active",
        "overridden": "Remplacée par la locale"
      },
      "repos": {
        "title": "Dépôts centraux",
        "commit": "Commit {{commit}} sur {{ref}}",
        "unlocked": "Pas encore résolu. Cliquez sur Actualiser puis validez .claude/skills.lock.json."
      },
      "howTo": "Ajouter une compétence : créez .claude/skills/<nom>/SKILL.md avec name et description dans son en-tête. Épinglez des compétences ou ajoutez des dépôts centraux dans .claude/skills.json."
    }
```

- [ ] **Step 5: Write the failing component test**

```tsx
/**
 * @vitest-environment jsdom
 */
// apps/desktop/src/renderer/components/project-settings/__tests__/SkillsSettings.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SkillsSettings } from '../SkillsSettings';
import { useSkillsStore } from '../../../stores/skills-store';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: Record<string, string>) => (opts?.commit ? `${key}:${opts.commit}` : key) }),
}));

const listSkills = vi.fn();
const refreshSkills = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = { listSkills, refreshSkills };
  useSkillsStore.setState({ snapshot: null, isLoading: false, error: null });
});

describe('SkillsSettings', () => {
  it('loads on mount and renders skills with source, pins, and status', async () => {
    listSkills.mockResolvedValue({
      success: true,
      data: {
        skills: [
          { name: 'fe', description: 'Frontend', source: 'local', dir: '/x/fe' },
          { name: 'fe', description: 'Central frontend', source: 'central', dir: '/y/fe', repoUrl: 'https://r', overriddenBy: 'local' },
        ],
        pins: { coder: ['fe'] },
        warnings: ['w1'],
        lock: { repos: { 'https://r': { ref: 'main', commit: 'abcdef1234567890', resolvedAt: 't' } } },
      },
    });
    render(<SkillsSettings projectId="p1" />);
    await waitFor(() => expect(listSkills).toHaveBeenCalledWith('p1'));
    expect(await screen.findByText('Frontend')).toBeInTheDocument();
    expect(screen.getByText('Central frontend')).toBeInTheDocument();
    expect(screen.getByText('projectSections.skills.status.overridden')).toBeInTheDocument();
    expect(screen.getByText('coder')).toBeInTheDocument();
    expect(screen.getByText('w1')).toBeInTheDocument();
    expect(screen.getByText('projectSections.skills.repos.commit:abcdef1')).toBeInTheDocument();
  });

  it('shows a blocking error banner', async () => {
    listSkills.mockResolvedValue({ success: true, data: { skills: [], pins: {}, warnings: [], error: 'BAD CONFIG', lock: { repos: {} } } });
    render(<SkillsSettings projectId="p1" />);
    expect(await screen.findByText('BAD CONFIG')).toBeInTheDocument();
    expect(screen.getByText('projectSections.skills.blockingError')).toBeInTheDocument();
  });

  it('refresh button calls refreshSkills', async () => {
    listSkills.mockResolvedValue({ success: true, data: { skills: [], pins: {}, warnings: [], lock: { repos: {} } } });
    refreshSkills.mockResolvedValue({ success: true, data: { skills: [], pins: {}, warnings: [], lock: { repos: {} } } });
    render(<SkillsSettings projectId="p1" />);
    await screen.findByText('projectSections.skills.empty');
    fireEvent.click(screen.getByRole('button', { name: 'projectSections.skills.refresh' }));
    await waitFor(() => expect(refreshSkills).toHaveBeenCalledWith('p1'));
  });
});
```

- [ ] **Step 6: Write `SkillsSettings.tsx`**

```tsx
// apps/desktop/src/renderer/components/project-settings/SkillsSettings.tsx
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, AlertTriangle } from 'lucide-react';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { useSkillsStore } from '../../stores/skills-store';

interface SkillsSettingsProps {
  projectId: string;
}

export function SkillsSettings({ projectId }: SkillsSettingsProps) {
  const { t } = useTranslation('settings');
  const { snapshot, isLoading, error, load, refresh } = useSkillsStore();

  useEffect(() => {
    void load(projectId);
  }, [projectId, load]);

  const pinsFor = (name: string): string[] =>
    Object.entries(snapshot?.pins ?? {})
      .filter(([, names]) => names.includes(name))
      .map(([target]) => target);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t('projectSections.skills.howTo')}</p>
        <Button variant="outline" size="sm" onClick={() => void refresh(projectId)} disabled={isLoading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {isLoading ? t('projectSections.skills.refreshing') : t('projectSections.skills.refresh')}
        </Button>
      </div>

      {(error || snapshot?.error) && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {t('projectSections.skills.blockingError')}
          </div>
          <p className="mt-1 text-destructive">{error ?? snapshot?.error}</p>
        </div>
      )}

      {snapshot && snapshot.warnings.length > 0 && (
        <div className="rounded-md border border-border p-3 text-sm">
          <div className="font-medium mb-1">{t('projectSections.skills.warnings')}</div>
          <ul className="list-disc pl-5 text-muted-foreground">
            {snapshot.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {snapshot && snapshot.skills.length === 0 && !snapshot.error && (
        <p className="text-sm text-muted-foreground">{t('projectSections.skills.empty')}</p>
      )}

      {snapshot && snapshot.skills.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-2 pr-3">{t('projectSections.skills.columns.name')}</th>
              <th className="py-2 pr-3">{t('projectSections.skills.columns.description')}</th>
              <th className="py-2 pr-3">{t('projectSections.skills.columns.source')}</th>
              <th className="py-2 pr-3">{t('projectSections.skills.columns.pinned')}</th>
              <th className="py-2">{t('projectSections.skills.columns.status')}</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.skills.map((skill) => (
              <tr key={`${skill.source}:${skill.name}`} className="border-b border-border/50 align-top">
                <td className="py-2 pr-3 font-mono">{skill.name}</td>
                <td className="py-2 pr-3">{skill.description}</td>
                <td className="py-2 pr-3">
                  <Badge variant="secondary">{t(`projectSections.skills.source.${skill.source}`)}</Badge>
                  {skill.repoUrl && <div className="text-xs text-muted-foreground mt-1 break-all">{skill.repoUrl}</div>}
                </td>
                <td className="py-2 pr-3">
                  {skill.overriddenBy ? null : pinsFor(skill.name).map((target) => (
                    <Badge key={target} variant="outline" className="mr-1">{target}</Badge>
                  ))}
                </td>
                <td className="py-2">
                  {skill.overriddenBy
                    ? t('projectSections.skills.status.overridden')
                    : t('projectSections.skills.status.active')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {snapshot && Object.keys(snapshot.lock.repos).length > 0 && (
        <div className="text-sm">
          <div className="font-medium mb-1">{t('projectSections.skills.repos.title')}</div>
          <ul className="text-muted-foreground">
            {Object.entries(snapshot.lock.repos).map(([url, entry]) => (
              <li key={url} className="break-all">
                <span className="font-mono">{url}</span>{' '}
                <span>{t('projectSections.skills.repos.commit', { commit: entry.commit.slice(0, 7), ref: entry.ref })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Wire the section**

In `apps/desktop/src/renderer/components/settings/ProjectSettingsContent.tsx` line 13:

```ts
export type ProjectSettingsSection = 'general' | 'linear' | 'github' | 'gitlab' | 'memory' | 'skills';
```

In `apps/desktop/src/renderer/components/settings/AppSettings.tsx`: add `BookOpen` to the `lucide-react` import list, and in `projectNavItemsConfig` add `{ id: 'skills', icon: BookOpen }` after the `memory` entry. The nav already renders `t(\`projectSections.${item.id}.title\`)` and `.description`, so the keys from Step 4 light it up.

In `apps/desktop/src/renderer/components/settings/sections/SectionRouter.tsx`: add `import { SkillsSettings } from '../../project-settings/SkillsSettings';` and a new case before the router's default/fallthrough:

```tsx
    case 'skills':
      return (
        <SettingsSection
          title={t('projectSections.skills.integrationTitle')}
          description={t('projectSections.skills.integrationDescription')}
        >
          <SkillsSettings projectId={project.id} />
        </SettingsSection>
      );
```

If `App.tsx` has an exhaustive list or switch over `ProjectSettingsSection`, add `'skills'` there too (the typecheck will point at it).

- [ ] **Step 8: Run tests, lint, typecheck, commit**

Run: `cd apps/desktop && npx vitest run src/renderer/stores/__tests__/skills-store.test.ts src/renderer/components/project-settings/__tests__/SkillsSettings.test.tsx && npm run lint && npm run typecheck`
Expected: all pass. The vitest default environment is `node`; the `@vitest-environment jsdom` docblock at the top of the component test (same convention as `src/renderer/components/__tests__/AgentTools.test.tsx`) switches it. `toBeInTheDocument` comes from `@testing-library/jest-dom`, which the existing renderer tests already rely on; if the matcher is missing, add `import '@testing-library/jest-dom/vitest';` under the docblock.

```bash
git add apps/desktop/src/renderer/stores/skills-store.ts apps/desktop/src/renderer/components/project-settings/SkillsSettings.tsx apps/desktop/src/renderer/components/settings/ProjectSettingsContent.tsx apps/desktop/src/renderer/components/settings/AppSettings.tsx apps/desktop/src/renderer/components/settings/sections/SectionRouter.tsx apps/desktop/src/shared/i18n/locales/en/settings.json apps/desktop/src/shared/i18n/locales/fr/settings.json apps/desktop/src/renderer/stores/__tests__/skills-store.test.ts apps/desktop/src/renderer/components/project-settings/__tests__/SkillsSettings.test.tsx
git commit -m "feat(skills): add read-only Skills panel to project settings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: "Skills used" in task detail

**Files:**
- Create: `apps/desktop/src/renderer/components/task-detail/TaskSkillsUsed.tsx`
- Modify: `apps/desktop/src/renderer/components/task-detail/TaskDetailModal.tsx:585-590` (Files tab)
- Modify: `apps/desktop/src/shared/i18n/locales/en/tasks.json`, `apps/desktop/src/shared/i18n/locales/fr/tasks.json`
- Test: `apps/desktop/src/renderer/components/task-detail/__tests__/TaskSkillsUsed.test.tsx`

**Interfaces:**
- Consumes: `window.electronAPI.readFile(filePath): Promise<IPCResult<string>>`; `Task.specsPath?: string`; `SkillUsageRecord`.
- Produces: `TaskSkillsUsed({ task })`.

- [ ] **Step 1: Add i18n keys**

In `en/tasks.json` add a top-level key:

```json
  "skillsUsed": {
    "title": "Skills used",
    "empty": "No skills were loaded for this task yet.",
    "pinned": "pinned",
    "loaded": "loaded",
    "resource": "file"
  }
```

In `fr/tasks.json`:

```json
  "skillsUsed": {
    "title": "Compétences utilisées",
    "empty": "Aucune compétence n'a encore été chargée pour cette tâche.",
    "pinned": "épinglée",
    "loaded": "chargée",
    "resource": "fichier"
  }
```

- [ ] **Step 2: Write the failing component test**

```tsx
/**
 * @vitest-environment jsdom
 */
// apps/desktop/src/renderer/components/task-detail/__tests__/TaskSkillsUsed.test.tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskSkillsUsed } from '../TaskSkillsUsed';
import type { Task } from '../../../../shared/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const readFile = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = { readFile };
});

const task = { id: 't1', specsPath: '/p/.auto-claude/specs/001-x' } as unknown as Task;

describe('TaskSkillsUsed', () => {
  it('renders deduplicated skills with pinned/loaded markers', async () => {
    readFile.mockResolvedValue({
      success: true,
      data: JSON.stringify([
        { name: 'std', agentType: 'coder', pinned: true, at: 't1' },
        { name: 'std', agentType: 'coder', pinned: true, at: 't2' },
        { name: 'docs', resource: 'ref/a.md', agentType: 'qa_reviewer', pinned: false, at: 't3' },
      ]),
    });
    render(<TaskSkillsUsed task={task} />);
    expect(await screen.findByText('std')).toBeInTheDocument();
    expect(readFile).toHaveBeenCalledWith('/p/.auto-claude/specs/001-x/skills_used.json');
    expect(screen.getAllByText('std')).toHaveLength(1);
    expect(screen.getByText('docs')).toBeInTheDocument();
    expect(screen.getByText('coder')).toBeInTheDocument();
    expect(screen.getByText('qa_reviewer')).toBeInTheDocument();
    expect(screen.getByText('tasks:skillsUsed.pinned')).toBeInTheDocument();
    expect(screen.getByText('ref/a.md')).toBeInTheDocument();
  });

  it('shows the empty message when the file is missing', async () => {
    readFile.mockResolvedValue({ success: false, error: 'ENOENT' });
    render(<TaskSkillsUsed task={task} />);
    expect(await screen.findByText('tasks:skillsUsed.empty')).toBeInTheDocument();
  });

  it('renders nothing without specsPath', () => {
    const { container } = render(<TaskSkillsUsed task={{ id: 't2' } as unknown as Task} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 3: Write `TaskSkillsUsed.tsx`**

```tsx
// apps/desktop/src/renderer/components/task-detail/TaskSkillsUsed.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../ui/badge';
import type { Task } from '../../../shared/types';

interface UsageRecord {
  name: string;
  resource?: string;
  agentType: string;
  pinned: boolean;
  at: string;
}

interface Row {
  name: string;
  agents: string[];
  pinned: boolean;
  resources: string[];
}

interface TaskSkillsUsedProps {
  task: Task;
}

function toRows(records: UsageRecord[]): Row[] {
  const byName = new Map<string, Row>();
  for (const r of records) {
    const row = byName.get(r.name) ?? { name: r.name, agents: [], pinned: false, resources: [] };
    if (!row.agents.includes(r.agentType)) row.agents.push(r.agentType);
    if (r.pinned) row.pinned = true;
    if (r.resource && !row.resources.includes(r.resource)) row.resources.push(r.resource);
    byName.set(r.name, row);
  }
  return [...byName.values()];
}

export function TaskSkillsUsed({ task }: TaskSkillsUsedProps) {
  const { t } = useTranslation('tasks');
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!task.specsPath) return;
    let cancelled = false;
    window.electronAPI.readFile(`${task.specsPath}/skills_used.json`).then((result) => {
      if (cancelled) return;
      if (!result.success || !result.data) {
        setRows([]);
        return;
      }
      try {
        const parsed: unknown = JSON.parse(result.data);
        setRows(Array.isArray(parsed) ? toRows(parsed as UsageRecord[]) : []);
      } catch {
        setRows([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [task.specsPath]);

  if (!task.specsPath || rows === null) return null;

  return (
    <div className="px-4 py-3 border-b border-border">
      <div className="text-sm font-medium mb-2">{t('tasks:skillsUsed.title')}</div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('tasks:skillsUsed.empty')}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((row) => (
            <li key={row.name} className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{row.name}</span>
              <Badge variant="outline">{row.pinned ? t('tasks:skillsUsed.pinned') : t('tasks:skillsUsed.loaded')}</Badge>
              {row.agents.map((a) => (
                <Badge key={a} variant="secondary">{a}</Badge>
              ))}
              {row.resources.map((r) => (
                <span key={r} className="text-xs text-muted-foreground">
                  {t('tasks:skillsUsed.resource')}: <span className="font-mono">{r}</span>
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Mount it in the Files tab**

In `apps/desktop/src/renderer/components/task-detail/TaskDetailModal.tsx` add `import { TaskSkillsUsed } from './TaskSkillsUsed';` next to the `TaskFiles` import (line ~44) and change the Files tab content (lines ~586-590) to:

```tsx
                {showFilesTab && (
                  <TabsContent value="files" className="flex-1 min-h-0 overflow-hidden mt-0 flex flex-col">
                    <TaskSkillsUsed task={task} />
                    <div className="flex-1 min-h-0">
                      <TaskFiles task={task} />
                    </div>
                  </TabsContent>
                )}
```

- [ ] **Step 5: Run tests, lint, typecheck, commit**

Run: `cd apps/desktop && npx vitest run src/renderer/components/task-detail/__tests__/TaskSkillsUsed.test.tsx && npm run lint && npm run typecheck`
Expected: all pass (the test file carries the `@vitest-environment jsdom` docblock like Task 11).

```bash
git add apps/desktop/src/renderer/components/task-detail/TaskSkillsUsed.tsx apps/desktop/src/renderer/components/task-detail/TaskDetailModal.tsx apps/desktop/src/shared/i18n/locales/en/tasks.json apps/desktop/src/shared/i18n/locales/fr/tasks.json apps/desktop/src/renderer/components/task-detail/__tests__/TaskSkillsUsed.test.tsx
git commit -m "feat(skills): show skills used in task detail

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: End-to-end check (integration test + manual run)

**Files:**
- Test: `apps/desktop/src/__tests__/integration/skills-pipeline.integration.test.ts`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the integration test**

This test exercises the real chain without a model: resolve → snapshot → per-agent section → `load_skill`, using a local bare repo as the central source.

```ts
// apps/desktop/src/__tests__/integration/skills-pipeline.integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { refreshSkills, resolveSkills } from '../../main/ai/skills/resolve';
import { createGitRunner } from '../../main/ai/skills/sync';
import { buildSkillsSectionForAgent } from '../../main/ai/agent/skills-prompt';
import { injectContext } from '../../main/ai/prompts/prompt-loader';
import { loadSkillTool } from '../../main/ai/tools/builtin/load-skill';
import type { ToolContext } from '../../main/ai/tools/types';

function git(args: string[], cwd: string) {
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
}
function writeSkill(root: string, name: string, body: string, files: Record<string, string> = {}) {
  mkdirSync(path.join(root, name), { recursive: true });
  writeFileSync(path.join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} description\n---\n${body}\n`);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name, rel)), { recursive: true });
    writeFileSync(path.join(root, name, rel), content);
  }
}

describe('skills pipeline integration', () => {
  let tmp: string;
  let projectDir: string;
  let specDir: string;
  let userDataDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'skills-e2e-'));
    projectDir = path.join(tmp, 'project');
    specDir = path.join(projectDir, '.auto-claude', 'specs', '001-demo');
    userDataDir = path.join(tmp, 'userData');
    mkdirSync(specDir, { recursive: true });
    mkdirSync(userDataDir);

    const work = path.join(tmp, 'central-work');
    mkdirSync(path.join(work, 'skills'), { recursive: true });
    git(['init', '-q', '-b', 'main'], work);
    writeSkill(path.join(work, 'skills'), 'api-standards', 'ALWAYS version endpoints.', { 'references/errors.md': 'Use RFC 7807.' });
    git(['add', '.'], work);
    git(['commit', '-q', '-m', 'init'], work);
    const bare = path.join(tmp, 'central.git');
    git(['clone', '-q', '--bare', work, bare], tmp);

    writeSkill(path.join(projectDir, '.claude', 'skills'), 'fe-standards', 'Use function components.');
    writeFileSync(
      path.join(projectDir, '.claude', 'skills.json'),
      JSON.stringify({ centralRepos: [{ url: `file://${bare}` }], pins: { coding: ['fe-standards'] } }),
    );
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('refresh → resolve → coder prompt has pinned body and catalog → load_skill reads central skill and resource', async () => {
    const opts = { userDataDir, git: createGitRunner(), allowedSchemes: ['file:'] as const };
    const refreshed = await refreshSkills(projectDir, opts);
    expect(refreshed.error).toBeUndefined();

    const snapshot = await resolveSkills(projectDir, opts);
    expect(snapshot.error).toBeUndefined();
    expect(snapshot.skills.map((s) => s.name).sort()).toEqual(['api-standards', 'fe-standards']);

    const section = await buildSkillsSectionForAgent(snapshot, 'coder', specDir);
    const prompt = injectContext('BASE PROMPT', { specDir, projectDir, skillsSection: section });
    expect(prompt).toContain('Use function components.');           // pinned body
    expect(prompt).toContain('| api-standards | api-standards description |'); // catalog row
    expect(prompt.indexOf('## PROJECT SKILLS')).toBeLessThan(prompt.indexOf('BASE PROMPT'));

    const qaSection = await buildSkillsSectionForAgent(snapshot, 'qa_reviewer', specDir);
    expect(qaSection).not.toContain('### Pinned skills');
    expect(qaSection).toContain('| fe-standards |');

    const ctx = { cwd: projectDir, projectDir, specDir, securityProfile: {} as ToolContext['securityProfile'], skillsSnapshot: snapshot, agentType: 'coder' } as ToolContext;
    const body = (await loadSkillTool.config.execute({ name: 'api-standards' }, ctx)) as string;
    expect(body).toContain('ALWAYS version endpoints.');
    expect(body).toContain('references/errors.md');
    const resource = (await loadSkillTool.config.execute({ name: 'api-standards', resource: 'references/errors.md' }, ctx)) as string;
    expect(resource).toBe('Use RFC 7807.');

    const usage = JSON.parse(readFileSync(path.join(specDir, 'skills_used.json'), 'utf-8')) as Array<{ name: string; pinned: boolean }>;
    expect(usage.filter((u) => u.pinned).map((u) => u.name)).toEqual(['fe-standards']);
    expect(usage.filter((u) => !u.pinned).map((u) => u.name)).toEqual(['api-standards', 'api-standards']);
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd apps/desktop && npx vitest run src/__tests__/integration/skills-pipeline.integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the full suite, lint, and typecheck**

Run: `cd apps/desktop && npm test && npm run lint && npm run typecheck`
Expected: all green. Fix any failures caused by this feature (for example a snapshot of tool lists) before moving on.

- [ ] **Step 4: Manual run**

1. `nvm use 24 && npm run dev` from the repo root.
2. Open a project that has at least one `.claude/skills/<name>/SKILL.md`. Go to Settings > Project > Skills. Confirm the skill is listed as Local.
3. Add `.claude/skills.json` with `{ "centralRepos": [{ "url": "https://github.com/anthropics/skills.git", "subpath": ".", "include": ["docx"] }] }`. Click Refresh. Confirm the `docx` skill appears as Central and `.claude/skills.lock.json` was written.
4. Add `"pins": { "coding": ["<your local skill>"] }` and start a task. In the task's Logs, confirm a line `Project skills injected for coder`. In the Files tab, confirm "Skills used" shows the pinned skill.
5. Break `.claude/skills.json` (remove a brace) and start a task. Confirm the task errors with `Project skills error: .claude/skills.json is not valid JSON`, and the Skills panel shows the same error.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/__tests__/integration/skills-pipeline.integration.test.ts
git commit -m "test(skills): add end-to-end skills pipeline integration test

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Spec coverage checklist (self-review)

| Spec section | Task |
|---|---|
| Files in the project repository, `skills.json`, `skills.lock.json`, missing/malformed rules | 1, 6 |
| Module layout, types | 1–6 |
| Resolution rules 1–6 | 2, 4, 6 |
| Main process / worker boundary | 9 |
| Prompt injection format, budgets | 7, 9 |
| `load_skill` tool contract, agent eligibility, containment unchanged | 8 |
| Usage tracking | 3, 8, 9, 12 |
| Central repo sync layout, ensure/refresh, git safety, offline | 5, 6 |
| Renderer: IPC, store, Skills tab, task detail, i18n | 10, 11, 12 |
| Error handling table | 1, 4, 6, 7, 8, 9, 11 |
| Testing list | every task; integration in 13 |
