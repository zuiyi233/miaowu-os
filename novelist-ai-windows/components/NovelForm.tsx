import React from "react";
import { useForm, SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useCreateNovelMutation } from "../lib/react-query/db-queries";
import { createNovelFormSchema } from "../lib/schemas";
import type { CreateNovelForm } from "../types";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./ui/form";
import { LoadingButton } from "./common/LoadingButton";

interface NovelFormProps {
  onSubmitSuccess: () => void;
}

/**
 * 小说创建表单组件
 * 迁移到React Query Mutations模式，统一数据变更逻辑
 * 遵循单一职责原则，仅负责小说创建的表单UI
 *
 * 设计原则应用：
 * - KISS: 简化表单处理逻辑，使用成熟的react-hook-form生态
 * - DRY: 统一使用React Query Mutations，消除Actions和Mutations混用
 * - SOLID:
 *   - SRP: 组件专注于表单UI和验证
 *   - DIP: 依赖抽象的Mutation Hook而非具体实现
 */
export const NovelForm: React.FC<NovelFormProps> = ({
  onSubmitSuccess,
}): React.ReactElement => {
  const { t } = useTranslation();

  // 使用React Hook Form管理表单状态，集成Zod验证
  const form = useForm<CreateNovelForm>({
    resolver: zodResolver(createNovelFormSchema),
    defaultValues: {
      title: "",
      outline: "",
    },
  });

  // 使用React Query Mutation处理数据提交
  const createNovelMutation = useCreateNovelMutation();

  // 表单提交处理 - 修复类型不匹配问题
  const handleSubmit: SubmitHandler<CreateNovelForm> = (data: CreateNovelForm) => {
    // 只传递Mutation需要的字段，避免类型不匹配
    createNovelMutation.mutate({
      title: data.title,
      outline: data.outline || "",
    }, {
      // ✅ 在这里直接处理成功回调
      onSuccess: () => {
        onSubmitSuccess();
      }
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        {/* 小说标题字段 */}
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("novel.name")}</FormLabel>
              <FormControl>
                <Input placeholder={t("novel.namePlaceholder")} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 小说大纲字段 */}
        <FormField
          control={form.control}
          name="outline"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("novel.outline", { defaultValue: t("novel.description") })}</FormLabel>
              <FormControl>
                <Textarea
                  placeholder={t("novel.outlinePlaceholder", {
                    defaultValue: t("novel.descriptionPlaceholder"),
                  })}
                  className="resize-none"
                  rows={4}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 全局错误信息 */}
        {createNovelMutation.error && (
          <p className="text-sm text-destructive">
            {t("novel.createFailed", { defaultValue: t("common.error") })}
          </p>
        )}

        {/* 提交按钮 */}
        <LoadingButton
          type="submit"
          className="w-full"
          isLoading={createNovelMutation.isPending}
          loadingText={t("common.creating", { defaultValue: t("common.loading") })}
        >
          {t("novel.createNovel", { defaultValue: t("novel.newNovel") })}
        </LoadingButton>
      </form>
    </Form>
  );
};
