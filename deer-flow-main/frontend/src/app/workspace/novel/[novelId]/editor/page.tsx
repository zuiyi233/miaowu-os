'use client';

import { NovelEditor } from '@/components/novel/Editor';
import { useParams } from 'next/navigation';

export default function NovelEditorRoute() {
  const params = useParams();
  const novelTitle = params.novelId as string;

  if (!novelTitle) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  return <NovelEditor novelTitle={decodeURIComponent(novelTitle)} />;
}
