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
