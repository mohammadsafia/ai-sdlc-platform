import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, AlertTriangle, ChevronRight } from 'lucide-react';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { cn } from '../../lib/utils';
import { useSkillsStore } from '../../stores/skills-store';

interface SkillsSettingsProps {
  projectId: string;
}

/** "https://github.com/acme/skills.git" → "acme/skills" */
export function shortRepoLabel(url: string): string {
  const withoutScheme = url.replace(/^[a-z+]+:\/\//i, '').replace(/^[^@/]+@/, '');
  const path = withoutScheme.replace(/^[^/:]+[/:]/, '').replace(/\.git$/, '').replace(/\/+$/, '');
  const parts = path.split('/').filter(Boolean);
  return parts.slice(-2).join('/') || withoutScheme;
}

function CollapsibleSection({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('rounded-md border border-border', className)}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-left hover:bg-muted/50 transition-colors"
        >
          <ChevronRight className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-90')} />
          {title}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 text-sm">{children}</CollapsibleContent>
    </Collapsible>
  );
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

  const repos = Object.entries(snapshot?.lock.repos ?? {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button variant="outline" size="sm" onClick={() => void refresh(projectId)} disabled={isLoading}>
          <RefreshCw className={cn('h-4 w-4 mr-2', isLoading && 'animate-spin')} />
          {isLoading ? t('projectSections.skills.refreshing') : t('projectSections.skills.refresh')}
        </Button>
      </div>

      <CollapsibleSection title={t('projectSections.skills.howToTitle')}>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>
            {t('projectSections.skills.howToLocal')}{' '}
            <code className="font-mono text-xs">.claude/skills/&lt;name&gt;/SKILL.md</code>
          </li>
          <li>
            {t('projectSections.skills.howToConfig')}{' '}
            <code className="font-mono text-xs">.claude/skills.json</code>
          </li>
          <li>
            {t('projectSections.skills.howToLock')}{' '}
            <code className="font-mono text-xs">.claude/skills.lock.json</code>
          </li>
        </ul>
      </CollapsibleSection>

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
        <CollapsibleSection title={t('projectSections.skills.warningsCount', { count: snapshot.warnings.length })}>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            {snapshot.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {snapshot && snapshot.skills.length === 0 && !snapshot.error && (
        <p className="text-sm text-muted-foreground">{t('projectSections.skills.empty')}</p>
      )}

      {snapshot && snapshot.skills.length > 0 && (
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-[22%]" />
            <col />
            <col className="w-[18%]" />
            <col className="w-[16%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-2 pr-3 font-medium">{t('projectSections.skills.columns.name')}</th>
              <th className="py-2 pr-3 font-medium">{t('projectSections.skills.columns.description')}</th>
              <th className="py-2 pr-3 font-medium">{t('projectSections.skills.columns.source')}</th>
              <th className="py-2 pr-3 font-medium">{t('projectSections.skills.columns.pinned')}</th>
              <th className="py-2 font-medium">{t('projectSections.skills.columns.status')}</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.skills.map((skill) => (
              <tr key={`${skill.source}:${skill.name}`} className="border-b border-border/50 align-top">
                <td className="py-2 pr-3 font-mono text-xs truncate" title={skill.name}>
                  {skill.name}
                </td>
                <td className="py-2 pr-3">
                  <span className="line-clamp-2" title={skill.description}>
                    {skill.description}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  <Badge variant="secondary">{t(`projectSections.skills.source.${skill.source}`)}</Badge>
                  {skill.repoUrl && (
                    <div className="mt-1 text-xs text-muted-foreground truncate" title={skill.repoUrl}>
                      {shortRepoLabel(skill.repoUrl)}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <div className="flex flex-wrap gap-1">
                    {skill.overriddenBy
                      ? null
                      : pinsFor(skill.name).map((target) => (
                          <Badge key={target} variant="outline">
                            {target}
                          </Badge>
                        ))}
                  </div>
                </td>
                <td className="py-2">
                  {skill.overriddenBy ? (
                    <Badge variant="outline" className="text-muted-foreground">
                      {t('projectSections.skills.status.overridden')}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">{t('projectSections.skills.status.active')}</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {snapshot && repos.length > 0 && (
        <div className="text-sm">
          <div className="font-medium mb-1">{t('projectSections.skills.repos.title')}</div>
          <ul className="space-y-1 text-muted-foreground">
            {repos.map(([url, entry]) => (
              <li key={url} className="flex flex-wrap items-center gap-2" title={url}>
                <span className="font-mono text-xs">{shortRepoLabel(url)}</span>
                <span className="text-xs">
                  {t('projectSections.skills.repos.commit', { commit: entry.commit.slice(0, 7), ref: entry.ref })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
