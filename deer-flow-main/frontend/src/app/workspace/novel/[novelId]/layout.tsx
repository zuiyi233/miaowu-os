import type { ReactNode } from 'react';

import { ProjectWorkspaceLayout } from '@/components/novel/routes/ProjectWorkspaceLayout';

interface NovelWorkspaceRouteLayoutProps {
  children: ReactNode;
  params: Promise<{ novelId: string }>;
}

export default async function NovelWorkspaceRouteLayout({
  children,
  params,
}: NovelWorkspaceRouteLayoutProps) {
  const { novelId: encodedNovelId } = await params;
  const novelId = decodeURIComponent(encodedNovelId ?? '');

  if (!novelId) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
  }

  return <ProjectWorkspaceLayout novelId={novelId}>{children}</ProjectWorkspaceLayout>;
}
