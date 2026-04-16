import React, { useEffect, useState } from "react";
import { useContextStore } from "../../stores/useContextStore";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import {
  BrainCircuit,
  RefreshCw,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Users,
  MapPin,
  Box,
  Crown,
  Calendar,
  LayoutGrid,
  List,
} from "lucide-react";
import { cn } from "../../lib/utils";

// 辅助组件：信息卡片（详细模式）
const EntityCard = ({
  name,
  desc,
  isNew,
  icon: Icon,
  meta,
}: {
  name: string;
  desc?: string;
  isNew: boolean;
  icon: any;
  meta?: string;
}) => (
  <div
    className={cn(
      "flex items-start gap-3 p-3 rounded-lg border bg-card transition-all hover:bg-accent/50 group",
      isNew ? "border-green-500/30 bg-green-50/10" : "border-border"
    )}
  >
    <div
      className={cn(
        "p-2 rounded-md shrink-0",
        isNew
          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          : "bg-muted text-muted-foreground"
      )}
    >
      <Icon className="w-4 h-4" />
    </div>

    <div className="flex-1 min-w-0 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium truncate">{name}</span>
        {isNew && (
          <Badge
            variant="outline"
            className="text-[10px] h-4 px-1 border-green-500/50 text-green-600 bg-green-50"
          >
            新发现
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
        {desc || "暂无描述信息..."}
      </p>
      {meta && <div className="text-[10px] text-muted-foreground">{meta}</div>}
    </div>
  </div>
);

// 紧凑模式的标签组件
const CompactBadge = ({
  name,
  desc,
  isNew,
  variant = "secondary",
}: {
  name: string;
  desc?: string;
  isNew: boolean;
  variant?: "default" | "secondary" | "outline";
}) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger>
        <Badge
          variant={isNew ? "default" : variant}
          className={cn(
            "cursor-help transition-all relative pl-2",
            isNew ? "bg-green-100 border-green-300 text-green-800" : ""
          )}
        >
          {isNew && (
            <Sparkles className="w-2 h-2 mr-1 text-yellow-600 inline" />
          )}
          {name}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[200px] text-xs">
        <div className="space-y-1">
          <div className="font-medium">{name}</div>
          <div className="text-muted-foreground">{desc || "暂无简介"}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export const ContextRadar: React.FC = () => {
  const { activeData, diff, isDirty, isAnalyzing, performAnalysis } =
    useContextStore();

  // 视图模式状态：compact（紧凑/标签） vs list（详细/卡片）
  const [viewMode, setViewMode] = useState<"compact" | "list">("compact");

  const handleSync = async () => {
    const editorContent =
      document.querySelector(".ProseMirror")?.textContent || "";
    performAnalysis(editorContent);
  };

  const newCount = diff.newIds.size;
  const hasAnyContent =
    activeData.characters.length > 0 ||
    activeData.settings.length > 0 ||
    activeData.events.length > 0 ||
    activeData.factions.length > 0 ||
    activeData.items.length > 0;

  return (
    <div className="flex flex-col h-full bg-background/50 overflow-hidden">
      {/* Header: 包含视图切换按钮 */}
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0 bg-background">
        <div className="flex items-center gap-2">
          <BrainCircuit className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold">剧情雷达</span>
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
            Context
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* 视图切换按钮 */}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            onClick={() =>
              setViewMode(viewMode === "compact" ? "list" : "compact")
            }
            title={viewMode === "compact" ? "切换到详细视图" : "切换到紧凑视图"}
          >
            {viewMode === "compact" ? (
              <List className="w-3 h-3" />
            ) : (
              <LayoutGrid className="w-3 h-3" />
            )}
          </Button>

          {/* 同步按钮 */}
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              "h-6 text-[10px] px-2 gap-1.5 transition-colors",
              isDirty
                ? "text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                : "text-muted-foreground"
            )}
            onClick={handleSync}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? (
              <>
                <RefreshCw className="w-3 h-3 animate-spin" /> 分析中
              </>
            ) : isDirty ? (
              <>
                <AlertCircle className="w-3 h-3" /> 点击更新
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3 h-3 text-green-500" /> 已同步
              </>
            )}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-5">
          {/* 通知条 */}
          {newCount > 0 && (
            <div className="flex items-center gap-3 p-3 text-xs bg-green-50/50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 rounded-md text-green-700 dark:text-green-300">
              <Sparkles className="w-4 h-4 shrink-0 animate-pulse" />
              <span>
                本章新识别到 <strong>{newCount}</strong>{" "}
                个关联实体，已自动纳入上下文。
              </span>
            </div>
          )}

          {/* 根据视图模式渲染不同内容 */}
          {viewMode === "compact" ? (
            // 紧凑模式：显示标签
            <div className="space-y-4">
              {/* 时间线事件 */}
              {activeData.events.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> 当前事件
                    </h4>
                    <Badge variant="secondary" className="text-[10px] h-4">
                      {activeData.events.length}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {activeData.events.map((evt) => (
                      <CompactBadge
                        key={evt.id}
                        name={evt.title}
                        desc={evt.description}
                        isNew={diff.newIds.has(evt.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 角色 */}
              {activeData.characters.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                      <Users className="w-3 h-3" /> 在场角色
                    </h4>
                    <Badge variant="secondary" className="text-[10px] h-4">
                      {activeData.characters.length}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {activeData.characters.map((char) => (
                      <CompactBadge
                        key={char.id}
                        name={char.name}
                        desc={char.description}
                        isNew={diff.newIds.has(char.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 场景 */}
              {activeData.settings.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> 当前场景
                    </h4>
                    <Badge variant="secondary" className="text-[10px] h-4">
                      {activeData.settings.length}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {activeData.settings.map((setting) => (
                      <CompactBadge
                        key={setting.id}
                        name={setting.name}
                        desc={setting.description}
                        isNew={diff.newIds.has(setting.id)}
                        variant="outline"
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 势力 */}
              {activeData.factions.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                      <Crown className="w-3 h-3" /> 相关势力
                    </h4>
                    <Badge variant="secondary" className="text-[10px] h-4">
                      {activeData.factions.length}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {activeData.factions.map((faction) => (
                      <CompactBadge
                        key={faction.id}
                        name={faction.name}
                        desc={faction.description}
                        isNew={diff.newIds.has(faction.id)}
                        variant="outline"
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 物品 */}
              {activeData.items.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                      <Box className="w-3 h-3" /> 关键物品
                    </h4>
                    <Badge variant="secondary" className="text-[10px] h-4">
                      {activeData.items.length}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {activeData.items.map((item) => (
                      <CompactBadge
                        key={item.id}
                        name={item.name}
                        desc={item.description}
                        isNew={diff.newIds.has(item.id)}
                        variant="outline"
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            // 详细模式：显示卡片
            <div className="space-y-5">
              {/* 时间线事件 */}
              {activeData.events.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> 当前事件 (
                    {activeData.events.length})
                  </h4>
                  <div className="grid grid-cols-1 gap-2">
                    {activeData.events.map((evt) => (
                      <EntityCard
                        key={evt.id}
                        name={evt.title}
                        desc={evt.description}
                        isNew={diff.newIds.has(evt.id)}
                        icon={Calendar}
                        meta={evt.dateDisplay}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 角色 */}
              {activeData.characters.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <Users className="w-3 h-3" /> 在场角色 (
                    {activeData.characters.length})
                  </h4>
                  <div className="grid grid-cols-1 gap-2">
                    {activeData.characters.map((char) => (
                      <EntityCard
                        key={char.id}
                        name={char.name}
                        desc={char.description}
                        isNew={diff.newIds.has(char.id)}
                        icon={Users}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 场景 */}
              {activeData.settings.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> 当前场景 (
                    {activeData.settings.length})
                  </h4>
                  <div className="grid grid-cols-1 gap-2">
                    {activeData.settings.map((setting) => (
                      <EntityCard
                        key={setting.id}
                        name={setting.name}
                        desc={setting.description}
                        isNew={diff.newIds.has(setting.id)}
                        icon={MapPin}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 势力 */}
              {activeData.factions.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <Crown className="w-3 h-3" /> 相关势力 (
                    {activeData.factions.length})
                  </h4>
                  <div className="grid grid-cols-1 gap-2">
                    {activeData.factions.map((faction) => (
                      <EntityCard
                        key={faction.id}
                        name={faction.name}
                        desc={faction.description}
                        isNew={diff.newIds.has(faction.id)}
                        icon={Crown}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 物品 */}
              {activeData.items.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <Box className="w-3 h-3" /> 关键物品 (
                    {activeData.items.length})
                  </h4>
                  <div className="grid grid-cols-1 gap-2">
                    {activeData.items.map((item) => (
                      <EntityCard
                        key={item.id}
                        name={item.name}
                        desc={item.description}
                        isNew={diff.newIds.has(item.id)}
                        icon={Box}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Empty State */}
          {!hasAnyContent && (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground/50 space-y-2">
              <BrainCircuit className="w-8 h-8 opacity-20" />
              <p className="text-xs">暂无上下文关联</p>
              {isDirty && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 text-xs h-7 px-3 border-dashed"
                  onClick={handleSync}
                  disabled={isAnalyzing}
                >
                  {isAnalyzing ? (
                    <>
                      <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                      分析中...
                    </>
                  ) : (
                    <>
                      <BrainCircuit className="w-3 h-3 mr-1" />
                      开始分析
                    </>
                  )}
                </Button>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
