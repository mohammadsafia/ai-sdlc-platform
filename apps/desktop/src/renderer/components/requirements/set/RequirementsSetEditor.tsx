// apps/desktop/src/renderer/components/requirements/set/RequirementsSetEditor.tsx
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';

import { PROPOSED_TASK_CATEGORIES, type Milestone, type ProposedTask, type Requirement } from '../../../../shared/types/requirements';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Input } from '../../ui/input';
import { Textarea } from '../../ui/textarea';
import { cn } from '../../../lib/utils';
import { useRequirementsStore } from '../../../stores/requirements-store';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: children is always a native input, textarea, or select, so wrapping it names the control
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ItemFrame({ id, included, selected, onInclude, onSelect, children }: {
  id: string; included: boolean; selected: boolean; onInclude: () => void; onSelect: () => void; children: React.ReactNode;
}) {
  const { t } = useTranslation('requirements');
  return (
    <div className={cn('rounded-md border border-border p-3 space-y-2', !included && 'opacity-60')}>
      <div className="flex items-center gap-3 text-xs">
        <span className="font-mono font-medium">{id}</span>
        <span className="flex items-center gap-1">
          <Checkbox aria-label={`${t('set.fields.included')} ${id}`} checked={included} onCheckedChange={onInclude} />
          {t('set.fields.included')}
        </span>
        <span className="flex items-center gap-1">
          <Checkbox aria-label={`${t('set.fields.select')} ${id}`} checked={selected} onCheckedChange={onSelect} />
          {t('set.fields.select')}
        </span>
      </div>
      {children}
    </div>
  );
}

export function RequirementsSetEditor() {
  const { t } = useTranslation('requirements');
  const { set, selection, edit, toggleInclude, toggleSelect, moveMilestone } = useRequirementsStore();
  if (!set) return null;
  const milestones = [...set.milestones].sort((a, b) => a.order - b.order);
  const isSelected = (id: string) => selection.includes(id);

  const requirementCard = (r: Requirement) => (
    <ItemFrame key={r.id} id={r.id} included={r.included} selected={isSelected(r.id)} onInclude={() => toggleInclude('requirements', r.id)} onSelect={() => toggleSelect(r.id)}>
      <Field label={t('set.fields.title')}><Input value={r.title} onChange={(e) => edit('requirements', r.id, { title: e.target.value })} /></Field>
      <Field label={t('set.fields.description')}><Textarea rows={2} value={r.description} onChange={(e) => edit('requirements', r.id, { description: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('set.fields.area')}><Input value={r.area} onChange={(e) => edit('requirements', r.id, { area: e.target.value })} /></Field>
        <span className="flex items-end gap-2 pb-2 text-xs">
          <Checkbox aria-label={`${t('set.fields.needsDesign')} ${r.id}`} checked={r.needsDesign} onCheckedChange={() => edit('requirements', r.id, { needsDesign: !r.needsDesign })} />
          {t('set.fields.needsDesign')}
        </span>
      </div>
      <div className="text-xs">
        <span className="mb-1 block font-medium text-muted-foreground">{t('set.fields.acceptance')}</span>
        {r.acceptanceCriteria.map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: criteria are plain strings without ids
          <div key={`${r.id}-ac-${i}`} className="mb-1 flex gap-1">
            <Input value={c} onChange={(e) => edit('requirements', r.id, { acceptanceCriteria: r.acceptanceCriteria.map((x, j) => (j === i ? e.target.value : x)) })} />
            <Button size="icon" variant="ghost" aria-label="remove" onClick={() => edit('requirements', r.id, { acceptanceCriteria: r.acceptanceCriteria.filter((_, j) => j !== i) })}><X className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => edit('requirements', r.id, { acceptanceCriteria: [...r.acceptanceCriteria, ''] })}><Plus className="mr-1 h-3.5 w-3.5" />{t('set.fields.addCriterion')}</Button>
      </div>
    </ItemFrame>
  );

  const milestoneCard = (m: Milestone, index: number) => (
    <ItemFrame key={m.id} id={m.id} included={m.included} selected={isSelected(m.id)} onInclude={() => toggleInclude('milestones', m.id)} onSelect={() => toggleSelect(m.id)}>
      <div className="flex items-end gap-2">
        <div className="flex-1"><Field label={t('set.fields.name')}><Input value={m.name} onChange={(e) => edit('milestones', m.id, { name: e.target.value })} /></Field></div>
        <Button size="icon" variant="ghost" aria-label={t('set.fields.moveUp')} disabled={index === 0} onClick={() => moveMilestone(m.id, 'up')}><ArrowUp className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" aria-label={t('set.fields.moveDown')} disabled={index === milestones.length - 1} onClick={() => moveMilestone(m.id, 'down')}><ArrowDown className="h-4 w-4" /></Button>
      </div>
      <Field label={t('set.fields.description')}><Textarea rows={2} value={m.description} onChange={(e) => edit('milestones', m.id, { description: e.target.value })} /></Field>
    </ItemFrame>
  );

  const taskCard = (task: ProposedTask) => (
    <ItemFrame key={task.id} id={task.id} included={task.included} selected={isSelected(task.id)} onInclude={() => toggleInclude('tasks', task.id)} onSelect={() => toggleSelect(task.id)}>
      <Field label={t('set.fields.title')}><Input value={task.title} onChange={(e) => edit('tasks', task.id, { title: e.target.value })} /></Field>
      <Field label={t('set.fields.description')}><Textarea rows={2} value={task.description} onChange={(e) => edit('tasks', task.id, { description: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('set.fields.category')}>
          <select className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" value={task.category} onChange={(e) => edit('tasks', task.id, { category: e.target.value as ProposedTask['category'] })}>
            {PROPOSED_TASK_CATEGORIES.map((c) => <option key={c} value={c}>{t(`set.category.${c}`)}</option>)}
          </select>
        </Field>
        <Field label={t('set.fields.milestone')}>
          <select className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" value={task.milestoneId} onChange={(e) => edit('tasks', task.id, { milestoneId: e.target.value })}>
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
              <button key={r.id} type="button" onClick={() => edit('tasks', task.id, { requirementIds: on ? task.requirementIds.filter((x) => x !== r.id) : [...task.requirementIds, r.id] })}>
                <Badge variant={on ? 'default' : 'outline'} title={r.title}>{r.id}</Badge>
              </button>
            );
          })}
        </div>
      </div>
    </ItemFrame>
  );

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
            <div className="mb-1 text-xs font-medium text-muted-foreground">{m.id} · {m.name}</div>
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
