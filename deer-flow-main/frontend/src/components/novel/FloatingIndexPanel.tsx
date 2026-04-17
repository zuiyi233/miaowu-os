'use client';

import { useState, useMemo } from 'react';
import { Search, BookOpen } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

interface ChapterItem {
  id: string;
  chapter_number: number;
  title: string;
}

interface GroupedChapters {
  outlineId: string | null;
  outlineTitle: string;
  chapters: ChapterItem[];
}

interface FloatingIndexPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupedChapters: GroupedChapters[];
  onChapterSelect: (chapterId: string) => void;
}

export function FloatingIndexPanel({
  open,
  onOpenChange,
  groupedChapters,
  onChapterSelect,
}: FloatingIndexPanelProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredGroups = useMemo(() => {
    if (!searchTerm.trim()) return groupedChapters;
    const term = searchTerm.toLowerCase();
    return groupedChapters
      .map((group) => ({
        ...group,
        chapters: group.chapters.filter((ch) => ch.title.toLowerCase().includes(term)),
      }))
      .filter((g) => g.chapters.length > 0);
  }, [searchTerm, groupedChapters]);

  const handleChapterClick = (chapterId: string) => {
    onChapterSelect(chapterId);
    onOpenChange(false);
  };

  const totalChapters = filteredGroups.reduce((sum, g) => sum + g.chapters.length, 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[320px] sm:w-[360px] p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-3 border-b">
          <SheetTitle className="flex items-center gap-2 text-base">
            <BookOpen className="w-4 h-4" />
            章节目录
            <Badge variant="secondary" className="ml-auto font-mono text-xs">
              {totalChapters} 章
            </Badge>
          </SheetTitle>
        </SheetHeader>

        <div className="px-4 py-3 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="搜索章节标题..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          {filteredGroups.length > 0 ? (
            <div className="py-2">
              {filteredGroups.map((group) => (
                <div key={group.outlineId || '_ungrouped'} className="mb-2">
                  <div className="sticky top-0 bg-background px-4 py-2 flex items-center gap-2">
                    <Badge variant={group.outlineId ? 'default' : 'secondary'} className="font-medium">
                      {group.outlineTitle || '未分组'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      ({group.chapters.length})
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {group.chapters.map((chapter) => (
                      <button
                        key={chapter.id}
                        className={cn(
                          "w-full text-left px-8 py-2 text-sm hover:bg-accent hover:text-accent-foreground",
                          "transition-colors duration-150 truncate"
                        )}
                        onClick={() => handleChapterClick(chapter.id)}
                        title={`第${chapter.chapter_number}章: ${chapter.title}`}
                      >
                        <span className="text-muted-foreground mr-1.5 font-mono text-xs">
                          #{chapter.chapter_number}
                        </span>
                        {chapter.title}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Search className="w-10 h-10 opacity-20" />
              <p className="text-sm">没有找到匹配的章节</p>
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
