'use client';

import React, { useState } from 'react';
import { useOutlineStore } from '@/core/novel/useOutlineStore';
import { useNovelStore } from '@/core/novel/useNovelStore';
import { OutlineListPanel } from './OutlineListPanel';
import { OutlineItem } from './OutlineItem';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Settings2,
  FileText,
  Wand2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Loader2,
} from 'lucide-react';
import type { OutlineNode } from '@/core/novel/schemas';

interface OutlineConfigPanelProps {
  novelId: string;
  novelTitle?: string;
  onGenerate?: (config: GenerateConfig) => Promise<void>;
  onGenerateChapters?: (volume: OutlineNode) => Promise<void>;
}

export interface GenerateConfig {
  selectedVolumes: string[];
  useSmart: boolean;
  targetWordCount?: number;
  batchSize?: number;
}

export const OutlineConfigPanel: React.FC<OutlineConfigPanelProps> = ({
  novelId,
  novelTitle,
  onGenerate,
  onGenerateChapters,
}) => {
  const { tree, setIsGenerating } = useOutlineStore();
  const { isGeneratingOutline } = useNovelStore();
  const [showSettings, setShowSettings] = useState(false);
  const [useSmart, setUseSmart] = useState(true);
  const [targetWordCount, setTargetWordCount] = useState(3000);
  const [batchSize, setBatchSize] = useState(5);

  const handleGenerate = async () => {
    if (onGenerate) {
      setIsGenerating(true);
      try {
        await onGenerate({
          selectedVolumes: [],
          useSmart,
          targetWordCount,
          batchSize,
        });
      } finally {
        setIsGenerating(false);
      }
    }
  };

  const handleGenerateChapters = async (volume: OutlineNode) => {
    if (onGenerateChapters) {
      setIsGenerating(true);
      try {
        await onGenerateChapters(volume);
      } finally {
        setIsGenerating(false);
      }
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <FileText className="w-5 h-5" />
            大纲规划中心
          </h3>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings2 className="w-4 h-4" />
          </Button>
        </div>
        {novelTitle && (
          <p className="text-sm text-muted-foreground">
            正在规划：《{novelTitle}》
          </p>
        )}
      </div>

      {/* Settings */}
      {showSettings && (
        <div className="p-4 bg-muted/30 border-b space-y-4">
          <h4 className="font-medium text-sm">生成设置</h4>

          <div className="flex items-center justify-between">
            <Label htmlFor="smart-mode">智能模式</Label>
            <Switch id="smart-mode" checked={useSmart} onCheckedChange={setUseSmart} />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>目标字数/章</Label>
              <span className="text-sm text-muted-foreground">{targetWordCount} 字</span>
            </div>
            <Slider
              value={[targetWordCount]}
              min={1000}
              max={8000}
              step={500}
              onValueChange={(v) => {
                const nextValue = v[0];
                if (nextValue !== undefined) {
                  setTargetWordCount(nextValue);
                }
              }}
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>批次大小</Label>
              <span className="text-sm text-muted-foreground">{batchSize} 章/批</span>
            </div>
            <Slider
              value={[batchSize]}
              min={1}
              max={15}
              step={1}
              onValueChange={(v) => {
                const nextValue = v[0];
                if (nextValue !== undefined) {
                  setBatchSize(nextValue);
                }
              }}
            />
          </div>
        </div>
      )}

      {/* Generate Button */}
      {tree.length === 0 && (
        <div className="p-4">
          <Button className="w-full" onClick={handleGenerate} disabled={isGeneratingOutline}>
            {isGeneratingOutline ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                AI 构思中...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                AI 自动构思
              </>
            )}
          </Button>
        </div>
      )}

      {/* Outline List */}
      <div className="flex-1 overflow-hidden">
        <OutlineListPanel onGenerateChapters={handleGenerateChapters} />
      </div>
    </div>
  );
};
