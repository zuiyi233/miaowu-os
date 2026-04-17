'use client';

import { useParams } from 'next/navigation';

import { NovelEditor } from '@/components/novel/Editor';

export default function NovelEditorRoute() {
  const params = useParams();
  const novelId = params.novelId as string;

  if (!novelId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  return <NovelEditor novelId={decodeURIComponent(novelId)} />;
}
