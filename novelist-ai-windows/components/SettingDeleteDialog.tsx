import React from "react";
import { useModalStore } from "../stores/useModalStore";
import { useDeleteSettingMutation } from "../lib/react-query/world-building.queries";
import { LoadingButton } from "./common/LoadingButton";
import type { Setting } from "../types";

/**
 * 场景删除确认对话框组件的属性接口
 * 遵循单一职责原则，仅负责定义组件的输入参数
 */
interface SettingDeleteDialogProps {
  setting: Setting;
  onClose: () => void;
}

/**
 * 场景删除确认对话框组件
 * 迁移到全局模态框系统，消除局部useState
 * 遵循单一职责原则，专注于场景删除确认
 *
 * 设计原则应用：
 * - KISS: 简化删除逻辑，直接使用Mutation Hook
 * - DRY: 统一使用全局模态方案，消除重复的Dialog组件
 * - SOLID:
 *   - SRP: 组件专注于删除确认UI
 *   - DIP: 依赖抽象的onClose回调而非具体实现
 *
 * @param setting 要删除的场景数据
 * @param onClose 关闭模态框的回调函数
 * @returns 渲染场景删除确认对话框组件
 */
export const SettingDeleteDialog: React.FC<SettingDeleteDialogProps> = ({
  setting,
  onClose,
}) => {
  // 使用React Query Mutation处理删除操作
  const deleteSettingMutation = useDeleteSettingMutation();

  // 处理删除确认
  const handleDelete = () => {
    deleteSettingMutation.mutate(setting.id, {
      onSuccess: () => {
        // 在成功回调中关闭对话框
        onClose();
      },
    });
  };

  return (
    <div className="p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">确认删除场景</h2>
        <p className="text-sm text-muted-foreground mt-2">
          您确定要删除场景 <strong>{setting.name}</strong>{" "}
          吗？此操作无法撤销。
        </p>
      </div>

      {/* 全局错误信息 */}
      {deleteSettingMutation.error && (
        <p className="text-sm text-destructive mb-4">删除失败，请重试</p>
      )}

      <div className="flex justify-end space-x-2">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          取消
        </button>
        <LoadingButton
          onClick={handleDelete}
          isLoading={deleteSettingMutation.isPending}
          loadingText="删除中..."
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >
          删除
        </LoadingButton>
      </div>
    </div>
  );
};

/**
 * 场景删除对话框Hook
 * 提供打开场景删除模态框的便捷方法
 * 遵循单一职责原则，专注于模态框的打开逻辑
 *
 * @returns 打开场景删除模态框的函数
 */
export const useSettingDeleteDialog = () => {
  const { open } = useModalStore();

  /**
   * 打开场景删除模态框
   * @param setting 要删除的场景数据
   */
  const openSettingDeleteDialog = (setting: Setting) => {
    open({
      type: "dialog",
      title: "确认删除场景", // 添加 title
      description: `您确定要删除场景 "${setting.name}" 吗？此操作无法撤销。`, // 添加 description
      component: SettingDeleteDialog,
      props: {
        setting,
      },
    });
  };

  return { openSettingDeleteDialog };
};