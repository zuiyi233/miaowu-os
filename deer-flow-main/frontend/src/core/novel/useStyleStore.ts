import { create } from "zustand";

export interface WritingStyle {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  userMessageTemplate?: (input: string) => string;
  metadata?: {
    recommendedGenres?: string[];
    recommendedTags?: string[];
    conflictGenres?: string[];
  };
}

export const DEFAULT_STYLES: WritingStyle[] = [
  {
    id: "web-novel",
    name: "网文风",
    description: "通俗易懂，节奏明快，适合连载",
    systemPrompt: "你是一个网络小说作家。请使用通俗易懂的语言，节奏明快，情节紧凑，吸引读者继续阅读。",
  },
  {
    id: "literary",
    name: "文艺风",
    description: "文笔优美，意境深远，注重情感表达",
    systemPrompt: "你是一个文艺小说作家。请使用优美的语言，注重意境的营造和情感的表达，让读者沉浸在你的文字中。",
  },
  {
    id: "classical",
    name: "古典风",
    description: "古色古香，文雅庄重，适合历史武侠",
    systemPrompt: "你是一个古典小说作家。请使用古色古香的语言，文雅庄重的风格，为读者展现一个充满传统韵味的世界。",
  },
  {
    id: "modern",
    name: "现代风",
    description: "简洁利落，直白有力，适合都市现实",
    systemPrompt: "你是一个现代小说作家。请使用简洁利落的语言，直白有力地叙述，真实地反映现代都市生活。",
  },
  {
    id: "fantasy",
    name: "奇幻风",
    description: "想象丰富，气势恢宏，适合玄幻奇幻",
    systemPrompt: "你是一个奇幻小说作家。请发挥丰富的想象力，营造气势恢宏的世界观，让读者惊叹于你的创造力。",
  },
];

interface StyleState {
  styles: WritingStyle[];
  activeStyleId: string;
  setActiveStyleId: (id: string) => void;
  addCustomStyle: (name: string, systemPrompt: string) => void;
  updateStyle: (id: string, systemPrompt: string) => void;
  deleteStyle: (id: string) => void;
  resetStyles: () => void;
  getActiveStyle: () => WritingStyle;
  isBuiltInStyle: (id: string) => boolean;
}

export const useStyleStore = create<StyleState>()((set, get) => ({
  styles: DEFAULT_STYLES,
  activeStyleId: DEFAULT_STYLES[0].id,

  setActiveStyleId: (id) => set({ activeStyleId: id }),

  addCustomStyle: (name, systemPrompt) => {
    const newStyle: WritingStyle = {
      id: `custom_${Date.now()}`,
      name,
      description: "用户自定义文风",
      systemPrompt,
      userMessageTemplate: (input: string) => input,
      metadata: {
        recommendedGenres: [],
        recommendedTags: [],
        conflictGenres: [],
      },
    };
    set((state) => ({
      styles: [...state.styles, newStyle],
      activeStyleId: newStyle.id,
    }));
  },

  updateStyle: (id, systemPrompt) => {
    set((state) => ({
      styles: state.styles.map((s) =>
        s.id === id && !get().isBuiltInStyle(id) ? { ...s, systemPrompt } : s
      ),
    }));
  },

  deleteStyle: (id) => {
    set((state) => {
      const newStyles = state.styles.filter((s) => s.id !== id);
      const nextActiveId =
        state.activeStyleId === id ? newStyles[0].id : state.activeStyleId;
      return {
        styles: newStyles,
        activeStyleId: nextActiveId,
      };
    });
  },

  resetStyles: () => {
    set({ styles: DEFAULT_STYLES, activeStyleId: DEFAULT_STYLES[0].id });
  },

  isBuiltInStyle: (id) => {
    return DEFAULT_STYLES.some((style) => style.id === id);
  },

  getActiveStyle: () => {
    const { styles, activeStyleId } = get();
    return styles.find((s) => s.id === activeStyleId) || styles[0];
  },
}));
