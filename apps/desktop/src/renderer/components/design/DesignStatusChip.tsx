// apps/desktop/src/renderer/components/design/DesignStatusChip.tsx
import { useTranslation } from 'react-i18next';
import { PenTool } from 'lucide-react';

import { useDesignNavigation } from '../../contexts/DesignNavigationContext';
import { briefStatus, useDesignStore } from '../../stores/design-store';
import { Badge } from '../ui/badge';

const variant = { none: 'outline', draft: 'secondary', approved: 'success' } as const;

/** Brief status for a requirement; clicking opens it in the Design view when navigation is available. */
export function DesignStatusChip({ brdSlug, requirementId }: { brdSlug: string; requirementId: string }) {
  const { t } = useTranslation('design');
  const briefs = useDesignStore((s) => s.briefs);
  const navigate = useDesignNavigation();
  const status = briefStatus(briefs, brdSlug, requirementId);
  const badge = (
    <Badge variant={variant[status]} className="gap-1">
      <PenTool className="h-3 w-3" />
      {t(`status.${status}`)}
    </Badge>
  );
  if (!navigate) return badge;
  return (
    <button type="button" className="inline-flex" onClick={() => navigate(brdSlug, requirementId)} aria-label={`${t('view.title')} ${requirementId}`}>
      {badge}
    </button>
  );
}
