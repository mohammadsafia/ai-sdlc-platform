// apps/desktop/src/preload/api/modules/requirements-api.ts
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult, Task } from '../../../shared/types';
import type {
  RequirementsDone, RequirementsError, RequirementsGenerateRequest, RequirementsProgress, RequirementsSet,
} from '../../../shared/types/requirements';
import { createIpcListener, invokeIpc, type IpcListenerCleanup } from './ipc-utils';

export interface RequirementsAPI {
  requirementsRead: (projectId: string, slug: string) => Promise<IPCResult<{ set: RequirementsSet | null; currentBrdHash: string }>>;
  requirementsWrite: (projectId: string, slug: string, set: RequirementsSet) => Promise<IPCResult<RequirementsSet>>;
  requirementsApprove: (projectId: string, slug: string, set: RequirementsSet) => Promise<IPCResult<RequirementsSet>>;
  requirementsGenerate: (projectId: string, request: RequirementsGenerateRequest) => Promise<IPCResult<{ runId: string }>>;
  requirementsCancel: (runId: string) => Promise<IPCResult>;
  requirementsRelease: (projectId: string, slug: string, milestoneId: string) => Promise<IPCResult<{ set: RequirementsSet; tasks: Task[] }>>;
  onRequirementsProgress: (callback: (p: RequirementsProgress) => void) => IpcListenerCleanup;
  onRequirementsDone: (callback: (d: RequirementsDone) => void) => IpcListenerCleanup;
  onRequirementsError: (callback: (e: RequirementsError) => void) => IpcListenerCleanup;
}

export const createRequirementsAPI = (): RequirementsAPI => ({
  requirementsRead: (projectId, slug) => invokeIpc(IPC_CHANNELS.REQUIREMENTS_READ, projectId, slug),
  requirementsWrite: (projectId, slug, set) => invokeIpc(IPC_CHANNELS.REQUIREMENTS_WRITE, projectId, slug, set),
  requirementsApprove: (projectId, slug, set) => invokeIpc(IPC_CHANNELS.REQUIREMENTS_APPROVE, projectId, slug, set),
  requirementsGenerate: (projectId, request) => invokeIpc(IPC_CHANNELS.REQUIREMENTS_GENERATE, projectId, request),
  requirementsCancel: (runId) => invokeIpc(IPC_CHANNELS.REQUIREMENTS_CANCEL, runId),
  requirementsRelease: (projectId, slug, milestoneId) => invokeIpc(IPC_CHANNELS.REQUIREMENTS_RELEASE, projectId, slug, milestoneId),
  onRequirementsProgress: (callback) => createIpcListener<[RequirementsProgress]>(IPC_CHANNELS.REQUIREMENTS_PROGRESS, callback),
  onRequirementsDone: (callback) => createIpcListener<[RequirementsDone]>(IPC_CHANNELS.REQUIREMENTS_DONE, callback),
  onRequirementsError: (callback) => createIpcListener<[RequirementsError]>(IPC_CHANNELS.REQUIREMENTS_ERROR, callback),
});
