import { useEffect, useRef, useCallback, useState } from "react";

/**
 * 防抖 Hook
 * 延迟更新值，在指定延迟时间内只保留最新的值
 * 遵循单一职责原则，仅负责防抖逻辑
 *
 * @param value 需要防抖的值
 * @param delay 延迟时间（毫秒）
 * @returns 防抖后的值
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // 清除定时器，防止内存泄漏
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * 防抖回调 Hook (修正版)
 * 使用 useRef 确保回调和定时器在多次渲染间保持稳定
 * 遵循单一职责原则，仅负责防抖回调逻辑
 *
 * @param callback 需要防抖的回调函数
 * @param delay 延迟时间（毫秒）
 * @returns 防抖后的回调函数，附带 cancel 方法
 */
export function useDebouncedCallback<A extends any[]>(
  callback: (...args: A) => void,
  delay: number
) {
  const callbackRef = useRef(callback);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 始终使用最新的回调函数
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // 组件卸载时清除定时器
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const debouncedCallback = useCallback(
    (...args: A) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    },
    [delay]
  );
  
  // 提供一个 cancel 方法
  const cancel = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // 将 cancel 方法附加到返回的函数上
  return Object.assign(debouncedCallback, { cancel });
}
