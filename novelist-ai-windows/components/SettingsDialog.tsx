import React, { useState, useRef, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useSettingsStore, AppSettings } from "../stores/useSettingsStore";
import { useQueryClient } from "@tanstack/react-query";
import { databaseService } from "../lib/storage/db";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Slider } from "./ui/slider";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  Dialog,
  DialogContent, // ✅ 必须包含这个
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "./ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Accordion } from "./ui/accordion";
import {
  Download,
  Upload,
  Trash2,
  Info,
  PenLine,
  Wrench,
  Save,
  Palette,
  Database,
  Shield,
  AlertTriangle,
  LayoutTemplate,
  Server,
  Sparkles,
  PenTool,
  FileText,
  Type,
  Zap,
  Copy,
  ListChecks,
  Sliders,
} from "lucide-react";
import { toast } from "sonner";
import { logger } from "../lib/logging"; // ✅ 引入 logger
import { PromptManager } from "./settings/PromptManager";
import { ProviderSettings } from "./settings/ProviderSettings";
import { ModelConfigField } from "./settings/ModelConfigField";

interface SettingsDialogProps {
  onClose: () => void;
}

// ✅ 修改：使用 preprocess 预处理数字输入，将空字符串转为 undefined
const preprocessEmptyStringToUndefined = (value: unknown) => {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }
  return value;
};

const preprocessNumber = (value: unknown) => {
  const processed = preprocessEmptyStringToUndefined(value);
  if (processed === undefined) return undefined;
  const num = Number(processed);
  return isNaN(num) ? undefined : num;
};

// 1. 定义通用的生成配置 schema
const generationConfigSchema = z.object({
  providerId: z.string().min(1, "请选择服务商"),
  model: z.string().min(1, "请输入模型ID"),
  temperature: z.preprocess(
    preprocessNumber,
    z.number().min(0).max(2).default(0.7)
  ),
  maxTokens: z.preprocess(
    preprocessNumber,
    z.number().int().min(1).default(4096)
  ),
  topP: z.preprocess(preprocessNumber, z.number().min(0).max(1).optional()),
  topK: z.preprocess(preprocessNumber, z.number().int().optional()),
  presencePenalty: z.preprocess(
    preprocessNumber,
    z.number().min(-2).max(2).optional()
  ),
  frequencyPenalty: z.preprocess(
    preprocessNumber,
    z.number().min(-2).max(2).optional()
  ),
});

// 2. 定义 Embedding 专用 schema (不需要温度等)
const embeddingConfigSchema = z.object({
  providerId: z.string().min(1, "请选择服务商").default(""), // 允许空字符串以便后续处理，或者必填
  model: z.string().min(1, "请输入模型ID").default(""),
  // 允许这些字段存在但不校验，或者直接忽略
});

// 3. 更新主 schema
const refinedFormSchema = z.object({
  autoSaveEnabled: z.boolean(),
  autoSaveDelay: z.number(),
  autoSnapshotEnabled: z.boolean(),
  editorFont: z.string(),
  editorFontSize: z.number(),
  contextTokenLimit: z.number(),
  contextWindowSize: z.number(),
  modelSettings: z.object({
    outline: generationConfigSchema,
    continue: generationConfigSchema,
    polish: generationConfigSchema,
    expand: generationConfigSchema,
    chat: generationConfigSchema,
    extraction: generationConfigSchema,
    embedding: embeddingConfigSchema, // ✅ 使用专用 Schema
  }),
});

type FormValues = z.infer<typeof refinedFormSchema>;

// --- 辅助组件 ---
const SectionHeader = ({
  icon: Icon,
  title,
  description,
}: {
  icon: any;
  title: string;
  description?: string;
}) => (
  <div className="flex items-center gap-2 px-1 mb-3 mt-4 first:mt-0">
    <div className="p-1.5 bg-primary/10 rounded-md">
      <Icon className="w-4 h-4 text-primary" />
    </div>
    <div className="flex flex-col">
      <h3 className="text-sm font-semibold text-foreground/80">{title}</h3>
      {description && (
        <p className="text-xs text-muted-foreground font-normal">
          {description}
        </p>
      )}
    </div>
  </div>
);

const SettingBlock = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={`border rounded-xl bg-card p-4 shadow-sm hover:shadow-md transition-all ${className}`}
  >
    {children}
  </div>
);

// ----------------------------------------------------------------
// ✅ 新增：批量配置组件 (BatchConfigurator)
// ----------------------------------------------------------------
const BatchConfigurator = ({ form }: { form: any }) => {
  const { providers, providerModels } = useSettingsStore();
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");

  // 当选择服务商时，自动选中第一个可用模型
  const handleProviderChange = (providerId: string) => {
    setSelectedProviderId(providerId);
    const models = providerModels[providerId] || [];
    if (models.length > 0) {
      setSelectedModel(models[0]);
    } else {
      setSelectedModel(""); // 或者设为常用默认值如 gpt-4o
    }
  };

  // 执行批量应用
  const handleApplyToAll = () => {
    if (!selectedProviderId || !selectedModel) {
      toast.error("请先选择服务商和模型");
      return;
    }

    const tasks = [
      "outline",
      "continue",
      "polish",
      "expand",
      "chat",
      "extraction",
    ];

    tasks.forEach((task) => {
      form.setValue(`modelSettings.${task}.providerId`, selectedProviderId, {
        shouldDirty: true,
      });
      form.setValue(`modelSettings.${task}.model`, selectedModel, {
        shouldDirty: true,
      });
    });

    toast.success(`已将 ${selectedModel} 应用于所有生成任务`);
  };

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-medium">一键全局配置</h3>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 items-end">
        <div className="w-full sm:w-1/3 space-y-1.5">
          <div className="text-xs text-muted-foreground font-medium">
            选择服务商
          </div>
          <Select
            value={selectedProviderId}
            onValueChange={handleProviderChange}
          >
            <SelectTrigger className="h-8 text-xs bg-background">
              <SelectValue placeholder="选择服务商..." />
            </SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-full sm:w-1/3 space-y-1.5">
          <div className="text-xs text-muted-foreground font-medium">
            选择模型
          </div>
          <Input
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            placeholder="输入或选择模型ID"
            className="h-8 text-xs bg-background font-mono"
          />
        </div>

        <Button
          type="button"
          size="sm"
          onClick={handleApplyToAll}
          className="w-full sm:w-auto h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Copy className="w-3 h-3 mr-2" />
          应用到所有任务
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground mt-2">
        * 将自动覆盖 大纲、续写、润色、扩写、对话、提取 的模型配置（Embedding
        除外）。
      </p>
    </div>
  );
};

// ----------------------------------------------------------------
// ✅ 新增：RAG 参数配置组件
// ----------------------------------------------------------------
const RagSettingsCard = () => {
  const { ragOptions, setRagOptions } = useSettingsStore();

  return (
    <div className="p-4 border rounded-xl bg-card shadow-sm space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="p-1.5 bg-amber-500/10 rounded-md">
          <Sliders className="w-4 h-4 text-amber-600" />
        </div>
        <div>
          <h3 className="text-sm font-medium">知识库检索参数 (RAG)</h3>
          <p className="text-[10px] text-muted-foreground">
            控制 AI 读取世界观设定的灵敏度
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <div className="text-xs font-medium">相似度阈值 (Threshold)</div>
            <span className="text-xs font-mono bg-muted px-1.5 rounded">
              {ragOptions.threshold}
            </span>
          </div>
          <Slider
            value={[ragOptions.threshold]}
            min={0.1}
            max={0.9}
            step={0.05}
            onValueChange={([val]) => setRagOptions({ threshold: val })}
          />
          <p className="text-[10px] text-muted-foreground">
            值越低，召回的资料越多但越不相关；值越高，越精准但可能漏掉关联信息。推荐
            0.45-0.6。
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <div className="text-xs font-medium">最大引用数量 (Top K)</div>
            <span className="text-xs font-mono bg-muted px-1.5 rounded">
              {ragOptions.limit}
            </span>
          </div>
          <Slider
            value={[ragOptions.limit]}
            min={1}
            max={20}
            step={1}
            onValueChange={([val]) => setRagOptions({ limit: val })}
          />
          <p className="text-[10px] text-muted-foreground">
            单次发送给 AI 的最大实体数量。数量过多会消耗大量 Token。推荐 5-10。
          </p>
        </div>

        {/* ✅ 新增：重排序开关 */}
        <div className="space-y-3 md:col-span-2 border-t pt-4 mt-2">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="text-xs font-medium">启用重排序 (Rerank)</div>
              <p className="text-[10px] text-muted-foreground">
                使用专门的模型对检索结果进行二次排序，显著提高相关性，但会增加延迟。
              </p>
            </div>
            <Switch
              checked={ragOptions.enableRerank}
              onCheckedChange={(checked) =>
                setRagOptions({ enableRerank: checked })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export const SettingsDialog: React.FC<SettingsDialogProps> = ({ onClose }) => {
  const settings = useSettingsStore();

  const form = useForm<FormValues>({
    resolver: zodResolver(refinedFormSchema) as any,
    defaultValues: {
      autoSaveEnabled: settings.autoSaveEnabled,
      autoSaveDelay: Math.round(settings.autoSaveDelay / 60000),
      autoSnapshotEnabled: settings.autoSnapshotEnabled,
      editorFont: settings.editorFont,
      editorFontSize: settings.editorFontSize,
      modelSettings: settings.modelSettings,
      contextTokenLimit: settings.contextTokenLimit,
      contextWindowSize: settings.contextWindowSize,
    },
  });

  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isResetAlertOpen, setIsResetAlertOpen] = useState(false);
  const [isClearDataAlertOpen, setIsClearDataAlertOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const onSubmit = useCallback(
    (values: FormValues) => {
      // ✅ 记录原始表单数据
      logger.debug("SettingsDialog", "Form submitted (Raw Values)", values);

      const settingsToSave: Partial<AppSettings> = {
        ...values,
        autoSaveDelay: values.autoSaveDelay * 60 * 1000,
        editorFont: values.editorFont as
          | "Lora"
          | "Plus Jakarta Sans"
          | "Fira Code",
        // 处理 nullable 字段，将 null 转换为 undefined
        modelSettings: {
          ...values.modelSettings,
          outline: {
            providerId: values.modelSettings.outline.providerId || "",
            model: values.modelSettings.outline.model || "",
            temperature: values.modelSettings.outline.temperature,
            maxTokens: values.modelSettings.outline.maxTokens,
            topP: values.modelSettings.outline.topP ?? undefined,
            topK: values.modelSettings.outline.topK ?? undefined,
            presencePenalty:
              values.modelSettings.outline.presencePenalty ?? undefined,
            frequencyPenalty:
              values.modelSettings.outline.frequencyPenalty ?? undefined,
          },
          continue: {
            providerId: values.modelSettings.continue.providerId || "",
            model: values.modelSettings.continue.model || "",
            temperature: values.modelSettings.continue.temperature,
            maxTokens: values.modelSettings.continue.maxTokens,
            topP: values.modelSettings.continue.topP ?? undefined,
            topK: values.modelSettings.continue.topK ?? undefined,
            presencePenalty:
              values.modelSettings.continue.presencePenalty ?? undefined,
            frequencyPenalty:
              values.modelSettings.continue.frequencyPenalty ?? undefined,
          },
          polish: {
            providerId: values.modelSettings.polish.providerId || "",
            model: values.modelSettings.polish.model || "",
            temperature: values.modelSettings.polish.temperature,
            maxTokens: values.modelSettings.polish.maxTokens,
            topP: values.modelSettings.polish.topP ?? undefined,
            topK: values.modelSettings.polish.topK ?? undefined,
            presencePenalty:
              values.modelSettings.polish.presencePenalty ?? undefined,
            frequencyPenalty:
              values.modelSettings.polish.frequencyPenalty ?? undefined,
          },
          expand: {
            providerId: values.modelSettings.expand.providerId || "",
            model: values.modelSettings.expand.model || "",
            temperature: values.modelSettings.expand.temperature,
            maxTokens: values.modelSettings.expand.maxTokens,
            topP: values.modelSettings.expand.topP ?? undefined,
            topK: values.modelSettings.expand.topK ?? undefined,
            presencePenalty:
              values.modelSettings.expand.presencePenalty ?? undefined,
            frequencyPenalty:
              values.modelSettings.expand.frequencyPenalty ?? undefined,
          },
          chat: {
            providerId: values.modelSettings.chat.providerId || "",
            model: values.modelSettings.chat.model || "",
            temperature: values.modelSettings.chat.temperature,
            maxTokens: values.modelSettings.chat.maxTokens,
            topP: values.modelSettings.chat.topP ?? undefined,
            topK: values.modelSettings.chat.topK ?? undefined,
            presencePenalty:
              values.modelSettings.chat.presencePenalty ?? undefined,
            frequencyPenalty:
              values.modelSettings.chat.frequencyPenalty ?? undefined,
          },
          extraction: {
            providerId: values.modelSettings.extraction.providerId || "",
            model: values.modelSettings.extraction.model || "",
            temperature: values.modelSettings.extraction.temperature,
            maxTokens: values.modelSettings.extraction.maxTokens,
            topP: values.modelSettings.extraction.topP ?? undefined,
            topK: values.modelSettings.extraction.topK ?? undefined,
            presencePenalty:
              values.modelSettings.extraction.presencePenalty ?? undefined,
            frequencyPenalty:
              values.modelSettings.extraction.frequencyPenalty ?? undefined,
          },
          embedding: {
            providerId: values.modelSettings.embedding.providerId || "",
            model: values.modelSettings.embedding.model || "",
          },
        },
      };

      // ✅ 记录处理后即将保存的数据
      logger.info("SettingsDialog", "Saving Settings Payload", settingsToSave);

      settings.setSettings(settingsToSave);
      toast.success("设置已保存！");
      onClose();
    },
    [settings, onClose]
  );

  // ✅ 新增：错误处理函数
  const onInvalid = useCallback((errors: any) => {
    // ✅ 详细记录验证错误，方便排查哪个字段挂了
    logger.error("SettingsDialog", "Validation Failed", errors);

    toast.error("设置保存失败", {
      description: "请检查表单中的错误项 (查看控制台详情)",
    });
  }, []);

  const handleClearAllData = useCallback(async () => {
    try {
      toast.info("正在清除所有小说数据...");
      await databaseService.clearAllData();
      await queryClient.invalidateQueries();
      toast.success("所有小说数据已清除！");
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      toast.error("清除数据失败", { description: (error as Error).message });
    }
    setIsClearDataAlertOpen(false);
  }, [queryClient]);

  const handleExportData = useCallback(async () => {
    setIsExporting(true);
    try {
      toast.info("正在导出数据...");
      const allNovels = await databaseService.getAllNovels();
      const exportData = JSON.stringify(
        { version: 1, novels: allNovels },
        null,
        2
      );
      const blob = new Blob([exportData], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mi-jing-novelist-backup-${
        new Date().toISOString().split("T")[0]
      }.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("数据已成功导出！");
    } catch (error) {
      toast.error("数据导出失败", { description: (error as Error).message });
    } finally {
      setIsExporting(false);
    }
  }, []);

  const handleImportData = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setIsImporting(true);
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const result = e.target?.result;
          if (typeof result !== "string") throw new Error("无法读取文件内容");
          const data = JSON.parse(result);
          if (data.version !== 1 || !Array.isArray(data.novels))
            throw new Error("文件格式无效");
          toast.info("正在导入数据...");
          for (const novel of data.novels)
            await databaseService.saveNovel(novel);
          await queryClient.invalidateQueries();
          toast.success("数据导入成功！");
          setTimeout(() => window.location.reload(), 1500);
        } catch (error) {
          toast.error("数据导入失败", {
            description: (error as Error).message,
          });
        } finally {
          setIsImporting(false);
        }
      };
      reader.readAsText(file);
    },
    [queryClient]
  );

  const handleResetApplication = useCallback(async () => {
    try {
      settings.resetSettings();
      await queryClient.invalidateQueries();
      toast.success("应用已重置！");
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      toast.error("重置失败", { description: (error as Error).message });
    }
    setIsResetAlertOpen(false);
  }, [settings, queryClient]);

  return (
    // ✅ 关键修改：直接使用 Dialog 包裹，并设置 max-w-[70vw]
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[70vw] w-[70vw] h-[80vh] flex flex-col p-0 gap-0 overflow-hidden sm:rounded-xl">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit, onInvalid)}
            className="flex flex-col h-full"
          >
            {/* 1. 固定页头 */}
            <DialogHeader className="px-6 py-4 border-b bg-muted/10 shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <DialogTitle className="text-xl">应用设置</DialogTitle>
                  <DialogDescription className="mt-1">
                    管理编辑器、AI 模型、服务商及数据备份。
                  </DialogDescription>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setIsResetAlertOpen(true)}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  恢复默认
                </Button>
              </div>
            </DialogHeader>

            {/* 2. 中间滚动区域 */}
            <div className="flex-1 overflow-hidden flex">
              <Tabs defaultValue="editor" className="flex-1 flex flex-col">
                {/* Tabs 导航栏 - 固定在顶部 */}
                <div className="px-6 pt-4 shrink-0">
                  <TabsList className="grid w-full grid-cols-5 h-10 bg-muted/50 p-1">
                    <TabsTrigger value="editor" className="gap-2">
                      <LayoutTemplate className="w-4 h-4" /> 编辑器
                    </TabsTrigger>
                    <TabsTrigger value="providers" className="gap-2">
                      <Server className="w-4 h-4" /> 服务商
                    </TabsTrigger>
                    <TabsTrigger value="ai" className="gap-2">
                      <Sparkles className="w-4 h-4" /> AI 模型
                    </TabsTrigger>
                    <TabsTrigger value="prompts" className="gap-2">
                      <PenTool className="w-4 h-4" /> 提示词
                    </TabsTrigger>
                    <TabsTrigger value="data" className="gap-2">
                      <Database className="w-4 h-4" /> 数据
                    </TabsTrigger>
                  </TabsList>
                </div>

                {/* 滚动内容区 */}
                <div className="flex-1 overflow-y-auto p-6 min-h-0">
                  {/* --- 编辑器设置 --- */}
                  <TabsContent value="editor" className="mt-0 space-y-6 h-full">
                    <div>
                      <SectionHeader
                        icon={Type}
                        title="阅读与外观"
                        description="自定义编辑器的视觉体验"
                      />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <SettingBlock>
                          <FormField
                            control={form.control}
                            name="editorFont"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>字体系列</FormLabel>
                                <Select
                                  onValueChange={field.onChange}
                                  defaultValue={field.value}
                                >
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="Lora">
                                      Lora (衬线体)
                                    </SelectItem>
                                    <SelectItem value="Plus Jakarta Sans">
                                      Plus Jakarta Sans
                                    </SelectItem>
                                    <SelectItem value="Fira Code">
                                      Fira Code
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              </FormItem>
                            )}
                          />
                        </SettingBlock>
                        <SettingBlock>
                          <FormField
                            control={form.control}
                            name="editorFontSize"
                            render={({ field }) => (
                              <FormItem>
                                <div className="flex justify-between">
                                  <FormLabel>字号大小</FormLabel>
                                  <span className="text-xs text-muted-foreground">
                                    {field.value}px
                                  </span>
                                </div>
                                <FormControl>
                                  <Slider
                                    value={[field.value]}
                                    onValueChange={(v) => field.onChange(v[0])}
                                    min={12}
                                    max={32}
                                    step={1}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </SettingBlock>
                      </div>
                    </div>

                    <div>
                      <SectionHeader
                        icon={Save}
                        title="保存策略"
                        description="配置自动保存和版本快照"
                      />
                      <SettingBlock className="space-y-4">
                        <div className="flex flex-row items-center justify-between">
                          <FormField
                            control={form.control}
                            name="autoSaveEnabled"
                            render={({ field }) => (
                              <FormItem className="flex flex-row items-center gap-3 space-y-0">
                                <FormControl>
                                  <Switch
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                  />
                                </FormControl>
                                <div className="space-y-0.5">
                                  <FormLabel>自动保存</FormLabel>
                                  <FormDescription>
                                    停止输入后自动保存草稿
                                  </FormDescription>
                                </div>
                              </FormItem>
                            )}
                          />
                          {form.watch("autoSaveEnabled") && (
                            <div className="w-1/2 max-w-[200px]">
                              <FormField
                                control={form.control}
                                name="autoSaveDelay"
                                render={({ field }) => (
                                  <FormItem>
                                    <div className="flex justify-between mb-2">
                                      <FormLabel className="text-xs">
                                        延迟时间
                                      </FormLabel>
                                      <span className="text-xs text-muted-foreground">
                                        {field.value} 分钟
                                      </span>
                                    </div>
                                    <FormControl>
                                      <Slider
                                        value={[field.value]}
                                        onValueChange={(v) =>
                                          field.onChange(v[0])
                                        }
                                        min={1}
                                        max={10}
                                        step={1}
                                      />
                                    </FormControl>
                                  </FormItem>
                                )}
                              />
                            </div>
                          )}
                        </div>
                        <div className="h-px bg-border/50" />
                        <FormField
                          control={form.control}
                          name="autoSnapshotEnabled"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center gap-3 space-y-0">
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                />
                              </FormControl>
                              <div className="space-y-0.5">
                                <FormLabel>智能快照</FormLabel>
                                <FormDescription>
                                  当内容发生重大变化时，自动创建历史版本。
                                </FormDescription>
                              </div>
                            </FormItem>
                          )}
                        />
                      </SettingBlock>
                    </div>
                  </TabsContent>

                  {/* --- 服务商设置 --- */}
                  <TabsContent value="providers" className="mt-0 h-full">
                    <ProviderSettings />
                  </TabsContent>

                  {/* --- AI 设置 --- */}
                  <TabsContent
                    value="ai"
                    className="mt-0 space-y-5 h-full pr-1"
                  >
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 border rounded-xl bg-card shadow-sm">
                        <div className="space-y-0.5">
                          <h3 className="text-sm font-medium">
                            RAG 上下文限制
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            控制发送给 AI 的最大历史记录长度
                          </p>
                        </div>
                        <FormField
                          control={form.control}
                          name="contextTokenLimit"
                          render={({ field }) => (
                            <FormItem className="w-[140px] space-y-0">
                              <Select
                                onValueChange={(val) =>
                                  field.onChange(parseInt(val, 10))
                                }
                                defaultValue={field.value.toString()}
                              >
                                <FormControl>
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="16000">
                                    16K (标准)
                                  </SelectItem>
                                  <SelectItem value="32000">
                                    32K (中等)
                                  </SelectItem>
                                  <SelectItem value="64000">
                                    64K (长文本)
                                  </SelectItem>
                                  <SelectItem value="128000">
                                    128K (超长)
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="p-4 border rounded-xl bg-card shadow-sm">
                        <div className="space-y-4">
                          <div className="flex justify-between items-center">
                            <div className="space-y-0.5">
                              <h3 className="text-sm font-medium">
                                🧠 中期记忆窗口 (原文回溯量)
                              </h3>
                              <p className="text-xs text-muted-foreground">
                                决定了 AI 能"看"到最近多少章的完整原文
                              </p>
                            </div>
                            <span className="text-sm text-muted-foreground">
                              {form.watch("contextWindowSize")} 字符 (约{" "}
                              {(form.watch("contextWindowSize") / 1.5).toFixed(
                                0
                              )}{" "}
                              Tokens)
                            </span>
                          </div>
                          <FormField
                            control={form.control}
                            name="contextWindowSize"
                            render={({ field }) => (
                              <FormItem>
                                <FormControl>
                                  <Slider
                                    value={[field.value]}
                                    min={2000}
                                    max={20000}
                                    step={1000}
                                    onValueChange={(vals) =>
                                      field.onChange(vals[0])
                                    }
                                    className="w-full"
                                  />
                                </FormControl>
                                <FormDescription className="text-xs">
                                  调大可提高连贯性，但会消耗更多 Token
                                  并可能降低响应速度。 建议：默认
                                  5000。如需强连贯性可设为 10000+。
                                </FormDescription>
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    </div>

                    {/* ✅ 插入 RAG 设置 */}
                    <RagSettingsCard />

                    <div className="h-px bg-border/50 my-2" />

                    {/* ✅ 插入 批量配置 */}
                    <BatchConfigurator form={form} />

                    <div>
                      <SectionHeader icon={PenTool} title="核心创作能力" />
                      <Accordion
                        type="single"
                        collapsible
                        className="w-full grid grid-cols-1 lg:grid-cols-2 gap-3"
                      >
                        <ModelConfigField
                          task="outline"
                          label="大纲生成"
                          description="生成章节结构和剧情大纲"
                          form={form}
                          recommendedModel="gemini-2.0-flash-exp"
                        />
                        <ModelConfigField
                          task="continue"
                          label="智能续写"
                          description="根据上文风格自动续写"
                          form={form}
                          recommendedModel="claude-3-5-sonnet-20241022"
                        />
                        <ModelConfigField
                          task="expand"
                          label="剧情扩写"
                          description="将简短句子扩展为丰富段落"
                          form={form}
                          recommendedModel="deepseek-reasoner"
                        />
                        <ModelConfigField
                          task="polish"
                          label="润色优化"
                          description="优化文笔和修正语病"
                          form={form}
                          recommendedModel="deepseek-chat"
                        />
                      </Accordion>
                    </div>

                    <div>
                      <SectionHeader icon={Sparkles} title="辅助与分析工具" />
                      <Accordion
                        type="single"
                        collapsible
                        className="w-full grid grid-cols-1 lg:grid-cols-2 gap-3"
                      >
                        <ModelConfigField
                          task="chat"
                          label="自由对话助手"
                          description="侧边栏聊天机器人"
                          form={form}
                          recommendedModel="gpt-4o"
                        />
                        <ModelConfigField
                          task="extraction"
                          label="信息提取"
                          description="提取角色关系和时间线"
                          form={form}
                          recommendedModel="gpt-4o-mini"
                        />
                        <div className="lg:col-span-2">
                          <ModelConfigField
                            task="embedding"
                            label="向量检索 (Embedding)"
                            description="构建本地知识库 (RAG)"
                            form={form}
                            recommendedModel="text-embedding-3-small"
                          />
                        </div>
                      </Accordion>
                    </div>
                  </TabsContent>

                  {/* --- 提示词设置 --- */}
                  <TabsContent value="prompts" className="mt-0 h-full">
                    <PromptManager />
                  </TabsContent>

                  {/* --- 数据管理 --- */}
                  <TabsContent value="data" className="mt-0 space-y-6 h-full">
                    <div>
                      <SectionHeader
                        icon={FileText}
                        title="备份与迁移"
                        description="导出数据以防止丢失，或迁移到新设备"
                      />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <SettingBlock className="flex flex-col justify-between gap-4">
                          <div>
                            <h4 className="font-medium text-sm mb-1">
                              导出数据
                            </h4>
                            <p className="text-xs text-muted-foreground">
                              导出为 JSON 文件。
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleExportData}
                            disabled={isExporting}
                            className="w-full"
                          >
                            <Download className="w-4 h-4 mr-2" /> 导出备份
                          </Button>
                        </SettingBlock>
                        <SettingBlock className="flex flex-col justify-between gap-4">
                          <div>
                            <h4 className="font-medium text-sm mb-1">
                              导入数据
                            </h4>
                            <p className="text-xs text-muted-foreground">
                              从备份文件恢复。
                            </p>
                          </div>
                          <div className="relative">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => fileInputRef.current?.click()}
                              disabled={isImporting}
                              className="w-full"
                            >
                              <Upload className="w-4 h-4 mr-2" /> 导入数据
                            </Button>
                            <input
                              type="file"
                              ref={fileInputRef}
                              onChange={handleImportData}
                              accept=".json"
                              className="hidden"
                            />
                          </div>
                        </SettingBlock>
                      </div>
                    </div>

                    <div>
                      <SectionHeader icon={Database} title="维护与重置" />
                      <div className="space-y-4">
                        <SettingBlock>
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="font-medium text-sm">
                                数据库健康检查
                              </h4>
                              <p className="text-xs text-muted-foreground mt-1">
                                修复孤儿数据。
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={async () => {
                                toast.info("正在检查...");
                                const res =
                                  await databaseService.performHealthCheck();
                                toast.success(
                                  `修复了 ${res.fixedCount} 个问题`
                                );
                              }}
                            >
                              开始检查
                            </Button>
                          </div>
                        </SettingBlock>
                        <div className="border border-destructive/30 bg-destructive/5 rounded-xl p-4 flex items-start gap-3">
                          <div className="p-2 bg-destructive/10 rounded-lg text-destructive">
                            <AlertTriangle className="w-5 h-5" />
                          </div>
                          <div className="flex-1">
                            <h4 className="font-medium text-sm text-destructive">
                              危险区域
                            </h4>
                            <p className="text-xs text-muted-foreground mt-1 mb-3">
                              永久删除所有本地数据。
                            </p>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => setIsClearDataAlertOpen(true)}
                            >
                              清除所有数据
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                </div>
              </Tabs>
            </div>

            {/* 3. 固定页脚 */}
            <div className="px-6 py-4 border-t bg-muted/10 shrink-0 flex justify-end gap-3">
              <Button type="button" variant="ghost" onClick={onClose}>
                取消
              </Button>
              <Button type="submit">保存更改</Button>
            </div>
          </form>
        </Form>

        {/* Alerts */}
        <AlertDialog open={isResetAlertOpen} onOpenChange={setIsResetAlertOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确定重置？</AlertDialogTitle>
              <AlertDialogDescription>
                重置所有设置为默认值。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={handleResetApplication}>
                重置
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog
          open={isClearDataAlertOpen}
          onOpenChange={setIsClearDataAlertOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确定清除数据？</AlertDialogTitle>
              <AlertDialogDescription>
                这将永久删除所有小说。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleClearAllData}
                className="bg-destructive"
              >
                清除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
};
