// apps/desktop/src/renderer/components/design/DesignView.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type BriefSelection, setupDesignListeners, useDesignStore } from '../../stores/design-store';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { DesignBriefEditor } from './DesignBriefEditor';
import { DesignBriefEmpty } from './DesignBriefEmpty';
import { DesignBriefList } from './DesignBriefList';

export function DesignView({ projectId }: { projectId: string }) {
  const { t } = useTranslation('design');
  const { requirementsBySlug, briefs, selected, selectedSummary, load, select, reset, error } = useDesignStore();
  const [pending, setPending] = useState<BriefSelection | null>(null);

  useEffect(() => {
    const stop = setupDesignListeners();
    reset();
    void load(projectId).then(() => {
      const open = useDesignStore.getState().pendingOpen;
      if (!open) return;
      useDesignStore.setState({ pendingOpen: null });
      void select(projectId, open.brdSlug, open.requirementId, { force: true });
    });
    return stop;
  }, [projectId, load, reset, select]);

  const handleSelect = async (brdSlug: string, requirementId: string) => {
    if (useDesignStore.getState().isDirty()) {
      setPending({ brdSlug, requirementId });
      return;
    }
    await select(projectId, brdSlug, requirementId);
  };

  const requirement = selected ? requirementsBySlug[selected.brdSlug]?.requirements.find((r) => r.id === selected.requirementId) : undefined;

  return (
    <div className="grid h-full grid-cols-[300px_1fr]">
      <DesignBriefList requirementsBySlug={requirementsBySlug} briefs={briefs} selected={selected} onSelect={(s, r) => void handleSelect(s, r)} />
      <div className="min-h-0">
        {error && !selected && <p className="px-4 pt-4 text-sm text-destructive">{error}</p>}
        {selected && requirement ? (
          selectedSummary ? (
            <DesignBriefEditor projectId={projectId} requirement={requirement} />
          ) : (
            <DesignBriefEmpty projectId={projectId} requirement={requirement} />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('list.empty')}</div>
        )}
      </div>
      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('unsavedDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('unsavedDialog.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('unsavedDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const next = pending;
                setPending(null);
                if (next) void select(projectId, next.brdSlug, next.requirementId, { force: true });
              }}
            >
              {t('unsavedDialog.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
