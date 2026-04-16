import React, { useState } from "react";
import { Button } from "./ui/button";
import { useCharacterDeleteDialog } from "./CharacterDeleteDialog";
import { CharacterEditForm } from "./CharacterEditForm";
import { useQueryClient } from "@tanstack/react-query";
import { DB_QUERY_KEYS } from "../lib/react-query/db-queries";
import { useNovelDataSelector } from "../lib/react-query/db-queries";
import { Edit, Trash2, X } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";
import type { Character } from "../types";
import { BacklinksPanel } from "./common/BacklinksPanel"; // 引入新组件
import { RelationshipManager } from "./sidebar/RelationshipManager"; // 引入关系管理组件
// ❌ 移除 useModalStore 因为不再需要打开新模态框
// import { useModalStore } from "../stores/useModalStore";

/**
 * 角色详情组件的属性接口
 * 遵循单一职责原则，仅负责定义组件的输入参数
 */
interface CharacterDetailProps {
  character: Character;
  onClose: () => void;
}

/**
 * 角色详情组件
 * 提供角色详细信息查看、编辑和删除功能
 * 遵循单一职责原则，专注于角色详情展示和操作
 * 设计为纯内容组件，不包含模态框逻辑
 *
 * @param character 要显示的角色数据
 * @param onClose 关闭回调函数
 * @returns 渲染角色详情组件
 */
export const CharacterDetail: React.FC<CharacterDetailProps> = ({
  character,
  onClose,
}) => {
  // ✅ 引入内部状态来控制查看/编辑模式
  const [isEditing, setIsEditing] = useState(false);
  
  const queryClient = useQueryClient();
  const { openCharacterDeleteDialog } = useCharacterDeleteDialog();
  
  // ✅ 高效获取势力名称
  const { data: factionName } = useNovelDataSelector(
    (novel) => novel?.factions?.find(f => f.id === character.factionId)?.name
  );

  const handleEditSuccess = () => {
    // 编辑成功后，刷新数据并切换回查看模式
    queryClient.invalidateQueries({ queryKey: DB_QUERY_KEYS.novel });
    queryClient.invalidateQueries({ queryKey: DB_QUERY_KEYS.characters });
    setIsEditing(false);
    // 抽屉保持打开，让用户可以看到更新后的内容
  };

  if (isEditing) {
    // ✅ 渲染编辑表单
    return (
      <div className="p-4">
        <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">编辑角色: {character.name}</h3>
            <Button variant="ghost" size="icon" onClick={() => setIsEditing(false)}>
                <X className="w-4 h-4" />
            </Button>
        </div>
        <CharacterEditForm
          character={character}
          onSubmitSuccess={handleEditSuccess}
        />
      </div>
    );
  }
  // ✅ 渲染查看详情
  return (
    <div className="space-y-4 p-4">
      {/* 头部信息 */}
      <div>
        <h3 className="text-2xl font-bold">{character.name}</h3>
        <p className="text-sm text-muted-foreground">
          {character.age || '年龄未知'} · {character.gender || '性别未知'}
          {factionName && ` · 效力于 ${factionName}`}
        </p>
      </div>

      {/* 核心简介 */}
      {character.description ? (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">角色简介</h4>
          <div className="prose dark:prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: character.description }} />
        </div>
      ) : (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">角色简介</h4>
          <p className="text-sm text-muted-foreground italic">暂无简介</p>
        </div>
      )}

      {/* 使用 Accordion 展示详细信息 */}
      <Accordion type="multiple" className="w-full">
        {character.appearance && (
          <AccordionItem value="appearance">
            <AccordionTrigger>外貌描述</AccordionTrigger>
            <AccordionContent>
              <div className="prose dark:prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: character.appearance }} />
            </AccordionContent>
          </AccordionItem>
        )}
        {character.personality && (
          <AccordionItem value="personality">
            <AccordionTrigger>性格特点</AccordionTrigger>
            <AccordionContent>
              <div className="prose dark:prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: character.personality }} />
            </AccordionContent>
          </AccordionItem>
        )}
        {character.motivation && (
          <AccordionItem value="motivation">
            <AccordionTrigger>动机与目标</AccordionTrigger>
            <AccordionContent>
              <div className="prose dark:prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: character.motivation }} />
            </AccordionContent>
          </AccordionItem>
        )}
        {character.backstory && (
          <AccordionItem value="backstory">
            <AccordionTrigger>背景故事</AccordionTrigger>
            <AccordionContent>
              <div className="prose dark:prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: character.backstory }} />
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>

      {/* ✅ 插入反向链接面板 */}
      <BacklinksPanel entityId={character.id} currentType="character" />

      {/* ✅ 新增：插入关系管理面板 */}
      <RelationshipManager entityId={character.id} />

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
          onClick={() => openCharacterDeleteDialog(character)}
        >
          <Trash2 className="w-4 h-4 mr-2" />
          删除
        </Button>
      </div>
    </div>
  );
};
