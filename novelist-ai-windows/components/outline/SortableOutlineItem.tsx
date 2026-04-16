import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { OutlineItemContent } from "./OutlineItem";

interface SortableOutlineItemProps {
  node: any;
  level: number;
  onToggleExpand: (id: string) => void;
  isExpanded: boolean;
  onGenerateChapters: (node: any) => void;
}

/**
 * 可排序的大纲条目包装器组件
 * 使用 @dnd-kit 的 useSortable Hook 提供拖拽功能
 */
export const SortableOutlineItem: React.FC<SortableOutlineItemProps> = ({
  node,
  level,
  onToggleExpand,
  isExpanded,
  onGenerateChapters,
}) => {
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
        onToggleExpand={onToggleExpand}
        isExpanded={isExpanded}
        onGenerateChapters={onGenerateChapters}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
};
