// apps/desktop/src/renderer/components/task-detail/TaskRequirements.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList, ExternalLink } from 'lucide-react';

import type { Task } from '../../../shared/types';
import type { RequirementsSet } from '../../../shared/types/requirements';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

interface TaskRequirementsProps {
  task: Task;
  onOpenBrd?: (slug: string) => void;
}

interface Loaded {
  brdTitle: string;
  set: RequirementsSet;
}

/** Where a released task came from: BRD, milestone, and the requirements it covers. */
export function TaskRequirements({ task, onOpenBrd }: TaskRequirementsProps) {
  const { t } = useTranslation('tasks');
  const slug = task.metadata?.brdSlug;
  const [data, setData] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    Promise.all([window.electronAPI.brdRead(task.projectId, slug), window.electronAPI.requirementsRead(task.projectId, slug)])
      .then(([brd, req]) => {
        if (cancelled) return;
        if (!brd.success || !brd.data || !req.success || !req.data?.set) {
          setData(null);
          return;
        }
        setData({ brdTitle: brd.data.summary.title, set: req.data.set });
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [task.projectId, slug]);

  if (!slug || !data) return null;

  const milestone = data.set.milestones.find((m) => m.id === task.metadata?.milestoneId);
  const covered = data.set.requirements.filter((r) => task.metadata?.requirementIds?.includes(r.id));

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ClipboardList className="h-4 w-4" />
          {t('tasks:requirementsSection.title')}
        </div>
        {onOpenBrd && (
          <Button size="sm" variant="outline" onClick={() => onOpenBrd(slug)}>
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            {t('tasks:requirementsSection.openBrd')}
          </Button>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t('tasks:requirementsSection.brd')}</dt>
        <dd>{data.brdTitle}</dd>
        {milestone && (
          <>
            <dt className="text-muted-foreground">{t('tasks:requirementsSection.milestone')}</dt>
            <dd>{milestone.name}</dd>
          </>
        )}
        <dt className="text-muted-foreground">{t('tasks:requirementsSection.covers')}</dt>
        <dd>
          <ul className="space-y-1">
            {covered.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono">{r.id}</Badge>
                <span>{r.title}</span>
              </li>
            ))}
          </ul>
        </dd>
      </dl>
    </div>
  );
}
