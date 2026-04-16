import React, { useState } from "react";
import { useSettingsStore, useTaskConfig } from "@/stores/useSettingsStore";
import { fetchProviderModels } from "@/services/llmService";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider"; // ✅ 新增
import { Checkbox } from "@/components/ui/checkbox"; // ✅ 新增
import {
  Bot,
  Settings2,
  Coins,
  Brain,
  Database,
  RefreshCw,
  FileText,
  BookOpen,
  Users,
} from "lucide-react";
import { toast } from "sonner";

// 定义上下文选项接口
export interface ContextOptions {
  enabled: boolean;
  includeWorld: boolean; // 实体（角色/势力/物品）
  includeChapter: boolean; // 当前章节内容
  includeOutline: boolean; // 小说大纲
}

interface ChatHeaderProps {
  title: string;
  tokenStats?: {
    prompt: number;
    completion: number;
    total: number;
  };
  contextOptions: ContextOptions;
  onContextOptionsChange: (opts: ContextOptions) => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  title,
  tokenStats,
  contextOptions,
  onContextOptionsChange,
}) => {
  const { updateModelConfig, providerModels, setProviderModels } =
    useSettingsStore();
  // 获取完整配置，包括 temperature 等
  const taskConfig = useTaskConfig("chat");
  const { model, provider, providerId } = taskConfig;
  // 确保 temperature 和 maxTokens 有默认值
  const temperature = (taskConfig as any).temperature || 0.7;
  const maxTokens = (taskConfig as any).maxTokens || 4096;

  const [isFetching, setIsFetching] = useState(false);

  const models = providerId ? providerModels[providerId] || [] : [];
  const displayModels = Array.from(
    new Set([...models, model, "gpt-4o", "gpt-4o-mini"])
  );

  const handleModelChange = (newModel: string) => {
    updateModelConfig("chat", { model: newModel });
    toast.success(`已切换至模型: ${newModel}`);
  };

  const handleRefreshModels = async () => {
    if (!providerId) return;
    setIsFetching(true);
    try {
      const fetchedModels = await fetchProviderModels(providerId);
      setProviderModels(providerId, fetchedModels);
      toast.success("模型列表已更新");
    } catch (e) {
      toast.error("获取模型失败");
    } finally {
      setIsFetching(false);
    }
  };

  // 估算费用
  const estimatedCost = tokenStats
    ? ((tokenStats.prompt * 5 + tokenStats.completion * 15) / 1000000).toFixed(
        4
      )
    : "0.0000";

  return (
    <div className="h-14 border-b bg-background/95 backdrop-blur flex items-center justify-between px-4 z-10 shrink-0">
      {/* 左侧：标题与模型选择 */}
      <div className="flex items-center gap-4">
        <div
          className="font-semibold text-sm hidden md:block truncate max-w-[150px]"
          title={title}
        >
          {title}
        </div>

        <div className="flex items-center gap-2">
          <Select value={model} onValueChange={handleModelChange}>
            <SelectTrigger className="h-8 w-[180px] text-xs bg-muted/50 border-border/50 focus:ring-0">
              <Bot className="w-3 h-3 mr-2 text-primary" />
              <SelectValue placeholder="选择模型" />
            </SelectTrigger>
            <SelectContent>
              <div className="px-2 py-1.5 text-xs text-muted-foreground flex justify-between items-center border-b mb-1">
                <span>{provider?.name || "未知服务商"}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4"
                  onClick={(e) => {
                    e.preventDefault();
                    handleRefreshModels();
                  }}
                  disabled={isFetching}
                >
                  <RefreshCw
                    className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`}
                  />
                </Button>
              </div>
              {displayModels.map((m) => (
                <SelectItem key={m} value={m} className="text-xs">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 右侧：工具栏 */}
      <div className="flex items-center gap-2">
        {/* Token 统计 (保持不变) */}
        {tokenStats && tokenStats.total > 0 && (
          <div className="hidden lg:flex items-center gap-3 text-xs text-muted-foreground bg-muted/30 px-3 py-1 rounded-full border border-border/40 mr-2">
            <div className="flex items-center gap-1" title="Prompt Tokens">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
              {tokenStats.prompt}
            </div>
            <div className="flex items-center gap-1" title="Completion Tokens">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
              {tokenStats.completion}
            </div>
            <div className="w-px h-3 bg-border"></div>
            <div className="flex items-center gap-1 text-foreground font-medium">
              <Coins className="w-3 h-3 text-yellow-500" />${estimatedCost}
            </div>
          </div>
        )}

        {/* ✅ 1. 增强版上下文设置 */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={contextOptions.enabled ? "secondary" : "ghost"}
              size="sm"
              className="h-8 gap-2 text-xs"
            >
              <Database
                className={`w-3.5 h-3.5 ${
                  contextOptions.enabled
                    ? "text-primary"
                    : "text-muted-foreground"
                }`}
              />
              <span className="hidden sm:inline">上下文</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="end">
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-2 border-b">
                <span className="font-medium text-sm">智能上下文</span>
                <Switch
                  checked={contextOptions.enabled}
                  onCheckedChange={(v) =>
                    onContextOptionsChange({ ...contextOptions, enabled: v })
                  }
                />
              </div>

              <div
                className={`space-y-2 ${
                  !contextOptions.enabled && "opacity-50 pointer-events-none"
                }`}
              >
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="ctx-world"
                    checked={contextOptions.includeWorld}
                    onCheckedChange={(v) =>
                      onContextOptionsChange({
                        ...contextOptions,
                        includeWorld: !!v,
                      })
                    }
                  />
                  <Label
                    htmlFor="ctx-world"
                    className="text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <Users className="w-3 h-3" /> 世界观 (角色/势力)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="ctx-chapter"
                    checked={contextOptions.includeChapter}
                    onCheckedChange={(v) =>
                      onContextOptionsChange({
                        ...contextOptions,
                        includeChapter: !!v,
                      })
                    }
                  />
                  <Label
                    htmlFor="ctx-chapter"
                    className="text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <FileText className="w-3 h-3" /> 当前章节内容
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="ctx-outline"
                    checked={contextOptions.includeOutline}
                    onCheckedChange={(v) =>
                      onContextOptionsChange({
                        ...contextOptions,
                        includeOutline: !!v,
                      })
                    }
                  />
                  <Label
                    htmlFor="ctx-outline"
                    className="text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <BookOpen className="w-3 h-3" /> 小说大纲
                  </Label>
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* ✅ 2. 修复并增强：模型参数设置 */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Settings2 className="w-4 h-4 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-4" align="end">
            <div className="space-y-4">
              <h4 className="font-medium text-sm">模型参数 (Chat)</h4>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span>创造性 (Temperature)</span>
                  <span className="text-muted-foreground">{temperature}</span>
                </div>
                <Slider
                  value={[temperature]}
                  min={0}
                  max={2}
                  step={0.1}
                  onValueChange={(v) =>
                    updateModelConfig("chat", { temperature: v[0] })
                  }
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span>最大回复 (Max Tokens)</span>
                  <span className="text-muted-foreground">{maxTokens}</span>
                </div>
                <Slider
                  value={[maxTokens]}
                  min={256}
                  max={8192}
                  step={256}
                  onValueChange={(v) =>
                    updateModelConfig("chat", { maxTokens: v[0] })
                  }
                />
              </div>

              <div className="pt-2 text-[10px] text-muted-foreground text-center">
                修改将自动保存并应用于后续对话
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
};
