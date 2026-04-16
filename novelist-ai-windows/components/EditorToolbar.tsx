import React from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { Toggle } from "./ui/toggle";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Undo,
  Redo,
  Strikethrough,
  Sparkles,
  PenLine,
  Languages,
  Search,
  MessageSquare,
  X,
} from "lucide-react";
import { cn } from "../lib/utils";
import { HistorySheet } from "./HistorySheet";
import { useNovelQuery } from "../lib/react-query/db-queries";
import { useUiStore } from "../stores/useUiStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import {
  usePolishTextMutation,
  useExpandTextMutation,
  useCondenseTextMutation,
  useRewriteTextMutation,
  useContinueWritingMutation,
} from "../lib/react-query/queries";
import { useActivePromptTemplateQuery } from "../lib/react-query/prompt.queries";
import { contextEngineService } from "../services/contextEngineService";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Badge } from "./ui/badge";

interface EditorToolbarProps {
  editor: Editor | null;
  className?: string;
}

interface EntityAnalysisResult {
  characters: string[];
  settings: string[];
  factions: string[];
  items: string[];
}

const AiToolbarButtons: React.FC<{ editor: Editor }> = ({ editor }) => {
  const { t } = useTranslation();
  const language = useSettingsStore((state) => state.language);
  const polishMutation = usePolishTextMutation();
  const expandMutation = useExpandTextMutation();
  const condenseMutation = useCondenseTextMutation();
  const rewriteMutation = useRewriteTextMutation();
  const continueWritingMutation = useContinueWritingMutation();

  const { data: novelData } = useNovelQuery();
  const activeChapterId = useUiStore((state) => state.activeChapterId);
  const activeChapter = novelData?.chapters?.find((ch: any) => ch.id === activeChapterId);
  const { data: continuePromptTemplate } = useActivePromptTemplateQuery("continue");

  const [isAnalysisDialogOpen, setIsAnalysisDialogOpen] = React.useState(false);
  const [analysisResult, setAnalysisResult] = React.useState<EntityAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);

  const getSelectedText = () => {
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to);
  };

  const getTextBeforeCursor = () => {
    const { from } = editor.state.selection;
    const start = Math.max(0, from - 1000);
    return editor.state.doc.textBetween(start, from);
  };

  const isAnyMutationPending =
    polishMutation.isPending ||
    expandMutation.isPending ||
    condenseMutation.isPending ||
    rewriteMutation.isPending ||
    continueWritingMutation.isPending ||
    isAnalyzing;

  const handleReplaceText = async (action: "polish" | "expand" | "condense" | "rewrite") => {
    const selectedText = getSelectedText();
    if (!selectedText) return;

    const { from, to } = editor.state.selection;

    try {
      let result: string | undefined;
      switch (action) {
        case "polish":
          result = await polishMutation.mutateAsync({ text: selectedText });
          break;
        case "expand":
          result = await expandMutation.mutateAsync({ text: selectedText });
          break;
        case "condense":
          result = await condenseMutation.mutateAsync({ text: selectedText });
          break;
        case "rewrite":
          result = await rewriteMutation.mutateAsync({ text: selectedText });
          break;
      }
      if (result) {
        editor.chain().focus().insertContentAt({ from, to }, result).run();
      }
    } catch (error) {
      console.error(`${action} 操作失败:`, error);
    }
  };

  const handleContinueWriting = async () => {
    if (!activeChapter || !activeChapterId) return;

    const selectedText = getSelectedText();
    const textBeforeCursor = getTextBeforeCursor();
    const contextText = selectedText || textBeforeCursor;

    if (!contextText.trim()) return;

    try {
      const fullContent = activeChapter.content || "";
      const textOnly = fullContent.replace(/<[^>]*>/g, "");

      const templateVariables = {
        selection: selectedText || contextText.slice(-500),
        input: "",
        outline: activeChapter.description || "",
        content: textOnly,
      };
      const continuePromptFallback =
        language === "zh-CN"
          ? "继续写作：{{selection}}\n\n上文：{{content}}\n\n细纲：{{outline}}"
          : "Continue writing: {{selection}}\n\nContext: {{content}}\n\nOutline: {{outline}}";

      const hydrated = await contextEngineService.hydratePrompt(
        continuePromptTemplate?.content || continuePromptFallback,
        templateVariables
      );

      await continueWritingMutation.mutateAsync({
        prompt: hydrated,
        chapterId: activeChapterId,
      });

      if (!selectedText) {
        editor.commands.focus("end");
      }
    } catch (error) {
      console.error("续写失败:", error);
    }
  };

  const handleEntityAnalysis = async () => {
    const selectedText = getSelectedText();
    if (!selectedText) return;

    setIsAnalyzing(true);
    try {
      const entities = await contextEngineService.intelligentEntityParsing(selectedText);
      setAnalysisResult(entities);
      setIsAnalysisDialogOpen(true);
    } catch (error) {
      console.error("实体分析失败:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getEntityDetails = (entityName: string, entityType: string) => {
    if (!novelData) return null;
    switch (entityType) {
      case "character":
        return novelData.characters?.find((c: any) => c.name === entityName);
      case "setting":
        return novelData.settings?.find((s: any) => s.name === entityName);
      case "faction":
        return novelData.factions?.find((f: any) => f.name === entityName);
      case "item":
        return novelData.items?.find((i: any) => i.name === entityName);
      default:
        return null;
    }
  };

  const renderEntityList = (entities: string[], entityType: string, icon: string, color: string) => {
    if (entities.length === 0) return null;
    return (
      <div className="space-y-2">
        <h4 className="font-medium flex items-center gap-2">
          <span>{icon}</span>
          <span className="capitalize">
            {entityType === "character" ? t("entity.character") : entityType === "setting" ? t("entity.setting") : entityType === "faction" ? t("entity.faction") : t("entity.item")}
          </span>
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
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{entity.description}</p>
                  )}
                </div>
                <Badge variant="outline" className={color}>
                  {entityType === "character"
                    ? t("entity.character")
                    : entityType === "setting"
                    ? t("entity.setting")
                    : entityType === "faction"
                    ? t("entity.faction")
                    : t("entity.item")}
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
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleContinueWriting}
          disabled={!activeChapterId || isAnyMutationPending}
          className="flex items-center gap-1 h-7 px-2 text-primary text-xs"
        >
          <MessageSquare className="w-3.5 h-3.5" /> {t("editor.continueWriting")}
        </Button>
        {continueWritingMutation.isPending && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => continueWritingMutation.reset()}
            title={t("common.cancel")}
            className="h-7 w-6 p-0"
          >
            <X className="w-3 h-3" />
          </Button>
        )}

        <Separator orientation="vertical" className="h-4 mx-0.5" />

        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleReplaceText("polish")}
          disabled={isAnyMutationPending}
          className="flex items-center gap-1 h-7 px-2 text-xs"
        >
          <Sparkles className="w-3.5 h-3.5" /> {t("editor.polish")}
        </Button>
        {polishMutation.isPending && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => polishMutation.reset()}
            title={t("common.cancel")}
            className="h-7 w-6 p-0"
          >
            <X className="w-3 h-3" />
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleReplaceText("expand")}
          disabled={isAnyMutationPending}
          className="flex items-center gap-1 h-7 px-2 text-xs"
        >
          <PenLine className="w-3.5 h-3.5" /> {t("editor.expand")}
        </Button>
        {expandMutation.isPending && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => expandMutation.reset()}
            title={t("common.cancel")}
            className="h-7 w-6 p-0"
          >
            <X className="w-3 h-3" />
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleReplaceText("condense")}
          disabled={isAnyMutationPending}
          className="flex items-center gap-1 h-7 px-2 text-xs"
        >
          <Languages className="w-3.5 h-3.5" /> {t("editor.condense")}
        </Button>
        {condenseMutation.isPending && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => condenseMutation.reset()}
            title={t("common.cancel")}
            className="h-7 w-6 p-0"
          >
            <X className="w-3 h-3" />
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleReplaceText("rewrite")}
          disabled={isAnyMutationPending}
          className="flex items-center gap-1 h-7 px-2 text-xs"
        >
          <Sparkles className="w-3.5 h-3.5" /> {t("editor.rewrite")}
        </Button>
        {rewriteMutation.isPending && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => rewriteMutation.reset()}
            title={t("common.cancel")}
            className="h-7 w-6 p-0"
          >
            <X className="w-3 h-3" />
          </Button>
        )}

        <Separator orientation="vertical" className="h-4 mx-0.5" />

        <Button
          variant="ghost"
          size="sm"
          onClick={handleEntityAnalysis}
          disabled={isAnyMutationPending}
          className="flex items-center gap-1 h-7 px-2 text-xs"
        >
          <Search className="w-3.5 h-3.5" /> {t("entity.entityAnalysis")}
        </Button>
        {isAnalyzing && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsAnalyzing(false)}
            title={t("common.cancel")}
            className="h-7 w-6 p-0"
          >
            <X className="w-3 h-3" />
          </Button>
        )}
      </div>

      <Dialog open={isAnalysisDialogOpen} onOpenChange={setIsAnalysisDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("editorToolbar.analysis.title")}</DialogTitle>
            <DialogDescription>
              {t("editorToolbar.analysis.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {analysisResult && (
              <>
                {renderEntityList(analysisResult.characters, "character", "👤", "border-blue-200 text-blue-700")}
                {renderEntityList(analysisResult.settings, "setting", "🏛️", "border-green-200 text-green-700")}
                {renderEntityList(analysisResult.factions, "faction", "⚔️", "border-purple-200 text-purple-700")}
                {renderEntityList(analysisResult.items, "item", "🔮", "border-orange-200 text-orange-700")}
              </>
            )}
            {(!analysisResult ||
              (analysisResult.characters.length === 0 &&
                analysisResult.settings.length === 0 &&
                analysisResult.factions.length === 0 &&
                analysisResult.items.length === 0)) && (
              <div className="text-center py-8 text-muted-foreground">
                <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>{t("editorToolbar.analysis.noEntities")}</p>
                <p className="text-sm">
                  {t("editorToolbar.analysis.syntaxHint")}
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

/**
 * 编辑器工具栏组件 (升级版)
 * 功能对齐 MiniEditor，提供完整的富文本操作能力
 */
export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  editor,
  className,
}) => {
  const { t } = useTranslation();
  const { data: novel } = useNovelQuery();
  const { activeChapterId } = useUiStore();
  const activeChapter = novel?.chapters?.find(
    (ch) => ch.id === activeChapterId
  );

  if (!editor) return null;

  return (
    <div
      className={cn(
        "border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 rounded-lg shadow-sm p-1.5 flex gap-1 items-center flex-wrap sticky top-2 z-40 mx-auto max-w-fit",
        className
      )}
    >
      {/* 组 1: 历史操作 */}
      <div className="flex items-center gap-0.5">
        <Toggle
          size="sm"
          pressed={false}
          onPressedChange={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          aria-label={t("editorToolbar.undo")}
          title={t("editorToolbar.undoWithShortcut")}
        >
          <Undo className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={false}
          onPressedChange={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          aria-label={t("editorToolbar.redo")}
          title={t("editorToolbar.redoWithShortcut")}
        >
          <Redo className="h-4 w-4" />
        </Toggle>
      </div>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* 组 2: 基础格式 */}
      <div className="flex items-center gap-0.5">
        <Toggle
          size="sm"
          pressed={editor.isActive("bold")}
          onPressedChange={() => editor.chain().focus().toggleBold().run()}
          aria-label={t("editorToolbar.bold")}
          title={t("editorToolbar.boldWithShortcut")}
        >
          <Bold className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("italic")}
          onPressedChange={() => editor.chain().focus().toggleItalic().run()}
          aria-label={t("editorToolbar.italic")}
          title={t("editorToolbar.italicWithShortcut")}
        >
          <Italic className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("strike")}
          onPressedChange={() => editor.chain().focus().toggleStrike().run()}
          aria-label={t("editorToolbar.strikethrough")}
          title={t("editorToolbar.strikethrough")}
        >
          <Strikethrough className="h-4 w-4" />
        </Toggle>
      </div>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* 组 3: 标题 */}
      <div className="flex items-center gap-0.5">
        <Toggle
          size="sm"
          pressed={editor.isActive("heading", { level: 1 })}
          onPressedChange={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
          aria-label={t("editorToolbar.heading1")}
          title={t("editorToolbar.heading1")}
        >
          <Heading1 className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("heading", { level: 2 })}
          onPressedChange={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
          aria-label={t("editorToolbar.heading2")}
          title={t("editorToolbar.heading2")}
        >
          <Heading2 className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("heading", { level: 3 })}
          onPressedChange={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
          aria-label={t("editorToolbar.heading3")}
          title={t("editorToolbar.heading3")}
        >
          <Heading3 className="h-4 w-4" />
        </Toggle>
      </div>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* 组 4: 列表与引用 */}
      <div className="flex items-center gap-0.5">
        <Toggle
          size="sm"
          pressed={editor.isActive("bulletList")}
          onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
          aria-label={t("editorToolbar.bulletList")}
          title={t("editorToolbar.bulletList")}
        >
          <List className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("orderedList")}
          onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
          aria-label={t("editorToolbar.orderedList")}
          title={t("editorToolbar.orderedList")}
        >
          <ListOrdered className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("blockquote")}
          onPressedChange={() => editor.chain().focus().toggleBlockquote().run()}
          aria-label={t("editorToolbar.blockquote")}
          title={t("editorToolbar.blockquote")}
        >
          <Quote className="h-4 w-4" />
        </Toggle>
      </div>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* 组 5: 历史记录 */}
      {activeChapter && (
        <div className="flex items-center">
          <HistorySheet
            chapterId={activeChapter.id}
            chapterTitle={activeChapter.title}
          />
        </div>
      )}

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* 组 6: AI 工具栏 (常驻) */}
      <AiToolbarButtons editor={editor} />
    </div>
  );
};
