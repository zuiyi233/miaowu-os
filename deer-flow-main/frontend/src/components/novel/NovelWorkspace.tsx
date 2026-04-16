'use client';

import React, { useRef, useState, useEffect } from 'react';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { NovelEditor } from './Editor';
import { AiPanel } from './AiPanel';
import { EntitySidebar } from './sidebar/EntitySidebar';
import { NovelSelector } from './NovelSelector';
import { OutlineView } from './outline/OutlineView';
import { TimelineView } from './timeline/TimelineView';
import { RelationshipGraph } from './RelationshipGraph';
import { NovelSettings } from './settings/NovelSettings';
import { useNovelStore } from '@/core/novel';
import { useMediaQuery } from '@/core/novel/useMediaQuery';
import { useI18n } from '@/core/i18n/hooks';

export function NovelWorkspace({ novelTitle }: { novelTitle: string }) {
  const { t } = useI18n();
  const { viewMode, setViewMode } = useNovelStore();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const toggleSidebar = () => {
    if (!isDesktop) {
      setIsMobileSidebarOpen(true);
    }
  };

  return (
    <div className="h-screen w-full flex flex-col">
      <div className="border-b px-4 py-2 flex items-center justify-between">
        <NovelSelector />
        <div className="flex gap-1">
          {[
            { mode: 'editor' as const, label: t.novel.editor },
            { mode: 'outline' as const, label: t.novel.outline },
            { mode: 'timeline' as const, label: t.novel.timeline },
            { mode: 'graph' as const, label: t.novel.graph },
            { mode: 'settings' as const, label: t.novel.settings },
          ].map(({ mode, label }) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`text-sm px-3 py-1.5 rounded transition-colors ${
                viewMode === mode
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-accent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 relative overflow-hidden">
        {viewMode === 'editor' && (
          <>
            {isDesktop ? (
              <ResizablePanelGroup direction="horizontal" className="h-full">
                <ResizablePanel
                  defaultSize={20}
                  minSize={15}
                  maxSize={30}
                  collapsible
                  collapsedSize={0}
                >
                  <EntitySidebar novelTitle={novelTitle} />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={55} minSize={30}>
                  <NovelEditor novelTitle={novelTitle} />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel
                  defaultSize={25}
                  minSize={20}
                  maxSize={40}
                  collapsible
                  collapsedSize={0}
                >
                  <AiPanel />
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              <div className="h-full w-full relative">
                <NovelEditor novelTitle={novelTitle} />
                <Sheet open={isMobileSidebarOpen} onOpenChange={setIsMobileSidebarOpen}>
                  <SheetContent side="left" className="p-0 w-[85%]">
                    <EntitySidebar novelTitle={novelTitle} />
                  </SheetContent>
                </Sheet>
                <Sheet>
                  <SheetContent side="right" className="p-0 w-[90%] sm:w-[400px]">
                    <AiPanel />
                  </SheetContent>
                </Sheet>
              </div>
            )}
          </>
        )}

        {viewMode === 'outline' && (
          <div className="h-full w-full animate-in fade-in duration-300">
            <OutlineView novelTitle={novelTitle} />
          </div>
        )}

        {viewMode === 'timeline' && (
          <div className="h-full w-full animate-in fade-in duration-300 bg-background">
            <TimelineView novelTitle={novelTitle} />
          </div>
        )}

        {viewMode === 'graph' && (
          <div className="h-full w-full animate-in fade-in duration-300 bg-background">
            <RelationshipGraph novelTitle={novelTitle} />
          </div>
        )}

        {viewMode === 'settings' && (
          <div className="h-full w-full animate-in fade-in duration-300 bg-background">
            <NovelSettings novelTitle={novelTitle} />
          </div>
        )}
      </main>
    </div>
  );
}
