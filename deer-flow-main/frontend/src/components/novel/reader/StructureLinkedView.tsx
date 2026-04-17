'use client';

import { CalendarDays, GitBranch, BookOpen, ArrowUpRight, FileText } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { TimelineEvent, Chapter } from '@/core/novel/schemas';

interface StructureLinkedViewProps {
  timelineEvents: TimelineEvent[];
  chapters: Chapter[];
  onNavigateToChapter?: (chapterId: string) => void;
  onNavigateToTimeline?: (eventId: string) => void;
}

export function StructureLinkedView({ timelineEvents, chapters, onNavigateToChapter, onNavigateToTimeline }: StructureLinkedViewProps) {
  const [activeTab, setActiveTab] = useState<'timeline' | 'chapters'>('timeline');

  const chaptersByTimeline = useMemo(() => {
    const eventsWithChapters = timelineEvents
      .map((event) => {
        const chapter = chapters.find((c) => c.id === event.relatedChapterId);
        return { event, chapter };
      })
      .filter(({ chapter }) => !!chapter)
      .sort((a, b) => b.event.sortValue - a.event.sortValue);

    return eventsWithChapters;
  }, [timelineEvents, chapters]);

  const unreferencedChapters = useMemo(() => {
    const referencedIds = new Set(timelineEvents.map((e) => e.relatedChapterId).filter(Boolean));
    return chapters.filter((c) => !referencedIds.has(c.id));
  }, [timelineEvents, chapters]);

  const handleChapterClick = useCallback(
    (chapterId: string) => {
      onNavigateToChapter?.(chapterId);
    },
    [onNavigateToChapter]
  );

  const handleTimelineClick = useCallback(
    (eventId: string) => {
      onNavigateToTimeline?.(eventId);
    },
    [onNavigateToTimeline]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="h-5 w-5" />
          结构视图联动
        </CardTitle>
        <CardDescription>
          从时间线和关系图快速跳转到相关章节片段
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'timeline' | 'chapters')}>
          <TabsList className="w-full">
            <TabsTrigger value="timeline" className="flex-1">
              <CalendarDays className="mr-1 h-4 w-4" /> 时间线关联
            </TabsTrigger>
            <TabsTrigger value="chapters" className="flex-1">
              <BookOpen className="mr-1 h-4 w-4" /> 章节结构
            </TabsTrigger>
          </TabsList>

          <TabsContent value="timeline" className="space-y-3 mt-4">
            {chaptersByTimeline.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <CalendarDays className="mx-auto h-8 w-8 mb-2 opacity-50" />
                <p>暂无与时间线关联的章节</p>
                <p className="text-xs mt-1">创建时间线事件时关联章节，即可在此查看联动视图</p>
              </div>
            ) : (
              <div className="space-y-2">
                {chaptersByTimeline.map(({ event, chapter }) => (
                  <div
                    key={`${event.id}-${chapter!.id}`}
                    className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer group"
                    onClick={() => handleTimelineClick(event.id)}
                  >
                    <div className="mt-1">
                      <Badge variant={event.type === 'backstory' ? 'outline' : event.type === 'historical' ? 'secondary' : 'default'}>
                        {event.type === 'backstory' ? '前传' : event.type === 'historical' ? '历史' : '主线'}
                      </Badge>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{event.title}</p>
                        <span className="text-xs text-muted-foreground">{event.dateDisplay}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <FileText className="h-3 w-3 text-muted-foreground" />
                        <span
                          className="text-sm text-primary hover:underline cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleChapterClick(chapter!.id);
                          }}
                        >
                          {chapter!.title}
                        </span>
                        <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      {event.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{event.description}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="chapters" className="space-y-3 mt-4">
            <div className="space-y-3">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  已关联 ({chapters.length - unreferencedChapters.length})
                </h4>
                <div className="space-y-1">
                  {chapters
                    .filter((c) => timelineEvents.some((e) => e.relatedChapterId === c.id))
                    .map((ch) => {
                      const relatedEvents = timelineEvents.filter((e) => e.relatedChapterId === ch.id);
                      return (
                        <div
                          key={ch.id}
                          className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer"
                          onClick={() => handleChapterClick(ch.id)}
                        >
                          <div className="flex items-center gap-2">
                            <BookOpen className="h-3 w-3 text-muted-foreground" />
                            <span className="text-sm">{ch.title}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            {relatedEvents.slice(0, 3).map((e) => (
                              <Badge key={e.id} variant="outline" className="text-xs">
                                {e.title.slice(0, 6)}...
                              </Badge>
                            ))}
                            {relatedEvents.length > 3 && (
                              <Badge variant="secondary" className="text-xs">+{relatedEvents.length - 3}</Badge>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {unreferencedChapters.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    未关联时间线 ({unreferencedChapters.length})
                  </h4>
                  <div className="space-y-1">
                    {unreferencedChapters.map((ch) => (
                      <div
                        key={ch.id}
                        className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer text-muted-foreground"
                        onClick={() => handleChapterClick(ch.id)}
                      >
                        <FileText className="h-3 w-3" />
                        <span className="text-sm">{ch.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
