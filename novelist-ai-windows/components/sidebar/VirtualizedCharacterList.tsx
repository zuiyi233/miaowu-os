import React, { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Users } from "lucide-react";
import { Card } from "../ui/card";

/**
 * 虚拟化角色列表组件
 * 遵循单一职责原则，专注于高性能的角色列表渲染
 * 使用@tanstack/react-virtual实现虚拟化，提升大量数据时的性能
 */
export const VirtualizedCharacterList: React.FC<{
  characters: any[];
  onViewCharacter: (character: any) => void;
}> = ({ characters, onViewCharacter }) => {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: characters.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60, // 估算每个角色项的高度
    overscan: 3, // 在视口外额外渲染3个项
  });

  return (
    <div ref={parentRef} className="max-h-[300px] overflow-y-auto space-y-2">
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualItem) => {
          const char = characters[virtualItem.index];
          return (
            <div
              key={virtualItem.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <Card
                className="p-2 hover:bg-accent/50 transition-colors h-full cursor-pointer"
                onClick={() => onViewCharacter(char)}
              >
                <div className="flex items-center gap-2 h-full">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <Users className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{char.name}</div>
                    {char.description && (
                      <div className="text-xs text-muted-foreground truncate">
                        {char.description}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
};
