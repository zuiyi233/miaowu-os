import React, { useState, useRef, useCallback, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
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
import { LanguageSelector } from "./LanguageSelector";

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

const createGenerationConfigSchema = (t: TFunction) =>
  z.object({
    providerId: z.string().min(1, t("settings_dialog.providerRequired")),
    model: z.string().min(1, t("settings_dialog.modelRequired")),
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

const createEmbeddingConfigSchema = (t: TFunction) =>
  z.object({
    providerId: z
      .string()
      .min(1, t("settings_dialog.providerRequired"))
      .default(""),
    model: z.string().min(1, t("settings_dialog.modelRequired")).default(""),
  });

const createRefinedFormSchema = (t: TFunction) => {
  const generationConfigSchema = createGenerationConfigSchema(t);
  const embeddingConfigSchema = createEmbeddingConfigSchema(t);

  return z.object({
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
      embedding: embeddingConfigSchema,
    }),
  });
};

type FormValues = z.infer<ReturnType<typeof createRefinedFormSchema>>;

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
  const { t } = useTranslation();
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
      toast.error(t("settings_dialog.selectProviderFirst"));
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

    toast.success(t("settings_dialog.appliedToAll", { model: selectedModel }));
  };

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-medium">{t("settings_dialog.batchConfig")}</h3>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 items-end">
        <div className="w-full sm:w-1/3 space-y-1.5">
          <div className="text-xs text-muted-foreground font-medium">
            {t("settings_dialog.selectProvider")}
          </div>
          <Select
            value={selectedProviderId}
            onValueChange={handleProviderChange}
          >
            <SelectTrigger className="h-8 text-xs bg-background">
              <SelectValue placeholder={t("settings_dialog.selectProviderPlaceholder")} />
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
            {t("settings_dialog.selectModel")}
          </div>
          <Input
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            placeholder={t("settings_dialog.selectModelPlaceholder")}
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
          {t("settings_dialog.applyToAll")}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground mt-2">
        {t("settings_dialog.batchConfigNote")}
      </p>
    </div>
  );
};

// ----------------------------------------------------------------
// ✅ 新增：RAG 参数配置组件
// ----------------------------------------------------------------
const RagSettingsCard = () => {
  const { t } = useTranslation();
  const { ragOptions, setRagOptions } = useSettingsStore();

  return (
    <div className="p-4 border rounded-xl bg-card shadow-sm space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="p-1.5 bg-amber-500/10 rounded-md">
          <Sliders className="w-4 h-4 text-amber-600" />
        </div>
        <div>
          <h3 className="text-sm font-medium">{t("settings_dialog.ragSettings")}</h3>
          <p className="text-[10px] text-muted-foreground">
            {t("settings_dialog.ragSettingsDesc")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <div className="text-xs font-medium">{t("settings_dialog.ragThreshold")}</div>
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
            {t("settings_dialog.ragThresholdDesc")}
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <div className="text-xs font-medium">{t("settings_dialog.ragTopK")}</div>
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
            {t("settings_dialog.ragTopKDesc")}
          </p>
        </div>

        <div className="space-y-3 md:col-span-2 border-t pt-4 mt-2">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="text-xs font-medium">{t("settings_dialog.enableRerank")}</div>
              <p className="text-[10px] text-muted-foreground">
                {t("settings_dialog.enableRerankDesc")}
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
  const { t } = useTranslation();
  const settings = useSettingsStore();
  const refinedFormSchema = useMemo(() => createRefinedFormSchema(t), [t]);

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
      toast.success(t("settings_dialog.saveSuccess"));
      onClose();
    },
    [settings, onClose, t]
  );

  // ✅ 新增：错误处理函数
  const onInvalid = useCallback((errors: any) => {
    // ✅ 详细记录验证错误，方便排查哪个字段挂了
    logger.error("SettingsDialog", "Validation Failed", errors);

    toast.error(t("settings_dialog.saveFailed"), {
      description: t("settings_dialog.saveFailedDesc"),
    });
  }, [t]);

  const handleClearAllData = useCallback(async () => {
    try {
      toast.info(t("settings_dialog.clearingData"));
      await databaseService.clearAllData();
      await queryClient.invalidateQueries();
      toast.success(t("settings_dialog.dataCleared"));
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      toast.error(t("settings_dialog.clearDataFailed"), {
        description: (error as Error).message,
      });
    }
    setIsClearDataAlertOpen(false);
  }, [queryClient]);

  const handleExportData = useCallback(async () => {
    setIsExporting(true);
    try {
      toast.info(t("settings_dialog.exportingData"));
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
      toast.success(t("settings_dialog.dataExported"));
    } catch (error) {
      toast.error(t("settings_dialog.exportFailed"), { description: (error as Error).message });
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
          if (typeof result !== "string") {
            throw new Error(t("settings_dialog.cannotReadFile"));
          }
          const data = JSON.parse(result);
          if (data.version !== 1 || !Array.isArray(data.novels))
            throw new Error(t("settings_dialog.invalidFileFormat"));
          toast.info(t("settings_dialog.importingData"));
          for (const novel of data.novels)
            await databaseService.saveNovel(novel);
          await queryClient.invalidateQueries();
          toast.success(t("settings_dialog.dataImported"));
          setTimeout(() => window.location.reload(), 1500);
        } catch (error) {
          toast.error(t("settings_dialog.importFailed"), {
            description: (error as Error).message,
          });
        } finally {
          setIsImporting(false);
        }
      };
      reader.readAsText(file);
    },
    [queryClient, t]
  );

  const handleResetApplication = useCallback(async () => {
    try {
      settings.resetSettings();
      await queryClient.invalidateQueries();
      toast.success(t("settings_dialog.appReset"));
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      toast.error(t("settings_dialog.resetFailed"), { description: (error as Error).message });
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
                  <DialogTitle className="text-xl">
                    {t("settings_dialog.title")}
                  </DialogTitle>
                  <DialogDescription className="mt-1">
                    {t("settings_dialog.description")}
                  </DialogDescription>
                </div>
                <div className="flex items-center gap-3">
                  <LanguageSelector />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setIsResetAlertOpen(true)}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    {t("settings_dialog.resetDefault")}
                  </Button>
                </div>
              </div>
            </DialogHeader>

            {/* 2. 中间滚动区域 */}
            <div className="flex-1 overflow-hidden flex">
              <Tabs defaultValue="editor" className="flex-1 flex flex-col">
                {/* Tabs 导航栏 - 固定在顶部 */}
                <div className="px-6 pt-4 shrink-0">
                  <TabsList className="grid w-full grid-cols-5 h-10 bg-muted/50 p-1">
                    <TabsTrigger value="editor" className="gap-2">
                      <LayoutTemplate className="w-4 h-4" /> {t("settings_dialog.tabEditor")}
                    </TabsTrigger>
                    <TabsTrigger value="providers" className="gap-2">
                      <Server className="w-4 h-4" /> {t("settings_dialog.tabProvider")}
                    </TabsTrigger>
                    <TabsTrigger value="ai" className="gap-2">
                      <Sparkles className="w-4 h-4" /> {t("settings_dialog.tabModel")}
                    </TabsTrigger>
                    <TabsTrigger value="prompts" className="gap-2">
                      <PenTool className="w-4 h-4" /> {t("settings_dialog.tabPrompt")}
                    </TabsTrigger>
                    <TabsTrigger value="data" className="gap-2">
                      <Database className="w-4 h-4" /> {t("settings_dialog.tabData")}
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
                        title={t("settings_dialog.readingAndAppearance")}
                        description={t("settings_dialog.readingAndAppearanceDesc")}
                      />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <SettingBlock>
                          <FormField
                            control={form.control}
                            name="editorFont"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t("settings_dialog.fontFamily")}</FormLabel>
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
                                      {t("settings_dialog.loraSerif")}
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
                                  <FormLabel>{t("settings_dialog.fontSize")}</FormLabel>
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
                        title={t("settings_dialog.saveStrategy")}
                        description={t("settings_dialog.saveStrategyDesc")}
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
                                  <FormLabel>{t("settings_dialog.autoSave")}</FormLabel>
                                  <FormDescription>
                                    {t("settings_dialog.autoSaveDesc")}
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
                                        {t("settings_dialog.autoSaveDelay")}
                                      </FormLabel>
                                      <span className="text-xs text-muted-foreground">
                                        {field.value} {t("common.minutes")}
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
                                <FormLabel>{t("settings_dialog.autoSnapshot")}</FormLabel>
                                <FormDescription>
                                  {t("settings_dialog.autoSnapshotDesc")}
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
                            {t("settings_dialog.ragContextLimit")}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            {t("settings_dialog.ragContextLimitDesc")}
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
                                    {t("settings_dialog.contextStandard")}
                                  </SelectItem>
                                  <SelectItem value="32000">
                                    {t("settings_dialog.contextMedium")}
                                  </SelectItem>
                                  <SelectItem value="64000">
                                    {t("settings_dialog.contextLong")}
                                  </SelectItem>
                                  <SelectItem value="128000">
                                    {t("settings_dialog.contextUltraLong")}
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
                                {t("settings_dialog.midTermMemory")}
                              </h3>
                              <p className="text-xs text-muted-foreground">
                                {t("settings_dialog.midTermMemoryDesc")}
                              </p>
                            </div>
                            <span className="text-sm text-muted-foreground">
                              {t("settings_dialog.charTokens", { tokens: (form.watch("contextWindowSize") / 1.5).toFixed(0) })}
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
                                  {t("settings_dialog.midTermMemoryHint")}
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
                      <SectionHeader icon={PenTool} title={t("settings_dialog.coreCreation")} />
                      <Accordion
                        type="single"
                        collapsible
                        className="w-full grid grid-cols-1 lg:grid-cols-2 gap-3"
                      >
                        <ModelConfigField
                          task="outline"
                          label={t("modelConfig.outlineGeneration")}
                          description={t("modelConfig.outlineGenerationDesc")}
                          form={form}
                          recommendedModel="gemini-2.0-flash-exp"
                        />
                        <ModelConfigField
                          task="continue"
                          label={t("modelConfig.smartContinue")}
                          description={t("modelConfig.smartContinueDesc")}
                          form={form}
                          recommendedModel="claude-3-5-sonnet-20241022"
                        />
                        <ModelConfigField
                          task="expand"
                          label={t("modelConfig.plotExpand")}
                          description={t("modelConfig.plotExpandDesc")}
                          form={form}
                          recommendedModel="deepseek-reasoner"
                        />
                        <ModelConfigField
                          task="polish"
                          label={t("modelConfig.polishOptimize")}
                          description={t("modelConfig.polishOptimizeDesc")}
                          form={form}
                          recommendedModel="deepseek-chat"
                        />
                      </Accordion>
                    </div>

                    <div>
                      <SectionHeader icon={Sparkles} title={t("settings_dialog.auxiliaryTools")} />
                      <Accordion
                        type="single"
                        collapsible
                        className="w-full grid grid-cols-1 lg:grid-cols-2 gap-3"
                      >
                        <ModelConfigField
                          task="chat"
                          label={t("modelConfig.chatAssistant")}
                          description={t("modelConfig.chatAssistantDesc")}
                          form={form}
                          recommendedModel="gpt-4o"
                        />
                        <ModelConfigField
                          task="extraction"
                          label={t("modelConfig.infoExtraction")}
                          description={t("modelConfig.infoExtractionDesc")}
                          form={form}
                          recommendedModel="gpt-4o-mini"
                        />
                        <div className="lg:col-span-2">
                          <ModelConfigField
                            task="embedding"
                            label={t("modelConfig.embeddingSearch")}
                            description={t("modelConfig.embeddingSearchDesc")}
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
                        title={t("settings_dialog.backupAndMigration")}
                        description={t("settings_dialog.backupAndMigrationDesc")}
                      />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <SettingBlock className="flex flex-col justify-between gap-4">
                          <div>
                            <h4 className="font-medium text-sm mb-1">
                              {t("settings_dialog.exportData")}
                            </h4>
                            <p className="text-xs text-muted-foreground">
                              {t("settings_dialog.exportDataDesc")}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleExportData}
                            disabled={isExporting}
                            className="w-full"
                          >
                            <Download className="w-4 h-4 mr-2" /> {t("settings_dialog.exportBackup")}
                          </Button>
                        </SettingBlock>
                        <SettingBlock className="flex flex-col justify-between gap-4">
                          <div>
                            <h4 className="font-medium text-sm mb-1">
                              {t("settings_dialog.importData")}
                            </h4>
                            <p className="text-xs text-muted-foreground">
                              {t("settings_dialog.importDataDesc")}
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
                              <Upload className="w-4 h-4 mr-2" /> {t("settings_dialog.importDataButton")}
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
                      <SectionHeader icon={Database} title={t("settings_dialog.maintenanceAndReset")} />
                      <div className="space-y-4">
                        <SettingBlock>
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="font-medium text-sm">
                                {t("settings_dialog.dbHealthCheck")}
                              </h4>
                              <p className="text-xs text-muted-foreground mt-1">
                                {t("settings_dialog.dbHealthCheckDesc")}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={async () => {
                                toast.info(t("settings_dialog.checking"));
                                const res =
                                  await databaseService.performHealthCheck();
                                toast.success(
                                  t("settings_dialog.fixedCount", { count: res.fixedCount })
                                );
                              }}
                            >
                              {t("settings_dialog.startCheck")}
                            </Button>
                          </div>
                        </SettingBlock>
                        <div className="border border-destructive/30 bg-destructive/5 rounded-xl p-4 flex items-start gap-3">
                          <div className="p-2 bg-destructive/10 rounded-lg text-destructive">
                            <AlertTriangle className="w-5 h-5" />
                          </div>
                          <div className="flex-1">
                            <h4 className="font-medium text-sm text-destructive">
                              {t("settings_dialog.dangerZone")}
                            </h4>
                            <p className="text-xs text-muted-foreground mt-1 mb-3">
                              {t("settings_dialog.dangerZoneDesc")}
                            </p>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => setIsClearDataAlertOpen(true)}
                            >
                              {t("settings_dialog.clearAllData")}
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
                {t("common.cancel")}
              </Button>
              <Button type="submit">{t("common.saveChanges")}</Button>
            </div>
          </form>
        </Form>

        {/* Alerts */}
        <AlertDialog open={isResetAlertOpen} onOpenChange={setIsResetAlertOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("settings_dialog.confirmResetTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("settings_dialog.confirmResetDesc")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={handleResetApplication}>
                {t("common.reset")}
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
              <AlertDialogTitle>{t("settings_dialog.confirmClearTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("settings_dialog.confirmClearDesc")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleClearAllData}
                className="bg-destructive"
              >
                {t("common.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
};
