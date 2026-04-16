import React from "react";
import { useModalStore } from "../stores/useModalStore";
import { useDeleteItemMutation } from "../lib/react-query/world-building.queries";
import { LoadingButton } from "./common/LoadingButton";
import type { Item } from "../types";

interface ItemDeleteDialogProps {
  item: Item;
  onClose: () => void;
}

/**
 * 物品删除确认对话框
 * 遵循单一职责原则，专注于删除确认逻辑
 */
export const ItemDeleteDialog: React.FC<ItemDeleteDialogProps> = ({
  item,
  onClose,
}) => {
  // 使用 React Query Mutation
  const deleteItemMutation = useDeleteItemMutation();

  const handleDelete = () => {
    deleteItemMutation.mutate(item.id, {
      onSuccess: () => {
        onClose(); // 删除成功后关闭对话框
      },
    });
  };

  return (
    <div className="p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">确认删除物品</h2>
        <p className="text-sm text-muted-foreground mt-2">
          您确定要删除物品 <strong>{item.name}</strong> 吗？此操作无法撤销。
        </p>
      </div>

      {/* 错误提示 */}
      {deleteItemMutation.error && (
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
          isLoading={deleteItemMutation.isPending}
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
 * 物品删除 Hook
 * 便捷打开删除模态框
 */
export const useItemDeleteDialog = () => {
  const { open } = useModalStore();

  const openItemDeleteDialog = (item: Item) => {
    open({
      type: "dialog",
      title: "确认删除物品",
      description: `您确定要删除物品 "${item.name}" 吗？此操作无法撤销。`,
      component: ItemDeleteDialog,
      props: {
        item,
      },
    });
  };

  return { openItemDeleteDialog };
};
