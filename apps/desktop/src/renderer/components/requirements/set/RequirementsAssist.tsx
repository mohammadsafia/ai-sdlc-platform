// apps/desktop/src/renderer/components/requirements/set/RequirementsAssist.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';

import { diffSets } from '../../../../shared/brd/requirements';
import { Button } from '../../ui/button';
import { Textarea } from '../../ui/textarea';
import { useRequirementsStore } from '../../../stores/requirements-store';

export function RequirementsAssist({ projectId }: { projectId: string }) {
  const { t } = useTranslation('requirements');
  const [feedback, setFeedback] = useState('');
  const { set, selection, run, refine, accept, discard } = useRequirementsStore();
  if (!set) return null;
  const busy = run.status === 'running';
  const proposal = run.status === 'proposal' ? run.proposal : undefined;
  const counts = proposal ? diffSets(set, proposal.set) : null;

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="h-4 w-4" />
        {t('set.assist.title')}
      </div>
      <label className="block text-xs font-medium" htmlFor="req-feedback">{t('set.assist.feedbackLabel')}</label>
      <Textarea id="req-feedback" aria-label={t('set.assist.feedbackLabel')} rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder={t('set.assist.feedbackPlaceholder')} disabled={busy} />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy || feedback.trim().length === 0} onClick={() => void refine(projectId, feedback)}>
          {selection.length > 0 ? t('set.assist.refineSelected', { count: selection.length }) : t('set.assist.refineSet')}
        </Button>
        {run.error && <span className="text-xs text-destructive">{t('set.assist.error', { error: run.error })}</span>}
      </div>
      {proposal && counts && (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
          <div className="font-medium">{t('set.assist.proposalTitle')}</div>
          {proposal.changeSummary && (
            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
              <span className="font-medium">{t('set.assist.changeSummary')}: </span>
              {proposal.changeSummary}
            </p>
          )}
          <ul className="mt-2 text-xs text-muted-foreground">
            {(['requirements', 'milestones', 'tasks'] as const).map((s) => (
              <li key={s}>
                {t(`set.sections.${s}`)}: {t('set.assist.counts', { added: counts[s].added, changed: counts[s].changed, removed: counts[s].removed })}
              </li>
            ))}
          </ul>
          {proposal.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-amber-600">{proposal.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          )}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={accept}>{t('set.assist.accept')}</Button>
            <Button size="sm" variant="outline" onClick={discard}>{t('set.assist.discard')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
