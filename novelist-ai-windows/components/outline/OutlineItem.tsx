import React, { useState } from "react";
import { useOutlineStore } from "../../stores/useOutlineStore";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Badge } from "../ui/badge";
import { toast } from "sonner";
import {
  Trash2,
  Edit3,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Loader2,
  GripVertical,
} from "lucide-react";

interface OutlineItemProps {
  node: any;
  level: number;
  onToggleExpand: (id: string) => void;
  isExpanded: boolean;
  onGenerateChapters: (node: any) => void;
  dragHandleProps?: any;
  progressMessage?: string; // ✅ 新增：进度消息
}

/**
 * 大纲条目内容组件
 * 负责渲染单个大纲节点的所有内容和交互
 */
export const OutlineItemContent: React.FC<OutlineItemProps> = ({
  node,
  level,
  onToggleExpand,
  isExpanded,
  onGenerateChapters,
  dragHandleProps,
  progressMessage, // ✅ 新增：进度消息
}) => {
  const {
    selectedNodeId,
    updateNode,
    removeNode,
    setSelectedNode,
    toggleSelection,
  } = useOutlineStore();

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(node.title);
  const [editDesc, setEditDesc] = useState(node.desc);

  const handleSave = () => {
    updateNode(node.id, { title: editTitle, desc: editDesc });
    setIsEditing(false);
  };

  const hasChildren = node.children && node.children.length > 0;
  const treeLineClass =
    level > 0 ? "border-l-2 border-muted/50 ml-4 pl-4 relative" : "";
  const horizontalLine =
    level > 0 ? (
      <div className="absolute -left-[18px] top-8 w-4 h-0.5 bg-muted/50" />
    ) : null;

  return (
    <div className="relative">
      <div className={treeLineClass}>
        {horizontalLine}

        <Card
          className={`
            relative transition-all duration-200 group
            ${
              selectedNodeId === node.id
                ? "ring-2 ring-primary border-primary/50 shadow-md"
                : "hover:border-primary/30 hover:shadow-sm"
            }
            ${
              node.status === "generating"
                ? "border-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.2)]"
                : ""
            }
            ${
              node.status === "error"
                ? "border-destructive/50 bg-destructive/5"
                : ""
            }
          `}
          onClick={() => setSelectedNode(node.id)} // 点击卡片选中
        >
          {node.status === "generating" && (
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 animate-shimmer pointer-events-none" />
          )}

          <CardContent className="p-3 flex items-start gap-3">
            {/* 拖拽手柄 */}
            {dragHandleProps && (
              <div
                {...dragHandleProps}
                className="mt-1.5 cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground"
              >
                <GripVertical className="w-4 h-4" />
              </div>
            )}

            {/* 展开/折叠 & 勾选 */}
            <div className="flex flex-col items-center gap-1 pt-1">
              <Checkbox
                checked={node.isSelected}
                onCheckedChange={() => toggleSelection(node.id)}
                className="h-4 w-4"
              />
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
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </Button>
              )}
            </div>

            {/* 内容区 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Badge
                  variant={node.type === "volume" ? "default" : "outline"}
                  className={`text-[10px] px-1.5 h-5 ${
                    node.type === "chapter"
                      ? "bg-background text-muted-foreground border-dashed"
                      : ""
                  }`}
                >
                  {node.type === "volume" ? "卷" : "章"}
                </Badge>

                {isEditing ? (
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="h-7 text-sm font-bold"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="font-bold text-sm truncate cursor-pointer"
                    onDoubleClick={() => setIsEditing(true)}
                  >
                    {node.title}
                  </span>
                )}

                {node.status === "generating" && (
                  <div className="flex flex-col items-start">
                    <span className="flex items-center text-[10px] text-blue-500 animate-pulse">
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      AI 思考中...
                    </span>
                    {/* ✅ 显示具体的批次进度 */}
                    {progressMessage && (
                      <span className="text-[9px] text-muted-foreground mt-0.5">
                        {progressMessage}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {isEditing ? (
                <div
                  className="space-y-2 mt-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Textarea
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    className="text-xs min-h-[60px]"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setIsEditing(false)}
                      className="h-7 text-xs"
                    >
                      取消
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSave}
                      className="h-7 text-xs"
                    >
                      保存
                    </Button>
                  </div>
                </div>
              ) : (
                <p
                  className="text-xs text-muted-foreground leading-relaxed line-clamp-2 hover:line-clamp-none cursor-pointer transition-all"
                  onDoubleClick={() => setIsEditing(true)}
                >
                  {node.desc || (
                    <span className="italic opacity-50">暂无描述...</span>
                  )}
                </p>
              )}
            </div>

            {/* 操作栏 */}
            {!isEditing && (
              <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity self-start">
                {node.type === "volume" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                    title="生成本卷章节"
                    onClick={(e) => {
                      e.stopPropagation();
                      onGenerateChapters(node);
                    }}
                    disabled={node.status === "generating"}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditing(true);
                  }}
                >
                  <Edit3 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:bg-destructive/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeNode(node.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
