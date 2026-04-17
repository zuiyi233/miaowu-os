'use client';

import { Loader2 } from 'lucide-react';

import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface SSELoadingOverlayProps {
  loading: boolean;
  progress: number;
  message: string;
}

export function SSELoadingOverlay({ loading, progress, message }: SSELoadingOverlayProps) {
  if (!loading) return null;

  const isComplete = progress >= 100;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background rounded-xl shadow-2xl p-8 sm:p-12 min-w-[360px] sm:min-w-[480px] max-w-[600px] mx-4">
        <div className="text-center mb-6">
          <Loader2 className="mx-auto w-12 h-12 text-primary animate-spin" />
          <h3 className={cn("mt-4 text-xl font-bold", isComplete ? "text-green-600" : "text-foreground")}>
            {isComplete ? '完成！' : 'AI生成中...'}
          </h3>
        </div>

        <div className="mb-3">
          <Progress value={Math.min(progress, 100)} className="h-3" />
        </div>

        <div className={cn("text-center text-3xl font-bold mb-2", isComplete ? "text-green-600" : "text-primary")}>
          {isComplete ? '100%' : `${Math.min(progress, 100)}%`}
        </div>

        <p className="text-center text-muted-foreground min-h-[24px]">
          {message || '准备生成...'}
        </p>

        {!isComplete && (
          <p className="text-center text-xs text-muted-foreground/70 mt-4">
            请勿关闭页面，生成过程需要一定时间
          </p>
        )}
      </div>
    </div>
  );
}
