import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  WritingStyle,
  WRITING_STYLES,
  DEFAULT_STYLES,
} from "../src/lib/prompts/styles/presets";

interface StyleState {
  styles: WritingStyle[];
  activeStyleId: string; // 当前选中的文风 ID

  // Actions
  setActiveStyleId: (id: string) => void;
  addCustomStyle: (name: string, systemPrompt: string) => void;
  updateStyle: (id: string, systemPrompt: string) => void;
  deleteStyle: (id: string) => void;
  resetStyles: () => void; // 恢复默认
  getActiveStyle: () => WritingStyle;
  isBuiltInStyle: (id: string) => boolean; // 检查是否为内置样式
}

export const useStyleStore = create<StyleState>()(
  persist(
    (set, get) => ({
      styles: WRITING_STYLES,
      activeStyleId: WRITING_STYLES[0].id,

      setActiveStyleId: (id) => set({ activeStyleId: id }),

      addCustomStyle: (name, systemPrompt) => {
        const newStyle: WritingStyle = {
          id: `custom_${Date.now()}`,
          name,
          description: "用户自定义文风",
          systemPrompt,
          userMessageTemplate: (input: string) => input, // 简单的模板，直接返回输入
          metadata: {
            recommendedGenres: [], // 用户自定义文风暂不设置推荐
            recommendedTags: [], // 用户自定义文风暂不设置推荐
            conflictGenres: [], // 用户自定义文风暂不设置冲突
          },
        };
        set((state) => ({
          styles: [...state.styles, newStyle],
          activeStyleId: newStyle.id, // 添加后自动选中
        }));
      },

      updateStyle: (id, systemPrompt) => {
        set((state) => ({
          styles: state.styles.map((s) =>
            s.id === id && !get().isBuiltInStyle(id)
              ? { ...s, systemPrompt }
              : s
          ),
        }));
      },

      deleteStyle: (id) => {
        set((state) => {
          const newStyles = state.styles.filter((s) => s.id !== id);
          // 如果删除了当前选中的，回退到第一个
          const nextActiveId =
            state.activeStyleId === id ? newStyles[0].id : state.activeStyleId;
          return {
            styles: newStyles,
            activeStyleId: nextActiveId,
          };
        });
      },

      resetStyles: () => {
        set({ styles: WRITING_STYLES, activeStyleId: WRITING_STYLES[0].id });
      },

      isBuiltInStyle: (id) => {
        return WRITING_STYLES.some((style) => style.id === id);
      },

      getActiveStyle: () => {
        const { styles, activeStyleId } = get();
        return styles.find((s) => s.id === activeStyleId) || styles[0];
      },
    }),
    {
      name: "novelist-styles-storage", // LocalStorage key
      storage: createJSONStorage(() => localStorage),
    }
  )
);
