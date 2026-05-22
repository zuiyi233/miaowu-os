import { NovelEditor } from '@/components/novel/Editor';

interface NovelEditorRouteProps {
  params: Promise<{ novelId: string }>;
}

export default async function NovelEditorRoute({ params }: NovelEditorRouteProps) {
  const { novelId: encodedNovelId } = await params;
  const novelId = decodeURIComponent(encodedNovelId ?? '');

  if (!novelId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  return <NovelEditor novelId={novelId} />;
}
