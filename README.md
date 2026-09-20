# Appswave

Appswave is our internal AI-assisted software delivery platform. It is a desktop application (Windows, macOS, Linux) where product owners, designers, developers, QA, and DevOps work from one shared project context: AI agents plan, implement, and validate work in isolated git worktrees while the team reviews and merges.

Appswave is built on the open-source Auto Claude / Aperant codebase (AGPL-3.0, see `agpl-3.0.txt`) and extends it with team-oriented SDLC stages.

## Requirements

- Node.js 24 or newer and npm 10 or newer
- git
- A Claude Code subscription or an Anthropic-compatible API key, or a Codex (ChatGPT) subscription

## Quick start

```bash
npm run install:all      # install dependencies (from the repo root)
npm run dev              # start the desktop app in development mode
npm run dev:mcp          # same, with the Chrome DevTools port on 9222
npm start                # production build + run
```

Then open or create a project, add an account under Settings > Accounts, and create your first task.

## Features

- **Autonomous tasks** — planner, coder, and QA agents build features end to end in git worktrees
- **Kanban board** — track every task from planning to done
- **Project skills** — shared Agent Skills from the repo and central Git repositories, injected into every agent (Settings > Project > Skills)
- **Insights, roadmap, ideation** — explore the codebase, plan features, and discover improvements with AI
- **Integrations** — GitHub and GitLab issues and pull requests, Linear sync, Graphiti memory
- **Multi-account** — Claude subscription, API profiles, and Codex subscription, with automatic rate-limit switching

## Development

```bash
cd apps/desktop
npm test                 # unit tests (Vitest)
npm run lint             # Biome
npm run typecheck        # TypeScript
npm run test:e2e         # Playwright
```

See `CLAUDE.md` for the codebase guide and `docs/superpowers/` for design specs and implementation plans.

## License

AGPL-3.0. See `agpl-3.0.txt`.
