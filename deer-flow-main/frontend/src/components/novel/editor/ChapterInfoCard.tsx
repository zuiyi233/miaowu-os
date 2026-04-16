'use client';

import type { Chapter } from '@/core/novel/schemas';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ChapterInfoCardProps {
  chapter: Chapter;
}

export function ChapterInfoCard({ chapter }: ChapterInfoCardProps) {
  if (!chapter.description) return null;

  return (
    <Card className="mb-4 border-l-4 border-l-primary">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          Chapter Outline
          <Badge variant="secondary">Writing Target</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {chapter.description}
      </CardContent>
    </Card>
  );
}
