import React from "react";
import { useTranslation } from "react-i18next";
import { NovelForm } from "./NovelForm";
import { useModalStore } from "../stores/useModalStore";
import { useQueryClient } from "@tanstack/react-query";
import { DB_QUERY_KEYS } from "../lib/react-query/db-queries";

/**
 * 小说创建对话框组件的属性接口
 * 遵循单一职责原则，仅负责定义组件的输入参数
 */
interface NovelCreationDialogProps {
  trigger: React.ReactNode;
  title?: string;
  description?: string;
}

/**
 * 小说创建对话框组件
 * 使用全局模态方案，遵循 DRY 原则
 * 集成React Query Mutations，自动处理数据刷新
 * 保持与原有组件相同的接口和行为
 *
 * 设计原则：
 * - KISS: 简化组件逻辑，只负责触发模态框
 * - DRY: 统一使用全局模态方案，消除重复的Dialog组件
 * - SOLID:
 *   - S: 单一职责，只负责触发小说创建模态框
 *   - D: 依赖抽象的useModalStore，而非具体实现
 *
 * @param trigger 触发对话框的元素
 * @param title 对话框标题，默认为"创建新小说"
 * @param description 对话框描述，默认为空
 * @returns 渲染小说创建对话框组件
 */
export const NovelCreationDialog: React.FC<NovelCreationDialogProps> = ({
  trigger,
  title,
  description,
}) => {
  const { t } = useTranslation();
  const { open } = useModalStore();
  const queryClient = useQueryClient();

  const resolvedTitle = title ?? t("novel.createTitle", { defaultValue: t("novel.newNovel") });
  const resolvedDescription = description ?? t("novel.createDescription", { defaultValue: "" });

  // 处理小说创建
  const handleCreateNovel = () => {
    open({
      type: "dialog",
      component: () => (
        <div>
          <h2 className="text-lg font-semibold mb-4">{resolvedTitle}</h2>
          {resolvedDescription && (
            <p className="text-sm text-muted-foreground mb-4">{resolvedDescription}</p>
          )}
          <NovelForm
            onSubmitSuccess={() => {
              // 刷新相关数据，确保UI显示最新数据
              queryClient.invalidateQueries({ queryKey: DB_QUERY_KEYS.novel });
              queryClient.invalidateQueries({
                queryKey: DB_QUERY_KEYS.volumes,
              });
              queryClient.invalidateQueries({
                queryKey: DB_QUERY_KEYS.chapters,
              });
              queryClient.invalidateQueries({
                queryKey: DB_QUERY_KEYS.characters,
              });
            }}
          />
        </div>
      ),
      props: {},
    });
  };

  return <div onClick={handleCreateNovel}>{trigger}</div>;
};

/**
 * 便捷的小说创建对话框 Hook
 * 提供受控的对话框状态管理，简化使用
 * 遵循单一职责原则，专注于状态管理逻辑
 */
export const useNovelCreationDialog = () => {
  const { t } = useTranslation();
  const { open } = useModalStore();
  const queryClient = useQueryClient();

  // 表单提交成功处理
  const handleSuccess = () => {
    // 刷新相关数据，确保UI显示最新数据
    queryClient.invalidateQueries({ queryKey: DB_QUERY_KEYS.novel });
    queryClient.invalidateQueries({ queryKey: DB_QUERY_KEYS.volumes });
    queryClient.invalidateQueries({ queryKey: DB_QUERY_KEYS.chapters });
    queryClient.invalidateQueries({ queryKey: DB_QUERY_KEYS.characters });
  };

  const NovelCreationDialog = React.memo(
    ({
      trigger,
      title,
      description,
    }: Omit<NovelCreationDialogProps, "trigger"> & {
      trigger: React.ReactNode;
    }) => {
      const resolvedTitle = title ?? t("novel.createTitle", { defaultValue: t("novel.newNovel") });
      const resolvedDescription = description ?? t("novel.createDescription", { defaultValue: "" });

      const handleCreateNovel = () => {
        open({
          type: "dialog",
          component: () => (
            <div>
              <h2 className="text-lg font-semibold mb-4">{resolvedTitle}</h2>
              {resolvedDescription && (
                <p className="text-sm text-muted-foreground mb-4">
                  {resolvedDescription}
                </p>
              )}
              <NovelForm onSubmitSuccess={handleSuccess} />
            </div>
          ),
          props: {},
        });
      };

      return <div onClick={handleCreateNovel}>{trigger}</div>;
    }
  );

  NovelCreationDialog.displayName = "NovelCreationDialog";

  return [false, () => {}, NovelCreationDialog] as const;
};
