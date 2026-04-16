import React from "react";
import { LucideIcon, PlusCircle } from "lucide-react";
import { Button } from "../ui/button";
import { useModalStore } from "../../stores/useModalStore";

/**
 * 通用实体列表组件接口
 * 利用 TypeScript 泛型实现完全的类型安全
 */
interface GenericEntitySectionProps<T extends { id: string }> {
  /** 列表标题 */
  title: string;
  /** 可选图标用于空状态显示 */
  icon?: LucideIcon;
  /** 实体数据列表 */
  data: T[];
  
  // 渲染逻辑
  /** 渲染单个实体的函数 */
  renderItem: (item: T) => React.ReactNode;
  
  // 统一的创建逻辑
  /** 创建表单组件 */
  createFormComponent: React.ComponentType<any>;
  /** 创建表单的额外属性 */
  createFormProps?: Record<string, any>;
  /** 模态框标题 */
  createModalTitle: string; // 新增：模态框标题
  /** 模态框描述 */
  createModalDescription: string; // 新增：模态框描述
  /** 刷新数据的回调函数 */
  onRefresh?: () => void;
  
  // 空状态文案
  /** 空状态显示文本 */
  emptyText?: string;
  /** 创建按钮文本 */
  createButtonText?: string;
}

/**
 * 通用实体列表组件
 * 利用 TypeScript 泛型和 Render Props 模式，实现完全复用
 * 
 * 设计原则应用：
 * - DRY: 消除了 CharacterList、FactionList、SettingList 中的重复代码
 * - KISS: 简化了列表组件的实现，只需关注数据和渲染逻辑
 * - SOLID (OCP): 易于扩展，支持任何类型的实体列表
 * - SOLID (SRP): 专注于列表展示和创建逻辑
 * - SOLID (DIP): 依赖抽象的 renderItem 函数，而非具体实现
 */
export function GenericEntitySection<T extends { id: string }>({
  title,
  icon: Icon,
  data,
  renderItem,
  createFormComponent,
  createFormProps = {},
  createModalTitle,
  createModalDescription,
  onRefresh,
  emptyText = "暂无数据",
  createButtonText = "添加",
}: GenericEntitySectionProps<T>) {
  const { open } = useModalStore();

  const handleCreate = () => {
    open({
      type: "dialog",
      title: createModalTitle,
      description: createModalDescription,
      component: createFormComponent,
      props: {
        ...createFormProps,
        onSubmitSuccess: () => onRefresh?.(),
      },
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between p-2">
        <h4 className="text-sm font-medium">{title}</h4>
        <Button variant="default" size="sm" className="h-7" onClick={handleCreate}>
          <PlusCircle className="h-3 w-3 mr-1" />
          {createButtonText}
        </Button>
      </div>

      {data && data.length > 0 ? (
        // 这里可以根据需要包裹 VirtualizedList 或普通的 div
        <div className="max-h-[300px] overflow-y-auto space-y-2 px-1">
            {data.map(item => <React.Fragment key={item.id}>{renderItem(item)}</React.Fragment>)}
        </div>
      ) : (
        <div className="px-4 py-4 text-center">
          {Icon && <Icon className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />}
          <div className="text-sm text-muted-foreground mb-2">{emptyText}</div>
          <Button variant="outline" size="sm" onClick={handleCreate}>
            <PlusCircle className="h-3 w-3 mr-1" />
            创建第一个
          </Button>
        </div>
      )}
    </div>
  );
}