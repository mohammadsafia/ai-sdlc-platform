// apps/desktop/src/main/ipc-handlers/task/__tests__/create-task.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { invalidate } = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock('../../../project-store', () => ({ projectStore: { invalidateTasksCache: invalidate } }));

import { createTaskInProject } from '../create-task';

let dir: string;
beforeEach(() => {
  vi.clearAllMocks();
  dir = mkdtempSync(path.join(tmpdir(), 'create-task-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const project = () => ({ id: 'p1', path: dir, autoBuildPath: '.auto-claude' });

describe('createTaskInProject', () => {
  it('creates the spec directory with plan, metadata, and requirements files and returns a backlog task', () => {
    const task = createTaskInProject(project(), { title: 'Build Signup Flow!', description: 'Do it.', metadata: { category: 'feature' } });
    expect(task.specId).toBe('001-build-signup-flow');
    expect(task.id).toBe(task.specId);
    expect(task.status).toBe('backlog');
    expect(task.projectId).toBe('p1');
    expect(task.metadata).toEqual({ sourceType: 'manual', category: 'feature' });
    const specDir = path.join(dir, '.auto-claude', 'specs', '001-build-signup-flow');
    expect(task.specsPath).toBe(specDir);
    const plan = JSON.parse(readFileSync(path.join(specDir, 'implementation_plan.json'), 'utf-8'));
    expect(plan).toMatchObject({ feature: 'Build Signup Flow!', description: 'Do it.', status: 'pending', phases: [] });
    expect(JSON.parse(readFileSync(path.join(specDir, 'task_metadata.json'), 'utf-8'))).toEqual({ sourceType: 'manual', category: 'feature' });
    expect(JSON.parse(readFileSync(path.join(specDir, 'requirements.json'), 'utf-8'))).toEqual({ task_description: 'Do it.', workflow_type: 'feature' });
    expect(existsSync(path.join(specDir, 'spec.md'))).toBe(false);
    expect(invalidate).toHaveBeenCalledWith('p1');
  });

  it('numbers after the highest existing spec and keeps an explicit source type', () => {
    mkdirSync(path.join(dir, '.auto-claude', 'specs', '007-old'), { recursive: true });
    const task = createTaskInProject(project(), { title: 'Next', description: 'd', metadata: { sourceType: 'requirements', brdSlug: 'a' } });
    expect(task.specId).toBe('008-next');
    expect(task.metadata?.sourceType).toBe('requirements');
  });

  it('writes spec.md when specMarkdown is given and sanitizes thinking levels', () => {
    const task = createTaskInProject(project(), {
      title: 'Roadmap item', description: 'd', specMarkdown: '# Spec',
      metadata: { sourceType: 'roadmap', thinkingLevel: 'ultrathink' as never },
    });
    const specDir = path.join(dir, '.auto-claude', 'specs', task.specId);
    expect(readFileSync(path.join(specDir, 'spec.md'), 'utf-8')).toBe('# Spec');
    expect(task.metadata?.thinkingLevel).toBe('high');
  });
});
