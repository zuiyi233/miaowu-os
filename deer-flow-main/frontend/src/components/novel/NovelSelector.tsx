'use client';

import { useAllNovelsQuery } from '@/core/novel/queries';
import { useNovelStore } from '@/core/novel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { NovelCreationDialog } from './NovelCreationDialog';
import { useState } from 'react';
import { useI18n } from '@/core/i18n/hooks';

export function NovelSelector() {
  const { t } = useI18n();
  const { data: novels } = useAllNovelsQuery();
  const { currentNovelTitle, setCurrentNovelTitle } = useNovelStore();
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2">
        <Select
          value={currentNovelTitle || ''}
          onValueChange={setCurrentNovelTitle}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder={t.novel.selectNovel} />
          </SelectTrigger>
          <SelectContent>
            {novels?.map((novel) => (
              <SelectItem key={novel.title} value={novel.title}>
                {novel.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => setShowCreateDialog(true)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <NovelCreationDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />
    </>
  );
}
