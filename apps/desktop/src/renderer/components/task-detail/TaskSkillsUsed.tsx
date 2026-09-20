// apps/desktop/src/renderer/components/task-detail/TaskSkillsUsed.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../ui/badge';
import type { Task } from '../../../shared/types';

interface UsageRecord {
  name: string;
  resource?: string;
  agentType: string;
  pinned: boolean;
  at: string;
}

interface Row {
  name: string;
  agents: string[];
  pinned: boolean;
  resources: string[];
}

interface TaskSkillsUsedProps {
  task: Task;
}

function toRows(records: UsageRecord[]): Row[] {
  const byName = new Map<string, Row>();
  for (const r of records) {
    const row = byName.get(r.name) ?? { name: r.name, agents: [], pinned: false, resources: [] };
    if (!row.agents.includes(r.agentType)) row.agents.push(r.agentType);
    if (r.pinned) row.pinned = true;
    if (r.resource && !row.resources.includes(r.resource)) row.resources.push(r.resource);
    byName.set(r.name, row);
  }
  return [...byName.values()];
}

export function TaskSkillsUsed({ task }: TaskSkillsUsedProps) {
  const { t } = useTranslation('tasks');
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!task.specsPath) return;
    let cancelled = false;
    window.electronAPI.readFile(`${task.specsPath}/skills_used.json`).then((result) => {
      if (cancelled) return;
      if (!result.success || !result.data) {
        setRows([]);
        return;
      }
      try {
        const parsed: unknown = JSON.parse(result.data);
        setRows(Array.isArray(parsed) ? toRows(parsed as UsageRecord[]) : []);
      } catch {
        setRows([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [task.specsPath]);

  if (!task.specsPath || rows === null) return null;

  return (
    <div className="px-4 py-3 border-b border-border">
      <div className="text-sm font-medium mb-2">{t('tasks:skillsUsed.title')}</div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('tasks:skillsUsed.empty')}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((row) => (
            <li key={row.name} className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{row.name}</span>
              <Badge variant="outline">{row.pinned ? t('tasks:skillsUsed.pinned') : t('tasks:skillsUsed.loaded')}</Badge>
              {row.agents.map((a) => (
                <Badge key={a} variant="secondary">{a}</Badge>
              ))}
              {row.resources.map((r) => (
                <span key={r} className="text-xs text-muted-foreground">
                  {t('tasks:skillsUsed.resource')}: <span className="font-mono">{r}</span>
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
