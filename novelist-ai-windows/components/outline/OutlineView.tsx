import React, { useState, useRef } from "react"; // 引入 useRef
import { useOutlineStore } from "../../stores/useOutlineStore";
import { useUiStore } from "../../stores/useUiStore";
import { useStyleStore } from "../../stores/useStyleStore";
import { databaseService } from "../../lib/storage/db";
import { queryClient } from "../../lib/react-query/client"; // ✅ 引入 queryClient
import {
  useRefreshCharacters,
  useRefreshFactions,
  useRefreshSettings,
  useRefreshItems,
  useNovelQuery,
} from "../../lib/react-query/db-queries";
import {
  generateVolumes,
  generateChaptersForVolume,
  convertVolumesToOutlineNodes,
  convertChaptersToOutlineNodes,
  convertNovelToOutlineTree,
  calibrateVolumeInfo, // ✅ 新增：导入校准功能
  type WorldContextData, // ✅ 引入类型
} from "../../services/outlineService";
import { extractionService } from "../../services/extractionService";
import { cleanNovelContent } from "../../lib/utils/text-analysis";
import {
  NOVEL_GENRES,
  NOVEL_TAGS,
  WORD_COUNTS,
  NovelOption,
} from "../../src/lib/constants/novel-options";
import type {
  OutlineNode,
  Character,
  Faction,
  Setting,
  Chapter,
} from "../../types";
import { Button } from "../ui/button";
import { toast } from "sonner";
import {
  ListTree,
  RefreshCw,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  StopCircle, // 引入停止图标
} from "lucide-react";
import { DragEndEvent } from "@dnd-kit/core";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { OutlineConfigPanel } from "./OutlineConfigPanel";
import { OutlineListPanel } from "./OutlineListPanel";

export const OutlineView: React.FC = () => {
  const {
    tree,
    isGenerating,
    setTree,
    updateNode,
    updateNodeStatus,
    selectAll,
    deselectAll,
    setIsGenerating,
    clearTree,
    moveNode,
    updateNodeIds, // 🆕 新增：ID 映射更新方法
  } = useOutlineStore();

  const { currentNovelTitle } = useUiStore();
  const { data: currentNovel, refetch: refetchNovel } = useNovelQuery();

  // ✅ 1. 引入 AbortController
  const abortControllerRef = useRef<AbortController | null>(null);

  // 本地状态
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [generationLog, setGenerationLog] = useState("");
  const [progressMessage, setProgressMessage] = useState(""); // ✅ 新增：详细进度消息

  // 灵感配置状态
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedWordCount, setSelectedWordCount] = useState<string>("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customPrompt, setCustomPrompt] = useState("");

  // 提取状态
  const [isExtracting, setIsExtracting] = useState(false);
  const [generationMode, setGenerationMode] = useState<"volumes" | "chapters">(
    "volumes"
  );

  // 侧边栏折叠状态
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // 刷新 Hooks
  const refreshChars = useRefreshCharacters();
  const refreshFactions = useRefreshFactions();
  const refreshSettings = useRefreshSettings();
  const refreshItems = useRefreshItems();

  // ✅ 2. 计算预估时间的辅助函数
  const getEstimatedTime = (wordCountId: string) => {
    // 假设每批次 (10章) 耗时约 15-20秒
    switch (wordCountId) {
      case "short":
        return "约 40 秒"; // 2批
      case "medium":
        return "约 3 分钟"; // 8批
      case "long":
        return "约 4 分钟"; // 10批
      case "epic":
        return "约 5 分钟"; // 12批
      default:
        return "计算中...";
    }
  };

  // ✅ 3. 停止生成处理函数
  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      // isGenerating 会在 service 返回后自动设为 false
    }
  };

  // ✅ 1. 辅助函数：从节点中提取"最真实"的剧情信息
  // 优先级：Chapter.summary (事实) > Chapter.content (事实摘要) > Node.desc (计划)
  const getTrueStoryContext = (node: any, novelChapters: Chapter[]) => {
    // 尝试在完整章节数据中找到对应的章节
    const realChapter = novelChapters.find((c) => c.id === node.id);

    if (realChapter) {
      // 1. 优先使用已生成的"章节总结" (Fact)
      if (realChapter.summary && realChapter.summary.length > 10) {
        return `[已完结] ${realChapter.summary}`;
      }
      // 2. 其次使用正文的前后摘要 (Fact - Raw)
      if (realChapter.content && realChapter.content.length > 100) {
        const plain = cleanNovelContent(realChapter.content);
        return `[已写正文梗概] ${plain.slice(0, 200)}...${plain.slice(-200)}`;
      }
    }

    // 3. 最后才使用大纲计划 (Plan)
    return `[计划] ${node.desc}`;
  };

  // ✅ 2. 升级版：动态历史构建器
  const buildDynamicContext = (
    currentVolId: string,
    tree: any[],
    novelChapters: Chapter[]
  ) => {
    const currentVolIndex = tree.findIndex((n) => n.id === currentVolId);
    if (currentVolIndex <= 0) return "";

    let contextStr = "【动态剧情回溯 (基于实际写作进度)】：\n";

    // 遍历之前的每一卷
    for (let i = 0; i < currentVolIndex; i++) {
      const vol = tree[i];
      const isImmediatePrevious = i === currentVolIndex - 1; // 是否是紧邻的上一卷

      // 卷标题
      contextStr += `\n=== 卷${i + 1}：${vol.title} ===\n`;

      // 如果是远古卷，只看大纲即可（节省 Token）
      if (!isImmediatePrevious) {
        contextStr += `卷综述：${vol.desc}\n`;
        continue;
      }

      // 🔥 重点：对于紧邻的【上一卷】，我们要逐章检查"事实"
      // 如果上一卷已经写完了，我们要把它的"真实结局"提取出来，而不是看"原定计划"
      if (vol.children && vol.children.length > 0) {
        const lastChapters = vol.children.slice(-15); // 关注最后15章的走向
        contextStr += `\n[上卷结局脉络]：\n`;

        lastChapters.forEach((chNode: any) => {
          const trueStory = getTrueStoryContext(chNode, novelChapters);
          contextStr += `- ${chNode.title}: ${trueStory}\n`;
        });
      }
    }

    return contextStr;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      moveNode(active.id as string, over.id as string);
    }
  };

  const handleSyncFromDirectory = () => {
    if (!currentNovel) {
      toast.error("未找到当前小说数据");
      return;
    }

    if (tree.length > 0) {
      if (!confirm("这将覆盖当前大纲视图中的未保存内容，确认同步吗？")) return;
    }

    try {
      const newTree = convertNovelToOutlineTree(currentNovel);
      setTree(newTree);
      toast.success("已从目录同步最新结构");
    } catch (e) {
      console.error(e);
      toast.error("同步失败");
    }
  };

  const toggleNodeExpansion = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  };

  const applyOutline = async () => {
    if (!currentNovelTitle) {
      toast.error("没有选中的小说");
      return;
    }

    const selectedVolumes = tree.filter((vol) => vol.isSelected);
    const selectedChapters = tree.reduce((acc, vol) => {
      if (vol.isSelected && vol.children) {
        return acc + vol.children.filter((ch) => ch.isSelected).length;
      }
      return acc;
    }, 0);

    if (selectedVolumes.length === 0) {
      toast.error("请至少选择一个卷");
      return;
    }

    if (
      !window.confirm(
        `即将创建 ${selectedVolumes.length} 个卷，${selectedChapters} 个章节。是否确认？`
      )
    ) {
      return;
    }

    try {
      setIsGenerating(true);

      // 🚀 使用新的智能同步引擎，获取 ID 映射关系
      const { volumeIdMap, chapterIdMap } =
        await databaseService.applyOutlineToNovel(currentNovelTitle, tree);

      // 🔄 状态回填：使用 Store 的专用方法进行 ID 映射
      const combinedIdMap = { ...volumeIdMap, ...chapterIdMap };
      updateNodeIds(combinedIdMap);

      // ✅ 新增：保存风格元数据 (Style Persistence)
      // 引入 StyleStore 获取当前激活的 styleId
      const activeStyleId = useStyleStore.getState().activeStyleId;

      await databaseService.updateNovel(currentNovelTitle, {
        metadata: {
          styleId: activeStyleId,
          genreIds: selectedGenres,
          tagIds: selectedTags,
          wordCountId: selectedWordCount,
          customPrompt: customPrompt,
        },
      });

      // 🔄 重新获取最新数据确保一致性
      const { data: updatedNovel } = await refetchNovel();

      if (updatedNovel) {
        // 用数据库的最新数据完全替换前端状态，确保绝对一致性
        const syncedTree = convertNovelToOutlineTree(updatedNovel);
        setTree(syncedTree);
      }

      const mappedVolumes = Object.keys(volumeIdMap).length;
      const mappedChapters = Object.keys(chapterIdMap).length;

      toast.success(`成功应用大纲并同步状态`, {
        description:
          mappedVolumes > 0 || mappedChapters > 0
            ? `新创建：${mappedVolumes} 卷，${mappedChapters} 章`
            : "所有节点已更新",
      });
    } catch (error) {
      console.error("应用大纲失败:", error);
      toast.error("应用大纲失败，请重试");
    } finally {
      setIsGenerating(false);
    }
  };

  const buildFinalPrompt = () => {
    const genres = NOVEL_GENRES.filter((g) => selectedGenres.includes(g.id));
    const count = WORD_COUNTS.find(
      (w: NovelOption) => w.id === selectedWordCount
    );
    const tags = NOVEL_TAGS.filter((t: NovelOption) =>
      selectedTags.includes(t.id)
    );

    let constructedPrompt = "";

    // 1. 核心文风 (Style) - 基调与人设
    // ✅ 新增：与写作阶段完全一致的文风构建逻辑
    const activeStyleId = useStyleStore.getState().activeStyleId;
    const allStyles = useStyleStore.getState().styles;
    const activeStyle =
      allStyles.find((s) => s.id === activeStyleId) || allStyles[0];

    if (activeStyle) {
      constructedPrompt += `【核心文风协议 (System)】：${activeStyle.systemPrompt}\n`;
    }

    if (genres.length > 0) {
      const genreLabels = genres.map((g) => g.label).join(" + ");
      const genreContexts = genres.map((g) => g.promptContext).join("\n");
      constructedPrompt += `【核心类型（世界观/舞台）】：${genreLabels}\n${genreContexts}\n`;
    }

    if (count) constructedPrompt += `【预估字数】：${count.promptContext}\n`;

    if (tags.length > 0)
      constructedPrompt += `【核心元素（金手指/剧情/人设）】：${tags
        .map((t) => `${t.label}: ${t.promptContext}`)
        .join("\n")}\n`;

    if (customPrompt) constructedPrompt += `【额外要求】：${customPrompt}`;

    if (genres.length === 0 && !count && tags.length === 0 && customPrompt) {
      return customPrompt;
    }

    if (!constructedPrompt) {
      return "请自由发挥，写一个精彩的网文大纲。";
    }

    return constructedPrompt;
  };

  const generateOutline = async () => {
    if (!currentNovelTitle) {
      toast.error("没有选中的小说");
      return;
    }

    const finalPrompt = buildFinalPrompt();

    // 📸 第四步核心：获取数据快照 (Snapshot)
    // 直接从 React Query 缓存中读取当前数据，确保"所见即所得"
    // 修复：使用与 useNovelQuery 相同的 Query Key 格式
    const novelData = queryClient.getQueryData([
      "novel",
      currentNovelTitle,
    ]) as any;
    const charactersSnapshot = novelData?.characters || [];
    const factionsSnapshot = novelData?.factions || [];
    const settingsSnapshot = novelData?.settings || [];

    // 简单的数据清洗，只保留 AI 需要的字段，减少 Token 消耗
    const cleanContextData: WorldContextData = {
      characters: charactersSnapshot.map((c: Character) => ({
        id: c.id,
        name: c.name,
        age: c.age,
        gender: c.gender,
        description: c.description || c.backstory || "",
      })),
      factions: factionsSnapshot.map((f: Faction) => ({
        id: f.id,
        name: f.name,
        description: f.description || f.ideology || "",
      })),
      settings: settingsSnapshot.map((s: Setting) => ({
        id: s.id,
        name: s.name,
        description: s.description || s.history || "",
        type: s.type || "其他",
      })),
    };

    try {
      setIsGenerating(true);
      setGenerationMode("volumes");
      setGenerationLog("");

      const volumesData = await generateVolumes(
        currentNovelTitle,
        finalPrompt,
        selectedGenres, // ✅ 传递选中的题材
        selectedTags, // ✅ 传递选中的标签
        cleanContextData, // 👈 传递快照数据
        (msg) => setGenerationLog(msg)
      );

      if (volumesData && Array.isArray(volumesData)) {
        const outlineNodes = convertVolumesToOutlineNodes(volumesData);
        setTree(outlineNodes);
        toast.success(`成功生成 ${volumesData.length} 个卷`);
      } else {
        throw new Error("AI 生成的内容格式不正确");
      }
    } catch (error) {
      console.error("生成大纲失败:", error);
      toast.error("生成大纲失败，请重试");
    } finally {
      setIsGenerating(false);
    }
  };

  // ✅ 4. 修改 handleGenerateChapters
  const handleGenerateChapters = async (volumeNode: any) => {
    if (!currentNovelTitle || !currentNovel) return;

    try {
      // 初始化 AbortController
      abortControllerRef.current = new AbortController();

      updateNodeStatus(volumeNode.id, "generating");
      setGenerationMode("chapters");
      setIsGenerating(true);
      setProgressMessage("正在初始化生成任务...");

      // ✅ 使用动态上下文构建
      // 传入 currentNovel.chapters 以便查找 summary/content
      const dynamicContext = buildDynamicContext(
        volumeNode.id,
        tree,
        currentNovel.chapters || []
      );

      // 获取数据快照 (代码保持不变)
      const novelData = queryClient.getQueryData([
        "novel",
        currentNovelTitle,
      ]) as any;
      const charactersSnapshot = novelData?.characters || [];
      const factionsSnapshot = novelData?.factions || [];
      const settingsSnapshot = novelData?.settings || [];

      const cleanContextData: WorldContextData = {
        characters: charactersSnapshot.map((c: Character) => ({
          id: c.id,
          name: c.name,
          age: c.age,
          gender: c.gender,
          description: c.description || c.backstory || "",
        })),
        factions: factionsSnapshot.map((f: Faction) => ({
          id: f.id,
          name: f.name,
          description: f.description || f.ideology || "",
        })),
        settings: settingsSnapshot.map((s: Setting) => ({
          id: s.id,
          name: s.name,
          description: s.description || s.history || "",
          type: s.type || "其他",
        })),
      };

      // 调用生成服务
      const chaptersData = await generateChaptersForVolume(
        currentNovelTitle,
        volumeNode.title,
        volumeNode.desc,
        dynamicContext, // ✅ 使用动态上下文
        cleanContextData,
        selectedWordCount, // ✅ 传递篇幅ID
        (msg) => {
          setGenerationLog(msg);
          setProgressMessage(msg);
        },
        abortControllerRef.current.signal // ✅ 传递 signal
      );

      if (chaptersData && Array.isArray(chaptersData)) {
        const newChapters = convertChaptersToOutlineNodes(
          chaptersData,
          volumeNode.id
        );
        updateNode(volumeNode.id, {
          children: [...(volumeNode.children || []), ...newChapters],
          status: "idle",
        });

        if (!expandedNodes.has(volumeNode.id)) {
          toggleNodeExpansion(volumeNode.id);
        }

        // 如果是手动停止的，提示不同
        if (abortControllerRef.current?.signal.aborted) {
          toast.info(`已生成 ${chaptersData.length} 章 (用户停止)`);
        } else {
          toast.success(
            `成功为 ${volumeNode.title} 生成 ${chaptersData.length} 个章节`
          );
        }
      }
    } catch (error) {
      // 错误处理保持不变
    } finally {
      setIsGenerating(false);
      setProgressMessage("");
      abortControllerRef.current = null; // 清理
    }
  };

  // ✅ 新增：校准卷信息处理函数
  const handleCalibrateVolume = async (volumeNode: any) => {
    if (!currentNovelTitle || !currentNovel) return;

    setIsGenerating(true);
    setProgressMessage("正在读取前文实际剧情，校准大纲...");

    try {
      // 1. 构建包含"事实"的上下文
      const dynamicContext = buildDynamicContext(
        volumeNode.id,
        tree,
        currentNovel.chapters || []
      );

      // 2. 调用校准服务
      const result = await calibrateVolumeInfo(
        currentNovelTitle,
        volumeNode.title,
        volumeNode.desc, // 原本的计划
        dynamicContext.slice(-40000) // 保持一致的40000字限制
      );

      if (result) {
        // 3. 更新大纲树
        updateNode(volumeNode.id, { desc: result.newDesc });
        toast.success("大纲已校准", { description: result.reason });
      }
    } catch (e) {
      toast.error("校准失败");
    } finally {
      setIsGenerating(false);
      setProgressMessage("");
    }
  };

  const handleExtractWorld = async () => {
    if (!tree || tree.length === 0) {
      toast.error("大纲为空，无法提取");
      return;
    }

    const outlineText = tree
      .map(
        (vol) =>
          `卷：${vol.title}\n简介：${vol.desc}\n` +
          (vol.children || [])
            .map((ch) => `  章：${ch.title}\n  细纲：${ch.desc}`)
            .join("\n")
      )
      .join("\n\n");

    setIsExtracting(true);
    const toastId = toast.loading("正在分析大纲提取世界观...", {
      description: "AI 正在阅读你的大纲",
    });

    try {
      const stats = await extractionService.extractAndSave(
        outlineText,
        currentNovelTitle
      );

      refreshChars();
      refreshFactions();
      refreshSettings();
      refreshItems();

      toast.success("世界观提取完成！", {
        id: toastId,
        description: `新增：${stats.chars}角色, ${stats.factions}势力, ${stats.settings}场景, ${stats.items}物品`,
      });
    } catch (error) {
      console.error(error);
      toast.error("提取失败", {
        id: toastId,
        description: (error as Error).message,
      });
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-muted/10 overflow-hidden">
      {/* ✅ 优化后的顶部栏：高度减半，紧凑布局 */}
      <div className="h-10 border-b bg-background/80 backdrop-blur-md flex items-center justify-between px-3 shadow-sm shrink-0 z-20">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon" // 使用 icon 尺寸更小
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            title={isSidebarCollapsed ? "展开配置面板" : "折叠配置面板"}
            className="h-7 w-7 md:hidden"
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>
          {/* 标题字体变小，去除冗余图标或缩小图标 */}
          <h2 className="text-sm font-semibold flex items-center gap-2 text-foreground">
            <ListTree className="w-4 h-4 text-primary" />
            大纲规划中心
          </h2>
        </div>

        <div className="flex gap-2">
          <Button
            variant="ghost" // 改为 ghost 减少视觉干扰
            size="sm"
            onClick={handleSyncFromDirectory}
            title="读取当前目录结构"
            className="h-7 text-xs px-2 hover:bg-muted"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> 同步目录
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            className="hidden md:flex h-7 w-7"
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* 主体区域：左右分栏布局 */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {isSidebarCollapsed ? (
          /* 折叠状态：只显示大纲列表 */
          <div className="flex-1 h-full bg-muted/5">
            <OutlineListPanel
              tree={tree}
              isGenerating={isGenerating}
              generationLog={generationLog}
              expandedNodes={expandedNodes}
              onToggleExpand={toggleNodeExpansion}
              onGenerateChapters={handleGenerateChapters}
              onDragEnd={handleDragEnd}
              progressMessage={progressMessage}
              onCalibrateVolume={handleCalibrateVolume} // ✅ 新增：传递校准函数
            />
          </div>
        ) : (
          /* 展开状态：左右分栏 */
          <PanelGroup direction="horizontal" className="flex-1">
            {/* 左侧：大纲列表 (占据主要空间) */}
            <Panel defaultSize={70} minSize={50} className="relative">
              <div className="h-full bg-muted/5 border-r border-border/50">
                <OutlineListPanel
                  tree={tree}
                  isGenerating={isGenerating}
                  generationLog={generationLog}
                  expandedNodes={expandedNodes}
                  onToggleExpand={toggleNodeExpansion}
                  onGenerateChapters={handleGenerateChapters}
                  onDragEnd={handleDragEnd}
                  progressMessage={progressMessage}
                  onCalibrateVolume={handleCalibrateVolume} // ✅ 新增：传递校准函数
                />
              </div>
            </Panel>

            {/* 拖拽分割线 */}
            <PanelResizeHandle className="w-2 bg-muted hover:bg-primary/20 cursor-col-resize flex items-center justify-center shrink-0 transition-colors group z-30">
              <div className="w-1 h-12 rounded-full bg-border group-hover:bg-primary/50 transition-colors" />
            </PanelResizeHandle>

            {/* 右侧：配置侧边栏 (固定宽度) */}
            <Panel
              defaultSize={30}
              minSize={25}
              maxSize={40}
              className="relative bg-background shadow-xl z-10"
            >
              <OutlineConfigPanel
                selectedGenres={selectedGenres}
                setSelectedGenres={setSelectedGenres}
                selectedWordCount={selectedWordCount}
                setSelectedWordCount={setSelectedWordCount}
                selectedTags={selectedTags}
                setSelectedTags={setSelectedTags}
                customPrompt={customPrompt}
                setCustomPrompt={setCustomPrompt}
                isGenerating={isGenerating}
                isExtracting={isExtracting}
                tree={tree}
                onGenerateOutline={generateOutline}
                onExtractWorld={handleExtractWorld}
                onApplyOutline={applyOutline}
              />
            </Panel>
          </PanelGroup>
        )}

        {/* ✅ 全局进度与控制显示 */}
        {isGenerating && generationMode === "chapters" && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-background/95 backdrop-blur border rounded-lg p-4 shadow-2xl z-50 flex flex-col items-center gap-3 min-w-[300px] animate-in slide-in-from-bottom-4">
            <div className="flex items-center gap-3 w-full">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <div className="flex flex-col flex-1">
                <span className="text-sm font-medium">AI 正在构思...</span>
                <span className="text-xs text-muted-foreground">
                  {progressMessage}
                </span>
              </div>
            </div>

            {/* 进度条 (模拟或真实) */}
            <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-primary animate-pulse w-full origin-left scale-x-50 duration-1000" />
            </div>

            <div className="flex items-center justify-between w-full pt-1">
              <span className="text-[10px] text-muted-foreground">
                预计耗时: {getEstimatedTime(selectedWordCount)}
              </span>

              {/* 停止按钮 */}
              <Button
                variant="destructive"
                size="sm"
                className="h-7 text-xs px-3"
                onClick={handleStopGeneration}
              >
                <StopCircle className="w-3 h-3 mr-1.5" />
                停止生成 (保留进度)
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
