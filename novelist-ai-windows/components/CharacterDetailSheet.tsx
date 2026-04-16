import React from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";
import { Button } from "./ui/button";
import { useCharacterDeleteDialog } from "./CharacterDeleteDialog";
import { CharacterEditForm } from "./CharacterEditForm";
import { useModalStore } from "../stores/useModalStore";
import { useQueryClient } from "@tanstack/react-query";
import { DB_QUERY_KEYS } from "../lib/react-query/db-queries";
import { Edit, Trash2 } from "lucide-react";
import type { Character } from "../types";

/**
 * 角色详情侧边面板组件的属性接口
 * 遵循单一职责原则，仅负责定义组件的输入参数
 */
interface CharacterDetailSheetProps {
  trigger: React.ReactNode;
  character: Character;
}

/**
 * 角色详情侧边面板组件
 * 提供角色详细信息查看、编辑和删除功能
 * 遵循单一职责原则，专注于角色详情展示和操作
 *
 * @param trigger 触发侧边面板的元素
 * @param character 要显示的角色数据
 * @returns 渲染角色详情侧边面板组件
 */
export const CharacterDetailSheet: React.FC<CharacterDetailSheetProps> = ({
  trigger,
  character,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const { open } = useModalStore();
  const queryClient = useQueryClient();
  const { openCharacterDeleteDialog } = useCharacterDeleteDialog();

  // 处理角色编辑
  const handleEditCharacter = () => {
    open({
      type: "dialog",
      component: () => (
        <div>
          <h2 className="text-lg font-semibold mb-4">编辑角色</h2>
          <CharacterEditForm
            character={character}
            onSubmitSuccess={() => {
              // 刷新角色数据，确保UI显示最新数据
              queryClient.invalidateQueries({ queryKey: DB_QUERY_KEYS.novel });
              queryClient.invalidateQueries({
                queryKey: DB_QUERY_KEYS.characters,
              });
            }}
          />
        </div>
      ),
      props: {},
    });
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle>角色详情</SheetTitle>
          <SheetDescription>查看和管理角色的详细信息</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* 角色基本信息 */}
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold">{character.name}</h3>
            </div>

            {character.description && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">
                  角色简介
                </h4>
                <p className="text-sm leading-relaxed">
                  {character.description}
                </p>
              </div>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-2 pt-4 border-t">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={handleEditCharacter}
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
      </SheetContent>
    </Sheet>
  );
};
