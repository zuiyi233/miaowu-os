'use client';

import { useParams } from 'next/navigation';

import { PromptWorkshop } from '@/components/novel/PromptWorkshop';

export default function PromptWorkshopPage() {
  const params = useParams();
  const novelId = decodeURIComponent((params.novelId as string) ?? '');

  if (!novelId) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <PromptWorkshop projectId={novelId} />
    </div>
  );
}
