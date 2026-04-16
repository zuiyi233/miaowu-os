'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useNovelStore } from '@/core/novel';
import { databaseService } from '@/core/novel/database';
import { generateUniqueId } from '@/lib/utils';
import { useI18n } from '@/core/i18n/hooks';
import { useQueryClient } from '@tanstack/react-query';

interface NovelCreationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NovelCreationDialog({ open, onOpenChange }: NovelCreationDialogProps) {
  const [title, setTitle] = useState('');
  const [outline, setOutline] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { setCurrentNovelTitle } = useNovelStore();
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const volId = generateUniqueId();
      const ch1Id = generateUniqueId();

      await databaseService.saveNovel({
        title,
        outline,
        volumes: [
          {
            id: volId,
            title: '第一卷',
            description: '',
            chapters: [
              {
                id: ch1Id,
                title: '第一章',
                content: '<p></p>',
                order: 0,
              },
            ],
            order: 0,
          },
        ],
        chapters: [
          {
            id: ch1Id,
            title: '第一章',
            content: '<p></p>',
            volumeId: volId,
            order: 0,
          },
        ],
        characters: [],
        settings: [],
        factions: [],
        items: [],
        relationships: [],
      });

      setCurrentNovelTitle(title);
      queryClient.invalidateQueries({ queryKey: ['novels'] });
      onOpenChange(false);
      setTitle('');
      setOutline('');
    } catch (error) {
      console.error('Failed to create novel:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
