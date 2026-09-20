// apps/desktop/src/renderer/components/requirements/NewBrdDialog.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

interface NewBrdDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (title: string) => Promise<void>;
}

export function NewBrdDialog({ open, onOpenChange, onCreate }: NewBrdDialogProps) {
  const { t } = useTranslation('requirements');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onCreate(title.trim());
      setTitle('');
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('newDialog.title')}</DialogTitle>
          <DialogDescription>{t('newDialog.description')}</DialogDescription>
        </DialogHeader>
        <label className="text-sm font-medium" htmlFor="brd-title">{t('newDialog.titleLabel')}</label>
        <Input
          id="brd-title"
          value={title}
          placeholder={t('newDialog.titlePlaceholder')}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t('newDialog.cancel')}</Button>
          <Button onClick={() => void submit()} disabled={busy || !title.trim()}>{t('newDialog.create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
