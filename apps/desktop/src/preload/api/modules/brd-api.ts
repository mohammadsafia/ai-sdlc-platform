// apps/desktop/src/preload/api/modules/brd-api.ts
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import type { BrdChanges, BrdCommitResult, BrdDraftChunk, BrdDraftDone, BrdDraftError, BrdDraftRequest, BrdSummary } from '../../../shared/types/brd';
import { createIpcListener, invokeIpc, type IpcListenerCleanup } from './ipc-utils';

export interface BrdAPI {
  brdList: (projectId: string) => Promise<IPCResult<BrdSummary[]>>;
  brdRead: (projectId: string, slug: string) => Promise<IPCResult<{ summary: BrdSummary; content: string }>>;
  brdWrite: (projectId: string, slug: string, content: string) => Promise<IPCResult<BrdSummary>>;
  brdCreate: (projectId: string, title: string) => Promise<IPCResult<BrdSummary>>;
  brdDraft: (projectId: string, request: BrdDraftRequest) => Promise<IPCResult<{ runId: string }>>;
  brdDraftCancel: (runId: string) => Promise<IPCResult>;
  brdChanges: (projectId: string) => Promise<IPCResult<BrdChanges>>;
  brdCommit: (projectId: string, message: string, push: boolean) => Promise<IPCResult<BrdCommitResult>>;
  onBrdDraftChunk: (callback: (chunk: BrdDraftChunk) => void) => IpcListenerCleanup;
  onBrdDraftDone: (callback: (done: BrdDraftDone) => void) => IpcListenerCleanup;
  onBrdDraftError: (callback: (error: BrdDraftError) => void) => IpcListenerCleanup;
}

export const createBrdAPI = (): BrdAPI => ({
  brdList: (projectId) => invokeIpc(IPC_CHANNELS.BRD_LIST, projectId),
  brdRead: (projectId, slug) => invokeIpc(IPC_CHANNELS.BRD_READ, projectId, slug),
  brdWrite: (projectId, slug, content) => invokeIpc(IPC_CHANNELS.BRD_WRITE, projectId, slug, content),
  brdCreate: (projectId, title) => invokeIpc(IPC_CHANNELS.BRD_CREATE, projectId, title),
  brdDraft: (projectId, request) => invokeIpc(IPC_CHANNELS.BRD_DRAFT, projectId, request),
  brdDraftCancel: (runId) => invokeIpc(IPC_CHANNELS.BRD_DRAFT_CANCEL, runId),
  brdChanges: (projectId) => invokeIpc(IPC_CHANNELS.BRD_CHANGES, projectId),
  brdCommit: (projectId, message, push) => invokeIpc(IPC_CHANNELS.BRD_COMMIT, projectId, message, push),
  onBrdDraftChunk: (callback) => createIpcListener<[BrdDraftChunk]>(IPC_CHANNELS.BRD_DRAFT_CHUNK, callback),
  onBrdDraftDone: (callback) => createIpcListener<[BrdDraftDone]>(IPC_CHANNELS.BRD_DRAFT_DONE, callback),
  onBrdDraftError: (callback) => createIpcListener<[BrdDraftError]>(IPC_CHANNELS.BRD_DRAFT_ERROR, callback),
});
