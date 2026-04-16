import { useMemo } from "react";
import { useNovelDataSelector } from "@/lib/react-query/db-queries";

/**
 * 关系图数据转换适配器
 * 遵循单一职责原则，专注于将数据库数据转换为图表库可用的格式
 * 将 IndexedDB 中的离散数据转换为图表库可用的 nodes 和 links
 */
export const useGraphData = (focusId?: string | null) => {
  // 订阅所有数据
  const novel = useNovelDataSelector(n => n);

  return useMemo(() => {
    if (!novel.data) return { nodes: [], links: [] };
    
    const { characters, factions, settings, items, relationships } = novel.data;
    const allNodes: any[] = [];
    const allLinks: any[] = [];

    // 1. 构建节点 - 遵循单一职责原则，每种实体类型独立处理
    characters?.forEach(c => allNodes.push({
      id: c.id,
      name: c.name,
      group: 'character',
      val: 5,
      description: c.description
    }));
    
    factions?.forEach(f => allNodes.push({
      id: f.id,
      name: f.name,
      group: 'faction',
      val: 8,
      description: f.description
    }));
    
    settings?.forEach(s => allNodes.push({
      id: s.id,
      name: s.name,
      group: 'setting',
      val: 4,
      description: s.description
    }));
    
    items?.forEach(i => allNodes.push({
      id: i.id,
      name: i.name,
      group: 'item',
      val: 3,
      description: i.description
    }));

    // 2. 构建边 - 显式关系
    relationships?.forEach(rel => {
      allLinks.push({
        source: rel.sourceId,
        target: rel.targetId,
        label: rel.type,
        color: '#ef4444', // 红色代表强关系
        width: 2,
        description: rel.description
      });
    });

    // 3. 构建边 - 隐式归属关系 (Foreign Keys)
    // 遵循 DRY 原则，统一处理所有外键关系
    characters?.forEach(c => {
       if(c.factionId) allLinks.push({
         source: c.id,
         target: c.factionId,
         label: 'belongs',
         color: '#94a3b8',
         dashed: true
       });
    });
    
    items?.forEach(i => {
       if(i.ownerId) allLinks.push({
         source: i.id,
         target: i.ownerId,
         label: 'owned by',
         color: '#eab308',
         dashed: true
       });
    });
    
    factions?.forEach(f => {
        if(f.leaderId) allLinks.push({
          source: f.leaderId,
          target: f.id,
          label: 'leads',
          color: '#a855f7'
        });
    });

    let finalNodes = allNodes;
    let finalLinks = allLinks;

    // ✅ 聚焦逻辑
    if (focusId) {
      // 1. 找出与 focusId 直接相连的所有节点 ID
      const neighborIds = new Set<string>();
      neighborIds.add(focusId);
      
      allLinks.forEach(link => {
        if (link.source === focusId) neighborIds.add(link.target as string);
        if (link.target === focusId) neighborIds.add(link.source as string);
      });

      // 2. 过滤节点
      finalNodes = allNodes.filter(n => neighborIds.has(n.id));
      
      // 3. 过滤连线 (只保留两端都在 focus 范围内的连线)
      finalLinks = allLinks.filter(l =>
        neighborIds.has(l.source as string) && neighborIds.has(l.target as string)
      );
    }

    return { nodes: finalNodes, links: finalLinks };
  }, [novel.data, focusId]); // 依赖 focusId
};