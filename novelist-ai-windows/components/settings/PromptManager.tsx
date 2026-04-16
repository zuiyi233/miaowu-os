import React, { useRef } from "react";
import {
  usePromptTemplatesQuery,
  useActivatePromptTemplateMutation,
  useDeletePromptTemplateMutation,
  useSavePromptTemplateMutation,
} from "@/lib/react-query/prompt.queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Edit,
  Check,
  Star,
  Trash2,
  Loader2,
  RefreshCw,
  Upload,
  FileText,
} from "lucide-react";
import { useModalStore } from "@/stores/useModalStore";
import { PromptTemplate } from "@/types";
import { toast } from "sonner";

// Modal组件的标准Props接口
interface ModalComponentProps {
  onClose: () => void;
  [key: string]: any; // 允许传递其他任意props
}
import { PromptEditorForm } from "./PromptEditorForm";

/**
 * 提示词管理器组件
 * 遵循单一职责原则，专注于提示词模板的管理界面
 *
 * 设计原则应用：
 * - KISS: 清晰的分组展示，直观的操作按钮
 * - DRY: 复用现有的UI组件和样式模式
 * - SOLID:
 *   - SRP: 专注于提示词模板管理界面
 *   - OCP: 支持扩展新的模板类型而无需修改核心逻辑
 *   - DIP: 依赖抽象的查询和变更Hook接口
 */
export const PromptManager: React.FC = () => {
  const {
    data: templates = [],
    isLoading,
    error,
    refetch,
  } = usePromptTemplatesQuery();
  const { open } = useModalStore();
  const activateMutation = useActivatePromptTemplateMutation();
  const deleteMutation = useDeletePromptTemplateMutation();
  const saveMutation = useSavePromptTemplateMutation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * 处理编辑模板
   * 遵循单一职责原则，专注于编辑操作的处理
   */
  const handleEdit = (template?: PromptTemplate) => {
    // ✅ 复用你喜欢的抽屉组件体验
    open({
      type: "drawer",
      title: template ? "编辑提示词" : "创建提示词",
      description: "使用 {{variable}} 语法来插入动态内容。",
      component: PromptEditorForm,
      props: {
        initialData: template,
      },
    });
  };

  /**
   * 处理删除模板
   * 遵循单一职责原则，专注于删除操作的处理
   */
  const handleDelete = (template: PromptTemplate) => {
    if (template.isBuiltIn) {
      toast.error("系统预设模板不能删除");
      return;
    }

    open({
      type: "dialog",
      title: "确认删除",
      description: `确定要删除提示词模板"${template.name}"吗？此操作无法撤销。`,
      component: PromptDeleteConfirm,
      props: {
        template,
        onConfirm: () => deleteMutation.mutate(template.id),
      },
    });
  };

  /**
   * 处理激活模板
   * 遵循单一职责原则，专注于激活操作的处理
   */
  const handleActivate = (template: PromptTemplate) => {
    activateMutation.mutate({
      id: template.id,
      type: template.type,
    });
  };

  // ✅ 新增：处理文件导入
  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target?.result as string;

      // 简单的解析逻辑 (复用 loader.ts 中的逻辑思路，但在前端直接处理)
      // 这里假设用户上传的文件也遵循 Frontmatter 格式，或者就是纯文本
      const parsedData: any = {
        name: file.name.replace(/\.(md|txt)$/, ""),
        content: content,
        type: "custom", // 默认为自定义类型，用户需手动修改
        isBuiltIn: false,
        isActive: false,
      };

      // 尝试解析 Frontmatter
      const regex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
      const match = content.match(regex);

      if (match) {
        const metadataStr = match[1];
        parsedData.content = match[2].trim();

        metadataStr.split("\n").forEach((line) => {
          const [key, ...values] = line.split(":");
          if (key && values.length) {
            const val = values.join(":").trim();
            if (key.trim() === "type") parsedData.type = val;
            if (key.trim() === "name") parsedData.name = val;
            if (key.trim() === "description") parsedData.description = val;
          }
        });
      }

      // 保存到数据库
      // 如果类型不明确，可以弹窗让用户选，这里简化为直接保存并提示编辑
      saveMutation.mutate(
        {
          ...parsedData,
          id: `imported-${Date.now()}`,
        },
        {
          onSuccess: () => {
            toast.success(`已导入模板: ${parsedData.name}`, {
              description: "请检查并设置其应用场景(Type)",
            });
            // 可以在这里自动打开编辑窗口
          },
        }
      );
    };
    reader.readAsText(file);

    // 重置 input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // 按类型分组
  const groupedTemplates = templates.reduce((acc, curr) => {
    (acc[curr.type] = acc[curr.type] || []).push(curr);
    return acc;
  }, {} as Record<string, PromptTemplate[]>);

  // 类型标签映射
  const typeLabels: Record<string, string> = {
    outline: "大纲生成",
    continue: "续写模式",
    polish: "润色模式",
    expand: "扩写模式",
    chat: "自由对话",
    extraction: "信息提取",
  };

  // 类型图标映射
  const typeIcons: Record<string, string> = {
    outline: "📋",
    continue: "✍️",
    polish: "✨",
    expand: "📖",
    chat: "💬",
    extraction: "🔍",
  };

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <div className="text-center">
            <p className="text-muted-foreground mb-2">加载提示词模板失败</p>
            <p className="text-xs text-muted-foreground mb-4">
              {error instanceof Error ? error.message : "未知错误"}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  重新加载中
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  重新加载
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium">提示词工程实验室</h3>
          <p className="text-sm text-muted-foreground">
            管理和自定义AI提示词模板，支持导入本地 Markdown/TXT 文件
          </p>
        </div>
        <div className="flex gap-2">
          {/* ✅ 新增：导入按钮 */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-4 h-4 mr-2" />
            导入文件
          </Button>
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".md,.txt"
            onChange={handleImportFile}
          />

          <Button onClick={() => handleEdit()} size="sm" disabled={isLoading}>
            <Plus className="w-4 h-4 mr-2" />
            新建模板
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <div className="h-4 bg-muted rounded w-32"></div>
                    <div className="h-3 bg-muted rounded w-48"></div>
                  </div>
                  <div className="flex gap-2">
                    <div className="h-8 w-8 bg-muted rounded"></div>
                    <div className="h-8 w-8 bg-muted rounded"></div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        Object.entries(groupedTemplates).map(([type, items]) => (
          <Card key={type}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium text-muted-foreground flex items-center gap-2">
                <span>{typeIcons[type] || "📝"}</span>
                {typeLabels[type] || type}
                <Badge variant="secondary" className="text-xs">
                  {items.length} 个模板
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {items.map((template) => (
                <div
                  key={template.id}
                  className={`flex items-center justify-between p-3 border rounded-lg transition-all ${
                    template.isActive
                      ? "border-primary/50 bg-primary/5"
                      : "hover:border-muted-foreground/50"
                  }`}
                >
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{template.name}</span>
                      {template.isBuiltIn && (
                        <Badge variant="secondary" className="text-xs">
                          预设
                        </Badge>
                      )}
                      {template.isActive && (
                        <Badge className="text-xs bg-primary/20 text-primary hover:bg-primary/20">
                          当前使用
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {template.description || "无描述"}
                    </p>
                    <p className="text-xs text-muted-foreground line-clamp-1 font-mono">
                      {template.content.slice(0, 100)}...
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {!template.isActive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="设为默认"
                        onClick={() => handleActivate(template)}
                        disabled={activateMutation.isPending}
                      >
                        <Star className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(template)}
                      title="编辑模板"
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    {!template.isBuiltIn && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(template)}
                        title="删除模板"
                        disabled={deleteMutation.isPending}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}

      {templates.length === 0 && !isLoading && (
        <Card>
          <CardContent className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="text-4xl mb-4">📝</div>
              <h3 className="text-lg font-medium mb-2">还没有提示词模板</h3>
              <p className="text-muted-foreground mb-4">
                创建你的第一个提示词模板，开始自定义AI的创作风格
              </p>
              <Button onClick={() => handleEdit()}>
                <Plus className="w-4 h-4 mr-2" />
                创建模板
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

/**
 * 删除确认组件
 * 遵循单一职责原则，专注于删除确认逻辑
 * 使用Modal标准的props接口
 */
const PromptDeleteConfirm: React.FC<
  ModalComponentProps & {
    template: PromptTemplate;
    onConfirm: () => void;
  }
> = ({ template, onConfirm, onClose }) => {
  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className="text-4xl mb-2">⚠️</div>
        <h3 className="text-lg font-medium">确认删除</h3>
        <p className="text-muted-foreground">
          您确定要删除提示词模板 <strong>"{template.name}"</strong> 吗？
        </p>
        <p className="text-sm text-muted-foreground">
          此操作无法撤销，请谨慎操作。
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button variant="destructive" onClick={onConfirm}>
          确认删除
        </Button>
      </div>
    </div>
  );
};
