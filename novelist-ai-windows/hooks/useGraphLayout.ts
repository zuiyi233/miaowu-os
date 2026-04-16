import { useCallback, useEffect, useState } from "react";
import { useNovelQuery } from "@/lib/react-query/novel.queries";
import { useUiStore } from "@/stores/useUiStore";
import { databaseService } from "@/lib/storage/db";
import type { GraphLayout } from "@/types";

/**
 * 图布局管理 Hook
 * 遵循单一职责原则，专注于关系图布局的持久化管理
 * 提供节点位置的保存、加载和锁定功能
 */
export const useGraphLayout = () => {
  // 获取当前小说信息
  const { data: currentNovel } = useNovelQuery();
  const [layout, setLayout] = useState<GraphLayout | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  // 当前小说ID
  const novelId = currentNovel?.title || "";

  /**
   * 加载图布局
   * 遵循单一职责原则，专注于布局加载逻辑
   */
  const loadLayout = useCallback(async () => {
    if (!novelId) return;

    setIsLoading(true);
    try {
      const savedLayout = await databaseService.getGraphLayout(novelId);
      setLayout(savedLayout);
      setIsLocked(savedLayout?.isLocked || false);
    } catch (error) {
      console.error("Failed to load graph layout:", error);
    } finally {
      setIsLoading(false);
    }
  }, [novelId]);

  /**
   * 保存单个节点位置
   * 遵循单一职责原则，专注于单节点位置保存
   */
  const saveNodePosition = useCallback(
    async (nodeId: string, position: { x: number; y: number; fx?: number; fy?: number }) => {
      if (!novelId || isLocked) return;

      try {
        await databaseService.updateNodePosition(novelId, nodeId, position);
        // 重新加载布局以保持状态同步
        await loadLayout();
      } catch (error) {
        console.error("Failed to save node position:", error);
      }
    },
    [novelId, isLocked, loadLayout]
  );

  /**
   * 批量保存节点位置
   * 遵循单一职责原则，专注于批量节点位置保存
   */
  const saveNodePositions = useCallback(
    async (positions: Record<string, { x: number; y: number; fx?: number; fy?: number }>) => {
      if (!novelId || isLocked) return;

      try {
        await databaseService.updateNodePositions(novelId, positions);
        // 重新加载布局以保持状态同步
        await loadLayout();
      } catch (error) {
        console.error("Failed to save node positions:", error);
      }
    },
    [novelId, isLocked, loadLayout]
  );

  /**
   * 切换布局锁定状态
   * 遵循单一职责原则，专注于锁定状态管理
   */
  const toggleLock = useCallback(
    async (locked?: boolean) => {
      if (!novelId) return;

      const newLockState = locked !== undefined ? locked : !isLocked;
      try {
        await databaseService.toggleLayoutLock(novelId, newLockState);
        setIsLocked(newLockState);
        // 重新加载布局以保持状态同步
        await loadLayout();
      } catch (error) {
        console.error("Failed to toggle layout lock:", error);
      }
    },
    [novelId, isLocked, loadLayout]
  );

  /**
   * 重置布局
   * 遵循单一职责原则，专注于布局重置
   */
  const resetLayout = useCallback(async () => {
    if (!novelId) return;

    try {
      await databaseService.resetGraphLayout(novelId);
      setLayout(null);
      setIsLocked(false);
    } catch (error) {
      console.error("Failed to reset layout:", error);
    }
  }, [novelId]);

  /**
   * 获取节点位置
   * 遵循单一职责原则，专注于节点位置查询
   */
  const getNodePosition = useCallback(
    (nodeId: string) => {
      return layout?.nodePositions[nodeId] || null;
    },
    [layout]
  );

  /**
   * 获取所有节点位置
   * 遵循单一职责原则，专注于所有节点位置查询
   */
  const getAllNodePositions = useCallback(() => {
    return layout?.nodePositions || {};
  }, [layout]);

  // 当小说ID变化时，自动加载布局
  useEffect(() => {
    loadLayout();
  }, [loadLayout]);

  return {
    // 状态
    layout,
    isLoading,
    isLocked,
    novelId,
    
    // 操作方法
    loadLayout,
    saveNodePosition,
    saveNodePositions,
    toggleLock,
    resetLayout,
    getNodePosition,
    getAllNodePositions,
  };
};