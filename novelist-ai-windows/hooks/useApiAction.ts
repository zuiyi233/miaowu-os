import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import {
  handleError,
  createErrorHandler,
  type StandardError,
} from "../lib/utils/errorHandler";
import { retry, type RetryOptions, type RetryResult } from "../lib/utils/retry";

/**
 * API 操作配置选项
 * 遵循单一职责原则，仅负责配置 API 操作的行为
 */
interface ApiActionOptions {
  successMessage?: string;
  errorMessage?: string;
  loadingMessage?: string;
  /** 是否支持请求取消，默认为 true */
  cancelable?: boolean;
  /** 请求取消时的回调函数 */
  onCancel?: () => void;
  /** 错误处理上下文，用于错误追踪 */
  errorContext?: string;
  /** 是否使用统一错误处理中间件，默认为 true */
  useUnifiedErrorHandler?: boolean;
  /** 重试配置选项 */
  retryOptions?: RetryOptions;
  /** 是否启用重试机制，默认为 false */
  enableRetry?: boolean;
}

/**
 * API 操作 Hook 的返回值
 * 提供执行函数、状态信息和取消功能
 */
interface UseApiActionReturn<T extends (...args: any[]) => Promise<any>> {
  execute: (...args: Parameters<T>) => Promise<ReturnType<T> | null>;
  cancel: () => void;
  isLoading: boolean;
  error: Error | null;
  isCanceled: boolean;
}

/**
 * 可复用的 API 操作 Hook
 * 抽象异步操作的通用模式（加载状态、错误处理、成功通知、请求取消）
 * 遵循 DRY 原则，消除组件中的重复逻辑
 * 遵循开放封闭原则，支持请求取消功能扩展
 *
 * @param apiFn 要执行的异步函数
 * @param options 配置选项
 * @returns 执行函数、状态信息和取消功能
 */
export function useApiAction<T extends (...args: any[]) => Promise<any>>(
  apiFn: T,
  options: ApiActionOptions = {}
): UseApiActionReturn<T> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isCanceled, setIsCanceled] = useState(false);

  // 使用 useRef 存储 AbortController，避免在依赖数组中引起不必要的重新渲染
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsCanceled(true);
      setIsLoading(false);

      // 调用取消回调
      if (options.onCancel) {
        options.onCancel();
      }

      toast.info("请求已取消");
    }
  }, [options.onCancel]);

  const execute = useCallback(
    async (...args: Parameters<T>): Promise<ReturnType<T> | null> => {
      // 重置状态
      setIsLoading(true);
      setError(null);
      setIsCanceled(false);

      // 创建新的 AbortController
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // 创建上下文错误处理器
      const contextualErrorHandler = options.errorContext
        ? createErrorHandler(options.errorContext)
        : handleError;

      // 显示加载提示
      if (options.loadingMessage) {
        toast.info(options.loadingMessage);
      }

      try {
        // 检查是否已被取消
        if (abortController.signal.aborted) {
          throw new Error("请求已取消");
        }

        let result: ReturnType<T>;

        // 根据是否启用重试机制选择执行策略
        if (options.enableRetry) {
          // 使用重试机制执行
          const retryResult: RetryResult<ReturnType<T>> = await retry(
            async () => {
              // 检查取消状态
              if (abortController.signal.aborted) {
                throw new Error("请求已取消");
              }

              // 执行 API 函数，传入 signal（如果函数支持）
              if (options.cancelable !== false) {
                return await apiFn(...args, abortController.signal);
              } else {
                return await apiFn(...args);
              }
            },
            {
              ...options.retryOptions,
              shouldRetry: (error, attempt) => {
                // 取消的请求不重试
                if (error.type === "ABORT_ERROR") {
                  return false;
                }
                // 使用自定义重试条件或默认条件
                return (
                  options.retryOptions?.shouldRetry?.(error, attempt) ?? true
                );
              },
              onRetry: (attempt, error, delay) => {
                // 重试回调
                options.retryOptions?.onRetry?.(attempt, error, delay);
              },
            },
            options.errorContext
          );

          if (retryResult.success && retryResult.data) {
            result = retryResult.data;
          } else {
            throw retryResult.error || new Error("重试失败");
          }
        } else {
          // 直接执行，不使用重试
          if (options.cancelable !== false) {
            result = await apiFn(...args, abortController.signal);
          } else {
            result = await apiFn(...args);
          }
        }

        // 检查请求是否在执行过程中被取消
        if (abortController.signal.aborted) {
          throw new Error("请求已取消");
        }

        // 显示成功提示
        toast.success(options.successMessage || "操作成功！");

        return result;
      } catch (e: any) {
        // 处理取消请求的特殊情况
        if (e.name === "AbortError" || e.message === "请求已取消") {
          setIsCanceled(true);
          // 取消请求不显示错误提示，因为已经通过 cancel 函数处理了
          return null;
        }

        // 使用统一错误处理中间件
        let standardError: StandardError;
        if (options.useUnifiedErrorHandler !== false) {
          standardError = contextualErrorHandler(e);
        } else {
          // 回退到原始错误处理逻辑
          standardError = {
            type: "UNKNOWN_ERROR" as any,
            message: e.message || "操作失败",
            timestamp: new Date(),
            originalError: e,
          };
        }

        setError(
          standardError.originalError || new Error(standardError.message)
        );

        // 如果不使用统一错误处理，则显示自定义错误提示
        if (options.useUnifiedErrorHandler === false) {
          toast.error(options.errorMessage || "操作失败", {
            description: e.message || "请稍后重试",
          });
        }

        return null;
      } finally {
        // 清理 AbortController
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
        setIsLoading(false);
      }
    },
    [
      apiFn,
      options.successMessage,
      options.errorMessage,
      options.loadingMessage,
      options.cancelable,
      options.errorContext,
      options.useUnifiedErrorHandler,
      options.enableRetry,
      options.retryOptions,
    ]
  );

  // 组件卸载时自动取消正在进行的请求
  // 遵循单一职责原则，确保资源清理
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return { execute, cancel, isLoading, error, isCanceled };
}
