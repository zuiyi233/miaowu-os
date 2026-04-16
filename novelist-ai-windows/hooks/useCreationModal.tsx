import React from "react";
import { useModalStore } from "../stores/useModalStore";
import { DB_QUERY_KEYS } from "../lib/react-query/db-queries";
import { queryClient } from "../lib/react-query/client";
// 单次单方法迁移：先导入需要的组件
import { ChapterForm } from "../components/ChapterForm";
import { CharacterForm } from "../components/CharacterForm";
import { FactionForm } from "../components/FactionForm";
import { SettingForm } from "../components/SettingForm";
import { VolumeForm } from "../components/VolumeForm";

/**
 * 通用创建模态框 Hook
 * 简化对话框逻辑，消除重复的包装器组件
 * 
 * 设计原则应用：
 * - DRY: 消除了多个 *CreationDialog 组件的重复逻辑
 * - KISS: 简化了模态框的创建和使用
 * - SOLID (SRP): 专注于模态框创建逻辑
 * - SOLID (OCP): 易于扩展，支持任何表单组件
 * 
 * @param FormComponent 表单组件
 * @param title 模态框标题
 * @param description 模态框描述
 * @param queryKeysToInvalidate 成功后需要刷新的 Query Keys
 */
export function useCreationModal(
  FormComponent: React.ComponentType<any>,
  title: string,
  description: string, // 添加 description 参数
  queryKeysToInvalidate: any[] = [DB_QUERY_KEYS.novel]
) {
  const { open } = useModalStore();

  const openModal = (extraProps = {}) => {
    // 直接使用全局 queryClient 实例
    const onSubmitSuccess = () => {
      queryKeysToInvalidate.forEach(key =>
        queryClient.invalidateQueries({ queryKey: key })
      );
    };
    
    open({
      type: "dialog",
      title: title,
      description: description, // 传递 description
      component: FormComponent, // 直接传递表单组件
      props: {
        ...extraProps,
        onSubmitSuccess,
      },
    });
  };

  return openModal;
}

/**
 * 便捷的章节创建模态框 Hook
 * 专门为章节创建优化的 Hook
 * 单次单方法迁移：移除require，使用直接导入的组件
 */
export function useChapterCreationModal() {
  return useCreationModal(
    ChapterForm,
    "创建新章节",
    "为你的故事添加新的篇章。",
    [DB_QUERY_KEYS.chapters, DB_QUERY_KEYS.novel]
  );
}

/**
 * 便捷的角色创建模态框 Hook
 * 专门为角色创建优化的 Hook
 * 单次单方法迁移：移除require，使用直接导入的组件
 */
export function useCharacterCreationModal() {
  return useCreationModal(
    CharacterForm,
    "创建新角色",
    "填写角色的详细信息，为你的世界增添新的生命。",
    [DB_QUERY_KEYS.characters, DB_QUERY_KEYS.novel]
  );
}

/**
 * 便捷的势力创建模态框 Hook
 * 专门为势力创建优化的 Hook
 * 单次单方法迁移：移除require，使用直接导入的组件
 */
export function useFactionCreationModal() {
  return useCreationModal(
    FactionForm,
    "创建新势力",
    "定义世界中的组织、派系或国家。",
    [DB_QUERY_KEYS.factions, DB_QUERY_KEYS.novel]
  );
}

/**
 * 便捷的场景创建模态框 Hook
 * 专门为场景创建优化的 Hook
 * 单次单方法迁移：移除require，使用直接导入的组件
 */
export function useSettingCreationModal() {
  return useCreationModal(
    SettingForm,
    "创建新场景",
    "构建故事发生的地点和环境。",
    [DB_QUERY_KEYS.novel, DB_QUERY_KEYS.settings] // 修正场景查询键
  );
}

/**
 * 便捷的卷创建模态框 Hook
 * 专门为卷创建优化的 Hook
 * 单次单方法迁移：移除require，使用直接导入的组件
 */
export function useVolumeCreationModal() {
  return useCreationModal(
    VolumeForm,
    "创建新卷",
    "将你的故事分门别类，整理成卷。",
    [DB_QUERY_KEYS.volumes, DB_QUERY_KEYS.novel]
  );
}