import React, { useState } from "react";
import { Gem, User, Edit, Trash2, X } from "lucide-react";
import { Button } from "./ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { DB_QUERY_KEYS } from "../lib/react-query/db-queries";
import { useNovelDataSelector } from "../lib/react-query/db-queries";
import { ItemEditForm } from "./ItemEditForm";
import { useItemDeleteDialog } from "./ItemDeleteDialog"; // 引入删除 Hook
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";
import type { Item } from "../types";
import { BacklinksPanel } from "./common/BacklinksPanel"; // 引入新组件

interface ItemDetailProps {
  item: Item;
  onClose: () => void;
}

/**
 * 物品详情组件
 * 提供物品详细信息查看、编辑和删除功能
 * 遵循单一职责原则，专注于物品详情展示和操作
 * 设计为纯内容组件，不包含模态框逻辑
 *
 * @param item 要显示的物品数据
 * @param onClose 关闭回调函数
 * @returns 渲染物品详情组件
 */
export const ItemDetail: React.FC<ItemDetailProps> = ({ item, onClose }) => {
  // ✅ 引入内部状态来控制查看/编辑模式
  const [isEditing, setIsEditing] = useState(false);

  const queryClient = useQueryClient();
  const { openItemDeleteDialog } = useItemDeleteDialog(); // ✅ 使用删除 Hook

  // ✅ 高效获取持有者名称
  const { data: ownerName } = useNovelDataSelector(
    (novel) => novel?.characters?.find((c) => c.id === item.ownerId)?.name
  );

  const handleEditSuccess = () => {
    // 编辑成功后，刷新数据并切换回查看模式
    queryClient.invalidateQueries({ queryKey: DB_QUERY_KEYS.novel });
    queryClient.invalidateQueries({ queryKey: DB_QUERY_KEYS.items });
    setIsEditing(false);
    // 抽屉保持打开，让用户可以看到更新后的内容
  };

  if (isEditing) {
    // ✅ 渲染编辑表单
    return (
      <div className="p-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">编辑物品: {item.name}</h3>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsEditing(false)}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
        <ItemEditForm
          item={item}
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
        <h3 className="text-2xl font-bold">{item.name}</h3>
        <p className="text-sm text-muted-foreground">
          {item.type || "其他"}
          {ownerName && ` · 持有者：${ownerName}`}
        </p>
      </div>

      {/* 核心简介 */}
      {item.description ? (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">
            物品简介
          </h4>
          <div
            className="prose dark:prose-invert max-w-none text-sm"
            dangerouslySetInnerHTML={{ __html: item.description }}
          />
        </div>
      ) : (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">
            物品简介
          </h4>
          <p className="text-sm text-muted-foreground italic">暂无简介</p>
        </div>
      )}

      {/* 使用 Accordion 展示详细信息 */}
      <Accordion type="multiple" className="w-full">
        {item.appearance && (
          <AccordionItem value="appearance">
            <AccordionTrigger>外观描述</AccordionTrigger>
            <AccordionContent>
              <div
                className="prose dark:prose-invert max-w-none text-sm"
                dangerouslySetInnerHTML={{ __html: item.appearance }}
              />
            </AccordionContent>
          </AccordionItem>
        )}
        {item.history && (
          <AccordionItem value="history">
            <AccordionTrigger>历史来源</AccordionTrigger>
            <AccordionContent>
              <div
                className="prose dark:prose-invert max-w-none text-sm"
                dangerouslySetInnerHTML={{ __html: item.history }}
              />
            </AccordionContent>
          </AccordionItem>
        )}
        {item.abilities && (
          <AccordionItem value="abilities">
            <AccordionTrigger>功能或能力</AccordionTrigger>
            <AccordionContent>
              <div
                className="prose dark:prose-invert max-w-none text-sm"
                dangerouslySetInnerHTML={{ __html: item.abilities }}
              />
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>

      {/* 空状态提示 */}
      {!item.description &&
        !item.appearance &&
        !item.history &&
        !item.abilities && (
          <div className="text-center py-8">
            <Gem className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">该物品暂无详细信息</p>
          </div>
        )}

      {/* ✅ 插入反向链接面板 */}
      <BacklinksPanel entityId={item.id} currentType="item" />

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
          onClick={() => openItemDeleteDialog(item)} // ✅ 使用删除 Hook
        >
          <Trash2 className="w-4 h-4 mr-2" />
          删除
        </Button>
      </div>
    </div>
  );
};
