'use client';

import { useParams } from 'next/navigation';

import { ForeshadowsView } from '@/components/novel/ForeshadowsView';

export default function ForeshadowsPage() {
  const params = useParams();
  const novelId = decodeURIComponent((params.novelId as string) ?? '');

  if (!novelId) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <ForeshadowsView novelId={novelId} />
    </div>
  );
}
