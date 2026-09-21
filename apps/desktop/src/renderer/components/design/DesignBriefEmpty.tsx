// apps/desktop/src/renderer/components/design/DesignBriefEmpty.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FilePlus, Loader2, Sparkles } from 'lucide-react';

import type { Requirement } from '../../../shared/types/requirements';
import { useDesignStore } from '../../stores/design-store';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';

export function DesignBriefEmpty({ projectId, requirement }: { projectId: string; requirement: Requirement }) {
  const { t } = useTranslation('design');
  const [notes, setNotes] = useState('');
  const { draft, create, startDraft, cancelDraft, acceptDraft, discardDraft, error } = useDesignStore();
  const streaming = draft.status === 'streaming';
  const failure = error ?? draft.error;
  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div>
        <h2 className="text-lg font-semibold">{t('empty.title', { id: requirement.id })}</h2>
        <p className="text-sm font-medium">{requirement.title}</p>
        <p className="text-sm text-muted-foreground">{requirement.description}</p>
      </div>
      <div className="text-sm">
        <div className="mb-1 font-medium">{t('empty.acceptance')}</div>
        <ul className="list-disc pl-5">
          {requirement.acceptanceCriteria.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
      <label className="text-xs font-medium" htmlFor="design-empty-notes">
        {t('empty.notes')}
      </label>
      <Textarea
        id="design-empty-notes"
        rows={4}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={t('empty.notesPlaceholder')}
        disabled={streaming}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={streaming} onClick={() => void create(projectId)}>
          <FilePlus className="mr-1 h-4 w-4" />
          {t('empty.createFromTemplate')}
        </Button>
        <Button size="sm" disabled={streaming} onClick={() => void startDraft(projectId, 'draft', notes)}>
          <Sparkles className="mr-1 h-4 w-4" />
          {t('empty.draftWithAi')}
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
      {failure && <p className="text-xs text-destructive">{t('assist.error', { error: failure })}</p>}
      {(streaming || draft.status === 'proposal') && draft.text && (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted/30 p-2">
          <div className="mb-1 text-xs font-medium">{t('assist.proposalTitle')}</div>
          <pre className="whitespace-pre-wrap font-mono text-xs">{draft.text}</pre>
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
    </div>
  );
}
