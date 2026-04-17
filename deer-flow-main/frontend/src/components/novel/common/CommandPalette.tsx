'use client';

import { BookOpen, Users, MapPin, Shield, Package, ScrollText, LayoutDashboard, Settings, FileText } from 'lucide-react';
import React from 'react';

import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { useNovelStore } from '@/core/novel/useNovelStore';

interface CommandPaletteProps {
  novelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateChapter?: () => void;
  onCreateCharacter?: () => void;
  onCreateSetting?: () => void;
  onCreateFaction?: () => void;
  onCreateItem?: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onOpenChange,
  onCreateChapter,
  onCreateCharacter,
  onCreateSetting,
  onCreateFaction,
  onCreateItem,
}) => {
  const { setViewMode } = useNovelStore();

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="输入命令或搜索..." />
      <CommandList>
        <CommandEmpty>没有匹配的结果</CommandEmpty>
        <CommandGroup heading="导航">
          <CommandItem onSelect={() => { setViewMode('home'); onOpenChange(false); }}>
            <LayoutDashboard className="mr-2 h-4 w-4" />
            <span>仪表盘</span>
          </CommandItem>
          <CommandItem onSelect={() => { setViewMode('editor'); onOpenChange(false); }}>
            <FileText className="mr-2 h-4 w-4" />
            <span>编辑器</span>
          </CommandItem>
          <CommandItem onSelect={() => { setViewMode('outline'); onOpenChange(false); }}>
            <ScrollText className="mr-2 h-4 w-4" />
            <span>大纲规划</span>
          </CommandItem>
          <CommandItem onSelect={() => { setViewMode('chat'); onOpenChange(false); }}>
            <BookOpen className="mr-2 h-4 w-4" />
            <span>AI 对话</span>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="创建">
          <CommandItem onSelect={() => { onCreateChapter?.(); onOpenChange(false); }}>
            <BookOpen className="mr-2 h-4 w-4" />
            <span>创建章节</span>
          </CommandItem>
          <CommandItem onSelect={() => { onCreateCharacter?.(); onOpenChange(false); }}>
            <Users className="mr-2 h-4 w-4" />
            <span>创建角色</span>
          </CommandItem>
          <CommandItem onSelect={() => { onCreateSetting?.(); onOpenChange(false); }}>
            <MapPin className="mr-2 h-4 w-4" />
            <span>创建场景</span>
          </CommandItem>
          <CommandItem onSelect={() => { onCreateFaction?.(); onOpenChange(false); }}>
            <Shield className="mr-2 h-4 w-4" />
            <span>创建势力</span>
          </CommandItem>
          <CommandItem onSelect={() => { onCreateItem?.(); onOpenChange(false); }}>
            <Package className="mr-2 h-4 w-4" />
            <span>创建物品</span>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="设置">
          <CommandItem onSelect={() => { setViewMode('settings'); onOpenChange(false); }}>
            <Settings className="mr-2 h-4 w-4" />
            <span>小说设置</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};
