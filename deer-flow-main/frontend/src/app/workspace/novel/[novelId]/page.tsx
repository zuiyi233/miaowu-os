'use client';

import { useParams } from 'next/navigation';
import { NovelWorkspace } from '@/components/novel/NovelWorkspace';

export default function NovelDetailRoute() {
  const params = useParams();
  const novelId = params.novelId as string;

  if (!novelId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  return <NovelWorkspace novelId={decodeURIComponent(novelId)} />;
}
