# BRD Workspace — Design

Date: 2026-09-20
Status: Approved design, pending implementation plan
Sub-project 2a of the company SDLC platform roadmap. Follows [project skills](2026-09-20-project-skills-design.md). Followed by 2b (requirements generation and review) and 2c (milestone release and traceability).

## Goal

Give product owners a place inside Appswave to write, keep, and AI-draft Business Requirements Documents (BRDs) as Markdown files committed in the project repository. A BRD is the input for sub-project 2b, which splits it into requirements, milestones, and tasks.

## Non-goals (this version)

- Splitting a BRD into requirements, milestones, or tasks (2b).
- Creating tasks or touching the Kanban, task pipeline, or agents' project context (2c).
- Committing files to git from the app. The PO commits `docs/brd/` like any other change.
- Rich-text editing. The editor is plain Markdown with a rendered preview.
- Parsing PDF or Word documents. BRDs are Markdown only.

## Definitions

- **BRD**: one Markdown file at `<project>/docs/brd/<slug>.md` with YAML frontmatter.
- **Slug**: kebab-case, derived from the title at creation, never changed afterwards. It is the stable identifier later sub-projects link to.
- **Template**: the Markdown skeleton every BRD starts from, shipped with the app.
- **Structure check**: a pure function that reports required sections that are missing or empty.
- **Draft**: an AI-generated full BRD produced from the PO's notes (new BRD) or from an existing BRD plus instructions (revision). A draft is a proposal until the PO accepts it in the editor.

## Files in the project repository

```
<project>/docs/brd/<slug>.md
```

The app creates `docs/brd/` on first save. Nothing shared lives under `.auto-claude/` (the app gitignores it).

## Template

Shipped at `apps/desktop/templates/brd-template.md` and resolved at runtime like `prompts/` (dev and packaged paths). Content:

```markdown
---
title: <Title>
status: draft
owner:
created: <YYYY-MM-DD>
---

# <Title>

## Summary

One paragraph: what this is and why now.

## Problem and goals

## Success metrics

## Users and stakeholders

## Scope

### In scope

### Out of scope

## Functional requirements

### <Feature area>

1. <Requirement>

## Non-functional requirements

## Milestones

### Milestone 1: <Name>

What is included.

## Constraints and assumptions

## Open questions
```

Frontmatter fields: `title` (string, required), `status` (`draft` | `review` | `approved`, default `draft`), `owner` (string, optional), `created` (ISO date, required). The frontmatter is parsed with the existing `parseFrontmatter` from `src/main/ai/skills/frontmatter.ts`.

Milestones describe what is included. No dates or durations, in line with the repository rule against time estimates; the draft prompt says so explicitly.

## Structure check

`checkBrdStructure(markdown): BrdStructureResult`

```ts
interface BrdSection { heading: string; required: boolean; present: boolean; empty: boolean }
interface BrdStructureResult { ok: boolean; sections: BrdSection[]; frontmatterErrors: string[] }
```

Required sections: `Summary`, `Problem and goals`, `Scope`, `Functional requirements`, `Milestones`. Optional: `Success metrics`, `Users and stakeholders`, `Non-functional requirements`, `Constraints and assumptions`, `Open questions`. A section is *present* when a level-2 heading matches its name (case-insensitive, trimmed) and *empty* when only whitespace or template placeholder text (`<...>`) follows it before the next level-2 heading. `ok` is true when every required section is present and non-empty and the frontmatter has no errors. Sub-project 2b refuses to generate from a BRD whose check is not `ok`.

## Main process

### `src/main/brd/brd-files.ts`

```ts
interface BrdSummary { slug: string; title: string; status: BrdStatus; owner?: string; created?: string; modifiedAt: string }
listBrds(projectDir): Promise<BrdSummary[]>              // sorted by modifiedAt desc; skips files without frontmatter title (warning)
readBrd(projectDir, slug): Promise<{ summary: BrdSummary; content: string }>
writeBrd(projectDir, slug, content): Promise<BrdSummary>   // atomic write (temp file + rename)
createBrd(projectDir, title): Promise<BrdSummary>          // slug from title; suffix -2, -3 on collision; writes template with title and today's date
brdPath(projectDir, slug): string                          // throws unless slug matches /^[a-z0-9]+(-[a-z0-9]+)*$/ and the real path stays inside <projectDir>/docs/brd
```

### `src/main/brd/brd-structure.ts`

`parseBrdFrontmatter(markdown)` → `{ title, status, owner, created, errors[] }` and `checkBrdStructure(markdown)` as above. `slugify(title)` lives here too.

### `src/main/ai/runners/brd-writer.ts`

Modeled on `runners/insights.ts`.

```ts
interface BrdWriterConfig {
  projectDir: string;
  mode: 'draft' | 'revise';
  notes: string;                 // PO notes (draft) or instructions (revise)
  existing?: string;             // current BRD markdown (revise)
  title?: string;                // draft: used for frontmatter
  modelShorthand: string; thinkingLevel: string;  // from getFeatureSettings()
  abortSignal?: AbortSignal;
}
runBrdWriter(config, onStream: (e: { type: 'text-delta'; text: string } | { type: 'done'; text: string } | { type: 'error'; error: string }) => void): Promise<void>
```

- System prompt: `prompts/brd_writer.md` (loaded with `tryLoadPrompt`) with the template appended under a `## TEMPLATE` heading, plus a `## PROJECT CONTEXT` block containing the project name and, when present, a compact summary from `.auto-claude/project_index.json` (name, description, detected stack, top-level services). No tools. `streamText` with the resolved provider; deltas forwarded as they arrive.
- Draft mode instruction: produce the complete document in template order, fill every section, number functional requirements, no dates in milestones, keep frontmatter with the given title and `status: draft`.
- Revise mode instruction: return the full rewritten document applying the instructions and preserving everything else, including frontmatter.
- The runner never writes files. The renderer shows the result as a proposal.

### `src/main/ipc-handlers/brd-handlers.ts`

Channels in `IPC_CHANNELS`:

| Channel | Args | Returns |
|---|---|---|
| `brd:list` | projectId | `IPCResult<BrdSummary[]>` |
| `brd:read` | projectId, slug | `IPCResult<{ summary, content }>` |
| `brd:write` | projectId, slug, content | `IPCResult<BrdSummary>` |
| `brd:create` | projectId, title | `IPCResult<BrdSummary>` |
| `brd:draft` | projectId, `{ mode, notes, slug?, title? }` | `IPCResult<{ runId }>` (returns immediately) |
| `brd:draft-cancel` | runId | `IPCResult` |

Events to the renderer: `brd:draft-chunk` `{ runId, text }`, `brd:draft-done` `{ runId, text }`, `brd:draft-error` `{ runId, error }`. One run per project at a time; a second request while one is streaming returns an error. Project lookup via `projectStore.getProject(projectId)`; unknown project → error result.

Preload: `src/preload/api/modules/brd-api.ts` exposing `brdList`, `brdRead`, `brdWrite`, `brdCreate`, `brdDraft`, `brdDraftCancel`, `onBrdDraftChunk`, `onBrdDraftDone`, `onBrdDraftError` (each `on*` returns an unsubscribe function), spread into `createElectronAPI()` and declared in `src/shared/types/ipc.ts` `ElectronAPI`. Types in `src/shared/types/brd.ts`.

## Renderer

### View registration

- `SidebarView` gains `'requirements'`; nav item `{ id: 'requirements', labelKey: 'navigation:items.requirements', icon: FileText, shortcut: 'R' }` placed after Roadmap.
- `App.tsx` renders `<RequirementsView projectId=... />` when `activeView === 'requirements'`, following the Roadmap branch.

### Components (`src/renderer/components/requirements/`)

- `RequirementsView.tsx`: two-column layout. Left: `BrdList` (title, status badge, modified date, "New BRD" button that prompts for a title through the existing dialog primitives). Right: `BrdEditor` for the selected BRD, or an empty state.
- `BrdEditor.tsx`: header (title, status badge, dirty indicator, Save button, inline error), `StructureChecklist` (required and optional sections, green/amber), split pane with a monospace `textarea` and a `react-markdown` + `remark-gfm` preview, and `BrdAssistPanel` (collapsible).
- `BrdAssistPanel.tsx`: textarea for notes or instructions, "Draft from notes" (enabled when the editor is empty or template-only) and "Revise with instructions" (enabled otherwise), a streaming proposal box with Accept and Discard, and a Cancel while streaming. Accept replaces the editor content and marks it dirty; it does not save.

### Store (`src/renderer/stores/brd-store.ts`)

State: `brds`, `selectedSlug`, `content`, `savedContent`, `isDirty` (derived), `structure: BrdStructureResult | null` (computed on content change, debounced 300 ms, using the shared check re-exported for the renderer from `src/shared/brd/structure.ts`), `draft: { status: 'idle' | 'streaming' | 'proposal'; runId?: string; text: string; error?: string }`, `error`.
Actions: `load(projectId)`, `select(projectId, slug)` (refuses when dirty unless `force`), `setContent(text)`, `save(projectId)`, `create(projectId, title)`, `startDraft(projectId, mode, notes)`, `cancelDraft()`, `acceptDraft()`, `discardDraft()`, `subscribe()` / `unsubscribe()` for the three events.

The structure check must run in the renderer without Node APIs, so `checkBrdStructure`, `parseBrdFrontmatter`, and `slugify` live in `src/shared/brd/structure.ts` (pure string functions) and `src/main/brd/brd-structure.ts` re-exports them. The frontmatter parser moves from `src/main/ai/skills/frontmatter.ts` to `src/shared/frontmatter.ts` with a re-export left in place.

### i18n

Namespace `requirements` (new file `requirements.json` in `en` and `fr`, registered where the other namespaces are), plus `navigation:items.requirements`. Keys for: view title, empty states, New BRD dialog, status labels, save, saved, unsaved changes, structure checklist labels and section names, assist panel labels, draft/revise buttons, proposal accept/discard/cancel, and errors.

## Error handling

| Condition | Behavior |
|---|---|
| `docs/brd` missing | Empty list; created on first save or create |
| File without frontmatter title | Listed with the filename as title and a warning badge |
| Invalid slug or path escape | IPC error result |
| Save fails | Inline error in the editor header; content stays dirty |
| Draft while another run is streaming | IPC error result shown in the assist panel |
| Draft model error or abort | `brd:draft-error` → assist panel shows the error; partial text kept in the proposal box for copy |
| Switching BRD with unsaved changes | Confirmation dialog; cancel keeps the current BRD |

## Testing

Unit (Vitest):
- `shared/brd/structure`: frontmatter fields and errors; slugify; structure check on fixtures (complete, missing required, empty required, optional missing, placeholder text)
- `main/brd/brd-files`: list ordering and warning for missing title; read/write round trip; atomic write leaves no temp file; create with slug collision suffix; path escape rejection (`../`, absolute, symlink)
- `main/ai/runners/brd-writer`: prompt assembly for draft and revise with a stubbed `streamText`; stream forwarding; abort → error event
- `main/ipc-handlers/brd-handlers`: each channel with mocked project store and runner; second concurrent draft rejected
- `renderer/stores/brd-store`: load, select (dirty guard), setContent → structure, save, create, draft streaming → proposal → accept/discard
- `renderer/components/requirements`: `BrdEditor` shows checklist and dirty indicator; assist panel button enablement; proposal accept replaces content

Manual: open Requirements, create "Customer onboarding", draft from three lines of notes, watch the stream, accept, save, and confirm `docs/brd/customer-onboarding.md` exists with the frontmatter and all sections.

## Out of scope but noted

- 2b consumes `listBrds`/`readBrd` and `checkBrdStructure` as its entry point.
- A "commit" button and git status for `docs/brd/` may come with the Bitbucket sub-project.
