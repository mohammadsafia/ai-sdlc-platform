// apps/desktop/src/renderer/components/requirements/set/RequirementsTab.tsx
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { useRequirementsStore } from '../../../stores/requirements-store';
import { RequirementsAssist } from './RequirementsAssist';
import { RequirementsSetEditor } from './RequirementsSetEditor';

interface RequirementsTabProps {
  projectId: string;
  brdReady: boolean;
  missingSections: string[];
}

export function RequirementsTab({ projectId, brdReady, missingSections }: RequirementsTabProps) {
  const { t } = useTranslation('requirements');
  const store = useRequirementsStore();
  const { set, warnings, run, isSaving, error, generate, regenerate, cancel, save, approve } = store;
  const dirty = useRequirementsStore((s) => JSON.stringify(s.set) !== JSON.stringify(s.savedSet));
  const stale = useRequirementsStore((s) => !!s.set && s.set.brdHash !== s.currentBrdHash);
  const canApprove = !!set && set.status !== 'approved' && !dirty && warnings.length === 0;

  if (run.status === 'running') {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <div>{t('set.running')}</div>
        <div>{run.phase ? t(`set.phase.${run.phase}`) : null}</div>
        <Button size="sm" variant="outline" onClick={() => void cancel()}>{t('set.cancel')}</Button>
      </div>
    );
  }

  if (!set) {
    return (
      <div className="space-y-3 p-6 text-sm">
        <p className="text-muted-foreground">{t('set.none')}</p>
        {!brdReady && (
          <p className="text-amber-600">{t('set.notReady')} {missingSections.join(', ')}</p>
        )}
        {run.error && <p className="text-destructive">{t('set.error', { error: run.error })}</p>}
        <Button size="sm" disabled={!brdReady} onClick={() => void generate(projectId)}>{t('set.generate')}</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {stale && (
        <div className="flex items-center justify-between rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
          <span>{t('set.stale')}</span>
          <Button size="sm" variant="outline" onClick={() => void regenerate(projectId)}>{t('set.regenerate')}</Button>
        </div>
      )}
      {(error || run.error) && <p className="text-xs text-destructive">{t('set.error', { error: error ?? run.error })}</p>}

      <div className="min-h-0 flex-1 overflow-auto pr-1">
        <RequirementsSetEditor />
        <div className="mt-4"><RequirementsAssist projectId={projectId} /></div>
      </div>

      <div className="sticky bottom-0 space-y-2 border-t border-border bg-background pt-3">
        {warnings.length > 0 && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
            <div className="flex items-center gap-1 font-medium"><AlertTriangle className="h-3.5 w-3.5" />{t('set.warnings')}</div>
            <ul className="mt-1 list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{t(`set.status.${set.status}`)}</Badge>
            <span>{dirty ? t('set.unsaved') : t('set.saved')}</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={!dirty || isSaving} onClick={() => void save(projectId)}>{isSaving ? t('set.saving') : t('set.save')}</Button>
            <Button size="sm" disabled={!canApprove || isSaving} onClick={() => void approve(projectId)}>{isSaving ? t('set.approving') : t('set.approve')}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
