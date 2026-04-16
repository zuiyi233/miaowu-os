import React, { useState } from "react";
import {
  useChapterSnapshotsQuery,
  useRestoreFromSnapshotMutation,
} from "../lib/react-query/db-queries";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";
import { History, RotateCcw, Clock, FileText } from "lucide-react";
import { formatDateFromNow } from "../lib/utils/date";
import { EmptyState } from "./common/EmptyState";
import type { ChapterSnapshot } from "../lib/storage/db";

/**
 * 历史记录恢复界面组件
 * 使用React Query获取数据，管理版本历史查看和恢复功能
 * 遵循单一职责原则，仅负责历史记录的展示和恢复操作
 */
interface HistorySheetProps {
  chapterId: string;
  chapterTitle: string;
}

export const HistorySheet: React.FC<HistorySheetProps> = ({
  chapterId,
  chapterTitle,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  // 使用React Query获取版本历史数据
  const {
    data: snapshots = [],
    isLoading,
    error,
  } = useChapterSnapshotsQuery(chapterId);

  // 使用React Query管理恢复操作
  const restoreMutation = useRestoreFromSnapshotMutation();

  // 恢复到指定版本
  const handleRestore = async (snapshot: ChapterSnapshot) => {
    try {
      await restoreMutation.mutateAsync(snapshot);
      setIsOpen(false);
    } catch (error) {
      console.error("恢复版本失败:", error);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <History className="w-4 h-4" />
          历史记录
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            版本历史
          </SheetTitle>
          <SheetDescription>
            章节「{chapterTitle}」的版本历史记录
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 px-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-sm text-muted-foreground">加载中...</div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-sm text-destructive">
                加载版本历史失败: {error.message}
              </div>
            </div>
          ) : snapshots.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="暂无版本历史"
              description="编辑章节内容后会自动创建版本快照"
            />
          ) : (
            <div className="space-y-3 py-4">
              {snapshots.map((snapshot, index) => (
                <Card
                  key={snapshot.id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">
                        版本 #{snapshots.length - index}
                      </CardTitle>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRestore(snapshot)}
                        disabled={restoreMutation.isPending}
                        className="gap-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        恢复
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {formatDateFromNow(snapshot.timestamp)}
                      </div>
                      {snapshot.description && (
                        <div className="text-xs text-muted-foreground">
                          {snapshot.description}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        内容长度: {snapshot.content.length} 字符
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="border-t p-4">
          <div className="text-xs text-muted-foreground text-center">
            最多保留最近 50 个版本
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
