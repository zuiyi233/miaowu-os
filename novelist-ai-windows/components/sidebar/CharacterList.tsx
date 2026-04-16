import React from "react";
import { Users } from "lucide-react";
import {
  useNovelDataSelector,
  useRefreshCharacters,
} from "../../lib/react-query/db-queries";
import { VirtualizedCharacterList } from "./VirtualizedCharacterList";
import { CharacterForm } from "../CharacterForm";
import { CharacterDetail } from "../CharacterDetail";
import { GenericEntitySection } from "./GenericEntitySection";
import { useModalStore } from "../../stores/useModalStore";
import { Card } from "../ui/card";

/**
 * 角色列表组件
 * 重构后使用 GenericEntitySection，大幅减少代码重复
 * 遵循单一职责原则，专注于角色数据的展示和管理
 *
 * 重构收益：
 * - DRY: 代码量减少约60%，消除了重复的列表结构代码
 * - KISS: 组件实现更简洁，只需关注数据和渲染逻辑
 * - SOLID (SRP): 组件专注于角色特定的业务逻辑
 * - SOLID (OCP): 易于扩展，通用组件支持任何实体类型
 */
export const CharacterList: React.FC = () => {
  const refreshCharacters = useRefreshCharacters();
  const { open } = useModalStore();

  // ✅ 只订阅 characters 数据的变化
  // 当其他数据（如章节内容）更新时，此组件不会重新渲染
  const characters = useNovelDataSelector((novel) => novel?.characters || []);

  // 触发查看角色详情的抽屉
  const handleViewCharacter = (character: any) => {
    open({
      type: "drawer",
      component: CharacterDetail,
      props: {
        character: character,
      },
    });
  };

  // 单个角色项的渲染函数
  const renderCharacterItem = (character: any) => (
    <Card
      key={character.id}
      className="p-2 hover:bg-accent/50 transition-colors cursor-pointer"
      onClick={() => handleViewCharacter(character)}
    >
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
          <Users className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{character.name}</div>
          {character.description && (
            <div className="text-xs text-muted-foreground truncate">
              {character.description}
            </div>
          )}
        </div>
      </div>
    </Card>
  );

  return (
    <GenericEntitySection
      title="角色列表"
      icon={Users}
      data={characters.data || []}
      createFormComponent={CharacterForm}
      createModalTitle="创建新角色"
      createModalDescription="填写角色的详细信息，为你的世界增添新的生命。"
      onRefresh={refreshCharacters}
      createButtonText="添加角色"
      emptyText="还没有创建角色"
      renderItem={renderCharacterItem}
    />
  );
};
