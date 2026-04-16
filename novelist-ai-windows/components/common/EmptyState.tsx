import React from "react";
import type { LucideProps } from "lucide-react";

/**
 * 空状态组件
 * 提供统一的空状态显示界面
 * 遵循单一职责原则，仅负责空状态的展示
 */
interface EmptyStateProps {
  icon: React.ComponentType<LucideProps>;
  title: string;
  description: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
}) => {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <Icon className="w-12 h-12 text-muted-foreground mb-4" />
      <p className="text-sm font-semibold text-muted-foreground mb-1">
        {title}
      </p>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
};
