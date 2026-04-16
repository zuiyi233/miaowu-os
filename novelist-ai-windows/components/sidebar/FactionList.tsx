import React from "react";
import { Shield } from "lucide-react";
import {
  useNovelDataSelector,
  useRefreshFactions,
} from "../../lib/react-query/db-queries";
import { EntityCard } from "../common/EntityCard";
import { FactionForm } from "../FactionForm";
import { FactionDetail } from "../FactionDetail";
import { GenericEntitySection } from "./GenericEntitySection";
import { useModalStore } from "../../stores/useModalStore";

/**
 * 势力列表组件
 * 重构后使用 GenericEntitySection，大幅减少代码重复
 * 遵循单一职责原则，专注于势力数据的展示和管理
 *
 * 重构收益：
 * - DRY: 代码量减少约60%，消除了重复的列表结构代码
 * - KISS: 组件实现更简洁，只需关注数据和渲染逻辑
 * - SOLID (SRP): 组件专注于势力特定的业务逻辑
 * - SOLID (OCP): 易于扩展，通用组件支持任何实体类型
 */
export const FactionList: React.FC = () => {
  const refreshFactions = useRefreshFactions();
  const { open } = useModalStore();

  // ✅ 只订阅 factions 数据的变化
  // 当其他数据（如章节内容）更新时，此组件不会重新渲染
  const factions = useNovelDataSelector((novel) => novel?.factions || []);
  
  // 获取角色数据用于势力创建时的领导者选择
  const characters = useNovelDataSelector((novel) => novel?.characters || []);

  // 准备创建表单需要的 props
  const formProps = {
    characters: characters.data?.map((c: any) => ({ id: c.id, name: c.name })) || []
  };

  // 触发查看势力详情的抽屉
  const handleViewFaction = (faction: any) => {
    open({
      type: "drawer",
      component: FactionDetail,
      props: {
        faction: faction,
      },
    });
  };

  return (
    <GenericEntitySection
      title="势力列表"
      icon={Shield}
      data={factions.data || []}
      createFormComponent={FactionForm}
      createFormProps={formProps}
      createModalTitle="创建新势力"
      createModalDescription="定义世界中的组织、派系或国家。"
      onRefresh={refreshFactions}
      createButtonText="添加势力"
      emptyText="还没有创建势力"
      renderItem={(faction) => (
        <EntityCard
          icon={Shield}
          name={faction.name}
          description={faction.ideology || faction.description}
          onClick={() => handleViewFaction(faction)}
        />
      )}
    />
  );
};
