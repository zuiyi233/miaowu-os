import { create } from "zustand";

export type ModalType = "dialog" | "sheet" | "alert";

export interface ModalConfig {
  type: ModalType;
  title: string;
  description?: string;
  component: React.ComponentType<any>;
  props?: Record<string, any>;
  size?: "sm" | "md" | "lg" | "xl" | "full";
}

interface ModalState {
  modal: ModalConfig | null;
  isOpen: boolean;
  open: (config: ModalConfig) => void;
  close: () => void;
}

export const useModalStore = create<ModalState>((set) => ({
  modal: null,
  isOpen: false,
  open: (config) => set({ modal: config, isOpen: true }),
  close: () => set({ modal: null, isOpen: false }),
}));
