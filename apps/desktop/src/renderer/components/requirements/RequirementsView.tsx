// apps/desktop/src/renderer/components/requirements/RequirementsView.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../ui/alert-dialog';
import { setupBrdListeners, useBrdStore } from '../../stores/brd-store';
import { BrdEditor } from './BrdEditor';
import { BrdList } from './BrdList';
import { NewBrdDialog } from './NewBrdDialog';

export function RequirementsView({ projectId }: { projectId: string }) {
  const { t } = useTranslation('requirements');
  const { brds, selectedSlug, load, select, create, reset, error } = useBrdStore();
  const [showNew, setShowNew] = useState(false);
  /** Slug to open after the user discards changes; '__new__' opens the New BRD dialog. */
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);

  useEffect(() => {
    const stop = setupBrdListeners();
    reset();
    void load(projectId);
    return () => {
      stop();
    };
  }, [projectId, load, reset]);

  const handleSelect = async (slug: string) => {
    const ok = await select(projectId, slug);
    if (!ok && useBrdStore.getState().isDirty()) setPendingSlug(slug);
  };

  return (
    <div className="grid h-full grid-cols-[280px_1fr]">
      <BrdList
        brds={brds}
        selectedSlug={selectedSlug}
        onSelect={(s) => void handleSelect(s)}
        onNew={() => (useBrdStore.getState().isDirty() ? setPendingSlug('__new__') : setShowNew(true))}
      />
      <div className="min-h-0">
        {error && !selectedSlug && <p className="px-4 pt-4 text-sm text-destructive">{error}</p>}
        {selectedSlug ? (
          <BrdEditor projectId={projectId} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('editor.noSelection')}</div>
        )}
      </div>

      <NewBrdDialog
        open={showNew}
        onOpenChange={setShowNew}
        onCreate={async (title) => {
          await create(projectId, title);
        }}
      />

      <AlertDialog open={pendingSlug !== null} onOpenChange={(open) => !open && setPendingSlug(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('unsavedDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('unsavedDialog.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('unsavedDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const slug = pendingSlug;
                setPendingSlug(null);
                if (slug === '__new__') {
                  useBrdStore.setState((s) => ({ content: s.savedContent, structure: s.structure }));
                  setShowNew(true);
                } else if (slug) {
                  void select(projectId, slug, { force: true });
                }
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
