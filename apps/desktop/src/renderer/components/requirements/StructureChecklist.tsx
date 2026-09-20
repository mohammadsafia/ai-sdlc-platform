// apps/desktop/src/renderer/components/requirements/StructureChecklist.tsx
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertCircle, Circle } from 'lucide-react';

import type { BrdStructureResult } from '../../../shared/types/brd';
import { cn } from '../../lib/utils';

export function StructureChecklist({ result }: { result: BrdStructureResult | null }) {
  const { t } = useTranslation('requirements');
  if (!result) return null;
  return (
    <div className="rounded-md border border-border p-3 text-xs">
      <div className="mb-2 font-medium">{t('structure.title')}</div>
      {result.frontmatterErrors.length > 0 && (
        <div className="mb-2 flex items-start gap-2 text-amber-600">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {t('structure.frontmatter')}: {result.frontmatterErrors.join('; ')}
          </span>
        </div>
      )}
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
        {result.sections.map((s) => {
          const good = s.present && !s.empty;
          const Icon = good ? CheckCircle2 : s.required ? AlertCircle : Circle;
          return (
            <li key={s.heading} className={cn('flex items-center gap-2', good ? 'text-foreground' : s.required ? 'text-amber-600' : 'text-muted-foreground')}>
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{s.heading}</span>
              {!s.required && <span className="text-muted-foreground">({t('structure.optional')})</span>}
              {!good && s.required && (
                <span className="flex items-center gap-1">
                  <span aria-hidden="true">·</span>
                  <span>{s.present ? t('structure.emptySection') : t('structure.missing')}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {result.ok && <div className="mt-2 text-green-600">{t('structure.ok')}</div>}
    </div>
  );
}
