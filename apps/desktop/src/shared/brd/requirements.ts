// apps/desktop/src/shared/brd/requirements.ts
import { z } from 'zod';

import {
  PROPOSED_TASK_CATEGORIES,
  type GeneratedBody,
  type Milestone,
  type ProposedTask,
  type Requirement,
  type RequirementsSet,
  type SectionCounts,
  type SectionDiff,
} from '../types/requirements';

const idSchema = z.string().regex(/^[RMT]\d+$/);
/**
 * Model-facing schema rules: Anthropic structured outputs reject integer/min/max constraints,
 * and OpenAI strict mode requires every property to be present, so optional fields are
 * expressed as nullable (`T | null`) rather than omitted.
 */
const orderForModel = z.number().describe('Position, starting at 1');
/** On disk: a positive integer. */
const orderStored = z.number().int().positive();

const requirementBody = z.object({
  id: idSchema.nullable(),
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string().min(1)),
  area: z.string().min(1),
  needsDesign: z.boolean(),
});
const milestoneBody = z.object({
  id: idSchema.nullable(),
  name: z.string().min(1),
  description: z.string(),
  order: orderForModel,
});
const taskBody = z.object({
  id: idSchema.nullable(),
  title: z.string().min(1),
  description: z.string(),
  milestoneId: z.string().min(1),
  requirementIds: z.array(z.string()),
  category: z.enum(PROPOSED_TASK_CATEGORIES as [string, ...string[]]),
  order: orderForModel,
});

export const GeneratedBodySchema = z.object({
  requirements: z.array(requirementBody),
  milestones: z.array(milestoneBody),
  tasks: z.array(taskBody),
  changeSummary: z.string().nullable(),
});

export const RequirementsSetSchema = z.object({
  version: z.literal(1),
  brdSlug: z.string().min(1),
  brdHash: z.string().min(1),
  status: z.enum(['draft', 'approved']),
  generatedAt: z.string().min(1),
  approvedAt: z.string().optional(),
  requirements: z.array(requirementBody.extend({ id: idSchema, included: z.boolean() })),
  milestones: z.array(milestoneBody.extend({ id: idSchema, included: z.boolean(), order: orderStored })),
  tasks: z.array(taskBody.extend({ id: idSchema, included: z.boolean(), order: orderStored })),
});

export function nextId(prefix: 'R' | 'M' | 'T', existing: Array<{ id: string }>): string {
  let max = 0;
  for (const { id } of existing) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

export function validateRequirementsSet(set: RequirementsSet): string[] {
  const w: string[] = [];
  const dupes = (items: Array<{ id: string }>) => {
    const seen = new Set<string>();
    for (const { id } of items) {
      if (seen.has(id)) w.push(`Duplicate id ${id}`);
      seen.add(id);
    }
  };
  dupes(set.requirements);
  dupes(set.milestones);
  dupes(set.tasks);

  const includedReq = new Map(set.requirements.filter((r) => r.included).map((r) => [r.id, r]));
  const includedMs = new Map(set.milestones.filter((m) => m.included).map((m) => [m.id, m]));
  const allReq = new Set(set.requirements.map((r) => r.id));
  const allMs = new Set(set.milestones.map((m) => m.id));

  for (const r of set.requirements) {
    if (r.included && r.acceptanceCriteria.length === 0) w.push(`Requirement ${r.id} has no acceptance criteria`);
  }

  const covered = new Set<string>();
  for (const t of set.tasks.filter((t) => t.included)) {
    if (!allMs.has(t.milestoneId)) w.push(`Task ${t.id} points at milestone ${t.milestoneId}, which does not exist`);
    else if (!includedMs.has(t.milestoneId)) w.push(`Task ${t.id} points at milestone ${t.milestoneId}, which is excluded`);
    if (t.requirementIds.length === 0) w.push(`Task ${t.id} covers no requirement`);
    for (const rid of t.requirementIds) {
      if (!allReq.has(rid)) w.push(`Task ${t.id} references requirement ${rid}, which does not exist`);
      else if (!includedReq.has(rid)) w.push(`Task ${t.id} references requirement ${rid}, which is excluded`);
      else covered.add(rid);
    }
  }
  for (const r of includedReq.values()) {
    if (!covered.has(r.id)) w.push(`Requirement ${r.id} is not covered by any included task`);
  }

  const msOrders = new Map<number, string>();
  for (const m of includedMs.values()) {
    const prev = msOrders.get(m.order);
    if (prev) w.push(`Milestones ${prev} and ${m.id} share order ${m.order}`);
    msOrders.set(m.order, m.id);
  }
  const taskOrders = new Map<string, string>();
  for (const t of set.tasks.filter((t) => t.included)) {
    const key = `${t.milestoneId}:${t.order}`;
    const prev = taskOrders.get(key);
    if (prev) w.push(`Tasks ${prev} and ${t.id} share order ${t.order} in milestone ${t.milestoneId}`);
    taskOrders.set(key, t.id);
  }
  return w;
}

interface Assigned {
  requirements: Requirement[];
  milestones: Milestone[];
  tasks: ProposedTask[];
  warnings: string[];
}

/** Give every item an id (keeping echoed ids that exist in `previous`), set/copy `included`, drop unknown links. */
export function assignIds(body: GeneratedBody, previous?: RequirementsSet): Assigned {
  const warnings: string[] = [];
  const order = (n: number) => (Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1);
  const prevReq = new Map(previous?.requirements.map((r) => [r.id, r]) ?? []);
  const prevMs = new Map(previous?.milestones.map((m) => [m.id, m]) ?? []);
  const prevTask = new Map(previous?.tasks.map((t) => [t.id, t]) ?? []);

  const requirements: Requirement[] = [];
  for (const r of body.requirements) {
    const keep = r.id && prevReq.has(r.id) ? prevReq.get(r.id) : undefined;
    const id = keep ? keep.id : nextId('R', [...requirements, ...prevReq.values()]);
    requirements.push({ ...r, id, included: keep ? keep.included : true });
  }
  const milestones: Milestone[] = [];
  for (const m of body.milestones) {
    const keep = m.id && prevMs.has(m.id) ? prevMs.get(m.id) : undefined;
    const id = keep ? keep.id : nextId('M', [...milestones, ...prevMs.values()]);
    milestones.push({ ...m, id, order: order(m.order), included: keep ? keep.included : true });
  }
  const reqIds = new Set(requirements.map((r) => r.id));
  const msIds = new Set(milestones.map((m) => m.id));
  const tasks: ProposedTask[] = [];
  for (const t of body.tasks) {
    const keep = t.id && prevTask.has(t.id) ? prevTask.get(t.id) : undefined;
    const id = keep ? keep.id : nextId('T', [...tasks, ...prevTask.values()]);
    const requirementIds = t.requirementIds.filter((rid) => {
      if (reqIds.has(rid)) return true;
      warnings.push(`Task ${id} referenced unknown requirement ${rid}; the link was dropped`);
      return false;
    });
    if (!msIds.has(t.milestoneId)) warnings.push(`Task ${id} points at unknown milestone ${t.milestoneId}`);
    tasks.push({ ...t, id, requirementIds, category: t.category as ProposedTask['category'], order: order(t.order), included: keep ? keep.included : true });
  }
  return { requirements, milestones, tasks, warnings };
}

/**
 * Apply a refinement body to `previous`. With `selection`, only those ids may change;
 * all other items come verbatim from `previous`. Without it, the body replaces the set.
 */
export function mergeRefinement(
  previous: RequirementsSet,
  body: GeneratedBody,
  selection?: string[],
): { set: RequirementsSet; warnings: string[] } {
  const assigned = assignIds(body, previous);
  const warnings = [...assigned.warnings];

  let requirements = assigned.requirements;
  let milestones = assigned.milestones;
  let tasks = assigned.tasks;

  if (selection && selection.length > 0) {
    const sel = new Set(selection);
    const pick = <T extends { id: string }>(prevItems: T[], nextItems: T[]): T[] => {
      const nextById = new Map(nextItems.map((i) => [i.id, i]));
      const out: T[] = prevItems.map((p) => (sel.has(p.id) && nextById.has(p.id) ? (nextById.get(p.id) as T) : p));
      for (const n of nextItems) if (!prevItems.some((p) => p.id === n.id)) out.push(n); // brand-new items are always allowed
      return out;
    };
    requirements = pick(previous.requirements, requirements);
    milestones = pick(previous.milestones, milestones);
    tasks = pick(previous.tasks, tasks);
  }

  const set: RequirementsSet = {
    version: 1,
    brdSlug: previous.brdSlug,
    brdHash: previous.brdHash,
    status: 'draft',
    generatedAt: previous.generatedAt,
    requirements,
    milestones,
    tasks,
  };
  return { set, warnings };
}

function countDiff<T extends { id: string }>(a: T[], b: T[]): SectionCounts {
  const aBy = new Map(a.map((i) => [i.id, i]));
  const bBy = new Map(b.map((i) => [i.id, i]));
  let added = 0;
  let changed = 0;
  let removed = 0;
  for (const [id, item] of bBy) {
    if (!aBy.has(id)) added++;
    else if (JSON.stringify(aBy.get(id)) !== JSON.stringify(item)) changed++;
  }
  for (const id of aBy.keys()) if (!bBy.has(id)) removed++;
  return { added, changed, removed };
}

export function diffSets(a: RequirementsSet, b: RequirementsSet): SectionDiff {
  return {
    requirements: countDiff(a.requirements, b.requirements),
    milestones: countDiff(a.milestones, b.milestones),
    tasks: countDiff(a.tasks, b.tasks),
  };
}
