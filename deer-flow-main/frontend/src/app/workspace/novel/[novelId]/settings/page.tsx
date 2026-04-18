'use client';

import { useParams } from 'next/navigation';

import { NovelSettings } from '@/components/novel/settings/NovelSettings';

export default function NovelSettingsPage() {
  const params = useParams();
  const novelId = decodeURIComponent((params.novelId as string) ?? '');

  if (!novelId) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
  }

  return <NovelSettings novelId={novelId} />;
}
