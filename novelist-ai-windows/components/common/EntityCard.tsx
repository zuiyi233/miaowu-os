import React from "react";
import { Card } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";

/**
 * 实体卡片组件
 * 遵循 DRY 原则，统一角色、场景、势力等实体的显示样式
 * 遵循单一职责原则，专注于实体卡片的渲染逻辑
 */
interface EntityCardProps {
  icon: LucideIcon;
  name: string;
  description?: string;
  onClick: () => void;
  className?: string;
}

export const EntityCard: React.FC<EntityCardProps> = ({
  icon: Icon,
  name,
  description,
  onClick,
  className = "",
}) => {
  return (
    <Card
      className={`p-2 hover:bg-accent/50 transition-colors cursor-pointer h-full ${className}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-3 h-full">
        <div className="w-8 h-8 rounded-md bg-primary/20 flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{name}</div>
          {description && (
            <p className="text-xs text-muted-foreground truncate">
              {description}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
};
