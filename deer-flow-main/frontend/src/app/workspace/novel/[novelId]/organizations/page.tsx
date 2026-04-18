'use client';

import { useParams } from 'next/navigation';

import { Organizations } from '@/components/novel/Organizations';

export default function OrganizationsPage() {
  const params = useParams();
  const novelId = decodeURIComponent((params.novelId as string) ?? '');

  if (!novelId) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <Organizations projectId={novelId} />
    </div>
  );
}
