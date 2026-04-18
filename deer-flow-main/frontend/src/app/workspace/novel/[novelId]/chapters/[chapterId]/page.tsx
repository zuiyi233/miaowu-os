'use client';

import { BarChart3 } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { useParams } from 'next/navigation';

import { NovelEditor } from '@/components/novel/Editor';
import { Button } from '@/components/ui/button';
import { useNovelStore } from '@/core/novel';
import { useNovelQuery } from '@/core/novel/queries';

export default function ChapterEditorPage() {
  const params = useParams();
  const novelId = decodeURIComponent((params.novelId as string) ?? '');
  const chapterId = decodeURIComponent((params.chapterId as string) ?? '');
  const setActiveChapterId = useNovelStore((state) => state.setActiveChapterId);

  const { data: novelData } = useNovelQuery(novelId);
  const chapter = (novelData?.chapters ?? []).find((item) => item.id === chapterId);

  useEffect(() => {
    if (chapterId) {
      setActiveChapterId(chapterId);
    }
  }, [chapterId, setActiveChapterId]);

  if (!novelId || !chapterId) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <p className="text-sm text-muted-foreground">章节编辑器</p>
          <p className="text-base font-medium">{chapter?.title ?? `章节 ${chapterId}`}</p>
        </div>
        <Button variant="outline" asChild>
          <Link
            href={`/workspace/novel/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/analysis`}
          >
            <BarChart3 className="mr-1 h-4 w-4" />查看分析
          </Link>
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <NovelEditor novelId={novelId} />
      </div>
    </div>
  );
}
