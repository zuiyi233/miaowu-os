import React from "react";
import { useFormWithLogging } from "../lib/logging";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useCreateChapterMutation } from "../lib/react-query/db-queries";
import { createChapterSchema } from "../lib/schemas";
import type { CreateChapter } from "../types";
import { useNovelQuery } from "../lib/react-query/db-queries";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./ui/form";
import { LoadingButton } from "./common/LoadingButton";

const FORM_CONTEXT = "ChapterForm";

interface ChapterFormProps {
  onSubmitSuccess: () => void;
}

/**
 * 章节创建表单组件
 * 使用React Hook Form + React Query模式，提供类型安全的表单处理
 * 遵循单一职责原则，仅负责章节创建的表单UI
 */
export const ChapterForm: React.FC<ChapterFormProps> = ({
  onSubmitSuccess,
}): React.ReactElement => {
  const { t } = useTranslation();

  // 使用整合的React Query获取数据 - 性能优化：单次查询获取所有数据
  const { data: novelData } = useNovelQuery();

  // 从完整的小说数据中解构所需的数据
  const { volumes = [] } = novelData || {};

  const form = useFormWithLogging<CreateChapter>({
    context: FORM_CONTEXT,
    resolver: zodResolver(createChapterSchema),
    defaultValues: {
      title: "",
      volumeId: undefined,
    },
  });

  const createChapterMutation = useCreateChapterMutation();

  const handleSubmit = (data: CreateChapter) => {
    // ✅ 直接在 mutate 调用时传入 onSuccess 回调
    createChapterMutation.mutate(
      {
        chapter: data,
        volumeId: data.volumeId,
      },
      {
        onSuccess: () => {
          // mutation 成功后执行这里的逻辑
          onSubmitSuccess(); // 这个回调通常就是 onClose
          form.reset();
        },
      }
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("chapter.title_field")}</FormLabel>
              <FormControl>
                <Input placeholder={t("chapter.titlePlaceholder")} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="volumeId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("chapter.volume", { defaultValue: t("novel.volumes") })}</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t("chapter.volumePlaceholder", {
                        defaultValue: t("novel.volumes"),
                      })}
                    />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">
                    {t("chapter.noVolume", { defaultValue: t("common.none") })}
                  </SelectItem>
                  {volumes.map((volume) => (
                    <SelectItem key={volume.id} value={volume.id}>
                      {volume.title}
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
          isLoading={createChapterMutation.isPending}
          loadingText={t("common.creating", { defaultValue: t("common.loading") })}
        >
          {t("chapter.createChapter", { defaultValue: t("chapter.newChapter") })}
        </LoadingButton>
      </form>
    </Form>
  );
};
