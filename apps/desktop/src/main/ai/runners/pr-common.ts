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
  const text = e && typeof e === 'object' && 'stderr' in e && e.stderr ? String(e.stderr) : String(err);
  return text || 'Push failed';
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

/** Diff stat and commit log of the branch against the base, best effort. */
export function gatherPRContext(
  worktreePath: string,
  gitPath: string,
  baseBranch: string,
): { diffSummary: string; commitLog: string } {
  let diffSummary = '';
  let commitLog = '';

  try {
    diffSummary = execFileSync(
      gitPath,
      ['diff', '--stat', `origin/${baseBranch}...HEAD`],
      { cwd: worktreePath, encoding: 'utf-8' },
    ).slice(0, 3000);
  } catch {
    try {
      // Fallback without "origin/" prefix
      diffSummary = execFileSync(
        gitPath,
        ['diff', '--stat', `${baseBranch}...HEAD`],
        { cwd: worktreePath, encoding: 'utf-8' },
      ).slice(0, 3000);
    } catch {
      // Not fatal — proceed without diff
    }
  }

  try {
    commitLog = execFileSync(
      gitPath,
      ['log', '--oneline', `origin/${baseBranch}..HEAD`],
      { cwd: worktreePath, encoding: 'utf-8' },
    ).slice(0, 2000);
  } catch {
    try {
      commitLog = execFileSync(
        gitPath,
        ['log', '--oneline', `${baseBranch}..HEAD`],
        { cwd: worktreePath, encoding: 'utf-8' },
      ).slice(0, 2000);
    } catch {
      // Not fatal — proceed without commit log
    }
  }

  return { diffSummary, commitLog };
}

/**
 * Extract a brief summary from the spec file for fallback PR body.
 */
export function extractSpecSummary(projectDir: string, specId: string): string {
  const specFile = join(projectDir, '.auto-claude', 'specs', specId, 'spec.md');
  if (!existsSync(specFile)) {
    return `Implements ${specId}`;
  }

  try {
    const content = readFileSync(specFile, 'utf-8');
    // Extract first ~500 chars after the title
    const withoutTitle = content.replace(/^#+[^\n]+\n/, '').trim();
    return withoutTitle.slice(0, 500) || `Implements ${specId}`;
  } catch {
    return `Implements ${specId}`;
  }
}

/**
 * Generate a PR description using AI. Returns null when generation fails or is empty.
 */
export async function generatePRBody(
  specId: string,
  title: string,
  baseBranch: string,
  branchName: string,
  diffSummary: string,
  commitLog: string,
  modelShorthand: ModelShorthand,
  thinkingLevel: ThinkingLevel,
): Promise<string | null> {
  const prompt = `Create a Pull Request description for the following change:

Task: ${title}
Spec ID: ${specId}
Branch: ${branchName}
Base branch: ${baseBranch}

Commit log:
${commitLog || '(no commits listed)'}

Diff summary:
${diffSummary || '(no diff available)'}

Write a professional PR description. Output ONLY the Markdown body — no preamble.`;

  try {
    const client = await createSimpleClient({
      systemPrompt: SYSTEM_PROMPT,
      modelShorthand,
      thinkingLevel,
    });

    const result = await generateText({
      model: client.model,
      system: client.systemPrompt,
      prompt,
    });

    return result.text.trim() || null;
  } catch {
    return null;
  }
}
