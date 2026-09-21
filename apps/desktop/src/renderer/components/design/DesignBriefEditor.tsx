// apps/desktop/src/renderer/components/design/DesignBriefEditor.tsx
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CheckCircle2, Save, Undo2 } from 'lucide-react';

import { parseFrontmatter } from '../../../shared/frontmatter';
import type { Requirement } from '../../../shared/types/requirements';
import { useDesignStore } from '../../stores/design-store';
import { StructureChecklist } from '../requirements/StructureChecklist';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { DesignAssistPanel } from './DesignAssistPanel';

export function DesignBriefEditor({ projectId, requirement }: { projectId: string; requirement: Requirement }) {
  const { t } = useTranslation('design');
  const { selectedSummary, content, setContent, structure, save, setStatus, isSaving, error } = useDesignStore();
  const dirty = useDesignStore((s) => s.content !== s.savedContent);
  if (!selectedSummary) return null;
  const approved = selectedSummary.status === 'approved';
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{selectedSummary.title}</h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{requirement.id}</span>
            <Badge variant={approved ? 'success' : 'secondary'}>{t(`status.${selectedSummary.status}`)}</Badge>
            <span>{dirty ? t('editor.unsaved') : t('editor.saved')}</span>
            {error && <span className="text-destructive">{t('editor.saveError', { error })}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={approved ? 'outline' : 'default'}
            disabled={dirty || isSaving}
            onClick={() => void setStatus(projectId, approved ? 'draft' : 'approved')}
          >
            {approved ? <Undo2 className="mr-2 h-4 w-4" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            {approved ? t('editor.unapprove') : t('editor.approve')}
          </Button>
          <Button size="sm" disabled={!dirty || isSaving} onClick={() => void save(projectId)}>
            <Save className="mr-2 h-4 w-4" />
            {isSaving ? t('editor.saving') : t('editor.save')}
          </Button>
        </div>
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
        <section
          className="h-full overflow-auto rounded-md border border-border p-3 prose prose-sm dark:prose-invert max-w-none"
          aria-label={t('editor.preview')}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{parseFrontmatter(content)?.body ?? content}</ReactMarkdown>
        </section>
      </div>
      <DesignAssistPanel projectId={projectId} />
    </div>
  );
}
