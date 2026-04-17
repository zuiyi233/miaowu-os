'use client';

import { MessageSquare, Sparkles, Network } from 'lucide-react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n } from '@/core/i18n/hooks';
import { useAiPanelStore } from '@/core/novel';

import { AiChatView } from './ai/AiChatView';
import { ContextInspector } from './ai/ContextInspector';

export function AiPanel({ novelId }: { novelId: string }) {
  const { t } = useI18n();
  const { activeTab, setActiveTab } = useAiPanelStore();

  return (
    <div className="flex h-full flex-col">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="flex h-full flex-col">
        <TabsList className="grid w-full grid-cols-3 rounded-none border-b bg-muted/50">
          <TabsTrigger value="chat" className="gap-1.5 data-[state=active]:bg-background">
            <MessageSquare className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t.novel.chat}</span>
          </TabsTrigger>
          <TabsTrigger value="generate" className="gap-1.5 data-[state=active]:bg-background">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Generate</span>
          </TabsTrigger>
          <TabsTrigger value="context" className="gap-1.5 data-[state=active]:bg-background">
            <Network className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t.novel.contextEntities}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="flex-1 overflow-hidden m-0">
          <AiChatView novelId={novelId} />
        </TabsContent>
        <TabsContent value="generate" className="flex-1 overflow-hidden m-0">
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <Sparkles className="h-10 w-10 opacity-30" />
            <p className="text-sm">AI Generation tools coming soon</p>
          </div>
        </TabsContent>
        <TabsContent value="context" className="flex-1 overflow-hidden m-0">
          <ContextInspector />
        </TabsContent>
      </Tabs>
    </div>
  );
}
