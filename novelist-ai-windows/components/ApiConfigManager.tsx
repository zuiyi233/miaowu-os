import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useSettingsStore, type ApiConfig } from "../stores/useSettingsStore";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "./ui/form";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Eye,
  EyeOff,
  Plus,
  Edit,
  Trash2,
  TestTube,
  Check,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { testApiConnection } from "@/services/llmService"; // ✅ 引入真实的测试函数

/**
 * 预设配置列表
 * 帮助用户快速填写 Base URL
 */
const PROVIDER_PRESETS = [
  { name: "OpenAI (官方)", url: "https://api.openai.com/v1" },
  { name: "DeepSeek (深度求索)", url: "https://api.deepseek.com/v1" },
  { name: "Moonshot (Kimi)", url: "https://api.moonshot.cn/v1" },
  { name: "SiliconFlow (硅基流动)", url: "https://api.siliconflow.cn/v1" },
  { name: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  { name: "Groq", url: "https://api.groq.com/openai/v1" },
  { name: "Local (LM Studio)", url: "http://localhost:1234/v1" },
  { name: "Local (Ollama)", url: "http://localhost:11434/v1" },
];

const apiConfigSchema = z.object({
  name: z.string().min(1, "配置名称不能为空"),
  baseUrl: z
    .string()
    .url("请输入有效的 URL 地址 (以 http:// 或 https:// 开头)"),
  apiKey: z.string().min(1, "API 密钥不能为空"),
  testModel: z.string().optional(), // 可选：用于测试的模型名
});

type ApiConfigFormValues = z.infer<typeof apiConfigSchema>;

interface ApiConfigFormDialogProps {
  config?: ApiConfig;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const ApiConfigFormDialog: React.FC<ApiConfigFormDialogProps> = ({
  config,
  isOpen,
  onOpenChange,
}) => {
  const { addApiConfig, updateApiConfig, setSettings } = useSettingsStore();
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const form = useForm<ApiConfigFormValues>({
    resolver: zodResolver(apiConfigSchema),
    defaultValues: {
      name: config?.name || "",
      baseUrl: config?.baseUrl || "",
      apiKey: config?.apiKey || "",
      testModel: "gpt-3.5-turbo", // 默认测试模型
    },
  });

  // 重置表单当打开时
  React.useEffect(() => {
    if (isOpen) {
      form.reset({
        name: config?.name || "",
        baseUrl: config?.baseUrl || "",
        apiKey: config?.apiKey || "",
        testModel: "gpt-3.5-turbo",
      });
    }
  }, [isOpen, config, form]);

  const handlePresetChange = (url: string) => {
    form.setValue("baseUrl", url);
    // 自动尝试推断名称
    const preset = PROVIDER_PRESETS.find((p) => p.url === url);
    if (preset && !form.getValues("name")) {
      form.setValue("name", preset.name.split(" ")[0]);
    }
  };

  const onSubmit = async (values: ApiConfigFormValues) => {
    try {
      if (config) {
        updateApiConfig(config.id, values);
        toast.success("API 配置已更新");
      } else {
        // 创建新配置
        // 注意：这里 addApiConfig 会生成 ID，我们需要手动处理激活逻辑
        // 由于 addApiConfig 没有返回值返回 ID，我们这里简单地通过 store logic 添加
        // 改进：如果 store 的 addApiConfig 能返回 ID 更好，但为了不动 store，我们暂时不自动激活，或者让用户手动激活
        addApiConfig(values);
        toast.success("API 配置已添加");
      }
      onOpenChange(false);
    } catch (error) {
      toast.error("操作失败", { description: (error as Error).message });
    }
  };

  const runConnectionTest = async () => {
    const values = form.getValues();
    if (!values.baseUrl || !values.apiKey) {
      toast.error("请先填写 Base URL 和 API 密钥");
      return;
    }

    setIsTesting(true);
    try {
      // ✅ 直接调用 Service，不走后端 fetch
      await testApiConnection({
        baseUrl: values.baseUrl,
        apiKey: values.apiKey,
        model: values.testModel,
      });
      toast.success("连接测试成功！API 服务可用。");
    } catch (error: any) {
      toast.error("连接测试失败", { description: error.message });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {config ? "编辑 API 配置" : "添加 API 配置"}
          </DialogTitle>
          <DialogDescription>
            配置您的 AI 服务提供商信息。支持 OpenAI 兼容接口。
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* 预设选择 */}
            {!config && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  快速预设 (点击自动填充 Base URL)
                </Label>
                <div className="flex flex-wrap gap-2">
                  {PROVIDER_PRESETS.map((p) => (
                    <Badge
                      key={p.name}
                      variant="outline"
                      className="cursor-pointer hover:bg-primary/10 hover:text-primary transition-colors"
                      onClick={() => handlePresetChange(p.url)}
                    >
                      {p.name.split(" ")[0]}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>配置名称</FormLabel>
                    <FormControl>
                      <Input placeholder="例如：我的 DeepSeek" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="testModel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>测试模型名</FormLabel>
                    <FormControl>
                      <Input placeholder="gpt-3.5-turbo" {...field} />
                    </FormControl>
                    <FormDescription className="text-[10px]">
                      仅用于连接测试
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="baseUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Base URL (API 接口地址)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://api.example.com/v1"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>API 密钥 (Key)</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        type={isApiKeyVisible ? "text" : "password"}
                        placeholder="sk-..."
                        {...field}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                        onClick={() => setIsApiKeyVisible(!isApiKeyVisible)}
                      >
                        {isApiKeyVisible ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={runConnectionTest}
                disabled={isTesting}
                className="mr-auto"
              >
                <TestTube className="w-4 h-4 mr-2" />
                {isTesting ? "连接中..." : "测试连接"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                取消
              </Button>
              <Button type="submit">{config ? "保存更新" : "确认添加"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export const ApiConfigManager: React.FC = () => {
  const { apiConfigs, activeApiConfigId, setSettings, removeApiConfig } =
    useSettingsStore();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ApiConfig | undefined>();

  const handleEdit = (config: ApiConfig) => {
    setEditingConfig(config);
    setIsFormOpen(true);
  };

  const handleAdd = () => {
    setEditingConfig(undefined);
    setIsFormOpen(true);
  };

  const handleDelete = (configId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("确定要删除这个配置吗？")) {
      removeApiConfig(configId);
      toast.success("配置已删除");
    }
  };

  const handleActivate = (id: string) => {
    setSettings({ activeApiConfigId: id });
    toast.success("已切换 API 服务商");
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex justify-between items-center">
            <CardTitle className="text-base">API 服务商管理</CardTitle>
            <Button size="sm" variant="outline" onClick={handleAdd}>
              <Plus className="w-4 h-4 mr-2" /> 添加服务商
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {apiConfigs.length === 0 ? (
            <div className="text-center py-6 border-2 border-dashed rounded-lg">
              <p className="text-muted-foreground text-sm">暂无 API 配置</p>
              <Button variant="link" onClick={handleAdd}>
                立即添加
              </Button>
            </div>
          ) : (
            <div className="grid gap-3">
              {apiConfigs.map((config) => {
                const isActive = config.id === activeApiConfigId;
                return (
                  <div
                    key={config.id}
                    onClick={() => handleActivate(config.id)}
                    className={`
                        relative flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-all
                        ${
                          isActive
                            ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                            : "hover:border-primary/50 hover:bg-accent/50"
                        }
                      `}
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div
                        className={`
                            w-8 h-8 rounded-full flex items-center justify-center shrink-0
                            ${
                              isActive
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground"
                            }
                        `}
                      >
                        {isActive ? (
                          <Check className="w-5 h-5" />
                        ) : (
                          <Zap className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate">{config.name}</p>
                          {isActive && (
                            <Badge
                              variant="secondary"
                              className="text-[10px] h-4 px-1"
                            >
                              当前使用
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate max-w-[250px]">
                          {config.baseUrl}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 pl-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(config);
                        }}
                      >
                        <Edit className="w-4 h-4 text-muted-foreground" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive/70 hover:text-destructive"
                        onClick={(e) => handleDelete(config.id, e)}
                        disabled={apiConfigs.length <= 1}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <ApiConfigFormDialog
        config={editingConfig}
        isOpen={isFormOpen}
        onOpenChange={setIsFormOpen}
      />
    </>
  );
};
