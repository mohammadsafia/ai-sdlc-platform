// apps/desktop/src/renderer/components/requirements/RequirementsView.tsx
import { useTranslation } from 'react-i18next';

export function RequirementsView({ projectId }: { projectId: string }) {
  const { t } = useTranslation('requirements');
  return <div className="p-6 text-sm text-muted-foreground" data-project-id={projectId}>{t('title')}</div>;
}
