'use client';

import {
  PanelRight,
  BookOpen,
  BookText,
  Clock,
  GitBranch,
  Settings,
  Trophy,
  Flag,
} from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useI18n } from '@/core/i18n/hooks';
import { useNovelStore } from '@/core/novel';
import { useMediaQuery } from '@/core/novel/useMediaQuery';

import { AiPanel } from './AiPanel';
import { NovelEditor } from './Editor';
import { NovelSelector } from './NovelSelector';
import { OutlineView } from './outline/OutlineView';
import { ReaderWorkspaceView } from './reader/ReaderWorkspaceView';
import { RelationshipGraph } from './RelationshipGraph';
import { NovelSettings } from './settings/NovelSettings';
import { TimelineView } from './timeline/TimelineView';
import { CareersView } from './CareersView';
import { ForeshadowsView } from './ForeshadowsView';

export function NovelWorkspace({ novelId }: { novelId: string }) {
  const { t } = useI18n();
  const { viewMode, setViewMode } = useNovelStore();
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [mobileAiOpen, setMobileAiOpen] = useState(false);

  const isTablet = useMediaQuery('(min-width: 768px)');
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const viewModes = [
    { mode: 'editor' as const, label: t.novel.editor, icon: <BookOpen className="h-4 w-4" /> },
    { mode: 'reader' as const, label: '阅读', icon: <BookText className="h-4 w-4" /> },
    { mode: 'outline' as const, label: t.novel.outline, icon: null },
    { mode: 'timeline' as const, label: t.novel.timeline, icon: <Clock className="h-4 w-4" /> },
    { mode: 'graph' as const, label: t.novel.graph, icon: <GitBranch className="h-4 w-4" /> },
    { mode: 'careers' as const, label: '职业体系', icon: <Trophy className="h-4 w-4" /> },
    { mode: 'foreshadows' as const, label: '伏笔管理', icon: <Flag className="h-4 w-4" /> },
    { mode: 'settings' as const, label: t.novel.settings, icon: <Settings className="h-4 w-4" /> },
  ];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex flex-shrink-0 items-center justify-between border-b bg-muted/30 px-3 py-2 sm:px-4">
        <div className="flex items-center gap-2">
          <NovelSelector />
        </div>
        <div className="flex items-center gap-1">
          {viewModes.map(({ mode, label, icon }) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                viewMode === mode
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              {icon && <span className="hidden sm:inline">{icon}</span>}
              <span>{label}</span>
            </button>
          ))}
          {isTablet && (
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 transition-colors ${rightPanelOpen ? 'bg-accent text-accent-foreground' : ''}`}
              onClick={() => setRightPanelOpen(!rightPanelOpen)}
              title={t.novel.chat}
            >
              <PanelRight className="h-4 w-4" />
            </Button>
          )}
          {!isTablet && viewMode === 'editor' && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 sm:hidden"
              onClick={() => setMobileAiOpen(true)}
            >
              <PanelRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <main className="relative flex-1 overflow-hidden">
        {viewMode === 'editor' ? (
          <>
            {isDesktop ? (
              <div className="flex h-full">
                <div className="flex-1 overflow-hidden">
                  <NovelEditor novelId={novelId} />
                </div>
                {rightPanelOpen && (
                  <div className="w-80 flex-shrink-0 border-l bg-background transition-all duration-300">
                    <AiPanel novelId={novelId} />
                  </div>
                )}
              </div>
            ) : (
              <>
                <NovelEditor novelId={novelId} />
                <Sheet open={mobileAiOpen} onOpenChange={setMobileAiOpen}>
                  <SheetContent side="right" className="w-[90vw] max-w-md p-0">
                    <SheetHeader className="sr-only">
                      <SheetTitle>{t.novel.chat}</SheetTitle>
                    </SheetHeader>
                    <AiPanel novelId={novelId} />
                  </SheetContent>
                </Sheet>
              </>
            )}
          </>
        ) : null}

        {viewMode === 'reader' && (
          <div className="h-full w-full animate-in fade-in duration-300 bg-background">
            <ReaderWorkspaceView novelId={novelId} />
          </div>
        )}

        {viewMode === 'outline' && (
          <div className="h-full w-full animate-in fade-in duration-300">
            <OutlineView novelId={novelId} />
          </div>
        )}

        {viewMode === 'timeline' && (
          <div className="h-full w-full animate-in fade-in duration-300 bg-background">
            <TimelineView novelId={novelId} />
          </div>
        )}

        {viewMode === 'graph' && (
          <div className="h-full w-full animate-in fade-in duration-300 bg-background">
            <RelationshipGraph novelId={novelId} />
          </div>
        )}

        {viewMode === 'careers' && (
          <div className="h-full w-full animate-in fade-in duration-300 bg-background">
            <CareersView novelId={novelId} />
          </div>
        )}

        {viewMode === 'foreshadows' && (
          <div className="h-full w-full animate-in fade-in duration-300 bg-background">
            <ForeshadowsView novelId={novelId} />
          </div>
        )}

        {viewMode === 'settings' && (
          <div className="h-full w-full animate-in fade-in duration-300 bg-background">
            <NovelSettings novelId={novelId} />
          </div>
        )}
      </main>
    </div>
  );
}
