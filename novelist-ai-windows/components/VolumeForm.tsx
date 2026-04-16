import React from "react";
import { useFormWithLogging } from "../lib/logging";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCreateVolumeMutation } from "../lib/react-query/db-queries";
import { createVolumeSchema } from "../lib/schemas";
import type { CreateVolume } from "../types";
import { Button } from "./ui/button";
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

const FORM_CONTEXT = "VolumeForm";

interface VolumeFormProps {
  onSubmitSuccess: () => void;
}

/**
 * 卷创建表单组件
 * 使用React Hook Form + React Query模式，提供类型安全的表单处理
 * 遵循单一职责原则，仅负责卷创建的表单UI
 */
export const VolumeForm: React.FC<VolumeFormProps> = ({
  onSubmitSuccess,
}): React.ReactElement => {
  const form = useFormWithLogging<CreateVolume>({
    context: FORM_CONTEXT,
    resolver: zodResolver(createVolumeSchema),
    defaultValues: {
      title: "",
      description: "",
    },
  });

  const createVolumeMutation = useCreateVolumeMutation();

  const handleSubmit = (data: CreateVolume) => {
    // ✅ 直接在 mutate 调用时传入 onSuccess 回调
    createVolumeMutation.mutate(data, {
      onSuccess: () => {
        // mutation 成功后执行这里的逻辑
        onSubmitSuccess(); // 关闭对话框
        form.reset(); // 重置表单
      },
      // onError 也可以在这里处理特定于此表单的错误
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>卷标题</FormLabel>
              <FormControl>
                <Input placeholder="例如：第一卷：序章" {...field} />
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
              <FormLabel>卷描述（可选）</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="卷的简介或概述..."
                  className="resize-none"
                  rows={3}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <LoadingButton
          type="submit"
          className="w-full"
          isLoading={createVolumeMutation.isPending}
          loadingText="创建中..."
        >
          创建卷
        </LoadingButton>
      </form>
    </Form>
  );
};
