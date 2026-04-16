import React, { useState, useEffect } from "react";
import { useSettingsStore } from "../../stores/useSettingsStore";
import {
  fetchProviderModels,
  testApiConnection,
} from "../../services/llmService"; // ✅ 引入测试函数
import { getModelSpec } from "../../src/lib/constants/modelSpecs";
import { Input } from "../ui/input";
import { Slider } from "../ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../ui/accordion";
import { FormControl, FormField, FormItem, FormLabel } from "../ui/form";
import { Button } from "../ui/button";
// ✅ 1. 引入 DropdownMenu 相关组件
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  Bot,
  Zap,
  Brain,
  Sparkles,
  Search,
  Database,
  PenTool,
  AlertCircle,
  Settings2,
  ChevronUp,
  RefreshCw,
  Loader2,
  ChevronDown, // ✅ 引入 ChevronDown 图标
  Check, // ✅ 引入 Check 图标
  Info, // ✅ 引入 Info 图标
  AlertTriangle, // ✅ 引入警告图标
  RotateCcw, // ✅ 引入重置图标
  Play, // ✅ 新增图标
} from "lucide-react";
import { toast } from "sonner";

interface ModelConfigFieldProps {
  task: keyof ReturnType<typeof useSettingsStore.getState>["modelSettings"];
  label: string;
  description?: string;
  form: any;
  recommendedModel?: string;
  temperatureDescription?: string;
}

// ... (TaskIcon 组件代码保持不变) ...
const TaskIcon = ({
  task,
  className,
}: {
  task: string;
  className?: string;
}) => {
  const props = { className: cn("w-4 h-4", className) };
  switch (task) {
    case "outline":
      return (
        <Brain {...props} className={cn(props.className, "text-purple-500")} />
      );
    case "continue":
      return (
        <PenTool
          {...props}
          className={cn(props.className, "text-orange-500")}
        />
      );
    case "polish":
      return (
        <Sparkles {...props} className={cn(props.className, "text-blue-500")} />
      );
    case "expand":
      return (
        <Zap {...props} className={cn(props.className, "text-green-500")} />
      );
    case "chat":
      return <Bot {...props} className={cn(props.className, "text-primary")} />;
    case "extraction":
      return (
        <Search {...props} className={cn(props.className, "text-amber-500")} />
      );
    case "embedding":
      return (
        <Database
          {...props}
          className={cn(props.className, "text-slate-500")}
        />
      );
    default:
      return <Bot {...props} />;
  }
};

export const ModelConfigField: React.FC<ModelConfigFieldProps> = ({
  task,
  label,
  description,
  form,
  recommendedModel,
  temperatureDescription,
}) => {
  // ✅ 1. 从 Store 中获取 providerModels 和 setProviderModels
  const { providers, providerModels, setProviderModels } = useSettingsStore();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [isTesting, setIsTesting] = useState(false); // ✅ 新增测试状态

  const currentProviderId = form.watch(`modelSettings.${task}.providerId`);
  const currentModel = form.watch(`modelSettings.${task}.model`);

  const provider = providers.find((p) => p.id === currentProviderId);
  const isOrphan = currentProviderId && !provider;
  const isConfigured = provider && currentModel;
  const isEmbedding = task === "embedding"; // ✅ 标记是否为 Embedding 任务

  // ✅ 新增：获取当前模型的规格
  const modelSpec = getModelSpec(currentModel);
  const currentMaxTokens = form.watch(`modelSettings.${task}.maxTokens`);

  // 判断是否超过推荐值
  const isExceedingLimit = Number(currentMaxTokens) > modelSpec.maxOutput;

  // ✅ 2. 从全局 Store 获取当前 Provider 的模型列表 (如果存在)
  const cachedModels = currentProviderId
    ? providerModels[currentProviderId] || []
    : [];

  const handleFetchModels = async () => {
    if (!currentProviderId) {
      toast.error("请先选择服务商");
      return;
    }

    setIsFetchingModels(true);
    try {
      const models = await fetchProviderModels(currentProviderId);
      if (models.length > 0) {
        // ✅ 3. 更新全局 Store，而不是本地 State
        setProviderModels(currentProviderId, models);
        toast.success(`成功获取 ${models.length} 个模型`);
      } else {
        toast.warning("服务商返回了空模型列表");
      }
    } catch (error) {
      toast.error("获取模型失败", {
        description: error instanceof Error ? error.message : "网络错误",
      });
    } finally {
      setIsFetchingModels(false);
    }
  };

  // ✅ 新增：测试连接功能
  const handleTestConnection = async (e: React.MouseEvent) => {
    e.stopPropagation(); // 防止触发表单折叠
    if (!provider || !currentModel) {
      toast.error("请先完善服务商和模型配置");
      return;
    }

    setIsTesting(true);
    try {
      await testApiConnection({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: currentModel,
      });
      toast.success(`[${label}] 连接成功！`, {
        description: `模型 ${currentModel} 响应正常`,
      });
    } catch (error) {
      toast.error(`[${label}] 连接失败`, {
        description: (error as Error).message,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const defaultModels = [
    "gpt-4o",
    "gpt-4o-mini",
    "claude-3-5-sonnet-20241022",
    "deepseek-chat",
    "deepseek-reasoner",
    "gemini-2.0-flash-exp",
    "gemini-1.5-pro",
  ];

  const embeddingModels = ["text-embedding-3-small", "text-embedding-3-large"]; // Embedding 专用推荐

  // ✅ 4. 合并列表：优先显示缓存的模型，其次是默认推荐
  const displayModels = Array.from(
    new Set([
      ...cachedModels,
      ...(isEmbedding ? embeddingModels : defaultModels),
    ])
  );

  return (
    <AccordionItem
      value={task}
      className={cn(
        "group border rounded-xl bg-card transition-all duration-200",
        "hover:shadow-md hover:border-primary/20",
        isOrphan ? "border-destructive/50 bg-destructive/5" : "border-border/40"
      )}
    >
      <div className="px-4 py-3">
        <div className="flex items-center justify-between w-full pr-2">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "p-2 rounded-lg transition-colors",
                isConfigured
                  ? "bg-primary/5 group-hover:bg-primary/10"
                  : "bg-muted group-hover:bg-muted/80"
              )}
            >
              <TaskIcon task={task} />
            </div>
            <div className="text-left">
              <div className="font-medium text-sm text-foreground/90">
                {label}
              </div>
              <div className="text-[11px] text-muted-foreground font-normal line-clamp-1">
                {isOrphan ? (
                  <span className="text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> 服务商已失效
                  </span>
                ) : !isConfigured ? (
                  <span className="opacity-70">点击配置...</span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500/70" />
                    {currentModel}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 右侧状态与按钮 */}
          <div className="flex items-center gap-2">
            {provider && (
              <span className="bg-muted/50 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground/70 font-mono hidden sm:inline-block">
                {provider.name}
              </span>
            )}
            {/* ✅ 测试按钮 */}
            {isConfigured && (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-muted-foreground hover:text-green-600"
                onClick={handleTestConnection}
                disabled={isTesting}
                title="测试此配置"
              >
                {isTesting ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Play className="w-3 h-3" />
                )}
              </Button>
            )}
            {/* AccordionTrigger 箭头 */}
            <AccordionTrigger className="hover:no-underline p-0 h-6 w-6" />
          </div>
        </div>
      </div>

      <AccordionContent className="px-4 pb-4 pt-1">
        <div className="space-y-4 animate-in fade-in-0 zoom-in-95 duration-200">
          <p className="text-xs text-muted-foreground mb-3 bg-muted/30 p-2 rounded border border-border/50">
            {description}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name={`modelSettings.${task}.providerId`}
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel className="text-[11px] text-muted-foreground">
                    服务商
                  </FormLabel>
                  <Select
                    onValueChange={(val) => {
                      field.onChange(val);
                      // 切换服务商时，不需要清空全局缓存，UI 会自动根据新的 val 读取对应的缓存
                    }}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="选择服务商" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {providers.map((p) => (
                        <SelectItem key={p.id} value={p.id} className="text-xs">
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />

            {/* ✅ 2. 改造后的模型输入框：Input + Dropdown */}
            <FormField
              control={form.control}
              name={`modelSettings.${task}.model`}
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <FormLabel className="text-[11px] text-muted-foreground">
                      模型 ID
                    </FormLabel>
                    <div
                      className="flex items-center gap-1 text-[10px] text-primary cursor-pointer hover:underline"
                      onClick={handleFetchModels}
                    >
                      {isFetchingModels ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3" />
                      )}
                      {/* ✅ 5. 优化文案：如果有缓存，显示"刷新列表"，否则显示"获取列表" */}
                      {isFetchingModels
                        ? "获取中..."
                        : cachedModels.length > 0
                        ? "刷新列表"
                        : "获取列表"}
                    </div>
                  </div>
                  <FormControl>
                    <div className="relative flex items-center">
                      {/* 输入框 */}
                      <Input
                        {...field}
                        className="h-8 text-xs font-mono pr-8" // 留出右侧空间给下拉按钮
                        placeholder={recommendedModel}
                        autoComplete="off"
                      />

                      {/* 下拉选择菜单 */}
                      <div className="absolute right-0 top-0 bottom-0 flex items-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-l-none border-l border-input hover:bg-accent"
                              title="选择模型"
                            >
                              <ChevronDown className="h-4 w-4 opacity-50" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="w-[200px] max-h-[300px] overflow-y-auto"
                          >
                            {displayModels.length === 0 ? (
                              <div className="p-2 text-xs text-muted-foreground text-center">
                                暂无模型，请先点击"获取列表"
                              </div>
                            ) : (
                              displayModels.map((m) => (
                                <DropdownMenuItem
                                  key={m}
                                  onClick={() => field.onChange(m)}
                                  className="text-xs font-mono flex justify-between items-center cursor-pointer"
                                >
                                  <span className="truncate">{m}</span>
                                  {field.value === m && (
                                    <Check className="h-3 w-3 text-primary ml-2 flex-shrink-0" />
                                  )}
                                </DropdownMenuItem>
                              ))
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </FormControl>
                </FormItem>
              )}
            />
          </div>

          {/* ✅ Embedding 任务不显示生成参数 */}
          {!isEmbedding && (
            <div className="bg-muted/20 rounded-lg p-3 border border-border/50 space-y-3">
              <FormField
                control={form.control}
                name={`modelSettings.${task}.temperature`}
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <div className="flex justify-between items-center">
                      <FormLabel className="text-[11px] font-medium">
                        创造性 (Temperature)
                      </FormLabel>
                      <span className="text-[10px] font-mono bg-background px-1.5 py-0.5 rounded border">
                        {field.value}
                      </span>
                    </div>
                    <FormControl>
                      <Slider
                        value={[field.value]}
                        onValueChange={(v) => field.onChange(v[0])}
                        min={0}
                        max={2}
                        step={0.1}
                        className="[&>.relative>.bg-primary]:bg-gradient-to-r from-sky-400 via-violet-400 to-fuchsia-400"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name={`modelSettings.${task}.maxTokens`}
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <div className="flex justify-between items-center">
                        <FormLabel className="text-[10px] text-muted-foreground">
                          最大输出 (Max Tokens)
                        </FormLabel>
                        {/* ✅ 显示模型限制提示 */}
                        <span
                          className="text-[9px] text-muted-foreground flex items-center gap-1"
                          title={`该模型推荐最大输出: ${modelSpec.maxOutput}`}
                        >
                          <Info className="w-3 h-3" />
                          上限: {modelSpec.maxOutput}
                        </span>
                      </div>
                      <FormControl>
                        <div className="space-y-2">
                          <Input
                            type="number"
                            {...field}
                            value={field.value ?? ""}
                            className="h-7 text-xs bg-background"
                            // ✅ 动态设置 max 属性
                            max={modelSpec.maxOutput}
                            onChange={(e) => {
                              const value = e.target.value;
                              field.onChange(value === "" ? "" : Number(value));
                            }}
                          />
                          {/* ✅ 添加一个快速滑块，范围根据模型动态调整 */}
                          <Slider
                            value={[Number(field.value) || 4096]}
                            min={256}
                            max={modelSpec.maxOutput} // 动态上限
                            step={256}
                            onValueChange={(v) => field.onChange(v[0])}
                            className="py-1"
                          />
                        </div>
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="flex items-end justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground hover:text-primary w-full"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                  >
                    {showAdvanced ? (
                      <ChevronUp className="w-3 h-3 mr-1" />
                    ) : (
                      <Settings2 className="w-3 h-3 mr-1" />
                    )}
                    {showAdvanced ? "收起高级参数" : "展开高级参数"}
                  </Button>
                </div>
              </div>

              {showAdvanced && (
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/50 animate-in slide-in-from-top-2 fade-in duration-200">
                  <FormField
                    control={form.control}
                    name={`modelSettings.${task}.topP`}
                    render={({ field }) => (
                      <FormItem className="space-y-1">
                        <FormLabel className="text-[10px] text-muted-foreground">
                          Top P (核采样)
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step={0.1}
                            min={0}
                            max={1}
                            {...field}
                            value={field.value ?? ""}
                            className="h-7 text-xs bg-background"
                            onChange={(e) => {
                              const value = e.target.value;
                              field.onChange(value === "" ? "" : value);
                            }}
                            placeholder="默认 1.0"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`modelSettings.${task}.presencePenalty`}
                    render={({ field }) => (
                      <FormItem className="space-y-1">
                        <FormLabel className="text-[10px] text-muted-foreground">
                          话题新鲜度 (Presence)
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step={0.1}
                            min={-2}
                            max={2}
                            {...field}
                            value={field.value ?? ""}
                            className="h-7 text-xs bg-background"
                            onChange={(e) => {
                              const value = e.target.value;
                              field.onChange(value === "" ? "" : value);
                            }}
                            placeholder="范围 -2.0 到 2.0"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`modelSettings.${task}.frequencyPenalty`}
                    render={({ field }) => (
                      <FormItem className="space-y-1">
                        <FormLabel className="text-[10px] text-muted-foreground">
                          重复惩罚 (Frequency)
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step={0.1}
                            min={-2}
                            max={2}
                            {...field}
                            value={field.value ?? ""}
                            className="h-7 text-xs bg-background"
                            onChange={(e) => {
                              const value = e.target.value;
                              field.onChange(value === "" ? "" : value);
                            }}
                            placeholder="范围 -2.0 到 2.0"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`modelSettings.${task}.topK`}
                    render={({ field }) => (
                      <FormItem className="space-y-1">
                        <FormLabel className="text-[10px] text-muted-foreground">
                          Top K (仅部分模型)
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step={1}
                            {...field}
                            value={field.value ?? ""}
                            className="h-7 text-xs bg-background"
                            onChange={(e) => {
                              const value = e.target.value;
                              field.onChange(value === "" ? "" : value);
                            }}
                            placeholder="例如 40"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
};
