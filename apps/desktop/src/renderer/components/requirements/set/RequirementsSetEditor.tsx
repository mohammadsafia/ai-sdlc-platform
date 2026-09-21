// apps/desktop/src/renderer/components/requirements/set/RequirementsSetEditor.tsx
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Lock, Plus, Rocket, X } from 'lucide-react';

import { isMilestoneComplete, lockedIds as computeLockedIds, releasedTaskSpecIds, requirementRollup } from '../../../../shared/brd/release';
import { PROPOSED_TASK_CATEGORIES, type Milestone, type ProposedTask, type Requirement } from '../../../../shared/types/requirements';
import type { TaskStatus } from '../../../../shared/types/task';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Input } from '../../ui/input';
import { Textarea } from '../../ui/textarea';
import { cn } from '../../../lib/utils';
import { useRequirementsStore } from '../../../stores/requirements-store';
import { useTaskStore } from '../../../stores/task-store';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: children is always a native input, textarea, or select, so wrapping it names the control
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ItemFrame({ id, included, selected, locked, trailing, onInclude, onSelect, children }: {
  id: string; included: boolean; selected: boolean; locked: boolean; trailing?: React.ReactNode;
  onInclude: () => void; onSelect: () => void; children: React.ReactNode;
}) {
  const { t } = useTranslation('requirements');
  return (
    <div className={cn('rounded-md border border-border p-3 space-y-2', !included && 'opacity-60', locked && 'bg-muted/30')}>
      <div className="flex items-center gap-3 text-xs">
        <span className="font-mono font-medium">{id}</span>
        <span className="flex items-center gap-1">
          <Checkbox aria-label={`${t('set.fields.included')} ${id}`} checked={included} disabled={locked} onCheckedChange={onInclude} />
          {t('set.fields.included')}
        </span>
        <span className="flex items-center gap-1">
          <Checkbox aria-label={`${t('set.fields.select')} ${id}`} checked={selected} disabled={locked} onCheckedChange={onSelect} />
          {t('set.fields.select')}
        </span>
        {locked && <Badge variant="secondary" className="gap-1"><Lock className="h-3 w-3" />{t('release.locked')}</Badge>}
        {trailing}
      </div>
      {children}
    </div>
  );
}

export function RequirementsSetEditor({ projectId }: { projectId: string }) {
  const { t } = useTranslation('requirements');
  const { set, selection, edit, toggleInclude, toggleSelect, moveMilestone, release, releaseReason, isReleasing } = useRequirementsStore();
  const tasks = useTaskStore((s) => s.tasks);
  // Derived once per set: a selector returning a fresh Set each render would loop.
  const locked = useMemo(() => (set ? computeLockedIds(set) : new Set<string>()), [set]);
  if (!set) return null;

  const milestones = [...set.milestones].sort((a, b) => a.order - b.order);
  const isSelected = (id: string) => selection.includes(id);
  const specIds = releasedTaskSpecIds(set);
  const statusBySpec = new Map<string, TaskStatus>(tasks.map((task) => [task.specId, task.status]));
  const rollup = requirementRollup(set, statusBySpec);
  const isLocked = (id: string) => locked.has(id);
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString();

  const statusChip = (proposedTaskId: string) => {
    const specId = specIds.get(proposedTaskId);
    if (!specId) return null;
    const status = statusBySpec.get(specId);
    return (
      <Badge variant="outline" title={specId}>
        {status ? t(`release.status.${status}`) : t('release.statusUnavailable')}
      </Badge>
    );
  };

  const requirementCard = (r: Requirement) => {
    const lockedR = isLocked(r.id);
    const roll = rollup[r.id];
    return (
      <ItemFrame
        key={r.id} id={r.id} included={r.included} selected={isSelected(r.id)} locked={lockedR}
        trailing={roll ? <span className="text-muted-foreground">{t('release.rollup', { done: roll.done, released: roll.released })}</span> : undefined}
        onInclude={() => toggleInclude('requirements', r.id)} onSelect={() => toggleSelect(r.id)}
      >
        <Field label={t('set.fields.title')}><Input value={r.title} disabled={lockedR} onChange={(e) => edit('requirements', r.id, { title: e.target.value })} /></Field>
        <Field label={t('set.fields.description')}><Textarea rows={2} value={r.description} disabled={lockedR} onChange={(e) => edit('requirements', r.id, { description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('set.fields.area')}><Input value={r.area} disabled={lockedR} onChange={(e) => edit('requirements', r.id, { area: e.target.value })} /></Field>
          <span className="flex items-end gap-2 pb-2 text-xs">
            <Checkbox aria-label={`${t('set.fields.needsDesign')} ${r.id}`} checked={r.needsDesign} disabled={lockedR} onCheckedChange={() => edit('requirements', r.id, { needsDesign: !r.needsDesign })} />
            {t('set.fields.needsDesign')}
          </span>
        </div>
        <div className="text-xs">
          <span className="mb-1 block font-medium text-muted-foreground">{t('set.fields.acceptance')}</span>
          {r.acceptanceCriteria.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: criteria are plain strings without ids
            <div key={`${r.id}-ac-${i}`} className="mb-1 flex gap-1">
              <Input value={c} disabled={lockedR} onChange={(e) => edit('requirements', r.id, { acceptanceCriteria: r.acceptanceCriteria.map((x, j) => (j === i ? e.target.value : x)) })} />
              {!lockedR && (
                <Button size="icon" variant="ghost" aria-label="remove" onClick={() => edit('requirements', r.id, { acceptanceCriteria: r.acceptanceCriteria.filter((_, j) => j !== i) })}><X className="h-3.5 w-3.5" /></Button>
              )}
            </div>
          ))}
          {!lockedR && (
            <Button size="sm" variant="outline" onClick={() => edit('requirements', r.id, { acceptanceCriteria: [...r.acceptanceCriteria, ''] })}><Plus className="mr-1 h-3.5 w-3.5" />{t('set.fields.addCriterion')}</Button>
          )}
        </div>
      </ItemFrame>
    );
  };

  const milestoneCard = (m: Milestone, index: number) => {
    const lockedM = isLocked(m.id);
    return (
      <ItemFrame key={m.id} id={m.id} included={m.included} selected={isSelected(m.id)} locked={lockedM} onInclude={() => toggleInclude('milestones', m.id)} onSelect={() => toggleSelect(m.id)}>
        <div className="flex items-end gap-2">
          <div className="flex-1"><Field label={t('set.fields.name')}><Input value={m.name} disabled={lockedM} onChange={(e) => edit('milestones', m.id, { name: e.target.value })} /></Field></div>
          {!lockedM && (
            <>
              <Button size="icon" variant="ghost" aria-label={t('set.fields.moveUp')} disabled={index === 0} onClick={() => moveMilestone(m.id, 'up')}><ArrowUp className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" aria-label={t('set.fields.moveDown')} disabled={index === milestones.length - 1} onClick={() => moveMilestone(m.id, 'down')}><ArrowDown className="h-4 w-4" /></Button>
            </>
          )}
        </div>
        <Field label={t('set.fields.description')}><Textarea rows={2} value={m.description} disabled={lockedM} onChange={(e) => edit('milestones', m.id, { description: e.target.value })} /></Field>
      </ItemFrame>
    );
  };

  const taskCard = (task: ProposedTask) => {
    const lockedT = isLocked(task.id);
    return (
      <ItemFrame key={task.id} id={task.id} included={task.included} selected={isSelected(task.id)} locked={lockedT} trailing={statusChip(task.id)} onInclude={() => toggleInclude('tasks', task.id)} onSelect={() => toggleSelect(task.id)}>
        <Field label={t('set.fields.title')}><Input value={task.title} disabled={lockedT} onChange={(e) => edit('tasks', task.id, { title: e.target.value })} /></Field>
        <Field label={t('set.fields.description')}><Textarea rows={2} value={task.description} disabled={lockedT} onChange={(e) => edit('tasks', task.id, { description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('set.fields.category')}>
            <select className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" value={task.category} disabled={lockedT} onChange={(e) => edit('tasks', task.id, { category: e.target.value as ProposedTask['category'] })}>
              {PROPOSED_TASK_CATEGORIES.map((c) => <option key={c} value={c}>{t(`set.category.${c}`)}</option>)}
            </select>
          </Field>
          <Field label={t('set.fields.milestone')}>
            <select className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" value={task.milestoneId} disabled={lockedT} onChange={(e) => edit('tasks', task.id, { milestoneId: e.target.value })}>
              {milestones.map((m) => <option key={m.id} value={m.id}>{m.id} · {m.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="text-xs">
          <span className="mb-1 block font-medium text-muted-foreground">{t('set.fields.requirements')}</span>
          <div className="flex flex-wrap gap-1">
            {set.requirements.map((r) => {
              const on = task.requirementIds.includes(r.id);
              return (
                <button key={r.id} type="button" disabled={lockedT} onClick={() => edit('tasks', task.id, { requirementIds: on ? task.requirementIds.filter((x) => x !== r.id) : [...task.requirementIds, r.id] })}>
                  <Badge variant={on ? 'default' : 'outline'} title={r.title}>{r.id}</Badge>
                </button>
              );
            })}
          </div>
        </div>
      </ItemFrame>
    );
  };

  const milestoneHeader = (m: Milestone) => {
    const entry = set.releases?.[m.id];
    const complete = isMilestoneComplete(set, m.id);
    const reason = releaseReason(m.id);
    if (entry && complete) {
      return <Badge variant="secondary">{t('release.released', { date: fmtDate(entry.releasedAt) })}</Badge>;
    }
    return (
      <span className="flex items-center gap-2">
        {entry && <Badge variant="outline">{t('release.partial')}</Badge>}
        {reason && <span className="text-muted-foreground">{t(`release.reason.${reason}`)}</span>}
        <Button size="sm" variant="outline" disabled={!!reason || isReleasing} onClick={() => void release(projectId, m.id)}>
          <Rocket className="mr-1 h-3.5 w-3.5" />{isReleasing ? t('release.releasing') : t('release.button')}
        </Button>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold">{t('set.sections.requirements')}</h3>
        <div className="space-y-2">{set.requirements.map(requirementCard)}</div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">{t('set.sections.milestones')}</h3>
        <div className="space-y-2">{milestones.map(milestoneCard)}</div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">{t('set.sections.tasks')}</h3>
        {milestones.map((m) => (
          <div key={m.id} className="mb-3">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium text-muted-foreground">{m.id} · {m.name}</span>
              {m.included && milestoneHeader(m)}
            </div>
            <div className="space-y-2">
              {[...set.tasks].filter((x) => x.milestoneId === m.id).sort((a, b) => a.order - b.order).map(taskCard)}
            </div>
          </div>
        ))}
        {set.tasks.filter((x) => !milestones.some((m) => m.id === x.milestoneId)).map(taskCard)}
      </section>
    </div>
  );
}
