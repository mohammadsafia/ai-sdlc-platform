// apps/desktop/src/shared/jira/__tests__/push.test.ts
import { describe, it, expect } from 'vitest';
import type { RequirementsSet } from '../../types/requirements';
import { buildEpicFields, buildTaskFields, isMilestonePushed, pendingPushTasks } from '../push';

const set = (jira?: { epicKey: string; issues: Record<string, string>; pushedAt: string }): RequirementsSet => ({
  version: 1, brdSlug: 'a', brdHash: 'H', status: 'approved', generatedAt: 't',
  requirements: [], tasks: [],
  milestones: [{ id: 'M1', name: 'Core', description: 'Core UI', order: 1, included: true }],
  releases: { M1: { releasedAt: 't', tasks: [{ proposedTaskId: 'T1', specId: '001-a' }, { proposedTaskId: 'T2', specId: '002-b' }], ...(jira ? { jira } : {}) } },
});

describe('push helpers', () => {
  it('lists released tasks without an issue key and detects a complete push', () => {
    expect(pendingPushTasks(set(), 'M1').map((t) => t.specId)).toEqual(['001-a', '002-b']);
    const partial = set({ epicKey: 'ACME-1', issues: { T1: 'ACME-2' }, pushedAt: 't' });
    expect(pendingPushTasks(partial, 'M1').map((t) => t.specId)).toEqual(['002-b']);
    expect(isMilestonePushed(partial, 'M1')).toBe(false);
    expect(isMilestonePushed(set({ epicKey: 'ACME-1', issues: { T1: 'ACME-2', T2: 'ACME-3' }, pushedAt: 't' }), 'M1')).toBe(true);
    expect(pendingPushTasks(set(), 'M9')).toEqual([]);
  });
  it('builds epic and task fields', () => {
    const epic = buildEpicFields('ACME', 'Epic', set().milestones[0]);
    expect(epic.fields).toMatchObject({ project: { key: 'ACME' }, summary: 'Core', issuetype: { name: 'Epic' } });
    expect(epic.fields.parent).toBeUndefined();
    const task = buildTaskFields('ACME', 'Task', 'ACME-1', 'Build form', '# Do it');
    expect(task.fields).toMatchObject({ project: { key: 'ACME' }, summary: 'Build form', issuetype: { name: 'Task' }, parent: { key: 'ACME-1' } });
    expect(task.fields.description.content[0].type).toBe('heading');
  });
});
