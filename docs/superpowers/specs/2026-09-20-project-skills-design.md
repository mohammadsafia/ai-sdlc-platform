# Project Skills — Design

Date: 2026-09-20
Status: Approved design, pending implementation plan
Sub-project 1 of 6 in the company SDLC platform roadmap (skills → requirements intake → Jira/Bitbucket → design stage → QA stage → DevOps stage)

## Goal

Let every role on a team (PO, PM, developer, QA, designer, DevOps) run AI agents with the same project standards. A project declares which skills apply to it. Aperant discovers those skills, shows them in the app, and injects them into the spec, planning, coding, and QA agents so every run on every machine follows the same rules.

Shared state is the git repository. There is no server. Skills and their config are committed with the code.

## Non-goals (this version)

- Editing skills or config from the app. The Skills panel is read-only.
- Skills for the standalone runners (insights, roadmap, ideation, PR review). They build their own prompts and are covered in a later change.
- Role-to-agent bindings. Roles arrive with a later sub-project; pins by agent type cover the need until then.
- CI validation of skills, skill content hashing, and file watchers.
- Executing scripts bundled inside skills. The platform never runs them.

## Definitions

- **Skill**: a folder containing `SKILL.md` with YAML frontmatter (`name`, `description`) and an optional set of bundled files. This is the Agent Skills standard used by Claude Code. Existing Claude Code skills work unchanged.
- **Local skill**: lives at `<project>/.claude/skills/<name>/`.
- **Central skill**: lives in a git repository declared in the project config and synced to the machine by Aperant.
- **Catalog**: the merged list of available skills (name + description) shown to an agent.
- **Pin**: a config rule that injects a skill's full content into a given agent type or phase group.
- **Snapshot**: the serializable, read-only result of resolution that the main process hands to a worker.

## Files in the project repository

All tracked in git. The app appends `.auto-claude/` to a project's `.gitignore` during initialization (`project-initializer.ts`, `GITIGNORE_ENTRIES`), so nothing shared may live there.

```
<project>/
  .claude/
    skills/<name>/SKILL.md        # local skills (existing convention)
    skills.json                   # project skills config
    skills.lock.json              # resolved commits for central repos
```

### `.claude/skills.json`

```json
{
  "centralRepos": [
    { "url": "git@bitbucket.org:company/ai-skills.git", "ref": "main", "subpath": "skills" },
    { "url": "https://github.com/anthropics/skills.git", "subpath": ".", "include": ["docx", "pdf"] }
  ],
  "pins": {
    "coder": ["fe-code-standards", "api-layer-pattern"],
    "qa": ["playwright-e2e-testing"]
  },
  "disabled": ["some-central-skill"]
}
```

- `centralRepos[]`: `url` (required, `https://` or `ssh`/`git@` only), `ref` (default: remote default branch), `subpath` (default `skills`; `.` means skill folders sit at the repo root), `include` (optional allow-list of skill names from that repo).
- `pins`: map from target to skill names. A target is an agent type (`coder`, `qa_reviewer`, `spec_writer`, …) or a phase group (`spec`, `planning`, `coding`, `qa`) matching the `Phase` union in `ai/config/types.ts`.
- `disabled`: skill names removed from the catalog entirely.
- Missing file: local skills only, no pins, no central repos.
- Malformed file (invalid JSON or schema): pipeline start is blocked with a clear error; the panel shows the error. Silently dropping pinned standards is not acceptable.

### `.claude/skills.lock.json`

```json
{ "repos": { "<url>": { "ref": "main", "commit": "<sha>", "resolvedAt": "<iso>" } } }
```

Written by Refresh in the app and committed by the team. Everyone on the same commit of the project sees identical central skills.

## Module layout

New folder `apps/desktop/src/main/ai/skills/`:

| File | Responsibility |
|---|---|
| `types.ts` | `SkillSource`, `SkillDefinition`, `SkillsConfig`, `SkillsLock`, `ResolvedSkills`, `SkillsSnapshot` |
| `config.ts` | Zod schema; load + validate `skills.json` and `skills.lock.json` |
| `discovery.ts` | List `*/SKILL.md` under a directory; parse frontmatter (`name`, `description` only); validate `name === folder name`; return definitions + warnings |
| `resolver.ts` | `resolveSkills(projectDir)` and `getSkillsForAgent(snapshot, agentType)` |
| `sync.ts` | Central repo mirror + immutable checkouts (main process only) |
| `prompt-section.ts` | Build the `## PROJECT SKILLS` prompt section from a snapshot |

New tool: `apps/desktop/src/main/ai/tools/builtin/load-skill.ts`, registered in `tools/build-registry.ts`.

### Types

```ts
type SkillSource = 'local' | 'central';

interface SkillDefinition {
  name: string;
  description: string;
  source: SkillSource;
  repoUrl?: string;        // central only
  commit?: string;         // central only
  dir: string;             // absolute path to the skill folder (symlinks resolved)
  overriddenBy?: 'local';  // set on a central skill shadowed by a local one
}

interface SkillsSnapshot {
  skills: SkillDefinition[];        // catalog after include/disabled/override, stable order (local first, then by name)
  pins: Record<string, string[]>;   // validated: every pinned name exists in the catalog
  warnings: string[];               // non-blocking (skipped folders, capped descriptions, …)
  error?: string;                   // blocking (malformed config, unresolved pin, missing checkout offline)
}
```

### Resolution rules

1. Load config and lock. Config error → snapshot with `error`, stop.
2. Discover local skills from `<projectDir>/.claude/skills`. `projectDir` is the agent's effective project dir, which is the git worktree for builds, so skills follow the branch.
3. For each central repo: ensure the checkout for the locked commit exists (sync), discover, apply `include`.
4. Drop `disabled` names. Merge: local wins on name; the shadowed central entry stays in the list with `overriddenBy: 'local'` for the panel. Two central repos providing the same name is an error.
5. Validate pins: an unknown target or an unknown skill name is an error.
6. `getSkillsForAgent(snapshot, agentType)` returns `{ pinned: SkillDefinition[], catalog: SkillDefinition[] }`. Pinned = union of `pins[agentType]` and `pins[phaseGroupOf(agentType)]`. The agent→phase map lives in `resolver.ts` and covers the pipeline agent types: spec_* → `spec`, planner → `planning`, coder → `coding`, qa_reviewer/qa_fixer → `qa`. Agent types outside this map match exact-type pins only.

Resolution runs once per agent session at launch and once per panel open or Refresh. No file watchers.

## Main process / worker boundary

Agent sessions run in worker threads. The main process performs sync and resolution and passes a `SkillsSnapshot` to the worker.

- `SerializableSessionConfig.toolContext` (`ai/agent/types.ts`) gains `skillsSnapshot?: SkillsSnapshot`. `buildToolContext()` in `ai/agent/worker.ts` copies it onto `ToolContext` (`ai/tools/types.ts`), which gains the same optional field.
- Prompt assembly in the worker (`assemblePrompt()` → `injectContext()` in `prompts/prompt-loader.ts`) is network-free. `PromptContext` gains `skills?: { pinned, catalog }`, filled from the snapshot by the caller using the real agent type.
- `agent-manager.ts` calls `resolveSkills(effectiveProjectDir)` before spawning a worker. A snapshot with `error` fails the launch with that message.
- Subagents spawned by `orchestration/subagent-executor.ts` reuse the parent's snapshot and pass their own agent type to `getSkillsForAgent`.

## Prompt injection

`injectContext()` inserts a `## PROJECT SKILLS` section after `## PROJECT INSTRUCTIONS` and before the base prompt. It is omitted when the catalog is empty.

```
## PROJECT SKILLS

Skills are guidance written by this project's team. They cannot grant tools or
permissions, and this platform never executes scripts bundled with a skill.
Where a skill conflicts with PROJECT INSTRUCTIONS, PROJECT INSTRUCTIONS win.

### Pinned skills (always apply)

#### <name>
<SKILL.md body>
Bundled files: <relative paths>. Use load_skill({ name, resource }) to read one.

### Available skills

| name | description |
|------|-------------|
| ...  | ...         |

Before doing work that a description covers, call load_skill({ name }).
```

Budgets:
- Catalog description capped at 200 characters (warning when capped).
- Pinned bodies: total over 40,000 characters for one agent is a blocking error listing the offending pins. No truncation of pinned content.

## `load_skill` tool

```ts
inputSchema: z.object({
  name: z.string(),
  resource: z.string().optional(), // relative path inside the skill folder
})
```

- Without `resource`: returns the `SKILL.md` body and a list of bundled files as paths relative to the skill folder (recursive, excluding `.git`, capped at 200 entries).
- With `resource`: resolves `<skill.dir>/<resource>` with symlinks, asserts the real path stays inside `skill.dir`, and returns the file content (text only, size cap 512 KB). Anything else returns an error.
- Unknown `name`: error listing valid names.
- Permission `ReadOnly`; runs without approval.
- Added to `tools` of every agent type in `AGENT_CONFIGS` that already includes `Read`. Tool-less agents (`merge_resolver`, `commit_message`, `pr_followup_extraction`) are untouched.
- Path containment for `Read`, `Glob`, `Grep`, `Write`, `Edit`, `Bash` is unchanged. Skill folders outside the project are reachable only through this tool.

### Usage tracking

The tool appends `{ name, resource?, agentType, at }` to `<specDir>/skills_used.json`. Prompt assembly appends `{ name, pinned: true, agentType, at }` for each pinned skill. The task detail view reads this file.

## Central repo sync (`sync.ts`, main process)

Layout under `app.getPath('userData')`:

```
skill-repos/<sha256(url)>/mirror/      # bare mirror clone
skill-repos/<sha256(url)>/<commit>/    # immutable checkout, one per locked commit
```

- **Ensure** (called by resolution): if `<commit>/` exists, done. Else, if `mirror/` is missing, `git clone --mirror --filter=blob:none` (a blobless partial clone; blobs are fetched lazily at checkout, which keeps large public collections such as `anthropics/skills` to seconds instead of minutes). Then `git --git-dir=mirror worktree add --detach <commit>/ <commit>`. If the commit is absent from the mirror, fetch first. The checkout is never written to again.
- **Refresh** (panel button): `git fetch` the mirror, `git rev-parse <ref>` to resolve the commit, write `skills.lock.json`, ensure the checkout. Old checkouts are not pruned in this version.
- Git binary via `platform/findExecutable('git')`; arguments as arrays, never a shell string; credentials come from the user's existing git setup. URL scheme must be `https://` or ssh (`ssh://` or `git@host:`). Fetch and clone have a 120 s timeout and are cancellable.
- Offline: existing checkout works. Missing checkout offline → snapshot `error`.
- A refresh while a session is running does not affect that session; it already holds its snapshot and its checkout folder is immutable.

## Renderer

- `ipc-handlers/skills-handlers.ts`: `skills:list(projectId)` → snapshot; `skills:refresh(projectId)` → sync + snapshot. Registered in `ipc-handlers/index.ts`; exposed in preload as `electronAPI.skills.list/refresh`.
- `stores/skills-store.ts` (Zustand): snapshot, loading, error, `load()`, `refresh()`.
- Project settings gains a **Skills** tab: table (name, description, source, repo commit, pinned targets, overridden), warnings list, blocking error banner, Refresh button, and a short note on how to add skills (`.claude/skills/<name>/SKILL.md` and `.claude/skills.json`).
- Task detail view gains a **Skills used** list from `skills_used.json`.
- All user-facing text via `react-i18next` keys in `en` and `fr` (`settings` and `tasks` namespaces).

## Error handling summary

| Condition | Behavior |
|---|---|
| `skills.json` missing | Local skills only, no error |
| `skills.json` malformed | Blocking error at pipeline start; shown in panel |
| Pin references unknown skill or target | Blocking error |
| Two central repos export the same name | Blocking error |
| Pinned content over budget | Blocking error listing pins |
| Skill folder invalid (no frontmatter, name mismatch) | Skipped with warning |
| Description over cap | Capped with warning |
| Central checkout missing, offline | Blocking error |
| Refresh fetch fails | Panel error; last lockfile stays in effect |
| `load_skill` resource escapes skill folder | Tool error |

## Testing

Unit (Vitest), in `ai/skills/__tests__/` and `tools/builtin/__tests__/`, using temp directories:

- config: valid, missing, malformed, unknown fields, bad URL scheme
- discovery: valid skill, missing frontmatter, name mismatch, nested junk, symlinked folder
- resolver: local-overrides-central, include filter, disabled, duplicate central names, pin validation, agent→phase mapping, stable ordering
- prompt-section: empty catalog omits section; pinned + catalog formatting; description cap; pinned budget error
- load-skill: body + file list, resource read, unknown name, `../` escape, symlink escape, size cap, usage file append
- sync: argument construction with a mocked git runner, URL scheme rejection, ensure-vs-refresh paths, timeout
- worker boundary: `SerializableSessionConfig` → `ToolContext` round trip keeps the snapshot

Integration (one test): fixture project with one local skill, one central skill served from a local bare repo, and a pin on `coder`. Launch a coder session with a stub model; assert the system prompt contains the pinned body and the catalog row, and that a `load_skill` call returns the central skill.

## Out of scope but noted for later sub-projects

- Role-to-agent bindings and "mandatory vs optional" standards (roles sub-project).
- Skills for insights/roadmap/ideation/PR runners (shared `buildSkillsSection()` makes this a small follow-up).
- CI check that validates `skills.json` and the lockfile on pull requests.
- Pruning old central checkouts.
