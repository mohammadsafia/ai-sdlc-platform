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
  const body =
    (await generatePRBody(cfg.specId, cfg.title, destination, cfg.branchName, diffSummary, commitLog, modelShorthand, thinkingLevel)) ||
    extractSpecSummary(cfg.projectDir, cfg.specId);

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
