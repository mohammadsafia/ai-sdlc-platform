// apps/desktop/src/renderer/components/design/DesignAssistPanel.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Loader2, Sparkles } from 'lucide-react';

import { cn } from '../../lib/utils';
import { useDesignStore } from '../../stores/design-store';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Textarea } from '../ui/textarea';

export function DesignAssistPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation('design');
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const { draft, startDraft, cancelDraft, acceptDraft, discardDraft } = useDesignStore();
  const streaming = draft.status === 'streaming';
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border border-border">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-muted/50">
          <ChevronRight className={cn('h-4 w-4 transition-transform', open && 'rotate-90')} />
          <Sparkles className="h-4 w-4" />
          {t('assist.title')}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-3 pb-3">
        <label className="block text-xs font-medium" htmlFor="design-assist-notes">
          {t('assist.notesLabel')}
        </label>
        <Textarea
          id="design-assist-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('assist.notesPlaceholder')}
          disabled={streaming}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={!notes.trim() || streaming} onClick={() => void startDraft(projectId, 'revise', notes)}>
            {t('assist.revise')}
          </Button>
          {streaming && (
            <>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('assist.streaming')}
              </span>
              <Button size="sm" variant="ghost" onClick={() => void cancelDraft()}>
                {t('assist.cancel')}
              </Button>
            </>
          )}
        </div>
        {draft.error && <p className="text-xs text-destructive">{t('assist.error', { error: draft.error })}</p>}
        {(streaming || draft.status === 'proposal') && draft.text && (
          <div className="rounded-md border border-border bg-muted/30 p-2">
            <div className="mb-1 text-xs font-medium">{t('assist.proposalTitle')}</div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs">{draft.text}</pre>
            {draft.status === 'proposal' && (
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => void acceptDraft(projectId)}>
                  {t('assist.accept')}
                </Button>
                <Button size="sm" variant="outline" onClick={discardDraft}>
                  {t('assist.discard')}
                </Button>
              </div>
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
