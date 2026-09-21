// apps/desktop/src/shared/brd/__tests__/requirements.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  GeneratedBodySchema, RequirementsSetSchema, validateRequirementsSet, nextId, assignIds, mergeRefinement, diffSets,
} from '../requirements';
import type { GeneratedBody, RequirementsSet } from '../../types/requirements';

const req = (id: string, over: Partial<RequirementsSet['requirements'][number]> = {}) => ({
  id, title: `Req ${id}`, description: 'd', acceptanceCriteria: ['ac'], area: 'General', needsDesign: false, included: true, ...over,
});
const ms = (id: string, order: number, over: Partial<RequirementsSet['milestones'][number]> = {}) => ({
  id, name: `MS ${id}`, description: 'd', order, included: true, ...over,
});
const task = (id: string, milestoneId: string, requirementIds: string[], order = 1, over: Partial<RequirementsSet['tasks'][number]> = {}) => ({
  id, title: `Task ${id}`, description: 'd', milestoneId, requirementIds, category: 'feature' as const, order, included: true, ...over,
});
const set = (over: Partial<RequirementsSet> = {}): RequirementsSet => ({
  version: 1, brdSlug: 'x', brdHash: 'h', status: 'draft', generatedAt: 't',
  requirements: [req('R1'), req('R2')],
  milestones: [ms('M1', 1)],
  tasks: [task('T1', 'M1', ['R1']), task('T2', 'M1', ['R2'], 2)],
  ...over,
});

describe('schemas', () => {
  it('accepts a valid set and rejects a bad category', () => {
    expect(RequirementsSetSchema.safeParse(set()).success).toBe(true);
    expect(RequirementsSetSchema.safeParse(set({ tasks: [{ ...task('T1', 'M1', ['R1']), category: 'chore' as never }] })).success).toBe(false);
  });
  it('GeneratedBodySchema takes null ids and a null changeSummary for new items', () => {
    const body: GeneratedBody = {
      requirements: [{ id: null, title: 'a', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: true }],
      milestones: [{ id: null, name: 'm', description: 'd', order: 1 }],
      tasks: [{ id: null, title: 't', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'docs', order: 1 }],
      changeSummary: null,
    };
    expect(GeneratedBodySchema.safeParse(body).success).toBe(true);
  });
});

describe('model-facing schema', () => {
  it('emits no numeric constraints, which Anthropic structured outputs reject', () => {
    const json = JSON.stringify(z.toJSONSchema(GeneratedBodySchema));
    expect(json).not.toMatch(/exclusiveMinimum|exclusiveMaximum|"minimum"|"maximum"|"integer"/);
  });

  it('lists every property as required at every level, as OpenAI strict mode demands', () => {
    const schema = z.toJSONSchema(GeneratedBodySchema, { io: 'output' }) as Record<string, unknown>;
    const offenders: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== 'object') return;
      const n = node as Record<string, unknown>;
      if (n.type === 'object' && n.properties && typeof n.properties === 'object') {
        const keys = Object.keys(n.properties as object);
        const required = new Set((n.required as string[] | undefined) ?? []);
        for (const k of keys) if (!required.has(k)) offenders.push(`${path}.${k}`);
        for (const [k, v] of Object.entries(n.properties as object)) walk(v, `${path}.${k}`);
      }
      if (n.items) walk(n.items, `${path}[]`);
      for (const alt of (n.anyOf as unknown[] | undefined) ?? []) walk(alt, path);
    };
    walk(schema, '$');
    expect(offenders).toEqual([]);
  });

  it('assignIds normalizes order to a positive integer', () => {
    const body: GeneratedBody = {
      requirements: [],
      milestones: [{ name: 'a', description: 'd', order: 0 }, { name: 'b', description: 'd', order: 2.4 }],
      tasks: [{ title: 't', description: 'd', milestoneId: 'M1', requirementIds: [], category: 'feature', order: -3 }],
    };
    const out = assignIds(body);
    expect(out.milestones.map((m) => m.order)).toEqual([1, 2]);
    expect(out.tasks[0].order).toBe(1);
  });
});

describe('validateRequirementsSet', () => {
  it('returns no warnings for a consistent set', () => {
    expect(validateRequirementsSet(set())).toEqual([]);
  });
  it('flags every rule', () => {
    const bad = set({
      requirements: [req('R1'), req('R2', { acceptanceCriteria: [] }), req('R3'), req('R3')],
      milestones: [ms('M1', 1), ms('M2', 1), ms('M3', 3, { included: false })],
      tasks: [
        task('T1', 'M9', ['R1']),           // milestone not found
        task('T2', 'M3', ['R1'], 2),        // excluded milestone
        task('T3', 'M1', [], 3),            // no requirements
        task('T4', 'M1', ['R7'], 3),        // unknown requirement + duplicate order 3
      ],
    });
    const w = validateRequirementsSet(bad);
    expect(w.join('\n')).toContain('T1');
    expect(w.join('\n')).toContain('M9');
    expect(w.join('\n')).toContain('T2');
    expect(w.join('\n')).toContain('T3');
    expect(w.join('\n')).toContain('R7');
    expect(w.join('\n')).toContain('R2');   // no acceptance criteria and uncovered
    expect(w.join('\n')).toContain('R3');   // duplicate id
    expect(w.join('\n')).toMatch(/order 1/); // duplicate milestone order
    expect(w.join('\n')).toMatch(/order 3/); // duplicate task order in M1
  });
  it('ignores excluded items when checking coverage', () => {
    expect(validateRequirementsSet(set({ requirements: [req('R1'), req('R2', { included: false })], tasks: [task('T1', 'M1', ['R1'])] }))).toEqual([]);
  });
});

describe('nextId / assignIds', () => {
  it('nextId continues from the max numeric suffix', () => {
    expect(nextId('R', [{ id: 'R1' }, { id: 'R7' }, { id: 'M3' }])).toBe('R8');
    expect(nextId('T', [])).toBe('T1');
  });
  it('assignIds gives fresh ids, included=true, and drops unknown links with warnings', () => {
    const body: GeneratedBody = {
      requirements: [{ title: 'a', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: false }],
      milestones: [{ name: 'm', description: 'd', order: 1 }],
      tasks: [{ title: 't', description: 'd', milestoneId: 'M1', requirementIds: ['R1', 'R9'], category: 'feature', order: 1 }],
    };
    const r = assignIds(body);
    expect(r.requirements[0]).toMatchObject({ id: 'R1', included: true });
    expect(r.milestones[0]).toMatchObject({ id: 'M1', included: true });
    expect(r.tasks[0]).toMatchObject({ id: 'T1', requirementIds: ['R1'] });
    expect(r.warnings[0]).toContain('R9');
  });
  it('assignIds keeps echoed ids that exist in previous and copies their included flag', () => {
    const prev = set({ requirements: [req('R1', { included: false }), req('R2')] });
    const body: GeneratedBody = {
      requirements: [
        { id: 'R2', title: 'kept', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: false },
        { title: 'new', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: false },
      ],
      milestones: [{ id: 'M1', name: 'm', description: 'd', order: 1 }],
      tasks: [{ id: 'T1', title: 't', description: 'd', milestoneId: 'M1', requirementIds: ['R2'], category: 'feature', order: 1 }],
    };
    const r = assignIds(body, prev);
    expect(r.requirements.map((x) => x.id)).toEqual(['R2', 'R3']);
    expect(r.requirements[0].included).toBe(true);
  });
});

describe('mergeRefinement', () => {
  const prev = set();
  it('targeted: only selected ids change, everything else is verbatim from previous', () => {
    const body: GeneratedBody = {
      requirements: [
        { id: 'R1', title: 'R1 changed', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: true },
        { id: 'R2', title: 'R2 attempted change', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: true },
      ],
      milestones: [{ id: 'M1', name: 'renamed', description: 'd', order: 1 }],
      tasks: [
        { id: 'T1', title: 'Task T1', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 1 },
        { id: 'T2', title: 'Task T2', description: 'd', milestoneId: 'M1', requirementIds: ['R2'], category: 'feature', order: 2 },
      ],
      changeSummary: 'Changed R1',
    };
    const { set: merged } = mergeRefinement(prev, body, ['R1']);
    expect(merged.requirements[0]).toMatchObject({ id: 'R1', title: 'R1 changed', needsDesign: true });
    expect(merged.requirements[1]).toEqual(prev.requirements[1]);
    expect(merged.milestones[0]).toEqual(prev.milestones[0]);
    expect(merged.status).toBe('draft');
    expect(merged.brdHash).toBe('h');
  });
  it('whole-set: body applies, removed items disappear, new items get ids', () => {
    const body: GeneratedBody = {
      requirements: [{ id: 'R1', title: 'Req R1', description: 'd', acceptanceCriteria: ['ac'], area: 'General', needsDesign: false }],
      milestones: [{ id: 'M1', name: 'MS M1', description: 'd', order: 1 }, { name: 'M new', description: 'd', order: 2 }],
      tasks: [{ id: 'T1', title: 'Task T1', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 1 }],
    };
    const { set: merged } = mergeRefinement(prev, body);
    expect(merged.requirements.map((r) => r.id)).toEqual(['R1']);
    expect(merged.milestones.map((m) => m.id)).toEqual(['M1', 'M2']);
    expect(merged.tasks.map((t) => t.id)).toEqual(['T1']);
  });
});

describe('diffSets', () => {
  it('counts added, changed, removed per section', () => {
    const a = set();
    const b = set({ requirements: [{ ...req('R1'), title: 'edited' }, req('R3')], tasks: [task('T1', 'M1', ['R1'])] });
    expect(diffSets(a, b)).toEqual({
      requirements: { added: 1, changed: 1, removed: 1 },
      milestones: { added: 0, changed: 0, removed: 0 },
      tasks: { added: 0, changed: 0, removed: 1 },
    });
  });
});

describe('releases', () => {
  const releases = { M1: { releasedAt: '2026-09-21T00:00:00.000Z', tasks: [{ proposedTaskId: 'T1', specId: '001-task-t1' }] } };

  it('RequirementsSetSchema accepts a set with releases and one without', () => {
    expect(RequirementsSetSchema.safeParse(set()).success).toBe(true);
    expect(RequirementsSetSchema.safeParse(set({ releases })).success).toBe(true);
  });

  it('RequirementsSetSchema rejects a release entry with a bad proposed task id', () => {
    const bad = { M1: { releasedAt: 't', tasks: [{ proposedTaskId: 'X1', specId: 's' }] } };
    expect(RequirementsSetSchema.safeParse(set({ releases: bad as never })).success).toBe(false);
  });

  it('mergeRefinement carries releases over from previous', () => {
    const previous = set({ releases });
    const body: GeneratedBody = {
      requirements: [{ id: 'R1', title: 'r', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: false }],
      milestones: [{ id: 'M1', name: 'm', description: 'd', order: 1 }],
      tasks: [{ id: 'T1', title: 't', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 1 }],
      changeSummary: null,
    };
    expect(mergeRefinement(previous, body).set.releases).toEqual(releases);
    expect(mergeRefinement(set(), body).set.releases).toBeUndefined();
  });
});
