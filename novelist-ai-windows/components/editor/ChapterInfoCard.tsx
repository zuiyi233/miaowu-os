import React, { useState } from "react";
import { Chapter } from "../../types";
import { useUpdateChapterMutation } from "../../lib/react-query/chapter.queries";
import { summarizeChapter } from "../../services/llmService"; // ✅ 引入服务
import { cleanNovelContent } from "../../lib/utils/text-analysis";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs"; // ✅ 引入 Tabs
import {
  Target,
  ChevronDown,
  ChevronRight,
  Save,
  Sparkles,
  FileText,
  BookOpen,
} from "lucide-react";
import { toast } from "sonner";

interface ChapterInfoCardProps {
  chapter: Chapter;
}

export const ChapterInfoCard: React.FC<ChapterInfoCardProps> = ({
  chapter,
}) => {
  const [isOpen, setIsOpen] = useState(
    () => !!chapter.description || !!chapter.summary
  );
  // 状态管理
  const [description, setDescription] = useState(chapter.description || "");
  const [summary, setSummary] = useState(chapter.summary || "");
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [activeTab, setActiveTab] = useState("plan"); // plan | fact

  const updateMutation = useUpdateChapterMutation();

  const handleSave = () => {
    updateMutation.mutate({
      chapterId: chapter.id,
      description,
      summary, // ✅ 保存 summary
      createSnapshot: false,
    });
    toast.success("章节信息已保存");
  };

  // ✅ 核心功能：AI 自动总结
  const handleAutoSummarize = async () => {
    if (!chapter.content || chapter.content.length < 100) {
      toast.error("章节内容太少，无法生成总结");
      return;
    }

    setIsGeneratingSummary(true);
    try {
      const plainText = cleanNovelContent(chapter.content);
      const generatedSummary = await summarizeChapter(plainText);

      setSummary(generatedSummary);
      setActiveTab("fact"); // 自动切换到总结 Tab

      // 自动保存
      updateMutation.mutate({
        chapterId: chapter.id,
        summary: generatedSummary,
        createSnapshot: false,
      });

      toast.success("已根据正文生成章节总结");
    } catch (error) {
      toast.error("生成总结失败");
      console.error(error);
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  return (
    <Collapsible
      data-chapter-id={chapter.id}
      open={isOpen}
      onOpenChange={setIsOpen}
      className="w-full max-w-3xl mx-auto mb-6 border rounded-lg bg-card shadow-sm transition-all duration-200"
    >
      <div className="flex items-center justify-between px-4 py-2 bg-muted/20 rounded-t-lg">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="p-0 hover:bg-transparent flex items-center gap-2 text-muted-foreground font-medium"
          >
            {isOpen ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            <Target className="w-4 h-4 text-primary" />
            <span className="text-xs">章节规划与记忆</span>
          </Button>
        </CollapsibleTrigger>

        <div className="flex items-center gap-2">
          {/* 保存按钮 */}
          {(description !== (chapter.description || "") ||
            summary !== (chapter.summary || "")) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleSave}
              className="h-6 text-xs px-2 text-primary hover:bg-primary/10"
              disabled={updateMutation.isPending}
            >
              <Save className="w-3 h-3 mr-1" />
              保存
            </Button>
          )}
        </div>
      </div>

      <CollapsibleContent>
        <div className="p-3">
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2 h-8 mb-3">
              <TabsTrigger value="plan" className="text-xs">
                <Target className="w-3 h-3 mr-1.5" /> 写作目标 (Plan)
              </TabsTrigger>
              <TabsTrigger value="fact" className="text-xs">
                <BookOpen className="w-3 h-3 mr-1.5" /> 剧情事实 (Fact)
              </TabsTrigger>
            </TabsList>

            {/* Tab 1: 写作目标 (细纲) */}
            <TabsContent value="plan" className="mt-0 space-y-2">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="在此输入本章的剧情大纲、核心冲突或爽点安排...（AI 写作前参考）"
                className="min-h-[100px] text-sm resize-y bg-transparent focus-visible:ring-1 p-2 leading-relaxed"
              />
              <p className="text-[10px] text-muted-foreground">
                * AI 在续写时将主要参考此内容。
              </p>
            </TabsContent>

            {/* Tab 2: 剧情事实 (总结) */}
            <TabsContent value="fact" className="mt-0 space-y-2">
              <div className="relative">
                <Textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="本章写完后生成的客观事实摘要...（用于 AI 长期记忆）"
                  className="min-h-[100px] text-sm resize-y bg-transparent focus-visible:ring-1 p-2 leading-relaxed pr-8"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute right-2 bottom-2 h-6 w-6 hover:bg-primary/10 hover:text-primary"
                  title="根据正文自动生成总结"
                  onClick={handleAutoSummarize}
                  disabled={isGeneratingSummary}
                >
                  {isGeneratingSummary ? (
                    <Sparkles className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                </Button>
              </div>
              <div className="flex justify-between items-center">
                <p className="text-[10px] text-muted-foreground">
                  * 当存在此内容时，AI 回顾剧情将优先使用此内容而非"写作目标"。
                </p>
                <Button
                  variant="link"
                  size="sm"
                  className="h-5 text-[10px] px-0"
                  onClick={handleAutoSummarize}
                  disabled={isGeneratingSummary}
                >
                  {isGeneratingSummary ? "正在读取正文..." : "✨ 从正文生成"}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </CollapsibleContent>

      {/* 收起时的预览 */}
      {!isOpen && (
        <div
          className="px-4 py-2 text-xs text-muted-foreground truncate cursor-pointer hover:text-foreground border-t border-transparent"
          onClick={() => setIsOpen(true)}
        >
          {summary || description || "点击展开设置..."}
        </div>
      )}
    </Collapsible>
  );
};
