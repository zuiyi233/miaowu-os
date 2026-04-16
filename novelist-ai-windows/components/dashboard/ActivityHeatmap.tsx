import React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { cn } from "../../lib/utils";

interface ActivityHeatmapProps {
  data?: { date: string; count: number }[];
}

export const ActivityHeatmap: React.FC<ActivityHeatmapProps> = ({ data }) => {
  // 如果没有传入数据，显示空状态
  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <div className="w-8 h-8 mb-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 3v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </div>
        <p className="text-sm">暂无创作记录</p>
      </div>
    );
  }

  // 基于真实数据计算活动级别
  const days = data.map(day => ({
    ...day,
    level: day.count === 0 ? 0 : day.count < 2 ? 1 : day.count < 4 ? 2 : 3
  }));

  const getLevelColor = (level: number) => {
    switch (level) {
      case 0: return "bg-muted/50"; // 空
      case 1: return "bg-primary/30"; // 少
      case 2: return "bg-primary/60"; // 中
      case 3: return "bg-primary";    // 多
      default: return "bg-muted/50";
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
        <span className="font-medium">创作热力 (近3个月)</span>
        <div className="flex items-center gap-1">
          <span>少</span>
          <div className="w-2 h-2 rounded-[1px] bg-muted/50" />
          <div className="w-2 h-2 rounded-[1px] bg-primary/30" />
          <div className="w-2 h-2 rounded-[1px] bg-primary/60" />
          <div className="w-2 h-2 rounded-[1px] bg-primary" />
          <span>多</span>
        </div>
      </div>
      
      {/* 
         使用 CSS Grid 绘制热力图 
         PC端显示 12周 (7 * 12 = 84格)
      */}
      <div className="grid grid-rows-7 grid-flow-col gap-1 w-fit">
        <TooltipProvider delayDuration={100}>
          {days.map((day, i) => (
            <Tooltip key={day.date}>
              <TooltipTrigger asChild>
                <div 
                  className={cn(
                    "w-2.5 h-2.5 md:w-3 md:h-3 rounded-[2px] transition-colors hover:ring-1 hover:ring-ring",
                    getLevelColor(day.level)
                  )}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {day.date}: {day.count > 0 ? `更新 ${day.count} 次` : "无活动"}
              </TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>
      </div>
    </div>
  );
};