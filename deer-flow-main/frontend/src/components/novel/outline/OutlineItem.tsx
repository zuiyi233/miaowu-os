'use client';

import React from 'react';
import { useOutlineStore } from '@/core/novel/useOutlineStore';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Trash2,
  Edit3,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Loader2,
  GripVertical,
} from 'lucide-react';
import type { OutlineNode } from '@/core/novel/schemas';

interface OutlineItemProps {
  node: OutlineNode;
  level: number;
  onToggleExpand: (id: string) => void;
  isExpanded: boolean;
  onGenerateChapters?: (node: OutlineNode) => void;
  dragHandleProps?: any;
  progressMessage?: string;
}

export const OutlineItem: React.FC<OutlineItemProps> = ({
  node,
  level,
  onToggleExpand,
  isExpanded,
  onGenerateChapters,
  dragHandleProps,
  progressMessage,
}) => {
  const { selectedNodeId, updateNode, removeNode, setSelectedNode, toggleSelection } = useOutlineStore();
  const [isEditing, setIsEditing] = React.useState(false);
  const [editTitle, setEditTitle] = React.useState(node.title);
  const [editDesc, setEditDesc] = React.useState(node.desc || '');

  const handleSave = () => {
    updateNode(node.id, { title: editTitle, desc: editDesc });
    setIsEditing(false);
  };

  const hasChildren = node.children && node.children.length > 0;

  return (
    <div className="relative">
      <Card
        className={`
          relative transition-all duration-200 group
          ${selectedNodeId === node.id ? 'ring-2 ring-primary border-primary/50 shadow-md' : 'hover:border-primary/30 hover:shadow-sm'}
          ${node.status === 'generating' ? 'border-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.2)]' : ''}
        `}
        style={{ marginLeft: level * 16 }}
        onClick={() => setSelectedNode(node.id)}
      >
        <CardContent className="p-3 flex items-start gap-3">
          {dragHandleProps && (
            <div {...dragHandleProps} className="mt-1.5 cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground">
              <GripVertical className="w-4 h-4" />
            </div>
          )}

          <div className="flex flex-col items-center gap-1 pt-1">
            <Checkbox checked={node.isSelected} onCheckedChange={() => toggleSelection(node.id)} className="h-4 w-4" />
            {hasChildren && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 mt-1 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand(node.id);
                }}
              >
                {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </Button>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant={node.type === 'volume' ? 'default' : 'outline'} className="text-[10px] px-1.5 h-5">
                {node.type === 'volume' ? '卷' : '章'}
              </Badge>

              {isEditing ? (
                <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="h-7 text-sm font-bold" autoFocus onClick={(e) => e.stopPropagation()} />
              ) : (
                <span className="font-bold text-sm truncate cursor-pointer" onDoubleClick={() => setIsEditing(true)}>
                  {node.title}
                </span>
              )}

              {node.status === 'generating' && (
                <span className="flex items-center text-[10px] text-blue-500 animate-pulse">
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  {progressMessage || 'AI 生成中...'}
                </span>
              )}
            </div>

            {isEditing ? (
              <div className="space-y-2 mt-2" onClick={(e) => e.stopPropagation()}>
                <Textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="text-xs min-h-[60px]" />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)} className="h-7 text-xs">取消</Button>
                  <Button size="sm" onClick={handleSave} className="h-7 text-xs">保存</Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 cursor-pointer" onDoubleClick={() => setIsEditing(true)}>
                {node.desc || <span className="italic opacity-50">暂无描述...</span>}
              </p>
            )}
          </div>

          {!isEditing && (
            <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity self-start">
              {node.type === 'volume' && onGenerateChapters && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-blue-600 hover:text-blue-700"
                  title="生成本卷章节"
                  onClick={(e) => {
                    e.stopPropagation();
                    onGenerateChapters(node);
                  }}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}>
                <Edit3 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:bg-destructive/10"
                onClick={(e) => { e.stopPropagation(); removeNode(node.id); }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
