import React from "react";
import { useTranslation } from "react-i18next";
import { useAddItemMutation } from "../lib/react-query/world-building.queries";
import { useMutationForm } from "../hooks/useMutationForm";
import { useMentionOptions } from "../hooks/useMentionOptions"; // ✅ 引入统一的提及选项 Hook
import { createItemSchema } from "../lib/schemas";
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
import type { Character } from "../types";

interface ItemFormProps {
  onSubmitSuccess: () => void;
  onClose: () => void;
  characters: Pick<Character, "id" | "name">[]; // 从 props 接收 characters
}

/**
 * 物品创建表单组件
 * 使用统一的 useMutationForm Hook，大幅简化代码
 * 遵循单一职责原则，仅负责物品创建的表单UI
 *
 * 重构收益：
 * - DRY: 消除了表单模板代码的重复，使用通用Hook
 * - KISS: 组件实现更简洁，只需关注UI渲染
 * - SOLID (SRP): 组件专注于UI渲染，表单逻辑由Hook处理
 * - 自动日志: 集成了 useFormWithLogging 的日志功能
 */
export const ItemForm: React.FC<ItemFormProps> = ({
  onSubmitSuccess,
  onClose,
  characters
}): React.ReactElement => {
  const { t } = useTranslation();

  // ✅ 使用统一 Hook 获取所有实体类型的提及数据
  const mentionOptions = useMentionOptions();

  // ✅ 一行代码完成所有状态管理、验证、API绑定和日志
  const { form, onSubmit, isPending } = useMutationForm({
    context: "ItemForm",
    schema: createItemSchema,
    mutation: useAddItemMutation(),
    defaultValues: {
      name: "",
      description: "",
      type: "其他",
      appearance: "",
      history: "",
      abilities: "",
      ownerId: "none",
    },
    onSuccess: () => {
      onSubmitSuccess();
      onClose();
    },
    // 处理表单数据转换，将"none"转换为空字符串
    onSubmit: (data) => {
      // 转换ownerId：将"none"转换为空字符串，以匹配数据库期望的空值
      if (data.ownerId === "none") {
        data.ownerId = "";
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

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("item.description")}</FormLabel>
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

        {/* 外观描述 */}
        <FormField
          control={form.control}
          name="appearance"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("item.appearance")}</FormLabel>
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

        {/* 历史来源 */}
        <FormField
          control={form.control}
          name="history"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("item.history")}</FormLabel>
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

        {/* 功能或能力 */}
        <FormField
          control={form.control}
          name="abilities"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("item.abilities")}</FormLabel>
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

        <LoadingButton
          type="submit"
          className="w-full"
          isLoading={isPending}
          loadingText={t("common.saving")}
        >
          {t("item.saveItem")}
        </LoadingButton>
      </form>
    </Form>
  );
};
