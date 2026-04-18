'use client';

import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { ProjectWorkspaceLayout } from '@/components/novel/routes/ProjectWorkspaceLayout';

export default function NovelWorkspaceRouteLayout({ children }: { children: ReactNode }) {
  const params = useParams();
  const novelId = decodeURIComponent((params.novelId as string) ?? '');

  if (!novelId) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
  }

  return <ProjectWorkspaceLayout novelId={novelId}>{children}</ProjectWorkspaceLayout>;
}
