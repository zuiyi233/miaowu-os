import React, { useState } from "react";
// ✅ 引入刚才创建的 Hooks
import {
  useEntityRelationshipsQuery,
  useAddRelationshipMutation,
  useDeleteRelationshipMutation
} from "@/lib/react-query/relationship.queries";
import { useNovelDataSelector } from "@/lib/react-query/db-queries";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, ArrowRightLeft, ArrowRight, ArrowLeft } from "lucide-react"; // 引入箭头图标
import { useUiStore } from "@/stores/useUiStore";
import { CreateRelationship } from "@/types";

interface Props {
  entityId: string;
}

/**
 * 关系管理器组件
 * 用于管理实体间的关系，支持添加、查看和删除关系
 * 
 * 设计原则应用：
 * - KISS: 简洁直观的关系管理界面
 * - DRY: 复用现有的UI组件和查询模式
 * - SOLID:
 *   - SRP: 专注于关系管理功能
 *   - OCP: 易于扩展新的关系类型
 *   - DIP: 依赖抽象的数据库服务接口
 */
export const RelationshipManager: React.FC<Props> = ({ entityId }) => {
  const currentNovelTitle = useUiStore(s => s.currentNovelTitle);
  
  // ✅ 使用封装好的 Hooks
  const { data: relationships = [], isLoading } = useEntityRelationshipsQuery(entityId);
  const addMutation = useAddRelationshipMutation();
  const deleteMutation = useDeleteRelationshipMutation();

  // 获取所有可能的关联对象（排除自己）
  const novelData = useNovelDataSelector(n => n);
  const allEntities = [
    ...(novelData.data?.characters || []).map(c => ({ id: c.id, name: c.name, type: '角色' })),
    ...(novelData.data?.factions || []).map(f => ({ id: f.id, name: f.name, type: '势力' })),
    ...(novelData.data?.settings || []).map(s => ({ id: s.id, name: s.name, type: '场景' })), // 👈 新增这行
    ...(novelData.data?.items || []).map(i => ({ id: i.id, name: i.name, type: '物品' })),
  ].filter(e => e.id !== entityId);

  // 表单状态
  const [targetId, setTargetId] = useState("");
  const [type, setType] = useState("friend");
  const [desc, setDesc] = useState("");

  const handleAdd = () => {
    if (!targetId) return;
    addMutation.mutate({
      novelId: currentNovelTitle,
      sourceId: entityId,
      targetId,
      type: type as any,
      description: desc
    }, {
        onSuccess: () => {
            setDesc("");
            setTargetId("");
        }
    });
  };

  const getName = (id: string) => allEntities.find(e => e.id === id)?.name || "未知实体";

  // 完善颜色映射，覆盖 Zod Schema 中的所有枚举
  const typeColors: Record<string, string> = {
      friend: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300",
      enemy: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300",
      family: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400",
      lover: "bg-pink-100 text-pink-800 border-pink-200 dark:bg-pink-900/30 dark:text-pink-300",
      romance: "bg-pink-100 text-pink-800 border-pink-200 dark:bg-pink-900/30 dark:text-pink-300", // 兼容
      hierarchical: "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300",
      social: "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300",
      custom: "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-400"
  };

  return (
    <div className="space-y-4 mt-6 pt-4 border-t">
      <h4 className="text-sm font-semibold flex items-center gap-2">
         <ArrowRightLeft className="w-4 h-4" /> 显式关系网
      </h4>

      {/* 添加表单 */}
      <div className="flex flex-col gap-2 p-3 bg-muted/50 rounded-lg border border-dashed">
         <div className="flex gap-2">
            <Select value={type} onValueChange={setType}>
                <SelectTrigger className="w-[110px]">
                   <SelectValue />
                </SelectTrigger>
                <SelectContent>
                   <SelectItem value="friend">好友</SelectItem>
                   <SelectItem value="enemy">敌对</SelectItem>
                   <SelectItem value="family">亲属</SelectItem>
                   <SelectItem value="lover">恋人</SelectItem>
                   <SelectItem value="custom">其他</SelectItem>
                </SelectContent>
            </Select>
            <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger className="flex-1">
                   <SelectValue placeholder="选择对象..." />
                </SelectTrigger>
                <SelectContent>
                   {allEntities.map(e => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name} <span className="text-xs opacity-50">({e.type})</span>
                      </SelectItem>
                   ))}
                </SelectContent>
            </Select>
         </div>
         <div className="flex gap-2">
            <Input
               placeholder="具体描述 (例: 杀父之仇)"
               value={desc}
               onChange={e => setDesc(e.target.value)}
               className="text-xs"
            />
            <Button size="sm" onClick={handleAdd} disabled={!targetId || addMutation.isPending}>
               <Plus className="w-4 h-4" />
            </Button>
         </div>
      </div>

      {/* 列表展示 */}
      <div className="space-y-2">
         {relationships.length === 0 && !isLoading && (
             <p className="text-xs text-center text-muted-foreground py-2">暂无明确定义的关系</p>
         )}
         
         {relationships.map(rel => {
            const isSource = rel.sourceId === entityId;
            const otherId = isSource ? rel.targetId : rel.sourceId;
            
            return (
            <div key={rel.id} className="flex items-center justify-between text-sm p-2 border rounded-md bg-card hover:bg-accent/5 transition-colors group">
               <div className="flex items-center gap-2 overflow-hidden flex-1">
                  <Badge variant="outline" className={`shrink-0 ${typeColors[rel.type] || typeColors.custom}`}>
                      {rel.type}
                  </Badge>
                  
                  <div className="flex items-center gap-1 text-muted-foreground text-xs shrink-0">
                    {isSource ? <ArrowRight className="w-3 h-3" /> : <ArrowLeft className="w-3 h-3" />}
                  </div>
                  
                  <span className="font-bold truncate">{getName(otherId)}</span>
                  
                  {rel.description && (
                      <span className="text-xs text-muted-foreground truncate ml-1 border-l pl-2">
                          {rel.description}
                      </span>
                  )}
               </div>
               <Button
                 variant="ghost"
                 size="icon"
                 className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                 onClick={() => deleteMutation.mutate(rel.id)}
               >
                  <Trash2 className="w-3 h-3 text-muted-foreground hover:text-destructive" />
               </Button>
            </div>
         )})}
      </div>
    </div>
  );
};