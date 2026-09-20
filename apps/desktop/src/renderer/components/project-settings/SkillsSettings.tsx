// apps/desktop/src/renderer/components/project-settings/SkillsSettings.tsx
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, AlertTriangle } from 'lucide-react';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { useSkillsStore } from '../../stores/skills-store';

interface SkillsSettingsProps {
  projectId: string;
}

export function SkillsSettings({ projectId }: SkillsSettingsProps) {
  const { t } = useTranslation('settings');
  const { snapshot, isLoading, error, load, refresh } = useSkillsStore();

  useEffect(() => {
    void load(projectId);
  }, [projectId, load]);

  const pinsFor = (name: string): string[] =>
    Object.entries(snapshot?.pins ?? {})
      .filter(([, names]) => names.includes(name))
      .map(([target]) => target);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t('projectSections.skills.howTo')}</p>
        <Button variant="outline" size="sm" onClick={() => void refresh(projectId)} disabled={isLoading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {isLoading ? t('projectSections.skills.refreshing') : t('projectSections.skills.refresh')}
        </Button>
      </div>

      {(error || snapshot?.error) && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {t('projectSections.skills.blockingError')}
          </div>
          <p className="mt-1 text-destructive">{error ?? snapshot?.error}</p>
        </div>
      )}

      {snapshot && snapshot.warnings.length > 0 && (
        <div className="rounded-md border border-border p-3 text-sm">
          <div className="font-medium mb-1">{t('projectSections.skills.warnings')}</div>
          <ul className="list-disc pl-5 text-muted-foreground">
            {snapshot.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {snapshot && snapshot.skills.length === 0 && !snapshot.error && (
        <p className="text-sm text-muted-foreground">{t('projectSections.skills.empty')}</p>
      )}

      {snapshot && snapshot.skills.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-2 pr-3">{t('projectSections.skills.columns.name')}</th>
              <th className="py-2 pr-3">{t('projectSections.skills.columns.description')}</th>
              <th className="py-2 pr-3">{t('projectSections.skills.columns.source')}</th>
              <th className="py-2 pr-3">{t('projectSections.skills.columns.pinned')}</th>
              <th className="py-2">{t('projectSections.skills.columns.status')}</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.skills.map((skill) => (
              <tr key={`${skill.source}:${skill.name}`} className="border-b border-border/50 align-top">
                <td className="py-2 pr-3 font-mono">{skill.name}</td>
                <td className="py-2 pr-3">{skill.description}</td>
                <td className="py-2 pr-3">
                  <Badge variant="secondary">{t(`projectSections.skills.source.${skill.source}`)}</Badge>
                  {skill.repoUrl && <div className="text-xs text-muted-foreground mt-1 break-all">{skill.repoUrl}</div>}
                </td>
                <td className="py-2 pr-3">
                  {skill.overriddenBy ? null : pinsFor(skill.name).map((target) => (
                    <Badge key={target} variant="outline" className="mr-1">{target}</Badge>
                  ))}
                </td>
                <td className="py-2">
                  {skill.overriddenBy
                    ? t('projectSections.skills.status.overridden')
                    : t('projectSections.skills.status.active')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {snapshot && Object.keys(snapshot.lock.repos).length > 0 && (
        <div className="text-sm">
          <div className="font-medium mb-1">{t('projectSections.skills.repos.title')}</div>
          <ul className="text-muted-foreground">
            {Object.entries(snapshot.lock.repos).map(([url, entry]) => (
              <li key={url} className="break-all">
                <span className="font-mono">{url}</span>{' '}
                <span>{t('projectSections.skills.repos.commit', { commit: entry.commit.slice(0, 7), ref: entry.ref })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
