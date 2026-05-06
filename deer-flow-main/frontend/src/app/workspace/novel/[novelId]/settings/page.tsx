import { NovelSettings } from '@/components/novel/settings/NovelSettings';

interface NovelSettingsPageProps {
  params: Promise<{ novelId: string }>;
}

export default async function NovelSettingsPage({ params }: NovelSettingsPageProps) {
  const { novelId: encodedNovelId } = await params;
  const novelId = decodeURIComponent(encodedNovelId ?? '');

  if (!novelId) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
  }

  return <NovelSettings novelId={novelId} />;
}
