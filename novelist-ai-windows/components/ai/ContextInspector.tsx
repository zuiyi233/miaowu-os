import React, { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Progress } from "../ui/progress";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Database,
  FileText,
  BookOpen,
  Settings,
  Info,
  Layers,
  ChevronUp,
} from "lucide-react";
import { ContextStats } from "../../services/contextEngineService";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useModalStore } from "../../stores/useModalStore";
import { SettingsDialog } from "../SettingsDialog";
import { cn } from "../../lib/utils";

interface ContextInspectorProps {
  stats: ContextStats | null;
  loading: boolean;
}

export const ContextInspector: React.FC<ContextInspectorProps> = ({
  stats,
  loading,
}) => {
  const { contextWindowSize } = useSettingsStore();
  const { open } = useModalStore();
  const [isOpen, setIsOpen] = useState(false);

  // 计算百分比
  const totalChars = stats?.totalCharacters || 0;
  const usagePercent = Math.min((totalChars / contextWindowSize) * 100, 100);

  // 颜色状态
  const getStatusColor = () => {
    if (usagePercent > 90) return "bg-red-500";
    if (usagePercent > 70) return "bg-yellow-500";
    return "bg-green-500";
  };

  const handleOpenSettings = () => {
    setIsOpen(false);
    open({
      type: "dialog",
      component: SettingsDialog,
      props: {},
      title: "应用设置",
      description: "在这里管理编辑器、AI 和数据相关的应用配置。",
    });
  };

  return (
    <div className="w-full mb-3">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <div className="group cursor-help">
            {/* 顶部标签栏 */}
            <div className="flex justify-between items-end mb-1.5 px-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground group-hover:text-primary transition-colors">
                <Database className="w-3.5 h-3.5" />
                <span>AI 上下文记忆</span>
                <ChevronUp className="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="text-[10px] text-muted-foreground font-mono">
                {totalChars.toLocaleString()} /{" "}
                {contextWindowSize.toLocaleString()} 字符
              </div>
            </div>

            {/* 进度条区域 */}
            <div className="relative h-2 w-full bg-secondary rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full transition-all duration-500 ease-out",
                  getStatusColor()
                )}
                style={{ width: `${loading ? 0 : usagePercent}%` }}
              />
              {/* 装饰性刻度 */}
              <div className="absolute top-0 right-[20%] h-full w-px bg-background/50" />
              <div className="absolute top-0 right-[40%] h-full w-px bg-background/30" />
              <div className="absolute top-0 right-[60%] h-full w-px bg-background/30" />
              <div className="absolute top-0 right-[80%] h-full w-px bg-background/30" />
            </div>

            {/* 简要状态文本 */}
            <div className="mt-1 flex gap-2 justify-end text-[10px] text-muted-foreground/70">
              {stats?.previousChaptersCount ? (
                <span className="flex items-center gap-0.5">
                  <FileText className="w-3 h-3" />
                  {stats?.previousChaptersRange
                    ? `含${stats.previousChaptersRange}原文`
                    : `含前${stats.previousChaptersCount}章原文`}
                </span>
              ) : null}
              {stats?.includesSummary && (
                <span className="flex items-center gap-0.5">
                  <BookOpen className="w-3 h-3" /> 含全书摘要
                </span>
              )}
            </div>
          </div>
        </PopoverTrigger>

        {/* 悬浮详情卡片 */}
        <PopoverContent
          className="w-80 p-0 overflow-hidden"
          align="start"
          side="top"
        >
          <div className="bg-muted/50 p-3 border-b flex justify-between items-center">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              上下文构成分析
            </h4>
            <Badge variant="outline" className="text-[10px] h-5">
              {(totalChars / 1.5).toFixed(0)} Tokens (估)
            </Badge>
          </div>

          <div className="p-4 space-y-4">
            {/* 1. 记忆构成列表 */}
            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground flex items-center gap-2">
                  <BookOpen className="w-3.5 h-3.5" /> 长期记忆 (摘要)
                </span>
                {stats?.includesSummary ? (
                  <Badge
                    variant="default"
                    className="bg-green-500/15 text-green-600 hover:bg-green-500/25 border-0"
                  >
                    已加载
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">未启用</span>
                )}
              </div>

              <div className="flex justify-between items-center">
                <span className="text-muted-foreground flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5" /> 中期记忆 (原文)
                </span>
                <span className="text-xs font-medium">
                  {stats?.previousChaptersRange
                    ? `包含：${stats.previousChaptersRange}`
                    : `最近 ${stats?.previousChaptersCount || 0} 章`}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Info className="w-3.5 h-3.5" /> 本章前文
                </span>
                <span className="text-xs text-green-600 font-medium">包含</span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Database className="w-3.5 h-3.5" /> 文风协议
                </span>
                {stats?.includesStyle ? (
                  <Badge
                    variant="default"
                    className="bg-blue-500/15 text-blue-600 hover:bg-blue-500/25 border-0"
                  >
                    已注入
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">未设置</span>
                )}
              </div>
            </div>

            {/* 2. 使用情况可视化 */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">上下文使用率</span>
                <span
                  className={cn(
                    "font-medium",
                    usagePercent > 90
                      ? "text-red-600"
                      : usagePercent > 70
                      ? "text-yellow-600"
                      : "text-green-600"
                  )}
                >
                  {usagePercent.toFixed(1)}%
                </span>
              </div>
              <Progress value={usagePercent} className="h-2" />
            </div>

            {/* 3. 可视化提示 */}
            <div
              className={cn(
                "p-2 rounded text-xs border",
                usagePercent > 90
                  ? "bg-red-50/50 dark:bg-red-900/10 text-red-700 dark:text-red-300 border-red-100 dark:border-red-900/30"
                  : usagePercent > 70
                  ? "bg-yellow-50/50 dark:bg-yellow-900/10 text-yellow-700 dark:text-yellow-300 border-yellow-100 dark:border-yellow-900/30"
                  : "bg-green-50/50 dark:bg-green-900/10 text-green-700 dark:text-green-300 border-green-100 dark:border-green-900/30"
              )}
            >
              {usagePercent > 90
                ? "⚠️ 上下文接近上限，AI 可能会遗忘最早的内容。建议调大窗口大小。"
                : usagePercent > 70
                ? "💡 上下文使用率较高，如果 AI 遗忘剧情，可以尝试调大窗口大小。"
                : "✅ 上下文使用率正常，AI 能够很好地记忆前文内容。"}
            </div>

            {/* 4. 快速设置入口 */}
            <div className="pt-2 border-t">
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-8 text-xs justify-between text-muted-foreground hover:text-foreground"
                onClick={handleOpenSettings}
              >
                <span className="flex items-center gap-2">
                  <Settings className="w-3.5 h-3.5" /> 调整窗口大小
                </span>
                <span>当前: {contextWindowSize} 字符</span>
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
