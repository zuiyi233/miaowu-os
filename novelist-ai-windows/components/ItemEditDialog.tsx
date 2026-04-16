import React from "react";
import { ItemEditForm } from "./ItemEditForm";
import type { Item } from "../types";

interface ItemEditDialogProps {
  item: Item;
  onSubmitSuccess: () => void;
  onClose: () => void;
}

/**
 * 物品编辑对话框组件
 * 包装ItemEditForm，提供对话框容器
 * 遵循单一职责原则，专注于对话框的展示逻辑
 */
export const ItemEditDialog: React.FC<ItemEditDialogProps> = ({
  item,
  onSubmitSuccess,
  onClose,
}) => {
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold mb-4">编辑物品</h2>
      <ItemEditForm
        item={item}
        onSubmitSuccess={onSubmitSuccess}
        onClose={onClose}
      />
    </div>
  );
};