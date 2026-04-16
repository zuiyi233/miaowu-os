import React from "react";
import { useTranslation } from "react-i18next";
import { ChapterForm } from "./ChapterForm";
import { useModalStore } from "../stores/useModalStore";
import { useQueryClient } from "@tanstack/react-query";
import { DB_QUERY_KEYS } from "../lib/react-query/db-queries";

/**
 * 章节创建对话框组件的属性接口
 * 遵循单一职责原则，仅负责定义组件的输入参数
 */
interface ChapterCreationDialogProps {
  trigger: React.ReactNode;
  title?: string;
  description?: string;
}

/**
 * 章节创建对话框组件
 * 使用全局模态方案，遵循 DRY 原则
 * 集成React Query Mutations，自动处理数据刷新
 * 保持与原有组件相同的接口和行为
 *
 * 设计原则：
 * - KISS: 简化组件逻辑，只负责触发模态框
 * - DRY: 统一使用全局模态方案，消除重复的Dialog组件
 * - SOLID:
 *   - S: 单一职责，只负责触发章节创建模态框
 *   - D: 依赖抽象的useModalStore，而非具体实现
 *
 * @param trigger 触发对话框的元素
 * @param title 对话框标题，默认为"创建新章节"
 * @param description 对话框描述，默认为空
 * @returns 渲染章节创建对话框组件
 */
export const ChapterCreationDialog: React.FC<ChapterCreationDialogProps> = ({
  trigger,
  title,
  description,
}) => {
  const { t } = useTranslation();
  const { open } = useModalStore();
  const queryClient = useQueryClient();

  const resolvedTitle = title ?? t("chapter.createTitle", { defaultValue: t("chapter.newChapter") });
  const resolvedDescription = description ?? t("chapter.createDescription", { defaultValue: "" });

  // 处理章节创建
  const handleCreateChapter = () => {
    open({
      type: "dialog",
      component: () => (
        <div>
          <h2 className="text-lg font-semibold mb-4">{resolvedTitle}</h2>
          {resolvedDescription && (
            <p className="text-sm text-muted-foreground mb-4">{resolvedDescription}</p>
          )}
          <ChapterForm
            onSubmitSuccess={() => {
              // 刷新相关数据，确保UI显示最新数据
              queryClient.invalidateQueries({ queryKey: DB_QUERY_KEYS.novel });
              queryClient.invalidateQueries({
                queryKey: DB_QUERY_KEYS.volumes,
              });
              queryClient.invalidateQueries({
                queryKey: DB_QUERY_KEYS.chapters,
              });
            }}
          />
        </div>
      ),
      props: {},
    });
  };

  return <div onClick={handleCreateChapter}>{trigger}</div>;
};

/**
 * 便捷的章节创建对话框 Hook
 * 提供受控的对话框状态管理，简化使用
 * 遵循单一职责原则，专注于状态管理逻辑
 */
export const useChapterCreationDialog = () => {
  const { t } = useTranslation();
  const { open } = useModalStore();
  const queryClient = useQueryClient();

  // 表单提交成功处理
  const handleSuccess = () => {
    // 刷新相关数据，确保UI显示最新数据
    queryClient.invalidateQueries({ queryKey: DB_QUERY_KEYS.novel });
    queryClient.invalidateQueries({ queryKey: DB_QUERY_KEYS.volumes });
    queryClient.invalidateQueries({ queryKey: DB_QUERY_KEYS.chapters });
  };

  const ChapterCreationDialog = React.memo(
    ({
      trigger,
      title,
      description,
    }: Omit<ChapterCreationDialogProps, "trigger"> & {
      trigger: React.ReactNode;
    }) => {
      const resolvedTitle = title ?? t("chapter.createTitle", { defaultValue: t("chapter.newChapter") });
      const resolvedDescription = description ?? t("chapter.createDescription", { defaultValue: "" });

      const handleCreateChapter = () => {
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
              <ChapterForm onSubmitSuccess={handleSuccess} />
            </div>
          ),
          props: {},
        });
      };

      return <div onClick={handleCreateChapter}>{trigger}</div>;
    }
  );

  ChapterCreationDialog.displayName = "ChapterCreationDialog";

  return [false, () => {}, ChapterCreationDialog] as const;
};
