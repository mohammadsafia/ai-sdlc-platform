// apps/desktop/src/preload/api/modules/design-api.ts
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import type {
  DesignBriefStatus,
  DesignBriefSummary,
  DesignDraftChunk,
  DesignDraftDone,
  DesignDraftError,
  DesignDraftRequest,
} from '../../../shared/types/design';
import { createIpcListener, invokeIpc, type IpcListenerCleanup } from './ipc-utils';

export interface DesignAPI {
  designList: (projectId: string) => Promise<IPCResult<DesignBriefSummary[]>>;
  designRead: (projectId: string, brdSlug: string, requirementId: string) => Promise<IPCResult<{ summary: DesignBriefSummary; content: string }>>;
  designWrite: (projectId: string, brdSlug: string, requirementId: string, content: string) => Promise<IPCResult<DesignBriefSummary>>;
  designCreate: (projectId: string, brdSlug: string, requirementId: string) => Promise<IPCResult<DesignBriefSummary>>;
  designSetStatus: (projectId: string, brdSlug: string, requirementId: string, status: DesignBriefStatus) => Promise<IPCResult<DesignBriefSummary>>;
  designDraft: (projectId: string, request: DesignDraftRequest) => Promise<IPCResult<{ runId: string }>>;
  designDraftCancel: (runId: string) => Promise<IPCResult>;
  onDesignDraftChunk: (callback: (chunk: DesignDraftChunk) => void) => IpcListenerCleanup;
  onDesignDraftDone: (callback: (done: DesignDraftDone) => void) => IpcListenerCleanup;
  onDesignDraftError: (callback: (error: DesignDraftError) => void) => IpcListenerCleanup;
}

export const createDesignAPI = (): DesignAPI => ({
  designList: (projectId) => invokeIpc(IPC_CHANNELS.DESIGN_LIST, projectId),
  designRead: (projectId, brdSlug, requirementId) => invokeIpc(IPC_CHANNELS.DESIGN_READ, projectId, brdSlug, requirementId),
  designWrite: (projectId, brdSlug, requirementId, content) => invokeIpc(IPC_CHANNELS.DESIGN_WRITE, projectId, brdSlug, requirementId, content),
  designCreate: (projectId, brdSlug, requirementId) => invokeIpc(IPC_CHANNELS.DESIGN_CREATE, projectId, brdSlug, requirementId),
  designSetStatus: (projectId, brdSlug, requirementId, status) => invokeIpc(IPC_CHANNELS.DESIGN_SET_STATUS, projectId, brdSlug, requirementId, status),
  designDraft: (projectId, request) => invokeIpc(IPC_CHANNELS.DESIGN_DRAFT, projectId, request),
  designDraftCancel: (runId) => invokeIpc(IPC_CHANNELS.DESIGN_DRAFT_CANCEL, runId),
  onDesignDraftChunk: (callback) => createIpcListener<[DesignDraftChunk]>(IPC_CHANNELS.DESIGN_DRAFT_CHUNK, callback),
  onDesignDraftDone: (callback) => createIpcListener<[DesignDraftDone]>(IPC_CHANNELS.DESIGN_DRAFT_DONE, callback),
  onDesignDraftError: (callback) => createIpcListener<[DesignDraftError]>(IPC_CHANNELS.DESIGN_DRAFT_ERROR, callback),
});
