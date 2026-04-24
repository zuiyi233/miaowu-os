'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function NovelDetailRoute() {
  const params = useParams();
  const router = useRouter();
  const novelId = decodeURIComponent((params.novelId as string) ?? '');

  useEffect(() => {
    if (novelId) {
      router.replace(`/workspace/novel/${encodeURIComponent(novelId)}/chapters`);
    }
  }, [novelId, router]);

  return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
}
