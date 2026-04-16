import React from "react";
import { useModalStore } from "../stores/useModalStore";
import { CharacterEditForm } from "./CharacterEditForm";
import { useQueryClient } from "@tanstack/react-query";
import { DB_QUERY_KEYS } from "../lib/react-query/db-queries";
import type { Character } from "../types";

/**
 * 角色编辑对话框组件的属性接口
 * 遵循单一职责原则，仅负责定义组件的输入参数
 */
interface CharacterEditDialogProps {
  character: Character;
  title?: string;
  description?: string;
  onClose: () => void;
}

/**
 * 角色编辑对话框组件
 * 迁移到全局模态框系统，消除局部useState
 * 遵循 DRY 原则，统一使用全局模态方案
 *
 * 设计原则应用：
 * - KISS: 简化组件逻辑，只负责表单渲染
 * - DRY: 统一使用全局模态方案，消除重复的Dialog组件
 * - SOLID:
 *   - SRP: 组件专注于角色编辑表单的渲染
 *   - DIP: 依赖抽象的onClose回调而非具体实现
 *
 * @param character 要编辑的角色数据
 * @param title 对话框标题，默认为"编辑角色"
 * @param description 对话框描述，默认为空
 * @param onClose 关闭模态框的回调函数
 * @returns 渲染角色编辑表单组件
 */
export const CharacterEditDialog: React.FC<CharacterEditDialogProps> = ({
  character,
  title = "编辑角色",
  description,
  onClose,
}) => {
  const queryClient = useQueryClient();

  // 表单提交成功处理
  const handleSuccess = () => {
    // 刷新角色数据，确保UI显示最新数据
    queryClient.invalidateQueries({ queryKey: DB_QUERY_KEYS.novel });
    queryClient.invalidateQueries({ queryKey: DB_QUERY_KEYS.characters });
    // 关闭模态框
    onClose();
  };

  return (
    <div className="max-w-2xl p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      <CharacterEditForm
        character={character}
        onSubmitSuccess={handleSuccess}
      />
    </div>
  );
};

/**
 * 角色编辑对话框Hook
 * 提供打开角色编辑模态框的便捷方法
 * 遵循单一职责原则，专注于模态框的打开逻辑
 *
 * @returns 打开角色编辑模态框的函数
 */
export const useCharacterEditDialog = () => {
  const { open } = useModalStore();

  /**
   * 打开角色编辑模态框
   * @param character 要编辑的角色数据
   * @param title 对话框标题，默认为"编辑角色"
   * @param description 对话框描述，默认为空
   */
  const openCharacterEditDialog = (
    character: Character,
    title = "编辑角色",
    description?: string
  ) => {
    open({
      type: "dialog",
      component: CharacterEditDialog,
      props: {
        character,
        title,
        description,
      },
    });
  };

  return { openCharacterEditDialog };
};
