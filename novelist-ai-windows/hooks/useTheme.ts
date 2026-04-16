import { useState, useEffect, useCallback } from "react";
import type { Theme } from "@/types";

/**
 * 主题管理 Hook
 * 提供主题切换和持久化功能
 * 遵循单一职责原则，仅负责主题相关的状态管理
 */
export function useTheme() {
  // 从 localStorage 获取保存的主题，默认为 'system'
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = localStorage.getItem("theme") as Theme;
    return savedTheme || "system";
  });

  // 应用主题到 DOM
  useEffect(() => {
    const root = window.document.documentElement;

    // 清除所有主题类
    root.classList.remove("light", "dark");

    if (theme === "system") {
      // 跟随系统主题
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
      root.classList.add(systemTheme);
    } else {
      // 应用指定主题
      root.classList.add(theme);
    }

    // 持久化主题设置
    localStorage.setItem("theme", theme);
  }, [theme]);

  // 循环切换主题：light -> dark -> system -> light
  const cycleTheme = useCallback(() => {
    setTheme((prevTheme) => {
      switch (prevTheme) {
        case "light":
          return "dark";
        case "dark":
          return "system";
        case "system":
          return "light";
        default:
          return "light";
      }
    });
  }, []);

  // 直接设置主题
  const setThemeDirectly = useCallback((newTheme: Theme) => {
    setTheme(newTheme);
  }, []);

  return {
    theme,
    setTheme: setThemeDirectly,
    cycleTheme,
  };
}
