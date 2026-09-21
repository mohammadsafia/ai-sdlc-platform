import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertCircle, Loader2, RefreshCw } from 'lucide-react';

import { DEFAULT_JIRA_STATUS_MAP, TASK_STATUSES, type JiraStatusMap } from '../../../../shared/jira/status-map';
import type { ProjectEnvConfig } from '../../../../shared/types';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Separator } from '../../ui/separator';
import { Switch } from '../../ui/switch';
import { PasswordInput } from '../../project-settings/PasswordInput';

interface JiraIntegrationProps {
  projectId: string;
  envConfig: ProjectEnvConfig | null;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;
}

interface JiraMetadata {
  issueTypes: string[];
  statuses: string[];
}

const selectClass = 'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground';

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function JiraIntegration({ projectId, envConfig, updateEnvConfig }: JiraIntegrationProps) {
  const { t } = useTranslation('jira');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [meta, setMeta] = useState<JiraMetadata | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const enabled = envConfig?.jiraEnabled ?? false;
  const statusMap: JiraStatusMap = envConfig?.jiraStatusMap ?? DEFAULT_JIRA_STATUS_MAP;
  const issueType = envConfig?.jiraIssueType ?? 'Task';
  const epicType = envConfig?.jiraEpicIssueType ?? 'Epic';

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    const r = await window.electronAPI.jiraCheckConnection(projectId);
    setTesting(false);
    if (!r.success || !r.data) {
      setTestResult({ ok: false, message: r.error ?? 'Unknown error' });
      return;
    }
    setTestResult({
      ok: true,
      message: r.data.projectName
        ? t('settings.connectedProject', { name: r.data.accountName, project: r.data.projectName })
        : t('settings.connected', { name: r.data.accountName }),
    });
  };

  const loadMeta = async () => {
    setLoadingMeta(true);
    setMetaError(null);
    const r = await window.electronAPI.jiraGetMetadata(projectId);
    setLoadingMeta(false);
    if (!r.success || !r.data) {
      setMetaError(r.error ?? 'Unknown error');
      return;
    }
    setMeta(r.data);
  };

  const setStatus = (status: (typeof TASK_STATUSES)[number], value: string) => {
    updateEnvConfig({ jiraStatusMap: { ...statusMap, [status]: value === '' ? null : value } });
  };

  const typeOptions = (current: string) => unique([current, ...(meta?.issueTypes ?? [])]);
  const statusOptions = (current: string | null) =>
    unique([...(current ? [current] : []), ...(meta?.statuses ?? [])]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="font-normal text-foreground">{t('settings.enable')}</Label>
          <p className="text-xs text-muted-foreground">{t('settings.enableHint')}</p>
        </div>
        <Switch checked={enabled} onCheckedChange={(checked) => updateEnvConfig({ jiraEnabled: checked })} />
      </div>

      {enabled && (
        <>
          <div className="space-y-2">
            <Label htmlFor="jira-base-url">{t('settings.baseUrl')}</Label>
            <Input
              id="jira-base-url"
              value={envConfig?.jiraBaseUrl ?? ''}
              placeholder={t('settings.baseUrlPlaceholder')}
              onChange={(e) => updateEnvConfig({ jiraBaseUrl: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="jira-email">{t('settings.email')}</Label>
            <Input
              id="jira-email"
              value={envConfig?.jiraEmail ?? ''}
              onChange={(e) => updateEnvConfig({ jiraEmail: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('settings.apiToken')}</Label>
            <p className="text-xs text-muted-foreground">{t('settings.apiTokenHint')}</p>
            <PasswordInput
              value={envConfig?.jiraApiToken ?? ''}
              onChange={(value) => updateEnvConfig({ jiraApiToken: value })}
              placeholder="ATATT3x…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="jira-project-key">{t('settings.projectKey')}</Label>
            <Input
              id="jira-project-key"
              value={envConfig?.jiraProjectKey ?? ''}
              placeholder="ACME"
              onChange={(e) => updateEnvConfig({ jiraProjectKey: e.target.value.toUpperCase() })}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" disabled={testing} onClick={() => void test()}>
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {testing ? t('settings.testing') : t('settings.test')}
            </Button>
            {testResult && (
              <span
                className={`flex items-center gap-1 text-xs ${testResult.ok ? 'text-success' : 'text-destructive'}`}
              >
                {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                {testResult.message}
              </span>
            )}
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <Label className="font-medium">{t('settings.statusMap')}</Label>
            <Button size="sm" variant="ghost" disabled={loadingMeta} onClick={() => void loadMeta()}>
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loadingMeta ? 'animate-spin' : ''}`} />
              {t('settings.loadMetadata')}
            </Button>
          </div>
          {metaError && <p className="text-xs text-destructive">{metaError}</p>}

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs">
              <span className="mb-1 block text-muted-foreground">{t('settings.issueType')}</span>
              <select
                aria-label={t('settings.issueType')}
                className={selectClass}
                value={issueType}
                onChange={(e) => updateEnvConfig({ jiraIssueType: e.target.value })}
              >
                {typeOptions(issueType).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-muted-foreground">{t('settings.epicIssueType')}</span>
              <select
                aria-label={t('settings.epicIssueType')}
                className={selectClass}
                value={epicType}
                onChange={(e) => updateEnvConfig({ jiraEpicIssueType: e.target.value })}
              >
                {typeOptions(epicType).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="text-xs text-muted-foreground">{t('settings.statusMapHint')}</p>
          <div className="grid grid-cols-2 gap-2">
            {TASK_STATUSES.map((status) => (
              <label key={status} className="block text-xs">
                <span className="mb-1 block text-muted-foreground">{t(`settings.kanbanStatus.${status}`)}</span>
                <select
                  aria-label={t(`settings.kanbanStatus.${status}`)}
                  className={selectClass}
                  value={statusMap[status] ?? ''}
                  onChange={(e) => setStatus(status, e.target.value)}
                >
                  <option value="">{t('settings.notSynced')}</option>
                  {statusOptions(statusMap[status]).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
