import React from "react";
import { useAddSettingMutation } from "../lib/react-query/db-queries"; // ✅ 引入 Selector
import { useMutationForm } from "../hooks/useMutationForm";
import { useMentionOptions } from "../hooks/useMentionOptions"; // ✅ 引入统一的提及选项 Hook
import { createSettingSchema } from "../lib/schemas";
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

interface SettingFormProps {
  onSubmitSuccess: () => void;
  onClose: () => void;
}

/**
 * 场景创建表单组件
 * 重构后使用统一的 useMutationForm Hook，大幅简化代码
 * 遵循单一职责原则，仅负责场景创建的表单UI
 *
 * 重构收益：
 * - DRY: 消除了表单模板代码的重复，使用通用Hook
 * - KISS: 组件实现更简洁，只需关注UI渲染
 * - SOLID (SRP): 组件专注于UI渲染，表单逻辑由Hook处理
 * - 自动日志: 集成了 useFormWithLogging 的日志功能
 */
export const SettingForm: React.FC<SettingFormProps> = ({
  onSubmitSuccess,
  onClose,
}): React.ReactElement => {
  // ✅ 使用统一 Hook 获取所有实体类型的提及数据
  const mentionOptions = useMentionOptions();

  // ✅ 一行代码完成所有状态管理、验证、API绑定和日志
  const { form, onSubmit, isPending } = useMutationForm({
    context: "SettingForm",
    schema: createSettingSchema,
    mutation: useAddSettingMutation(),
    defaultValues: {
      name: "",
      description: "",
      type: "其他",
      atmosphere: "",
      history: "",
      keyFeatures: "",
    },
    onSuccess: () => {
      onSubmitSuccess();
      onClose();
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4">
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

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>场景描述</FormLabel>
              <FormControl>
                {/* ✅ 3. 传递统一的提及选项 */}
                <MiniEditor
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
                    content={field.value || ""}
                    onChange={field.onChange}
                    mentionItems={mentionOptions}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <LoadingButton type="submit" className="w-full" isLoading={isPending}>
          保存场景
        </LoadingButton>
      </form>
    </Form>
  );
};
