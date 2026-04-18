'use client';

import { FileText, Database, Settings } from 'lucide-react';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n } from '@/core/i18n/hooks';

import { DataManagement } from './DataManagement';
import { PromptTemplateManager } from './PromptTemplateManager';
import { ProviderSettings } from './ProviderSettings';


interface NovelSettingsProps {
  novelId: string;
}

export function NovelSettings({ novelId }: NovelSettingsProps) {
  const { t } = useI18n();

  return (
    <div className="h-full flex flex-col">
      <div className="border-b px-4 py-3">
        <h2 className="text-lg font-semibold">{t.novel.settings}</h2>
      </div>
      <Tabs defaultValue="provider" className="flex-1 flex flex-col">
        <div className="border-b px-4">
          <TabsList className="h-10">
            <TabsTrigger value="provider" className="gap-2">
              <Settings className="h-4 w-4" />
              AI 配置
            </TabsTrigger>
            <TabsTrigger value="templates" className="gap-2">
              <FileText className="h-4 w-4" />
              {t.novel.promptTemplates}
            </TabsTrigger>
            <TabsTrigger value="data" className="gap-2">
              <Database className="h-4 w-4" />
              {t.novel.dataManagement}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="provider" className="flex-1 overflow-hidden m-0">
          <ScrollArea className="h-full">
            <ProviderSettings />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="templates" className="flex-1 overflow-hidden m-0">
          <PromptTemplateManager novelId={novelId} />
        </TabsContent>
        <TabsContent value="data" className="flex-1 overflow-hidden m-0">
          <ScrollArea className="h-full">
            <DataManagement />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
