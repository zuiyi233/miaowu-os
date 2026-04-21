'use client';

import { useParams } from 'next/navigation';

import { QualityReportPanel } from '@/components/novel/reader/QualityReportPanel';
import { useNovelQuery, useTimelineEventsQuery } from '@/core/novel/queries';

export default function NovelQualityReportPage() {
  const params = useParams();
  const novelId = decodeURIComponent((params.novelId as string) ?? '');

  const { data: novel, isLoading } = useNovelQuery(novelId);
  const { data: timelineEvents = [] } = useTimelineEventsQuery(novelId);

  if (!novelId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        正在加载一致性报告...
      </div>
    );
  }

  if (!novel) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        未找到小说数据
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <QualityReportPanel
        novelId={novelId}
        chapters={novel.chapters ?? []}
        characters={novel.characters ?? []}
        timelineEvents={timelineEvents}
      />
    </div>
  );
}
