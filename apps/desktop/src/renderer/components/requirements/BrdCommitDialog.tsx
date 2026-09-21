// apps/desktop/src/renderer/components/requirements/BrdCommitDialog.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileMinus, FilePen, FilePlus, Loader2 } from 'lucide-react';

import type { BrdChangedFile } from '../../../shared/types/brd';
import { useBrdStore } from '../../stores/brd-store';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';

const PUSH_KEY = 'brd.commit.push';

const DESIGN_PREFIX = 'docs/design/';

function slugOf(path: string): string {
  const file = path.split('/').pop()?.replace(/\.requirements\.json$/, '').replace(/\.md$/, '') ?? path;
  if (path.startsWith(DESIGN_PREFIX)) {
    const brd = path.split('/')[2];
    return brd ? `${brd}/${file}` : file;
  }
  return file;
}

/** `docs(brd): update a, b` (or docs(design), or docs when mixed); `add` when every change is new. */
export function defaultCommitMessage(files: BrdChangedFile[]): string {
  const slugs = Array.from(new Set(files.map((f) => slugOf(f.path)))).sort();
  const allNew = files.length > 0 && files.every((f) => f.status === 'untracked' || f.status === 'added');
  const kinds = new Set(files.map((f) => (f.path.startsWith(DESIGN_PREFIX) ? 'design' : 'brd')));
  const scope = kinds.size === 1 ? `docs(${[...kinds][0]})` : 'docs';
  return `${scope}: ${allNew ? 'add' : 'update'} ${slugs.join(', ')}`;
}

function readPushPreference(): boolean {
  try {
    return localStorage.getItem(PUSH_KEY) !== 'false';
  } catch {
    return true;
  }
}

const icons = { added: FilePlus, untracked: FilePlus, modified: FilePen, deleted: FileMinus } as const;

interface BrdCommitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export function BrdCommitDialog({ open, onOpenChange, projectId }: BrdCommitDialogProps) {
  const { t } = useTranslation('requirements');
  const { changes, commit, isCommitting, lastCommit, commitError } = useBrdStore();
  const files = changes?.files ?? [];
  const [message, setMessage] = useState('');
  const [push, setPush] = useState(readPushPreference);

  // Prefill once per open; the user edits the message afterwards.
  // biome-ignore lint/correctness/useExhaustiveDependencies: files is read only when the dialog opens
  useEffect(() => {
    if (open) {
      setMessage(defaultCommitMessage(files));
      useBrdStore.setState({ lastCommit: null, commitError: null });
    }
  }, [open]);

  const togglePush = (value: boolean) => {
    setPush(value);
    try {
      localStorage.setItem(PUSH_KEY, String(value));
    } catch {
      // per-viewer convenience only
    }
  };

  let resultLine: string | null = null;
  if (lastCommit) {
    if (lastCommit.pushed) resultLine = t('commit.donePushed', { commit: lastCommit.commit });
    else if (lastCommit.pushError) resultLine = t('commit.pushFailed', { commit: lastCommit.commit, error: lastCommit.pushError });
    else resultLine = t('commit.done', { commit: lastCommit.commit });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('commit.title')}</DialogTitle>
          <DialogDescription>{t('commit.description', { branch: changes?.branch ?? '' })}</DialogDescription>
        </DialogHeader>
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('commit.empty')}</p>
        ) : (
          <ul className="max-h-40 space-y-1 overflow-auto text-sm">
            {files.map((f) => {
              const Icon = icons[f.status];
              return (
                <li key={f.path} className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.path}</span>
                  <span className="text-xs text-muted-foreground">{t(`commit.status.${f.status}`)}</span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="space-y-2">
          <Label htmlFor="brd-commit-message">{t('commit.message')}</Label>
          <Textarea id="brd-commit-message" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="brd-commit-push">{t('commit.push')}</Label>
          <Switch id="brd-commit-push" checked={push} onCheckedChange={togglePush} />
        </div>
        {commitError && <p className="text-xs text-destructive">{commitError}</p>}
        {resultLine && (
          <p className={`text-xs ${lastCommit?.pushError ? 'text-amber-600' : 'text-muted-foreground'}`}>{resultLine}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCommitting}>
            {t('commit.cancel')}
          </Button>
          <Button
            onClick={() => void commit(projectId, message, push)}
            disabled={isCommitting || files.length === 0 || !message.trim()}
          >
            {isCommitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isCommitting ? t('commit.committing') : t('commit.commit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
