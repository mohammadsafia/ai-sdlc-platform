// apps/desktop/src/renderer/components/requirements/BrdList.tsx
import { useTranslation } from 'react-i18next';
import { Plus, AlertTriangle, GitCommitHorizontal } from 'lucide-react';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';
import type { BrdSummary } from '../../../shared/types/brd';

interface BrdListProps {
  brds: BrdSummary[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  onNew: () => void;
  /** Number of changed files under docs/brd; undefined hides the Commit button. */
  changeCount?: number;
  onCommit?: () => void;
}

export function BrdList({ brds, selectedSlug, onSelect, onNew, changeCount, onCommit }: BrdListProps) {
  const { t } = useTranslation('requirements');
  return (
    <div className="flex h-full flex-col border-r border-border">
      <div className="flex items-center justify-between p-3">
        <div>
          <h1 className="text-base font-semibold">{t('title')}</h1>
          <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {onCommit && (
            <Button size="sm" variant="outline" onClick={onCommit} disabled={!changeCount}>
              <GitCommitHorizontal className="mr-1 h-4 w-4" />
              {t('commit.button')}
              {changeCount ? (
                <Badge variant="secondary" className="ml-1">
                  {changeCount}
                </Badge>
              ) : null}
            </Button>
          )}
          <Button size="sm" onClick={onNew}>
            <Plus className="mr-1 h-4 w-4" />
            {t('list.newBrd')}
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {brds.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">{t('list.empty')}</p>
        ) : (
          <ul className="px-2 pb-2">
            {brds.map((b) => (
              <li key={b.slug}>
                <button
                  type="button"
                  onClick={() => onSelect(b.slug)}
                  className={cn(
                    'flex w-full flex-col items-start gap-1 rounded-md px-2 py-2 text-left hover:bg-muted/60',
                    b.slug === selectedSlug && 'bg-muted',
                  )}
                >
                  <span className="w-full truncate text-sm font-medium">{b.title}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{t(`status.${b.status}`)}</Badge>
                    {b.warning && (
                      <span className="flex items-center gap-1 text-amber-600" title={b.warning}>
                        <AlertTriangle className="h-3 w-3" />
                        {t('list.warning')}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
