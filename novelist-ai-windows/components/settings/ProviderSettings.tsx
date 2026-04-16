import React, { useState } from "react";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { LLMProviderConfig, LLMProviderType } from "../../types";

// 临时类型定义，用于表单状态
interface PartialLLMProviderConfig extends Partial<LLMProviderConfig> {
  name?: string;
  type?: LLMProviderType;
  baseUrl?: string;
  apiKey?: string;
  enableReasoning?: boolean;
  enableStreamOptions?: boolean;
  customHeaders?: Record<string, string>;
}

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import {
  Plus,
  Trash2,
  Edit,
  Server,
  Key,
  Globe,
  Brain,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

/**
 * 服务商管理组件
 * 提供服务商的增删改查功能
 */
export const ProviderSettings: React.FC = () => {
  const { providers, addProvider, updateProvider, removeProvider } =
    useSettingsStore();

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] =
    useState<LLMProviderConfig | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [headersString, setHeadersString] = useState("");

  // 表单状态
  const [formData, setFormData] = useState<PartialLLMProviderConfig>({
    name: "",
    type: "openai",
    baseUrl: "",
    apiKey: "",
    enableReasoning: false,
    enableStreamOptions: true,
    customHeaders: {},
  });

  // 重置表单
  const resetForm = () => {
    setFormData({
      name: "",
      type: "openai",
      baseUrl: "",
      apiKey: "",
      enableReasoning: false,
      enableStreamOptions: true,
      customHeaders: {},
    });
    setHeadersString("");
    setEditingProvider(null);
  };

  // 打开编辑对话框
  const handleEdit = (provider: LLMProviderConfig) => {
    setEditingProvider(provider);
    setFormData(provider);
    // 初始化字符串状态
    setHeadersString(JSON.stringify(provider.customHeaders || {}, null, 2));
    setIsAddDialogOpen(true);
  };

  // 保存服务商
  const handleSave = () => {
    if (!formData.name || !formData.baseUrl || !formData.apiKey) {
      toast.error("请填写完整的服务商信息");
      return;
    }

    let parsedHeaders = {};
    try {
      if (headersString.trim()) {
        parsedHeaders = JSON.parse(headersString);
      }
    } catch (e) {
      toast.error("自定义 Headers 必须是有效的 JSON 格式");
      return;
    }

    try {
      const finalData = { ...formData, customHeaders: parsedHeaders };

      if (editingProvider) {
        updateProvider(editingProvider.id, finalData);
        toast.success("服务商已更新");
      } else {
        addProvider(finalData as Omit<LLMProviderConfig, "id">);
        toast.success("服务商已添加");
      }

      setIsAddDialogOpen(false);
      resetForm();
    } catch (error) {
      toast.error("保存失败", { description: (error as Error).message });
    }
  };

  // 删除服务商
  const handleDelete = (id: string) => {
    removeProvider(id);
    setDeleteConfirmId(null);
    toast.success("服务商已删除");
  };

  // 获取服务商类型显示名称
  const getProviderTypeName = (type: LLMProviderType) => {
    const typeNames: Record<LLMProviderType, string> = {
      openai: "OpenAI 兼容",
      azure: "Azure OpenAI",
      anthropic: "Anthropic",
      google: "Google Gemini",
      deepseek: "DeepSeek",
      custom: "自定义",
    };
    return typeNames[type];
  };

  // 获取默认 BaseURL
  const getDefaultBaseUrl = (type: LLMProviderType) => {
    const defaults: Record<LLMProviderType, string> = {
      openai: "https://api.openai.com/v1",
      azure: "https://your-resource.openai.azure.com",
      anthropic: "https://api.anthropic.com",
      google: "https://generativelanguage.googleapis.com/v1beta",
      deepseek: "https://api.deepseek.com",
      custom: "",
    };
    return defaults[type];
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center px-1">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-primary/10 rounded-md">
            <Server className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">服务商配置</h3>
            <p className="text-xs text-muted-foreground">管理 AI 接口连接</p>
          </div>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={resetForm} size="sm">
              <Plus className="w-4 h-4 mr-2" />
              添加服务商
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingProvider ? "编辑服务商" : "添加新服务商"}
              </DialogTitle>
              <DialogDescription>
                配置 AI 服务商的连接信息和高级选项
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">服务商名称</Label>
                  <Input
                    id="name"
                    value={formData.name || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="例如：NewAPI 统一网关"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">服务商类型</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(value: LLMProviderType) => {
                      const newType = value as LLMProviderType;
                      setFormData({
                        ...formData,
                        type: newType,
                        baseUrl: getDefaultBaseUrl(newType),
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">OpenAI 兼容</SelectItem>
                      <SelectItem value="azure">Azure OpenAI</SelectItem>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
                      <SelectItem value="google">Google Gemini</SelectItem>
                      <SelectItem value="deepseek">DeepSeek</SelectItem>
                      <SelectItem value="custom">自定义</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="baseUrl">API 基础地址</Label>
                <Input
                  id="baseUrl"
                  value={formData.baseUrl || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, baseUrl: e.target.value })
                  }
                  placeholder="https://api.example.com/v1"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiKey">API 密钥</Label>
                <Input
                  id="apiKey"
                  type="password"
                  value={formData.apiKey || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, apiKey: e.target.value })
                  }
                  placeholder="输入您的 API 密钥"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="enableReasoning"
                    checked={formData.enableReasoning || false}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, enableReasoning: checked })
                    }
                  />
                  <Label htmlFor="enableReasoning">启用推理内容解析</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="enableStreamOptions"
                    checked={formData.enableStreamOptions ?? true}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, enableStreamOptions: checked })
                    }
                  />
                  <Label htmlFor="enableStreamOptions">启用流式选项</Label>
                </div>
              </div>

              {/* ✅ 新增：自定义 Headers 输入 */}
              <div className="space-y-2">
                <Label htmlFor="customHeaders">
                  自定义 Headers (JSON 格式)
                  <span className="text-[10px] text-muted-foreground ml-2 font-normal">
                    可选，如: {`{"anthropic-version": "2023-06-01"}`}
                  </span>
                </Label>
                <Textarea
                  id="customHeaders"
                  className="font-mono text-xs min-h-[60px]"
                  placeholder='{ "My-Header": "Value" }'
                  value={headersString}
                  onChange={(e) => setHeadersString(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsAddDialogOpen(false)}
              >
                取消
              </Button>
              <Button onClick={handleSave}>
                {editingProvider ? "更新" : "添加"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* 服务商列表 - 改为网格布局 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {providers.map((provider) => (
          <div
            key={provider.id}
            className="group border rounded-xl bg-card p-4 shadow-sm hover:shadow-md hover:border-primary/20 transition-all relative"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-muted-foreground group-hover:text-primary group-hover:bg-primary/10 transition-colors">
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-medium text-sm">{provider.name}</h4>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border">
                      {getProviderTypeName(provider.type)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity absolute top-3 right-3 bg-card pl-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleEdit(provider)}
                >
                  <Edit className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => setDeleteConfirmId(provider.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 p-1.5 rounded">
                <Globe className="w-3 h-3 shrink-0" />
                <span className="truncate font-mono opacity-80">
                  {provider.baseUrl}
                </span>
              </div>
              <div className="flex gap-2 mt-2">
                {provider.enableReasoning && (
                  <span className="text-[10px] flex items-center gap-1 text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded">
                    <Brain className="w-3 h-3" /> 推理
                  </span>
                )}
                {provider.enableStreamOptions && (
                  <span className="text-[10px] flex items-center gap-1 text-green-600 bg-green-50 dark:bg-green-900/20 px-1.5 py-0.5 rounded">
                    <Zap className="w-3 h-3" /> 流式优化
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* 添加按钮卡片 (如果列表为空或者作为最后一个选项) */}
        {providers.length === 0 && (
          <div className="col-span-1 md:col-span-2 border border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center text-muted-foreground bg-muted/5">
            <Server className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-sm">暂无服务商</p>
            <Button variant="link" onClick={() => setIsAddDialogOpen(true)}>
              点击添加
            </Button>
          </div>
        )}
      </div>

      {/* 删除确认对话框 */}
      <AlertDialog
        open={!!deleteConfirmId}
        onOpenChange={() => setDeleteConfirmId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              您确定要删除这个服务商配置吗？此操作无法撤销。
              如果有模型正在使用此服务商，请先更新模型配置。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              className="bg-destructive hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
