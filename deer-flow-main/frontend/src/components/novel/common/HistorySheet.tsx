'use client';

import { Clock } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useNovelStore } from '@/core/novel/useNovelStore';

interface HistorySheetProps {
  versions: Array<{ id: string; timestamp: Date; content: string; label: string }>;
  onRestore?: (versionId: string) => void;
  isLoading?: boolean;
}

export const HistorySheet: React.FC<HistorySheetProps> = ({
  versions,
  onRestore,
  isLoading,
}) => {
  const { isHistorySheetOpen, setIsHistorySheetOpen } = useNovelStore();

  return (
    <Sheet open={isHistorySheetOpen} onOpenChange={setIsHistorySheetOpen}>
      <SheetContent side="right" className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            版本历史
          </SheetTitle>
          <SheetDescription>
            查看和恢复之前保存的版本
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)] mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              加载历史版本中...
            </div>
          ) : versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-center">
              <Clock className="h-12 w-12 mb-3 opacity-20" />
              <p>暂无历史版本</p>
              <p className="text-xs mt-1">保存文档后将自动记录历史</p>
            </div>
          ) : (
            <div className="space-y-2">
              {versions.map((version) => (
                <div
                  key={version.id}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 transition-colors"
                >
                  <div>
                    <p className="font-medium text-sm">{version.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(version.timestamp).toLocaleString('zh-CN')}
                    </p>
                  </div>
                  {onRestore && (
                    <Button variant="outline" size="sm" onClick={() => onRestore(version.id)}>
                      恢复
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};
