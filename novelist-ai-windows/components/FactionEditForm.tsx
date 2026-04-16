import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useUpdateFactionMutation } from "../lib/react-query/world-building.queries";
import { useMentionOptions } from "../hooks/useMentionOptions"; // ✅ 引入统一mention Hook
import { useNovelDataSelector } from "../lib/react-query/db-queries";
import { createFactionSchema } from "../lib/schemas";
import type { Faction, CreateFaction } from "../types";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { LoadingButton } from "./common/LoadingButton";

interface FactionEditFormProps {
  faction: Faction;
  onSubmitSuccess: () => void;
  onClose: () => void;
}

/**
 * 势力编辑表单组件
 * 迁移到React Query Mutations模式，统一数据变更逻辑
 * 遵循单一职责原则，仅负责势力编辑的表单UI
 *
 * 设计原则应用：
 * - KISS: 简化表单处理逻辑，使用成熟的react-hook-form生态
 * - DRY: 统一使用React Query Mutations，消除Actions和Mutations混用
 * - SOLID:
 *   - SRP: 组件专注于表单UI和验证
 *   - DIP: 依赖抽象的Mutation Hook而非具体实现
 */
export const FactionEditForm: React.FC<FactionEditFormProps> = ({
  faction,
  onSubmitSuccess,
  onClose,
}): React.ReactElement => {
  // ✅ 使用统一 Hook 获取所有实体提及数据
  const mentionOptions = useMentionOptions();

  // 使用NovelDataSelector获取角色数据，用于领导者选择
  const characters = useNovelDataSelector((novel) => novel?.characters || []);

  // 使用React Hook Form管理表单状态，集成Zod验证
  const form = useForm<CreateFaction>({
    resolver: zodResolver(createFactionSchema),
    defaultValues: {
      name: faction.name,
      ideology: faction.ideology || "",
      description: faction.description || "",
      leaderId: faction.leaderId || "none",
      goals: faction.goals || "",
      structure: faction.structure || "",
      resources: faction.resources || "",
      relationships: faction.relationships || "",
    },
  });

  // 使用React Query Mutation处理数据提交
  const updateFactionMutation = useUpdateFactionMutation();

  // 表单提交处理
  const handleSubmit = (data: CreateFaction) => {
    // 转换leaderId：将"none"转换为空字符串，以匹配数据库期望的空值
    const transformedData = {
      id: faction.id,
      ...data,
      leaderId: data.leaderId === "none" ? "" : data.leaderId,
    };

    updateFactionMutation.mutate(
      transformedData,
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
        {/* 势力名称字段 */}
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

        {/* 势力理念字段 */}
        <FormField
          control={form.control}
          name="ideology"
          render={({ field }) => (
            <FormItem>
              <FormLabel>势力理念</FormLabel>
              <FormControl>
                {/* ✅ 添加 key 属性，当提及选项数量变化时（例如添加了新势力），强制重新渲染编辑器 */}
                <MiniEditor
                  key={`mini-editor-ideology-${mentionOptions.length}`}
                  content={field.value || ""}
                  onChange={field.onChange}
                  mentionItems={mentionOptions}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 势力描述字段 */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>势力简介</FormLabel>
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

        {/* 领导者选择字段 */}
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
                  {characters.data?.map((character) => (
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
                    key={`mini-editor-goals-${mentionOptions.length}`}
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
                    key={`mini-editor-structure-${mentionOptions.length}`}
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
                    key={`mini-editor-resources-${mentionOptions.length}`}
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
                    key={`mini-editor-relationships-${mentionOptions.length}`}
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
        {updateFactionMutation.error && (
          <p className="text-sm text-destructive">更新失败，请重试</p>
        )}

        {/* 提交按钮 */}
        <LoadingButton
          type="submit"
          className="w-full"
          isLoading={updateFactionMutation.isPending}
          loadingText="保存中..."
        >
          保存更改
        </LoadingButton>
      </form>
    </Form>
  );
};
