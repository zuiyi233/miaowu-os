import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { databaseService } from '../lib/storage/db';
import type { GraphLayout } from '../types';

// 确保测试环境正确设置
import './setup';

describe('图布局持久化功能测试', () => {
  const testNovelId = 'test-novel-graph-layout';
  
  beforeEach(async () => {
    // 清理测试数据
    await databaseService.resetGraphLayout(testNovelId);
  });

  afterEach(async () => {
    // 清理测试数据
    await databaseService.resetGraphLayout(testNovelId);
  });

  describe('基本布局操作', () => {
    it('应该能够保存和获取图布局', async () => {
      // 🎯 准备测试数据
      const testLayout: GraphLayout = {
        id: testNovelId,
        novelId: testNovelId,
        nodePositions: {
          'node1': { x: 100, y: 200 },
          'node2': { x: 300, y: 400 },
        },
        isLocked: false,
        lastUpdated: new Date(),
      };

      // 🎯 保存布局
      await databaseService.saveGraphLayout(testLayout);

      // 🎯 获取布局
      const retrievedLayout = await databaseService.getGraphLayout(testNovelId);

      // 🎯 验证结果
      expect(retrievedLayout).not.toBeNull();
      expect(retrievedLayout?.novelId).toBe(testNovelId);
      expect(retrievedLayout?.nodePositions).toEqual(testLayout.nodePositions);
      expect(retrievedLayout?.isLocked).toBe(false);
    });

    it('应该能够更新单个节点位置', async () => {
      // 🎯 创建初始布局
      const initialLayout: GraphLayout = {
        id: testNovelId,
        novelId: testNovelId,
        nodePositions: {
          'node1': { x: 100, y: 200 },
        },
        isLocked: false,
        lastUpdated: new Date(),
      };
      await databaseService.saveGraphLayout(initialLayout);

      // 🎯 更新节点位置
      await databaseService.updateNodePosition(testNovelId, 'node1', { x: 150, y: 250 });

      // 🎯 验证更新结果
      const updatedLayout = await databaseService.getGraphLayout(testNovelId);
      expect(updatedLayout?.nodePositions['node1']).toEqual({ x: 150, y: 250 });
    });

    it('应该能够批量更新节点位置', async () => {
      // 🎯 创建初始布局
      const initialLayout: GraphLayout = {
        id: testNovelId,
        novelId: testNovelId,
        nodePositions: {
          'node1': { x: 100, y: 200 },
        },
        isLocked: false,
        lastUpdated: new Date(),
      };
      await databaseService.saveGraphLayout(initialLayout);

      // 🎯 批量更新节点位置
      const positions = {
        'node1': { x: 150, y: 250 },
        'node2': { x: 300, y: 400 },
        'node3': { x: 500, y: 600 },
      };
      await databaseService.updateNodePositions(testNovelId, positions);

      // 🎯 验证更新结果
      const updatedLayout = await databaseService.getGraphLayout(testNovelId);
      expect(updatedLayout?.nodePositions).toEqual(positions);
    });
  });

  describe('布局锁定功能', () => {
    it('应该能够切换布局锁定状态', async () => {
      // 🎯 创建初始布局
      const initialLayout: GraphLayout = {
        id: testNovelId,
        novelId: testNovelId,
        nodePositions: {},
        isLocked: false,
        lastUpdated: new Date(),
      };
      await databaseService.saveGraphLayout(initialLayout);

      // 🎯 锁定布局
      await databaseService.toggleLayoutLock(testNovelId, true);

      // 🎯 验证锁定状态
      const lockedLayout = await databaseService.getGraphLayout(testNovelId);
      expect(lockedLayout?.isLocked).toBe(true);

      // 🎯 解锁布局
      await databaseService.toggleLayoutLock(testNovelId, false);

      // 🎯 验证解锁状态
      const unlockedLayout = await databaseService.getGraphLayout(testNovelId);
      expect(unlockedLayout?.isLocked).toBe(false);
    });

    it('应该能够在没有布局时创建锁定的布局', async () => {
      // 🎯 直接创建锁定的布局
      await databaseService.toggleLayoutLock(testNovelId, true);

      // 🎯 验证布局已创建并锁定
      const layout = await databaseService.getGraphLayout(testNovelId);
      expect(layout).not.toBeNull();
      expect(layout?.isLocked).toBe(true);
      expect(layout?.nodePositions).toEqual({});
    });
  });

  describe('布局重置功能', () => {
    it('应该能够重置图布局', async () => {
      // 🎯 创建布局
      const testLayout: GraphLayout = {
        id: testNovelId,
        novelId: testNovelId,
        nodePositions: {
          'node1': { x: 100, y: 200 },
          'node2': { x: 300, y: 400 },
        },
        isLocked: true,
        lastUpdated: new Date(),
      };
      await databaseService.saveGraphLayout(testLayout);

      // 🎯 验证布局存在
      const layoutBeforeReset = await databaseService.getGraphLayout(testNovelId);
      expect(layoutBeforeReset).not.toBeNull();

      // 🎯 重置布局
      await databaseService.resetGraphLayout(testNovelId);

      // 🎯 验证布局已删除
      const layoutAfterReset = await databaseService.getGraphLayout(testNovelId);
      expect(layoutAfterReset).toBeNull();
    });
  });

  describe('数据导出导入功能', () => {
    it('应该能够在导出数据中包含图布局', async () => {
      // 🎯 创建测试布局
      const testLayout: GraphLayout = {
        id: testNovelId,
        novelId: testNovelId,
        nodePositions: {
          'node1': { x: 100, y: 200, fx: 100, fy: 200 },
          'node2': { x: 300, y: 400 },
        },
        isLocked: true,
        lastUpdated: new Date(),
      };
      await databaseService.saveGraphLayout(testLayout);

      // 🎯 导出数据
      const exportedData = await databaseService.exportAllData();

      // 🎯 验证导出数据包含图布局
      expect(exportedData.graphLayouts).toBeDefined();
      expect(exportedData.graphLayouts.length).toBeGreaterThan(0);
      
      const exportedLayout = exportedData.graphLayouts.find(l => l.novelId === testNovelId);
      expect(exportedLayout).toBeDefined();
      expect(exportedLayout?.nodePositions).toEqual(testLayout.nodePositions);
      expect(exportedLayout?.isLocked).toBe(true);
    });

    it('应该能够导入图布局数据', async () => {
      // 🎯 准备导入数据
      const importData = {
        novels: [],
        promptTemplates: [],
        timelineEvents: [],
        relationships: [],
        items: [],
        graphLayouts: [{
          id: testNovelId,
          novelId: testNovelId,
          nodePositions: {
            'node1': { x: 100, y: 200 },
            'node2': { x: 300, y: 400 },
          },
          isLocked: false,
          lastUpdated: new Date(),
        }],
      };

      // 🎯 导入数据
      await databaseService.importData(importData);

      // 🎯 验证导入结果
      const importedLayout = await databaseService.getGraphLayout(testNovelId);
      expect(importedLayout).not.toBeNull();
      expect(importedLayout?.nodePositions).toEqual(importData.graphLayouts[0].nodePositions);
      expect(importedLayout?.isLocked).toBe(false);
    });
  });

  describe('边界情况处理', () => {
    it('应该在没有布局时返回 null', async () => {
      // 🎯 查询不存在的布局
      const layout = await databaseService.getGraphLayout('non-existent-novel');
      expect(layout).toBeNull();
    });

    it('应该能够处理空节点位置的布局', async () => {
      // 🎯 创建空布局
      const emptyLayout: GraphLayout = {
        id: testNovelId,
        novelId: testNovelId,
        nodePositions: {},
        isLocked: false,
        lastUpdated: new Date(),
      };
      await databaseService.saveGraphLayout(emptyLayout);

      // 🎯 验证空布局
      const layout = await databaseService.getGraphLayout(testNovelId);
      expect(layout).not.toBeNull();
      expect(layout?.nodePositions).toEqual({});
    });

    it('应该能够处理带有固定位置的节点', async () => {
      // 🎯 创建带固定位置的布局
      const layoutWithFixedPositions: GraphLayout = {
        id: testNovelId,
        novelId: testNovelId,
        nodePositions: {
          'node1': { x: 100, y: 200, fx: 100, fy: 200 },
          'node2': { x: 300, y: 400 }, // 没有固定位置
        },
        isLocked: true,
        lastUpdated: new Date(),
      };
      await databaseService.saveGraphLayout(layoutWithFixedPositions);

      // 🎯 验证固定位置
      const layout = await databaseService.getGraphLayout(testNovelId);
      expect(layout?.nodePositions['node1']).toEqual({ x: 100, y: 200, fx: 100, fy: 200 });
      expect(layout?.nodePositions['node2']).toEqual({ x: 300, y: 400 });
    });
  });
});