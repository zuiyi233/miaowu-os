import { create } from "zustand";
import { ComponentType } from "react";

/**
 * 通用 Props 类型，确保组件能接收 onClose 回调
 * 遵循接口隔离原则，只定义必要的接口
 */
type ModalComponentProps = {
  onClose: () => void;
  [key: string]: any; // 允许传递其他任意 props
};

/**
 * 模态层配置，包含组件、props 和类型
 * 遵循单一职责原则，专注于模态框配置管理
 */
interface ModalConfig<T extends ModalComponentProps = ModalComponentProps> {
  component: ComponentType<T>;
  props?: Omit<T, "onClose">;
  type: "dialog" | "drawer";
  title?: string; // 添加 title 配置
  description?: string; // 添加 description 配置
}

/**
 * 模态状态接口
 * 遵循单一职责原则，仅管理模态框状态
 */
interface ModalState {
  config: ModalConfig | null;
  open: <T extends ModalComponentProps>(config: ModalConfig<T>) => void;
  close: () => void;
}

/**
 * 全局模态层状态管理器
 * 使用 Zustand 进行集中式模态框状态管理
 * 遵循单一职责原则，仅负责模态框的显示和隐藏
 *
 * 设计原则应用：
 * - KISS: 简单直观的状态管理，只包含必要的配置和操作
 * - DRY: 统一的模态框管理方式，避免重复的状态管理代码
 * - SOLID:
 *   - SRP: 专注于模态框状态管理
 *   - OCP: 支持扩展新的模态框类型而无需修改现有代码
 *   - DIP: 组件依赖抽象的 ModalConfig 接口而非具体实现
 */
export const useModalStore = create<ModalState>((set) => ({
  config: null,
  open: (config) => set({ config }),
  close: () => set({ config: null }),
}));
