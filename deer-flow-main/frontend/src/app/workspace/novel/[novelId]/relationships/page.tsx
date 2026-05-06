import { GitBranch } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface RelationshipsPageProps {
  params: Promise<{ novelId: string }>;
}

export default async function RelationshipsPage({ params }: RelationshipsPageProps) {
  const { novelId: encodedNovelId } = await params;
  const novelId = decodeURIComponent(encodedNovelId ?? '');

  if (!novelId) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            角色关系
          </CardTitle>
          <CardDescription>关系图谱已拆分为独立路由，点击进入可视化关系网络。</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href={`/workspace/novel/${encodeURIComponent(novelId)}/relationships/graph`}>
              打开关系图谱
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
