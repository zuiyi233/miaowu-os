import { UseMutationResult } from "@tanstack/react-query";
import { z } from "zod";
// 复用已有的日志增强 Hook
import { useFormWithLogging } from "../lib/logging";
import { zodResolver } from "@hookform/resolvers/zod";
import type { CreateCharacter, CreateChapter, CreateVolume, CreateFaction, CreateSetting } from "../types";

/**
 * 通用表单与数据变更逻辑Hook
 * 遵循DRY原则，将表单创建、提交和与React Query Mutation绑定的逻辑抽象化
 *
 * 设计原则应用：
 * - DRY: 消除表单组件中的重复模板代码
 * - KISS: 简化表单组件的实现，只需提供Schema、Mutation和默认值
 * - SOLID (SRP): 专注于表单逻辑与Mutation绑定的单一职责
 * - SOLID (OCP): 易于扩展，不修改现有代码即可支持新的表单类型
 */
interface UseMutationFormProps<TValues extends Record<string, any>> {
  /** 日志上下文，用于表单日志记录 */
  context: string;
  /** Zod验证模式 */
  schema: z.ZodType<TValues>;
  /** React Query Mutation Hook实例 */
  mutation: UseMutationResult<any, Error, TValues, unknown>;
  /** 表单默认值 */
  defaultValues: TValues;
  /** 成功回调函数 - 简化：通常不需要返回 data */
  onSuccess?: () => void;
  /** 错误回调函数 */
  onError?: (error: Error) => void;
  /** 表单提交前的额外处理函数 */
  onSubmit?: (values: TValues) => void;
}

/**
 * 通用表单Hook
 * 封装表单创建、提交和与React Query Mutation绑定的所有逻辑
 *
 * @param props Hook配置属性
 * @returns 表单实例、提交处理函数和Mutation状态
 */
export function useMutationForm<TValues extends Record<string, any>>({
  context,
  schema,
  mutation,
  defaultValues,
  onSuccess,
  onError,
  onSubmit,
}: UseMutationFormProps<TValues>) {
  
  // 1. 直接使用带日志的 Form Hook
  const form = useFormWithLogging<TValues>({
    context,
    resolver: zodResolver(schema) as any,
    defaultValues: defaultValues as any,
  });

  // 2. 统一处理提交逻辑
  const handleSubmit = (data: TValues) => {
    // 执行提交前的额外处理（如果提供）
    if (onSubmit) {
      onSubmit(data);
    }

    // 调用Mutation，并传入成功和错误回调
    mutation.mutate(data, {
      onSuccess: () => {
        // 重置表单
        form.reset();
        // 执行成功回调
        onSuccess?.();
      },
      onError: (error) => {
        // 执行错误回调
        onError?.(error);
      },
      // 错误已由 Global Error Handler 处理，这里无需重复
    });
  };

  // 返回简化的接口，直接暴露给 <Form> 组件的 onSubmit
  return {
    form,
    onSubmit: form.handleSubmit(handleSubmit),
    isPending: mutation.isPending,
    // 暴露便捷方法供 UI 使用
    control: form.control,
  };
}

/**
 * 角色表单专用Hook
 * 提供类型安全的角色表单处理
 */
export function useCharacterForm(mutation: UseMutationResult<any, Error, CreateCharacter, unknown>, onSuccess?: () => void) {
  return useMutationForm({
    context: "CharacterForm",
    schema: z.object({
      name: z.string().min(1, "角色名不能为空"),
      description: z.string().optional(),
    }),
    mutation,
    defaultValues: {
      name: "",
      description: "",
    },
    onSuccess,
  });
}

/**
 * 章节表单专用Hook
 * 提供类型安全的章节表单处理
 */
export function useChapterForm(mutation: UseMutationResult<any, Error, CreateChapter, unknown>, onSuccess?: () => void) {
  return useMutationForm({
    context: "ChapterForm",
    schema: z.object({
      title: z.string().min(1, "章节标题不能为空"),
      volumeId: z.string().optional(),
    }),
    mutation,
    defaultValues: {
      title: "",
      volumeId: undefined,
    },
    onSuccess,
  });
}

/**
 * 卷表单专用Hook
 * 提供类型安全的卷表单处理
 */
export function useVolumeForm(mutation: UseMutationResult<any, Error, CreateVolume, unknown>, onSuccess?: () => void) {
  return useMutationForm({
    context: "VolumeForm",
    schema: z.object({
      title: z.string().min(1, "卷标题不能为空"),
      description: z.string().optional(),
    }),
    mutation,
    defaultValues: {
      title: "",
      description: "",
    },
    onSuccess,
  });
}

/**
 * 势力表单专用Hook
 * 提供类型安全的势力表单处理
 */
export function useFactionForm(mutation: UseMutationResult<any, Error, CreateFaction, unknown>, onSuccess?: () => void) {
  return useMutationForm({
    context: "FactionForm",
    schema: z.object({
      name: z.string().min(1, "势力名称不能为空"),
      description: z.string().optional(),
      ideology: z.string().optional(),
      leaderId: z.string().optional(),
    }),
    mutation,
    defaultValues: {
      name: "",
      description: "",
      ideology: "",
      leaderId: "",
    },
    onSuccess,
  });
}

/**
 * 场景表单专用Hook
 * 提供类型安全的场景表单处理
 */
export function useSettingForm(mutation: UseMutationResult<any, Error, CreateSetting, unknown>, onSuccess?: () => void) {
  return useMutationForm({
    context: "SettingForm",
    schema: z.object({
      name: z.string().min(1, "场景名不能为空"),
      description: z.string().optional(),
    }),
    mutation,
    defaultValues: {
      name: "",
      description: "",
    },
    onSuccess,
  });
}