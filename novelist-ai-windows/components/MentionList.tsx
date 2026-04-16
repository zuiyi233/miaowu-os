import React, { forwardRef, useImperativeHandle, useState } from "react";
import { Card } from "./ui/card";
import { MentionOption } from "@/hooks/useMentionOptions";

/**
 * 统一提及列表组件
 * 用于在编辑器中显示可提及的所有实体类型（角色、场景、势力、物品）
 * 遵循单一职责原则，仅负责提及列表的显示和选择
 * 支持图标和类型标签，提供更好的视觉区分
 */
export const MentionList = forwardRef<any, any>((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 暴露键盘处理方法给父组件
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex(
          (selectedIndex + props.items.length - 1) % props.items.length
        );
        return true;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((selectedIndex + 1) % props.items.length);
        return true;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const item = props.items[selectedIndex];
        if (item) {
          props.command({ id: item.id, label: item.label });
        }
        return true;
      }

      return false;
    },
    resetIndex: () => setSelectedIndex(0),
  }));

  // 当组件挂载且 items 列表变化时，重置选中索引
  React.useEffect(() => {
    setSelectedIndex(0);
  }, [props.items.length]);

  // 获取类型标签的中文显示
  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'character': return '角色';
      case 'setting': return '场景';
      case 'faction': return '势力';
      case 'item': return '物品';
      default: return type;
    }
  };

  // 获取类型对应的颜色样式
  const getTypeColorClass = (type: string) => {
    switch (type) {
      case 'character': return 'text-blue-600';
      case 'setting': return 'text-green-600';
      case 'faction': return 'text-purple-600';
      case 'item': return 'text-orange-600';
      default: return 'text-gray-600';
    }
  };

  return (
    <Card className="overflow-hidden shadow-lg border min-w-[12rem]">
      {props.items.length > 0 ? (
        <div className="py-1">
          {props.items.map(
            (item: MentionOption, index: number) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors ${
                    index === selectedIndex
                      ? "bg-accent text-accent-foreground"
                      : ""
                  }`}
                  onClick={() => {
                    const item = props.items[index];
                    if (item) {
                      props.command({ id: item.id, label: item.label });
                    }
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  {/* 渲染图标 */}
                  {Icon && <Icon className="h-4 w-4 opacity-70" />}
                  
                  {/* 实体名称 */}
                  <span className="font-medium">{item.label}</span>
                  
                  {/* 类型标签 */}
                  <span className={`ml-auto text-xs opacity-70 ${getTypeColorClass(item.type)}`}>
                    {getTypeLabel(item.type)}
                  </span>
                </button>
              );
            }
          )}
        </div>
      ) : (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          无结果
        </div>
      )}
    </Card>
  );
});

MentionList.displayName = "MentionList";
