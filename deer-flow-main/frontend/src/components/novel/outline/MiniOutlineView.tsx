'use client';

import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Maximize2, MapPin } from 'lucide-react';
import { useOutlineStore } from '@/core/novel/useOutlineStore';
import { useNovelStore } from '@/core/novel/useNovelStore';
import type { OutlineNode } from '@/core/novel/schemas';

interface MiniNodeItemProps {
  node: OutlineNode;
  activeId: string;
  onJump: (node: OutlineNode) => void;
}

const MiniNodeItem: React.FC<MiniNodeItemProps> = ({ node, activeId, onJump }) => {
  const isVolume = node.type === 'volume';
  const isActive = activeId === node.id;

  return (
    <div className={`mb-2 ${isVolume ? 'mt-4' : 'ml-3'}`}>
      <div
        className={`flex items-center gap-2 p-2 rounded-md text-xs cursor-pointer transition-colors ${
          isActive ? 'bg-primary/10 text-primary font-medium border-l-2 border-primary' : 'hover:bg-muted'
        }`}
        onClick={() => onJump(node)}
      >
        {isVolume ? (
          <span className="font-bold truncate flex-1">{node.title}</span>
        ) : (
          <>
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
            <span className="truncate flex-1">{node.title}</span>
          </>
        )}
      </div>

      {!isVolume && isActive && node.desc && (
        <div className="ml-6 mt-1 p-2 bg-muted/30 rounded text-[10px] text-muted-foreground leading-relaxed border-l-2 border-primary/20">
          <span className="font-semibold text-primary/70 block mb-1">剧情指引:</span>
          {node.desc}
        </div>
      )}

      {node.children?.map((child) => (
        <MiniNodeItem key={child.id} node={child} activeId={activeId} onJump={onJump} />
      ))}
    </div>
  );
};

export const MiniOutlineView: React.FC = () => {
  const { tree } = useOutlineStore();
  const { setViewMode, activeChapterId, setActiveChapterId } = useNovelStore();

  const switchToFullMode = () => setViewMode('outline');

  const handleJump = (node: OutlineNode) => {
    if (node.type === 'volume') return;
    setViewMode('editor');
    setActiveChapterId(node.id);
    setTimeout(() => {
      const event = new CustomEvent('editor-scroll-to-outline', {
        detail: { chapterId: node.id },
      });
      window.dispatchEvent(event);
    }, 100);
  };

  if (tree.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground p-4 text-center">
        <MapPin className="w-10 h-10 mb-3 opacity-20" />
        <p className="text-xs mb-2">暂无大纲结构</p>
        <p className="text-[10px] text-muted-foreground/70 mb-4">
          请前往「大纲规划中心」生成或构建你的小说骨架。
        </p>
        <Button variant="outline" size="sm" onClick={switchToFullMode}>
          前往规划
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/10">
        <span className="text-xs font-medium flex items-center gap-1">
          <MapPin className="w-3 h-3" /> 剧情导航
        </span>
        <Button variant="ghost" size="icon" className="h-6 w-6" title="切换到全屏规划视图" onClick={switchToFullMode}>
          <Maximize2 className="w-3 h-3" />
        </Button>
      </div>

      <ScrollArea className="flex-1 p-2">
        {tree.map((node) => (
          <MiniNodeItem key={node.id} node={node} activeId={activeChapterId ?? ''} onJump={handleJump} />
        ))}
      </ScrollArea>

      <div className="p-2 border-t bg-muted/5">
        <div className="text-[10px] text-muted-foreground text-center">大纲变动将实时同步</div>
      </div>
    </div>
  );
};
