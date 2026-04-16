import React, { useState } from "react";
import { Button } from "./ui/button";
import { Edit, Trash2, X } from "lucide-react"; // ✅ 引入 X 图标
import { useQueryClient } from "@tanstack/react-query";
import { DB_QUERY_KEYS } from "../lib/react-query/db-queries";
import { SettingEditForm } from "./SettingEditForm";
import { useSettingDeleteDialog } from "./SettingDeleteDialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";
import type { Setting } from "../types";
import { BacklinksPanel } from "./common/BacklinksPanel"; // 引入新组件
// ❌ 移除 useModalStore 因为不再需要打开新模态框
// import { useModalStore } from "../stores/useModalStore";

/**
 * 场景详情组件的属性接口
 * 遵循单一职责原则，仅负责定义组件的输入参数
 */
interface SettingDetailProps {
  setting: Setting;
  onClose: () => void;
}

/**
 * 场景详情组件
 * 提供场景详细信息查看、编辑和删除功能
 * 遵循单一职责原则，专注于场景详情展示和操作
 * 设计为纯内容组件，不包含模态框逻辑
 *
 * @param setting 要显示的场景数据
 * @param onClose 关闭回调函数
 * @returns 渲染场景详情组件
 */
export const SettingDetail: React.FC<SettingDetailProps> = ({
  setting,
  onClose,
}) => {
  // ✅ 引入内部状态来控制查看/编辑模式
  const [isEditing, setIsEditing] = useState(false);
  
  const queryClient = useQueryClient();
  const { openSettingDeleteDialog } = useSettingDeleteDialog();

  const handleEditSuccess = () => {
    // 编辑成功后，刷新数据并切换回查看模式
    queryClient.invalidateQueries({ queryKey: DB_QUERY_KEYS.novel });
    queryClient.invalidateQueries({ queryKey: DB_QUERY_KEYS.settings });
    setIsEditing(false);
    // 抽屉保持打开，让用户可以看到更新后的内容
  };

  if (isEditing) {
    // ✅ 渲染编辑表单
    return (
      <div className="p-4">
        <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">编辑场景: {setting.name}</h3>
            <Button variant="ghost" size="icon" onClick={() => setIsEditing(false)}>
                <X className="w-4 h-4" />
            </Button>
        </div>
        <SettingEditForm
          setting={setting}
          onSubmitSuccess={handleEditSuccess}
          onClose={() => setIsEditing(false)} // 传递取消操作
        />
      </div>
    );
  }
  // ✅ 渲染查看详情
  return (
    <div className="space-y-4 p-4">
      {/* 头部信息 */}
      <div>
        <h3 className="text-2xl font-bold">{setting.name}</h3>
        <p className="text-sm text-muted-foreground">
          {setting.type || '其他'}
        </p>
      </div>

      {/* 核心简介 */}
      {setting.description ? (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">场景描述</h4>
          <div className="prose dark:prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: setting.description }} />
        </div>
      ) : (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">场景描述</h4>
          <p className="text-sm text-muted-foreground italic">暂无描述</p>
        </div>
      )}

      {/* 使用 Accordion 展示详细信息 */}
      <Accordion type="multiple" className="w-full">
        {setting.atmosphere && (
          <AccordionItem value="atmosphere">
            <AccordionTrigger>氛围描述</AccordionTrigger>
            <AccordionContent>
              <div className="prose dark:prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: setting.atmosphere }} />
            </AccordionContent>
          </AccordionItem>
        )}
        {setting.history && (
          <AccordionItem value="history">
            <AccordionTrigger>历史背景</AccordionTrigger>
            <AccordionContent>
              <div className="prose dark:prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: setting.history }} />
            </AccordionContent>
          </AccordionItem>
        )}
        {setting.keyFeatures && (
          <AccordionItem value="keyFeatures">
            <AccordionTrigger>关键特征或地标</AccordionTrigger>
            <AccordionContent>
              <div className="prose dark:prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: setting.keyFeatures }} />
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>

      {/* ✅ 插入反向链接面板 */}
      <BacklinksPanel entityId={setting.id} currentType="setting" />

      {/* 底部操作按钮 */}
      <div className="flex gap-2 pt-4 border-t">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => setIsEditing(true)} // ✅ 点击编辑切换到编辑模式
        >
          <Edit className="w-4 h-4 mr-2" />
          编辑
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => openSettingDeleteDialog(setting)}
        >
          <Trash2 className="w-4 h-4 mr-2" />
          删除
        </Button>
      </div>
    </div>
  );
};
