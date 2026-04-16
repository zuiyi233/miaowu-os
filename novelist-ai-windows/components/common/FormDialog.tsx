import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "../ui/dialog";

/**
 * 通用表单对话框组件的属性接口
 * 遵循单一职责原则，仅负责定义组件的输入参数
 * 使用泛型确保类型安全
 */
interface FormDialogProps<T = Record<string, unknown>> {
  /** 触发对话框的元素 */
  trigger: React.ReactNode;
  /** 对话框标题 */
  title: string;
  /** 对话框描述（可选） */
  description?: string;
  /** 表单组件，接收 onSubmitSuccess 回调 */
  formComponent: React.ComponentType<{ onSubmitSuccess: () => void; data?: T }>;
  /** 表单组件的初始数据（可选） */
  initialData?: T;
  /** 对话框最大宽度类名（可选） */
  maxWidthClass?: string;
  /** 外部控制对话框打开状态的回调（可选） */
  onOpenChange?: (open: boolean) => void;
  /** 外部控制的对话框打开状态（可选） */
  controlledOpen?: boolean;
}

/**
 * 通用表单对话框组件
 * 遵循 DRY 原则，消除对话框容器的重复代码
 * 遵循组合优于继承原则，通过 props 接收具体的表单组件
 * 遵循开放封闭原则，支持扩展新的表单类型而无需修改组件
 *
 * @param trigger 触发对话框的元素
 * @param title 对话框标题
 * @param description 对话框描述（可选）
 * @param formComponent 表单组件
 * @param initialData 表单初始数据（可选）
 * @param maxWidthClass 最大宽度类名（可选）
 * @param onOpenChange 对话框状态变化回调（可选）
 * @param controlledOpen 外部控制的对话框状态（可选）
 * @returns 渲染通用表单对话框组件
 */
export const FormDialog = <T = Record<string, unknown>,>({
  trigger,
  title,
  description,
  formComponent: FormComponent,
  initialData,
  maxWidthClass = "max-w-2xl",
  onOpenChange,
  controlledOpen,
}: FormDialogProps<T>) => {
  // 内部状态管理，支持外部控制
  const [internalOpen, setInternalOpen] = useState(false);

  // 如果提供了 controlledOpen，使用外部控制；否则使用内部状态
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setIsOpen = onOpenChange || setInternalOpen;

  // 表单提交成功处理
  const handleSuccess = () => {
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className={maxWidthClass}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <FormComponent onSubmitSuccess={handleSuccess} data={initialData} />
      </DialogContent>
    </Dialog>
  );
};

/**
 * 创建受控表单对话框的 Hook
 * 用于需要外部控制对话框状态的场景
 * 遵循单一职责原则，专注于状态管理逻辑
 *
 * @param initialState 初始打开状态
 * @returns [isOpen, setIsOpen, FormDialogComponent] 元组
 */
export const useControlledFormDialog = <T = Record<string, unknown>,>(
  initialState = false
) => {
  const [isOpen, setIsOpen] = useState(initialState);

  /**
   * 创建受控的 FormDialog 组件
   * 预设了状态控制，简化使用
   */
  const ControlledFormDialog = React.memo(
    (props: Omit<FormDialogProps<T>, "controlledOpen" | "onOpenChange">) => (
      <FormDialog<T>
        {...props}
        controlledOpen={isOpen}
        onOpenChange={setIsOpen}
      />
    )
  );

  ControlledFormDialog.displayName = "ControlledFormDialog";

  return [isOpen, setIsOpen, ControlledFormDialog] as const;
};

/**
 * 表单对话框预设配置
 * 提供常用的对话框配置，遵循 DRY 原则
 */
export const FormDialogPresets = {
  /**
   * 创建对话框预设
   * 适用于创建新资源的场景
   */
  create: {
    maxWidthClass: "max-w-2xl",
  },

  /**
   * 编辑对话框预设
   * 适用于编辑现有资源的场景
   */
  edit: {
    maxWidthClass: "max-w-2xl",
  },

  /**
   * 删除确认对话框预设
   * 适用于删除确认的场景
   */
  delete: {
    maxWidthClass: "max-w-md",
  },

  /**
   * 大型表单对话框预设
   * 适用于包含大量字段的表单
   */
  large: {
    maxWidthClass: "max-w-4xl",
  },
} as const;

export default FormDialog;
