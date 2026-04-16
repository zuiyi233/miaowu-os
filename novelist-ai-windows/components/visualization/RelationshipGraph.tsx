import React, { useRef, useCallback, useEffect, useState } from "react";
import { useGraphData } from "@/hooks/useGraphData";
import { useTheme } from "@/hooks/useTheme";
import { useModalStore } from "@/stores/useModalStore";
import { useNovelDataSelector } from "@/lib/react-query/novel.queries";
import { useGraphLayout } from "@/hooks/useGraphLayout";
// 引入所有详情组件
import { CharacterDetail } from "../CharacterDetail";
import { FactionDetail } from "../FactionDetail";
import { SettingDetail } from "../SettingDetail";
import { ItemDetail } from "../ItemDetail";
import { Button } from "@/components/ui/button";
import { Lock, Unlock, RotateCcw, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
// ✅ 引入 UiStore 获取当前章节
import { useUiStore } from "@/stores/useUiStore";
// ✅ 引入提取服务
import { extractRelationships } from "@/services/llmService";
// ✅ 引入添加关系 Mutation
import { useAddRelationshipMutation } from "@/lib/react-query/relationship.queries";

/**
 * 关系可视化组件
 * 遵循单一职责原则，专注于实体关系的可视化展示
 * 使用 Canvas 渲染的高性能图表库，将死板的数据库记录转化为可视化的洞察工具
 */
export const RelationshipGraph: React.FC = () => {
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const { nodes, links } = useGraphData(focusNodeId);
  const { theme } = useTheme();
  const { open } = useModalStore();
  // ✅ 获取完整数据以便查找实体详情
  const novelData = useNovelDataSelector((n) => n);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = React.useState({ w: 800, h: 600 });
  const [ForceGraph2D, setForceGraph2D] = React.useState<any>(null);
  
  // 🎯 图布局持久化功能
  const {
    layout,
    isLoading: layoutLoading,
    isLocked,
    saveNodePosition,
    toggleLock,
    resetLayout,
    getAllNodePositions,
  } = useGraphLayout();
  
  // 🎯 节点拖拽状态
  const [isDragging, setIsDragging] = useState(false);
  
  // 🎯 节点悬停高亮状态
  const [hoverNode, setHoverNode] = useState<any>(null);
  
  // 🎯 AI 提取关系功能状态
  const { activeChapterId } = useUiStore(); // 获取当前章节ID
  const addRelationshipMutation = useAddRelationshipMutation(); // 关系写入 Hook
  const [isExtracting, setIsExtracting] = useState(false); // 提取状态
  
  // 🎯 真正的 AI 关系提取功能实现
  const handleAiExtractRelationships = async () => {
    if (!novelData.data) {
      toast.error("无法获取小说数据");
      return;
    }

    // 1. 获取文本来源：优先使用当前激活的章节，如果没有则提示
    const activeChapter = novelData.data.chapters?.find(c => c.id === activeChapterId);
    const textToAnalyze = activeChapter?.content || "";
    
    // 简单的纯文本提取 (去除 HTML 标签)
    const plainText = textToAnalyze.replace(/<[^>]+>/g, " ").trim();

    if (!plainText || plainText.length < 50) {
      toast.warning("当前章节内容太少，无法进行有效分析", {
        description: "请先在编辑器中选择一个章节并确保有足够的内容。"
      });
      return;
    }

    setIsExtracting(true);
    const toastId = toast.loading("AI 正在研读文本分析关系...", { description: "这可能需要几秒钟" });

    try {
      // 2. 调用 LLM 服务提取关系
      const relationships = await extractRelationships(plainText);

      if (!relationships || relationships.length === 0) {
        toast.info("AI 未在文中发现明显的实体关系", { id: toastId });
        return;
      }

      // 3. 实体名称映射 (Name -> ID)
      // 构建一个查找表：name.toLowerCase() -> id
      const entityMap = new Map<string, string>();
      novelData.data.characters?.forEach(c => entityMap.set(c.name.toLowerCase(), c.id));
      novelData.data.factions?.forEach(f => entityMap.set(f.name.toLowerCase(), f.id));
      novelData.data.settings?.forEach(s => entityMap.set(s.name.toLowerCase(), s.id));
      novelData.data.items?.forEach(i => entityMap.set(i.name.toLowerCase(), i.id));

      let addedCount = 0;

      // 4. 遍历结果并写入数据库
      // 使用 Promise.all 并发处理
      const promises = relationships.map(async (rel: any) => {
        const sourceId = entityMap.get(rel.source?.toLowerCase());
        const targetId = entityMap.get(rel.target?.toLowerCase());

        // 只有当两个实体都在数据库中存在时，才建立关系
        // (为了防止 AI 幻觉创造不存在的实体 ID)
        if (sourceId && targetId && sourceId !== targetId) {
          try {
             await addRelationshipMutation.mutateAsync({
               novelId: novelData.data!.title,
               sourceId,
               targetId,
               type: rel.type || "custom", // 默认类型
               description: rel.description || ""
             });
             addedCount++;
          } catch (e) {
            // 忽略单个失败 (可能是重复关系等)
            console.warn("Failed to add relationship", rel, e);
          }
        }
      });

      await Promise.all(promises);

      if (addedCount > 0) {
        toast.success(`成功提取并添加了 ${addedCount} 条关系`, { id: toastId });
      } else {
        toast.warning("分析完成，但未匹配到现有的实体", {
          id: toastId,
          description: "AI 提取的名称可能与您数据库中的名称不完全一致。"
        });
      }
      
    } catch (error) {
      console.error("AI 提取关系失败:", error);
      toast.error("AI 分析失败", {
        id: toastId,
        description: (error as Error).message
      });
    } finally {
      setIsExtracting(false);
    }
  };

  // ✅ 新增：节点点击处理函数
  const handleNodeClick = useCallback((node: any) => {
    // 单击聚焦，再次单击打开详情 (或者使用双击打开详情)
    if (focusNodeId !== node.id) {
      setFocusNodeId(node.id);
      // 可选：自动缩放视图以适应新节点
    } else {
      if (!novelData.data) return;
      const { data } = novelData;

      let Component: any = null;
      let entityData = null;
      let propsName = "";

      // 根据节点组类型匹配数据和组件
      switch (node.group) {
        case 'character':
          entityData = data.characters?.find(c => c.id === node.id);
          Component = CharacterDetail;
          propsName = 'character';
          break;
        case 'faction':
          entityData = data.factions?.find(f => f.id === node.id);
          Component = FactionDetail;
          propsName = 'faction';
          break;
        case 'setting':
          entityData = data.settings?.find(s => s.id === node.id);
          Component = SettingDetail;
          propsName = 'setting';
          break;
        case 'item':
          entityData = data.items?.find(i => i.id === node.id);
          Component = ItemDetail;
          propsName = 'item';
          break;
      }

      if (Component && entityData) {
        // 使用全局模态框打开详情 Drawer
        open({
          type: "drawer",
          component: Component,
          props: {
            [propsName]: entityData, // 动态属性名
          },
          title: entityData.name // 适配 Accessibility
        });
      }
    }
  }, [novelData, open, focusNodeId]);

  // 动态导入 react-force-graph-2d，防止 SSR 问题
  useEffect(() => {
    import("react-force-graph-2d").then((module) => {
      setForceGraph2D(() => module.default);
    });
  }, []);

  // 响应式调整大小
  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({ 
          w: entry.contentRect.width, 
          h: entry.contentRect.height 
        });
      }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // 🎯 检查两个节点是否相邻（有直接关系）
  const isNeighbor = useCallback((nodeA: any, nodeB: any) => {
    return links.some(link =>
      (link.source === nodeA.id && link.target === nodeB.id) ||
      (link.source === nodeB.id && link.target === nodeA.id)
    );
  }, [links]);

  // 获取节点颜色（支持高亮效果）
  const getNodeColor = useCallback((node: any) => {
    const baseColor = (() => {
      switch(node.group) {
        case 'character': return '#3b82f6'; // Blue
        case 'faction': return '#a855f7';   // Purple
        case 'setting': return '#10b981';   // Green
        case 'item': return '#f97316';      // Orange
        default: return '#9ca3af';
      }
    })();

    // 🎯 如果有悬停节点，非相邻节点变暗
    if (hoverNode && !isNeighbor(node, hoverNode) && node.id !== hoverNode.id) {
      return theme === 'dark' ? '#374151' : '#e5e7eb'; // 暗灰色
    }

    return baseColor;
  }, [hoverNode, isNeighbor, theme]);

  // 获取连线颜色（支持高亮效果）
  const getLinkColor = useCallback((link: any) => {
    const baseColor = (link as any).color || '#cccccc';
    
    // 🎯 如果有悬停节点，只高亮与该节点相关的连线
    if (hoverNode) {
      const isRelated = link.source === hoverNode.id || link.target === hoverNode.id;
      if (!isRelated) {
        return theme === 'dark' ? '#374151' : '#e5e7eb'; // 暗灰色
      }
    }

    return baseColor;
  }, [hoverNode, theme]);

  // 🎯 处理节点拖拽结束事件
  const handleNodeDragEnd = useCallback(async (node: any, translate: { x: number; y: number }) => {
    if (!node || isLocked) return;
    
    setIsDragging(false);
    
    // 保存节点位置
    await saveNodePosition(node.id, {
      x: translate.x,
      y: translate.y,
      fx: isLocked ? translate.x : undefined, // 如果锁定，则固定位置
      fy: isLocked ? translate.y : undefined,
    });
  }, [isLocked, saveNodePosition]);

  // 🎯 准备图数据，应用保存的节点位置
  const graphData = useCallback(() => {
    const savedPositions = getAllNodePositions();
    
    // 应用保存的位置到节点数据
    const nodesWithPositions = nodes.map(node => {
      const savedPosition = savedPositions[node.id];
      if (savedPosition) {
        return {
          ...node,
          fx: isLocked ? savedPosition.fx || savedPosition.x : undefined,
          fy: isLocked ? savedPosition.fy || savedPosition.y : undefined,
          x: savedPosition.x,
          y: savedPosition.y,
        };
      }
      return node;
    });

    return { nodes: nodesWithPositions, links };
  }, [nodes, links, getAllNodePositions, isLocked]);

  // 如果组件还未加载完成，显示加载状态
  if (!ForceGraph2D) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-background">
        <div className="text-muted-foreground">加载关系图中...</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full bg-background relative overflow-hidden">
      {focusNodeId && (
        <Button
          className="absolute top-4 left-1/2 -translate-x-1/2 z-10"
          onClick={() => setFocusNodeId(null)}
          variant="secondary"
        >
          退出聚焦模式
        </Button>
      )}
      {nodes.length === 0 ? (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <div className="text-center max-w-md">
            <div className="text-lg mb-4">暂无足够数据生成关系网</div>
            <div className="text-sm mb-6">请先添加角色、场景、势力或物品</div>
            
            {/* 🎯 智能空状态引导 - AI 提取关系 */}
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                或者让 AI 帮你从当前章节文本中提取实体关系
              </div>
              <Button
                variant="outline"
                onClick={handleAiExtractRelationships}
                disabled={isExtracting}
                className="gap-2"
              >
                {isExtracting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {isExtracting ? "分析中..." : "AI 提取关系"}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <ForceGraph2D
            width={dimensions.w}
            height={dimensions.h}
            graphData={graphData()}
            nodeLabel="name"
            nodeColor={getNodeColor}
            nodeRelSize={6}
            // 边样式（支持高亮效果）
            linkColor={getLinkColor}
            linkDirectionalArrowLength={3.5}
            linkDirectionalArrowRelPos={1}
            linkWidth={(link: any) => (link as any).width || 1}
            linkLineDash={(link: any) => (link as any).dashed ? [4, 2] : null}
            // 画布背景
            backgroundColor={theme === 'dark' ? '#020817' : '#ffffff'} // 匹配 Shadcn background
            // 交互
            cooldownTicks={100}
            // 启用节点拖拽
            enableNodeDrag={!isLocked}
            // 启用缩放
            enableZoomPanInteraction={true}
            // ✅ 节点点击事件
            onNodeClick={handleNodeClick}
            // 🎯 节点拖拽事件
            onNodeDragStart={() => setIsDragging(true)}
            onNodeDragEnd={handleNodeDragEnd}
            // 🎯 节点悬停效果（支持高亮）
            onNodeHover={(node: any) => {
              setHoverNode(node);
              if (containerRef.current) {
                containerRef.current.style.cursor = node ? 'pointer' : 'default';
              }
            }}
            // 边悬停效果
            onLinkHover={(link: any) => {
              if (containerRef.current) {
                containerRef.current.style.cursor = link ? 'pointer' : 'default';
              }
            }}
          />
          
          {/* 🎯 布局控制按钮 */}
          <div className="absolute top-4 left-4 bg-card/90 p-3 rounded-lg border shadow-lg backdrop-blur text-xs space-y-2">
            <div className="font-semibold mb-2">布局控制</div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleLock()}
                disabled={layoutLoading}
                className="h-8 px-2"
              >
                {isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                <span className="ml-1">{isLocked ? '已锁定' : '未锁定'}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={resetLayout}
                disabled={layoutLoading}
                className="h-8 px-2"
              >
                <RotateCcw className="w-3 h-3" />
                <span className="ml-1">重置</span>
              </Button>
            </div>
            {isDragging && (
              <div className="text-muted-foreground text-xs">
                拖拽中...
              </div>
            )}
          </div>

          {/* 图例悬浮窗 */}
          <div className="absolute bottom-4 left-4 bg-card/90 p-3 rounded-lg border shadow-lg backdrop-blur text-xs space-y-2">
            <div className="font-semibold mb-1">图例</div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
              <span>角色</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
              <span>势力</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              <span>场景</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
              <span>物品</span>
            </div>
          </div>

          {/* 统计信息悬浮窗 */}
          <div className="absolute top-4 right-4 bg-card/90 p-3 rounded-lg border shadow-lg backdrop-blur text-xs">
            <div className="font-semibold mb-2">统计</div>
            <div>节点: {nodes.length}</div>
            <div>关系: {links.length}</div>
            {layout && (
              <div className="mt-1 text-muted-foreground">
                已保存位置: {Object.keys(layout.nodePositions).length}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};