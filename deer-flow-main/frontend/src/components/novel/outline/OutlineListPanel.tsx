'use client';

import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { useOutlineStore } from '@/core/novel/useOutlineStore';
import { useUiStore } from '@/core/novel/useUiStore';
import type { OutlineNode } from '@/core/novel/schemas';

interface OutlineListPanelProps {
  onNodeClick?: (node: OutlineNode) => void;
  onGenerateChapters?: (node: OutlineNode) => void;
}

const TreeNode: React.FC<{
  node: OutlineNode;
  level: number;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onNodeClick?: (node: OutlineNode) => void;
  onGenerateChapters?: (node: OutlineNode) => void;
}> = ({ node, level, expandedIds, onToggleExpand, onNodeClick, onGenerateChapters }) => {
  const { selectedNodeId, setSelectedNode } = useOutlineStore();
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-accent/50 text-sm ${
          selectedNodeId === node.id ? 'bg-primary/10 text-primary' : ''
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => {
          setSelectedNode(node.id);
          onNodeClick?.(node);
        }}
      >
        {hasChildren && (
          <button
            className="w-4 h-4 flex items-center justify-center"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        )}
        <span className="truncate flex-1">{node.title}</span>
        <span className="text-xs text-muted-foreground">
          {node.type === 'volume' ? '卷' : '章'}
        </span>
      </div>

      {hasChildren && isExpanded &&
        node.children!.map((child) => (
          <TreeNode
            key={child.id}
            node={child}
            level={level + 1}
            expandedIds={expandedIds}
            onToggleExpand={onToggleExpand}
            onNodeClick={onNodeClick}
            onGenerateChapters={onGenerateChapters}
          />
        ))}
    </div>
  );
};

export const OutlineListPanel: React.FC<OutlineListPanelProps> = ({
  onNodeClick,
  onGenerateChapters,
}) => {
  const { tree } = useOutlineStore();
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(
    new Set(tree.map((n) => n.id))
  );

  const onToggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <ScrollArea className="h-full">
      <div className="py-2">
        {tree.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            level={0}
            expandedIds={expandedIds}
            onToggleExpand={onToggleExpand}
            onNodeClick={onNodeClick}
            onGenerateChapters={onGenerateChapters}
          />
        ))}
      </div>
    </ScrollArea>
  );
};
