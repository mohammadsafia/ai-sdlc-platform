import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, RefreshCw } from 'lucide-react';

import type { Task } from '../../../shared/types';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

/** Jira link, epic, last synced status, and a retry for a failed transition. */
export function TaskJira({ task }: { task: Task }) {
  const { t } = useTranslation('jira');
  const key = task.metadata?.jiraKey;
  const [retrying, setRetrying] = useState(false);
  const [syncError, setSyncError] = useState<string | undefined>(task.metadata?.jiraSyncError);
  if (!key) return null;

  const retry = async () => {
    setRetrying(true);
    const r = await window.electronAPI.jiraRetrySync(task.projectId, task.specId ?? task.id);
    setRetrying(false);
    if (r.success && r.data) setSyncError(r.data.synced ? undefined : r.data.error);
    else setSyncError(r.error);
  };

  const openIssue = () => {
    const url = task.metadata?.jiraUrl;
    if (url) void window.electronAPI.openExternal(url);
  };

  return (
    <div className="rounded-lg border border-border p-4 space-y-2 text-sm text-foreground">
      <div className="font-medium">{t('detail.title')}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">{t('detail.issue')}</dt>
        <dd>
          <button
            type="button"
            className="inline-flex items-center gap-1 font-mono text-info hover:underline"
            onClick={openIssue}
          >
            {key}
            <ExternalLink className="h-3 w-3" />
          </button>
        </dd>
        {task.metadata?.jiraEpicKey && (
          <>
            <dt className="text-muted-foreground">{t('detail.epic')}</dt>
            <dd className="font-mono">{task.metadata.jiraEpicKey}</dd>
          </>
        )}
        {task.metadata?.jiraSyncedStatus && (
          <>
            <dt className="text-muted-foreground">{t('detail.syncedStatus')}</dt>
            <dd>
              <Badge variant="outline">{task.metadata.jiraSyncedStatus}</Badge>
            </dd>
          </>
        )}
        {syncError && (
          <>
            <dt className="text-muted-foreground">{t('detail.syncError')}</dt>
            <dd className="flex items-center gap-2 text-destructive">
              <span>{syncError}</span>
              <Button size="sm" variant="outline" disabled={retrying} onClick={() => void retry()}>
                <RefreshCw className={`mr-1 h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} />
                {retrying ? t('detail.retrying') : t('detail.retry')}
              </Button>
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
