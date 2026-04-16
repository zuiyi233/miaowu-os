import React, { useState } from "react";
import { Shield, User, BookOpen, Edit, Trash2, X } from "lucide-react";
import { Button } from "./ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { DB_QUERY_KEYS } from "../lib/react-query/db-queries";
import { useNovelDataSelector } from "../lib/react-query/db-queries";
import { FactionEditForm } from "./FactionEditForm";
import { useFactionDeleteDialog } from "./FactionDeleteDialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";
import type { Faction } from "../types";
import { BacklinksPanel } from "./common/BacklinksPanel"; // 引入新组件
// ❌ 移除 useModalStore 因为不再需要打开新模态框
// import { useModalStore } from "../stores/useModalStore";

interface FactionDetailProps {
  faction: Faction;
  onClose: () => void;
}

/**
 * 势力详情组件 (重构后)
 * 遵循单一职责原则，专注于势力信息的展示，不再包含容器布局。
 * 样式和行为与 CharacterDetail.tsx 和 SettingDetail.tsx 保持一致。
 */
export const FactionDetail: React.FC<FactionDetailProps> = ({
  faction,
  onClose,
}) => {
  // ✅ 引入内部状态来控制查看/编辑模式
  const [isEditing, setIsEditing] = useState(false);
  
  const queryClient = useQueryClient();
  const { openFactionDeleteDialog } = useFactionDeleteDialog();
  
  // ✅ 高效获取领导者名称
  const { data: leaderName } = useNovelDataSelector(
    (novel) => novel?.characters?.find(c => c.id === faction.leaderId)?.name
  );

  const handleEditSuccess = () => {
    // 编辑成功后，刷新数据并切换回查看模式
    queryClient.invalidateQueries({ queryKey: DB_QUERY_KEYS.novel });
    queryClient.invalidateQueries({ queryKey: DB_QUERY_KEYS.factions });
    setIsEditing(false);
    // 抽屉保持打开，让用户可以看到更新后的内容
  };

  if (isEditing) {
    // ✅ 渲染编辑表单
    return (
      <div className="p-4">
        <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">编辑势力: {faction.name}</h3>
            <Button variant="ghost" size="icon" onClick={() => setIsEditing(false)}>
                <X className="w-4 h-4" />
            </Button>
        </div>
        <FactionEditForm
          faction={faction}
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
        <h3 className="text-2xl font-bold">{faction.name}</h3>
        <p className="text-sm text-muted-foreground">
          {leaderName && `领导者：${leaderName}`}
        </p>
      </div>

      {/* 核心简介 */}
      {faction.description ? (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">势力简介</h4>
          <div className="prose dark:prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: faction.description }} />
        </div>
      ) : (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">势力简介</h4>
          <p className="text-sm text-muted-foreground italic">暂无简介</p>
        </div>
      )}

      {/* 使用 Accordion 展示详细信息 */}
      <Accordion type="multiple" className="w-full">
        {faction.ideology && (
          <AccordionItem value="ideology">
            <AccordionTrigger>势力理念</AccordionTrigger>
            <AccordionContent>
              <div className="prose dark:prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: faction.ideology }} />
            </AccordionContent>
          </AccordionItem>
        )}
        {faction.goals && (
          <AccordionItem value="goals">
            <AccordionTrigger>目标与追求</AccordionTrigger>
            <AccordionContent>
              <div className="prose dark:prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: faction.goals }} />
            </AccordionContent>
          </AccordionItem>
        )}
        {faction.structure && (
          <AccordionItem value="structure">
            <AccordionTrigger>组织结构</AccordionTrigger>
            <AccordionContent>
              <div className="prose dark:prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: faction.structure }} />
            </AccordionContent>
          </AccordionItem>
        )}
        {faction.resources && (
          <AccordionItem value="resources">
            <AccordionTrigger>资源与实力</AccordionTrigger>
            <AccordionContent>
              <div className="prose dark:prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: faction.resources }} />
            </AccordionContent>
          </AccordionItem>
        )}
        {faction.relationships && (
          <AccordionItem value="relationships">
            <AccordionTrigger>对外关系（盟友/敌人）</AccordionTrigger>
            <AccordionContent>
              <div className="prose dark:prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: faction.relationships }} />
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>

      {/* 空状态提示 */}
      {!faction.ideology && !faction.description && !faction.goals && !faction.structure && !faction.resources && !faction.relationships && (
        <div className="text-center py-8">
          <Shield className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">该势力暂无详细信息</p>
        </div>
      )}

      {/* ✅ 插入反向链接面板 */}
      <BacklinksPanel entityId={faction.id} currentType="faction" />

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
          onClick={() => openFactionDeleteDialog(faction)}
        >
          <Trash2 className="w-4 h-4 mr-2" />
          删除
        </Button>
      </div>
    </div>
  );
};
