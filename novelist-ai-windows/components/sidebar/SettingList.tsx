import React from "react";
import { MapPin } from "lucide-react";
import {
  useNovelDataSelector,
  useRefreshSettings,
} from "../../lib/react-query/db-queries";
import { SettingForm } from "../SettingForm";
import { SettingDetail } from "../SettingDetail";
import { GenericEntitySection } from "./GenericEntitySection";
import { useModalStore } from "../../stores/useModalStore";
import { Card } from "../ui/card";
import { Setting } from "../../types";

/**
 * 场景列表组件
 * 重构：使用 GenericEntitySection 统一实现
 *
 * 设计原则应用：
 * - DRY: 消除重复的列表渲染逻辑，使用通用组件
 * - KISS: 简化组件实现，专注于场景特定的业务逻辑
 * - SOLID (SRP): 组件专注于场景数据的展示和管理
 * - SOLID (OCP): 通过泛型支持扩展，无需修改现有代码
 * - SOLID (DIP): 依赖抽象的 renderItem 函数，而非具体实现
 */
export const SettingList: React.FC = () => {
  const { open } = useModalStore();
  const refreshSettings = useRefreshSettings();

  // 获取场景数据，使用精确的类型选择器
  const settings = useNovelDataSelector((novel) => novel?.settings || []);

  // 处理点击查看详情
  const handleViewSetting = (setting: Setting) => {
    open({
      type: "drawer",
      component: SettingDetail,
      props: {
        setting: setting,
      },
    });
  };

  // 定义单个列表项的渲染逻辑
  const renderSettingItem = (setting: Setting) => (
    <Card
      key={setting.id}
      className="p-2 hover:bg-accent/50 transition-colors cursor-pointer"
      onClick={() => handleViewSetting(setting)}
    >
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
          <MapPin className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{setting.name}</div>
          {setting.description && (
            <div className="text-xs text-muted-foreground truncate">
              {setting.description}
            </div>
          )}
        </div>
      </div>
    </Card>
  );

  return (
    <GenericEntitySection<Setting>
      title="场景列表"
      icon={MapPin}
      data={settings.data || []}
      // 配置创建表单
      createFormComponent={SettingForm}
      createModalTitle="创建新场景"
      createModalDescription="构建故事发生的地点和环境。"
      createButtonText="添加场景"
      emptyText="还没有创建场景"
      onRefresh={refreshSettings}
      // 传入渲染函数
      renderItem={renderSettingItem}
    />
  );
};
