'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { databaseService, type AuditEntry as LocalAuditEntry } from '@/core/novel/database';
import {
  executeRemoteFirst,
  novelApiService,
  type NovelAuditEntry,
} from '@/core/novel/novel-api';
import {
  useChapterSnapshotsQuery,
  useNovelQuery,
  useTimelineEventsQuery,
  useUpdateChapterMutation,
} from '@/core/novel/queries';
import type { Chapter } from '@/core/novel/schemas';

import { AnnotationThreadPanel } from './AnnotationThreadPanel';
import { AuditLogPanel } from './AuditLogPanel';
import { QualityReportPanel } from './QualityReportPanel';
import { ReadingMode } from './ReadingMode';
import { RecommendationPanel } from './RecommendationPanel';
import { StructureLinkedView } from './StructureLinkedView';
import { VersionDiff } from './VersionDiff';

type ReaderTab =
  | 'reading'
  | 'diff'
  | 'structure'
  | 'recommendation'
  | 'annotation'
  | 'quality'
  | 'audit';

function normalizeLocalAuditEntry(entry: LocalAuditEntry): NovelAuditEntry {
  const parsedTimestamp =
    entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp);
  const timestamp = Number.isNaN(parsedTimestamp.getTime())
    ? new Date()
    : parsedTimestamp;
  return {
    ...entry,
    timestamp,
  };
}

function buildDerivedAuditEntries(chapters: Chapter[]): NovelAuditEntry[] {
  return [...chapters]
    .sort((a, b) => {
      const left = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const right = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return right - left;
    })
    .slice(0, 30)
    .map((chapter, index) => ({
      id: `audit-${chapter.id}`,
      timestamp: chapter.updatedAt ? new Date(chapter.updatedAt) : new Date(),
      action: index === 0 ? ('create' as const) : ('update' as const),
      entityType: 'chapter' as const,
      entityId: chapter.id,
      entityName: chapter.title,
      details: `章节「${chapter.title}」内容有更新`,
      author: 'system',
    }));
}

async function fetchAuditEntries(novelId: string, chapters: Chapter[]): Promise<NovelAuditEntry[]> {
  const chapterIds = new Set(chapters.map((chapter) => chapter.id));
  return executeRemoteFirst(
    () => novelApiService.getAudits(novelId),
    async () => {
      const localEntries = await databaseService.getAuditEntries(200);
      const related = localEntries
        .filter((entry) => entry.entityId === novelId || chapterIds.has(entry.entityId))
        .map(normalizeLocalAuditEntry);
      if (related.length > 0) {
        return related;
      }
      return buildDerivedAuditEntries(chapters);
    },
    'ReaderWorkspaceView.fetchAuditEntries',
  );
}

export function ReaderWorkspaceView({ novelId }: { novelId: string }) {
  const [activeTab, setActiveTab] = useState<ReaderTab>('reading');
  const { data: novel, isLoading } = useNovelQuery(novelId);
  const { data: timelineEvents = [] } = useTimelineEventsQuery(novelId);
  const updateChapterMutation = useUpdateChapterMutation();

  const sortedChapters = useMemo(
    () =>
      [...(novel?.chapters ?? [])].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0)
      ),
    [novel?.chapters]
  );
  const [selectedChapterId, setSelectedChapterId] = useState<string>('');

  const selectedChapter: Chapter | undefined = useMemo(
    () =>
      sortedChapters.find((chapter) => chapter.id === selectedChapterId) ??
      sortedChapters[0],
    [sortedChapters, selectedChapterId]
  );

  const { data: snapshots = [] } = useChapterSnapshotsQuery(selectedChapter?.id);

  const chapterAuditSignature = useMemo(
    () =>
      sortedChapters
        .map((chapter) => `${chapter.id}:${chapter.updatedAt ?? ''}`)
        .join('|'),
    [sortedChapters],
  );

  const { data: auditEntries = [] } = useQuery({
    queryKey: ['audits', novelId, chapterAuditSignature],
    queryFn: () => fetchAuditEntries(novelId, sortedChapters),
    enabled: Boolean(novelId),
  });

  const handleExportAudit = () => {
    const blob = new Blob([JSON.stringify(auditEntries, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `novel-audit-${novelId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!novel) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        No novel data found
      </div>
    );
  }

  if (sortedChapters.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        请先创建章节后再进入阅读工作台
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="border-b px-4 py-3">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as ReaderTab)}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="reading">阅读</TabsTrigger>
            <TabsTrigger value="diff">版本对比</TabsTrigger>
            <TabsTrigger value="structure">结构联动</TabsTrigger>
            <TabsTrigger value="recommendation">建议</TabsTrigger>
            <TabsTrigger value="annotation">批注</TabsTrigger>
            <TabsTrigger value="quality">质量</TabsTrigger>
            <TabsTrigger value="audit">审计</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {(activeTab === 'diff' || activeTab === 'annotation') && (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">当前章节</span>
            <Select
              value={selectedChapter?.id ?? ''}
              onValueChange={setSelectedChapterId}
            >
              <SelectTrigger className="w-[260px]">
                <SelectValue placeholder="请选择章节" />
              </SelectTrigger>
              <SelectContent>
                {sortedChapters.map((chapter) => (
                  <SelectItem key={chapter.id} value={chapter.id}>
                    {chapter.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {activeTab === 'reading' && (
          <ReadingMode
            novelId={novelId}
            chapters={sortedChapters}
            initialChapterIndex={0}
            onExit={() => setActiveTab('diff')}
          />
        )}

        {activeTab === 'diff' && selectedChapter && (
          <VersionDiff
            chapterId={selectedChapter.id}
            currentContent={selectedChapter.content || ''}
            snapshots={snapshots}
            onRestore={(content) => {
              updateChapterMutation.mutate({
                chapterId: selectedChapter.id,
                content,
              });
            }}
          />
        )}

        {activeTab === 'structure' && (
          <StructureLinkedView
            timelineEvents={timelineEvents}
            chapters={sortedChapters}
            onNavigateToChapter={(chapterId) => {
              setSelectedChapterId(chapterId);
              setActiveTab('annotation');
            }}
          />
        )}

        {activeTab === 'recommendation' && <RecommendationPanel novelId={novelId} />}

        {activeTab === 'annotation' && (
          <AnnotationThreadPanel novelId={novelId} chapterId={selectedChapter?.id} />
        )}

        {activeTab === 'quality' && (
          <QualityReportPanel
            novelId={novelId}
            chapters={sortedChapters}
            characters={novel.characters ?? []}
            timelineEvents={timelineEvents}
          />
        )}

        {activeTab === 'audit' && (
          <AuditLogPanel entries={auditEntries} onExport={handleExportAudit} />
        )}
      </div>
    </div>
  );
}
