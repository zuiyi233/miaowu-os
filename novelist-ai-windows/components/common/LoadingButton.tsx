import React from "react";
import { Button, ButtonProps } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

/**
 * 加载按钮组件的属性接口
 * 遵循单一职责原则，仅负责定义组件的输入参数
 */
interface LoadingButtonProps extends ButtonProps {
  isLoading: boolean;
  loadingText?: string;
}

/**
 * 加载按钮组件
 * 封装按钮加载状态的显示逻辑，遵循 DRY 原则
 * 提供统一的加载状态 UI 体验
 *
 * @param isLoading 是否处于加载状态
 * @param loadingText 加载时显示的文本，默认为"请稍候..."
 * @param props 标准 Button 组件的所有属性
 * @returns 渲染加载按钮组件
 */
export const LoadingButton = React.forwardRef<
  HTMLButtonElement,
  LoadingButtonProps
>(
  (
    { isLoading, loadingText = "请稍候...", children, disabled, ...props },
    ref
  ) => {
    return (
      <Button ref={ref} disabled={isLoading || disabled} {...props}>
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {loadingText}
          </>
        ) : (
          children
        )}
      </Button>
    );
  }
);

LoadingButton.displayName = "LoadingButton";
