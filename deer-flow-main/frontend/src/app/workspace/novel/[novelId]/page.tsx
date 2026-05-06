import { redirect } from 'next/navigation';

interface NovelDetailRouteProps {
  params: Promise<{ novelId: string }>;
}

export default async function NovelDetailRoute({ params }: NovelDetailRouteProps) {
  const { novelId: encodedNovelId } = await params;
  const novelId = decodeURIComponent(encodedNovelId ?? '');

  if (!novelId) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
  }

  redirect(`/workspace/novel/${encodeURIComponent(novelId)}/chapters`);
}
