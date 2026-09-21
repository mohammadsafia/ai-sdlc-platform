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
