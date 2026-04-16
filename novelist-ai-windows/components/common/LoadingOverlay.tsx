import React from "react";
import { Loader2 } from "lucide-react";

/**
 * 加载遮罩组件
 * 提供统一的加载状态显示界面
 * 遵循单一职责原则，仅负责加载状态的展示
 */
interface LoadingOverlayProps {
  title: string;
  description: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  title,
  description,
}) => {
  return (
    <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center rounded-md z-10">
      <div className="flex items-center gap-3 text-primary">
        <Loader2 className="w-8 h-8 animate-spin" />
        <div className="flex flex-col items-center">
          <span className="text-lg font-semibold">{title}</span>
          <span className="text-sm text-muted-foreground">{description}</span>
        </div>
      </div>
    </div>
  );
};
