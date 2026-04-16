import React, { useState } from "react";
import { useOutlineStore } from "../../stores/useOutlineStore";
import { useUiStore } from "../../stores/useUiStore";
import { databaseService } from "../../lib/storage/db";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import {
  Trash2,
  Edit3,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Loader2,
  GripVertical,
  Terminal,
  RefreshCcw, // ✅ 新增：校准图标
} from "lucide-react";
import { toast } from "sonner";

// --- 内部组件 SortableOutlineItem 和 OutlineItemContent ---

const SortableOutlineItem = ({ node, level, ...props }: any) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: node.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 999 : "auto",
    position: "relative" as const,
  };

  return (
    <div ref={setNodeRef} style={style} className={level > 0 ? "pt-2" : "mb-3"}>
      <OutlineItemContent
        node={node}
        level={level}
        dragHandleProps={{ ...attributes, ...listeners }}
        progressMessage={props.progressMessage}
        {...props}
      />
    </div>
  );
};

const OutlineItemContent = ({
  node,
  level,
  onToggleExpand,
  isExpanded,
  onGenerateChapters,
  onCalibrateVolume, // ✅ 新增：校准函数
  dragHandleProps,
  progressMessage, // ✅ 新增：进度消息
}: any) => {
  const {
    selectedNodeId,
    updateNode,
    removeNode,
    setSelectedNode,
    toggleSelection,
  } = useOutlineStore();

  const { currentNovelTitle } = useUiStore();

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(node.title);
  const [editDesc, setEditDesc] = useState(node.desc);

  const handleSave = () => {
    updateNode(node.id, { title: editTitle, desc: editDesc });
    setIsEditing(false);
  };

  // 🗑️ 智能删除处理
  const handleDelete = async () => {
    if (!currentNovelTitle) {
      toast.error("没有选中的小说");
      return;
    }

    const nodeTypeText = node.type === "volume" ? "卷" : "章节";
    const confirmMessage =
      node.type === "volume"
        ? `删除卷"${node.title}"将同时删除其下的所有章节，此操作不可恢复。确认删除吗？`
        : `确认删除章节"${node.title}"吗？此操作不可恢复。`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      // 调用数据库删除方法
      const result = await databaseService.deleteOutlineNodes(
        currentNovelTitle,
        [node.id]
      );

      // 从前端 Store 中移除节点
      removeNode(node.id);

      // 显示成功提示
      if (result.deletedVolumes > 0) {
        toast.success(
          `已删除卷"${node.title}"及其 ${result.deletedChapters} 个章节`
        );
      } else if (result.deletedChapters > 0) {
        toast.success(`已删除章节"${node.title}"`);
      }
    } catch (error) {
      console.error("删除失败:", error);
      toast.error(`删除${nodeTypeText}失败，请重试`);
    }
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
            relative transition-all duration-200 group cursor-default
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
          // 点击卡片任意位置（非按钮）选中/反选
          onClick={(e) => {
            if (
              !(e.target as HTMLElement).closest("button") &&
              !(e.target as HTMLElement).closest("input") &&
              !(e.target as HTMLElement).closest("textarea")
            ) {
              toggleSelection(node.id);
              setSelectedNode(node.id);
            }
          }}
        >
          {node.status === "generating" && (
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 animate-shimmer pointer-events-none" />
          )}

          <CardContent className="p-4 flex items-start gap-4">
            {/* 拖拽手柄 */}
            <div
              {...dragHandleProps}
              className="mt-2 cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground"
            >
              <GripVertical className="w-5 h-5" />
            </div>

            {/* 展开/折叠 & 勾选 */}
            <div className="flex flex-col items-center gap-2 pt-2">
              <Checkbox
                checked={node.isSelected}
                className="h-5 w-5 pointer-events-none"
              />
              {hasChildren && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 mt-1 text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleExpand(node.id);
                  }}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>

            {/* 内容区 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <Badge
                  variant={node.type === "volume" ? "default" : "outline"}
                  className={`text-xs px-2 py-1 h-6 ${
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
                    className="h-9 text-base font-bold"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="font-bold text-base truncate cursor-pointer hover:text-primary transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsEditing(true);
                    }}
                  >
                    {node.title}
                  </span>
                )}

                {node.status === "generating" && (
                  <div className="flex flex-col items-start">
                    <span className="flex items-center text-sm text-blue-500 animate-pulse">
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      AI 思考中...
                    </span>
                    {/* ✅ 显示具体的批次进度 */}
                    {progressMessage && (
                      <span className="text-xs text-muted-foreground mt-1">
                        {progressMessage}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {isEditing ? (
                <div
                  className="space-y-3 mt-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Textarea
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    className="text-sm min-h-[80px]"
                  />
                  <div className="flex justify-end gap-3">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setIsEditing(false)}
                      className="h-9 text-sm"
                    >
                      取消
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSave}
                      className="h-9 text-sm"
                    >
                      保存
                    </Button>
                  </div>
                </div>
              ) : (
                <p
                  className="text-sm text-muted-foreground leading-relaxed line-clamp-2 hover:line-clamp-none cursor-pointer transition-all"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditing(true);
                  }}
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
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                      title="生成本卷章节"
                      onClick={(e) => {
                        e.stopPropagation();
                        onGenerateChapters(node);
                      }}
                      disabled={node.status === "generating"}
                    >
                      <Sparkles className="h-4 w-4" />
                    </Button>
                    {/* ✅ 新增：校准按钮 */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                      title="根据前文实际剧情，智能修正本卷大纲"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onCalibrateVolume) {
                          onCalibrateVolume(node);
                        }
                      }}
                      disabled={node.status === "generating"}
                    >
                      <RefreshCcw className="h-4 w-4" />
                    </Button>
                  </>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditing(true);
                  }}
                >
                  <Edit3 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-destructive hover:bg-destructive/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete();
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 递归渲染子节点 (Level 2 - Chapters) */}
        {hasChildren && isExpanded && (
          <div className="mt-1">
            <SortableContext
              items={node.children.map((child: any) => child.id)}
              strategy={verticalListSortingStrategy}
            >
              {node.children.map((child: any) => (
                <SortableOutlineItem
                  key={child.id}
                  node={child}
                  level={level + 1}
                  onToggleExpand={onToggleExpand}
                  isExpanded={false}
                  onGenerateChapters={onGenerateChapters}
                  onCalibrateVolume={onCalibrateVolume} // ✅ 新增：传递校准函数
                  progressMessage={progressMessage}
                />
              ))}
            </SortableContext>
          </div>
        )}
      </div>
    </div>
  );
};

interface OutlineListPanelProps {
  tree: any[];
  isGenerating: boolean;
  generationLog: string;
  expandedNodes: Set<string>;
  onToggleExpand: (nodeId: string) => void;
  onGenerateChapters: (volumeNode: any) => void;
  onDragEnd: (event: DragEndEvent) => void;
  progressMessage?: string; // ✅ 新增：进度消息
  onCalibrateVolume?: (volumeNode: any) => void; // ✅ 新增：校准函数
}

export const OutlineListPanel: React.FC<OutlineListPanelProps> = ({
  tree,
  isGenerating,
  generationLog,
  expandedNodes,
  onToggleExpand,
  onGenerateChapters,
  onDragEnd,
  progressMessage, // ✅ 新增：进度消息
  onCalibrateVolume, // ✅ 新增：校准函数
}) => {
  const { selectAll, deselectAll, clearTree } = useOutlineStore();

  // 拖拽传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  return (
    <div className="h-full flex flex-col">
      {/* 顶部工具栏 */}
      <div className="p-4 border-b bg-background/80 backdrop-blur flex items-center justify-between shrink-0">
        <h3 className="text-lg font-semibold text-foreground">大纲结构</h3>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={selectAll}>
            全选
          </Button>
          <Button variant="ghost" size="sm" onClick={deselectAll}>
            全不选
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearTree}
            className="text-destructive hover:bg-destructive/10"
          >
            清空
          </Button>
        </div>
      </div>

      {/* 大纲列表区域 */}
      <ScrollArea className="flex-1 p-6">
        <div className="max-w-[1800px] mx-auto w-full pb-20">
          {tree.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-muted-foreground opacity-60 animate-in fade-in zoom-in duration-500">
              <div className="w-24 h-24 bg-muted/30 rounded-full flex items-center justify-center mb-6 ring-1 ring-border">
                <Sparkles className="h-12 w-12 opacity-20" />
              </div>
              <p className="text-sm">大纲生成结果将在这里显示</p>
              <p className="text-xs opacity-70 mt-1">
                请在右侧配置并点击"开始规划"
              </p>
            </div>
          ) : (
            <div className="space-y-2 pl-2">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
              >
                <SortableContext
                  items={tree.map((node) => node.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {tree.map((node) => (
                    <SortableOutlineItem
                      key={node.id}
                      node={node}
                      level={0}
                      onToggleExpand={onToggleExpand}
                      isExpanded={expandedNodes.has(node.id)}
                      onGenerateChapters={onGenerateChapters}
                      onCalibrateVolume={onCalibrateVolume} // ✅ 新增：传递校准函数
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* 生成日志 (悬浮在右下角) */}
      {generationLog && (
        <div className="absolute bottom-4 right-4 z-40 max-w-md w-full">
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground bg-background/90 backdrop-blur border p-2 rounded shadow-lg hover:bg-muted transition-all ml-auto mb-2">
              <Terminal className="w-3 h-3" /> 生成日志{" "}
              <ChevronDown className="w-3 h-3" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="text-[10px] text-green-400 bg-black/90 p-3 rounded-md font-mono h-48 overflow-y-auto shadow-2xl border border-green-900/50">
                {generationLog}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}
    </div>
  );
};
