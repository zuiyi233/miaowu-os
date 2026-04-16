import { create } from "zustand";
import { logger } from "../lib/logging";

interface EmbeddingTask {
  id: string;
  type: "character" | "item" | "setting" | "faction";
  content: string; // 待向量化的文本内容
  retryCount: number;
}

interface EmbeddingState {
  // 待处理队列 (FIFO)
  queue: EmbeddingTask[];
  isProcessing: boolean;

  // Actions
  addToQueue: (task: Omit<EmbeddingTask, "retryCount">) => void;
  popTask: () => EmbeddingTask | undefined;
  setProcessing: (status: boolean) => void;
  retryTask: (task: EmbeddingTask) => void;
  clearQueue: () => void;
  getQueueLength: () => number;
}

export const useEmbeddingStore = create<EmbeddingState>((set, get) => ({
  queue: [],
  isProcessing: false,

  addToQueue: (task) => {
    // 简单的去重：如果ID已存在，更新内容即可，不用重复添加
    set((state) => {
      const existingIdx = state.queue.findIndex((t) => t.id === task.id);
      if (existingIdx !== -1) {
        const newQueue = [...state.queue];
        newQueue[existingIdx] = {
          ...newQueue[existingIdx],
          content: task.content,
        };
        return { queue: newQueue };
      }
      return { queue: [...state.queue, { ...task, retryCount: 0 }] };
    });
    logger.debug("EmbeddingStore", "Added task to queue", task);
  },

  popTask: () => {
    const state = get();
    if (state.queue.length === 0) return undefined;
    const task = state.queue[0];
    set({ queue: state.queue.slice(1) });
    return task;
  },

  retryTask: (task) => {
    if (task.retryCount > 3) {
      logger.error("EmbeddingStore", "Task failed max retries, dropping", task);
      return;
    }
    set((state) => ({
      queue: [...state.queue, { ...task, retryCount: task.retryCount + 1 }],
    }));
  },

  setProcessing: (status) => set({ isProcessing: status }),

  clearQueue: () => set({ queue: [] }),

  getQueueLength: () => get().queue.length,
}));
