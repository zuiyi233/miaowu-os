import React, { useState, useEffect } from "react";
import { findRelevantCharacters } from "../services/embeddingService";
import {
  contextEngineService,
  type ContextStats,
} from "../services/contextEngineService";
import { useUiStore } from "../stores/useUiStore";
import { useModalStore } from "../stores/useModalStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { ContextInspector } from "./ai/ContextInspector";
import {
  useNovelQuery,
  useNovelDataSelector,
  useReorderChaptersMutation,
} from "../lib/react-query/db-queries";
import { useContinueWritingMutation } from "../lib/react-query/queries";
import {
  useActivePromptTemplateQuery,
  usePromptTemplatesQuery,
} from "../lib/react-query/prompt.queries";
import {
  useChatSessionsQuery,
  useCreateChatSessionMutation,
} from "../lib/react-query/chat.queries";
import { ChatInterface } from "./chat/ChatInterface";
import { MiniOutlineView } from "./outline/MiniOutlineView";
import { ContextRadar } from "./ai/ContextRadar";
import {
  Brain,
  Wand,
  Loader2,
  X,
  Sparkles,
  Settings,
  MessageCircle,
  PenTool,
  Plus,
  History,
  ListTree,
  ExternalLink,
  Radar,
  Database,
  FileText,
} from "lucide-react";
import { SettingsDialog } from "./SettingsDialog";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./ui/resizable";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";

export const AiPanel: React.FC = () => {
  const { activeChapterId, currentNovelTitle } = useUiStore();
  const { open } = useModalStore();

  // ✅ 性能优化：使用 useNovelDataSelector 只订阅 chapters 的变化
  // 当小说其他部分（如角色、设置等）发生变化时，AiPanel 不会重新渲染
  // 1. 获取数据，但允许为空
  const { data: novel } = useNovelQuery();
  const { data: chapters = [] } = useNovelDataSelector(
    (novel) => novel?.chapters || []
  );
  const reorderChaptersMutation = useReorderChaptersMutation();

  // 2. 判断当前是否在全局模式（无小说上下文）
  const isGlobalMode = !novel;

  // ✅ 将 Tabs 变为受控组件
  const [activeTab, setActiveTab] = useState(isGlobalMode ? "chat" : "writing");

  const activeChapter = chapters.find((ch) => ch.id === activeChapterId);
  const [customPrompt, setCustomPrompt] = useState("");

  // ✅ 新增状态
  const [contextStats, setContextStats] = useState<ContextStats | null>(null);
  const [isCalculatingStats, setIsCalculatingStats] = useState(false);

  // 获取上下文窗口设置
  const contextWindowSize = useSettingsStore(
    (state) => state.contextWindowSize
  );

  // 获取所有续写模板和当前激活的模板
  const { data: templates } = usePromptTemplatesQuery("continue");
  const { data: continuePromptTemplate } =
    useActivePromptTemplateQuery("continue");

  // 提示词模板相关状态
  const [previewPrompt, setPreviewPrompt] = useState<string | null>(null);
  const [isPreviewDialogOpen, setIsPreviewDialogOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  // 获取当前选中的模板，优先使用用户选择的，否则使用激活的模板
  const currentTemplate = React.useMemo(() => {
    // 如果用户有选择，使用用户选择的模板
    if (selectedTemplateId) {
      return templates?.find((t) => t.id === selectedTemplateId);
    }
    // 否则使用激活的模板
    return continuePromptTemplate || templates?.find((t) => t.isActive);
  }, [templates, selectedTemplateId, continuePromptTemplate]);

  // 当激活模板变化且用户没有选择时，自动使用激活模板
  React.useEffect(() => {
    if (continuePromptTemplate && !selectedTemplateId) {
      setSelectedTemplateId(continuePromptTemplate.id);
    }
  }, [continuePromptTemplate, selectedTemplateId]);

  // ✅ 新增：聊天会话管理状态
  const [activeSessionId, setActiveSessionId] = useState<string>("new");

  // 获取当前小说的会话列表
  const { data: chatSessions = [] } = useChatSessionsQuery(currentNovelTitle);
  const createSessionMutation = useCreateChatSessionMutation();

  // 计算当前选中的会话对象
  const activeSession = chatSessions.find((s) => s.id === activeSessionId);

  // 处理新建会话
  const handleCreateSession = async () => {
    const newSession = await createSessionMutation.mutateAsync({
      title: "新的一天",
      novelId: currentNovelTitle,
      initialMessage:
        "你好，我是你的专属写作助手。针对当前章节，你有什么想法？",
    });
    setActiveSessionId(newSession.id);
  };

  // 自动选择最近的一个会话（如果没有选中）
  useEffect(() => {
    if (activeSessionId === "new" && chatSessions.length > 0) {
      // 使用 setTimeout 避免同步 setState 警告
      const timer = setTimeout(() => {
        setActiveSessionId(chatSessions[0].id);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [chatSessions.length, activeSessionId, chatSessions]);

  // ✅ 监听相关变化，实时更新上下文统计预览
  // 当 activeChapterId 变化、设置变化或面板打开时触发
  useEffect(() => {
    // 防抖：避免频繁调用
    const timer = setTimeout(async () => {
      if (!activeChapterId || isGlobalMode) return;

      setIsCalculatingStats(true);
      try {
        // 调用 ContextEngine 做一次"预演" (Dry Run)
        // 这里 userInput 传空即可，主要看 Context 组装
        const result = await contextEngineService.analyzeContextWithOptions(
          "",
          { includeWorld: true, includeChapter: true, includeOutline: true }
        );
        setContextStats(result.stats);
      } catch (error) {
        console.error("Failed to calculate context stats", error);
      } finally {
        setIsCalculatingStats(false);
      }
    }, 500); // 500ms 延迟

    return () => clearTimeout(timer);
  }, [activeChapterId, contextWindowSize, activeTab, isGlobalMode]);

  // 使用 React Query Mutation 简化续写逻辑
  const continueWritingMutation = useContinueWritingMutation();

  /**
   * 使用提示词模板进行续写
   */
  const handleContinueWritingWithTemplate = async () => {
    if (!activeChapter || !currentTemplate) return;

    try {
      // 获取编辑器纯文本内容
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = activeChapter.content || "";
      const textContent = tempDiv.textContent || tempDiv.innerText || "";

      // ✅ 更新：在模板变量中包含细纲信息
      const templateVariables = {
        selection: textContent.slice(-1000), // 取后1000字作为上下文
        input: customPrompt,
        outline: activeChapter.description || "", // ✅ 新增：直接从 description 字段获取细纲
        content: textContent, // ✅ 新增：提供完整正文内容
      };

      // 使用提示词模板渲染引擎
      const hydrated = await contextEngineService.hydratePrompt(
        currentTemplate.content,
        templateVariables
      );

      await continueWritingMutation.mutateAsync({
        prompt: hydrated,
        chapterId: activeChapterId,
      });
    } catch (error) {
      console.error("模板续写失败:", error);
    }
  };

  /**
   * 传统续写方法（保持向后兼容）
   */
  const handleContinueWritingLegacy = async () => {
    if (!activeChapter || !novel) return;

    // Tiptap uses HTML, so we need a text-only version for the prompt
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = activeChapter.content || "";
    const textContent = tempDiv.textContent || tempDiv.innerText || "";

    // --- RAG Logic ---
    let context = "";
    const relevantCharacters = await findRelevantCharacters(
      textContent.slice(-500), // 使用文本最后500个字符作为查询
      novel.characters || [],
      0.5, // 相似度阈值
      2 // 返回最相关的2个角色
    );

    if (relevantCharacters.length > 0) {
      context =
        "Relevant Context:\n" +
        relevantCharacters
          .map((c) => `- ${c.name}: ${c.description}`)
          .join("\n") +
        "\n\n";
    }

    const fullPrompt =
      context + `Continue the story from this point:\n\n${textContent}`;
    // --- End RAG Logic ---

    try {
      await continueWritingMutation.mutateAsync({
        prompt: fullPrompt,
        chapterId: activeChapterId,
      });
    } catch (error) {
      // 错误处理已在 React Query 中统一处理
      console.error("续写失败:", error);
    }
  };

  // 智能写作功能，使用 ContextEngine 进行 RAG 增强
  const handleSmartWriting = async () => {
    if (!activeChapter || !novel) return;

    try {
      // 🔥 关键修复：直接调用 analyzeContextWithOptions 并启用前情提要逻辑
      // 获取用户意图
      const userIntent = customPrompt.trim() || "请继续推进剧情。";

      // 🔥 让 ContextEngine 负责所有上下文组装 (包含前情提要、大纲、实体、文风)
      const result = await contextEngineService.analyzeContextWithOptions(
        userIntent,
        {
          includeWorld: true,
          includeChapter: true, // ✅ 必须为 true，才会触发前情提要逻辑
          includeOutline: true, // ✅ 建议为 true，大纲提供长期方向
        }
      );

      // ✅ 更新统计显示（确保显示的是刚刚发送的这份）
      setContextStats(result.stats);

      const fullPrompt = result.prompt;

      await continueWritingMutation.mutateAsync({
        prompt: fullPrompt,
        chapterId: activeChapterId,
      });
    } catch (error) {
      console.error("智能写作失败:", error);
    }
  };

  return (
    <aside className="h-full bg-card flex flex-col border-l">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between bg-muted/30">
        <h2 className="font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          {isGlobalMode ? "Mì Jìng AI" : "写作助手"}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() =>
            open({
              type: "dialog",
              component: SettingsDialog,
              props: {},
              title: "应用设置",
              description: "在这里管理编辑器、AI 和数据相关的应用配置。",
            })
          }
          title="设置"
        >
          <Settings className="w-4 h-4" />
        </Button>
      </div>

      {/* Tabs Layout */}
      {/* ✅ 修复：如果没有小说上下文，默认显示 chat，且禁用 writing Tab */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab} // 当用户点击 Tab 时更新状态
        defaultValue={isGlobalMode ? "chat" : "writing"}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <div className="px-3 pt-2">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger
              value="writing"
              className="text-xs"
              disabled={isGlobalMode}
            >
              <PenTool className="w-3 h-3 mr-1" /> 创作
            </TabsTrigger>
            <TabsTrigger value="outline" className="text-xs">
              <ListTree className="w-3 h-3 mr-1" /> 大纲
            </TabsTrigger>
            <TabsTrigger value="chat" className="text-xs">
              <MessageCircle className="w-3 h-3 mr-1" /> 对话
            </TabsTrigger>
            {/* 新增的雷达 Tab */}
            <TabsTrigger
              value="radar"
              className="text-xs"
              disabled={isGlobalMode}
            >
              <Radar className="w-3 h-3 mr-1" /> 雷达
            </TabsTrigger>
          </TabsList>
        </div>

        {/* 1. 创作模式 (仅在有小说时可用) */}
        <TabsContent
          value="writing"
          className="flex-1 mt-0 data-[state=inactive]:hidden"
        >
          <div className="h-full flex flex-col overflow-hidden border-t border-transparent">
            {isGlobalMode ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-2">
                <p>请先打开一本小说</p>
                <p className="text-xs">创作模式需要小说上下文</p>
              </div>
            ) : (
              // 使用 ResizablePanelGroup 进行垂直布局
              <ResizablePanelGroup
                direction="vertical"
                className="h-full w-full"
              >
                {/* 上半部分：控制区 -> 默认给更多空间 (75%) */}
                <ResizablePanel
                  defaultSize={75}
                  minSize={30}
                  className="flex flex-col"
                >
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    <Card>
                      <CardHeader className="pb-2 pt-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Wand className="w-4 h-4 text-primary" />
                          AI续写
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-3 text-sm">
                        {/* 模板选择下拉框 */}
                        {templates && templates.length > 0 && (
                          <div className="flex items-center gap-2">
                            <Label
                              htmlFor="template-select"
                              className="text-xs"
                            >
                              模式:
                            </Label>
                            <Select
                              value={selectedTemplateId}
                              onValueChange={setSelectedTemplateId}
                            >
                              <SelectTrigger className="h-7 text-xs flex-1">
                                <SelectValue placeholder="选择模式" />
                              </SelectTrigger>
                              <SelectContent>
                                {templates.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>
                                    {t.name} {t.isActive && "(默认)"}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {/* 当前模板信息 */}
                        {currentTemplate && (
                          <div className="text-xs text-muted-foreground">
                            当前使用: {currentTemplate.name}
                            {currentTemplate.description &&
                              ` - ${currentTemplate.description}`}
                          </div>
                        )}

                        {/* 续写按钮组 */}
                        <div className="flex gap-2">
                          <Button
                            onClick={handleContinueWritingWithTemplate}
                            disabled={
                              !activeChapter ||
                              !currentTemplate ||
                              continueWritingMutation.isPending
                            }
                            size="sm"
                            className="flex-1"
                          >
                            {continueWritingMutation.isPending ? (
                              <>
                                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                写作中
                              </>
                            ) : (
                              <>
                                <Wand className="w-3 h-3 mr-2" />
                                智能续写
                              </>
                            )}
                          </Button>

                          {/* 传统续写按钮（作为备选） */}
                          <Button
                            variant="outline"
                            onClick={handleContinueWritingLegacy}
                            disabled={
                              !activeChapter ||
                              continueWritingMutation.isPending
                            }
                            size="sm"
                            title="使用传统续写模式"
                          >
                            传统
                          </Button>

                          {continueWritingMutation.isPending && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => continueWritingMutation.reset()}
                              title="取消写作"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2 pt-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-primary" />
                          智能写作
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-3 text-sm">
                        {/* ✅ 上下文仪表盘：放在输入框上方，显眼且不占太多垂直空间 */}
                        <ContextInspector
                          stats={contextStats}
                          loading={isCalculatingStats}
                        />

                        <div className="grid w-full items-center gap-1.5">
                          <Label htmlFor="custom-prompt" className="text-xs">
                            写作指令
                            <span className="text-xs text-muted-foreground ml-2">
                              支持 @角色 #场景 ~势力~ 语法
                            </span>
                          </Label>
                          <Textarea
                            id="custom-prompt"
                            value={customPrompt}
                            onChange={(e) => setCustomPrompt(e.target.value)}
                            rows={3}
                            placeholder="例如：写一段 @艾拉 在 #黄昏酒馆 遇到 ~铁锤兄弟会~ 的冲突场景"
                            className="bg-background resize-none text-xs"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={handleSmartWriting}
                            disabled={
                              !activeChapter ||
                              !customPrompt.trim() ||
                              continueWritingMutation.isPending
                            }
                            size="sm"
                            className="flex-1"
                          >
                            {continueWritingMutation.isPending ? (
                              <>
                                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                写作中
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3 h-3 mr-2" />
                                智能写作
                              </>
                            )}
                          </Button>
                          {continueWritingMutation.isPending && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => continueWritingMutation.reset()}
                              title="取消写作"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </ResizablePanel>

                {/* 拖拽手柄 */}
                <ResizableHandle withHandle />

                {/* 下半部分：剧情雷达 -> 默认给小一点 (25%)，作为底部仪表盘 */}
                <ResizablePanel
                  defaultSize={25}
                  minSize={15}
                  className="flex flex-col relative"
                >
                  {/* ✅ 添加 "展开" 按钮 */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-1 right-1 z-10 h-6 w-6"
                    title="展开视图"
                    onClick={() => setActiveTab("radar")} // 点击时切换到 'radar' Tab
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>

                  <div className="h-full w-full bg-muted/5 border-t overflow-hidden">
                    <ContextRadar />
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            )}
          </div>
        </TabsContent>

        {/* Tab 2: 自由对话 (升级版) */}
        <TabsContent
          value="chat"
          className="flex-1 mt-0 data-[state=inactive]:hidden"
        >
          <div className="h-full flex flex-col overflow-hidden">
            {/* 会话切换器 */}
            <div className="px-3 py-2 border-b bg-muted/10 flex gap-2">
              <Select
                value={activeSessionId}
                onValueChange={setActiveSessionId}
              >
                <SelectTrigger className="h-8 text-xs flex-1">
                  <SelectValue placeholder="选择历史对话" />
                </SelectTrigger>
                <SelectContent>
                  {chatSessions.map((session) => (
                    <SelectItem
                      key={session.id}
                      value={session.id}
                      className="text-xs"
                    >
                      <span className="font-medium truncate max-w-[120px] inline-block align-bottom">
                        {session.title}
                      </span>
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        {formatDistanceToNow(session.updatedAt, {
                          locale: zhCN,
                          addSuffix: true,
                        })}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={handleCreateSession}
                title="新对话"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            {/* 聊天界面 */}
            <div className="flex-1 min-h-0">
              {activeSession ? (
                <ChatInterface key={activeSession.id} session={activeSession} />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-4 text-center">
                  <History className="w-12 h-12 mb-3 opacity-20" />
                  <p className="text-sm">暂无历史对话</p>
                  <Button
                    variant="link"
                    onClick={handleCreateSession}
                    className="text-xs"
                  >
                    点击开始新的讨论
                  </Button>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* 侧边栏大纲视图 */}
        <TabsContent
          value="outline"
          className="flex-1 mt-0 data-[state=inactive]:hidden"
        >
          <div className="h-full flex flex-col overflow-hidden">
            <MiniOutlineView />
          </div>
        </TabsContent>

        {/* ✅ 新增 Tab 4: 剧情雷达全屏视图 */}
        <TabsContent
          value="radar"
          className="flex-1 mt-0 data-[state=inactive]:hidden"
        >
          <div className="h-full overflow-y-auto p-4">
            {/* 这里是展开后的大视图 */}
            <ContextRadar />
          </div>
        </TabsContent>
      </Tabs>

      {/* 提示词预览对话框 */}
      <Dialog open={isPreviewDialogOpen} onOpenChange={setIsPreviewDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>提示词预览</DialogTitle>
            <DialogDescription>
              这是 AI 实际接收到的完整提示词内容
            </DialogDescription>
          </DialogHeader>
          <div className="bg-muted p-4 rounded-md">
            <pre className="whitespace-pre-wrap font-mono text-xs max-h-[60vh] overflow-y-auto">
              {previewPrompt}
            </pre>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => setIsPreviewDialogOpen(false)}
            >
              关闭
            </Button>
            <Button
              onClick={() => {
                setIsPreviewDialogOpen(false);
                handleContinueWritingWithTemplate();
              }}
            >
              确认并发送
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
};
