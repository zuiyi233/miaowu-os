'use client';

import { Loader2, CircleStop } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface SSEProgressModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  progress: number;
  message: string;
  title?: string;
  showPercentage?: boolean;
  showIcon?: boolean;
  onCancel?: () => void;
  cancelButtonText?: string;
}

export function SSEProgressModal({
  open,
  onOpenChange,
  progress,
  message,
  title = 'AI生成中...',
  showPercentage = true,
  showIcon = true,
  onCancel,
  cancelButtonText = '取消任务',
}: SSEProgressModalProps) {
  const isComplete = progress >= 100;
  const isError = progress < 0;

  return (
    <Dialog open={open} onOpenChange={onCancel ? undefined : onOpenChange}>
      <DialogContent
        className="max-w-md sm:max-w-lg"
        onPointerDownOutside={(e) => onCancel ? e.preventDefault() : undefined}
        onEscapeKeyDown={(e) => onCancel ? e.preventDefault() : undefined}
      >
        <div className="flex flex-col items-center py-4">
          {/* 标题和图标 */}
          {showIcon && (
            <div className="text-center mb-6">
              {isError ? (
                <CircleStop className="mx-auto w-12 h-12 text-destructive" />
              ) : isComplete ? (
                <svg className="mx-auto w-12 h-12 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <Loader2 className="mx-auto w-12 h-12 text-primary animate-spin" />
              )}
              <div className={cn(
                "mt-4 text-xl font-bold",
                isComplete ? "text-green-600" : isError ? "text-destructive" : "text-foreground"
              )}>
                {isComplete ? '完成！' : isError ? '出错了' : title}
              </div>
            </div>
          )}

          {/* 进度条 */}
          <div className={cn("w-full", showPercentage ? "mb-3" : "mb-5")}>
            <Progress
              value={isError ? 0 : Math.min(progress, 100)}
              className={cn("h-3", isComplete && "[&>div]:bg-green-500")}
            />

            {/* 进度百分比 */}
            {showPercentage && (
              <div className={cn(
                "text-center text-3xl font-bold mt-3 mb-1",
                isComplete ? "text-green-600" : isError ? "text-destructive" : "text-primary"
              )}>
                {isError ? '--' : `${Math.min(progress, 100)}%`}
              </div>
            )}
          </div>

          {/* 状态消息 */}
          <p className={cn(
            "text-center min-h-[24px]",
            isComplete ? "text-green-600 font-medium" : isError ? "text-destructive" : "text-muted-foreground"
          )}>
            {message || (isComplete ? '任务已完成！' : '准备生成...')}
          </p>

          {/* 提示文字 */}
          {!isComplete && !isError && (
            <p className="text-center text-xs text-muted-foreground/70 mt-3 mb-4">
              请勿关闭页面，生成过程需要一定时间
            </p>
          )}

          {/* 取消按钮 */}
          {onCancel && !isComplete && !isError && (
            <Button
              variant="destructive"
              size="lg"
              className="mt-2"
              onClick={onCancel}
            >
              <CircleStop className="mr-2 h-4 w-4" />
              {cancelButtonText}
            </Button>
          )}

          {isComplete && (
            <Button
              variant="outline"
              size="lg"
              className="mt-2"
              onClick={() => onOpenChange(false)}
            >
              关闭
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
