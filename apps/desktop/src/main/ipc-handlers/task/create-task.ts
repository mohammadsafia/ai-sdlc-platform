// apps/desktop/src/main/ipc-handlers/task/create-task.ts
import path from 'path';
import { existsSync, mkdirSync, readdirSync, writeFileSync, type Dirent } from 'fs';

import { AUTO_BUILD_PATHS, getSpecsDir, VALID_THINKING_LEVELS, sanitizeThinkingLevel } from '../../../shared/constants';
import type { Task, TaskMetadata } from '../../../shared/types';
import { projectStore } from '../../project-store';

const ALLOWED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml'];

/**
 * Sanitize thinking levels in task metadata in-place.
 * Maps legacy values (e.g. 'ultrathink' → 'high') and defaults unknown values to 'medium'.
 */
export function sanitizeThinkingLevels(metadata: TaskMetadata): void {
  const isValid = (val: string): boolean => VALID_THINKING_LEVELS.includes(val as (typeof VALID_THINKING_LEVELS)[number]);

  if (metadata.thinkingLevel && !isValid(metadata.thinkingLevel)) {
    const mapped = sanitizeThinkingLevel(metadata.thinkingLevel);
    console.warn(`[TASK_CRUD] Sanitized invalid thinkingLevel "${metadata.thinkingLevel}" to "${mapped}"`);
    metadata.thinkingLevel = mapped as TaskMetadata['thinkingLevel'];
  }

  if (metadata.phaseThinking) {
    for (const phase of Object.keys(metadata.phaseThinking) as Array<keyof typeof metadata.phaseThinking>) {
      if (!isValid(metadata.phaseThinking[phase])) {
        const mapped = sanitizeThinkingLevel(metadata.phaseThinking[phase]);
        console.warn(`[TASK_CRUD] Sanitized invalid phaseThinking.${phase} "${metadata.phaseThinking[phase]}" to "${mapped}"`);
        metadata.phaseThinking[phase] = mapped as (typeof metadata.phaseThinking)[typeof phase];
      }
    }
  }
}

export interface CreateTaskInput {
  title: string;
  description: string;
  metadata?: TaskMetadata;
  /** When set, also written as spec.md (roadmap conversions do this). */
  specMarkdown?: string;
}

/** Next spec number in the project: highest existing numeric prefix + 1, or 1. */
function nextSpecNumber(specsDir: string): number {
  if (!existsSync(specsDir)) return 1;
  const numbers = readdirSync(specsDir, { withFileTypes: true })
    .filter((d: Dirent) => d.isDirectory())
    .map((d: Dirent) => {
      const match = d.name.match(/^(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter((n) => n > 0);
  return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 50);
}

/** Save base64 attachments under <specDir>/attachments and rewrite metadata to relative paths. */
function saveAttachedImages(specDir: string, metadata: TaskMetadata): void {
  if (!metadata.attachedImages || metadata.attachedImages.length === 0) return;
  const attachmentsDir = path.join(specDir, 'attachments');
  mkdirSync(attachmentsDir, { recursive: true });
  const resolvedAttachmentsDir = path.resolve(attachmentsDir);
  const saved: NonNullable<TaskMetadata['attachedImages']> = [];
  for (const image of metadata.attachedImages) {
    if (!image.data) continue;
    if (!image.mimeType || !ALLOWED_IMAGE_MIME_TYPES.includes(image.mimeType)) {
      console.warn(`[TASK_CREATE] Skipping image with missing or disallowed MIME type: ${image.mimeType}`);
      continue;
    }
    const sanitizedFilename = path.basename(image.filename);
    if (!sanitizedFilename || sanitizedFilename === '.' || sanitizedFilename === '..') {
      console.warn(`[TASK_CREATE] Skipping image with invalid filename: ${image.filename}`);
      continue;
    }
    const imagePath = path.join(attachmentsDir, sanitizedFilename);
    if (!path.resolve(imagePath).startsWith(resolvedAttachmentsDir + path.sep)) {
      console.warn(`[TASK_CREATE] Skipping image with path traversal attempt: ${image.filename}`);
      continue;
    }
    try {
      writeFileSync(imagePath, Buffer.from(image.data, 'base64'));
      saved.push({ id: image.id, filename: sanitizedFilename, mimeType: image.mimeType, size: image.size, path: `attachments/${sanitizedFilename}` });
    } catch (err) {
      console.error(`Failed to save image ${sanitizedFilename}:`, err);
    }
  }
  metadata.attachedImages = saved;
}

/**
 * Create a Kanban task on disk: spec directory, implementation_plan.json, task_metadata.json,
 * requirements.json, optional spec.md and attachments. Returns the task in `backlog`.
 * Throws on filesystem errors; callers turn that into an IPC error.
 */
export function createTaskInProject(
  project: { id: string; path: string; autoBuildPath: string },
  input: CreateTaskInput,
): Task {
  const specsDir = path.join(project.path, getSpecsDir(project.autoBuildPath));
  const specId = `${String(nextSpecNumber(specsDir)).padStart(3, '0')}-${slugify(input.title)}`;
  const specDir = path.join(specsDir, specId);
  mkdirSync(specDir, { recursive: true });

  const metadata: TaskMetadata = { sourceType: 'manual', ...input.metadata };
  saveAttachedImages(specDir, metadata);
  sanitizeThinkingLevels(metadata);

  const now = new Date().toISOString();
  writeFileSync(
    path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN),
    JSON.stringify({ feature: input.title, description: input.description, created_at: now, updated_at: now, status: 'pending', phases: [] }, null, 2),
    'utf-8',
  );
  writeFileSync(path.join(specDir, 'task_metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');

  const requirements: Record<string, unknown> = { task_description: input.description, workflow_type: metadata.category || 'feature' };
  if (metadata.attachedImages && metadata.attachedImages.length > 0) {
    requirements.attached_images = metadata.attachedImages.map((img) => ({ filename: img.filename, path: img.path, description: '' }));
  }
  writeFileSync(path.join(specDir, AUTO_BUILD_PATHS.REQUIREMENTS), JSON.stringify(requirements, null, 2), 'utf-8');
  if (input.specMarkdown !== undefined) {
    writeFileSync(path.join(specDir, AUTO_BUILD_PATHS.SPEC_FILE), input.specMarkdown, 'utf-8');
  }

  projectStore.invalidateTasksCache(project.id);

  return {
    id: specId,
    specId,
    projectId: project.id,
    title: input.title,
    description: input.description,
    status: 'backlog',
    subtasks: [],
    logs: [],
    metadata,
    specsPath: specDir,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
