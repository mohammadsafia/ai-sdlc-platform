import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Loader2, Search } from 'lucide-react';

import type { ProjectEnvConfig } from '../../../../shared/types';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { PasswordInput } from '../../project-settings/PasswordInput';

interface BitbucketIntegrationProps {
  projectId: string;
  envConfig: ProjectEnvConfig | null;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;
}

export function BitbucketIntegration({ projectId, envConfig, updateEnvConfig }: BitbucketIntegrationProps) {
  const { t } = useTranslation('bitbucket');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectMessage, setDetectMessage] = useState<string | null>(null);

  const enabled = envConfig?.bitbucketEnabled ?? false;

  const toggle = (checked: boolean) => {
    const updates: Partial<ProjectEnvConfig> = { bitbucketEnabled: checked };
    if (checked && !envConfig?.bitbucketEmail && envConfig?.jiraEmail) updates.bitbucketEmail = envConfig.jiraEmail;
    updateEnvConfig(updates);
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    const r = await window.electronAPI.bitbucketCheckConnection(projectId);
    setTesting(false);
    if (!r.success || !r.data) {
      setTestResult({ ok: false, message: r.error ?? 'Unknown error' });
      return;
    }
    setTestResult({
      ok: true,
      message: r.data.repoName
        ? t('settings.connectedRepo', { name: r.data.accountName, repo: r.data.repoName })
        : t('settings.connected', { name: r.data.accountName }),
    });
  };

  const detect = async () => {
    setDetecting(true);
    setDetectMessage(null);
    const r = await window.electronAPI.bitbucketDetectRepo(projectId);
    setDetecting(false);
    if (!r.success) {
      setDetectMessage(r.error ?? 'Unknown error');
      return;
    }
    if (!r.data) {
      setDetectMessage(t('settings.detectNone'));
      return;
    }
    updateEnvConfig({ bitbucketWorkspace: r.data.workspace, bitbucketRepoSlug: r.data.repoSlug });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="font-normal text-foreground">{t('settings.enable')}</Label>
          <p className="text-xs text-muted-foreground">{t('settings.enableHint')}</p>
        </div>
        <Switch checked={enabled} onCheckedChange={toggle} />
      </div>

      {enabled && (
        <>
          <div className="space-y-2">
            <Label htmlFor="bitbucket-email">{t('settings.email')}</Label>
            <Input
              id="bitbucket-email"
              value={envConfig?.bitbucketEmail ?? ''}
              onChange={(e) => updateEnvConfig({ bitbucketEmail: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('settings.apiToken')}</Label>
            <p className="text-xs text-muted-foreground">{t('settings.apiTokenHint')}</p>
            <PasswordInput
              value={envConfig?.bitbucketApiToken ?? ''}
              onChange={(value) => updateEnvConfig({ bitbucketApiToken: value })}
              placeholder="ATATT3x…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="bitbucket-workspace">{t('settings.workspace')}</Label>
              <Input
                id="bitbucket-workspace"
                value={envConfig?.bitbucketWorkspace ?? ''}
                placeholder="acme"
                onChange={(e) => updateEnvConfig({ bitbucketWorkspace: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bitbucket-repo">{t('settings.repoSlug')}</Label>
              <Input
                id="bitbucket-repo"
                value={envConfig?.bitbucketRepoSlug ?? ''}
                placeholder="todo"
                onChange={(e) => updateEnvConfig({ bitbucketRepoSlug: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="ghost" disabled={detecting} onClick={() => void detect()}>
              <Search className="mr-2 h-3.5 w-3.5" />
              {t('settings.detect')}
            </Button>
            {detectMessage && <span className="text-xs text-muted-foreground">{detectMessage}</span>}
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" disabled={testing} onClick={() => void test()}>
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {testing ? t('settings.testing') : t('settings.test')}
            </Button>
            {testResult && (
              <span className={`flex items-center gap-1 text-xs ${testResult.ok ? 'text-success' : 'text-destructive'}`}>
                {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                {testResult.message}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
