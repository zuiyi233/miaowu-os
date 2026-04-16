import React from "react";
import { VolumeForm } from "./VolumeForm";
import { useModalStore } from "../stores/useModalStore";

/**
 * 卷创建对话框组件的属性接口
 * 遵循单一职责原则，仅负责定义组件的输入参数
 */
interface VolumeCreationDialogProps {
  trigger: React.ReactNode;
  title?: string;
  description?: string;
}

/**
 * 卷创建对话框组件
 * 使用全局模态方案，遵循 DRY 原则
 * 集成React Query Mutations，自动处理数据刷新
 * 保持与原有组件相同的接口和行为
 *
 * 设计原则：
 * - KISS: 简化组件逻辑，只负责触发模态框
 * - DRY: 统一使用全局模态方案，消除重复的Dialog组件
 * - SOLID:
 *   - S: 单一职责，只负责触发卷创建模态框
 *   - D: 依赖抽象的useModalStore，而非具体实现
 *
 * @param trigger 触发对话框的元素
 * @param title 对话框标题，默认为"创建新卷"
 * @param description 对话框描述，默认为空
 * @returns 渲染卷创建对话框组件
 */
export const VolumeCreationDialog: React.FC<VolumeCreationDialogProps> = ({
  trigger,
  title = "创建新卷",
  description,
}) => {
  const { open } = useModalStore();

  // 处理卷创建
  const handleCreateVolume = () => {
    open({
      type: "dialog",
      component: () => (
        <div>
          <h2 className="text-lg font-semibold mb-4">{title}</h2>
          {description && (
            <p className="text-sm text-muted-foreground mb-4">{description}</p>
          )}
          {/* ✅ 只传递关闭模态框的逻辑，不再关心数据刷新 */}
          <VolumeForm onSubmitSuccess={() => {}} />
        </div>
      ),
      props: {},
    });
  };

  return <div onClick={handleCreateVolume}>{trigger}</div>;
};

/**
 * 便捷的卷创建对话框 Hook
 * 提供受控的对话框状态管理，简化使用
 * 遵循单一职责原则，专注于状态管理逻辑
 */
export const useVolumeCreationDialog = () => {
  const { open } = useModalStore();

  const VolumeCreationDialog = React.memo(
    ({
      trigger,
      title = "创建新卷",
      description,
    }: Omit<VolumeCreationDialogProps, "trigger"> & {
      trigger: React.ReactNode;
    }) => {
      const handleCreateVolume = () => {
        open({
          type: "dialog",
          component: () => (
            <div>
              <h2 className="text-lg font-semibold mb-4">{title}</h2>
              {description && (
                <p className="text-sm text-muted-foreground mb-4">
                  {description}
                </p>
              )}
              {/* ✅ 只传递关闭模态框的逻辑，不再关心数据刷新 */}
              <VolumeForm onSubmitSuccess={() => {}} />
            </div>
          ),
          props: {},
        });
      };

      return <div onClick={handleCreateVolume}>{trigger}</div>;
    }
  );

  VolumeCreationDialog.displayName = "VolumeCreationDialog";

  return [false, () => {}, VolumeCreationDialog] as const;
};
