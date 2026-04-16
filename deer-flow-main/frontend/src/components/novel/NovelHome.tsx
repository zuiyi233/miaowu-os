'use client';

import { useState } from 'react';
import { useAllNovelsQuery } from '@/core/novel/queries';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, BookOpen, FileText, Layers, PenTool } from 'lucide-react';
import Link from 'next/link';
import { NovelCreationDialog } from './NovelCreationDialog';
import { useI18n } from '@/core/i18n/hooks';

export function NovelHome() {
  const { t } = useI18n();
  const { data: novels, isLoading } = useAllNovelsQuery();
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {t.novel.loading}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="p-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t.novel.title}</h1>
            <p className="text-muted-foreground mt-1">{t.novel.description}</p>
          </div>
          <Button onClick={() => setShowCreateDialog(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            {t.novel.newNovel}
          </Button>
        </div>

        {!novels || novels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <BookOpen className="mb-4 h-16 w-16 text-muted-foreground/50" />
            <h2 className="mb-2 text-xl font-semibold">{t.novel.noNovelsYet}</h2>
            <p className="mb-6 max-w-sm text-muted-foreground">
              {t.novel.noNovelsDescription}
            </p>
            <Button onClick={() => setShowCreateDialog(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              {t.novel.createFirstNovel}
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {novels.map((novel) => (
              <Link key={novel.title} href={`/workspace/novel/${encodeURIComponent(novel.title)}`}>
                <Card className="h-full cursor-pointer transition-all hover:shadow-md">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <BookOpen className="h-5 w-5" />
                      {novel.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {novel.outline && (
                      <p className="mb-4 line-clamp-2 text-sm text-muted-foreground">
                        {novel.outline}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Layers className="h-3 w-3" />
                        {novel.volumesCount} {t.novel.volumes}
                      </span>
                      <span className="flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        {novel.chaptersCount} {t.novel.chapters}
                      </span>
                      <span className="flex items-center gap-1">
                        <PenTool className="h-3 w-3" />
                        {novel.wordCount.toLocaleString()} {t.novel.words}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      <NovelCreationDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />
    </div>
  );
}
