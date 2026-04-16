import React from "react";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useUpdateItemMutation } from "../lib/react-query/world-building.queries";
import { useMentionOptions } from "../hooks/useMentionOptions"; // ✅ 引入统一mention Hook
import { useNovelDataSelector } from "../lib/react-query/db-queries";
import { itemSchema } from "../lib/schemas";
import type { Item } from "../types";
import { z } from "zod";

// 编辑表单schema，确保type字段是必需的
const editItemSchema = itemSchema.omit({ id: true }).extend({
  type: z.enum(["关键物品", "武器", "科技装置", "普通物品", "其他"]),
});

// 编辑表单类型，从schema推断
type EditItemForm = z.infer<typeof editItemSchema>;
import { Button } from "./ui/button";
import { Input } from "./ui/input";
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

interface ItemEditFormProps {
  item: Item;
  onSubmitSuccess: () => void;
  onClose: () => void;
}

/**
 * 物品编辑表单组件
 * 迁移到React Query Mutations模式，统一数据变更逻辑
 * 遵循单一职责原则，仅负责物品编辑的表单UI
 *
 * 设计原则应用：
 * - KISS: 简化表单处理逻辑，使用成熟的react-hook-form生态
 * - DRY: 统一使用React Query Mutations，消除Actions和Mutations混用
 * - SOLID:
 *   - SRP: 组件专注于表单UI和验证
 *   - DIP: 依赖抽象的Mutation Hook而非具体实现
 */
export const ItemEditForm: React.FC<ItemEditFormProps> = ({
  item,
  onSubmitSuccess,
  onClose,
}): React.ReactElement => {
  const { t } = useTranslation();

  // ✅ 使用统一 Hook 获取所有实体提及数据
  const mentionOptions = useMentionOptions();

  // 使用NovelDataSelector获取角色数据，用于持有者选择
  const characters = useNovelDataSelector((novel) => novel?.characters || []);

  // 使用React Hook Form管理表单状态，集成Zod验证
  const form = useForm<EditItemForm>({
    resolver: zodResolver(editItemSchema),
    defaultValues: {
      name: item.name,
      description: item.description || "",
      type: item.type || "其他",
      appearance: item.appearance || "",
      history: item.history || "",
      abilities: item.abilities || "",
      ownerId: item.ownerId || "none",
    },
  });

  // 使用React Query Mutation处理数据提交
  const updateItemMutation = useUpdateItemMutation();

  // 表单提交处理
  const handleSubmit = (data: EditItemForm) => {
    // 转换ownerId：将"none"转换为空字符串，以匹配数据库期望的空值
    const transformedData = {
      id: item.id,
      ...data,
      ownerId: data.ownerId === "none" ? "" : data.ownerId,
    };

    updateItemMutation.mutate(
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
        {/* 物品名称字段 */}
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("item.name")}</FormLabel>
              <FormControl>
                <Input placeholder={t("item.namePlaceholder")} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 物品类型 */}
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("item.type")}</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={t("item.typePlaceholder")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="关键物品">{t("item.typeKeyItem")}</SelectItem>
                  <SelectItem value="武器">{t("item.typeWeapon")}</SelectItem>
                  <SelectItem value="科技装置">{t("item.typeTechDevice")}</SelectItem>
                  <SelectItem value="普通物品">{t("item.typeNormal")}</SelectItem>
                  <SelectItem value="其他">{t("item.typeOther")}</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 物品描述字段 */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("item.description")}</FormLabel>
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

        {/* 外观描述 */}
        <FormField
          control={form.control}
          name="appearance"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("item.appearance")}</FormLabel>
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

        {/* 历史来源 */}
        <FormField
          control={form.control}
          name="history"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("item.history")}</FormLabel>
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

        {/* 功能或能力 */}
        <FormField
          control={form.control}
          name="abilities"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("item.abilities")}</FormLabel>
              <FormControl>
                <MiniEditor
                    key={`mini-editor-abilities-${mentionOptions.length}`}
                    content={field.value || ""}
                    onChange={field.onChange}
                    mentionItems={mentionOptions}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 当前持有者 */}
        <FormField
          control={form.control}
          name="ownerId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("item.owner")}</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={t("item.ownerPlaceholder")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">{t("item.noOwner")}</SelectItem>
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

        {/* 全局错误信息 */}
        {updateItemMutation.error && (
          <p className="text-sm text-destructive">{t("common.updateFailed")}</p>
        )}

        {/* 提交按钮 */}
        <LoadingButton
          type="submit"
          className="w-full"
          isLoading={updateItemMutation.isPending}
          loadingText={t("common.saving")}
        >
          {t("common.saveChanges")}
        </LoadingButton>
      </form>
    </Form>
  );
};
