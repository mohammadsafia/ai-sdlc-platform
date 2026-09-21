// apps/desktop/src/renderer/components/design/DesignBriefList.tsx
import { useTranslation } from 'react-i18next';

import type { DesignBriefSummary } from '../../../shared/types/design';
import { cn } from '../../lib/utils';
import { type BriefSelection, type RequirementsBySlug, briefStatus } from '../../stores/design-store';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';

interface DesignBriefListProps {
  requirementsBySlug: RequirementsBySlug;
  briefs: DesignBriefSummary[];
  selected: BriefSelection | null;
  onSelect: (brdSlug: string, requirementId: string) => void;
}

const variant = { none: 'outline', draft: 'secondary', approved: 'success' } as const;

export function DesignBriefList({ requirementsBySlug, briefs, selected, onSelect }: DesignBriefListProps) {
  const { t } = useTranslation('design');
  const slugs = Object.keys(requirementsBySlug);
  const total = slugs.reduce((n, s) => n + requirementsBySlug[s].requirements.length, 0);
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden border-r border-border">
      <div className="p-3">
        <h1 className="text-base font-semibold">{t('view.title')}</h1>
        <p className="text-xs text-muted-foreground">{t('view.subtitle')}</p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {slugs.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">{t('list.noSets')}</p>
        ) : total === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">{t('list.empty')}</p>
        ) : (
          slugs.map((slug) => (
            <div key={slug} className="px-2 pb-2">
              <div className="px-2 py-1 text-xs font-medium text-muted-foreground">{requirementsBySlug[slug].title}</div>
              <ul>
                {requirementsBySlug[slug].requirements.map((r) => {
                  const status = briefStatus(briefs, slug, r.id);
                  const active = selected?.brdSlug === slug && selected.requirementId === r.id;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(slug, r.id)}
                        className={cn('flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-muted/60', active && 'bg-muted')}
                      >
                        <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">{r.id}</span>
                        <span className="min-w-0 flex-1 truncate text-sm">{r.title}</span>
                        <Badge variant={variant[status]}>{t(`status.${status}`)}</Badge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </ScrollArea>
    </div>
  );
}
