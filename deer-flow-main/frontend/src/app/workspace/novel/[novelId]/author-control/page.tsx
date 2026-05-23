import { AuthorControlStation } from '@/components/novel/author-control/AuthorControlStation';

interface AuthorControlRouteProps {
  params: Promise<{ novelId: string }>;
}

export default async function AuthorControlRoute({ params }: AuthorControlRouteProps) {
  const { novelId: encodedNovelId } = await params;
  const novelId = decodeURIComponent(encodedNovelId ?? '');

  if (!novelId) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
  }

  return <AuthorControlStation novelId={novelId} />;
}
