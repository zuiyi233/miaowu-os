'use client';

import { MessageSquare, Sparkles, Network, BarChart3 } from 'lucide-react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n } from '@/core/i18n/hooks';
import { useAiPanelStore } from '@/core/novel';

import { AiChatView } from './ai/AiChatView';
import { ContextInspector } from './ai/ContextInspector';
import { GeneratePanel } from './ai/GeneratePanel';

type ActiveTab = 'chat' | 'generate' | 'context' | 'analysis';

export function AiPanel({ novelId }: { novelId: string }) {
  const { t } = useI18n();
  const { activeTab, setActiveTab } = useAiPanelStore();

  return (
    <div className="flex h-full flex-col">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ActiveTab)} className="flex h-full flex-col">
        <TabsList className="grid w-full grid-cols-4 rounded-none border-b bg-muted/50">
          <TabsTrigger value="chat" className="gap-1.5 data-[state=active]:bg-background">
            <MessageSquare className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t.novel.chat}</span>
          </TabsTrigger>
          <TabsTrigger value="generate" className="gap-1.5 data-[state=active]:bg-background">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t.novel.generate}</span>
          </TabsTrigger>
          <TabsTrigger value="context" className="gap-1.5 data-[state=active]:bg-background">
            <Network className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t.novel.contextEntities}</span>
          </TabsTrigger>
          <TabsTrigger value="analysis" className="gap-1.5 data-[state=active]:bg-background">
            <BarChart3 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t.novel.analysis}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="flex-1 overflow-hidden m-0">
          <AiChatView novelId={novelId} />
        </TabsContent>
        <TabsContent value="generate" className="flex-1 overflow-hidden m-0">
          <GeneratePanel novelId={novelId} />
        </TabsContent>
        <TabsContent value="context" className="flex-1 overflow-hidden m-0">
          <ContextInspector />
        </TabsContent>
        <TabsContent value="analysis" className="flex-1 overflow-hidden m-0">
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
            <BarChart3 className="h-10 w-10 opacity-30" />
            <p className="text-sm">{t.novel.chapterAnalysisTools}</p>
            <p className="text-xs max-w-xs">{t.novel.selectChapterToAnalyze}</p>
            {novelId && (
              <p className="text-xs text-muted-foreground/60">{t.novel.analysisReady}</p>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
