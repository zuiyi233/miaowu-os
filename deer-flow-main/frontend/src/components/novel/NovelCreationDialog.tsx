'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/core/i18n/hooks';
import { useNovelStore } from '@/core/novel';
import { novelDomainService } from '@/core/novel/novel-domain-service';
import { generateUniqueId } from '@/core/novel/utils';

interface NovelCreationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NovelCreationDialog({ open, onOpenChange }: NovelCreationDialogProps) {
  const [title, setTitle] = useState('');
  const [outline, setOutline] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { setCurrentNovelTitle } = useNovelStore();
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setIsSubmitting(false);
      setErrorMessage(null);
      setTitle('');
      setOutline('');
    }
    onOpenChange(nextOpen);
  }, [onOpenChange]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const novelData = { id: generateUniqueId('novel'), title, outline };
      await novelDomainService.saveNovel(novelData as any);
      setCurrentNovelTitle(title);
      queryClient.invalidateQueries({ queryKey: ['novels'] });
      onOpenChange(false);
      setTitle('');
      setOutline('');
    } catch (error) {
      const message = error instanceof Error ? error.message : t.novel.createFailed;
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t.novel.createNewNovelTitle}</DialogTitle>
            <DialogDescription>
              {t.novel.createNewNovelDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">{t.novel.novelTitle}</Label>
              <Input
                id="title"
                placeholder={t.novel.novelTitlePlaceholder}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="outline">{t.novel.novelOutline}</Label>
              <Textarea
                id="outline"
                placeholder={t.novel.novelOutlinePlaceholder}
                value={outline}
                onChange={(e) => setOutline(e.target.value)}
                rows={4}
              />
            </div>
            {errorMessage && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">{errorMessage}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.novel.cancel}
            </Button>
            <Button type="submit" disabled={isSubmitting || !title.trim()}>
              {isSubmitting ? t.novel.creating : t.novel.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
