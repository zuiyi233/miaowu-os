import { ForeshadowsView } from '@/components/novel/ForeshadowsView';

interface ForeshadowsPageProps {
  params: Promise<{ novelId: string }>;
}

export default async function ForeshadowsPage({ params }: ForeshadowsPageProps) {
  const { novelId: encodedNovelId } = await params;
  const novelId = decodeURIComponent(encodedNovelId ?? '');

  if (!novelId) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <ForeshadowsView novelId={novelId} />
    </div>
  );
}
