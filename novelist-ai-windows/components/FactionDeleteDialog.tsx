import React from "react";
import { useTranslation } from "react-i18next";
import { useModalStore } from "../stores/useModalStore";
import { useDeleteFactionMutation } from "../lib/react-query/world-building.queries";
import { LoadingButton } from "./common/LoadingButton";
import type { Faction } from "../types";

/**
 * 势力删除确认对话框组件的属性接口
 * 遵循单一职责原则，仅负责定义组件的输入参数
 */
interface FactionDeleteDialogProps {
  faction: Faction;
  onClose: () => void;
}

/**
 * 势力删除确认对话框组件
 * 迁移到全局模态框系统，消除局部useState
 * 遵循单一职责原则，专注于势力删除确认
 *
 * 设计原则应用：
 * - KISS: 简化删除逻辑，直接使用Mutation Hook
 * - DRY: 统一使用全局模态方案，消除重复的Dialog组件
 * - SOLID:
 *   - SRP: 组件专注于删除确认UI
 *   - DIP: 依赖抽象的onClose回调而非具体实现
 *
 * @param faction 要删除的势力数据
 * @param onClose 关闭模态框的回调函数
 * @returns 渲染势力删除确认对话框组件
 */
export const FactionDeleteDialog: React.FC<FactionDeleteDialogProps> = ({
  faction,
  onClose,
}) => {
  const { t } = useTranslation();

  // 使用React Query Mutation处理删除操作
  const deleteFactionMutation = useDeleteFactionMutation();

  // 处理删除确认
  const handleDelete = () => {
    deleteFactionMutation.mutate(faction.id, {
      onSuccess: () => {
        // 在成功回调中关闭对话框
        onClose();
      },
    });
  };

  return (
    <div className="p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{t("faction.confirmDeleteTitle")}</h2>
        <p className="text-sm text-muted-foreground mt-2">
          {t("faction.confirmDeleteWithName", { name: faction.name })}
        </p>
      </div>

      {/* 全局错误信息 */}
      {deleteFactionMutation.error && (
        <p className="text-sm text-destructive mb-4">{t("common.deleteFailed")}</p>
      )}

      <div className="flex justify-end space-x-2">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          {t("common.cancel")}
        </button>
        <LoadingButton
          onClick={handleDelete}
          isLoading={deleteFactionMutation.isPending}
          loadingText={t("common.deleting")}
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >
          {t("common.delete")}
        </LoadingButton>
      </div>
    </div>
  );
};

/**
 * 势力删除对话框Hook
 * 提供打开势力删除模态框的便捷方法
 * 遵循单一职责原则，专注于模态框的打开逻辑
 *
 * @returns 打开势力删除模态框的函数
 */
export const useFactionDeleteDialog = () => {
  const { open } = useModalStore();
  const { t } = useTranslation();

  /**
   * 打开势力删除模态框
   * @param faction 要删除的势力数据
   */
  const openFactionDeleteDialog = (faction: Faction) => {
    open({
      type: "dialog",
      title: t("faction.confirmDeleteTitle"),
      description: t("faction.confirmDeleteWithName", { name: faction.name }),
      component: FactionDeleteDialog,
      props: {
        faction,
      },
    });
  };

  return { openFactionDeleteDialog };
};
