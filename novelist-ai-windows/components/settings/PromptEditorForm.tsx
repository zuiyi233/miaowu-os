import React, { useRef } from "react";
import { useForm, SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createPromptTemplateSchema } from "../../lib/schemas";
import { type CreatePromptTemplate, type PromptTemplate } from "../../types";
import { useSavePromptTemplateMutation } from "../../lib/react-query/prompt.queries";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "../ui/form";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Info, Plus } from "lucide-react";

interface Props {
  initialData?: PromptTemplate;
  onClose: () => void;
}

/**
 * 提示词编辑表单组件
 * 支持创建新模板和编辑现有模板
 * 提供变量插入功能，方便用户构建动态提示词
 */
export const PromptEditorForm: React.FC<Props> = ({ initialData, onClose }) => {
  const mutation = useSavePromptTemplateMutation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const form = useForm({
    resolver: zodResolver(createPromptTemplateSchema),
    defaultValues: {
      name: initialData?.name || "",
      description: initialData?.description || "",
      type: initialData?.type || "continue",
      content: initialData?.content || "",
      isActive: initialData?.isActive || false,
    },
  });

  /**
   * 在光标位置插入变量
   * @param variable 要插入的变量字符串
   */
  const insertVariable = (variable: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const current = form.getValues("content");
    
    // 在光标位置插入变量
    const newContent = current.substring(0, start) + variable + current.substring(end);
    form.setValue("content", newContent);
    
    // 设置光标位置到插入变量之后
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + variable.length, start + variable.length);
    }, 0);
  };

  const onSubmit: SubmitHandler<any> = (data) => {
    mutation.mutate({ ...data, id: initialData?.id }, {
      onSuccess: () => onClose()
    });
  };

  // 可用的变量列表
  const availableVariables = [
    { name: "世界观", value: "{{context}}" },
    { name: "选中文本", value: "{{selection}}" },
    { name: "用户输入", value: "{{input}}" },
  ];

  // 类型选项
  const typeOptions = [
    { value: "continue", label: "小说续写" },
    { value: "polish", label: "文本润色" },
    { value: "expand", label: "内容扩写" },
    { value: "outline", label: "大纲生成" },
    { value: "chat", label: "自由对话" },
  ];

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 p-4">
        {/* 基本信息 */}
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>模板名称</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    placeholder="输入模板名称"
                    disabled={mutation.isPending}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>应用场景</FormLabel>
                <Select 
                  onValueChange={field.onChange} 
                  defaultValue={field.value} 
                  disabled={!!initialData || mutation.isPending}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="选择应用场景" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {typeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>描述（可选）</FormLabel>
              <FormControl>
                <Input 
                  {...field} 
                  placeholder="简要描述此模板的用途"
                  disabled={mutation.isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 提示词内容 */}
        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex justify-between items-center">
                <span>提示词内容</span>
                <div className="flex gap-1">
                  {availableVariables.map((variable) => (
                    <Badge 
                      key={variable.value}
                      variant="outline" 
                      className="cursor-pointer hover:bg-accent text-xs"
                      onClick={() => insertVariable(variable.value)}
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      {variable.name}
                    </Badge>
                  ))}
                </div>
              </FormLabel>
              <FormControl>
                <Textarea 
                  {...field} 
                  ref={textareaRef}
                  rows={12} 
                  className="font-mono text-sm leading-relaxed resize-none"
                  placeholder="输入提示词内容，使用 {{variable}} 语法插入动态变量..."
                  disabled={mutation.isPending}
                />
              </FormControl>
              <FormDescription className="flex items-center gap-1">
                <Info className="w-3 h-3" />
                使用双大括号插入动态变量。<span className="font-mono">{'{{context}}'}</span> 会自动包含相关的角色、场景和势力信息。
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 操作按钮 */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button 
            type="button" 
            variant="ghost" 
            onClick={onClose}
            disabled={mutation.isPending}
          >
            取消
          </Button>
          <Button 
            type="submit" 
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "保存中..." : "保存模板"}
          </Button>
        </div>
      </form>
    </Form>
  );
};