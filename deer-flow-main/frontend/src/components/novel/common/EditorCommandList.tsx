'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useUiStore } from '@/core/novel/useUiStore';
import { Sparkles, BookOpen, Users, MapPin, Shield, Package } from 'lucide-react';

export const EditorCommandList: React.FC = () => {
  const { setViewMode, setIsAiPanelCollapsed, setIsCommandPaletteOpen, setIsHistorySheetOpen } = useUiStore();

  const commands = [
    { icon: <BookOpen className="h-4 w-4" />, label: '切换到章节', action: () => setViewMode('editor') },
    { icon: <Sparkles className="h-4 w-4" />, label: 'AI 续写', action: () => setIsAiPanelCollapsed(false) },
    { icon: <Users className="h-4 w-4" />, label: '角色管理', action: () => setViewMode('home') },
    { icon: <MapPin className="h-4 w-4" />, label: '场景管理', action: () => setViewMode('home') },
    { icon: <Shield className="h-4 w-4" />, label: '势力管理', action: () => setViewMode('home') },
    { icon: <Package className="h-4 w-4" />, label: '物品管理', action: () => setViewMode('home') },
    { icon: <Sparkles className="h-4 w-4" />, label: '历史版本', action: () => setIsHistorySheetOpen(true) },
  ];

  return (
    <ScrollArea className="h-[200px]">
      <div className="grid grid-cols-1 gap-1 p-1">
        {commands.map((cmd, i) => (
          <Button
            key={i}
            variant="ghost"
            className="w-full justify-start gap-2 h-8 text-sm"
            onClick={() => {
              cmd.action();
              setIsCommandPaletteOpen(false);
            }}
          >
            {cmd.icon}
            <span>{cmd.label}</span>
          </Button>
        ))}
      </div>
    </ScrollArea>
  );
};
