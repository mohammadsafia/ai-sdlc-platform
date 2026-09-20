// apps/desktop/src/renderer/components/requirements/BrdEditor.tsx
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Save } from 'lucide-react';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { useBrdStore } from '../../stores/brd-store';
import { BrdAssistPanel } from './BrdAssistPanel';
import { StructureChecklist } from './StructureChecklist';

/** A document counts as empty when every required section is empty (fresh template). */
function documentIsEmpty(structure: ReturnType<typeof useBrdStore.getState>['structure']): boolean {
  if (!structure) return true;
  return structure.sections.filter((s) => s.required).every((s) => s.empty);
}

export function BrdEditor({ projectId }: { projectId: string }) {
  const { t } = useTranslation('requirements');
  const { selectedSummary, content, setContent, structure, save, isSaving, error } = useBrdStore();
  const dirty = useBrdStore((s) => s.content !== s.savedContent);
  if (!selectedSummary) return null;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{selectedSummary.title}</h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{t(`status.${selectedSummary.status}`)}</Badge>
            <span>{dirty ? t('editor.unsaved') : t('editor.saved')}</span>
            {error && <span className="text-destructive">{t('editor.saveError', { error })}</span>}
          </div>
        </div>
        <Button size="sm" disabled={!dirty || isSaving} onClick={() => void save(projectId)}>
          <Save className="mr-2 h-4 w-4" />
          {isSaving ? t('editor.saving') : t('editor.save')}
        </Button>
      </div>

      <StructureChecklist result={structure} />

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <textarea
          aria-label={t('editor.markdown')}
          className="h-full w-full resize-none rounded-md border border-border bg-background p-3 font-mono text-xs leading-5 focus:outline-none focus:ring-1 focus:ring-ring"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
        />
        <section className="h-full overflow-auto rounded-md border border-border p-3 prose prose-sm dark:prose-invert max-w-none" aria-label={t('editor.preview')}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </section>
      </div>

      <BrdAssistPanel projectId={projectId} documentIsEmpty={documentIsEmpty(structure)} />
    </div>
  );
}
