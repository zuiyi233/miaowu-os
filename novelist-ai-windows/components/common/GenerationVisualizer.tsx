import React, { useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader2, Sparkles } from "lucide-react";
import { cn } from "../../lib/utils";

interface Step {
  id: string;
  label: string;
  duration: number; // 模拟耗时 (ms)
}

interface GenerationVisualizerProps {
  isGenerating: boolean;
  mode: "volumes" | "chapters"; // 区分是大纲生成还是章节生成
  log?: string; // 实时日志
}

const VOLUME_STEPS: Step[] = [
  { id: "analyze", label: "分析题材与核心元素", duration: 1500 },
  { id: "structure", label: "构建故事骨架与节奏", duration: 2500 },
  { id: "ideate", label: "推演分卷剧情", duration: 3000 },
  { id: "finalize", label: "生成最终大纲", duration: 1000 },
];

const CHAPTER_STEPS: Step[] = [
  { id: "read", label: "阅读上文与卷纲", duration: 1000 },
  { id: "conflict", label: "设计冲突与爽点", duration: 2000 },
  { id: "outline", label: "细化章节逻辑", duration: 2500 },
  { id: "format", label: "格式化输出", duration: 1000 },
];

export const GenerationVisualizer: React.FC<GenerationVisualizerProps> = ({
  isGenerating,
  mode,
  log,
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const steps = mode === "volumes" ? VOLUME_STEPS : CHAPTER_STEPS;

  // 模拟进度推进
  useEffect(() => {
    if (!isGenerating) {
      // 使用 setTimeout 避免同步调用 setState
      const resetTimeout = setTimeout(() => setCurrentStepIndex(0), 0);
      return () => clearTimeout(resetTimeout);
    }

    let timeout: NodeJS.Timeout;

    const advanceStep = (index: number) => {
      if (index >= steps.length - 1) return; // 停在最后一步直到 isGenerating 变 false

      timeout = setTimeout(() => {
        setCurrentStepIndex(index + 1);
        advanceStep(index + 1);
      }, steps[index].duration);
    };

    advanceStep(0);

    return () => clearTimeout(timeout);
  }, [isGenerating, steps]);

  if (!isGenerating) return null;

  return (
    <div className="bg-card border rounded-lg p-4 shadow-sm animate-in fade-in slide-in-from-top-2">
      <div className="flex items-center gap-2 mb-4 text-sm font-medium text-primary">
        <Sparkles className="w-4 h-4 animate-pulse" />
        AI 正在创作中...
      </div>

      <div className="space-y-3">
        {steps.map((step, index) => {
          const isCompleted = index < currentStepIndex;
          const isCurrent = index === currentStepIndex;
          const isPending = index > currentStepIndex;

          return (
            <div key={step.id} className="flex items-center gap-3">
              <div className="flex-shrink-0">
                {isCompleted ? (
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                ) : isCurrent ? (
                  <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                ) : (
                  <Circle className="w-5 h-5 text-muted-foreground/30" />
                )}
              </div>
              <div
                className={cn(
                  "text-sm transition-colors",
                  isCompleted
                    ? "text-muted-foreground"
                    : isCurrent
                    ? "text-foreground font-medium"
                    : "text-muted-foreground/50"
                )}
              >
                {step.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* 实时日志展示 (可选，增加极客感) */}
      {log && (
        <div className="mt-4 pt-3 border-t border-border/50">
          <div className="text-[10px] font-mono text-muted-foreground/70 truncate">
            {">"} {log.slice(-50)}
          </div>
        </div>
      )}
    </div>
  );
};
