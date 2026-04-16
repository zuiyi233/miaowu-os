import React, { useState } from "react";
import type { Editor } from "@tiptap/react";
import { Button } from "./ui/button";
import { Sparkles, Languages, PenLine, ChevronDown, X, Search } from "lucide-react";
import {
  usePolishTextMutation,
  useExpandTextMutation,
} from "../lib/react-query/queries";
import { contextEngineService } from "../services/contextEngineService";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Badge } from "./ui/badge";
import { useUiStore } from "../stores/useUiStore";
import { useNovelQuery } from "../lib/react-query/db-queries";

interface AiActionToolbarProps {
  editor: Editor;
}

interface EntityAnalysisResult {
  characters: string[];
  settings: string[];
  factions: string[];
  items: string[];
}

export const AiActionToolbar: React.FC<AiActionToolbarProps> = ({ editor }) => {
  // 使用 React Query Mutation 简化润色功能
  const polishMutation = usePolishTextMutation();

  // 使用 React Query Mutation 简化扩写功能
  const expandMutation = useExpandTextMutation();

  // 实体分析相关状态
  const [isAnalysisDialogOpen, setIsAnalysisDialogOpen] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<EntityAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // 获取当前小说数据
  const { data: novel } = useNovelQuery();

  const handleAiAction = async (action: "polish" | "expand") => {
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to);

    if (!selectedText) return;

    try {
      let result: string | undefined;

      if (action === "polish") {
        result = await polishMutation.mutateAsync({ text: selectedText });
      } else {
        result = await expandMutation.mutateAsync({ text: selectedText });
      }

      if (result) {
        editor.chain().focus().insertContentAt({ from, to }, result).run();
      }
    } catch (error) {
      // 错误处理已在 React Query 中统一处理
      console.error(`${action} 操作失败:`, error);
    }
  };

  /**
   * 处理实体分析功能
   * 遵循单一职责原则，专注于实体分析逻辑
   */
  const handleEntityAnalysis = async () => {
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to);

    if (!selectedText) return;

    setIsAnalyzing(true);
    try {
      // 使用智能实体解析功能
      const entities = await contextEngineService.intelligentEntityParsing(selectedText);
      setAnalysisResult(entities);
      setIsAnalysisDialogOpen(true);
    } catch (error) {
      console.error("实体分析失败:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  /**
   * 获取实体详细信息
   * 遵循单一职责原则，专注于获取实体详情
   */
  const getEntityDetails = (entityName: string, entityType: string) => {
    if (!novel) return null;

    switch (entityType) {
      case 'character':
        return novel.characters?.find(c => c.name === entityName);
      case 'setting':
        return novel.settings?.find(s => s.name === entityName);
      case 'faction':
        return novel.factions?.find(f => f.name === entityName);
      case 'item':
        return novel.items?.find(i => i.name === entityName);
      default:
        return null;
    }
  };

  /**
   * 渲染实体列表
   * 遵循单一职责原则，专注于实体列表渲染
   */
  const renderEntityList = (entities: string[], entityType: string, icon: string, color: string) => {
    if (entities.length === 0) return null;

    return (
      <div className="space-y-2">
        <h4 className="font-medium flex items-center gap-2">
          <span>{icon}</span>
          <span className="capitalize">{entityType === 'character' ? '角色' : entityType === 'setting' ? '场景' : entityType === 'faction' ? '势力' : '物品'}</span>
          <Badge variant="secondary" className="text-xs">
            {entities.length}
          </Badge>
        </h4>
        <div className="space-y-1">
          {entities.map((entityName, index) => {
            const entity = getEntityDetails(entityName, entityType);
            return (
              <div key={`${entityType}-${index}`} className="flex items-center justify-between p-2 bg-muted rounded-md">
                <div>
                  <span className="font-medium">{entityName}</span>
                  {entity?.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {entity.description}
                    </p>
                  )}
                </div>
                <Badge variant="outline" className={color}>
                  {entityType === 'character' ? '角色' : entityType === 'setting' ? '场景' : entityType === 'faction' ? '势力' : '物品'}
                </Badge>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="flex items-center gap-1 p-1 bg-card border rounded-lg shadow-xl">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleAiAction("polish")}
            disabled={polishMutation.isPending || expandMutation.isPending || isAnalyzing}
            className="flex items-center gap-1"
          >
            <Sparkles className="w-4 h-4" /> 润色
          </Button>
          {polishMutation.isPending && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => polishMutation.reset()}
              title="取消润色"
              className="h-7 w-7 p-0"
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleAiAction("expand")}
            disabled={polishMutation.isPending || expandMutation.isPending || isAnalyzing}
            className="flex items-center gap-1"
          >
            <PenLine className="w-4 h-4" /> 扩写
          </Button>
          {expandMutation.isPending && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => expandMutation.reset()}
              title="取消扩写"
              className="h-7 w-7 p-0"
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleEntityAnalysis}
            disabled={polishMutation.isPending || expandMutation.isPending || isAnalyzing}
            className="flex items-center gap-1"
          >
            <Search className="w-4 h-4" /> 分析实体
          </Button>
          {isAnalyzing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsAnalyzing(false)}
              title="取消分析"
              className="h-7 w-7 p-0"
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>

      {/* 实体分析结果对话框 */}
      <Dialog open={isAnalysisDialogOpen} onOpenChange={setIsAnalysisDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>实体关系分析</DialogTitle>
            <DialogDescription>
              这段文字中涉及以下世界观实体和关系
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {analysisResult && (
              <>
                {renderEntityList(analysisResult.characters, 'character', '👤', 'border-blue-200 text-blue-700')}
                {renderEntityList(analysisResult.settings, 'setting', '🏛️', 'border-green-200 text-green-700')}
                {renderEntityList(analysisResult.factions, 'faction', '⚔️', 'border-purple-200 text-purple-700')}
                {renderEntityList(analysisResult.items, 'item', '🔮', 'border-orange-200 text-orange-700')}
              </>
            )}
            {(!analysisResult || (analysisResult.characters.length === 0 &&
              analysisResult.settings.length === 0 &&
              analysisResult.factions.length === 0 &&
              analysisResult.items.length === 0)) && (
              <div className="text-center py-8 text-muted-foreground">
                <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>未检测到任何实体</p>
                <p className="text-sm">尝试使用 @角色名、#场景名、~势力名~ 或 $物品名$ 语法来提及实体</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
