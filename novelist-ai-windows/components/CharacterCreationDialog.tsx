import React from "react";
import { useModalStore } from "../stores/useModalStore";
import { CharacterForm } from "./CharacterForm";
import { useRefreshCharacters } from "../lib/react-query/db-queries";

/**
 * 角色创建对话框组件
 * 迁移到全局模态方案，统一模态框管理
 * 遵循 DRY 原则，消除重复的状态管理代码
 *
 * 设计原则应用：
 * - KISS: 简化组件逻辑，只负责触发模态框
 * - DRY: 统一使用全局模态方案，消除重复的Dialog组件
 * - SOLID:
 *   - SRP: 组件专注于触发角色创建模态框
 *   - DIP: 依赖抽象的useModalStore而非具体实现
 *
 * @param trigger 触发对话框的元素
 * @returns 渲染角色创建对话框组件
 */
export const CharacterCreationDialog: React.FC<{
  trigger: React.ReactNode;
}> = ({ trigger }) => {
  const { open } = useModalStore();
  const refreshCharacters = useRefreshCharacters();

  // 触发角色创建模态框
  const handleClick = () => {
    // 修复：传递 title 和原始组件，而不是包装器
    open({
      type: "dialog",
      title: "创建新角色",
      description: "填写角色的详细信息，为你的世界增添新的生命。",
      component: CharacterForm,
      props: {
        onSubmitSuccess: () => {
          refreshCharacters();
        },
      },
    });
  };

  return <div onClick={handleClick}>{trigger}</div>;
};
