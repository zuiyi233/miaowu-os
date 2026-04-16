'use client';

import { useParams } from 'next/navigation';
import { NovelWorkspace } from '@/components/novel/NovelWorkspace';

export default function NovelDetailRoute() {
  const params = useParams();
  const novelTitle = params.novelId as string;

  if (!novelTitle) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  return <NovelWorkspace novelTitle={decodeURIComponent(novelTitle)} />;
}
