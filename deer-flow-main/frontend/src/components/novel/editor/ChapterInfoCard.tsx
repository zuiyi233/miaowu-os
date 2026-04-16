'use client';

import type { Chapter } from '@/core/novel/schemas';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollText, Target } from 'lucide-react';
import { useI18n } from '@/core/i18n/hooks';

interface ChapterInfoCardProps {
  chapter: Chapter;
}

export function ChapterInfoCard({ chapter }: ChapterInfoCardProps) {
  const { t } = useI18n();
  if (!chapter.description) return null;

  return (
    <Card className="mb-6 border-l-4 border-l-primary">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ScrollText className="h-4 w-4" />
          {t.novel.chapterOutline}
          <Badge variant="secondary" className="flex items-center gap-1">
            <Target className="h-3 w-3" />
            {t.novel.writingTarget}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {chapter.description}
      </CardContent>
    </Card>
  );
}
