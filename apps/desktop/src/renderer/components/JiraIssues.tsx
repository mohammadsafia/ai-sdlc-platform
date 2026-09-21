import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Import, Loader2, RefreshCw, Settings } from 'lucide-react';

import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { useJiraIssuesStore } from '../stores/jira/issues-store';
import { useProjectEnvStore } from '../stores/project-env-store';
import { useProjectStore } from '../stores/project-store';

interface JiraIssuesProps {
  onOpenSettings: () => void;
}

export function JiraIssues({ onOpenSettings }: JiraIssuesProps) {
  const { t } = useTranslation('jira');
  const projectId = useProjectStore((s) => s.selectedProjectId);
  const envConfig = useProjectEnvStore((s) => s.envConfig);
  const store = useJiraIssuesStore();
  const { filters, selection, isLoading, isImporting, error, lastImport, nextPageToken } = store;
  const enabled = !!envConfig?.jiraEnabled;
  const visible = store.visibleIssues();

  const load = useJiraIssuesStore((s) => s.load);
  const reset = useJiraIssuesStore((s) => s.reset);
  useEffect(() => {
    if (projectId && enabled) void load(projectId);
    return () => reset();
  }, [projectId, enabled, load, reset]);

  if (!enabled) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-sm text-muted-foreground">
        <p>{t('view.notConnected')}</p>
        <Button size="sm" variant="outline" onClick={onOpenSettings}>
          <Settings className="mr-2 h-4 w-4" />
          {t('view.openSettings')}
        </Button>
      </div>
    );
  }
  if (!projectId) return null;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('view.title')}</h2>
          <p className="text-xs text-muted-foreground">
            {t('view.subtitle', { project: envConfig?.jiraProjectKey ?? '' })}
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={isLoading} onClick={() => void store.load(projectId)}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          {t('view.refresh')}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Input
          aria-label={t('view.statusFilter')}
          placeholder={t('view.anyStatus')}
          value={filters.status}
          onChange={(e) => store.setFilter({ status: e.target.value })}
          onBlur={() => void store.load(projectId)}
        />
        <Input
          aria-label={t('view.jql')}
          placeholder={t('view.jqlPlaceholder')}
          value={filters.jql}
          onChange={(e) => store.setFilter({ jql: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void store.load(projectId);
          }}
        />
        <Input
          aria-label={t('view.search')}
          placeholder={t('view.search')}
          value={filters.search}
          onChange={(e) => store.setFilter({ search: e.target.value })}
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
      {lastImport && (
        <p className="text-xs text-muted-foreground">
          {t('view.importResult', {
            imported: lastImport.imported,
            skipped: lastImport.skipped.length,
            failed: lastImport.failed.length,
          })}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        {visible.length === 0 && !isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">{t('view.empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((issue) => (
              <li key={issue.key} className="flex items-center gap-3 px-3 py-2 text-sm text-foreground">
                <Checkbox
                  aria-label={issue.key}
                  checked={selection.includes(issue.key)}
                  disabled={issue.imported}
                  onCheckedChange={() => store.toggle(issue.key)}
                />
                <span className="w-24 shrink-0 font-mono text-xs">{issue.key}</span>
                <span className="min-w-0 flex-1 truncate">{issue.summary}</span>
                <Badge variant="outline">{issue.status}</Badge>
                {issue.imported && <Badge variant="secondary">{t('view.imported')}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between">
        <Button
          size="sm"
          variant="ghost"
          disabled={!nextPageToken || isLoading}
          onClick={() => void store.loadMore(projectId)}
        >
          {t('view.loadMore')}
        </Button>
        <Button
          size="sm"
          disabled={selection.length === 0 || isImporting}
          onClick={() => void store.importSelected(projectId)}
        >
          {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Import className="mr-2 h-4 w-4" />}
          {isImporting ? t('view.importing') : t('view.import', { count: selection.length })}
        </Button>
      </div>
    </div>
  );
}
