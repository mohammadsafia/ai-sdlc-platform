// apps/desktop/src/shared/brd/__tests__/release.test.ts
import { describe, it, expect } from 'vitest';
import type { RequirementsSet } from '../../types/requirements';
import type { TaskStatus } from '../../types/task';
import {
  buildReleaseTaskInput, includedTasksOf, isMilestoneComplete, lockedIds, nextReleasableMilestone,
  releaseGate, releasedTaskSpecIds, requirementRollup, RELEASE_CATEGORY,
} from '../release';

const base = (over: Partial<RequirementsSet> = {}): RequirementsSet => ({
  version: 1, brdSlug: 'todo-app', brdHash: 'H', status: 'approved', generatedAt: 't', approvedAt: 't',
  requirements: [
    { id: 'R1', title: 'Add todos', description: 'Users add todos.', acceptanceCriteria: ['Form validates', 'Item appears'], area: 'Core', needsDesign: false, included: true },
    { id: 'R2', title: 'Persist', description: 'Persist locally.', acceptanceCriteria: ['Survives reload'], area: 'Storage', needsDesign: false, included: true },
    { id: 'R3', title: 'Excluded', description: 'x', acceptanceCriteria: ['y'], area: 'Core', needsDesign: false, included: false },
  ],
  milestones: [
    { id: 'M1', name: 'Core', description: 'Core UI', order: 1, included: true },
    { id: 'M2', name: 'Storage', description: 'Persistence', order: 2, included: true },
    { id: 'M3', name: 'Skipped', description: 'excluded', order: 3, included: false },
  ],
  tasks: [
    { id: 'T1', title: 'Build form', description: 'Form and list.', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 2, included: true },
    { id: 'T2', title: 'Refactor state', description: 'State.', milestoneId: 'M1', requirementIds: ['R1'], category: 'refactor', order: 1, included: true },
    { id: 'T3', title: 'Excluded task', description: 'x', milestoneId: 'M1', requirementIds: ['R1'], category: 'bug', order: 3, included: false },
    { id: 'T4', title: 'Save to storage', description: 'Persist.', milestoneId: 'M2', requirementIds: ['R2'], category: 'feature', order: 1, included: true },
  ],
  ...over,
});
const fullM1 = { M1: { releasedAt: 't', tasks: [{ proposedTaskId: 'T2', specId: '001-refactor-state' }, { proposedTaskId: 'T1', specId: '002-build-form' }] } };
const partialM1 = { M1: { releasedAt: 't', tasks: [{ proposedTaskId: 'T2', specId: '001-refactor-state' }] } };

describe('includedTasksOf / releasedTaskSpecIds', () => {
  it('returns included tasks of a milestone sorted by order', () => {
    expect(includedTasksOf(base(), 'M1').map((t) => t.id)).toEqual(['T2', 'T1']);
  });
  it('maps released proposed tasks to spec ids across milestones', () => {
    const m = releasedTaskSpecIds(base({ releases: { ...fullM1, M2: { releasedAt: 't', tasks: [{ proposedTaskId: 'T4', specId: '003-save' }] } } }));
    expect([...m.entries()]).toEqual([['T2', '001-refactor-state'], ['T1', '002-build-form'], ['T4', '003-save']]);
  });
});

describe('isMilestoneComplete / nextReleasableMilestone', () => {
  it('is complete only when every included task has a spec id', () => {
    expect(isMilestoneComplete(base(), 'M1')).toBe(false);
    expect(isMilestoneComplete(base({ releases: partialM1 }), 'M1')).toBe(false);
    expect(isMilestoneComplete(base({ releases: fullM1 }), 'M1')).toBe(true);
  });
  it('next is the lowest-order included incomplete milestone, skipping excluded ones', () => {
    expect(nextReleasableMilestone(base())?.id).toBe('M1');
    expect(nextReleasableMilestone(base({ releases: partialM1 }))?.id).toBe('M1');
    expect(nextReleasableMilestone(base({ releases: fullM1 }))?.id).toBe('M2');
    const all = { ...fullM1, M2: { releasedAt: 't', tasks: [{ proposedTaskId: 'T4', specId: '003-save' }] } };
    expect(nextReleasableMilestone(base({ releases: all }))).toBeNull();
  });
});

describe('lockedIds', () => {
  it('locks released tasks, milestones with an entry, and fully covered requirements', () => {
    expect([...lockedIds(base())]).toEqual([]);
    const partial = lockedIds(base({ releases: partialM1 }));
    expect(partial.has('T2')).toBe(true);
    expect(partial.has('M1')).toBe(true);
    expect(partial.has('T1')).toBe(false);
    expect(partial.has('R1')).toBe(false); // T1 still covers R1 and is not released
    const full = lockedIds(base({ releases: fullM1 }));
    expect(full.has('R1')).toBe(true);
    expect(full.has('R2')).toBe(false);
    expect(full.has('T3')).toBe(false); // excluded tasks never lock
  });
});

describe('requirementRollup', () => {
  it('counts released covering tasks and how many are done', () => {
    const statuses = new Map<string, TaskStatus>([['001-refactor-state', 'done'], ['002-build-form', 'in_progress']]);
    expect(requirementRollup(base({ releases: fullM1 }), statuses)).toEqual({ R1: { released: 2, done: 1 } });
    expect(requirementRollup(base(), statuses)).toEqual({});
  });
  it('counts a released task with no local status as released but not done', () => {
    expect(requirementRollup(base({ releases: partialM1 }), new Map())).toEqual({ R1: { released: 1, done: 0 } });
  });
});

describe('releaseGate', () => {
  const ok = base();
  it('returns null when everything holds', () => {
    expect(releaseGate(ok, ok, 'H', 'M1')).toBeNull();
  });
  it('reports each failing reason in priority order', () => {
    expect(releaseGate(null, null, 'H', 'M1')).toBe('noSet');
    expect(releaseGate(base({ status: 'draft' }), base({ status: 'draft' }), 'H', 'M1')).toBe('notApproved');
    expect(releaseGate({ ...ok, tasks: [...ok.tasks] }, base({ requirements: [] }), 'H', 'M1')).toBe('dirty');
    expect(releaseGate(ok, ok, 'OTHER', 'M1')).toBe('stale');
    expect(releaseGate(ok, ok, 'H', 'M2')).toBe('notNext');
    const done = base({ releases: fullM1 });
    expect(releaseGate(done, done, 'H', 'M1')).toBe('complete');
    expect(releaseGate(done, done, 'H', 'M2')).toBeNull();
  });
});

describe('buildReleaseTaskInput', () => {
  it('assembles title, description, and link metadata', () => {
    const set = base();
    const input = buildReleaseTaskInput(set, set.tasks[0], 'Todo app');
    expect(input.title).toBe('Build form');
    expect(input.description).toContain('Form and list.');
    expect(input.description).toContain('## Requirements covered');
    expect(input.description).toContain('### R1: Add todos');
    expect(input.description).toContain('- [ ] Form validates');
    expect(input.description).toContain('Source: BRD "Todo app" (docs/brd/todo-app.md), milestone Core, requirements set docs/brd/todo-app.requirements.json');
    expect(input.metadata).toEqual({
      sourceType: 'requirements', brdSlug: 'todo-app', milestoneId: 'M1', requirementIds: ['R1'], proposedTaskId: 'T1',
      category: 'feature', acceptanceCriteria: ['Form validates', 'Item appears'],
    });
  });
  it('maps every proposed category', () => {
    expect(RELEASE_CATEGORY).toEqual({ feature: 'feature', bug: 'bug_fix', refactor: 'refactoring', docs: 'documentation' });
  });
});
