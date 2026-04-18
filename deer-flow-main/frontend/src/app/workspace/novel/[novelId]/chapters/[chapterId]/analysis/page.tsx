'use client';

import { useParams, useRouter } from 'next/navigation';

import ChapterAnalysis from '@/components/novel/ChapterAnalysis';

export default function ChapterAnalysisPage() {
  const params = useParams();
  const router = useRouter();

  const novelId = decodeURIComponent((params.novelId as string) ?? '');
  const chapterId = decodeURIComponent((params.chapterId as string) ?? '');

  if (!novelId || !chapterId) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <ChapterAnalysis
        chapterId={chapterId}
        visible
        onClose={() =>
          router.push(
            `/workspace/novel/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}`,
          )
        }
      />
    </div>
  );
}
