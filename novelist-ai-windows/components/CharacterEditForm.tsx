import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useUpdateCharacterMutation } from "../lib/react-query/db-queries";
import { useMentionOptions } from "../hooks/useMentionOptions"; // ✅ 引入统一的提及选项 Hook
import { createCharacterSchema } from "../lib/schemas";
import type { Character, CreateCharacter } from "../types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
// ❌ 移除 Textarea
// import { Textarea } from "./ui/textarea";
// ✅ 引入 MiniEditor
import { MiniEditor } from "./common/MiniEditor";
import { ImageUpload } from "./common/ImageUpload";
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
import { useNovelDataSelector } from "../lib/react-query/db-queries";
// ✅ 新增：引入EmbeddingStore用于脏数据队列
import { useEmbeddingStore } from "../stores/useEmbeddingStore";
import { logger } from "../lib/logging";

interface CharacterEditFormProps {
  character: Character;
  onSubmitSuccess: () => void;
}

/**
 * 角色编辑表单组件
 * 迁移到React Query Mutations模式，统一数据变更逻辑
 * 遵循单一职责原则，仅负责角色编辑的表单UI
 *
 * 设计原则应用：
 * - KISS: 简化表单处理逻辑，使用成熟的react-hook-form生态
 * - DRY: 统一使用React Query Mutations，消除Actions和Mutations混用
 * - SOLID:
 *   - SRP: 组件专注于表单UI和验证
 *   - DIP: 依赖抽象的Mutation Hook而非具体实现
 */
export const CharacterEditForm: React.FC<CharacterEditFormProps> = ({
  character,
  onSubmitSuccess,
}): React.ReactElement => {
  // ✅ 使用统一 Hook 获取所有实体类型的提及数据，排除当前编辑的角色
  const mentionOptions = useMentionOptions(character.id);

  // ✅ 使用 selector 高效获取势力列表
  const factions = useNovelDataSelector((novel) => novel?.factions || []);

  // ✅ 新增：获取EmbeddingStore的addToQueue方法
  const addToQueue = useEmbeddingStore((s) => s.addToQueue);

  // 使用React Hook Form管理表单状态，集成Zod验证
  const form = useForm<CreateCharacter>({
    resolver: zodResolver(createCharacterSchema),
    defaultValues: {
      name: character.name,
      description: character.description,
      avatar: character.avatar || "",
      age: character.age || "",
      gender: character.gender || "",
      appearance: character.appearance || "",
      personality: character.personality || "",
      motivation: character.motivation || "",
      backstory: character.backstory || "",
      factionId: character.factionId || "none",
    },
  });

  // 使用React Query Mutation处理数据提交
  const updateCharacterMutation = useUpdateCharacterMutation();

  // 表单提交处理
  const handleSubmit = (data: CreateCharacter) => {
    updateCharacterMutation.mutate(
      {
        id: character.id,
        ...data,
      },
      {
        // ✅ 优化：保存成功后将变更推入后台队列，不阻塞当前操作
        onSuccess: () => {
          // 构建语义丰富的文本用于向量化
          const richText = `[角色] ${data.name}。${data.description || ""} ${
            data.personality || ""
          } ${data.appearance || ""} ${data.motivation || ""} ${
            data.backstory || ""
          }`;

          // 推入脏数据队列，后台闲时处理
          addToQueue({
            id: character.id,
            type: "character",
            content: richText,
          });

          logger.debug(
            "CharacterEditForm",
            "Added character to embedding queue",
            {
              characterId: character.id,
              name: data.name,
            }
          );

          onSubmitSuccess();
        },
      }
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        {/* 角色名称字段 */}
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>角色名</FormLabel>
              <FormControl>
                <Input placeholder="例如：艾拉" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 角色头像 */}
        <FormField
          control={form.control}
          name="avatar"
          render={({ field }) => (
            <FormItem>
              <FormLabel>角色头像</FormLabel>
              <FormControl>
                <ImageUpload value={field.value} onChange={field.onChange} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 基本信息 */}
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="age"
            render={({ field }) => (
              <FormItem>
                <FormLabel>年龄</FormLabel>
                <FormControl>
                  <Input placeholder="例如：青年" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="gender"
            render={({ field }) => (
              <FormItem>
                <FormLabel>性别</FormLabel>
                <FormControl>
                  <Input placeholder="例如：男" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* 所属势力 */}
        <FormField
          control={form.control}
          name="factionId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>所属势力</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="选择所属势力" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">无</SelectItem>
                  {factions.data?.map((faction) => (
                    <SelectItem key={faction.id} value={faction.id}>
                      {faction.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />

        {/* 角色描述字段 */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>角色简介</FormLabel>
              <FormControl>
                {/* ✅ 添加 key 属性，当提及选项数量变化时（例如添加了新势力），强制重新渲染编辑器 */}
                <MiniEditor
                  key={`mini-editor-${mentionOptions.length}`}
                  content={field.value || ""}
                  onChange={field.onChange}
                  mentionItems={mentionOptions}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 外貌描述 */}
        <FormField
          control={form.control}
          name="appearance"
          render={({ field }) => (
            <FormItem>
              <FormLabel>外貌描述</FormLabel>
              <FormControl>
                <MiniEditor
                  key={`mini-editor-appearance-${mentionOptions.length}`}
                  content={field.value || ""}
                  onChange={field.onChange}
                  mentionItems={mentionOptions}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 性格特点 */}
        <FormField
          control={form.control}
          name="personality"
          render={({ field }) => (
            <FormItem>
              <FormLabel>性格特点</FormLabel>
              <FormControl>
                <MiniEditor
                  key={`mini-editor-personality-${mentionOptions.length}`}
                  content={field.value || ""}
                  onChange={field.onChange}
                  mentionItems={mentionOptions}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 动机与目标 */}
        <FormField
          control={form.control}
          name="motivation"
          render={({ field }) => (
            <FormItem>
              <FormLabel>动机与目标</FormLabel>
              <FormControl>
                <MiniEditor
                  key={`mini-editor-motivation-${mentionOptions.length}`}
                  content={field.value || ""}
                  onChange={field.onChange}
                  mentionItems={mentionOptions}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 背景故事 */}
        <FormField
          control={form.control}
          name="backstory"
          render={({ field }) => (
            <FormItem>
              <FormLabel>背景故事</FormLabel>
              <FormControl>
                <MiniEditor
                  key={`mini-editor-backstory-${mentionOptions.length}`}
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
        {updateCharacterMutation.error && (
          <p className="text-sm text-destructive">更新失败，请重试</p>
        )}

        {/* 提交按钮 */}
        <LoadingButton
          type="submit"
          className="w-full"
          isLoading={updateCharacterMutation.isPending}
          loadingText="保存中..."
        >
          保存更改
        </LoadingButton>
      </form>
    </Form>
  );
};
