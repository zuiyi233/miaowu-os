'use client';

import { BookOpen, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAddChapterMutation, useDeleteChapterMutation, useNovelQuery } from '@/core/novel/queries';
import type { Chapter } from '@/core/novel/schemas';

export default function NovelChaptersPage() {
  const params = useParams();
  const router = useRouter();
  const novelId = decodeURIComponent((params.novelId as string) ?? '');

  const [newChapterTitle, setNewChapterTitle] = useState('');

  const { data: novelData, isLoading } = useNovelQuery(novelId);
  const addChapter = useAddChapterMutation(novelId);
  const deleteChapter = useDeleteChapterMutation();

  const chapters = useMemo(
    () => [...(novelData?.chapters ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [novelData?.chapters],
  );

  if (!novelId) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
  }

  const handleCreateChapter = () => {
    const title = newChapterTitle.trim();
    if (!title) {
      return;
    }

    const chapterId = crypto.randomUUID();
    const chapter: Chapter = {
      id: chapterId,
      title,
      content: '',
      novelId,
      order: chapters.length + 1,
    };

    addChapter.mutate(
      { chapter },
      {
        onSuccess: () => {
          setNewChapterTitle('');
          router.push(
            `/workspace/novel/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}`,
          );
        },
      },
    );
  };

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            章节管理
          </CardTitle>
          <CardDescription>创建章节并进入编辑页；后续可在章节分析页查看分析结果。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={newChapterTitle}
              onChange={(event) => setNewChapterTitle(event.target.value)}
              placeholder="输入新章节标题"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleCreateChapter();
                }
              }}
            />
            <Button onClick={handleCreateChapter} disabled={addChapter.isPending || !newChapterTitle.trim()}>
              <Plus className="mr-1 h-4 w-4" />新增章节
            </Button>
          </div>

          {isLoading ? <p className="text-sm text-muted-foreground">加载章节中...</p> : null}

          {!isLoading && chapters.length === 0 ? (
            <p className="text-sm text-muted-foreground">当前小说还没有章节，请先创建。</p>
          ) : null}

          <div className="space-y-2">
            {chapters.map((chapter, index) => (
              <div key={chapter.id} className="flex items-center justify-between rounded-md border p-3">
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium">
                    第 {index + 1} 章 · {chapter.title}
                  </p>
                  <p className="text-xs text-muted-foreground">ID: {chapter.id}</p>
                </div>
                <div className="ml-2 flex items-center gap-2">
                  <Button variant="outline" asChild>
                    <Link href={`/workspace/novel/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapter.id)}`}>
                      进入编辑
                    </Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link href={`/workspace/novel/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapter.id)}/analysis`}>
                      章节分析
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      if (window.confirm('确定删除该章节吗？')) {
                        deleteChapter.mutate(chapter.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
