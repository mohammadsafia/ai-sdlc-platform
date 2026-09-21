import { describe, it, expect } from 'vitest';
import { needsDesignWithoutApprovedBrief } from '../release';
import type { RequirementsSet } from '../../types/requirements';

const set = {
  brdSlug: 'todo-app',
  requirements: [
    { id: 'R1', needsDesign: true, included: true },
    { id: 'R2', needsDesign: false, included: true },
    { id: 'R3', needsDesign: true, included: true },
    { id: 'R4', needsDesign: true, included: true },
  ],
  milestones: [],
  tasks: [
    { id: 'T1', milestoneId: 'M1', requirementIds: ['R1', 'R2'], included: true },
    { id: 'T2', milestoneId: 'M1', requirementIds: ['R3'], included: false },
    { id: 'T3', milestoneId: 'M2', requirementIds: ['R4'], included: true },
  ],
} as unknown as RequirementsSet;

describe('needsDesignWithoutApprovedBrief', () => {
  it('lists needsDesign requirements of the milestone that lack an approved brief', () => {
    const briefs = [
      { brdSlug: 'todo-app', requirementId: 'R1', status: 'draft' as const, title: '', modifiedAt: '' },
      { brdSlug: 'other', requirementId: 'R4', status: 'approved' as const, title: '', modifiedAt: '' },
    ];
    expect(needsDesignWithoutApprovedBrief(set, 'M1', briefs)).toEqual(['R1']);
    expect(needsDesignWithoutApprovedBrief(set, 'M2', briefs)).toEqual(['R4']);
    expect(needsDesignWithoutApprovedBrief(set, 'M2', [{ ...briefs[1], brdSlug: 'todo-app' }])).toEqual([]);
  });
});
