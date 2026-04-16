'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AiChatView } from './ai/AiChatView';
import { ContextInspector } from './ai/ContextInspector';
import { useAiPanelStore } from '@/core/novel';

export function AiPanel() {
  const { activeTab, setActiveTab } = useAiPanelStore();

  return (
    <div className="flex h-full flex-col">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="flex h-full flex-col">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="generate">Generate</TabsTrigger>
          <TabsTrigger value="context">Context</TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="flex-1 overflow-hidden">
          <AiChatView />
        </TabsContent>
        <TabsContent value="generate" className="flex-1 overflow-hidden">
          <div className="p-4 text-center text-muted-foreground">
            AI Generation tools coming soon
          </div>
        </TabsContent>
        <TabsContent value="context" className="flex-1 overflow-hidden">
          <ContextInspector />
        </TabsContent>
      </Tabs>
    </div>
  );
}
