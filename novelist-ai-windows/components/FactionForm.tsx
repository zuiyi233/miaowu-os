import React from "react";
import { useAddFactionMutation } from "../lib/react-query/db-queries";
import { useMutationForm } from "../hooks/useMutationForm";
import { useMentionOptions } from "../hooks/useMentionOptions"; // ✅ 引入统一的提及选项 Hook
import { createFactionSchema } from "../lib/schemas";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { LoadingButton } from "./common/LoadingButton";
import type { Character } from "../types";

interface FactionFormProps {
  onSubmitSuccess: () => void;
  onClose: () => void;
  characters: Pick<Character, "id" | "name">[]; // 从 props 接收 characters
}

/**
 * 势力创建表单组件
 * 重构后使用统一的 useMutationForm Hook，大幅简化代码
 * 遵循单一职责原则，仅负责势力创建的表单UI
 *
 * 重构收益：
 * - DRY: 消除了表单模板代码的重复，使用通用Hook
 * - KISS: 组件实现更简洁，只需关注UI渲染
 * - SOLID (SRP): 组件专注于UI渲染，表单逻辑由Hook处理
 * - 自动日志: 集成了 useFormWithLogging 的日志功能
 */
export const FactionForm: React.FC<FactionFormProps> = ({
  onSubmitSuccess,
  onClose,
  characters
}): React.ReactElement => {
  // ✅ 使用统一 Hook 获取所有实体类型的提及数据
  const mentionOptions = useMentionOptions();

  // ✅ 一行代码完成所有状态管理、验证、API绑定和日志
  const { form, onSubmit, isPending } = useMutationForm({
    context: "FactionForm",
    schema: createFactionSchema,
    mutation: useAddFactionMutation(),
    defaultValues: {
      name: "",
      description: "",
      ideology: "",
      leaderId: "none",
      goals: "",
      structure: "",
      resources: "",
      relationships: "",
    },
    onSuccess: () => {
      onSubmitSuccess();
      onClose();
    },
    // 处理表单数据转换，将"none"转换为空字符串
    onSubmit: (data) => {
      // 转换leaderId：将"none"转换为空字符串，以匹配数据库期望的空值
      if (data.leaderId === "none") {
        data.leaderId = "";
      }
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
              <FormLabel>势力名称</FormLabel>
              <FormControl>
                <Input placeholder="例如：铁锤兄弟会" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="ideology"
          render={({ field }) => (
            <FormItem>
              <FormLabel>势力理念</FormLabel>
              <FormControl>
                {/* ✅ 2. 传递统一的提及选项 */}
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

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>势力简介</FormLabel>
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

        <FormField
          control={form.control}
          name="leaderId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>领导者</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="选择势力领导者（可选）" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">无领导者</SelectItem>
                  {characters.map((character) => (
                    <SelectItem key={character.id} value={character.id}>
                      {character.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 目标与追求 */}
        <FormField
          control={form.control}
          name="goals"
          render={({ field }) => (
            <FormItem>
              <FormLabel>目标与追求</FormLabel>
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

        {/* 组织结构 */}
        <FormField
          control={form.control}
          name="structure"
          render={({ field }) => (
            <FormItem>
              <FormLabel>组织结构</FormLabel>
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

        {/* 资源与实力 */}
        <FormField
          control={form.control}
          name="resources"
          render={({ field }) => (
            <FormItem>
              <FormLabel>资源与实力</FormLabel>
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

        {/* 对外关系 */}
        <FormField
          control={form.control}
          name="relationships"
          render={({ field }) => (
            <FormItem>
              <FormLabel>对外关系（盟友/敌人）</FormLabel>
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
          保存势力
        </LoadingButton>
      </form>
    </Form>
  );
};
