import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useUpdateSettingMutation } from "../lib/react-query/world-building.queries";
import { useMentionOptions } from "../hooks/useMentionOptions"; // ✅ 引入统一的提及选项 Hook
import { settingSchema } from "../lib/schemas";
import type { Setting } from "../types";
import { z } from "zod";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
// ❌ 移除 Textarea
// import { Textarea } from "./ui/textarea";
// ✅ 引入 MiniEditor
import { MiniEditor } from "./common/MiniEditor";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./ui/form";
import { LoadingButton } from "./common/LoadingButton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface SettingEditFormProps {
  setting: Setting;
  onSubmitSuccess: () => void;
  onClose: () => void;
}

/**
 * 场景编辑表单组件
 * 迁移到React Query Mutations模式，统一数据变更逻辑
 * 遵循单一职责原则，仅负责场景编辑的表单UI
 *
 * 设计原则应用：
 * - KISS: 简化表单处理逻辑，使用成熟的react-hook-form生态
 * - DRY: 统一使用React Query Mutations，消除Actions和Mutations混用
 * - SOLID:
 *   - SRP: 组件专注于表单UI和验证
 *   - DIP: 依赖抽象的Mutation Hook而非具体实现
 */
// 编辑表单schema，确保type字段是必需的
const editSettingSchema = settingSchema.omit({ id: true }).extend({
  type: z.enum(["城市", "建筑", "自然景观", "地区", "其他"]),
});

// 编辑表单类型，从schema推断
type EditSettingForm = z.infer<typeof editSettingSchema>;

export const SettingEditForm: React.FC<SettingEditFormProps> = ({
  setting,
  onSubmitSuccess,
  onClose,
}): React.ReactElement => {
  // ✅ 使用统一 Hook 获取所有实体类型的提及数据
  const mentionOptions = useMentionOptions();

  // 使用React Hook Form管理表单状态，集成Zod验证
  const form = useForm<EditSettingForm>({
    resolver: zodResolver(editSettingSchema),
    defaultValues: {
      name: setting.name,
      description: setting.description || "",
      type: setting.type || "其他",
      atmosphere: setting.atmosphere || "",
      history: setting.history || "",
      keyFeatures: setting.keyFeatures || "",
    },
  });

  // 使用React Query Mutation处理数据提交
  const updateSettingMutation = useUpdateSettingMutation();

  // 表单提交处理
  const handleSubmit = (data: EditSettingForm) => {
    updateSettingMutation.mutate(
      {
        id: setting.id,
        ...data,
      },
      {
        // ✅ 在这里直接处理成功回调
        onSuccess: () => {
          onSubmitSuccess();
          onClose();
        },
      }
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        {/* 场景名称字段 */}
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>场景名</FormLabel>
              <FormControl>
                <Input placeholder="例如：古老的图书馆" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 场景类型 */}
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>场景类型</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="选择场景类型" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="城市">城市</SelectItem>
                  <SelectItem value="建筑">建筑</SelectItem>
                  <SelectItem value="自然景观">自然景观</SelectItem>
                  <SelectItem value="地区">地区</SelectItem>
                  <SelectItem value="其他">其他</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 场景描述字段 */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>场景描述</FormLabel>
              <FormControl>
                {/* ✅ 添加 key 属性，当提及选项数量变化时（例如添加了新势力），强制重新渲染编辑器 */}
                <MiniEditor
                  key={`mini-editor-description-${mentionOptions.length}`}
                  content={field.value || ""}
                  onChange={field.onChange}
                  mentionItems={mentionOptions}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 氛围描述 */}
        <FormField
          control={form.control}
          name="atmosphere"
          render={({ field }) => (
            <FormItem>
              <FormLabel>氛围描述</FormLabel>
              <FormControl>
                <MiniEditor
                    key={`mini-editor-atmosphere-${mentionOptions.length}`}
                    content={field.value || ""}
                    onChange={field.onChange}
                    mentionItems={mentionOptions}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 历史背景 */}
        <FormField
          control={form.control}
          name="history"
          render={({ field }) => (
            <FormItem>
              <FormLabel>历史背景</FormLabel>
              <FormControl>
                <MiniEditor
                    key={`mini-editor-history-${mentionOptions.length}`}
                    content={field.value || ""}
                    onChange={field.onChange}
                    mentionItems={mentionOptions}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 关键特征 */}
        <FormField
          control={form.control}
          name="keyFeatures"
          render={({ field }) => (
            <FormItem>
              <FormLabel>关键特征或地标</FormLabel>
              <FormControl>
                <MiniEditor
                    key={`mini-editor-keyFeatures-${mentionOptions.length}`}
                    content={field.value || ""}
                    onChange={field.onChange}
                    mentionItems={mentionOptions}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 全局错误信息 */}
        {updateSettingMutation.error && (
          <p className="text-sm text-destructive">更新失败，请重试</p>
        )}

        {/* 提交按钮 */}
        <LoadingButton
          type="submit"
          className="w-full"
          isLoading={updateSettingMutation.isPending}
          loadingText="保存中..."
        >
          保存更改
        </LoadingButton>
      </form>
    </Form>
  );
};
