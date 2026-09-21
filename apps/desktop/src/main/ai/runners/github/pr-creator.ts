/**
 * PR Creator Runner
 * =================
 *
 * Creates GitHub Pull Requests with AI-generated descriptions using Vercel AI SDK.
 * See apps/desktop/src/main/ai/runners/github/pr-creator.ts for the TypeScript implementation.
 *
 * Steps:
 * 1. Push the worktree branch to origin via git
 * 2. Gather diff/commit context from the branch
 * 3. Generate a semantic PR description via generateText
 * 4. Create the PR via `gh pr create`
 * 5. Return the PR URL and metadata
 *
 * Uses `createSimpleClient()` with no tools (single-turn text generation).
 */

import { execFileSync } from 'node:child_process';

import type { ModelShorthand, ThinkingLevel } from '../../config/types';
import { extractSpecSummary, gatherPRContext, generatePRBody, pushBranch, type CreatePRResult } from '../pr-common';

export type { CreatePRResult } from '../pr-common';

// =============================================================================
// Types
// =============================================================================

/** Configuration for PR creation */
export interface CreatePRConfig {
  /** Project root directory (main git repo) */
  projectDir: string;
  /** Worktree directory (where the branch lives) */
  worktreePath: string;
  /** Spec ID (e.g., "001-add-feature") */
  specId: string;
  /** Branch name to push and create PR from */
  branchName: string;
  /** Base branch to merge into (e.g., "main", "develop") */
  baseBranch: string;
  /** PR title */
  title: string;
  /** Whether to create as a draft PR */
  draft?: boolean;
  /** Path to the gh CLI executable */
  ghPath: string;
  /** Path to the git CLI executable */
  gitPath: string;
  /** Model shorthand (defaults to 'haiku') */
  modelShorthand?: ModelShorthand;
  /** Thinking level (defaults to 'low') */
  thinkingLevel?: ThinkingLevel;
}

// =============================================================================
// Get Existing PR URL
// =============================================================================

/**
 * Try to retrieve the URL of an existing PR for the branch.
 */
function getExistingPRUrl(
  projectDir: string,
  ghPath: string,
  branchName: string,
  baseBranch: string,
): string | undefined {
  try {
    const output = execFileSync(
      ghPath,
      ['pr', 'view', branchName, '--json', 'url', '--jq', '.url'],
      { cwd: projectDir, encoding: 'utf-8', stdio: 'pipe' },
    ).trim();
    return output.startsWith('http') ? output : undefined;
  } catch {
    // Try alternative: list open PRs for this head
    try {
      const listOutput = execFileSync(
        ghPath,
        ['pr', 'list', '--head', branchName, '--base', baseBranch, '--json', 'url', '--jq', '.[0].url'],
        { cwd: projectDir, encoding: 'utf-8', stdio: 'pipe' },
      ).trim();
      return listOutput.startsWith('http') ? listOutput : undefined;
    } catch {
      return undefined;
    }
  }
}

// =============================================================================
// Main PR Creator
// =============================================================================

/**
 * Push a worktree branch and create a GitHub PR with an AI-generated description.
 *
 * @param config - PR creation configuration
 * @returns Result with PR URL or error details
 */
export async function createPR(config: CreatePRConfig): Promise<CreatePRResult> {
  const {
    projectDir,
    worktreePath,
    specId,
    branchName,
    baseBranch,
    title,
    draft = false,
    ghPath,
    gitPath,
    modelShorthand = 'haiku',
    thinkingLevel = 'low',
  } = config;

  // Step 1: Push the branch to origin
  const pushError = pushBranch(worktreePath, gitPath, branchName);
  if (pushError) {
    // If it looks like the branch is already up-to-date, don't bail
    const isUpToDate = pushError.includes('Everything up-to-date') ||
                       pushError.includes('up to date');
    if (!isUpToDate) {
      return { success: false, error: `Failed to push branch: ${pushError}` };
    }
  }

  // Step 2: Gather context for AI description
  const { diffSummary, commitLog } = gatherPRContext(worktreePath, gitPath, baseBranch);

  // Step 3: Generate AI PR body (falls back to spec summary on failure)
  const aiBody = await generatePRBody(
    specId,
    title,
    baseBranch,
    branchName,
    diffSummary,
    commitLog,
    modelShorthand,
    thinkingLevel,
  );

  const prBody = aiBody || extractSpecSummary(projectDir, specId);

  // Step 4: Strip remote prefix from base branch if present
  const effectiveBase = baseBranch.startsWith('origin/')
    ? baseBranch.slice('origin/'.length)
    : baseBranch;

  // Step 5: Build gh pr create command
  const ghArgs = [
    'pr', 'create',
    '--base', effectiveBase,
    '--head', branchName,
    '--title', title,
    '--body', prBody,
  ];

  if (draft) {
    ghArgs.push('--draft');
  }

  // Step 6: Execute gh pr create with retry on network errors
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const output = execFileSync(ghPath, ghArgs, {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();

      // Extract PR URL from output
      let prUrl: string | undefined;
      if (output.startsWith('http')) {
        prUrl = output;
      } else {
        const match = output.match(/https:\/\/[^\s]+\/pull\/\d+/);
        prUrl = match ? match[0] : undefined;
      }

      return { success: true, prUrl, alreadyExists: false };
    } catch (err: unknown) {
      const spawnErr = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
      const stderr = String(spawnErr.stderr ?? '');
      const stdout = String(spawnErr.stdout ?? '');

      // Check "already exists" — not a failure
      if (stderr.toLowerCase().includes('already exists') || stdout.toLowerCase().includes('already exists')) {
        const existingUrl = getExistingPRUrl(projectDir, ghPath, branchName, effectiveBase);
        return { success: true, prUrl: existingUrl, alreadyExists: true };
      }

      // Check if retryable (network / 5xx errors)
      const isNetworkError = /timeout|connection|network|ECONNRESET|ECONNREFUSED/i.test(stderr);
      const isServerError = /5\d\d|server error|internal error/i.test(stderr);

      if ((isNetworkError || isServerError) && attempt < 2) {
        // Exponential backoff before retry
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 2000));
        continue;
      }

      // Non-retryable error — return failure
      const errorMessage = stderr || stdout || String(spawnErr.message) || 'Failed to create PR';
      return { success: false, error: errorMessage };
    }
  }

  return { success: false, error: 'PR creation failed after 3 attempts' };
}
