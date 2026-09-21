// apps/desktop/src/main/ipc-handlers/task/create-task-pr.ts
import { createPR } from '../../ai/runners/github/pr-creator';
import type { CreatePRResult } from '../../ai/runners/pr-common';
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
  toolPath: (name: 'gh' | 'git') => string;
}

const defaultDeps: TaskPRDeps = {
  detect: detectBitbucketRepo,
  getConfig: getBitbucketConfig,
  bitbucket: createBitbucketPR,
  github: createPR,
  toolPath: (name) => getToolPath(name),
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
