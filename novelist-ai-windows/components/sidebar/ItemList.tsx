import React from "react";
import { Gem } from "lucide-react";
import {
  useNovelDataSelector,
  useRefreshItems,
} from "../../lib/react-query/db-queries";
import { ItemForm } from "../ItemForm";
import { ItemDetail } from "../ItemDetail";
import { GenericEntitySection } from "./GenericEntitySection";
import { useModalStore } from "../../stores/useModalStore";
import { Card } from "../ui/card";
import { Item, Character } from "../../types";

/**
 * 物品列表组件
 * 重构：使用 GenericEntitySection 统一实现
 *
 * 设计原则应用：
 * - DRY: 消除重复的列表渲染逻辑，使用通用组件
 * - KISS: 简化组件实现，专注于物品特定的业务逻辑
 * - SOLID (SRP): 组件专注于物品数据的展示和管理
 * - SOLID (OCP): 通过泛型支持扩展，无需修改现有代码
 * - SOLID (DIP): 依赖抽象的 renderItem 函数，而非具体实现
 */
export const ItemList: React.FC = () => {
  const { open } = useModalStore();
  const refreshItems = useRefreshItems();

  // 获取物品数据，使用精确的类型选择器
  const items = useNovelDataSelector((novel) => novel?.items || []);

  // 获取角色数据（用于创建物品时选择持有者）
  const characters = useNovelDataSelector((novel) => novel?.characters || []);

  // 处理点击查看详情
  const handleViewItem = (item: Item) => {
    open({
      type: "drawer",
      component: ItemDetail,
      props: {
        item: item,
      },
    });
  };

  // 定义单个列表项的渲染逻辑
  const renderItem = (item: Item) => (
    <Card
      key={item.id}
      className="p-2 hover:bg-accent/50 transition-colors cursor-pointer"
      onClick={() => handleViewItem(item)}
    >
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
          <Gem className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{item.name}</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {item.type && <span className="opacity-80">[{item.type}]</span>}
            {item.description && (
              <span className="truncate flex-1">{item.description}</span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );

  return (
    <GenericEntitySection<Item>
      title="物品列表"
      icon={Gem}
      data={items.data || []}
      // 这里使用高阶函数注入 characters 数据给 ItemForm
      // 利用 React 组件即函数的特性，将 Hook 中获取到的 characters 数据无缝注入到表单组件中
      createFormComponent={(props: any) => (
        <ItemForm {...props} characters={characters.data || []} />
      )}
      createModalTitle="创建新物品"
      createModalDescription="构建故事中的关键道具、武器或其他物品。"
      createButtonText="添加物品"
      emptyText="还没有创建物品"
      onRefresh={refreshItems}
      renderItem={renderItem}
    />
  );
};
